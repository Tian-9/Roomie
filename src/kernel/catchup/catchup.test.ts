import { describe, it, expect, vi, beforeAll } from 'vitest';
import { openDB, db, HOME_ID } from '../storage/db';
import type { CatchupItem } from '../api/types';

vi.mock('../llm/gateway.svelte', () => ({ llm: { configured: true, chat: vi.fn(), settings: {} } }));
vi.mock('../registry/registry.svelte', () => ({ registry: { plugins: [] as unknown[], isEnabled: () => true } }));

beforeAll(() => { openDB([]); });
const H = 3600_000;

describe('catchup tiers', () => {
  it('maps elapsed time to tiers and higher tiers cover lower ones', async () => {
    const { tierFor, covers, elapsedText, composeSay } = await import('./catchup');
    expect(tierFor(5 * H)).toBeNull();
    expect(tierFor(6 * H)).toBe('h6');
    expect(tierFor(30 * H)).toBe('d1');
    expect(tierFor(49 * H)).toBe('days');
    expect(covers('h6', 'd1')).toBe(false);
    expect(covers('days', 'h6')).toBe(true);
    expect(covers('h6', 'attach')).toBe(true);
    expect(elapsedText(8 * H)).toBe('大约 8 小时');
    expect(elapsedText(3 * 24 * H + 5 * H)).toBe('3 天');
    expect(composeSay('days', [{ say: '昨天那篇日记写完了' }, { text: 'x' }, { say: ' ' }, null])).toBe('好久不见。\n昨天那篇日记写完了');
    expect(composeSay('h6', [{ say: '今天三点开会' }])).toBe('今天三点开会');
    expect(composeSay('d1', [{ text: 'x' }])).toBe('');
    expect(composeSay('d1', [{ say: '早安，昨天聊到挺晚' }, { say: '今天三点开会' }], true)).toBe('早安，昨天聊到挺晚\n今天三点开会');
  });
});

describe('catchup run', () => {
  it('batches all contributors into one call for the current character, dispatches results, posts the say as his message', async () => {
    const { llm } = await import('../llm/gateway.svelte');
    const { registry } = await import('../registry/registry.svelte');
    const { catchup } = await import('./catchup');
    const { repo } = await import('../data/repo');
    const chat = llm.chat as unknown as ReturnType<typeof vi.fn>;
    const now = 1_000_000_000_000;
    await db().characters.bulkAdd([{ id: 'a', name: 'A', core: 'x', full: '' }, { id: 'b', name: 'B', core: 'y', full: '' }]);
    await repo.setCurrentCharacter('b');
    await db().home.put({ id: HOME_ID, state: { mood: '无聊', relation: '', facts: [] }, lastActiveAt: now - 3 * 24 * H });
    const applied: Record<string, unknown> = {};
    const item = (label: string): CatchupItem => ({ label, prompt: `做 ${label}`, schema: { type: 'object', properties: { text: { type: 'string' }, say: { type: 'string' } } }, apply: async (o) => { applied[label] = o; } });
    const collectDay = vi.fn(async (_c: unknown) => item('日记'));
    (registry.plugins as unknown[]).push(
      { id: 'ledger', catchup: [{ id: 'weekly', tier: 'h6', collect: async () => item('周报') }, { id: 'today', tier: 'attach', collect: async () => item('今天') }] },
      { id: 'diary', catchup: [{ id: 'write', tier: 'd1', collect: collectDay }, { id: 'nothing', tier: 'h6', collect: async () => null }] },
    );
    chat.mockResolvedValueOnce({ text: JSON.stringify({ ledger_weekly: { text: '算了', say: '上周花了不少' }, ledger_today: { text: '看了' }, diary_write: { text: '写了', say: '昨天的日记补上了' } }), stopReason: 'end_turn', usage: {}, content: [], model: 'm' });
    await catchup.run(now);

    expect(chat).toHaveBeenCalledTimes(1);
    const req = chat.mock.calls[0]![0];
    expect(req.purpose).toBe('catchup');
    expect(req.system[0].text).toContain('「B」');
    expect(req.messages[0].content[0].text).toContain('对方离开了3 天');
    expect(req.messages[0].content[0].text).toContain('你现在的情绪：无聊');
    expect(req.messages[0].content[0].text).toContain('## 周报（字段 ledger_weekly）');
    expect(req.jsonSchema.required).toEqual(['ledger_weekly', 'ledger_today', 'diary_write']);
    expect(collectDay.mock.calls[0]![0]).toMatchObject({ characterId: 'b', characterName: 'B', tier: 'days', days: 3 });
    expect(applied).toEqual({ 周报: { text: '算了', say: '上周花了不少' }, 今天: { text: '看了' }, 日记: { text: '写了', say: '昨天的日记补上了' } });
    // 各段的 say 合成一条他发来的消息，写进和他的对话
    const conv = await repo.directConversation((await db().characters.get('b'))!);
    const msgs = await repo.messagesOf(conv.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe('assistant');
    expect((msgs[0]!.content[0] as { text: string }).text).toBe('好久不见。\n上周花了不少\n昨天的日记补上了');
    expect(msgs[0]!.meta).toEqual({ catchup: 'days' });
    expect((await db().home.get(HOME_ID))!.catchupAt).toBe(now);

    // 再回来一小时后：间隔从上次补发算，不够 6 小时，不再触发
    await db().home.update(HOME_ID, { lastActiveAt: now - 3 * 24 * H });
    await catchup.run(now + 1 * H);
    expect(chat).toHaveBeenCalledTimes(1);
    // 7 小时后到 h6 档：只带 h6 和 attach 的，不带 d1 的日记；没人想说话就不发消息
    chat.mockResolvedValueOnce({ text: JSON.stringify({ ledger_weekly: { text: '' }, ledger_today: { text: '' } }), stopReason: 'end_turn', usage: {}, content: [], model: 'm' });
    await catchup.run(now + 7 * H);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1]![0].jsonSchema.required).toEqual(['ledger_weekly', 'ledger_today']);
    expect(await repo.messagesOf(conv.id)).toHaveLength(1);
  });
});
