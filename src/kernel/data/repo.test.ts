import { describe, it, expect, beforeAll } from 'vitest';
import { ulid } from 'ulid';
import { openDB, db, HOME_ID } from '../storage/db';
import { repo, textOf } from './repo';

beforeAll(() => { openDB([]); });

describe('repo', () => {
  it('creates a character and one direct conversation with the first message; chatting makes them the current one', async () => {
    const c = await repo.createCharacter({ name: '林晚秋', core: 'x', full: 'x', firstMessage: '你来了。', useFirstMessage: true });
    const conv1 = await repo.directConversation(c);
    const conv2 = await repo.directConversation(c);
    expect(conv1.id).toBe(conv2.id);
    expect((await repo.currentCharacter())!.id).toBe(c.id);
    const msgs = await repo.messagesOf(conv1.id);
    expect(msgs).toHaveLength(1);
    expect(textOf(msgs[0]!)).toBe('你来了。');
    expect((await repo.home()).lastActiveAt).toBeGreaterThan(0);
    await repo.deleteCharacter(c.id);
    expect(await db().messages.count()).toBe(0);
    expect(await db().conversations.count()).toBe(0);
    expect(await repo.currentCharacter()).toBeUndefined();
  });

  it('memory, state and notes belong to you: swapping or deleting a card keeps them', async () => {
    const a = await repo.createCharacter({ name: '阿一', core: 'a', full: 'a' });
    const b = await repo.createCharacter({ name: '阿二', core: 'b', full: 'b' });
    await repo.directConversation(a);
    await db().memories.add({ id: ulid(), characterId: a.id, when: '昨天', text: '对方怕黑', importance: 2, sourceMessageIds: [], createdAt: 1 });
    await db().notes.put({ path: '/memories/user.md', content: '怕黑', updatedAt: 1 });
    await repo.updateState({ mood: '平静', relation: '室友', facts: ['对方周末不上班'] });

    await repo.directConversation(b);
    expect((await repo.currentCharacter())!.id).toBe(b.id);
    expect(await db().memories.count()).toBe(1);
    expect((await db().home.get(HOME_ID))!.state.facts).toEqual(['对方周末不上班']);

    await repo.deleteCharacter(b.id);
    expect((await repo.currentCharacter())!.id).toBe(a.id);
    expect(await db().memories.count()).toBe(1);
    expect(await db().notes.count()).toBe(1);
    expect((await db().home.get(HOME_ID))!.state.relation).toBe('室友');
    await repo.deleteCharacter(a.id);
  });
});
