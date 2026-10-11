import { definePlugin, gradients } from '$kernel/api';
import type { PluginContext, PromptContext, CatchupContext } from '$kernel/api';
import { ulid } from 'ulid';
import Habits from './Habits.svelte';
import CheckCard from './CheckCard.svelte';
import HabitSection from './HabitSection.svelte';
import { streak, today, isYmd, describe, CADENCES, CADENCE_LABEL, type Cadence, type Streak } from './streak';

export interface Habit {
  id: string;
  name: string;
  cadence: Cadence;
  createdAt: number;
  /** IndexedDB 不能索引布尔值，用 0 / 1 */
  archived: 0 | 1;
}
export interface Check {
  id: string;
  habitId: string;
  /** YYYY-MM-DD，本地日期 */
  date: string;
  ts: number;
  source: 'tool' | 'manual';
}
export interface HabitStatus { habit: Habit; dates: Set<string>; s: Streak }

/** 桌面图标：圆圈里一个勾 */
export const HABIT_ICON = { paths: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'm8 12 3 3 5-6'], background: gradients.green };
/** 晚上几点以后他才会问今天打卡了没 */
export const ASK_AFTER_HOUR = 20;

let ctx: PluginContext;

export const habitsApi = {
  habits: () => ctx.table<Habit>('habits'),
  checks: () => ctx.table<Check>('checks'),
  async active(): Promise<Habit[]> {
    return (await this.habits().where('archived').equals(0).toArray()).sort((a, b) => a.createdAt - b.createdAt);
  },
  /** 按名字找：先全等，再包含（「跑」能找到「跑步」，「跑步打卡」也能找到「跑步」） */
  async find(name: string): Promise<Habit | undefined> {
    const q = name.trim().toLowerCase();
    if (!q) return undefined;
    const all = await this.active();
    return all.find((h) => h.name.toLowerCase() === q) ?? all.find((h) => h.name.toLowerCase().includes(q) || q.includes(h.name.toLowerCase()));
  },
  async add(name: string, cadence: Cadence): Promise<{ habit: Habit; created: boolean }> {
    const n = name.trim().slice(0, 30);
    const dup = (await this.active()).find((h) => h.name === n);
    if (dup) return { habit: dup, created: false };
    const habit: Habit = { id: ulid(), name: n, cadence, createdAt: Date.now(), archived: 0 };
    await this.habits().add(habit);
    return { habit, created: true };
  },
  async update(id: string, patch: Partial<Pick<Habit, 'name' | 'cadence' | 'archived'>>) {
    await this.habits().update(id, patch);
  },
  /** 连打卡记录一起删 */
  async remove(id: string) {
    await this.checks().where('habitId').equals(id).delete();
    await this.habits().delete(id);
  },
  async datesOf(habitId: string): Promise<Set<string>> {
    return new Set((await this.checks().where('habitId').equals(habitId).toArray()).map((c) => c.date));
  },
  async statusOf(habit: Habit, date = today()): Promise<HabitStatus> {
    const dates = await this.datesOf(habit.id);
    return { habit, dates, s: streak(habit.cadence, dates, date) };
  },
  async status(date = today()): Promise<HabitStatus[]> {
    return Promise.all((await this.active()).map((h) => this.statusOf(h, date)));
  },
  /** 打卡；同一天重复打不重复记 */
  async check(habit: Habit, date: string, source: Check['source']): Promise<{ created: boolean; s: Streak }> {
    const dates = await this.datesOf(habit.id);
    const created = !dates.has(date);
    if (created) {
      await this.checks().add({ id: ulid(), habitId: habit.id, date, ts: Date.now(), source });
      dates.add(date);
    }
    return { created, s: streak(habit.cadence, dates, today()) };
  },
  async uncheck(habitId: string, date: string) {
    await this.checks().where('habitId').equals(habitId).filter((c) => c.date === date).delete();
  },
  /** 一行摘要，给提示词和别的插件：「习惯：跑步连续 12 天（今天未打卡）、早睡连续 3 天」；没有习惯就空串 */
  async summary(date = today()): Promise<string> {
    const all = await this.status(date);
    if (!all.length) return '';
    return '习惯：' + all.map(({ habit, s }) => describe(habit.name, s)).join('、');
  },
  /** 今天该打还没打的 */
  async pending(date = today()): Promise<HabitStatus[]> {
    return (await this.status(date)).filter(({ s }) => s.dueToday && !s.donePeriod);
  },
};

const str = (v: unknown, max = 60) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const asCadence = (v: unknown): Cadence => (CADENCES as string[]).includes(String(v)) ? (v as Cadence) : 'daily';
const nth = (s: Streak) => s.unit === '周' ? `连续 ${s.count} 周` : `第 ${s.count} 天`;

/** 补发 · 晚上问一句：今天该打卡还没打的习惯，挂在下一次回复上顺口问，一天最多问一次 */
export async function collectAsk(_c: CatchupContext, now = new Date()) {
  if (now.getHours() < ASK_AFTER_HOUR) return null;
  const date = today(now);
  if ((await ctx.settings.get('askedOn', '')) === date) return null;
  const pending = await habitsApi.pending(date);
  if (!pending.length) return null;
  const names = pending.map(({ habit, s }) => `${habit.name}（${s.count ? `已连续 ${s.count} ${s.unit}` : '刚开始'}）`).join('、');
  return {
    label: '习惯打卡',
    prompt: `对方想坚持的事里，今天还没打卡的有：${names}。现在是晚上，回消息时顺口问一句今天做了没，像朋友随口一提，别说教、别催。做了的话他会告诉你，你再用 habit_check 记上。不想提就 asked 填 false。`,
    schema: { type: 'object', additionalProperties: false, required: ['asked'], properties: { asked: { type: 'boolean', description: '这次有没有问' }, say: { type: 'string', description: '如果不是在回消息，这里放你想顺口问的那句；在回消息就留空' } } },
    async apply(out: unknown, _cc: CatchupContext) {
      const asked = (out as { asked?: unknown } | undefined)?.asked;
      if (asked !== false) await ctx.settings.set('askedOn', date);
    },
  };
}

export default definePlugin({
  id: 'habits',
  name: '习惯',
  version: '0.1.0',
  description: '定几件想坚持的事，他记得问、记得夸，连续天数在他主页上看得到。',
  app: { screen: Habits, icon: HABIT_ICON },
  storage: { tables: { habits: 'id, archived', checks: 'id, habitId, date' } },
  promptContributors: [{
    id: 'streaks',
    triggers: ['打卡', '坚持', '习惯', '跑', '健身', '早睡', '早起', '戒', '做了', '完成'],
    volatile: () => habitsApi.summary(),
  }],
  tools: [{
    name: 'habit_add',
    label: '加习惯',
    description: '替对方加一件想坚持的事。cadence：daily 每天、weekdays 工作日、weekly 每周一次。对方说「我想每天跑步」「帮我记着每周读书」时用。已有同名的不会重复加。',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: '习惯名，短，如「跑步」「早睡」' }, cadence: { type: 'string', enum: CADENCES } }, required: ['name'] },
    async handler(input: unknown) {
      const i = input as { name?: unknown; cadence?: unknown } | undefined;
      const name = str(i?.name, 30);
      if (!name) return '要加什么习惯？name 不能为空。';
      const { habit, created } = await habitsApi.add(name, asCadence(i?.cadence));
      return created ? `已加：${habit.name}（${CADENCE_LABEL[habit.cadence]}）。对方做了就用 habit_check 打卡。` : `「${habit.name}」已经有了（${CADENCE_LABEL[habit.cadence]}），不用重复加。`;
    },
  }, {
    name: 'habit_check',
    label: '打卡',
    description: '对方说今天做了某件坚持的事（「今天跑了」「刚健完身」）就替他打卡。name 是习惯名，date 不给就是今天，补昨天的给 YYYY-MM-DD。返回连续天数，回复里可以顺口夸一句。',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD，默认今天' } }, required: ['name'] },
    async handler(input: unknown, p: PromptContext) {
      const i = input as { name?: unknown; date?: unknown } | undefined;
      const name = str(i?.name, 30);
      const habit = await habitsApi.find(name);
      if (!habit) {
        const all = await habitsApi.active();
        return all.length ? `没有叫「${name}」的习惯。现有的：${all.map((h) => h.name).join('、')}。要加新的用 habit_add。` : `还没有任何习惯。先用 habit_add 加一个「${name}」。`;
      }
      const td = today();
      const date = str(i?.date, 10) || td;
      if (!isYmd(date)) return `日期要写成 YYYY-MM-DD，比如 ${td}。`;
      if (date > td) return '不能给未来的日子打卡。';
      const { created, s } = await habitsApi.check(habit, date, 'tool');
      if (!created) return `${habit.name} ${date === td ? '今天' : date} 已经打过卡了，${describe(habit.name, s)}。`;
      p.addCard?.('check', JSON.stringify({ habitId: habit.id, name: habit.name, date, count: s.count, unit: s.unit }), {}, `[打卡：${habit.name} · ${nth(s)}]`);
      return `已打卡：${habit.name}${date === td ? '' : `（${date}）`}，${nth(s)}。`;
    },
  }, {
    name: 'habit_status',
    label: '看打卡',
    description: '看对方所有习惯的连续天数和今天打没打。对方问「我坚持几天了」「今天还有什么没做」时用。',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      const all = await habitsApi.status();
      if (!all.length) return '还没有任何习惯。对方想坚持什么可以用 habit_add 加。';
      return all.map(({ habit, s }) => `- ${describe(habit.name, s)}（${CADENCE_LABEL[habit.cadence]}）`).join('\n');
    },
  }],
  outputHandlers: [{ tag: 'check', component: CheckCard }],
  catchup: [{ id: 'ask', tier: 'attach', collect: (c) => collectAsk(c) }],
  profileSections: [{ id: 'streaks', label: '习惯', component: HabitSection }],
  /** 给别的插件（复盘）用：`summary()` 一行摘要，`status()` 每个习惯的连续数 */
  services: { habits: { summary: () => habitsApi.summary(), status: () => habitsApi.status() } },
  setup(c) { ctx = c; },
});
