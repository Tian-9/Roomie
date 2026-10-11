import { describe, it, expect, beforeAll } from 'vitest';
import { openDB, db, pluginTable } from '$kernel/storage/db';
import type { PluginContext, PromptContext, CatchupContext } from '$kernel/api';
import plugin, { ledgerApi, ledgerService, ymd, collectWeekly } from './index';
import { lastWeekRange, weekRange } from './ledger';

const pc = (addCard?: PromptContext['addCard']): PromptContext => ({ conversationId: 'cv1', characterId: 'c1', addCard });
const tool = (name: string) => plugin.tools!.find((t) => t.name === name)!;
const kv = new Map<string, unknown>();
const services = new Map<string, unknown>();

beforeAll(() => {
  openDB([plugin]);
  const ctx = {
    id: 'ledger',
    table: (n: string) => db().table(pluginTable('ledger', n)),
    settings: { get: async <T,>(k: string, d: T) => (kv.has(k) ? (kv.get(k) as T) : d), set: async (k: string, v: unknown) => { kv.set(k, v); } },
    emit() {},
    service: (name: string) => services.get(name),
  } as unknown as PluginContext;
  plugin.setup!(ctx);
});

describe('ledger tools', () => {
  it('ledger_add records in cents with a bill card, rejects words and bad dates', async () => {
    const cards: { tag: string; attrs: Record<string, string>; alt?: string }[] = [];
    const r = await tool('ledger_add').handler({ amount: 28, category: '交通', note: '打车' }, pc((tag, _b, attrs = {}, alt) => cards.push({ tag, attrs, alt })));
    expect(r).toContain('记上了：交通 ¥28（打车）');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.tag).toBe('bill');
    expect(cards[0]!.attrs).toMatchObject({ amount: '2800', category: '交通', note: '打车', date: ymd() });
    expect(cards[0]!.alt).toContain('交通 ¥28（打车）');
    const all = await ledgerApi.entries().toArray();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ amount: 2800, category: '交通', note: '打车', date: ymd(), source: 'tool' });

    expect(await tool('ledger_add').handler({ amount: '二十八', category: '餐饮' }, pc())).toContain('金额不对');
    expect(await tool('ledger_add').handler({ amount: 10, category: '餐饮', date: '昨天' }, pc())).toContain('日期不对');
    // 不认识的分类归其他
    await tool('ledger_add').handler({ amount: '32.5', category: '火星', note: '午饭' }, pc());
    expect((await ledgerApi.entries().toArray()).find((e) => e.note === '午饭')).toMatchObject({ amount: 3250, category: '其他' });
    expect(await ledgerApi.entries().count()).toBe(2);
  });

  it('ledger_query sums a range by category and ledger_delete removes by id', async () => {
    const w = weekRange();
    await tool('ledger_add').handler({ amount: 100, category: '餐饮', note: '聚餐', date: w.from }, pc());
    const r = String(await tool('ledger_query').handler({ category: '餐饮' }, pc()));
    expect(r).toContain('共 ¥100');
    expect(r).toContain('1 笔');
    const q = String(await tool('ledger_query').handler({}, pc()));
    expect(q).toContain(`共 ¥${(2800 + 3250 + 10000) / 100}`.replace('.5', '.50'));
    const id = /\[id ([0-9A-Z]+)\]/.exec(r)![1]!;
    expect(await tool('ledger_delete').handler({ id }, pc())).toContain('删掉了：餐饮 ¥100（聚餐）');
    expect(await tool('ledger_delete').handler({ id }, pc())).toContain('没有这一笔');
    expect(await ledgerApi.entries().count()).toBe(2);
    expect(await tool('ledger_query').handler({ from: '2000-01-01', to: '2000-01-31' }, pc())).toContain('没有记录');
  });

  it('service exposes month total and range', async () => {
    expect(await ledgerService.monthTotal()).toBe(2800 + 3250);
    expect((await ledgerService.range(ymd(), ymd())).length).toBe(2);
  });

  it('weekly catchup only fires early in the week with last-week records, once per week', async () => {
    const c = { characterId: 'c1', characterName: 'A', elapsedMs: 3 * 86400_000, days: 3, tier: 'days', elapsedText: '3 天' } as CatchupContext;
    // 用三月的一周，避开前面几条今天记的账
    const monday = new Date(2026, 2, 2), thursday = new Date(2026, 2, 5);
    // 上周没有记录：不提
    expect(await collectWeekly(c, monday)).toBeNull();
    await ledgerApi.add({ amount: 5000, category: '娱乐', note: '电影', date: '2026-02-28', source: 'manual' });
    await ledgerApi.add({ amount: 1200, category: '餐饮', note: '面', date: '2026-02-25', source: 'manual' });
    // 周四回来就不翻旧账了
    expect(await collectWeekly(c, thursday)).toBeNull();
    const item = await collectWeekly(c, monday);
    expect(item).not.toBeNull();
    expect(item!.label).toBe('上周花销');
    expect(item!.prompt).toContain('一共花了 ¥62，2 笔：娱乐 ¥50、餐饮 ¥12');
    expect(item!.prompt).toContain('02-28 娱乐 ¥50（电影）');
    expect((item!.schema as { required: string[] }).required).toEqual(['say']);
    await item!.apply({ say: '上周花了六十二' }, c);
    // 同一周不再提；下周一又会提（上周是这周）
    expect(await collectWeekly(c, monday)).toBeNull();
    expect(await collectWeekly(c, new Date(2026, 2, 3))).toBeNull();
    await ledgerApi.add({ amount: 800, category: '交通', note: '', date: '2026-03-04', source: 'manual' });
    expect((await collectWeekly(c, new Date(2026, 2, 9)))!.prompt).toContain('¥8');
    // 复盘的周小结开着：上周花销由它说，账本不再单独提；关了就照旧
    services.set('review', { weeklyEnabled: async () => true });
    expect(await collectWeekly(c, new Date(2026, 2, 9))).toBeNull();
    services.set('review', { weeklyEnabled: async () => false });
    expect(await collectWeekly(c, new Date(2026, 2, 9))).not.toBeNull();
    services.delete('review');
  });
});

describe('plugin shape', () => {
  it('registers the contributions the design promises', () => {
    expect(plugin.id).toBe('ledger');
    expect(plugin.tools!.map((t) => t.name)).toEqual(['ledger_add', 'ledger_query', 'ledger_delete']);
    expect(plugin.outputHandlers!.map((h) => h.tag)).toEqual(['bill']);
    expect(plugin.composerActions!.map((a) => a.id)).toEqual(['add']);
    expect(plugin.profileSections!.map((s) => s.id)).toEqual(['month']);
    expect(Object.keys(plugin.services!)).toEqual(['ledger']);
    expect(plugin.storage!.tables).toEqual({ entries: 'id, date, category' });
    expect(plugin.promptContributors![0]!.triggers).toContain('花了');
    expect(plugin.catchup![0]).toMatchObject({ id: 'weekly', tier: 'days' });
  });
});
