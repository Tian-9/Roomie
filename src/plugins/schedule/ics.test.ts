import { describe, it, expect } from 'vitest';
import { unfold, parseLine, parseWallTime, wallToMs, toLocal, parseRule, expandRule, parseIcs, expandCalendar, localDate, localTime, occurrenceKey } from './ics';

const ics = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Google Inc//Google Calendar 70.9054//EN\r\nX-WR-CALNAME:工作\r\n${body}\r\nEND:VCALENDAR\r\n`;
const ev = (lines: string[]) => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;
const dates = (o: { date: string }[]) => o.map((x) => x.date);

describe('文本层', () => {
  it('折行展开、参数和转义', () => {
    expect(unfold('SUMMARY:很长的\r\n 标题\r\nUID:1')).toEqual(['SUMMARY:很长的标题', 'UID:1']);
    const p = parseLine('DTSTART;TZID=Asia/Shanghai:20261012T150000')!;
    expect(p).toEqual({ name: 'DTSTART', params: { TZID: 'Asia/Shanghai' }, value: '20261012T150000' });
    expect(parseLine('X-FOO;P="a:b":v')!.value).toBe('v');
    expect(parseLine('nocolon')).toBeNull();
    const cal = parseIcs(ics(ev(['UID:x', 'DTSTART;VALUE=DATE:20261012', 'SUMMARY:开会\\, 然后吃饭\\n第二行'])));
    expect(cal.name).toBe('工作');
    expect(cal.events[0]!.title).toBe('开会, 然后吃饭 第二行');
  });
});

describe('时间', () => {
  it('全天、浮动、UTC、TZID', () => {
    expect(parseWallTime('20261012', {})).toEqual({ y: 2026, m: 10, d: 12 });
    expect(parseWallTime('20261012T150000', {})).toEqual({ y: 2026, m: 10, d: 12, h: 15, mi: 0 });
    expect(parseWallTime('20261012T070000Z', {})).toEqual({ y: 2026, m: 10, d: 12, h: 7, mi: 0, tz: 'UTC' });
    expect(parseWallTime('20261012T150000', { TZID: 'Asia/Shanghai' })!.tz).toBe('Asia/Shanghai');
    expect(parseWallTime('2026-10-12', {})).toBeNull();
    // 上海 15:00 就是 UTC 07:00，不管这台机器是什么时区
    const sh = wallToMs({ y: 2026, m: 10, d: 12, h: 15, mi: 0, tz: 'Asia/Shanghai' });
    expect(sh).toBe(Date.UTC(2026, 9, 12, 7, 0));
    expect(toLocal({ y: 2026, m: 10, d: 12, h: 7, mi: 0, tz: 'UTC' })).toEqual({ ms: sh, date: localDate(sh), time: localTime(sh) });
    // 夏令时：纽约 7 月 9:00 是 UTC 13:00，1 月是 UTC 14:00
    expect(wallToMs({ y: 2026, m: 7, d: 1, h: 9, mi: 0, tz: 'America/New_York' })).toBe(Date.UTC(2026, 6, 1, 13));
    expect(wallToMs({ y: 2026, m: 1, d: 5, h: 9, mi: 0, tz: 'America/New_York' })).toBe(Date.UTC(2026, 0, 5, 14));
    // 不认识的时区当本地
    expect(wallToMs({ y: 2026, m: 10, d: 12, h: 15, mi: 0, tz: 'China Standard Time' })).toBe(new Date(2026, 9, 12, 15).getTime());
    expect(toLocal({ y: 2026, m: 10, d: 12 })).toEqual({ ms: new Date(2026, 9, 12).getTime(), date: '2026-10-12' });
  });
});

describe('RRULE', () => {
  const start = { y: 2026, m: 10, d: 12, h: 9, mi: 30 }; // 周一
  it('解析', () => {
    expect(parseRule('FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2;COUNT=5')).toEqual({ freq: 'WEEKLY', interval: 2, count: 5, byDay: [{ ord: 0, day: 1 }, { ord: 0, day: 3 }] });
    expect(parseRule('FREQ=MONTHLY;BYDAY=2TU')).toEqual({ freq: 'MONTHLY', interval: 1, byDay: [{ ord: 2, day: 2 }] });
    expect(parseRule('FREQ=MONTHLY;BYMONTHDAY=-1')!.byMonthDay).toEqual([-1]);
    expect(parseRule('FREQ=DAILY;UNTIL=20261015')!.until).toBe(new Date(2026, 9, 15, 23, 59, 59, 999).getTime());
    expect(parseRule('FREQ=HOURLY')).toBeNull();
  });
  it('每天：区间、COUNT、UNTIL', () => {
    expect(dates(expandRule(start, { freq: 'DAILY', interval: 1 }, '2026-10-14', '2026-10-16').map(toLocal))).toEqual(['2026-10-14', '2026-10-15', '2026-10-16']);
    expect(dates(expandRule(start, { freq: 'DAILY', interval: 2, count: 3 }, '2026-10-01', '2026-12-01').map(toLocal))).toEqual(['2026-10-12', '2026-10-14', '2026-10-16']);
    expect(dates(expandRule(start, { freq: 'DAILY', interval: 1, until: new Date(2026, 9, 13, 23, 59).getTime() }, '2026-10-01', '2026-12-01').map(toLocal))).toEqual(['2026-10-12', '2026-10-13']);
    // 时分沿用首次
    expect(toLocal(expandRule(start, { freq: 'DAILY', interval: 1 }, '2026-10-20', '2026-10-20')[0]!).time).toBe('09:30');
  });
  it('每周：BYDAY、隔周、早于首次的不算', () => {
    const r = parseRule('FREQ=WEEKLY;BYDAY=MO,FR')!;
    expect(dates(expandRule({ y: 2026, m: 10, d: 14 }, r, '2026-10-12', '2026-10-25').map(toLocal))).toEqual(['2026-10-16', '2026-10-19', '2026-10-23']);
    expect(dates(expandRule(start, parseRule('FREQ=WEEKLY;INTERVAL=2')!, '2026-10-12', '2026-11-10').map(toLocal))).toEqual(['2026-10-12', '2026-10-26', '2026-11-09']);
  });
  it('每月：按日、第几个周几、最后一天、短月跳过', () => {
    expect(dates(expandRule({ y: 2026, m: 1, d: 31 }, { freq: 'MONTHLY', interval: 1 }, '2026-01-01', '2026-05-31').map(toLocal))).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
    expect(dates(expandRule({ y: 2026, m: 10, d: 13 }, parseRule('FREQ=MONTHLY;BYDAY=2TU')!, '2026-10-01', '2026-12-31').map(toLocal))).toEqual(['2026-10-13', '2026-11-10', '2026-12-08']);
    expect(dates(expandRule({ y: 2026, m: 10, d: 30 }, parseRule('FREQ=MONTHLY;BYDAY=-1FR')!, '2026-10-01', '2026-12-31').map(toLocal))).toEqual(['2026-10-30', '2026-11-27', '2026-12-25']);
    expect(dates(expandRule({ y: 2026, m: 10, d: 31 }, parseRule('FREQ=MONTHLY;BYMONTHDAY=-1')!, '2026-10-01', '2027-01-01').map(toLocal))).toEqual(['2026-10-31', '2026-11-30', '2026-12-31']);
  });
  it('每年', () => {
    expect(dates(expandRule({ y: 2020, m: 2, d: 29 }, { freq: 'YEARLY', interval: 1 }, '2021-01-01', '2028-12-31').map(toLocal))).toEqual(['2024-02-29', '2028-02-29']);
    expect(dates(expandRule({ y: 2026, m: 10, d: 12 }, { freq: 'YEARLY', interval: 1, count: 2 }, '2026-01-01', '2030-12-31').map(toLocal))).toEqual(['2026-10-12', '2027-10-12']);
  });
});

describe('整个日历', () => {
  it('单次、重复、EXDATE、改过的一次、取消的一次', () => {
    const text = ics([
      ev(['UID:a', 'DTSTART;TZID=Asia/Shanghai:20261012T150000', 'DTEND;TZID=Asia/Shanghai:20261012T160000', 'SUMMARY:单次', 'LOCATION:会议室']),
      ev(['UID:b', 'DTSTART;VALUE=DATE:20261013', 'DTEND;VALUE=DATE:20261014', 'SUMMARY:全天', 'RRULE:FREQ=DAILY;COUNT=4', 'EXDATE;VALUE=DATE:20261014']),
      ev(['UID:b', 'RECURRENCE-ID;VALUE=DATE:20261015', 'DTSTART;VALUE=DATE:20261020', 'DTEND;VALUE=DATE:20261021', 'SUMMARY:全天（挪到 20 号）']),
      ev(['UID:b', 'RECURRENCE-ID;VALUE=DATE:20261016', 'DTSTART;VALUE=DATE:20261016', 'STATUS:CANCELLED', 'SUMMARY:全天']),
      ev(['UID:c', 'DTSTART:20261012T000000Z', 'SUMMARY:取消了', 'STATUS:CANCELLED']),
      ev(['UID:d', 'DTSTART;VALUE=DATE:20261001', 'SUMMARY:窗口外']),
      `BEGIN:VEVENT\r\nUID:e\r\nDTSTART;VALUE=DATE:20261012\r\nSUMMARY:带闹钟\r\nBEGIN:VALARM\r\nSUMMARY:闹钟不是标题\r\nEND:VALARM\r\nEND:VEVENT`,
    ].join('\r\n'));
    const cal = parseIcs(text);
    expect(cal.events.map((e) => e.uid)).toEqual(['a', 'b', 'b', 'b', 'c', 'd', 'e']);
    const out = expandCalendar(cal, '2026-10-10', '2026-10-31');
    const a = out.find((o) => o.uid === 'a')!;
    const sh = Date.UTC(2026, 9, 12, 7);
    expect(a).toEqual({ key: 'a', uid: 'a', title: '单次', date: localDate(sh), time: localTime(sh), endTime: localTime(sh + 3600_000), allDay: false, place: '会议室' });
    const b = out.filter((o) => o.uid === 'b').sort((x, y) => x.date.localeCompare(y.date));
    // 13 原样；14 被 EXDATE 去掉；15 挪到 20 号（key 仍是原来那次）；16 取消
    expect(b.map((o) => `${o.date} ${o.title} ${o.key}`)).toEqual(['2026-10-13 全天 b/2026-10-13', '2026-10-20 全天（挪到 20 号） b/2026-10-15']);
    expect(b[0]!.allDay).toBe(true);
    expect(b[0]!.time).toBeUndefined();
    expect(out.some((o) => o.uid === 'c' || o.uid === 'd')).toBe(false);
    expect(out.find((o) => o.uid === 'e')!.title).toBe('带闹钟');
    expect(occurrenceKey('b', { y: 2026, m: 10, d: 13 })).toBe('b/2026-10-13');
  });
  it('缺 UID 或 DTSTART 的丢掉，没标题的给个占位', () => {
    const cal = parseIcs(ics([ev(['UID:x', 'SUMMARY:没开始']), ev(['DTSTART;VALUE=DATE:20261012', 'SUMMARY:没 uid']), ev(['UID:y', 'DTSTART;VALUE=DATE:20261012'])].join('\r\n')));
    expect(cal.events.map((e) => [e.uid, e.title])).toEqual([['y', '（无标题）']]);
  });
});
