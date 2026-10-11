/**
 * 复盘插件的纯函数：日期、早安时段、周的划分、材料的文字版。
 * 不碰库、不碰模型，便于单测。金额都是分，日期都是 YYYY-MM-DD。
 */

export type ReviewKind = 'daily' | 'weekly';

/** 一次复盘用到的材料，存进复盘表里给人看（不含对话原文） */
export interface MaterialSummary {
  /** 复盘覆盖的日期区间，含两端 */
  from: string;
  to: string;
  /** 聊了多少条（你和他的，不含系统消息） */
  messages: number;
  /** 账本：没装账本插件就没有这一项 */
  spent?: { total: number; count: number; lines: string[] };
  /** 习惯一行摘要；没装或没习惯就没有 */
  habits?: string;
  /** 日程：区间里做完的、没做的，和今天的安排 */
  schedule?: { done: string[]; missed: string[]; today: string[] };
  /** 今天的农历 / 假期一行 */
  dayLine?: string;
}

export interface Material extends MaterialSummary {
  /** 对话原文，只进提示词 */
  transcript: string;
}

export interface Review {
  id: string;
  kind: ReviewKind;
  /** 日报是被复盘的那天（通常是昨天）；周报是那周的周一 */
  date: string;
  /** 写它的时候是哪个人设 */
  characterId: string;
  /** 写给复盘本的那段话 */
  text: string;
  /** 发到对话里的那几句（手动复盘没有） */
  say: string;
  createdAt: number;
  source: 'auto' | 'manual';
  material: MaterialSummary;
}

export interface ReviewSettings {
  /** 几点到几点算早上（含 from 不含 to），这段时间回来他说早安，其他时间说回来了 */
  morningFrom: number;
  morningTo: number;
  /** 周日晚上 / 周一要不要一份周小结 */
  weekly: boolean;
}
export const DEFAULT_SETTINGS: ReviewSettings = { morningFrom: 5, morningTo: 11, weekly: true };
/** 周日几点以后算"周日晚上" */
export const WEEKLY_AFTER_HOUR = 18;

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dayStart(s));
/** 本地零点的毫秒 */
export function dayStart(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d).getTime();
}
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return ymd(new Date(y!, m! - 1, d! + n));
}
export const weekdayOf = (date: string) => ['日', '一', '二', '三', '四', '五', '六'][new Date(dayStart(date)).getDay()]!;
/** 「10/11 周六」 */
export const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))} 周${weekdayOf(date)}`;

/** 分 → 「¥12.50」，整数不带小数 */
export function yuan(fen: number): string {
  const v = fen / 100;
  return '¥' + (Number.isInteger(v) ? String(v) : v.toFixed(2));
}

export function clampHour(v: unknown, fallback: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 24 ? n : fallback;
}
export function normalizeSettings(raw: Partial<ReviewSettings> | null | undefined): ReviewSettings {
  const from = clampHour(raw?.morningFrom, DEFAULT_SETTINGS.morningFrom);
  const to = clampHour(raw?.morningTo, DEFAULT_SETTINGS.morningTo);
  return { morningFrom: from, morningTo: to > from ? to : Math.min(24, from + 1), weekly: raw?.weekly !== false };
}
/** 这个钟点算不算早上 */
export const isMorning = (hour: number, s: ReviewSettings) => hour >= s.morningFrom && hour < s.morningTo;

/** 这周的周一 */
export function weekStart(date: string): string {
  const dow = new Date(dayStart(date)).getDay();
  return addDays(date, -((dow + 6) % 7));
}
/**
 * 现在该不该做周小结：周日晚上（WEEKLY_AFTER_HOUR 以后）小结本周，周一小结上周。
 * 返回被小结那周的周一；不是时候就 null。
 */
export function weeklyWeek(now = new Date()): string | null {
  const dow = now.getDay();
  const today = ymd(now);
  if (dow === 0 && now.getHours() >= WEEKLY_AFTER_HOUR) return weekStart(today);
  if (dow === 1) return weekStart(addDays(today, -1));
  return null;
}

/** 日报覆盖的区间：离开几天就看几天（最多 7 天），到昨天为止 */
export function dailyWindow(today: string, days: number): { from: string; to: string } {
  const n = Math.min(7, Math.max(1, days));
  return { from: addDays(today, -n), to: addDays(today, -1) };
}

/** 材料的文字版，给提示词 */
export function describeMaterial(m: Material, youName: string): string {
  const span = m.from === m.to ? `${m.from}（周${weekdayOf(m.from)}）` : `${m.from} 到 ${m.to}`;
  const lines: string[] = [];
  lines.push(`${span} 你们聊了 ${m.messages} 条。${m.transcript ? '\n' + m.transcript : '（没有说话）'}`);
  if (m.spent) lines.push(m.spent.count ? `${youName}花了 ${yuan(m.spent.total)}，${m.spent.count} 笔：${m.spent.lines.join('、')}` : `${youName}没记账。`);
  if (m.habits) lines.push(m.habits);
  if (m.schedule) {
    const s = m.schedule;
    if (s.done.length) lines.push(`做完的事：${s.done.join('、')}`);
    if (s.missed.length) lines.push(`记了但没做的事：${s.missed.join('、')}`);
    lines.push(`今天的安排：${s.today.length ? s.today.join('、') : '没有记下的'}`);
  }
  if (m.dayLine) lines.push(`今天：${m.dayLine}`);
  return lines.join('\n');
}

/** 人看的材料：复盘详情页里的几行 */
export function materialLines(m: MaterialSummary): string[] {
  const out: string[] = [];
  out.push(`聊了 ${m.messages} 条`);
  if (m.spent) out.push(m.spent.count ? `花了 ${yuan(m.spent.total)}，${m.spent.count} 笔` : '没记账');
  if (m.schedule) {
    if (m.schedule.done.length) out.push(`做完：${m.schedule.done.join('、')}`);
    if (m.schedule.missed.length) out.push(`没做：${m.schedule.missed.join('、')}`);
    if (m.schedule.today.length) out.push(`当天安排：${m.schedule.today.join('、')}`);
  }
  if (m.habits) out.push(m.habits);
  if (m.dayLine) out.push(m.dayLine);
  return out;
}

/** 复盘本列表里的标题：日报显示那天，周报显示那一周 */
export function reviewTitle(r: Pick<Review, 'kind' | 'date' | 'material'>): string {
  if (r.kind === 'weekly') return `${shortDate(r.date)} 起的一周`;
  return r.material.from === r.material.to ? shortDate(r.date) : `${shortDate(r.material.from)} 到 ${shortDate(r.material.to)}`;
}
