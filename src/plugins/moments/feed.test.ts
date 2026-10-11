import { describe, it, expect } from 'vitest';
import { window, ago, cleanText, excerpt, replyDraft, describeMaterial, materialLines, recentLines, addDays, ymd, type Material } from './feed';

const base: Material = { from: '2026-10-10', to: '2026-10-10', messages: 2, transcript: '小天：加班到十点\n我：早点睡' };

describe('window', () => {
  it('looks back as many days as the absence, at most 3, ending yesterday', () => {
    expect(window('2026-10-12', 1)).toEqual({ from: '2026-10-11', to: '2026-10-11' });
    expect(window('2026-10-12', 2)).toEqual({ from: '2026-10-10', to: '2026-10-11' });
    expect(window('2026-10-12', 9)).toEqual({ from: '2026-10-09', to: '2026-10-11' });
    expect(window('2026-10-12', 0)).toEqual({ from: '2026-10-11', to: '2026-10-11' });
  });
});

describe('ago', () => {
  it('reads like a feed timestamp', () => {
    const now = new Date(2026, 9, 12, 9, 30).getTime();
    expect(ago(now - 10_000, now)).toBe('刚刚');
    expect(ago(now - 5 * 60_000, now)).toBe('5 分钟前');
    expect(ago(now - 3 * 3600_000, now)).toBe('3 小时前');
    expect(ago(new Date(2026, 9, 11, 2).getTime(), now)).toBe('昨天');
    expect(ago(new Date(2026, 9, 8, 12).getTime(), now)).toBe('10/8');
  });
});

describe('cleanText', () => {
  it('strips quotes, hashtags and length', () => {
    expect(cleanText('「你昨天又熬夜了。」')).toBe('你昨天又熬夜了。');
    expect(cleanText('  火锅好吃 #周末 #火锅  ')).toBe('火锅好吃');
    expect(cleanText(42)).toBe('');
    expect(cleanText('x'.repeat(400)).length).toBe(300);
  });
});

describe('reply draft', () => {
  it('quotes the post so he knows which one, and hits a trigger word', () => {
    expect(excerpt('你昨天又熬夜了。 早点睡。', 8)).toBe('你昨天又熬夜了。…');
    const d = replyDraft('你昨天又熬夜了。');
    expect(d).toBe('你发的那条「你昨天又熬夜了。」，');
    expect(d).toContain('你发的');
  });
});

describe('material', () => {
  it('describes only what is there', () => {
    const t = describeMaterial(base, '小天');
    expect(t).toContain('2026-10-10（周六） 你们聊了 2 条');
    expect(t).toContain('小天：加班到十点');
    expect(t).not.toContain('花');
    expect(materialLines(base)).toEqual(['聊了 2 条']);
  });
  it('adds spending, habits, schedule and weather lines', () => {
    const m: Material = { ...base, from: '2026-10-09', spent: { total: 8800, count: 1, lines: ['餐饮 ¥88（火锅）'] }, habits: '跑步连续 3 天', schedule: { done: ['开会'], missed: ['15:00 给妈妈打电话'], today: ['开会'] }, dayLine: '寒露', weather: '北京 12°C 小雨' };
    const t = describeMaterial(m, '小天');
    expect(t).toContain('2026-10-09 到 2026-10-10');
    expect(t).toContain('小天花了 ¥88，1 笔：餐饮 ¥88（火锅）');
    expect(t).toContain('做完了：开会；没做的：15:00 给妈妈打电话；今天有：开会');
    expect(t).toContain('今天：寒露');
    expect(t).toContain('天气：北京 12°C 小雨');
    expect(materialLines(m)).toEqual(['聊了 2 条', '花了 ¥88', '跑步连续 3 天', '做完 1 件', '落下 1 件', '北京 12°C 小雨']);
    expect(materialLines({ ...base, messages: 0, spent: { total: 0, count: 0, lines: [] } })).toEqual(['没说话']);
  });
  it('lists recent posts for the no-repeat hint', () => {
    expect(recentLines([])).toBe('（无）');
    expect(recentLines([{ text: 'a', createdAt: 1 }, { text: 'b', createdAt: 2 }, { text: 'c', createdAt: 3 }, { text: 'd', createdAt: 4 }])).toBe('- a\n- b\n- c');
  });
  it('date helpers roll over months', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(ymd(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
