import { describe, it, expect } from 'vitest';
import { ymd, addDays, weekStart, weeklyWeek, dailyWindow, isMorning, normalizeSettings, yuan, describeMaterial, materialLines, reviewTitle, isYmd, WEEKLY_AFTER_HOUR } from './review';

describe('review dates', () => {
  it('formats and shifts local dates', () => {
    expect(ymd(new Date(2026, 9, 11))).toBe('2026-10-11');
    expect(addDays('2026-10-11', -1)).toBe('2026-10-10');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(isYmd('2026-10-11')).toBe(true);
    expect(isYmd('昨天')).toBe(false);
  });
  it('finds the monday of a week', () => {
    expect(weekStart('2026-10-11')).toBe('2026-10-05'); // 周日
    expect(weekStart('2026-10-05')).toBe('2026-10-05'); // 周一
    expect(weekStart('2026-10-07')).toBe('2026-10-05');
  });
  it('does the weekly summary on sunday evening (this week) or monday (last week)', () => {
    expect(weeklyWeek(new Date(2026, 9, 11, WEEKLY_AFTER_HOUR - 1))).toBeNull(); // 周日下午
    expect(weeklyWeek(new Date(2026, 9, 11, WEEKLY_AFTER_HOUR))).toBe('2026-10-05'); // 周日晚上
    expect(weeklyWeek(new Date(2026, 9, 12, 8))).toBe('2026-10-05'); // 周一
    expect(weeklyWeek(new Date(2026, 9, 13, 23))).toBeNull(); // 周二
  });
  it('reviews the whole absence up to a week, ending yesterday', () => {
    expect(dailyWindow('2026-10-11', 1)).toEqual({ from: '2026-10-10', to: '2026-10-10' });
    expect(dailyWindow('2026-10-11', 0)).toEqual({ from: '2026-10-10', to: '2026-10-10' });
    expect(dailyWindow('2026-10-11', 3)).toEqual({ from: '2026-10-08', to: '2026-10-10' });
    expect(dailyWindow('2026-10-11', 30)).toEqual({ from: '2026-10-04', to: '2026-10-10' });
  });
});

describe('review settings', () => {
  it('defaults to 5–11 as morning and fixes bad input', () => {
    const d = normalizeSettings(null);
    expect(d).toEqual({ morningFrom: 5, morningTo: 11, weekly: true });
    expect(isMorning(5, d)).toBe(true);
    expect(isMorning(10, d)).toBe(true);
    expect(isMorning(11, d)).toBe(false);
    expect(isMorning(20, d)).toBe(false);
    expect(normalizeSettings({ morningFrom: 9, morningTo: 7, weekly: false })).toEqual({ morningFrom: 9, morningTo: 10, weekly: false });
    expect(normalizeSettings({ morningFrom: 'x' as unknown as number, morningTo: 99 })).toEqual({ morningFrom: 5, morningTo: 11, weekly: true });
  });
});

describe('review material', () => {
  const base = { from: '2026-10-10', to: '2026-10-10', messages: 4, transcript: '小明：今天好累\n我：早点睡' };
  it('mentions money and schedule only when those plugins are there', () => {
    const plain = describeMaterial(base, '小明');
    expect(plain).toContain('2026-10-10（周六） 你们聊了 4 条');
    expect(plain).toContain('小明：今天好累');
    expect(plain).not.toContain('花');
    expect(plain).not.toContain('安排');
    const full = describeMaterial({
      ...base,
      spent: { total: 3250, count: 2, lines: ['餐饮 ¥32（午饭）', '交通 ¥0.50'] },
      habits: '习惯：跑步连续 3 天（今天未打卡）',
      schedule: { done: ['开会'], missed: ['交房租'], today: ['15:00 牙医'] },
      dayLine: '农历八月三十',
    }, '小明');
    expect(full).toContain('小明花了 ¥32.50，2 笔：餐饮 ¥32（午饭）、交通 ¥0.50');
    expect(full).toContain('做完的事：开会');
    expect(full).toContain('记了但没做的事：交房租');
    expect(full).toContain('今天的安排：15:00 牙医');
    expect(full).toContain('今天：农历八月三十');
    expect(describeMaterial({ ...base, messages: 0, transcript: '', spent: { total: 0, count: 0, lines: [] }, schedule: { done: [], missed: [], today: [] } }, '小明'))
      .toContain('（没有说话）\n小明没记账。\n今天的安排：没有记下的');
  });
  it('formats money and the lines people see', () => {
    expect(yuan(3200)).toBe('¥32');
    expect(yuan(3250)).toBe('¥32.50');
    expect(materialLines({ from: '2026-10-10', to: '2026-10-10', messages: 4 })).toEqual(['聊了 4 条']);
    expect(materialLines({ from: '2026-10-10', to: '2026-10-10', messages: 0, spent: { total: 0, count: 0, lines: [] }, schedule: { done: ['开会'], missed: [], today: [] }, habits: '习惯：跑步连续 3 天' }))
      .toEqual(['聊了 0 条', '没记账', '做完：开会', '习惯：跑步连续 3 天']);
  });
  it('titles daily, multi-day and weekly reviews', () => {
    expect(reviewTitle({ kind: 'daily', date: '2026-10-10', material: { from: '2026-10-10', to: '2026-10-10', messages: 0 } })).toBe('10/10 周六');
    expect(reviewTitle({ kind: 'daily', date: '2026-10-10', material: { from: '2026-10-08', to: '2026-10-10', messages: 0 } })).toBe('10/8 周四 到 10/10 周六');
    expect(reviewTitle({ kind: 'weekly', date: '2026-10-05', material: { from: '2026-10-05', to: '2026-10-11', messages: 0 } })).toBe('10/5 周一 起的一周');
  });
});
