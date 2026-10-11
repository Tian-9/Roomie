import { describe, it, expect, beforeAll } from 'vitest';
import { openDB, db, pluginTable } from '$kernel/storage/db';
import type { PluginContext, PromptContext } from '$kernel/api';
import plugin, { habitsApi, collectAsk } from './index';
import { today, addDays } from './streak';

const pc = (addCard?: PromptContext['addCard']): PromptContext => ({ conversationId: 'cv1', characterId: 'c1', addCard });
const tool = (name: string) => plugin.tools!.find((t) => t.name === name)!;
const kv = new Map<string, unknown>();

beforeAll(() => {
  openDB([plugin]);
  const ctx = {
    id: 'habits',
    table: (n: string) => db().table(pluginTable('habits', n)),
    settings: { get: async <T,>(k: string, d: T) => (kv.has(k) ? (kv.get(k) as T) : d), set: async (k: string, v: unknown) => { kv.set(k, v); } },
    emit() {},
  } as unknown as PluginContext;
  plugin.setup!(ctx);
});

describe('habit tools', () => {
  it('adds a habit once, checks it with a card, refuses duplicates and future dates', async () => {
    expect(await tool('habit_add').handler({ name: '跑步', cadence: 'daily' }, pc())).toContain('已加：跑步（每天）');
    expect(await tool('habit_add').handler({ name: '跑步' }, pc())).toContain('已经有了');
    expect(await tool('habit_add').handler({ name: '  ' }, pc())).toContain('不能为空');
    expect((await habitsApi.active()).map((h) => h.name)).toEqual(['跑步']);

    const cards: string[] = [];
    const td = today(), y = addDays(td, -1);
    expect(await tool('habit_check').handler({ name: '跑步', date: y }, pc())).toBe(`已打卡：跑步（${y}），第 1 天。`);
    const r = await tool('habit_check').handler({ name: '跑', date: td }, pc((tag, body, _a, alt) => cards.push(`${tag} ${alt} ${JSON.parse(body).count}`)));
    expect(r).toBe('已打卡：跑步，第 2 天。');
    expect(cards).toEqual(['check [打卡：跑步 · 第 2 天] 2']);
    expect(await tool('habit_check').handler({ name: '跑步' }, pc())).toContain('今天 已经打过卡了');
    expect(await tool('habit_check').handler({ name: '跑步', date: addDays(td, 1) }, pc())).toContain('未来');
    expect(await tool('habit_check').handler({ name: '跑步', date: '昨天' }, pc())).toContain('YYYY-MM-DD');
    expect(await tool('habit_check').handler({ name: '冥想' }, pc())).toContain('没有叫「冥想」的习惯。现有的：跑步');
    expect(await habitsApi.checks().count()).toBe(2);
  });

  it('reports status and a one-line summary, and hides them when nothing exists', async () => {
    expect(await tool('habit_status').handler({}, pc())).toBe('- 跑步连续 2 天（每天）');
    expect(await habitsApi.summary()).toBe('习惯：跑步连续 2 天');
    const vol = await plugin.promptContributors![0]!.volatile!({ conversationId: 'cv1', characterId: 'c1' });
    expect(vol).toBe('习惯：跑步连续 2 天');
    // 归档后不出现；删除连记录一起没
    const h = (await habitsApi.active())[0]!;
    await habitsApi.update(h.id, { archived: 1 });
    expect(await habitsApi.summary()).toBe('');
    await habitsApi.remove(h.id);
    expect(await habitsApi.checks().count()).toBe(0);
    expect(await tool('habit_status').handler({}, pc())).toContain('还没有任何习惯');
  });

  it('asks in the evening about habits not yet checked today, at most once a day', async () => {
    const cctx = { characterId: 'c1', characterName: 'A', elapsedMs: 0, days: 0, tier: 'chat' as const, elapsedText: '' };
    await habitsApi.add('早睡', 'daily');
    const d = new Date(); d.setHours(10, 0, 0, 0);
    expect(await collectAsk(cctx, d)).toBeNull(); // 白天不问
    d.setHours(21);
    const item = await collectAsk(cctx, d);
    expect(item?.prompt).toContain('早睡（刚开始）');
    await item!.apply({ asked: true }, cctx);
    expect(await collectAsk(cctx, d)).toBeNull(); // 问过了
    kv.clear();
    await habitsApi.check((await habitsApi.find('早睡'))!, today(), 'manual');
    expect(await collectAsk(cctx, d)).toBeNull(); // 打过了
  });
});
