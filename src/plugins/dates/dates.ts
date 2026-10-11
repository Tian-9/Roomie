/**
 * 纪念日的纯函数：下一次是哪天、还有几天、第几个。日期一律 YYYY-MM-DD 字符串，按本地时区算。
 * 农历换算不在这里做：传进来一个 resolver（公历 → 农历），由日程插件的 lunar 服务提供；没有就只支持公历。
 */

export type Kind = 'birthday' | 'anniversary' | 'countdown';
export const KINDS: Kind[] = ['birthday', 'anniversary', 'countdown'];
export const KIND_LABEL: Record<Kind, string> = { birthday: '生日', anniversary: '纪念日', countdown: '倒数日' };

export interface DateEntry {
  id: string;
  title: string;
  month: number;
  day: number;
  /** 生日 / 纪念日：哪一年开始的，可不填；倒数日：必填，就是那一天 */
  year?: number;
  /** 月、日是农历（倒数日不支持农历） */
  lunar: boolean;
  kind: Kind;
  createdAt: number;
  source: 'tool' | 'manual';
}

/** 公历某天对应的农历，日程插件 lunar 服务的 toLunar 返回的子集 */
export interface LunarLike { year: number; month: number; day: number; isLeap: boolean }
export type LunarResolver = (iso: string) => LunarLike | null;

export interface Occurrence {
  /** 下一次（倒数日就是那一天）的公历日期 */
  date: string;
  /** 距今天几天；倒数日过了就是负数 */
  days: number;
  /** 第几个：生日是几岁，纪念日是几周年；没记年份就没有 */
  nth?: number;
}

const MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const DAYS = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十', '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
/** 农历往后最多找这么多天（一个农历年不到 385 天） */
const LUNAR_SCAN = 400;

const pad = (n: number) => String(n).padStart(2, '0');

export function isoDate(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 严格校验 YYYY-MM-DD */
export function parseDate(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 1900 || y > 2100) return null;
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
}

export function addDays(iso: string, n: number): string {
  const d = parseDate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/** b - a 的天数 */
export function daysBetween(a: string, b: string): number {
  const da = parseDate(a), db = parseDate(b);
  if (!da || !db) return 0;
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86400_000);
}

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
function daysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate(); }

/** 月、日本身合不合法：公历按 2 月 29 天算（闰年才有的日子也收），农历最多三十 */
export function validMonthDay(month: number, day: number, lunar: boolean): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return false;
  if (lunar) return day <= 30;
  return day <= daysInMonth(2000, month); // 2000 是闰年，2 月有 29 天
}

/** 某年的这一天；2 月 29 日在平年落到 2 月 28 日 */
export function solarDate(year: number, month: number, day: number): string {
  const d = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
  return `${year}-${pad(month)}-${pad(d)}`;
}

/** 下一次在哪天、还有几天。农历的要 resolver；没有或范围外返回 null */
export function nextOccurrence(e: Pick<DateEntry, 'month' | 'day' | 'year' | 'lunar' | 'kind'>, today = isoDate(), lunar?: LunarResolver): Occurrence | null {
  if (e.kind === 'countdown') {
    if (!e.year) return null;
    const date = solarDate(e.year, e.month, e.day);
    return { date, days: daysBetween(today, date) };
  }
  if (e.lunar) return lunarOccurrence(e, today, lunar);
  const ty = Number(today.slice(0, 4));
  for (const y of [ty, ty + 1]) {
    const date = solarDate(y, e.month, e.day);
    if (date >= today) return { date, days: daysBetween(today, date), ...(e.year && y > e.year ? { nth: y - e.year } : {}) };
  }
  return null;
}

function lunarOccurrence(e: Pick<DateEntry, 'month' | 'day' | 'year'>, today: string, lunar?: LunarResolver): Occurrence | null {
  if (!lunar) return null;
  // 先找正好这一天；农历三十有的年份没有，那就落到廿九
  for (const day of e.day === 30 ? [30, 29] : [e.day]) {
    for (let i = 0; i <= LUNAR_SCAN; i++) {
      const iso = addDays(today, i);
      const l = lunar(iso);
      if (!l) return null;
      if (!l.isLeap && l.month === e.month && l.day === day) {
        return { date: iso, days: i, ...(e.year && l.year > e.year ? { nth: l.year - e.year } : {}) };
      }
    }
  }
  return null;
}

/** 还有几天：今天 / 明天 / 后天 / 3 天后 / 已过 3 天 */
export function daysText(days: number): string {
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  if (days === 2) return '后天';
  if (days > 2) return `${days} 天后`;
  return `已过 ${-days} 天`;
}

/** 几岁 / 几周年；倒数日和没记年份的没有 */
export function nthText(kind: Kind, nth?: number): string {
  if (!nth || kind === 'countdown') return '';
  return kind === 'birthday' ? `${nth} 岁` : `${nth} 周年`;
}

/** 农历八月十五 */
export function lunarText(month: number, day: number): string {
  return `农历${MONTHS[month - 1] ?? month}月${DAYS[day - 1] ?? day}`;
}

/** 记的是哪天：农历八月十五 / 10 月 14 日 / 2027 年 6 月 7 日（倒数日） */
export function dateLabel(e: Pick<DateEntry, 'month' | 'day' | 'year' | 'lunar' | 'kind'>): string {
  if (e.lunar) return lunarText(e.month, e.day) + (e.year ? ` · ${e.year} 年起` : '');
  if (e.kind === 'countdown') return `${e.year} 年 ${e.month} 月 ${e.day} 日`;
  return `${e.month} 月 ${e.day} 日` + (e.year ? ` · ${e.year} 年起` : '');
}

export function weekday(iso: string): string {
  const d = parseDate(iso);
  return d ? '周' + WEEKDAYS[d.getDay()] : '';
}
export function shortDate(iso: string): string {
  const d = parseDate(iso);
  return d ? `${d.getMonth() + 1}/${d.getDate()}` : iso;
}

/** 给模型和主页看的一句：妈妈生日 3 天后（10/14 周三，49 岁） */
export function describe(e: Pick<DateEntry, 'title' | 'kind' | 'lunar' | 'month' | 'day' | 'year'>, occ: Occurrence | null): string {
  if (!occ) return `${e.title}（${dateLabel(e)}，算不出哪天）`;
  const extra = [occ.days > 2 || occ.days < 0 ? `${shortDate(occ.date)} ${weekday(occ.date)}` : weekday(occ.date), nthText(e.kind, occ.nth)].filter(Boolean).join('，');
  return `${e.title} ${daysText(occ.days)}（${extra}）`;
}

/** 列表顺序：先快到的，倒数日过了的沉底，算不出的更底 */
export function compareByDays(a: Occurrence | null, b: Occurrence | null): number {
  const k = (o: Occurrence | null) => (o === null ? 1e9 : o.days < 0 ? 1e8 - o.days : o.days);
  return k(a) - k(b);
}
