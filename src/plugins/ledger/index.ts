import { definePlugin, gradients, icons } from '$kernel/api';
import type { PluginContext, PromptContext, CatchupContext } from '$kernel/api';
import { ulid } from 'ulid';
import { CATEGORIES, parseAmount, normalizeCategory, parseDate, ymd, weekRange, lastWeekRange, monthRange, sum, byCategory, yuan, summaryLine, isEarlyWeek, type Entry, type Category } from './ledger';
import Ledger from './Ledger.svelte';
import BillCard from './BillCard.svelte';
import AddEntry from './AddEntry.svelte';
import MonthSection from './MonthSection.svelte';

export type { Entry, Category } from './ledger';
export { CATEGORIES, yuan, ymd } from './ledger';

/**
 * 记账：聊天里说一句「午饭 32」他就记上了；账本按天看流水，他知道你这周花了多少，
 * 新一周回来顺口提一句上周花销。金额整数分，日期 YYYY-MM-DD，自然语言由模型翻成数字，这里只校验。
 */
let ctx: PluginContext;

export const ledgerApi = {
  entries: () => ctx.table<Entry>('entries'),
  /** [from, to] 含两端，按日期索引取 */
  range(from: string, to: string) {
    return this.entries().where('date').between(from, to, true, true).toArray();
  },
  async add(e: { amount: number; category: Category; note: string; date: string; source: Entry['source'] }) {
    const entry: Entry = { id: ulid(), ...e, note: e.note.trim().slice(0, 60), ts: Date.now() };
    await this.entries().add(entry);
    ctx.emit('ledger.added', { id: entry.id, amount: entry.amount, category: entry.category });
    return entry;
  },
  async remove(id: string) {
    const e = await this.entries().get(id);
    if (!e) return false;
    await this.entries().delete(id);
    ctx.emit('ledger.removed', { id });
    return true;
  },
  async weekTotal(date = ymd()) { const { from, to } = weekRange(date); return sum(await this.range(from, to)); },
  async monthTotal(date = ymd()) { const { from, to } = monthRange(date); return sum(await this.range(from, to)); },
};

/**
 * 给别的插件用的服务：`ctx.service<LedgerService>('ledger')`。复盘插件拿昨天花了多少用这个。
 * 调用方自己声明一个一样形状的最小接口；金额都是分。
 */
export interface LedgerService {
  /** 本月合计（分） */
  monthTotal(): Promise<number>;
  /** 某段日期（YYYY-MM-DD，含两端）的记录 */
  range(from: string, to: string): Promise<Entry[]>;
}
export const ledgerService: LedgerService = {
  monthTotal: () => ledgerApi.monthTotal(),
  range: (from, to) => ledgerApi.range(from, to),
};

const describe = (e: Entry) => `${e.category} ${yuan(e.amount)}${e.note ? '（' + e.note + '）' : ''}`;
const billAlt = (e: Entry) => `[记了一笔账：${describe(e)}，${e.date}]`;

/** 补发 · 上周花销：离开 ≥ 2 天、新一周刚开始（周一到周三）回来，上周有记录且这周还没说过 */
export async function collectWeekly(_c: CatchupContext, now = new Date()) {
  if (!isEarlyWeek(now)) return null;
  // 复盘插件的周小结开着的话，上周花销由它一起说，这里不再单独提一遍
  const review = ctx.service<{ weeklyEnabled(): Promise<boolean> }>('review');
  if (review && (await review.weeklyEnabled().catch(() => false))) return null;
  const week = weekRange(ymd(now)).from;
  if ((await ctx.settings.get<string>('weeklySaid', '')) === week) return null;
  const { from, to } = lastWeekRange(ymd(now));
  const xs = await ledgerApi.range(from, to);
  if (!xs.length) return null;
  const cats = byCategory(xs).map((c) => `${c.category} ${yuan(c.amount)}`).join('、');
  const big = [...xs].sort((a, b) => b.amount - a.amount).slice(0, 3).map((e) => `${e.date.slice(5)} ${describe(e)}`).join('；');
  const prevWeek = lastWeekRange(from);
  const prev = sum(await ledgerApi.range(prevWeek.from, prevWeek.to));
  return {
    label: '上周花销',
    prompt: `上周（${from} 到 ${to}）对方一共花了 ${yuan(sum(xs))}，${xs.length} 笔：${cats}。最大的几笔：${big}。${prev ? `再上一周花了 ${yuan(prev)}。` : ''}\n用你平时的口气顺口提一句上周的花销（一两句话，带上总数，可以点一下花得多的地方或者比上周多还是少），放在 say 里。不想提就留空。`,
    schema: { type: 'object', additionalProperties: false, required: ['say'], properties: { say: { type: 'string', description: '顺口提一句上周花销，不想提留空' } } },
    async apply(_out: unknown, _cc: CatchupContext) {
      await ctx.settings.set('weeklySaid', week);
    },
  };
}

export default definePlugin({
  id: 'ledger',
  name: '账本',
  version: '0.1.0',
  description: '聊天里说一句「午饭 32」他就记上了。账本按天看流水，他知道你这周花了多少，新一周回来会提一句上周花销。',
  app: { screen: Ledger, icon: { paths: icons.receipt, background: gradients.green } },
  storage: { tables: { entries: 'id, date, category' } },
  composerActions: [{ id: 'add', label: '记一笔', icon: { paths: icons.receipt, background: gradients.green }, component: AddEntry }],
  profileSections: [{ id: 'month', label: '账本', component: MonthSection }],
  outputHandlers: [{ tag: 'bill', component: BillCard }],
  services: { ledger: ledgerService },
  promptContributors: [{
    id: 'week',
    triggers: ['花了', '买了', '多少钱', '块', '元', '账', '钱', '付了', '消费', '花费', '开销', '记一笔', '预算'],
    async volatile(_p: PromptContext) {
      const d = ymd();
      const { from, to } = weekRange(d);
      const week = await ledgerApi.range(from, to);
      const today = week.filter((e) => e.date === d);
      const month = await ledgerApi.monthTotal(d);
      return `<账本>\n${summaryLine('本周', week)}；今天 ${today.length ? yuan(sum(today)) : '还没花'}；本月合计 ${yuan(month)}。记账用 ledger_add，查用 ledger_query。\n</账本>`;
    },
  }],
  tools: [{
    name: 'ledger_add',
    label: '记一笔',
    description: '对方说花了钱（「午饭 32」「刚打车花了 28」「买了件衣服 199」）就替他记一笔。amount 是元，必须是数字，自己把「二十八」翻成 28；category 从 餐饮/交通/购物/居住/娱乐/其他 里选；note 是一两个词的备注（午饭、打车、T恤）；不是今天花的才给 date（YYYY-MM-DD）。记完对话里会有一张账单卡，不用再复述金额。',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: '元，数字' },
        category: { type: 'string', enum: [...CATEGORIES] },
        note: { type: 'string', description: '备注，一两个词' },
        date: { type: 'string', description: 'YYYY-MM-DD，默认今天' },
      },
      required: ['amount', 'category'],
    },
    async handler(input: unknown, p: PromptContext) {
      const i = input as { amount?: unknown; category?: unknown; note?: unknown; date?: unknown };
      const amount = parseAmount(i?.amount);
      if (amount === null) return '金额不对：amount 得是正数（元），把中文数字翻成数字再试。';
      const date = i?.date == null || i.date === '' ? ymd() : parseDate(i.date);
      if (!date) return '日期不对：date 要是 YYYY-MM-DD。';
      const e = await ledgerApi.add({ amount, category: normalizeCategory(i?.category), note: String(i?.note ?? ''), date, source: 'tool' });
      p.addCard?.('bill', JSON.stringify({ id: e.id }), { amount: String(e.amount), category: e.category, note: e.note, date: e.date }, billAlt(e));
      const week = await ledgerApi.weekTotal();
      return `记上了：${describe(e)}，${e.date}。本周已花 ${yuan(week)}。账单卡已在对话里，不用再报金额。`;
    },
  }, {
    name: 'ledger_query',
    label: '查账',
    description: '查某段时间花了多少。from、to 是 YYYY-MM-DD（含两端），不给就是本周；category 可选。返回合计、分类汇总和最近最多 20 笔（带 id，删账用 ledger_delete 要这个 id）。',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
        category: { type: 'string', enum: [...CATEGORIES] },
      },
    },
    async handler(input: unknown) {
      const i = input as { from?: unknown; to?: unknown; category?: unknown };
      const w = weekRange();
      const from = i?.from ? parseDate(i.from) : w.from;
      const to = i?.to ? parseDate(i.to) : w.to;
      if (!from || !to) return '日期不对：from、to 要是 YYYY-MM-DD。';
      let xs = await ledgerApi.range(from, to);
      if (i?.category) { const c = normalizeCategory(i.category); xs = xs.filter((e) => e.category === c); }
      if (!xs.length) return `${from} 到 ${to}${i?.category ? '的' + normalizeCategory(i.category) : ''}没有记录。`;
      const cats = byCategory(xs).map((c) => `${c.category} ${yuan(c.amount)}`).join('、');
      const lines = [...xs].sort((a, b) => (a.date === b.date ? b.ts - a.ts : a.date < b.date ? 1 : -1)).slice(0, 20)
        .map((e) => `- ${e.date} ${describe(e)} [id ${e.id}]`);
      return `${from} 到 ${to}：共 ${yuan(sum(xs))}，${xs.length} 笔。${cats}\n${lines.join('\n')}`;
    },
  }, {
    name: 'ledger_delete',
    label: '删一笔',
    description: '删掉记错的一笔。要 id，先用 ledger_query 查到那一笔的 id。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async handler(input: unknown) {
      const id = String((input as { id?: unknown })?.id ?? '').trim();
      const e = id ? await ledgerApi.entries().get(id) : undefined;
      if (!e) return '没有这一笔，先用 ledger_query 查 id。';
      await ledgerApi.remove(id);
      return `删掉了：${describe(e)}，${e.date}。`;
    },
  }],
  catchup: [{ id: 'weekly', tier: 'days', collect: (c) => collectWeekly(c) }],
  setup(c) { ctx = c; },
});
