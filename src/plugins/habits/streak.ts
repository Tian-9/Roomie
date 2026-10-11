/**
 * 习惯打卡的纯函数：日期算术和连续天数。不碰库、不碰 Svelte，方便单测。
 * 日期一律用本地时间的 YYYY-MM-DD 字符串；周一算一周的开始。
 */
export type Cadence = 'daily' | 'weekdays' | 'weekly';
export const CADENCES: Cadence[] = ['daily', 'weekdays', 'weekly'];
export const CADENCE_LABEL: Record<Cadence, string> = { daily: '每天', weekdays: '工作日', weekly: '每周' };

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = (now = new Date()) => ymd(now);
export const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(parse(s)) === s;
export function parse(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}
export function addDays(s: string, n: number): string {
  const d = parse(s); d.setDate(d.getDate() + n); return ymd(d);
}
/** 0 = 周日 … 6 = 周六 */
export const dow = (s: string) => parse(s).getDay();
export const isWeekend = (s: string) => { const w = dow(s); return w === 0 || w === 6; };
/** 这一天所在周的周一 */
export function weekStart(s: string): string {
  const w = dow(s); return addDays(s, w === 0 ? -6 : 1 - w);
}
/** 从 end 往前数 n 天（含 end），旧的在前 */
export const lastDays = (end: string, n: number) => Array.from({ length: n }, (_, i) => addDays(end, i - n + 1));

/** 这一天该不该打卡 */
export function isDue(cadence: Cadence, date: string): boolean {
  return cadence !== 'weekdays' || !isWeekend(date);
}
function prevDue(cadence: Cadence, date: string): string {
  let d = addDays(date, -1);
  while (!isDue(cadence, d)) d = addDays(d, -1);
  return d;
}

export interface Streak {
  /** 连续的数目 */
  count: number;
  /** 连续的单位：每天 / 工作日按天，每周按周 */
  unit: '天' | '周';
  /** 今天打过了 */
  doneToday: boolean;
  /** 这一期（今天 / 本周）打过了 */
  donePeriod: boolean;
  /** 今天该打卡（工作日习惯的周末为 false） */
  dueToday: boolean;
}

/**
 * 算连续数。今天还没打卡不算断：从昨天（上一个该打卡的日子）往前数，这样白天看到的是昨晚的成绩，
 * 到了第二天没打才断。周末对工作日习惯既不算断也不算数；周末多打的那一下照算。
 */
export function streak(cadence: Cadence, checked: Iterable<string>, date: string): Streak {
  const set = checked instanceof Set ? checked : new Set(checked);
  const doneToday = set.has(date);
  if (cadence === 'weekly') {
    const thisWeek = weekStart(date);
    const weeks = new Set<string>();
    for (const d of set) weeks.add(weekStart(d));
    const donePeriod = weeks.has(thisWeek);
    let cursor = donePeriod ? thisWeek : addDays(thisWeek, -7), count = 0;
    while (weeks.has(cursor)) { count++; cursor = addDays(cursor, -7); }
    return { count, unit: '周', doneToday, donePeriod, dueToday: !donePeriod };
  }
  const dueToday = isDue(cadence, date);
  let cursor = doneToday ? date : prevDue(cadence, date), count = 0;
  while (set.has(cursor)) { count++; cursor = prevDue(cadence, cursor); }
  return { count, unit: '天', doneToday, donePeriod: doneToday, dueToday };
}

/** 一句话：「跑步连续 12 天（今天未打卡）」 */
export function describe(name: string, s: Streak): string {
  const tail = s.donePeriod ? '' : s.unit === '周' ? '（本周未打卡）' : s.dueToday ? '（今天未打卡）' : '（今天休息）';
  return `${name}连续 ${s.count} ${s.unit}${tail}`;
}
