import { describe, it, expect, beforeAll } from 'vitest';
import { ulid } from 'ulid';
import { openDB, db, HOME_ID } from '../storage/db';
import { repo } from './repo';
import { dataView } from './view';

beforeAll(() => { openDB([]); });

describe('dataView', () => {
  it('currentCharacter follows whoever you last opened a chat with', async () => {
    const a = await repo.createCharacter({ name: '阿一', core: 'a', full: 'a' });
    const b = await repo.createCharacter({ name: '阿二', core: 'b', full: 'b' });
    await repo.directConversation(a);
    await repo.directConversation(b);
    expect((await dataView.currentCharacter())!.name).toBe('阿二');
    expect((await dataView.characters()).map((c) => c.name).sort()).toEqual(['阿一', '阿二']);
  });

  it('state is a snapshot: mutating it does not write back', async () => {
    await repo.updateState({ mood: '', relation: '', facts: ['a'] });
    const v = await dataView.state();
    v.facts.push('改了');
    expect((await db().home.get(HOME_ID))!.state.facts).toEqual(['a']);
  });

  it('memories are newest first and filter by importance', async () => {
    await db().memories.clear();
    for (const [i, imp] of [1, 3, 2].entries()) {
      await db().memories.add({ id: ulid(), when: '', text: `m${i}`, importance: imp as 1 | 2 | 3, sourceMessageIds: [], createdAt: 1000 + i });
    }
    expect((await dataView.memories()).map((m) => m.text)).toEqual(['m2', 'm1', 'm0']);
    expect((await dataView.memories({ minImportance: 2, limit: 1 })).map((m) => m.text)).toEqual(['m2']);
  });

  it('messages reads chat conversations by time range, oldest first, with card alt folded into text', async () => {
    const c = await repo.createCharacter({ name: '阿三', core: 'c', full: 'c' });
    const conv = await repo.directConversation(c);
    await db().messages.bulkAdd([
      { id: 'x1', conversationId: conv.id, role: 'user', content: [{ type: 'text', text: '早' }], ts: 100 },
      { id: 'x2', conversationId: conv.id, role: 'assistant', content: [{ type: 'text', text: '' }], ts: 200, meta: { cards: [{ pluginId: 'p', tag: 't', body: '', attrs: {}, alt: '[分享了歌：晴天]' }] } },
      { id: 'x3', conversationId: conv.id, role: 'user', content: [{ type: 'text', text: '晚' }], ts: 300 },
      { id: 'x4', conversationId: 'not-chat', role: 'user', content: [{ type: 'text', text: '别处' }], ts: 150 },
    ]);
    const rows = await dataView.messages({ from: 100, to: 300 });
    expect(rows.map((r) => r.text)).toEqual(['早', '[分享了歌：晴天]']);
    expect(rows[0]!.characterId).toBe(c.id);
    expect((await dataView.messages({ from: 0, to: 1000, limit: 1 })).map((r) => r.id)).toEqual(['x3']);
    await db().setKV('kernel.userName', '小天');
    expect((await dataView.userProfile()).name).toBe('小天');
  });
});
