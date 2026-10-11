import { definePlugin, gradients } from '$kernel/api';
import type { PluginContext, PromptContext, CatchupContext, CatchupItem } from '$kernel/api';
import { ulid } from 'ulid';
import Schedule from './Schedule.svelte';
import EventCard from './EventCard.svelte';
import AddEvent from './AddEvent.svelte';
import NextSection from './NextSection.svelte';
import { isoDate, parseDate, normalizeTime, addDays, atTime, whenLabel, weekday, shortDate } from './dates';
import { toLunar, lunarFestival } from './lunar';
import { dayInfo, dayLine, nextHoliday, holidayOf } from './holidays';
import { feeds } from './feeds';
import Calendars from './Calendars.svelte';

export { feeds, type Feed, type FeedSettings, type SyncResult } from './feeds';

/**
 * 一条日程。有 time 的是"几点有事"，没有的是当天待办。done 用 0/1 而不是布尔，IndexedDB 不能给布尔建索引。
 * remindAt 是到点提醒的时刻（有 time 才有）；notifiedAt 前台弹过了；notedAt 他在补发里提过了（错过的事不反复念叨）。
 * source 为 calendar 的是订阅日历来的：feedId 是哪个订阅，feedKey 是日历里的 UID + 这一次的开始时刻，同步时按它认人；
 * 它们不是待办，过了就过了，不进"过期"。
 */
export interface ScheduleItem {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  time?: string;
  done: 0 | 1;
  doneAt?: number;
  remindAt?: number;
  notifiedAt?: number;
  notedAt?: number;
  createdAt: number;
  source: 'tool' | 'manual' | 'calendar';
  feedId?: string;
  feedKey?: string;
  /** 日历里的全天事件（没 time 的手记是待办，这个不是） */
  allDay?: 1;
  /** HH:mm，日历事件同一天内的结束时间 */
  endTime?: string;
  place?: string;
}

/** 订阅来的日历事件不是待办：过了日子就不算"过期没做" */
export const isOpenTodo = (i: ScheduleItem, today: string) => !i.done && (i.date >= today || i.source !== 'calendar');

export const ICON = { paths: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4M16 3v4'], background: gradients.red };
/** 到点后这么久以内回到前台还会弹；再久就不弹了，留给补发去提 */
export const LATE_WINDOW = 30 * 60_000;
const TICK = 30_000;
/** 打开后隔这么久再去拉订阅的日历，别和聊天、补发抢 */
const FEED_DELAY = 4000;

let ctx: PluginContext;
let stopTimer: (() => void) | null = null;

const table = () => ctx.table<ScheduleItem>('items');

export const scheduleApi = {
  items: table,
  async range(from: string, to: string): Promise<ScheduleItem[]> {
    const rows = await table().where('date').between(from, to, true, true).toArray();
    return sortItems(rows);
  },
  /** 今天的（含过期未完成的） */
  async today(today = isoDate()): Promise<ScheduleItem[]> {
    const rows = await table().where('date').belowOrEqual(today).filter((i) => i.date === today || isOpenTodo(i, today)).toArray();
    return sortItems(rows);
  },
  /** 接下来几件没完成的 */
  async upcoming(limit = 5, today = isoDate()): Promise<ScheduleItem[]> {
    const rows = await table().where('date').aboveOrEqual(today).filter((i) => !i.done).toArray();
    return sortItems(rows).slice(0, limit);
  },
  async add(input: { title: string; date: string; time?: string | null; source: ScheduleItem['source'] }): Promise<ScheduleItem> {
    const time = input.time ? normalizeTime(input.time) : null;
    const item: ScheduleItem = {
      id: ulid(), title: input.title.trim().slice(0, 80), date: input.date, done: 0, createdAt: Date.now(), source: input.source,
      ...(time ? { time, remindAt: atTime(input.date, time) } : {}),
    };
    await table().add(item);
    ctx.emit('schedule.added', { id: item.id });
    return item;
  },
  async setDone(id: string, done: boolean) {
    await table().update(id, done ? { done: 1, doneAt: Date.now() } : { done: 0, doneAt: undefined });
  },
  /** 删一条。订阅来的删了会记住，下次同步不再加回来 */
  async remove(id: string) {
    const row = await table().get(id);
    if (row?.source === 'calendar') await feeds.hide(row);
    else await table().delete(id);
  },
  /** 按 id 找，找不到按标题找（没做完的优先） */
  async find(idOrTitle: string): Promise<ScheduleItem | undefined> {
    const key = idOrTitle.trim();
    if (!key) return undefined;
    const byId = await table().get(key);
    if (byId) return byId;
    const all = sortItems(await table().filter((i) => i.title.includes(key) || key.includes(i.title)).toArray());
    return all.find((i) => !i.done) ?? all[0];
  },
  /**
   * 前台定时：到点的提醒弹出来。只看今天的；到点超过半小时才看到的就不弹了（标记掉，留给补发）。
   */
  async tick(now = Date.now()) {
    const today = isoDate(new Date(now));
    const due = await table().where('date').equals(today).filter((i) => !i.done && !!i.remindAt && i.remindAt <= now && !i.notifiedAt).toArray();
    for (const i of due) {
      await table().update(i.id, { notifiedAt: now });
      if (now - i.remindAt! > LATE_WINDOW) continue;
      ctx.notify(i.title, `${i.time} · 到点了`, 'app');
      systemNotify(i);
    }
    return due;
  },
};

export function sortItems(rows: ScheduleItem[]): ScheduleItem[] {
  return rows.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '99').localeCompare(b.time ?? '99') || a.createdAt - b.createdAt);
}

/** 浏览器通知：页面开着才有用，权限在日程界面里申请 */
function systemNotify(i: ScheduleItem) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(i.title, { body: `${i.time} · 到点了`, tag: `schedule-${i.id}` });
  } catch { /* 有的浏览器（iOS）构造会抛 */ }
}

/** 给模型看的一行：- [id] 明天 15:00 开会 */
export function describeItem(i: ScheduleItem, today = isoDate()): string {
  return `- [${i.id}] ${whenLabel(i.date, i.time, today)}${i.endTime ? '–' + i.endTime : ''} ${i.title}${i.place ? '（' + i.place + '）' : ''}${i.done ? '（已完成）' : i.date < today && i.source !== 'calendar' ? '（过期没做）' : ''}`;
}
export function alt(i: ScheduleItem, today = isoDate()): string {
  return `[日程] ${whenLabel(i.date, i.time, today)} ${i.title}`;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function arm() {
  stopTimer?.();
  if (typeof window === 'undefined') return;
  const t = setInterval(() => scheduleApi.tick().catch(() => {}), TICK);
  stopTimer = () => clearInterval(t);
}

/** 补发 · 依附档：今天还有什么，回消息时顺口提一句，一天提一次 */
async function collectToday(_c: CatchupContext): Promise<CatchupItem | null> {
  const today = isoDate();
  if ((await ctx.settings.get('mentioned', '')) === today) return null;
  const items = (await scheduleApi.today(today)).filter((i) => !i.done);
  if (!items.length) return null;
  const now = Date.now();
  const left = items.filter((i) => !i.remindAt || i.remindAt > now - LATE_WINDOW);
  if (!left.length) return null;
  return {
    label: '今天的安排',
    prompt: `对方今天还有：${left.map((i) => (i.date < today ? `${i.title}（${whenLabel(i.date, i.time, today)}，还没做）` : i.time ? `${i.time} ${i.title}${i.place ? '（' + i.place + '）' : ''}` : i.allDay ? `${i.title}（全天）` : `${i.title}（待办）`)).join('、')}。回消息的时候顺口带一句，像朋友随口提醒，不要列清单，不用每条都提。提了就 mentioned 给 true，这次不合适提就给 false。不是在回消息的话，想说的那句放 say 里。`,
    schema: { type: 'object', additionalProperties: false, required: ['mentioned'], properties: { mentioned: { type: 'boolean' }, say: { type: 'string', description: '如果不是在回消息，这里放你想顺口说的那句；在回消息就留空' } } },
    async apply(out: unknown) {
      if ((out as { mentioned?: boolean } | undefined)?.mentioned !== false) await ctx.settings.set('mentioned', today);
    },
  };
}

/** 补发 · h6 档：你走开这几小时里到点了的事 */
async function collectMissed(c: CatchupContext): Promise<CatchupItem | null> {
  const now = Date.now();
  const from = now - c.elapsedMs;
  const today = isoDate();
  const rows = await table().where('date').between(isoDate(new Date(from)), today, true, true)
    .filter((i) => !i.done && !i.notedAt && !!i.remindAt && i.remindAt >= from && i.remindAt <= now).toArray();
  const items = sortItems(rows);
  if (!items.length) return null;
  return {
    label: '错过的安排',
    prompt: `对方走开的这${c.elapsedText}里，这些事到点了：${items.map((i) => `${whenLabel(i.date, i.time, today)} ${i.title}`).join('、')}。不知道他做没做。想问一句怎么样了就写在 say 里（一两句，口语）；不想提就留空。`,
    schema: { type: 'object', additionalProperties: false, required: ['say'], properties: { say: { type: 'string', description: '想跟对方说的话，不说留空' } } },
    async apply() {
      for (const i of items) await table().update(i.id, { notedAt: now });
    },
  };
}

export default definePlugin({
  id: 'schedule',
  name: '日程',
  version: '0.1.0',
  description: '说一句"明天下午三点开会"他就记下来；打开手机时他提一句今天有什么，页面开着到点会弹提醒。带待办和节假日，能订阅 Google 日历。',
  app: { screen: Schedule, icon: ICON },
  screens: { calendars: Calendars },
  storage: { tables: { items: 'id, date, done' } },
  promptContributors: [{
    id: 'agenda',
    triggers: ['明天', '后天', '今天', '周', '号', '点', '提醒', '日程', '待办', '安排', '下午', '上午', '晚上', '早上', '约', '有空', '放假', '节'],
    stable: () => '对方说到要做的事、约了几点，就用 schedule_add 记下来，日期按"现在是"那行换算成 YYYY-MM-DD，几点用 HH:mm，没说几点就不给时间。问起有什么安排、几号放假，用 schedule_list 查了再答。日程里有些是从对方的日历订阅来的，改不了也删不了，他要改就让他去日历里改。',
    async volatile(_p: PromptContext) {
      const today = isoDate();
      const info = dayInfo(today);
      const head = `今天 ${today} ${weekday(today)}${info.lunar ? `，农历${info.lunar}` : ''}${info.holiday ? `，${info.holiday}放假中` : info.festival ? `，${info.festival}` : ''}`;
      const [td, tm] = await Promise.all([scheduleApi.today(today), scheduleApi.range(addDays(today, 1), addDays(today, 1))]);
      const fmt = (i: ScheduleItem) => `${i.time ? i.time + ' ' : i.allDay ? '全天 ' : ''}${i.title}${i.place ? '（' + i.place + '）' : ''}${i.done ? '（已完成）' : i.date < today ? '（' + whenLabel(i.date, i.time, today) + '，过期没做）' : ''}`;
      const week = (await scheduleApi.range(addDays(today, 2), addDays(today, 7))).filter((i) => !i.done);
      const h = nextHoliday(today);
      const lines = [head];
      lines.push(`今天：${td.length ? td.map(fmt).join('、') : '没有记下的安排'}`);
      if (tm.length) lines.push(`明天：${tm.map(fmt).join('、')}`);
      if (week.length) lines.push(`之后一周：${week.map((i) => `${whenLabel(i.date, i.time, today)} ${i.title}`).join('、')}`);
      if (h && h.from > today) lines.push(`下个假期：${h.name} ${shortDate(h.from)} 起${h.tentative ? '（安排还没公布，预估）' : ''}`);
      return `<日程>\n${lines.join('\n')}\n</日程>`;
    },
  }],
  tools: [
    {
      name: 'schedule_add',
      label: '记日程',
      description: '替对方记一条日程或待办。date 必须是 YYYY-MM-DD；time 是 HH:mm（24 小时制），没说几点就不传，那就是当天的待办。记完会在回复里带一张日程卡，不用再复述内容。',
      inputSchema: {
        type: 'object', required: ['title', 'date'],
        properties: { title: { type: 'string', description: '一句话，如"开会""和小李吃饭"' }, date: { type: 'string', description: 'YYYY-MM-DD' }, time: { type: 'string', description: 'HH:mm，可选' } },
      },
      async handler(input: unknown, p: PromptContext) {
        const i = (input ?? {}) as Record<string, unknown>;
        const title = str(i.title).slice(0, 80);
        if (!title) return '要记什么？标题不能空。';
        if (!parseDate(i.date)) return `日期要是 YYYY-MM-DD 格式，收到的是「${str(i.date) || '空'}」。今天是 ${isoDate()}。`;
        if (i.time !== undefined && i.time !== null && str(i.time) !== '' && !normalizeTime(i.time)) return `时间要是 HH:mm 格式，收到的是「${str(i.time)}」。`;
        const item = await scheduleApi.add({ title, date: i.date as string, time: str(i.time) || null, source: 'tool' });
        p.addCard?.('event', JSON.stringify({ id: item.id }), {}, alt(item));
        return `记下了：${whenLabel(item.date, item.time)} ${item.title}（id ${item.id}）`;
      },
    },
    {
      name: 'schedule_list',
      label: '查日程',
      description: '查对方的日程和待办。from、to 都是 YYYY-MM-DD，不给就是今天起一周；过期没做的也会列出来。顺便给出区间里的节假日。',
      inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
      async handler(input: unknown) {
        const i = (input ?? {}) as Record<string, unknown>;
        const today = isoDate();
        const from = parseDate(i.from) ? (i.from as string) : today;
        const to = parseDate(i.to) ? (i.to as string) : addDays(from, 6);
        const rows = await scheduleApi.range(from, to);
        const overdue = from <= today ? (await scheduleApi.today(today)).filter((x) => x.date < today && isOpenTodo(x, today)) : [];
        const all = sortItems([...overdue, ...rows.filter((r) => !overdue.some((o) => o.id === r.id))]).slice(0, 30);
        const hol: string[] = [];
        for (let d = from, n = 0; d <= to && n < 400; d = addDays(d, 1), n++) {
          const h = holidayOf(d);
          if (h && h.from === d) hol.push(`${h.name} ${shortDate(h.from)}${h.to !== h.from ? '–' + shortDate(h.to) : ''}${h.tentative ? '（预估）' : ''}`);
          else if (h === undefined) { const f = dayInfo(d); if (f.workday) hol.push(`${shortDate(d)} 调休上班`); }
        }
        return [
          `${from} 到 ${to}：${all.length ? '' : '没有记下的安排。'}`,
          ...all.map((x) => describeItem(x, today)),
          hol.length ? `假期：${hol.join('；')}` : '',
        ].filter(Boolean).join('\n');
      },
    },
    {
      name: 'schedule_done',
      label: '勾掉日程',
      description: '把一条日程或待办标成完成。给 id（schedule_list 里有）；没有 id 可以给标题。',
      inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'id 或标题' } } },
      async handler(input: unknown) {
        const item = await scheduleApi.find(str((input as { id?: unknown })?.id));
        if (!item) return '没找到这条。先 schedule_list 看看。';
        await scheduleApi.setDone(item.id, true);
        return `完成了：${item.title}`;
      },
    },
    {
      name: 'schedule_remove',
      label: '删日程',
      description: '删掉一条日程或待办（对方说不去了、取消了）。给 id 或标题。',
      inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'id 或标题' } } },
      async handler(input: unknown) {
        const item = await scheduleApi.find(str((input as { id?: unknown })?.id));
        if (!item) return '没找到这条。先 schedule_list 看看。';
        await scheduleApi.remove(item.id);
        return item.source === 'calendar' ? `这里不显示了：${whenLabel(item.date, item.time)} ${item.title}（它是日历订阅来的，日历里还在）` : `删掉了：${whenLabel(item.date, item.time)} ${item.title}`;
      },
    },
  ],
  outputHandlers: [{ tag: 'event', component: EventCard }],
  composerActions: [{ id: 'add', label: '记个日程', icon: ICON, component: AddEvent }],
  profileSections: [{ id: 'next', label: '日程', component: NextSection }],
  catchup: [
    { id: 'today', tier: 'attach', collect: collectToday },
    { id: 'missed', tier: 'h6', collect: collectMissed },
  ],
  /**
   * 服务：
   * - schedule: { today(), range(from, to), upcoming(limit) } 返回 ScheduleItem[]，复盘插件拿"今天有什么"用
   * - lunar: { toLunar(iso), lunarFestival(l), dayInfo(iso), dayLine(iso), nextHoliday(iso) } 纪念日插件算农历生日用
   */
  services: {
    schedule: { today: () => scheduleApi.today(), range: (from: string, to: string) => scheduleApi.range(from, to), upcoming: (n?: number) => scheduleApi.upcoming(n) },
    lunar: { toLunar, lunarFestival, dayInfo, dayLine, nextHoliday },
  },
  onEvent: {
    // 回到前台：定时器可能被浏览器掐了，重新对表，顺便把刚到点的弹出来；订阅的日历过了间隔就在后台拉一次
    'app.resumed': () => { if (ctx) { arm(); scheduleApi.tick().catch(() => {}); feeds.later(FEED_DELAY); } },
  },
  setup(c) { ctx = c; feeds.init(c, table); arm(); feeds.later(FEED_DELAY); },
  teardown() { stopTimer?.(); stopTimer = null; feeds.stop(); },
});
