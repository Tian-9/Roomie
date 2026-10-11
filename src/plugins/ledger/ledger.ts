/**
 * 记账的纯函数部分：金额、分类、日期、周月范围、合计、CSV。不碰库、不碰 Svelte，方便单测。
 * 金额一律用整数分；日期一律 YYYY-MM-DD 字符串（本地时间）。
 */

export const CATEGORIES = ['餐饮', '交通', '购物', '居住', '娱乐', '其他'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Entry {
  id: string;
  /** 分，整数 */
  amount: number;
  category: Category;
  note: string;
  /** YYYY-MM-DD */
  date: string;
  /** 记录时刻（毫秒），同一天内按它排序 */
  ts: number;
  source: 'tool' | 'manual';
}

/** 单笔上限：100 万元 */
export const MAX_AMOUNT = 100_000_000;

/**
 * 解析金额成分。只接受数字或纯数字字符串（"28"、"28.5"、"¥28"、"28元"），
 * "二十八"、"两杯"、负数、0、NaN 一律 null：自然语言由模型翻成数字，插件不猜。
 */
export function parseAmount(input: unknown): number | null {
  let n: number;
  if (typeof input === 'number') n = input;
  else if (typeof input === 'string') {
    const s = input.trim().replace(/^[¥￥$]/, '').replace(/(元|块|rmb)$/i, '').replace(/,/g, '').trim();
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    n = Number(s);
  } else return null;
  if (!Number.isFinite(n) || n <= 0) return null;
  const cents = Math.round(n * 100);
  if (cents <= 0 || cents > MAX_AMOUNT) return null;
  return cents;
}

/** 分类归一：认识的原样返回，不认识的归「其他」 */
export function normalizeCategory(input: unknown): Category {
  const s = String(input ?? '').trim();
  const direct = CATEGORIES.find((c) => c === s);
  if (direct) return direct;
  const alias: Record<string, Category> = {
    吃饭: '餐饮', 吃: '餐饮', 外卖: '餐饮', 饮食: '餐饮', 食物: '餐饮', 零食: '餐饮', 奶茶: '餐饮', 咖啡: '餐饮', food: '餐饮', dining: '餐饮',
    打车: '交通', 出行: '交通', 地铁: '交通', 公交: '交通', 加油: '交通', 停车: '交通', transport: '交通', taxi: '交通',
    买东西: '购物', 衣服: '购物', 网购: '购物', 日用: '购物', shopping: '购物',
    房租: '居住', 水电: '居住', 住: '居住', 房: '居住', 物业: '居住', housing: '居住', rent: '居住',
    玩: '娱乐', 游戏: '娱乐', 电影: '娱乐', 旅游: '娱乐', 运动: '娱乐', entertainment: '娱乐', fun: '娱乐',
  };
  return alias[s] ?? alias[s.toLowerCase()] ?? '其他';
}

export function ymd(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 校验 YYYY-MM-DD 是真实日期；不合法返回 null */
export function parseDate(input: unknown): string | null {
  const s = String(input ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? s : null;
}

function shift(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return ymd(new Date(y!, m! - 1, d! + days));
}

/** 周一到周日。返回 [from, to]，都是含的 */
export function weekRange(date = ymd()): { from: string; to: string } {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(y!, m! - 1, d!).getDay(); // 0 = 周日
  const back = (dow + 6) % 7;
  const from = shift(date, -back);
  return { from, to: shift(from, 6) };
}

export function lastWeekRange(date = ymd()): { from: string; to: string } {
  const { from } = weekRange(date);
  return { from: shift(from, -7), to: shift(from, -1) };
}

export function monthRange(date = ymd()): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(y!, m!, 0).getDate();
  const p = date.slice(0, 7);
  return { from: `${p}-01`, to: `${p}-${String(last).padStart(2, '0')}` };
}

export function inRange(e: Pick<Entry, 'date'>, from: string, to: string): boolean {
  return e.date >= from && e.date <= to;
}

export function sum(entries: Pick<Entry, 'amount'>[]): number {
  return entries.reduce((s, e) => s + e.amount, 0);
}

/** 按分类合计，金额大的在前，只含有记录的分类 */
export function byCategory(entries: Pick<Entry, 'amount' | 'category'>[]): { category: Category; amount: number }[] {
  const m = new Map<Category, number>();
  for (const e of entries) m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
  return [...m].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}

/** 按天分组，新的一天在前，同一天里新的在前 */
export function byDay(entries: Entry[]): { date: string; total: number; items: Entry[] }[] {
  const m = new Map<string, Entry[]>();
  for (const e of entries) (m.get(e.date) ?? m.set(e.date, []).get(e.date)!).push(e);
  return [...m]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, items]) => ({ date, items: items.sort((a, b) => b.ts - a.ts), total: sum(items) }));
}

/** ¥1,234 / ¥28.50：整数不带小数 */
export function yuan(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = abs % 100;
  return `${sign}¥${whole}${frac ? '.' + String(frac).padStart(2, '0') : ''}`;
}

/** 给模型看的一行：本周已花 ¥320（餐饮 ¥200、交通 ¥120） */
export function summaryLine(label: string, entries: Pick<Entry, 'amount' | 'category'>[], top = 3): string {
  if (!entries.length) return `${label}还没记过账`;
  const cats = byCategory(entries).slice(0, top).map((c) => `${c.category} ${yuan(c.amount)}`).join('、');
  return `${label}已花 ${yuan(sum(entries))}（${cats}）`;
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** 导出 CSV：带 BOM 让 Excel 认 UTF-8；金额列是元 */
export function toCSV(entries: Entry[]): string {
  const rows = [['日期', '金额', '分类', '备注', '来源'].join(',')];
  for (const e of [...entries].sort((a, b) => (a.date === b.date ? a.ts - b.ts : a.date < b.date ? -1 : 1))) {
    rows.push([e.date, (e.amount / 100).toFixed(2), e.category, csvCell(e.note), e.source === 'tool' ? '他记的' : '手记'].join(','));
  }
  return '﻿' + rows.join('\n') + '\n';
}

/** 周一到周三算「新一周刚开始」，这时候回来才说上周花销 */
export function isEarlyWeek(d = new Date()): boolean {
  const dow = d.getDay();
  return dow >= 1 && dow <= 3;
}
