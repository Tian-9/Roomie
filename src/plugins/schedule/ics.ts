/**
 * iCalendar（.ics）解析和重复规则展开。只做日程要用的一小块：VEVENT 的标题、起止、地点、UID、RRULE / EXDATE / RECURRENCE-ID。
 * 纯函数，不碰库。时区：Google 给的 TZID 是 IANA 名字，用 Intl 换算到本地；不认识的时区（Outlook 那种 "China Standard Time"）按本地时间算。
 */

/** 一个时刻的墙上时间：年月日（时分），加它所在的时区。全天的没有时分。 */
export interface WallTime {
  y: number; m: number; d: number;
  h?: number; mi?: number;
  /** IANA 时区；'UTC' 是 Z 结尾；undefined 是浮动时间（按本地算） */
  tz?: string;
}

export interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count?: number;
  /** 截止（含），毫秒时间戳 */
  until?: number;
  /** WEEKLY 的星期几（0 日 … 6 六）；MONTHLY / YEARLY 的带序数：{ ord: 2, day: 2 } 是第二个周二，ord -1 是最后一个 */
  byDay?: { ord: number; day: number }[];
  byMonthDay?: number[];
  byMonth?: number[];
}

export interface IcsEvent {
  uid: string;
  title: string;
  place?: string;
  start: WallTime;
  end?: WallTime;
  allDay: boolean;
  rrule?: Rule;
  /** 被去掉的那几次：本地 key（见 occurrenceKey） */
  exdates: string[];
  /** 这是某次的改动版：原来那次的本地 key */
  recurrenceId?: string;
  cancelled: boolean;
}

export interface IcsCalendar { name: string; events: IcsEvent[] }

/** 展开后的一次 */
export interface Occurrence {
  /** uid + 原定开始时刻，同一个日历里唯一，同步时按它认人 */
  key: string;
  uid: string;
  title: string;
  place?: string;
  date: string;
  time?: string;
  endTime?: string;
  allDay: boolean;
}

// ---------- 文本层 ----------

/** 折行展开：下一行以空格或 tab 开头就是上一行的延续 */
export function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length) out[out.length - 1] += raw.slice(1);
    else if (raw.length) out.push(raw);
  }
  return out;
}

export interface Prop { name: string; params: Record<string, string>; value: string }

export function parseLine(line: string): Prop | null {
  // NAME;PARAM=VAL;PARAM2="quoted":value   —— 冒号可能出现在带引号的参数里
  let i = 0, inQuote = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i), value = line.slice(i + 1);
  const parts = head.split(';');
  const name = parts[0]!.toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

export function unescapeText(v: string): string {
  return v.replace(/\\(n|N|,|;|\\)/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

// ---------- 时间 ----------

/** 20261012 / 20261012T150000 / 20261012T070000Z，配上 TZID 参数 */
export function parseWallTime(value: string, params: Record<string, string>): WallTime | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const y = +m[1]!, mo = +m[2]!, d = +m[3]!;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (params.VALUE === 'DATE' || m[4] === undefined) return { y, m: mo, d };
  const tz = m[7] ? 'UTC' : params.TZID || undefined;
  return { y, m: mo, d, h: +m[4]!, mi: +m[5]!, ...(tz ? { tz } : {}) };
}

const fmtCache = new Map<string, Intl.DateTimeFormat | null>();
function formatter(tz: string): Intl.DateTimeFormat | null {
  if (fmtCache.has(tz)) return fmtCache.get(tz)!;
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { f = null; }
  fmtCache.set(tz, f);
  return f;
}

/** 某时区在某一瞬间的偏移（毫秒，东八区是 +8h） */
function offsetAt(ms: number, f: Intl.DateTimeFormat): number {
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour! % 24, +p.minute!, +p.second!);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** 墙上时间 → 时间戳。全天按本地 0 点。 */
export function wallToMs(t: WallTime): number {
  if (t.h === undefined) return new Date(t.y, t.m - 1, t.d).getTime();
  const h = t.h, mi = t.mi ?? 0;
  if (!t.tz) return new Date(t.y, t.m - 1, t.d, h, mi).getTime();
  if (t.tz === 'UTC') return Date.UTC(t.y, t.m - 1, t.d, h, mi);
  const f = formatter(t.tz);
  if (!f) return new Date(t.y, t.m - 1, t.d, h, mi).getTime();
  const guess = Date.UTC(t.y, t.m - 1, t.d, h, mi);
  let ms = guess - offsetAt(guess, f);
  const off2 = offsetAt(ms, f);
  if (guess - off2 !== ms) ms = guess - off2;
  return ms;
}

const pad = (n: number) => String(n).padStart(2, '0');
export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function localTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 墙上时间 → 本地的日期和时间 */
export function toLocal(t: WallTime): { ms: number; date: string; time?: string } {
  const ms = wallToMs(t);
  return t.h === undefined ? { ms, date: `${t.y}-${pad(t.m)}-${pad(t.d)}` } : { ms, date: localDate(ms), time: localTime(ms) };
}

/** 一次的 key：全天用本地日期，有时间的用本地日期加时间 */
export function occurrenceKey(uid: string, t: WallTime): string {
  const l = toLocal(t);
  return `${uid}/${l.date}${l.time ? 'T' + l.time : ''}`;
}

// ---------- RRULE ----------

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function parseRule(value: string): Rule | null {
  const kv: Record<string, string> = {};
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) kv[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freq = kv.FREQ?.toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  const rule: Rule = { freq, interval: Math.max(1, parseInt(kv.INTERVAL ?? '1', 10) || 1) };
  if (kv.COUNT) rule.count = Math.max(1, parseInt(kv.COUNT, 10) || 1);
  if (kv.UNTIL) {
    const w = parseWallTime(kv.UNTIL, {});
    // 只有日期的 UNTIL 含当天一整天
    if (w) rule.until = w.h === undefined ? wallToMs(w) + 86400_000 - 1 : wallToMs(w);
  }
  if (kv.BYDAY) {
    const list: { ord: number; day: number }[] = [];
    for (const s of kv.BYDAY.split(',')) {
      const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(s.trim());
      if (m) list.push({ ord: m[1] ? parseInt(m[1], 10) : 0, day: DAYS.indexOf(m[2]!.toUpperCase()) });
    }
    if (list.length) rule.byDay = list;
  }
  if (kv.BYMONTHDAY) {
    const list = kv.BYMONTHDAY.split(',').map((s) => parseInt(s, 10)).filter((n) => n >= -31 && n <= 31 && n !== 0);
    if (list.length) rule.byMonthDay = list;
  }
  if (kv.BYMONTH) {
    const list = kv.BYMONTH.split(',').map((s) => parseInt(s, 10)).filter((n) => n >= 1 && n <= 12);
    if (list.length) rule.byMonth = list;
  }
  return rule;
}

const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();
const dow = (y: number, m: number, d: number) => new Date(y, m - 1, d).getDay();

/** 某月里符合 byDay / byMonthDay 的日子（升序） */
function monthDays(y: number, m: number, rule: Rule, fallbackDay: number): number[] {
  const n = daysInMonth(y, m);
  const set = new Set<number>();
  if (rule.byMonthDay) {
    for (const md of rule.byMonthDay) { const d = md > 0 ? md : n + md + 1; if (d >= 1 && d <= n) set.add(d); }
  } else if (rule.byDay) {
    for (const { ord, day } of rule.byDay) {
      const hits: number[] = [];
      for (let d = 1; d <= n; d++) if (dow(y, m, d) === day) hits.push(d);
      if (ord === 0) hits.forEach((d) => set.add(d));
      else { const d = ord > 0 ? hits[ord - 1] : hits[hits.length + ord]; if (d) set.add(d); }
    }
  } else if (fallbackDay <= n) set.add(fallbackDay);
  return [...set].sort((a, b) => a - b);
}

/**
 * 把规则展开成一串开始时刻（墙上时间，沿用首次的时分和时区），只要落在 [from, to] 这段本地日期里的。
 * COUNT 从首次算起、按生成顺序数；EXDATE 在这之后才去。最多走 2000 步，防止坏规则。
 */
export function expandRule(start: WallTime, rule: Rule, from: string, to: string): WallTime[] {
  const out: WallTime[] = [];
  const base = { ...start };
  const dateOf = (w: WallTime) => toLocal(w).date;
  let made = 0, steps = 0;
  const push = (y: number, m: number, d: number): boolean => {
    const w: WallTime = { ...base, y, m, d };
    const ms = wallToMs(w);
    if (rule.until !== undefined && ms > rule.until) return false;
    made++;
    const date = dateOf(w);
    if (date >= from && date <= to) out.push(w);
    if (rule.count !== undefined && made >= rule.count) return false;
    return date <= to;
  };
  if (rule.freq === 'DAILY') {
    const d = new Date(base.y, base.m - 1, base.d);
    while (steps++ < 2000) {
      if (!push(d.getFullYear(), d.getMonth() + 1, d.getDate())) break;
      d.setDate(d.getDate() + rule.interval);
    }
  } else if (rule.freq === 'WEEKLY') {
    const days = (rule.byDay?.map((b) => b.day) ?? [dow(base.y, base.m, base.d)]).sort((a, b) => a - b);
    // 周从周一起算（Google 默认 WKST=MO）；首次所在的那周开始，早于首次的不算
    const first = new Date(base.y, base.m - 1, base.d);
    const monday = new Date(first);
    monday.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const startMs = first.getTime();
    outer: while (steps++ < 2000) {
      for (const wd of days) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + ((wd + 6) % 7));
        if (d.getTime() < startMs) continue;
        if (!push(d.getFullYear(), d.getMonth() + 1, d.getDate())) break outer;
      }
      monday.setDate(monday.getDate() + 7 * rule.interval);
    }
  } else if (rule.freq === 'MONTHLY') {
    let y = base.y, m = base.m;
    outer: while (steps++ < 2000) {
      for (const d of monthDays(y, m, rule, base.d)) {
        if (y === base.y && m === base.m && d < base.d) continue;
        if (!push(y, m, d)) break outer;
      }
      m += rule.interval;
      while (m > 12) { m -= 12; y++; }
    }
  } else {
    const months = rule.byMonth ?? [base.m];
    let y = base.y;
    outer: while (steps++ < 2000) {
      for (const m of months) {
        for (const d of monthDays(y, m, rule, base.d)) {
          if (y === base.y && (m < base.m || (m === base.m && d < base.d))) continue;
          if (!push(y, m, d)) break outer;
        }
      }
      y += rule.interval;
    }
  }
  return out;
}

// ---------- 日历 ----------

export function parseIcs(text: string): IcsCalendar {
  const lines = unfold(text);
  const cal: IcsCalendar = { name: '', events: [] };
  let cur: Partial<IcsEvent> & { exdates: string[]; exRaw: { v: string; p: Record<string, string> }[]; recRaw?: { v: string; p: Record<string, string> } } | null = null;
  let depth = 0; // VEVENT 里再套 VALARM 之类的要跳过
  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      if (p.value.toUpperCase() === 'VEVENT' && !cur) cur = { exdates: [], exRaw: [], cancelled: false, allDay: false };
      else if (cur) depth++;
      continue;
    }
    if (p.name === 'END') {
      if (cur && depth > 0) { depth--; continue; }
      if (cur && p.value.toUpperCase() === 'VEVENT') {
        if (cur.uid && cur.start) {
          const e: IcsEvent = {
            uid: cur.uid, title: cur.title || '（无标题）', start: cur.start, allDay: cur.start.h === undefined,
            exdates: cur.exRaw.map((x) => { const w = parseWallTime(x.v, x.p); return w ? occurrenceKey(cur!.uid!, w) : ''; }).filter(Boolean),
            cancelled: !!cur.cancelled,
            ...(cur.place ? { place: cur.place } : {}), ...(cur.end ? { end: cur.end } : {}), ...(cur.rrule ? { rrule: cur.rrule } : {}),
          };
          if (cur.recRaw) { const w = parseWallTime(cur.recRaw.v, cur.recRaw.p); if (w) e.recurrenceId = occurrenceKey(e.uid, w); }
          cal.events.push(e);
        }
        cur = null;
      }
      continue;
    }
    if (!cur) {
      if (p.name === 'X-WR-CALNAME') cal.name = unescapeText(p.value).trim();
      continue;
    }
    if (depth > 0) continue;
    switch (p.name) {
      case 'UID': cur.uid = p.value.trim(); break;
      case 'SUMMARY': cur.title = unescapeText(p.value).replace(/\s+/g, ' ').trim().slice(0, 80); break;
      case 'LOCATION': cur.place = unescapeText(p.value).replace(/\s+/g, ' ').trim().slice(0, 80); break;
      case 'DTSTART': { const w = parseWallTime(p.value, p.params); if (w) cur.start = w; break; }
      case 'DTEND': { const w = parseWallTime(p.value, p.params); if (w) cur.end = w; break; }
      case 'RRULE': { const r = parseRule(p.value); if (r) cur.rrule = r; break; }
      case 'EXDATE': for (const v of p.value.split(',')) cur.exRaw.push({ v, p: p.params }); break;
      case 'RECURRENCE-ID': cur.recRaw = { v: p.value, p: p.params }; break;
      case 'STATUS': cur.cancelled = p.value.trim().toUpperCase() === 'CANCELLED'; break;
    }
  }
  return cal;
}

/** 全天事件的 DTEND 是「次日」（不含）；有时间的同一天才给结束时间 */
function endOf(e: IcsEvent, startWall: WallTime): string | undefined {
  if (!e.end || e.allDay) return undefined;
  // 重复的每一次：结束时间 = 开始 + 首次的时长
  const dur = wallToMs(e.end) - wallToMs(e.start);
  if (dur <= 0) return undefined;
  const s = wallToMs(startWall), endMs = s + dur;
  return localDate(endMs) === localDate(s) ? localTime(endMs) : undefined;
}

function one(e: IcsEvent, startWall: WallTime, key: string): Occurrence {
  const l = toLocal(startWall);
  const endTime = endOf(e, startWall);
  return { key, uid: e.uid, title: e.title, date: l.date, allDay: e.allDay, ...(l.time ? { time: l.time } : {}), ...(endTime ? { endTime } : {}), ...(e.place ? { place: e.place } : {}) };
}

/**
 * 把日历展开成 [from, to] 这段本地日期里的每一次。
 * 重复事件按规则展开，去掉 EXDATE 和被单独改过的那几次（改动版自己作为一条进来，取消的就没了）。
 * key：单次事件就是 UID；重复事件的每一次是 UID/原定开始时刻（改动版也用原定的那次，挪了时间还认得出）。
 */
export function expandCalendar(cal: IcsCalendar, from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  const overridden = new Set<string>();
  for (const e of cal.events) if (e.recurrenceId) overridden.add(e.recurrenceId);
  for (const e of cal.events) {
    if (e.recurrenceId) {
      if (e.cancelled) continue;
      const o = one(e, e.start, e.recurrenceId);
      if (o.date >= from && o.date <= to) out.push(o);
      continue;
    }
    if (e.cancelled) continue;
    if (!e.rrule) {
      // 单次事件只认 UID：挪了时间还是同一条，做没做的状态跟着走
      const o = one(e, e.start, e.uid);
      if (o.date >= from && o.date <= to) out.push(o);
      continue;
    }
    const ex = new Set(e.exdates);
    for (const w of expandRule(e.start, e.rrule, from, to)) {
      const key = occurrenceKey(e.uid, w);
      if (ex.has(key) || overridden.has(key)) continue;
      out.push(one(e, w, key));
    }
  }
  return out;
}
