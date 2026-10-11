/**
 * 订阅日历：Google 日历的私密 .ics 地址，或者导出来的 .ics 文件。只读、单向（日历 → 这里）。
 *
 * 轻的做法：没有后台，打开时拉一次存进 items 表，平时读本地；几小时内再打开不重复拉。
 * 地址等同密码（拿到就能看你整本日历），存 ctx.secrets，开了锁屏就和 Key 一起封起来；锁着时拉取会等到解锁。
 * 浏览器直接拉 Google 的地址多半会被跨域拦住（Google 不给跨域头），拦了就提示填一个自己的中转地址，或者改用导入文件。
 */
import type { PluginContext } from '$kernel/api';
import type { Table } from 'dexie';
import { ulid } from 'ulid';
import type { ScheduleItem } from './index';
import { parseIcs, expandCalendar } from './ics';
import { isoDate, addDays, atTime } from './dates';

export interface Feed {
  id: string;
  name: string;
  kind: 'url' | 'file';
  /** 文件里写的日历名（X-WR-CALNAME），再导同一个日历的文件时靠它认出来 */
  calName?: string;
  lastSyncAt?: number;
  lastError?: string;
  /** 现在表里有几条是它的 */
  count?: number;
}
export interface FeedSettings {
  feeds: Feed[];
  /** 最少隔几小时再拉 */
  intervalHours: number;
  /** 自建中转：{url} 替换成编码后的地址；没写 {url} 就接在后面 */
  relay: string;
  /** 你手动删掉的那几次（feedId:key），下次同步不再加回来 */
  hidden: string[];
}
export const FEED_DEFAULTS: FeedSettings = { feeds: [], intervalHours: 3, relay: '', hidden: [] };
export const INTERVAL_OPTIONS: { hours: number; label: string }[] = [
  { hours: 1, label: '1 小时' }, { hours: 3, label: '3 小时' }, { hours: 6, label: '6 小时' }, { hours: 12, label: '12 小时' }, { hours: 24, label: '一天' },
];
/** 展开到多久以后、留多少天以前的 */
export const FUTURE_DAYS = 60;
export const PAST_DAYS = 3;
const MAX_HIDDEN = 500;
const SETTINGS_KEY = 'feeds';

export interface SyncResult { added: number; updated: number; removed: number; total: number; name: string }

export class FeedError extends Error {
  constructor(message: string, public kind: 'cors' | 'http' | 'bad' | 'net' = 'net') { super(message); this.name = 'FeedError'; }
}

export function isValidFeedUrl(u: string): boolean {
  try { const x = new URL(u.trim()); return x.protocol === 'https:' || x.protocol === 'http:' || x.protocol === 'webcal:'; } catch { return false; }
}
/** webcal:// 换成 https://，Apple 日历那边复制出来常是这种 */
export function normalizeFeedUrl(u: string): string {
  return u.trim().replace(/^webcal:\/\//i, 'https://');
}
/** 地址猜个名字：Google 的私密地址里带着邮箱，别的用域名 */
export function guessFeedName(u: string): string {
  try {
    const x = new URL(normalizeFeedUrl(u));
    const m = /\/calendar\/ical\/([^/]+)\//.exec(x.pathname);
    if (m) return decodeURIComponent(m[1]!).replace(/@group\.v\.calendar\.google\.com$/, '').replace(/%40/g, '@');
    return x.hostname;
  } catch { return '订阅'; }
}
export function relayUrl(relay: string, url: string): string {
  const r = relay.trim();
  if (!r) return url;
  return r.includes('{url}') ? r.replace('{url}', encodeURIComponent(url)) : r + encodeURIComponent(url);
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class Feeds {
  private ctx!: PluginContext;
  private table!: () => Table<ScheduleItem, string>;
  private fetchFn: FetchLike | undefined;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 改表的操作排队做：后台拉取和你点的「现在刷新」撞上会各插一份，变成两份 */
  private chain: Promise<unknown> = Promise.resolve();
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  init(ctx: PluginContext, table: () => Table<ScheduleItem, string>, fetchFn?: FetchLike) {
    this.ctx = ctx; this.table = table; this.fetchFn = fetchFn;
  }
  stop() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }

  async settings(): Promise<FeedSettings> {
    return { ...FEED_DEFAULTS, ...(await this.ctx.settings.get<Partial<FeedSettings>>(SETTINGS_KEY, {})) };
  }
  async save(patch: Partial<FeedSettings>): Promise<FeedSettings> {
    const next = { ...(await this.settings()), ...patch };
    await this.ctx.settings.set(SETTINGS_KEY, next);
    return next;
  }
  private async patchFeed(id: string, patch: Partial<Feed>) {
    const s = await this.settings();
    await this.save({ feeds: s.feeds.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  }

  url = (id: string) => this.ctx.secrets.get(`feed.${id}`);

  /** 加一个地址订阅，马上拉一次；拉失败的话订阅留着，错误记在上面 */
  async addUrl(rawUrl: string, name?: string): Promise<{ feed: Feed; result?: SyncResult; error?: string }> {
    const url = normalizeFeedUrl(rawUrl);
    if (!isValidFeedUrl(url)) throw new FeedError('地址不对，应该是 https:// 开头的一串', 'bad');
    const feed: Feed = { id: ulid(), name: (name ?? '').trim() || guessFeedName(url), kind: 'url' };
    await this.ctx.secrets.set(`feed.${feed.id}`, url);
    const s = await this.settings();
    await this.save({ feeds: [...s.feeds, feed] });
    try {
      const result = await this.syncOne(feed.id, true);
      return { feed: (await this.settings()).feeds.find((f) => f.id === feed.id) ?? feed, result };
    } catch (e) {
      return { feed: (await this.settings()).feeds.find((f) => f.id === feed.id) ?? feed, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * 导入一个文件。文件里的日历名（X-WR-CALNAME）和已有的文件订阅对得上就更新它，否则新建；传 feedId 就是明确更新那一个。
   * 显示名优先用日历名（Google 导出的文件名是邮箱，不好认），没有才用文件名。
   */
  importFile(text: string, opts: { feedId?: string; name?: string } = {}): Promise<{ feed: Feed; result: SyncResult }> {
    if (!/BEGIN:VCALENDAR/i.test(text)) return Promise.reject(new FeedError('这不是日历文件（.ics）', 'bad'));
    return this.exclusive(() => this.importFileNow(text, opts));
  }
  private async importFileNow(text: string, opts: { feedId?: string; name?: string }): Promise<{ feed: Feed; result: SyncResult }> {
    const s = await this.settings();
    const calName = parseIcs(text).name;
    let feed = opts.feedId ? s.feeds.find((f) => f.id === opts.feedId) : undefined;
    if (!feed && calName) feed = s.feeds.find((f) => f.kind === 'file' && (f.calName ?? f.name) === calName);
    if (!feed) {
      feed = { id: ulid(), name: calName || (opts.name ?? '').trim() || '导入的文件', kind: 'file', ...(calName ? { calName } : {}) };
      await this.save({ feeds: [...s.feeds, feed] });
    } else if (calName && feed.calName !== calName) await this.patchFeed(feed.id, { calName });
    const result = await this.apply(feed, text);
    return { feed: (await this.settings()).feeds.find((f) => f.id === feed!.id) ?? feed, result };
  }

  async rename(id: string, name: string) { await this.patchFeed(id, { name: name.trim().slice(0, 40) || '订阅' }); }

  /** 删掉订阅，连同它带来的日程 */
  remove(id: string): Promise<void> { return this.exclusive(() => this.removeNow(id)); }
  private async removeNow(id: string) {
    const s = await this.settings();
    const feed = s.feeds.find((f) => f.id === id);
    if (!feed) return;
    const rows = await this.rowsOf(id);
    await this.table().bulkDelete(rows.map((r) => r.id));
    if (feed.kind === 'url') await this.ctx.secrets.set(`feed.${id}`, '').catch(() => {});
    await this.save({ feeds: s.feeds.filter((f) => f.id !== id), hidden: s.hidden.filter((h) => !h.startsWith(id + ':')) });
    this.ctx.emit('schedule.synced', { feedId: id, removed: rows.length });
  }

  /** 你在日程里删掉一条订阅来的：这一次不再加回来 */
  hide(item: ScheduleItem): Promise<void> {
    if (item.source !== 'calendar' || !item.feedId || !item.feedKey) return Promise.resolve();
    return this.exclusive(() => this.hideNow(item));
  }
  private async hideNow(item: ScheduleItem) {
    const s = await this.settings();
    const hidden = [...s.hidden.filter((h) => h !== `${item.feedId}:${item.feedKey}`), `${item.feedId}:${item.feedKey}`].slice(-MAX_HIDDEN);
    await this.save({ hidden });
    await this.table().delete(item.id);
    const feed = s.feeds.find((f) => f.id === item.feedId);
    if (feed) await this.patchFeed(feed.id, { count: Math.max(0, (feed.count ?? 1) - 1) });
  }

  private rowsOf(feedId: string) {
    return this.table().filter((i) => i.source === 'calendar' && i.feedId === feedId).toArray();
  }

  /**
   * 把一份 .ics 合进表里：按 feedKey 认人，有的更新（时间变了就重新提醒），没有的加，日历里没了的删。
   * 做没做、提醒过没有这些本地状态保留。
   */
  async apply(feed: Feed, text: string, now = Date.now()): Promise<SyncResult> {
    const today = isoDate(new Date(now));
    const cal = parseIcs(text);
    const occ = expandCalendar(cal, addDays(today, -PAST_DAYS), addDays(today, FUTURE_DAYS));
    const s = await this.settings();
    const hidden = new Set(s.hidden.filter((h) => h.startsWith(feed.id + ':')).map((h) => h.slice(feed.id.length + 1)));
    const existing = await this.rowsOf(feed.id);
    const byKey = new Map(existing.map((i) => [i.feedKey!, i]));
    const seen = new Set<string>();
    const puts: ScheduleItem[] = [];
    let added = 0, updated = 0;
    for (const o of occ) {
      if (seen.has(o.key) || hidden.has(o.key)) continue;
      seen.add(o.key);
      const base = { title: o.title, date: o.date, ...(o.time ? { time: o.time } : {}), ...(o.endTime ? { endTime: o.endTime } : {}), ...(o.place ? { place: o.place } : {}), ...(o.allDay ? { allDay: 1 as const } : {}) };
      const old = byKey.get(o.key);
      if (old) {
        const moved = old.date !== o.date || (old.time ?? '') !== (o.time ?? '');
        const next: ScheduleItem = { ...old, ...base };
        if (!o.time) delete next.time;
        if (!o.endTime) delete next.endTime;
        if (!o.place) delete next.place;
        if (!o.allDay) delete next.allDay;
        if (moved) { next.remindAt = o.time ? atTime(o.date, o.time) : undefined; delete next.notifiedAt; delete next.notedAt; }
        else next.remindAt = old.remindAt;
        if (JSON.stringify(next) !== JSON.stringify(old)) { puts.push(next); updated++; }
      } else {
        puts.push({ id: ulid(), done: 0, createdAt: now, source: 'calendar', feedId: feed.id, feedKey: o.key, ...base, ...(o.time ? { remindAt: atTime(o.date, o.time) } : {}) });
        added++;
      }
    }
    const gone = existing.filter((i) => !seen.has(i.feedKey!));
    if (puts.length) await this.table().bulkPut(puts);
    if (gone.length) await this.table().bulkDelete(gone.map((i) => i.id));
    const total = seen.size;
    await this.patchFeed(feed.id, { lastSyncAt: now, lastError: '', count: total, ...(feed.name ? {} : { name: cal.name || '订阅' }) });
    const result: SyncResult = { added, updated, removed: gone.length, total, name: cal.name };
    this.ctx.emit('schedule.synced', { feedId: feed.id, ...result });
    return result;
  }

  /** 拉地址。被跨域拦住和断网在浏览器里都是 TypeError，分不开，提示里两头都说。 */
  async fetchText(url: string, relay: string): Promise<string> {
    const f = this.fetchFn ?? (typeof fetch === 'function' ? fetch : undefined);
    if (!f) throw new FeedError('这里没有网络能力', 'net');
    const target = relayUrl(relay, url);
    let res: Response;
    try { res = await f(target, { cache: 'no-store', credentials: 'omit', redirect: 'follow' }); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (relay) throw new FeedError(`中转地址连不上（${msg}）`, 'net');
      throw new FeedError('浏览器直接拉不到这个地址：要么没网，要么它不给跨域许可（Google 的私密地址就是这样）。可以在下面填一个自己的中转地址，或者改用导入文件。', 'cors');
    }
    if (!res.ok) throw new FeedError(`地址返回了 ${res.status}${res.status === 404 ? '，可能已经重置过私密地址，去 Google 日历重新复制一个' : ''}`, 'http');
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new FeedError('拉回来的不是日历文件，检查一下地址是不是 .ics 那个', 'bad');
    return text;
  }

  /** 拉一个地址订阅。force 不看间隔。锁着时会等到解锁。 */
  syncOne(id: string, force = false, now = Date.now()): Promise<SyncResult> { return this.exclusive(() => this.syncOneNow(id, force, now)); }
  private async syncOneNow(id: string, force: boolean, now: number): Promise<SyncResult> {
    const s = await this.settings();
    const feed = s.feeds.find((f) => f.id === id);
    if (!feed) throw new FeedError('这个订阅已经不在了', 'bad');
    if (feed.kind !== 'url') throw new FeedError('文件导入的日历没有地址，要更新就再导一次文件', 'bad');
    if (!force && feed.lastSyncAt && now - feed.lastSyncAt < s.intervalHours * 3600_000) {
      return { added: 0, updated: 0, removed: 0, total: feed.count ?? 0, name: feed.name };
    }
    try {
      const url = await this.url(id);
      if (!url) throw new FeedError('地址丢了，删掉重新加一次', 'bad');
      const text = await this.fetchText(url, s.relay);
      return await this.apply(feed, text, now);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.patchFeed(id, { lastError: message, lastSyncAt: force ? feed.lastSyncAt : now });
      this.ctx.emit('schedule.synced', { feedId: id, error: message });
      throw e;
    }
  }

  /** 到期的地址订阅都拉一遍（打开时、回到前台时在后台跑）；同一时刻只跑一份。 */
  syncDue(force = false): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        const s = await this.settings();
        for (const f of s.feeds) {
          if (f.kind !== 'url') continue;
          await this.syncOne(f.id, force).catch(() => {});
        }
      } finally { this.running = null; }
    })();
    return this.running;
  }

  /** 过一会儿再拉，别和打开时的聊天、补发抢 */
  later(ms: number) {
    this.stop();
    if (typeof window === 'undefined') return;
    this.timer = setTimeout(() => { this.timer = null; this.syncDue().catch(() => {}); }, ms);
  }
}

export const feeds = new Feeds();
