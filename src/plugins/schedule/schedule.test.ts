import { describe, it, expect, beforeAll, vi } from 'vitest';
import { openDB, db, pluginTable } from '$kernel/storage/db';
import type { PluginContext, PromptContext, CatchupContext } from '$kernel/api';
import plugin, { scheduleApi, LATE_WINDOW } from './index';
import { isoDate, addDays, atTime } from './dates';

const tool = (name: string) => plugin.tools!.find((t) => t.name === name)!;
const pc = (addCard?: PromptContext['addCard']): PromptContext => ({ conversationId: 'cv1', characterId: 'c1', addCard });
const kv = new Map<string, unknown>();
const notices: string[] = [];
const today = isoDate();
const tomorrow = addDays(today, 1);

beforeAll(async () => {
  openDB([plugin]);
  const ctx = {
    id: 'schedule',
    table: (n: string) => db().table(pluginTable('schedule', n)),
    settings: { get: async <T,>(k: string, d: T) => (kv.has(k) ? (kv.get(k) as T) : d), set: async (k: string, v: unknown) => { kv.set(k, v); } },
    emit() {},
    notify: (title: string, body?: string) => notices.push(`${title} ${body ?? ''}`),
  } as unknown as PluginContext;
  await plugin.setup!(ctx);
});

describe('工具：记、查、勾、删', () => {
  it('schedule_add 只收 ISO 日期和 HH:mm，记完带卡', async () => {
    expect(await tool('schedule_add').handler({ title: '开会', date: '明天', time: '15:00' }, pc())).toContain('YYYY-MM-DD');
    expect(await tool('schedule_add').handler({ title: '开会', date: tomorrow, time: '下午三点' }, pc())).toContain('HH:mm');
    expect(await tool('schedule_add').handler({ title: '', date: tomorrow }, pc())).toContain('标题');
    const cards: string[] = [];
    const r = await tool('schedule_add').handler({ title: '开会', date: tomorrow, time: '15:00' }, pc((tag, body, _a, alt) => cards.push(`${tag} ${JSON.parse(body).id ? 'id' : ''} ${alt}`)));
    expect(r).toContain('记下了：明天 15:00 开会');
    expect(cards).toEqual(['event id [日程] 明天 15:00 开会']);
    const todo = await tool('schedule_add').handler({ title: '买牛奶', date: today }, pc());
    expect(todo).toContain('记下了：今天 买牛奶');
  });
  it('schedule_list 默认一周，带过期和假期', async () => {
    await scheduleApi.add({ title: '上周的事', date: addDays(today, -3), source: 'tool' });
    const out = (await tool('schedule_list').handler({}, pc())) as string;
    expect(out).toContain('明天 15:00 开会');
    expect(out).toContain('今天 买牛奶');
    expect(out).toContain('上周的事');
    expect(out).toContain('过期没做');
    const nat = (await tool('schedule_list').handler({ from: '2026-09-28', to: '2026-10-12' }, pc())) as string;
    expect(nat).toContain('国庆节 10/1–10/7');
    expect(nat).toContain('10/10 调休上班');
  });
  it('schedule_done / schedule_remove 认 id 也认标题', async () => {
    const r = await tool('schedule_done').handler({ id: '牛奶' }, pc());
    expect(r).toBe('完成了：买牛奶');
    const milk = await scheduleApi.find('买牛奶');
    expect(milk?.done).toBe(1);
    const meeting = await scheduleApi.find('开会');
    expect(await tool('schedule_remove').handler({ id: meeting!.id }, pc())).toContain('删掉了：明天 15:00 开会');
    expect(await scheduleApi.find('开会')).toBeUndefined();
    expect(await tool('schedule_done').handler({ id: '不存在' }, pc())).toContain('没找到');
  });
  it('today() 含过期未完成，不含过期已完成', async () => {
    const t = await scheduleApi.today(today);
    expect(t.map((i) => i.title)).toEqual(['上周的事', '买牛奶']);
    await scheduleApi.setDone((await scheduleApi.find('上周的事'))!.id, true);
    expect((await scheduleApi.today(today)).map((i) => i.title)).toEqual(['买牛奶']);
  });
});

describe('前台到点提醒', () => {
  it('到点才弹，过了半小时的只标记不弹，弹过的不再弹', async () => {
    const now = Date.now();
    const soon = new Date(now + 60_000), late = new Date(now - LATE_WINDOW - 60_000);
    const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const a = await scheduleApi.add({ title: '马上', date: isoDate(soon), time: hhmm(soon), source: 'tool' });
    const b = await scheduleApi.add({ title: '早过了', date: isoDate(late), time: hhmm(late), source: 'tool' });
    // 测试跨日时 b 会落到昨天，tick 只看今天：这种边界下只检查 a
    const sameDay = isoDate(late) === isoDate(soon);
    notices.length = 0;
    expect((await scheduleApi.tick(now)).map((i) => i.title)).toEqual(sameDay ? ['早过了'] : []);
    expect(notices).toEqual([]);
    const fired = await scheduleApi.tick(now + 90_000);
    expect(fired.map((i) => i.title)).toEqual(['马上']);
    expect(notices).toEqual([`马上 ${a.time} · 到点了`]);
    expect(await scheduleApi.tick(now + 120_000)).toEqual([]);
    if (sameDay) expect((await scheduleApi.items().get(b.id))?.notifiedAt).toBe(now);
  });
});

describe('补发', () => {
  const cc = (elapsedMs: number): CatchupContext => ({ characterId: 'c1', characterName: '他', elapsedMs, days: 0, tier: 'h6', elapsedText: '大约 6 小时' });
  const collect = (id: string, c: CatchupContext) => plugin.catchup!.find((x) => x.id === id)!.collect(c);
  it('今天的安排：挂在聊天上，一天只提一次', async () => {
    await scheduleApi.add({ title: '交电费', date: today, source: 'manual' });
    const item = await collect('today', cc(0));
    expect(item?.prompt).toContain('交电费（待办）');
    expect(item?.prompt).not.toContain('买牛奶');
    await item!.apply({ mentioned: true }, cc(0));
    expect(await collect('today', cc(0))).toBeNull();
    kv.delete('mentioned');
    const again = await collect('today', cc(0));
    await again!.apply({ mentioned: false }, cc(0));
    expect(await collect('today', cc(0))).not.toBeNull();
  });
  it('错过的：只有离开期间到点的、没做的，提过一次就不再提', async () => {
    const now = Date.now();
    const d = new Date(now - 2 * 3600_000);
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const missed = await scheduleApi.add({ title: '两小时前的会', date: isoDate(d), time, source: 'tool' });
    expect(atTime(missed.date, missed.time)).toBeLessThan(now);
    const item = await collect('missed', cc(6 * 3600_000));
    expect(item?.label).toBe('错过的安排');
    expect(item?.prompt).toContain('两小时前的会');
    expect(item?.prompt).not.toContain('交电费');
    await item!.apply({ say: '会开完了？' }, cc(6 * 3600_000));
    expect(await collect('missed', cc(6 * 3600_000))).toBeNull();
    // 只离开一小时：两小时前的不算这次错过的
    const fresh = await scheduleApi.add({ title: '三小时前', date: isoDate(new Date(now - 3 * 3600_000)), time: `${String(new Date(now - 3 * 3600_000).getHours()).padStart(2, '0')}:00`, source: 'tool' });
    void fresh;
    expect(await collect('missed', cc(3600_000))).toBeNull();
  });
});

describe('提示词', () => {
  it('volatile 一段带今天、明天和下个假期；触发词里有"明天"', async () => {
    const c = plugin.promptContributors![0]!;
    expect(c.triggers).toContain('明天');
    const v = await c.volatile!(pc());
    expect(v).toContain(`今天 ${today}`);
    expect(v).toContain('交电费');
    expect(v).toContain('买牛奶（已完成）');
    expect(v).toMatch(/下个假期|放假中/);
    vi.restoreAllMocks();
  });
});
