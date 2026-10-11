import { describe, it, expect } from 'vitest';
import { parseAmount, normalizeCategory, parseDate, weekRange, lastWeekRange, monthRange, sum, byCategory, byDay, yuan, summaryLine, toCSV, isEarlyWeek, type Entry } from './ledger';

describe('parseAmount', () => {
  it('accepts numbers and numeric strings, in cents', () => {
    expect(parseAmount(28)).toBe(2800);
    expect(parseAmount(28.5)).toBe(2850);
    expect(parseAmount('28.5')).toBe(2850);
    expect(parseAmount('¥32')).toBe(3200);
    expect(parseAmount('32元')).toBe(3200);
    expect(parseAmount('1,234.56')).toBe(123456);
    expect(parseAmount(0.1 + 0.2)).toBe(30);
  });
  it('rejects words, zero, negatives, junk and absurd amounts', () => {
    expect(parseAmount('二十八')).toBeNull();
    expect(parseAmount('两杯奶茶')).toBeNull();
    expect(parseAmount('28.555')).toBeNull();
    expect(parseAmount(0)).toBeNull();
    expect(parseAmount(-5)).toBeNull();
    expect(parseAmount(NaN)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(2_000_000)).toBeNull();
  });
});

describe('categories and dates', () => {
  it('normalizes aliases and falls back to 其他', () => {
    expect(normalizeCategory('餐饮')).toBe('餐饮');
    expect(normalizeCategory('打车')).toBe('交通');
    expect(normalizeCategory('Food')).toBe('餐饮');
    expect(normalizeCategory('火星')).toBe('其他');
    expect(normalizeCategory(undefined)).toBe('其他');
  });
  it('validates real calendar dates only', () => {
    expect(parseDate('2026-10-11')).toBe('2026-10-11');
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('2026-1-5')).toBeNull();
    expect(parseDate('明天')).toBeNull();
  });
  it('computes Monday-based weeks and months', () => {
    expect(weekRange('2026-10-11')).toEqual({ from: '2026-10-05', to: '2026-10-11' }); // 周日
    expect(weekRange('2026-10-12')).toEqual({ from: '2026-10-12', to: '2026-10-18' }); // 周一
    expect(lastWeekRange('2026-10-12')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(weekRange('2027-01-01')).toEqual({ from: '2026-12-28', to: '2027-01-03' }); // 跨年
    expect(monthRange('2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(isEarlyWeek(new Date(2026, 9, 12))).toBe(true); // 周一
    expect(isEarlyWeek(new Date(2026, 9, 15))).toBe(false); // 周四
  });
});

const e = (amount: number, category: Entry['category'], date: string, ts: number, note = ''): Entry => ({ id: `${date}-${ts}`, amount, category, note, date, ts, source: 'tool' });

describe('totals and grouping', () => {
  const xs = [e(3200, '餐饮', '2026-10-06', 2, '午饭'), e(2800, '交通', '2026-10-06', 1), e(1500, '餐饮', '2026-10-08', 5, '咖啡, "小杯"'), e(99900, '居住', '2026-09-30', 9)];
  it('sums and groups by category, largest first', () => {
    expect(sum(xs)).toBe(107400);
    expect(byCategory(xs)).toEqual([{ category: '居住', amount: 99900 }, { category: '餐饮', amount: 4700 }, { category: '交通', amount: 2800 }]);
  });
  it('groups by day, newest first, and sums each day', () => {
    const days = byDay(xs);
    expect(days.map((d) => d.date)).toEqual(['2026-10-08', '2026-10-06', '2026-09-30']);
    expect(days[1]!.total).toBe(6000);
    expect(days[1]!.items.map((i) => i.note)).toEqual(['午饭', '']);
  });
  it('formats yuan and the one-line summary', () => {
    expect(yuan(123400)).toBe('¥1,234');
    expect(yuan(2850)).toBe('¥28.50');
    expect(yuan(5)).toBe('¥0.05');
    expect(summaryLine('本周', xs.filter((x) => x.date >= '2026-10-05'))).toBe('本周已花 ¥75（餐饮 ¥47、交通 ¥28）');
    expect(summaryLine('本周', [])).toBe('本周还没记过账');
  });
  it('exports CSV with escaped notes, oldest first', () => {
    const csv = toCSV(xs);
    const lines = csv.replace('﻿', '').trim().split('\n');
    expect(lines[0]).toBe('日期,金额,分类,备注,来源');
    expect(lines[1]).toBe('2026-09-30,999.00,居住,,他记的');
    expect(lines[2]).toBe('2026-10-06,28.00,交通,,他记的');
    expect(lines[4]).toBe('2026-10-08,15.00,餐饮,"咖啡, ""小杯""",他记的');
  });
});
