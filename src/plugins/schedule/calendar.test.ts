import { describe, it, expect } from 'vitest';
import { parseDate, normalizeTime, addDays, daysBetween, relativeLabel, whenLabel, atTime } from './dates';
import { toLunar, lunarFestival, leapMonth } from './lunar';
import { dayInfo, nextHoliday, dayLine } from './holidays';

describe('日期校验：只收 ISO，不解析自然语言', () => {
  it('接受合法的 YYYY-MM-DD', () => {
    expect(parseDate('2026-10-12')?.getDate()).toBe(12);
    expect(parseDate(' 2026-01-01 ')).not.toBeNull();
  });
  it('拒绝自然语言、错格式和不存在的日子', () => {
    for (const bad of ['明天', '10月12日', '2026/10/12', '2026-2-3', '2026-13-01', '2026-02-30', '2025-02-29', 12, null, undefined, ''])
      expect(parseDate(bad)).toBeNull();
    expect(parseDate('2024-02-29')).not.toBeNull();
  });
  it('时间只收 HH:mm，补零', () => {
    expect(normalizeTime('15:00')).toBe('15:00');
    expect(normalizeTime('9:05')).toBe('09:05');
    for (const bad of ['下午三点', '3pm', '25:00', '12:60', '1500', '', undefined]) expect(normalizeTime(bad)).toBeNull();
  });
  it('加减天数和相对称呼', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-10-11', '2026-10-14')).toBe(3);
    const t = '2026-10-11';
    expect(relativeLabel('2026-10-11', t)).toBe('今天');
    expect(relativeLabel('2026-10-12', t)).toBe('明天');
    expect(relativeLabel('2026-10-13', t)).toBe('后天');
    expect(relativeLabel('2026-10-10', t)).toBe('昨天');
    expect(relativeLabel('2026-10-16', t)).toBe('周五 10/16');
    expect(relativeLabel('2026-10-30', t)).toBe('10月30日');
    expect(relativeLabel('2027-01-01', t)).toBe('2027年1月1日');
    expect(whenLabel('2026-10-12', '15:00', t)).toBe('明天 15:00');
  });
  it('atTime 按本地时区算', () => {
    const d = new Date(atTime('2026-10-12', '15:30'));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 12, 15, 30]);
    expect(new Date(atTime('2026-10-12')).getHours()).toBe(0);
  });
});

describe('农历', () => {
  it('春节、端午、中秋、除夕对得上', () => {
    expect(toLunar('2026-02-17')?.text).toBe('正月初一');
    expect(toLunar('2025-01-29')?.text).toBe('正月初一');
    expect(toLunar('2024-02-10')?.text).toBe('正月初一');
    expect(toLunar('2027-02-06')?.text).toBe('正月初一');
    expect(toLunar('2026-06-19')?.text).toBe('五月初五');
    expect(toLunar('2026-09-25')?.text).toBe('八月十五');
    expect(toLunar('2027-06-09')?.text).toBe('五月初五');
    expect(toLunar('2027-09-15')?.text).toBe('八月十五');
    expect(toLunar('2026-02-16')?.text).toBe('腊月廿九');
    expect(lunarFestival(toLunar('2026-02-16')!)).toBe('除夕');
    expect(lunarFestival(toLunar('2027-02-05')!)).toBe('除夕');
    expect(lunarFestival(toLunar('2026-09-25')!)).toBe('中秋节');
  });
  it('闰月：2025 闰六月，2028 闰五月', () => {
    expect(leapMonth(2025)).toBe(6);
    expect(leapMonth(2028)).toBe(5);
    expect(leapMonth(2026)).toBe(0);
    const l = toLunar('2025-07-25');
    expect(l?.isLeap).toBe(true); expect(l?.text).toBe('闰六月初一');
  });
  it('生肖干支', () => {
    expect(toLunar('2026-10-11')?.zodiac).toBe('马');
    expect(toLunar('2026-10-11')?.ganzhi).toBe('丙午年');
    expect(toLunar('2026-01-01')?.zodiac).toBe('蛇');
  });
  it('超出范围和错格式返回 null', () => {
    expect(toLunar('1900-01-30')).toBeNull();
    expect(toLunar('2101-01-01')).toBeNull();
    expect(toLunar('明天')).toBeNull();
  });
});

describe('节假日', () => {
  it('2026 国庆：放假、调休、普通周末', () => {
    expect(dayInfo('2026-10-01')).toMatchObject({ holiday: '国庆节', off: true, workday: false });
    expect(dayInfo('2026-10-07').off).toBe(true);
    expect(dayInfo('2026-10-08').off).toBe(false);
    expect(dayInfo('2026-10-10')).toMatchObject({ weekend: true, workday: true, off: false });
    expect(dayInfo('2026-09-20')).toMatchObject({ weekend: true, workday: true, off: false });
    expect(dayInfo('2026-10-11')).toMatchObject({ weekend: true, off: true });
    expect(dayInfo('2026-10-12').off).toBe(false);
  });
  it('春节九天，前后调休', () => {
    expect(dayInfo('2026-02-15').holiday).toBe('春节');
    expect(dayInfo('2026-02-23').holiday).toBe('春节');
    expect(dayInfo('2026-02-24').holiday).toBeUndefined();
    expect(dayInfo('2026-02-14').workday).toBe(true);
    expect(dayInfo('2026-02-28').workday).toBe(true);
  });
  it('节日标注和农历', () => {
    expect(dayInfo('2026-09-25').festival).toBe('中秋节');
    expect(dayInfo('2026-04-05').festival).toBe('清明');
    expect(dayInfo('2026-06-01').festival).toBe('儿童节');
    expect(dayInfo('2026-10-11').lunar).toBe('九月初二');
    expect(dayInfo('2027-10-01')).toMatchObject({ holiday: '国庆节', tentative: true });
  });
  it('下一个假期和顶上那行', () => {
    expect(nextHoliday('2026-10-11')?.name).toBe('元旦');
    expect(nextHoliday('2026-10-03')?.name).toBe('国庆节');
    expect(dayLine('2026-10-01')).toBe('农历八月廿一 · 国庆节放假');
    expect(dayLine('2026-10-10')).toBe('农历九月初一 · 调休上班');
    expect(dayLine('2027-02-06')).toBe('农历正月初一 · 春节放假（预估）');
  });
});
