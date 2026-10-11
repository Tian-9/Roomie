/**
 * 动态插件的纯函数：日期、材料的文字版、正文清洗、回他一句的预填。
 * 不碰库、不碰模型，便于单测。金额都是分，日期都是 YYYY-MM-DD。
 */

export interface Post {
  id: string;
  /** 发它的时候是哪个人设 */
  characterId: string;
  /** 这条说的是哪一天（补发说的是离开前的那段，取最后一天；聊天里发的就是当天） */
  date: string;
  text: string;
  createdAt: number;
  /** 来源：补发时发的 / 聊天里顺手发的 / 你让他现在发的 */
  source: 'catchup' | 'chat' | 'manual';
  /** 你点了心 */
  liked: boolean;
  /** 写这条时看到的材料，一行一项，给人看 */
  material: string[];
}

export interface Material {
  from: string;
  to: string;
  /** 聊了多少条（你和他的，不含系统消息） */
  messages: number;
  /** 对话原文，只进提示词 */
  transcript: string;
  /** 账本：花了多少、几笔、前几笔；没装就没有 */
  spent?: { total: number; count: number; lines: string[] };
  /** 习惯一行 */
  habits?: string;
  /** 日程：做完的、没做的、今天的 */
  schedule?: { done: string[]; missed: string[]; today: string[] };
  /** 今天的农历 / 节气 / 假期一行 */
  dayLine?: string;
  /** 今天的天气一行 */
  weather?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function dayStart(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d).getTime();
}
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return ymd(new Date(y!, m! - 1, d! + n));
}
export const weekdayOf = (date: string) => ['日', '一', '二', '三', '四', '五', '六'][new Date(dayStart(date)).getDay()]!;

/** 分 → 「¥12.50」，整数不带小数 */
export function yuan(fen: number): string {
  const v = fen / 100;
  return '¥' + (Number.isInteger(v) ? String(v) : v.toFixed(2));
}

/** 补发看的区间：离开几天就看几天（最多 3 天，动态不是复盘，不用翻太久），到昨天为止 */
export function window(today: string, days: number): { from: string; to: string } {
  const n = Math.min(3, Math.max(1, days));
  return { from: addDays(today, -n), to: addDays(today, -1) };
}

/** 「刚刚 / 5 分钟前 / 3 小时前 / 昨天 / 10/8」 */
export function ago(ts: number, now = Date.now()): string {
  const d = now - ts;
  if (d < 60_000) return '刚刚';
  if (d < 3600_000) return Math.floor(d / 60_000) + ' 分钟前';
  if (d < 86400_000) return Math.floor(d / 3600_000) + ' 小时前';
  if (ymd(new Date(ts)) === addDays(ymd(new Date(now)), -1)) return '昨天';
  const t = new Date(ts);
  return `${t.getMonth() + 1}/${t.getDate()}`;
}

/** 模型给的正文：去掉首尾引号、话题标签，限长 */
export function cleanText(raw: unknown, max = 300): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/^["“「『]|["”」』]$/g, '').replace(/#[^\s#]+/g, '').replace(/[ \t]+\n/g, '\n').trim().slice(0, max);
}

/** 正文摘一句给预填和通知用 */
export function excerpt(text: string, max = 30): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max) + '…' : one;
}

/** 「回他一句」进对话时预填的开头：带上原文，他在对话里才知道你说的是哪条（触发词也靠它命中） */
export function replyDraft(text: string): string {
  return `你发的那条「${excerpt(text)}」，`;
}

/** 材料的文字版，给提示词 */
export function describeMaterial(m: Material, youName: string): string {
  const span = m.from === m.to ? `${m.from}（周${weekdayOf(m.from)}）` : `${m.from} 到 ${m.to}`;
  const lines: string[] = [];
  lines.push(`${span} 你们聊了 ${m.messages} 条。${m.transcript ? '\n' + m.transcript : '（没有说话）'}`);
  if (m.spent) lines.push(m.spent.count ? `${youName}花了 ${yuan(m.spent.total)}，${m.spent.count} 笔：${m.spent.lines.join('、')}` : `${youName}没记账。`);
  if (m.habits) lines.push(m.habits);
  if (m.schedule) {
    const s = m.schedule;
    const parts = [s.done.length ? `做完了：${s.done.join('、')}` : '', s.missed.length ? `没做的：${s.missed.join('、')}` : '', s.today.length ? `今天有：${s.today.join('、')}` : ''].filter(Boolean);
    if (parts.length) lines.push(parts.join('；'));
  }
  if (m.dayLine) lines.push(`今天：${m.dayLine}`);
  if (m.weather) lines.push(`天气：${m.weather}`);
  return lines.join('\n');
}

/** 材料的一行一项，存在动态里给人看（不含对话原文） */
export function materialLines(m: Material): string[] {
  const out: string[] = [];
  out.push(m.messages ? `聊了 ${m.messages} 条` : '没说话');
  if (m.spent?.count) out.push(`花了 ${yuan(m.spent.total)}`);
  if (m.habits) out.push(m.habits.replace(/\s+/g, ' ').slice(0, 40));
  if (m.schedule) {
    if (m.schedule.done.length) out.push(`做完 ${m.schedule.done.length} 件`);
    if (m.schedule.missed.length) out.push(`落下 ${m.schedule.missed.length} 件`);
  }
  if (m.weather) out.push(m.weather.slice(0, 30));
  return out;
}

/** 最近发过的几条，给提示词里「别重复」 */
export function recentLines(posts: { text: string; createdAt: number }[], n = 3): string {
  return posts.slice(0, n).map((p) => '- ' + excerpt(p.text, 60)).join('\n') || '（无）';
}
