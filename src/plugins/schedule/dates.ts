/**
 * 日期纯函数。日期一律 YYYY-MM-DD、时间一律 HH:mm 的字符串，按本地时区算。
 * 自然语言（"明天下午三点"）由模型换算成 ISO 再交给插件，这里只校验不解析。
 */

export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function isoDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 严格校验 YYYY-MM-DD（2 月 30 日这种不算） */
export function parseDate(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
}

export const isValidDate = (s: unknown): s is string => parseDate(s) !== null;

/** 严格校验 HH:mm（24 小时制，允许 9:30 → 09:30 这种补零） */
export function normalizeTime(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

export function addDays(iso: string, n: number): string {
  const d = parseDate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/** 两个日期相差的天数（b - a） */
export function daysBetween(a: string, b: string): number {
  const da = parseDate(a), db = parseDate(b);
  if (!da || !db) return 0;
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86400_000);
}

export function weekday(iso: string): string {
  const d = parseDate(iso);
  return d ? '周' + WEEKDAYS[d.getDay()] : '';
}

/** 某天某时的本地毫秒时间戳；没时间就是当天 0 点 */
export function atTime(iso: string, time?: string | null): number {
  const d = parseDate(iso);
  if (!d) return 0;
  const t = time ? normalizeTime(time) : null;
  if (t) { const [h, m] = t.split(':').map(Number); d.setHours(h!, m!, 0, 0); }
  return d.getTime();
}

/** 10/12 这种短日期 */
export function shortDate(iso: string): string {
  const d = parseDate(iso);
  return d ? `${d.getMonth() + 1}/${d.getDate()}` : iso;
}

/** 10月12日 */
export function longDate(iso: string): string {
  const d = parseDate(iso);
  return d ? `${d.getMonth() + 1}月${d.getDate()}日` : iso;
}

/** 相对今天怎么叫：今天 / 明天 / 后天 / 昨天 / 周五 10/17 / 10月17日（超过一周）/ 2027年1月1日（跨年） */
export function relativeLabel(iso: string, today = isoDate()): string {
  const diff = daysBetween(today, iso);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  if (diff === -1) return '昨天';
  if (diff > 0 && diff < 7) return `${weekday(iso)} ${shortDate(iso)}`;
  if (iso.slice(0, 4) !== today.slice(0, 4)) return `${iso.slice(0, 4)}年${longDate(iso)}`;
  return longDate(iso);
}

/** 给模型和卡片看的一句：明天 15:00 / 周五 10/17 */
export function whenLabel(date: string, time?: string | null, today = isoDate()): string {
  const d = relativeLabel(date, today);
  return time ? `${d} ${time}` : d;
}
