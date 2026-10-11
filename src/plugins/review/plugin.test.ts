import { describe, it, expect, beforeAll } from 'vitest';
import { openDB, db, pluginTable } from '$kernel/storage/db';
import type { PluginContext, CatchupContext, MessageView } from '$kernel/api';
import plugin, { reviewApi, collectDaily, collectWeekly } from './index';
import { ymd, addDays, dayStart } from './review';

const kv = new Map<string, unknown>();
const services = new Map<string, unknown>();
const notices: string[] = [];
const today = ymd();
const yday = addDays(today, -1);
const messages: MessageView[] = [
  { id: 'm1', conversationId: 'cv', role: 'user', text: '今天加班到十点', ts: dayStart(yday) + 22 * 3600_000 },
  { id: 'm2', conversationId: 'cv', role: 'assistant', text: '早点睡', ts: dayStart(yday) + 22 * 3600_000 + 1 },
  { id: 'm3', conversationId: 'cv', role: 'system', text: '（系统）', ts: dayStart(yday) + 23 * 3600_000 },
  { id: 'm0', conversationId: 'cv', role: 'user', text: '前天的话', ts: dayStart(yday) - 3600_000 },
];
const cctx = (days = 1): CatchupContext => ({ characterId: 'c1', characterName: '阿树', elapsedMs: days * 86400_000 + 3600_000, days, tier: days >= 2 ? 'days' : 'd1', elapsedText: days >= 2 ? `${days} 天` : '一天多' });
const tool = (name: string) => plugin.tools!.find((t) => t.name === name)!;

beforeAll(() => {
  openDB([plugin]);
  const ctx = {
    id: 'review',
    table: (n: string) => db().table(pluginTable('review', n)),
    settings: { get: async <T,>(k: string, d: T) => (kv.has(k) ? (kv.get(k) as T) : d), set: async (k: string, v: unknown) => { kv.set(k, v); } },
    emit() {},
    notify: (title: string) => { notices.push(title); },
    service: (name: string) => services.get(name),
    llm: { configured: false },
    data: {
      messages: async ({ from, to }: { from: number; to: number }) => messages.filter((m) => m.ts >= from && m.ts < to),
      userProfile: async () => ({ name: '小明', profile: '' }),
      currentCharacter: async () => ({ id: 'c1', name: '阿树', core: '' }),
      characters: async () => [{ id: 'c1', name: '阿树', core: '' }],
    },
  } as unknown as PluginContext;
  plugin.setup!(ctx);
});

describe('daily review catch-up', () => {
  it('greets by itself, reviews yesterday from the conversation only when no other plugin is installed, and saves the text', async () => {
    const at = new Date(); at.setHours(8, 30, 0, 0);
    const item = await collectDaily(cctx(1), at);
    expect(item).not.toBeNull();
    expect(item!.greets).toBe(true);
    expect(item!.prompt).toContain('算早上');
    expect(item!.prompt).toContain('早安之类');
    expect(item!.prompt).toContain('聊了 2 条'); // 系统消息和前天的不算
    expect(item!.prompt).toContain('小明：今天加班到十点');
    expect(item!.prompt).toContain('说完——昨天聊了什么。');
    expect(item!.prompt).not.toContain('花');
    expect(item!.prompt).not.toContain('安排');
    await item!.apply({ text: '昨天你加班到十点，我让你早点睡。', say: '早啊，昨天辛苦了。' }, cctx(1));
    const saved = await reviewApi.forDate('daily', yday);
    expect(saved?.text).toBe('昨天你加班到十点，我让你早点睡。');
    expect(saved?.say).toBe('早啊，昨天辛苦了。');
    expect(saved?.material).toEqual({ from: yday, to: yday, messages: 2 });
    expect(notices).toEqual(['阿树 写了昨天的复盘']);
    // 复盘过了就不再收集
    expect(await collectDaily(cctx(1), at)).toBeNull();
  });

  it('says 回来了 outside morning hours and covers the whole absence', async () => {
    await reviewApi.reviews().clear();
    const at = new Date(); at.setHours(20, 0, 0, 0);
    const item = await collectDaily(cctx(1), at);
    expect(item!.prompt).toContain('不算早上');
    expect(item!.prompt).toContain('「回来了」之类');
    const long = await collectDaily(cctx(3), at);
    expect(long!.prompt).toContain('好久不见之类');
    expect(long!.prompt).toContain(`${addDays(today, -3)} 到 ${yday} 你们聊了 3 条`);
    await long!.apply({ text: '这几天……', say: '好久不见' }, cctx(3));
    expect((await reviewApi.forDate('daily', yday))?.material).toEqual({ from: addDays(today, -3), to: yday, messages: 3 });
    // 没写出正文就不存
    await reviewApi.reviews().clear();
    await item!.apply({ text: '', say: '回来啦' }, cctx(1));
    expect(await reviewApi.reviews().count()).toBe(0);
  });

  it('uses ledger / habits / schedule / lunar services when they are there, and survives a broken one', async () => {
    services.set('ledger', { range: async (from: string, to: string) => (from === yday && to === yday ? [{ amount: 3200, category: '餐饮', note: '午饭', date: yday }, { amount: 50, category: '交通', note: '', date: yday }] : []) });
    services.set('habits', { summary: async () => '习惯：跑步连续 3 天（今天未打卡）' });
    services.set('schedule', {
      range: async () => [{ title: '开会', date: yday, time: '15:00', done: 1 }, { title: '交房租', date: yday, done: 0 }],
      today: async () => [{ title: '牙医', date: today, time: '10:00', done: 0 }, { title: '昨天剩的', date: yday, done: 0 }],
    });
    services.set('lunar', { dayLine: () => { throw new Error('boom'); } });
    const at = new Date(); at.setHours(9, 0, 0, 0);
    const item = await collectDaily(cctx(1), at);
    expect(item!.prompt).toContain('说完——昨天聊了什么、花了多少、坚持的事怎么样、今天有什么。');
    expect(item!.prompt).toContain('小明花了 ¥32.50，2 笔：餐饮 ¥32（午饭）、交通 ¥0.50');
    expect(item!.prompt).toContain('习惯：跑步连续 3 天');
    expect(item!.prompt).toContain('做完的事：15:00 开会');
    expect(item!.prompt).toContain('记了但没做的事：交房租');
    expect(item!.prompt).toContain('今天的安排：10:00 牙医');
    expect(item!.prompt).not.toContain('今天：');
    await item!.apply({ text: 'x', say: 'y' }, cctx(1));
    expect((await reviewApi.forDate('daily', yday))?.material).toEqual({
      from: yday, to: yday, messages: 2,
      spent: { total: 3250, count: 2, lines: ['餐饮 ¥32（午饭）', '交通 ¥0.50'] },
      habits: '习惯：跑步连续 3 天（今天未打卡）',
      schedule: { done: ['15:00 开会'], missed: ['交房租'], today: ['10:00 牙医'] },
    });
  });
});

describe('weekly summary', () => {
  it('runs on sunday evening or monday, once per week, and can be switched off', async () => {
    const sun = new Date(2026, 9, 11, 19); // 周日晚上
    const item = await collectWeekly(cctx(0), sun);
    expect(item?.label).toBe('周小结');
    expect(item!.prompt).toContain('2026-10-05 到 2026-10-11');
    await item!.apply({ text: '这周……' }, cctx(0));
    expect((await reviewApi.forDate('weekly', '2026-10-05'))?.kind).toBe('weekly');
    expect(await collectWeekly(cctx(0), sun)).toBeNull(); // 这周写过了
    expect(await collectWeekly(cctx(0), new Date(2026, 9, 12, 9))).toBeNull(); // 周一还是同一周
    expect(await collectWeekly(cctx(0), new Date(2026, 9, 19, 9))).not.toBeNull(); // 下周一是新的一周
    expect(await collectWeekly(cctx(0), new Date(2026, 9, 14, 20))).toBeNull(); // 周三不做
    kv.set('settings', { weekly: false });
    expect(await collectWeekly(cctx(0), new Date(2026, 9, 19, 9))).toBeNull();
    kv.clear();
  });
});

describe('review_read tool', () => {
  it('lists recent reviews and reads one by date, weekly ones by their monday', async () => {
    expect(await tool('review_read').handler({ date: yday }, { conversationId: 'cv', characterId: 'c1' })).toContain('x');
    expect(await tool('review_read').handler({ date: '2026-10-05' }, { conversationId: 'cv', characterId: 'c1' })).toContain('（周小结）\n这周……');
    const list = String(await tool('review_read').handler({}, { conversationId: 'cv', characterId: 'c1' }));
    expect(list).toContain(`- ${yday}：x…`);
    expect(list).toContain('- 2026-10-05（周小结）：这周……');
    expect(await tool('review_read').handler({ date: '1999-01-01' }, { conversationId: 'cv', characterId: 'c1' })).toBe('那天没写复盘。');
    expect(await tool('review_read').handler({ date: '上周' }, { conversationId: 'cv', characterId: 'c1' })).toContain('YYYY-MM-DD');
    await reviewApi.reviews().clear();
    expect(await tool('review_read').handler({}, { conversationId: 'cv', characterId: 'c1' })).toBe('还没写过复盘。');
  });
});
