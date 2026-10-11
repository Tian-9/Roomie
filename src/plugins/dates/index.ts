import { definePlugin, gradients } from '$kernel/api';
import type { PluginContext, PromptContext, CatchupContext, CatchupItem } from '$kernel/api';
import { ulid } from 'ulid';
import Dates from './Dates.svelte';
import DateCard from './DateCard.svelte';
import DateSection from './DateSection.svelte';
import { isoDate, nextOccurrence, describe, daysText, nthText, dateLabel, compareByDays, validMonthDay, KINDS, KIND_LABEL, type DateEntry, type Kind, type Occurrence, type LunarResolver } from './dates';

export type { DateEntry, Kind, Occurrence } from './dates';
export interface DateRow { e: DateEntry; occ: Occurrence | null }

/** 桌面图标：蛋糕上一支蜡烛 */
export const ICON = { paths: ['M4 20h16', 'M5 13h14v7H5z', 'M5 16c1.5 0 1.5 1.5 3 1.5S9.5 16 11 16s1.5 1.5 3 1.5 1.5-1.5 3-1.5 1.5 1.5 2 1.5', 'M12 13V9', 'M12 6.5c-.8-.6-1.3-1.2-1.3-2 0-1 1.3-2.5 1.3-2.5s1.3 1.5 1.3 2.5c0 .8-.5 1.4-1.3 2z'], background: gradients.pink };
/** 几天以内算"快到了"：提示词里带上、主页上显示 */
export const SOON_DAYS = 7;

let ctx: PluginContext;

const table = () => ctx.table<DateEntry>('dates');

export const datesApi = {
  dates: table,
  /** 日程插件的农历服务；没开就 undefined，农历的日子算不出来 */
  lunar(): LunarResolver | undefined {
    return ctx.service<{ toLunar: LunarResolver }>('lunar')?.toLunar;
  },
  rows(entries: DateEntry[], today = isoDate()): DateRow[] {
    const lunar = this.lunar();
    return entries.map((e) => ({ e, occ: nextOccurrence(e, today, lunar) })).sort((a, b) => compareByDays(a.occ, b.occ) || a.e.createdAt - b.e.createdAt);
  },
  async all(today = isoDate()): Promise<DateRow[]> {
    return this.rows(await table().toArray(), today);
  },
  /** 几天内要到的（含今天），倒数日过了的不算 */
  async upcoming(within = SOON_DAYS, today = isoDate()): Promise<DateRow[]> {
    return (await this.all(today)).filter((r) => r.occ && r.occ.days >= 0 && r.occ.days <= within);
  },
  async add(input: Omit<DateEntry, 'id' | 'createdAt'>): Promise<{ entry: DateEntry; created: boolean }> {
    const title = input.title.trim().slice(0, 40);
    const dup = (await table().toArray()).find((e) => e.title === title && e.month === input.month && e.day === input.day && e.lunar === input.lunar);
    if (dup) return { entry: dup, created: false };
    const entry: DateEntry = { ...input, title, id: ulid(), createdAt: Date.now() };
    await table().add(entry);
    return { entry, created: true };
  },
  async update(id: string, patch: Partial<Omit<DateEntry, 'id' | 'createdAt'>>) {
    await table().update(id, patch);
  },
  async remove(id: string) { await table().delete(id); },
  /** 按 id 找，找不到按名字找 */
  async find(idOrTitle: string): Promise<DateEntry | undefined> {
    const key = idOrTitle.trim();
    if (!key) return undefined;
    const byId = await table().get(key);
    if (byId) return byId;
    const all = await table().toArray();
    return all.find((e) => e.title === key) ?? all.find((e) => e.title.includes(key) || key.includes(e.title));
  },
  /** 给提示词和别的插件：七天内的一行，没有就空串 */
  async summary(today = isoDate()): Promise<string> {
    const soon = await this.upcoming(SOON_DAYS, today);
    if (!soon.length) return '';
    return '纪念日：' + soon.map((r) => describe(r.e, r.occ)).join('；');
  },
};

const str = (v: unknown, max = 40) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isInteger(n) ? n : undefined;
};
const asKind = (v: unknown): Kind => (KINDS as string[]).includes(String(v)) ? (v as Kind) : 'anniversary';
const idLine = (r: DateRow) => `- [${r.e.id}] ${describe(r.e, r.occ)}，${KIND_LABEL[r.e.kind]}，${dateLabel(r.e)}`;

/** 聊天里卡片的内容：加那一刻的快照，之后删了也还能显示 */
export function cardBody(e: DateEntry, occ: Occurrence | null): string {
  return JSON.stringify({ id: e.id, title: e.title, kind: e.kind, label: dateLabel(e), ...(occ ? { days: occ.days, date: occ.date, nth: nthText(e.kind, occ.nth) } : {}) });
}
export function alt(e: DateEntry, occ: Occurrence | null): string {
  return `[${KIND_LABEL[e.kind]}：${e.title} · ${occ ? daysText(occ.days) : dateLabel(e)}]`;
}

/** 补发 · 依附档：今天或明天有日子，回消息时顺口提一句；每个日子每次只提一回 */
export async function collectSoon(_c: CatchupContext, today = isoDate()): Promise<CatchupItem | null> {
  const mentioned = await ctx.settings.get<Record<string, string>>('mentioned', {});
  const due = (await datesApi.upcoming(1, today)).filter((r) => mentioned[r.e.id] !== r.occ!.date);
  if (!due.length) return null;
  const list = due.map((r) => `${daysText(r.occ!.days)}是${r.e.title}（${KIND_LABEL[r.e.kind]}${r.occ!.nth ? '，' + nthText(r.e.kind, r.occ!.nth) : ''}）`).join('；');
  return {
    label: '纪念日',
    prompt: `${list}。回消息的时候顺口提一句，像记得这件事的朋友那样，是生日就祝一句或者问准备怎么过，别像日历提醒。提了就 mentioned 给 true；这次不合适提就给 false，下次再提。不是在回消息的话，想说的话放 say 里。`,
    schema: { type: 'object', additionalProperties: false, required: ['mentioned'], properties: { mentioned: { type: 'boolean' }, say: { type: 'string', description: '如果不是在回消息，这里放你想顺口说的那句；在回消息就留空' } } },
    async apply(out: unknown) {
      if ((out as { mentioned?: boolean } | undefined)?.mentioned === false) return;
      const next = { ...(await ctx.settings.get<Record<string, string>>('mentioned', {})) };
      for (const r of due) next[r.e.id] = r.occ!.date;
      await ctx.settings.set('mentioned', next);
    },
  };
}

export default definePlugin({
  id: 'dates',
  name: '纪念日',
  version: '0.1.0',
  description: '你说过的生日、纪念日、考试日他记得，快到了会提一句。农历生日也行。',
  app: { screen: Dates, icon: ICON },
  storage: { tables: { dates: 'id, month, day' } },
  promptContributors: [{
    id: 'soon',
    stable: () => '对方提到生日、纪念日、考试或出发这类日子，用 date_add 记下来（月、日按"现在是"那行换算；对方说农历就 lunar 给 true）。问还有几天、什么时候，用 date_list 查了再答。',
    volatile: () => datesApi.summary(),
  }],
  tools: [
    {
      name: 'date_add',
      label: '记个日子',
      description: '替对方记一个日子。kind：birthday 生日、anniversary 纪念日（每年都过）、countdown 倒数日（只有那一天，year 必填）。month、day 是数字；生日和纪念日的 year 是哪一年开始的，知道就给，能算几岁 / 几周年；农历的 lunar 给 true（倒数日不支持农历）。记完会在回复里带一张卡，不用复述。',
      inputSchema: {
        type: 'object', required: ['title', 'kind', 'month', 'day'],
        properties: {
          title: { type: 'string', description: '叫什么，如"妈妈生日""在一起""考研"' },
          kind: { type: 'string', enum: KINDS },
          month: { type: 'integer', minimum: 1, maximum: 12 }, day: { type: 'integer', minimum: 1, maximum: 31 },
          year: { type: 'integer', description: '生日 / 纪念日：开始的年份，可选；倒数日：那一天的年份，必填' },
          lunar: { type: 'boolean', description: '月、日是农历' },
        },
      },
      async handler(input: unknown, p: PromptContext) {
        const i = (input ?? {}) as Record<string, unknown>;
        const title = str(i.title);
        if (!title) return '要记什么？title 不能空。';
        const kind = asKind(i.kind);
        const month = int(i.month), day = int(i.day), year = int(i.year);
        const lunar = i.lunar === true && kind !== 'countdown';
        if (month === undefined || day === undefined || !validMonthDay(month, day, lunar)) return `月、日不对（收到 ${String(i.month)} 月 ${String(i.day)} 日${lunar ? '，农历' : ''}）。month 1–12，day 看那个月有几天。`;
        if (year !== undefined && (year < 1900 || year > 2100)) return 'year 要在 1900 到 2100 之间。';
        if (kind === 'countdown' && year === undefined) return '倒数日要给 year：是哪一年的那一天。';
        if (lunar && !datesApi.lunar()) return '现在算不了农历（日程没开）。先按公历记，或者让对方开一下日程。';
        const { entry, created } = await datesApi.add({ title, kind, month, day, lunar, source: 'tool', ...(year !== undefined ? { year } : {}) });
        const occ = nextOccurrence(entry, isoDate(), datesApi.lunar());
        if (!created) return `「${entry.title}」已经记过了：${describe(entry, occ)}。`;
        p.addCard?.('date', cardBody(entry, occ), {}, alt(entry, occ));
        return `记下了：${describe(entry, occ)}，${KIND_LABEL[entry.kind]}，${dateLabel(entry)}（id ${entry.id}）`;
      },
    },
    {
      name: 'date_list',
      label: '看日子',
      description: '列出对方记下的生日、纪念日和倒数日，按快到的排，带还有几天和第几个。对方问"还有几天""什么时候"时用。',
      inputSchema: { type: 'object', properties: {} },
      async handler() {
        const rows = await datesApi.all();
        if (!rows.length) return '还没记过任何日子。对方提到生日、纪念日可以用 date_add 记下。';
        return rows.slice(0, 30).map(idLine).join('\n');
      },
    },
    {
      name: 'date_remove',
      label: '删日子',
      description: '删掉一个记错的或不要了的日子。给 id（date_list 里有）或名字。',
      inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'id 或名字' } } },
      async handler(input: unknown) {
        const e = await datesApi.find(str((input as { id?: unknown })?.id, 60));
        if (!e) return '没找到这个日子。先 date_list 看看。';
        await datesApi.remove(e.id);
        return `删掉了：${e.title}（${dateLabel(e)}）`;
      },
    },
  ],
  outputHandlers: [{ tag: 'date', component: DateCard }],
  catchup: [{ id: 'soon', tier: 'attach', collect: (c) => collectSoon(c) }],
  profileSections: [{ id: 'next', label: '纪念日', component: DateSection }],
  /** 给别的插件（复盘）用：`upcoming(withinDays)` 几天内要到的日子，`summary()` 七天内的一行 */
  services: { dates: { upcoming: (n?: number) => datesApi.upcoming(n), summary: () => datesApi.summary() } },
  setup(c) { ctx = c; },
});
