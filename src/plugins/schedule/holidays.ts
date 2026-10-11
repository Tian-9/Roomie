/**
 * 法定节假日表和"这天是什么日子"。
 * 2026 年按国务院办公厅 2025 年 11 月发的安排；2027 年的安排还没发，先按节日当天放一天、春节 / 国庆七天的惯例估，标 tentative，界面上注明。
 */
import { toLunar, lunarFestival } from './lunar';
import { parseDate } from './dates';

export interface Holiday {
  name: string;
  /** 放假区间，含两端 */
  from: string; to: string;
  /** 调休上班的周末 */
  work: string[];
  /** 还没正式公布，按惯例估的 */
  tentative?: boolean;
}

export const HOLIDAYS: Holiday[] = [
  { name: '元旦', from: '2026-01-01', to: '2026-01-03', work: ['2026-01-04'] },
  { name: '春节', from: '2026-02-15', to: '2026-02-23', work: ['2026-02-14', '2026-02-28'] },
  { name: '清明节', from: '2026-04-04', to: '2026-04-06', work: [] },
  { name: '劳动节', from: '2026-05-01', to: '2026-05-05', work: ['2026-05-09'] },
  { name: '端午节', from: '2026-06-19', to: '2026-06-21', work: [] },
  { name: '中秋节', from: '2026-09-25', to: '2026-09-27', work: [] },
  { name: '国庆节', from: '2026-10-01', to: '2026-10-07', work: ['2026-09-20', '2026-10-10'] },
  { name: '元旦', from: '2027-01-01', to: '2027-01-01', work: [], tentative: true },
  { name: '春节', from: '2027-02-05', to: '2027-02-11', work: [], tentative: true },
  { name: '清明节', from: '2027-04-05', to: '2027-04-05', work: [], tentative: true },
  { name: '劳动节', from: '2027-05-01', to: '2027-05-03', work: [], tentative: true },
  { name: '端午节', from: '2027-06-09', to: '2027-06-09', work: [], tentative: true },
  { name: '中秋节', from: '2027-09-15', to: '2027-09-15', work: [], tentative: true },
  { name: '国庆节', from: '2027-10-01', to: '2027-10-07', work: [], tentative: true },
];

/** 公历节日（MM-DD），只用来在顶上标一句，不放假 */
const SOLAR_FESTIVALS: Record<string, string> = {
  '01-01': '元旦', '02-14': '情人节', '03-08': '妇女节', '03-12': '植树节', '04-01': '愚人节', '05-01': '劳动节', '05-04': '青年节',
  '06-01': '儿童节', '07-01': '建党节', '08-01': '建军节', '09-10': '教师节', '10-01': '国庆节', '12-24': '平安夜', '12-25': '圣诞节',
};
/** 清明是节气，每年不一样 */
const QINGMING: Record<string, string> = { '2025': '04-04', '2026': '04-05', '2027': '04-05', '2028': '04-04', '2029': '04-04', '2030': '04-05' };

export interface DayInfo {
  date: string;
  weekend: boolean;
  /** 在哪个假期里 */
  holiday?: string;
  tentative?: boolean;
  /** 调休上班的周末 */
  workday: boolean;
  /** 这天不用上班 */
  off: boolean;
  /** 节日名（农历或公历），不一定放假 */
  festival?: string;
  /** 农历 */
  lunar?: string;
}

export function holidayOf(date: string): Holiday | undefined {
  return HOLIDAYS.find((h) => date >= h.from && date <= h.to);
}

export function dayInfo(date: string): DayInfo {
  const d = parseDate(date);
  if (!d) return { date, weekend: false, workday: false, off: false };
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  const h = holidayOf(date);
  const workday = HOLIDAYS.some((x) => x.work.includes(date));
  const l = toLunar(date);
  const md = date.slice(5);
  const festival = (l && lunarFestival(l)) ?? (QINGMING[date.slice(0, 4)] === md ? '清明' : undefined) ?? SOLAR_FESTIVALS[md];
  return {
    date, weekend, workday,
    ...(h ? { holiday: h.name, ...(h.tentative ? { tentative: true } : {}) } : {}),
    off: !!h || (weekend && !workday),
    ...(festival ? { festival } : {}),
    ...(l ? { lunar: l.text } : {}),
  };
}

/** 从某天起下一个假期（含正在放的） */
export function nextHoliday(from: string): Holiday | undefined {
  return HOLIDAYS.filter((h) => h.to >= from).sort((a, b) => a.from.localeCompare(b.from))[0];
}

/** 顶上那行：周六 · 八月三十 · 中秋节 放假 */
export function dayLine(date: string): string {
  const i = dayInfo(date);
  const parts: string[] = [];
  if (i.lunar) parts.push('农历' + i.lunar);
  if (i.holiday) parts.push(`${i.holiday}放假${i.tentative ? '（预估）' : ''}`);
  else if (i.workday) parts.push('调休上班');
  else if (i.festival) parts.push(i.festival);
  return parts.join(' · ');
}
