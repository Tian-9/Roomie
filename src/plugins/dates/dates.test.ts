import { describe, it, expect } from 'vitest';
import { nextOccurrence, daysText, nthText, describe as describeEntry, validMonthDay, solarDate, dateLabel, compareByDays, type LunarResolver } from './dates';

/** 假农历：农历 = 公历（够用来测找日子的逻辑），day 30 一律不存在 */
const fakeLunar: LunarResolver = (iso) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return { year: y, month: m, day: d === 30 ? 31 : d, isLeap: false };
};

describe('nextOccurrence', () => {
  it('公历生日：今年没过就是今年，过了就是明年，带岁数', () => {
    expect(nextOccurrence({ month: 10, day: 14, year: 1977, lunar: false, kind: 'birthday' }, '2026-10-11')).toEqual({ date: '2026-10-14', days: 3, nth: 49 });
    expect(nextOccurrence({ month: 10, day: 1, lunar: false, kind: 'birthday' }, '2026-10-11')).toEqual({ date: '2027-10-01', days: 355 });
    expect(nextOccurrence({ month: 10, day: 11, lunar: false, kind: 'anniversary' }, '2026-10-11')).toEqual({ date: '2026-10-11', days: 0 });
  });
  it('跨年倒数：12 月 30 日看 1 月 2 日是 3 天后', () => {
    expect(nextOccurrence({ month: 1, day: 2, year: 2020, lunar: false, kind: 'anniversary' }, '2026-12-30')).toEqual({ date: '2027-01-02', days: 3, nth: 7 });
  });
  it('2 月 29 日平年落到 2 月 28 日', () => {
    expect(solarDate(2027, 2, 29)).toBe('2027-02-28');
    expect(nextOccurrence({ month: 2, day: 29, lunar: false, kind: 'birthday' }, '2027-01-01')?.date).toBe('2027-02-28');
    expect(nextOccurrence({ month: 2, day: 29, lunar: false, kind: 'birthday' }, '2028-01-01')?.date).toBe('2028-02-29');
  });
  it('年份在未来就不算第几个', () => {
    expect(nextOccurrence({ month: 10, day: 14, year: 2026, lunar: false, kind: 'birthday' }, '2026-10-11')).toEqual({ date: '2026-10-14', days: 3 });
  });
  it('倒数日是固定的一天，过了是负数', () => {
    expect(nextOccurrence({ month: 6, day: 7, year: 2027, lunar: false, kind: 'countdown' }, '2026-10-11')).toEqual({ date: '2027-06-07', days: 239 });
    expect(nextOccurrence({ month: 10, day: 1, year: 2026, lunar: false, kind: 'countdown' }, '2026-10-11')).toEqual({ date: '2026-10-01', days: -10 });
    expect(nextOccurrence({ month: 10, day: 1, lunar: false, kind: 'countdown' }, '2026-10-11')).toBeNull();
  });
  it('农历要 resolver，没有就 null；有就往后找到那天，三十不存在落到廿九', () => {
    const e = { month: 8, day: 15, year: 2000, lunar: true, kind: 'birthday' as const };
    expect(nextOccurrence(e, '2026-10-11')).toBeNull();
    expect(nextOccurrence(e, '2026-10-11', fakeLunar)).toEqual({ date: '2027-08-15', days: 308, nth: 27 });
    expect(nextOccurrence({ month: 10, day: 30, lunar: true, kind: 'anniversary' }, '2026-10-11', fakeLunar)).toEqual({ date: '2026-10-29', days: 18 });
    expect(nextOccurrence({ month: 10, day: 30, lunar: true, kind: 'anniversary' }, '2026-10-30', fakeLunar)).toEqual({ date: '2027-10-29', days: 364 });
  });
});

describe('文字', () => {
  it('几天后、几岁、一句描述', () => {
    expect([0, 1, 2, 3, -4].map(daysText)).toEqual(['今天', '明天', '后天', '3 天后', '已过 4 天']);
    expect(nthText('birthday', 49)).toBe('49 岁');
    expect(nthText('anniversary', 1)).toBe('1 周年');
    expect(nthText('countdown', 1)).toBe('');
    expect(nthText('birthday')).toBe('');
    expect(describeEntry({ title: '妈妈生日', kind: 'birthday', lunar: false, month: 10, day: 14, year: 1977 }, { date: '2026-10-14', days: 3, nth: 49 })).toBe('妈妈生日 3 天后（10/14 周三，49 岁）');
    expect(describeEntry({ title: '在一起', kind: 'anniversary', lunar: false, month: 10, day: 11 }, { date: '2026-10-11', days: 0 })).toBe('在一起 今天（周日）');
    expect(describeEntry({ title: '考研', kind: 'countdown', lunar: false, month: 12, day: 26, year: 2026 }, null)).toBe('考研（2026 年 12 月 26 日，算不出哪天）');
  });
  it('记的是哪天', () => {
    expect(dateLabel({ month: 8, day: 15, lunar: true, kind: 'birthday', year: 2000 })).toBe('农历八月十五 · 2000 年起');
    expect(dateLabel({ month: 10, day: 14, lunar: false, kind: 'birthday' })).toBe('10 月 14 日');
    expect(dateLabel({ month: 6, day: 7, lunar: false, kind: 'countdown', year: 2027 })).toBe('2027 年 6 月 7 日');
  });
  it('月日校验', () => {
    expect(validMonthDay(2, 29, false)).toBe(true);
    expect(validMonthDay(2, 30, false)).toBe(false);
    expect(validMonthDay(4, 31, false)).toBe(false);
    expect(validMonthDay(12, 30, true)).toBe(true);
    expect(validMonthDay(12, 31, true)).toBe(false);
    expect(validMonthDay(13, 1, false)).toBe(false);
    expect(validMonthDay(1.5, 1, false)).toBe(false);
  });
  it('排序：快到的在前，过了的沉底，算不出的最底', () => {
    const rows = [{ date: '', days: 10 }, null, { date: '', days: -2 }, { date: '', days: 0 }];
    expect([...rows].sort(compareByDays).map((o) => o?.days ?? 'x')).toEqual([0, 10, -2, 'x']);
  });
});
