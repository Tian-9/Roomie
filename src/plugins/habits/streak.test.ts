import { describe as d, it, expect } from 'vitest';
import { streak, addDays, weekStart, lastDays, isYmd, describe, isDue } from './streak';

// 2026-10-07 是周三，2026-10-10 周六，2026-10-11 周日，2026-10-12 周一
d('date helpers', () => {
  it('adds days across month ends and finds the Monday of a week', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekStart('2026-10-07')).toBe('2026-10-05');
    expect(weekStart('2026-10-11')).toBe('2026-10-05');
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
    expect(lastDays('2026-10-07', 3)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });
  it('validates dates strictly', () => {
    expect(isYmd('2026-10-07')).toBe(true);
    expect(isYmd('2026-02-30')).toBe(false);
    expect(isYmd('10-07')).toBe(false);
    expect(isDue('weekdays', '2026-10-10')).toBe(false);
    expect(isDue('daily', '2026-10-10')).toBe(true);
  });
});

d('daily streak', () => {
  it('counts consecutive days ending today', () => {
    const s = streak('daily', ['2026-10-05', '2026-10-06', '2026-10-07'], '2026-10-07');
    expect(s).toMatchObject({ count: 3, unit: '天', doneToday: true, donePeriod: true, dueToday: true });
  });
  it('does not break when today is not checked yet, and breaks on a real gap', () => {
    expect(streak('daily', ['2026-10-05', '2026-10-06'], '2026-10-07').count).toBe(2);
    expect(streak('daily', ['2026-10-05', '2026-10-06'], '2026-10-08').count).toBe(0);
    expect(streak('daily', ['2026-10-03', '2026-10-05', '2026-10-06'], '2026-10-06').count).toBe(2);
    expect(streak('daily', [], '2026-10-06').count).toBe(0);
  });
  it('describes the state in one phrase', () => {
    expect(describe('跑步', streak('daily', ['2026-10-06'], '2026-10-07'))).toBe('跑步连续 1 天（今天未打卡）');
    expect(describe('跑步', streak('daily', ['2026-10-07'], '2026-10-07'))).toBe('跑步连续 1 天');
  });
});

d('weekdays streak skips weekends', () => {
  it('bridges Friday to Monday', () => {
    // 周四、周五打了，周一看：连续 2 天，今天没打
    const s = streak('weekdays', ['2026-10-08', '2026-10-09'], '2026-10-12');
    expect(s).toMatchObject({ count: 2, doneToday: false, dueToday: true });
    // 周一也打了：3 天
    expect(streak('weekdays', ['2026-10-08', '2026-10-09', '2026-10-12'], '2026-10-12').count).toBe(3);
  });
  it('is not due on weekends and neither breaks nor requires a check', () => {
    const sat = streak('weekdays', ['2026-10-08', '2026-10-09'], '2026-10-10');
    expect(sat).toMatchObject({ count: 2, dueToday: false, donePeriod: false });
    expect(describe('早起', sat)).toBe('早起连续 2 天（今天休息）');
    // 周末多打一下也算
    expect(streak('weekdays', ['2026-10-09', '2026-10-10'], '2026-10-10').count).toBe(2);
    // 周五没打，周一就断了
    expect(streak('weekdays', ['2026-10-08'], '2026-10-12').count).toBe(0);
  });
});

d('weekly streak counts weeks', () => {
  it('counts consecutive weeks with at least one check', () => {
    const s = streak('weekly', ['2026-09-22', '2026-09-30', '2026-10-06'], '2026-10-07');
    expect(s).toMatchObject({ count: 3, unit: '周', donePeriod: true, dueToday: false });
    // 本周还没打：从上周往前数，不算断
    const t = streak('weekly', ['2026-09-22', '2026-09-30'], '2026-10-07');
    expect(t).toMatchObject({ count: 2, donePeriod: false, dueToday: true });
    expect(describe('读书', t)).toBe('读书连续 2 周（本周未打卡）');
    // 隔了一周就断
    expect(streak('weekly', ['2026-09-15', '2026-09-30'], '2026-10-07').count).toBe(1);
  });
});
