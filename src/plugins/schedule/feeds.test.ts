import { describe, it, expect, beforeAll } from 'vitest';
import { openDB, db, pluginTable } from '$kernel/storage/db';
import type { PluginContext } from '$kernel/api';
import plugin, { scheduleApi, feeds, type ScheduleItem } from './index';
import { FeedError, guessFeedName, normalizeFeedUrl, relayUrl, isValidFeedUrl } from './feeds';
import { isoDate, addDays, atTime } from './dates';

const today = isoDate();
const ymd = (iso: string) => iso.replace(/-/g, '');
const ics = (body: string, name = '工作') => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:${name}\r\n${body}\r\nEND:VCALENDAR\r\n`;
const ev = (uid: string, lines: string[]) => `BEGIN:VEVENT\r\nUID:${uid}\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;

const kv = new Map<string, unknown>();
const secrets = new Map<string, string>();
const events: unknown[] = [];
let locked = false;
const ctx = {
  id: 'schedule',
  table: (n: string) => db().table(pluginTable('schedule', n)),
  settings: { get: async <T,>(k: string, d: T) => (kv.has(k) ? (kv.get(k) as T) : d), set: async (k: string, v: unknown) => { kv.set(k, v); } },
  secrets: { get: async (k: string) => secrets.get(k) ?? '', set: async (k: string, v: string) => { if (v) secrets.set(k, v); else secrets.delete(k); }, get locked() { return locked; } },
  emit: (n: string, p: unknown) => events.push([n, p]),
  notify() {},
} as unknown as PluginContext;

let served = '';
let status = 200;
let fail: string | null = null;
const calls: string[] = [];
const fakeFetch = async (input: string) => {
  calls.push(input);
  if (fail) throw new TypeError(fail);
  return new Response(served, { status });
};

const table = () => ctx.table<ScheduleItem>('items');
const mine = async (feedId: string) => (await table().filter((i) => i.feedId === feedId).toArray()).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));

beforeAll(async () => {
  openDB([plugin]);
  await plugin.setup!(ctx);
  // 换成假网络
  feeds.stop();
  feeds.init(ctx, table, fakeFetch);
});

describe('地址', () => {
  it('校验、webcal 换 https、猜名字、中转拼法', () => {
    expect(isValidFeedUrl('https://calendar.google.com/calendar/ical/a%40gmail.com/private-abc/basic.ics')).toBe(true);
    expect(isValidFeedUrl('webcal://x.y/z.ics')).toBe(true);
    expect(isValidFeedUrl('calendar.google.com/x')).toBe(false);
    expect(normalizeFeedUrl(' webcal://x.y/z.ics ')).toBe('https://x.y/z.ics');
    expect(guessFeedName('https://calendar.google.com/calendar/ical/tian%40gmail.com/private-abc/basic.ics')).toBe('tian@gmail.com');
    expect(guessFeedName('https://calendar.google.com/calendar/ical/zh.china%23holiday%40group.v.calendar.google.com/public/basic.ics')).toBe('zh.china#holiday');
    expect(guessFeedName('https://example.com/cal.ics')).toBe('example.com');
    expect(relayUrl('', 'https://a/b?c=1')).toBe('https://a/b?c=1');
    expect(relayUrl('https://r/?url={url}', 'https://a/b?c=1')).toBe('https://r/?url=https%3A%2F%2Fa%2Fb%3Fc%3D1');
    expect(relayUrl('https://r/?u=', 'https://a/b')).toBe('https://r/?u=https%3A%2F%2Fa%2Fb');
  });
});

describe('同步', () => {
  let feedId = '';
  const d1 = addDays(today, 1), d2 = addDays(today, 2);
  it('第一次拉：进表，带提醒时刻，名字猜出来，地址进 secrets', async () => {
    served = ics([ev('a', [`DTSTART:${ymd(d1)}T090000`, `DTEND:${ymd(d1)}T100000`, 'SUMMARY:站会', 'LOCATION:3 楼']), ev('b', [`DTSTART;VALUE=DATE:${ymd(d2)}`, 'SUMMARY:出差'])].join('\r\n'));
    const r = await feeds.addUrl('https://calendar.google.com/calendar/ical/tian%40gmail.com/private-abc/basic.ics');
    feedId = r.feed.id;
    expect(r.error).toBeUndefined();
    expect(r.result).toMatchObject({ added: 2, updated: 0, removed: 0, total: 2 });
    expect(r.feed.name).toBe('tian@gmail.com');
    expect(r.feed.count).toBe(2);
    expect(r.feed.lastSyncAt).toBeGreaterThan(0);
    expect(secrets.get(`feed.${feedId}`)).toContain('private-abc');
    expect(calls.at(-1)).toContain('private-abc');
    const rows = await mine(feedId);
    expect(rows.map((i) => [i.title, i.date, i.time, i.endTime, i.place, i.allDay, i.source])).toEqual([
      ['站会', d1, '09:00', '10:00', '3 楼', undefined, 'calendar'], ['出差', d2, undefined, undefined, undefined, 1, 'calendar'],
    ]);
    expect(rows[0]!.remindAt).toBe(atTime(d1, '09:00'));
    expect(rows[0]!.feedKey).toBe('a');
  });
  it('再拉一次：幂等，改了时间的重新提醒，做没做保留，日历里没了的删掉', async () => {
    const a = (await mine(feedId))[0]!;
    await scheduleApi.setDone(a.id, true);
    await table().update(a.id, { notifiedAt: 1 });
    // 同一份：什么都不变
    let r = await feeds.syncOne(feedId, true);
    expect(r).toMatchObject({ added: 0, updated: 0, removed: 0, total: 2 });
    expect((await mine(feedId))[0]!.done).toBe(1);
    // 站会挪到 10 点，出差没了，新来一个 c
    served = ics([ev('a', [`DTSTART:${ymd(d1)}T100000`, 'SUMMARY:站会']), ev('c', [`DTSTART;VALUE=DATE:${ymd(d2)}`, 'SUMMARY:体检'])].join('\r\n'));
    r = await feeds.syncOne(feedId, true);
    expect(r).toMatchObject({ added: 1, updated: 1, removed: 1, total: 2 });
    const rows = await mine(feedId);
    expect(rows.map((i) => i.title)).toEqual(['站会', '体检']);
    expect(rows[0]!.id).toBe(a.id);
    expect(rows[0]!.time).toBe('10:00');
    expect(rows[0]!.remindAt).toBe(atTime(d1, '10:00'));
    expect(rows[0]!.notifiedAt).toBeUndefined();
    expect(rows[0]!.endTime).toBeUndefined();
    expect(rows[0]!.place).toBeUndefined();
    expect(rows[0]!.done).toBe(1);
    expect((await table().count())).toBe(2);
  });
  it('重复规则展开到窗口里，今天以前的只留几天', async () => {
    served = ics(ev('r', [`DTSTART:${ymd(addDays(today, -30))}T200000`, 'SUMMARY:健身', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH']));
    const r = await feeds.syncOne(feedId, true);
    const rows = await mine(feedId);
    expect(r.total).toBe(rows.length);
    expect(rows.length).toBeGreaterThan(15);
    expect(rows.every((i) => i.date >= addDays(today, -3) && i.date <= addDays(today, 60))).toBe(true);
    expect(rows.every((i) => i.title === '健身' && i.time === '20:00')).toBe(true);
    expect(new Set(rows.map((i) => new Date(i.date + 'T12:00').getDay()))).toEqual(new Set([1, 4]));
  });
  it('日程里删掉订阅来的一条：下次同步不再加回来', async () => {
    const rows = await mine(feedId);
    const victim = rows.find((i) => i.date >= today)!;
    await scheduleApi.remove(victim.id);
    expect(await table().get(victim.id)).toBeUndefined();
    const r = await feeds.syncOne(feedId, true);
    expect(r.added).toBe(0);
    expect((await mine(feedId)).some((i) => i.feedKey === victim.feedKey)).toBe(false);
    expect((await feeds.settings()).hidden).toEqual([`${feedId}:${victim.feedKey}`]);
    // today() 里不会把过去的日历事件当成"过期没做"
    const past = (await mine(feedId)).filter((i) => i.date < today);
    expect(past.length).toBeGreaterThan(0);
    expect((await scheduleApi.today(today)).some((i) => i.source === 'calendar' && i.date < today)).toBe(false);
  });
  it('同时拉两次不会插两份', async () => {
    served = ics([ev('p', [`DTSTART;VALUE=DATE:${ymd(d1)}`, 'SUMMARY:并发']), ev('q', [`DTSTART;VALUE=DATE:${ymd(d2)}`, 'SUMMARY:并发二'])].join('\r\n'));
    const [a, b] = await Promise.all([feeds.syncOne(feedId, true), feeds.syncDue(true).then(() => feeds.syncOne(feedId, true))]);
    expect(a.total).toBe(2);
    expect(b).toMatchObject({ added: 0, updated: 0, removed: 0, total: 2 });
    expect((await mine(feedId)).map((i) => i.title)).toEqual(['并发', '并发二']);
  });
  it('没到间隔不拉，到了才拉，强制不看间隔', async () => {
    const before = calls.length;
    await feeds.syncDue();
    expect(calls.length).toBe(before);
    const s = await feeds.settings();
    await feeds.save({ feeds: s.feeds.map((f) => ({ ...f, lastSyncAt: Date.now() - 4 * 3600_000 })) });
    await feeds.syncDue();
    expect(calls.length).toBe(before + 1);
    await feeds.syncDue();
    expect(calls.length).toBe(before + 1);
    await feeds.syncDue(true);
    expect(calls.length).toBe(before + 2);
  });
  it('拉失败：错误记在订阅上，表不动；跨域被拦有专门的提示；中转地址会用上', async () => {
    const n = (await mine(feedId)).length;
    fail = 'Failed to fetch';
    await expect(feeds.syncOne(feedId, true)).rejects.toThrow(/跨域/);
    expect((await feeds.settings()).feeds[0]!.lastError).toContain('跨域');
    expect((await mine(feedId)).length).toBe(n);
    await feeds.save({ relay: 'https://relay.test/?url={url}' });
    await expect(feeds.syncOne(feedId, true)).rejects.toThrow(/中转/);
    expect(calls.at(-1)).toMatch(/^https:\/\/relay\.test\/\?url=https%3A%2F%2Fcalendar/);
    fail = null; status = 404;
    await expect(feeds.syncOne(feedId, true)).rejects.toThrow(/404/);
    status = 200; served = '<html>';
    await expect(feeds.syncOne(feedId, true)).rejects.toThrow(/不是日历/);
    await feeds.save({ relay: '' });
    served = ics(ev('r', [`DTSTART:${ymd(d1)}T200000`, 'SUMMARY:健身']));
    await feeds.syncOne(feedId, true);
    expect((await feeds.settings()).feeds[0]!.lastError).toBe('');
  });
  it('删掉订阅：它的日程一起清，地址也删', async () => {
    await feeds.remove(feedId);
    expect(await mine(feedId)).toEqual([]);
    expect(secrets.has(`feed.${feedId}`)).toBe(false);
    expect((await feeds.settings()).feeds).toEqual([]);
    expect((await feeds.settings()).hidden).toEqual([]);
  });
});

describe('文件导入', () => {
  it('按日历名认同一个，再导一次是更新；不是 ics 就拒', async () => {
    const d1 = addDays(today, 1);
    const r1 = await feeds.importFile(ics(ev('f1', [`DTSTART;VALUE=DATE:${ymd(d1)}`, 'SUMMARY:家长会']), '家里'), { name: 'basic' });
    expect(r1.feed.kind).toBe('file');
    expect(r1.feed.name).toBe('家里');
    expect(r1.feed.calName).toBe('家里');
    expect(r1.result.added).toBe(1);
    const r2 = await feeds.importFile(ics([ev('f1', [`DTSTART;VALUE=DATE:${ymd(d1)}`, 'SUMMARY:家长会（改）']), ev('f2', [`DTSTART;VALUE=DATE:${ymd(d1)}`, 'SUMMARY:交水费'])].join('\r\n'), '家里'), { feedId: r1.feed.id });
    expect(r2.feed.id).toBe(r1.feed.id);
    expect(r2.result).toMatchObject({ added: 1, updated: 1, removed: 0, total: 2 });
    // 没指定 id、文件里的日历名能对上已有的文件订阅：也是更新
    const r3 = await feeds.importFile(ics(ev('f2', [`DTSTART;VALUE=DATE:${ymd(d1)}`, 'SUMMARY:交水费']), '家里'), { name: 'x' });
    expect(r3.feed.id).toBe(r1.feed.id);
    expect(r3.result).toMatchObject({ added: 0, removed: 1, total: 1 });
    // 没有日历名的文件：用文件名
    const r4 = await feeds.importFile(ics(ev('g', [`DTSTART;VALUE=DATE:${ymd(d1)}`, 'SUMMARY:无名']), ''), { name: 'basic' });
    expect(r4.feed.name).toBe('basic');
    expect(r4.feed.id).not.toBe(r1.feed.id);
    await feeds.remove(r4.feed.id);
    await expect(feeds.importFile('hello')).rejects.toThrow(FeedError);
    await expect(feeds.syncOne(r1.feed.id, true)).rejects.toThrow(/文件/);
    await feeds.remove(r1.feed.id);
  });
});
