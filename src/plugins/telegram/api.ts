/**
 * Telegram Bot API 的最小封装：普通 HTTPS，浏览器直连 api.telegram.org，不要服务器。
 * 纯函数 + 可注入 fetch，便于测试。
 */

export const API = 'https://api.telegram.org';
/** 一条消息最多这么多字符，超过要分段 */
export const MAX_LEN = 4096;

export interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}
export interface TgUser { id: number; is_bot: boolean; first_name: string; username?: string }
export interface TgChat { id: number; type: 'private' | 'group' | 'supergroup' | 'channel'; title?: string; first_name?: string; last_name?: string; username?: string }
export interface TgMessage { message_id: number; date: number; chat: TgChat; text?: string; from?: TgUser }
export interface TgUpdate { update_id: number; message?: TgMessage; channel_post?: TgMessage; my_chat_member?: { chat: TgChat } }

export class TgError extends Error {
  constructor(message: string, public code = 0, public retryAfter = 0) {
    super(message);
    this.name = 'TgError';
  }
}

/** BotFather 给的 token：数字 id + 冒号 + 一串字母数字 */
export function isValidToken(t: string): boolean {
  return /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(t.trim());
}
/** chat id：数字（群是负数），或 @频道名 */
export function isValidChatId(s: string): boolean {
  const v = s.trim();
  return /^-?\d{1,20}$/.test(v) || /^@[A-Za-z0-9_]{5,}$/.test(v);
}
/** 界面上显示 token 只露头尾 */
export function maskToken(t: string): string {
  const v = t.trim();
  if (!v) return '';
  const i = v.indexOf(':');
  const head = i > 0 ? v.slice(0, i) : v.slice(0, 4);
  return `${head}:••••${v.slice(-4)}`;
}

/** 按行切成不超过 max 的几段；单行太长就硬切 */
export function chunk(text: string, max = MAX_LEN): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const out: string[] = [];
  let cur = '';
  for (const line of t.split('\n')) {
    if (line.length > max) {
      if (cur) { out.push(cur); cur = ''; }
      for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max));
      continue;
    }
    const next = cur ? `${cur}\n${line}` : line;
    if (next.length > max) { out.push(cur); cur = line; }
    else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

/** 通知条的一条变成一段文字：标题一行，正文一行 */
export function formatNotice(title: string, body?: string): string {
  const t = title.trim();
  const b = (body ?? '').trim();
  if (!b) return t;
  if (!t || b.startsWith(t)) return b;
  return `${t}\n${b}`;
}

/** 调一个方法。网络错、HTTP 错、ok=false 都抛 TgError；429 带 retryAfter（秒） */
export async function call<T>(token: string, method: string, params: Record<string, unknown> = {}, f: typeof fetch = fetch): Promise<T> {
  let res: Response;
  try {
    res = await f(`${API}/bot${token.trim()}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch (e) {
    throw new TgError(`连不上 Telegram：${e instanceof Error ? e.message : String(e)}`);
  }
  let data: TgResponse<T> | null = null;
  try { data = (await res.json()) as TgResponse<T>; } catch { /* 不是 JSON */ }
  if (!data || typeof data !== 'object') throw new TgError(`Telegram 回了看不懂的东西（HTTP ${res.status}）`, res.status);
  if (!data.ok) throw new TgError(describe(data), data.error_code ?? res.status, data.parameters?.retry_after ?? 0);
  return data.result as T;
}

/** Telegram 的英文错误翻成人话 */
export function describe(r: TgResponse<unknown>): string {
  const d = r.description ?? '';
  const code = r.error_code ?? 0;
  if (code === 401 || /unauthorized/i.test(d)) return 'Bot Token 不对';
  if (/chat not found/i.test(d)) return '找不到这个会话：先在 Telegram 里给 bot 发一句话';
  if (/bot was blocked/i.test(d)) return 'bot 被你拉黑了，去 Telegram 里解除';
  if (/bot can't initiate conversation/i.test(d)) return '要你先在 Telegram 里给 bot 发一句话，它才能给你发';
  if (code === 429) return `发得太快，Telegram 让等 ${r.parameters?.retry_after ?? '几'} 秒`;
  if (/message is too long/i.test(d)) return '这条太长了';
  return d ? `Telegram：${d.replace(/^Bad Request:\s*/i, '')}` : `Telegram 出错（${code}）`;
}

export function getMe(token: string, f?: typeof fetch): Promise<TgUser> {
  return call<TgUser>(token, 'getMe', {}, f);
}

export async function sendMessage(token: string, chatId: string, text: string, f?: typeof fetch): Promise<TgMessage> {
  return call<TgMessage>(token, 'sendMessage', { chat_id: normalizeChatId(chatId), text, disable_web_page_preview: true }, f);
}

export function normalizeChatId(s: string): string | number {
  const v = s.trim();
  return /^-?\d+$/.test(v) ? Number(v) : v;
}

export function getUpdates(token: string, f?: typeof fetch): Promise<TgUpdate[]> {
  return call<TgUpdate[]>(token, 'getUpdates', { limit: 100, timeout: 0, allowed_updates: ['message', 'channel_post', 'my_chat_member'] }, f);
}

/** 从 getUpdates 里挑出"你"：最新的一个私聊优先，没有就最新的任何会话 */
export function pickChat(updates: TgUpdate[]): { id: string; title: string } | null {
  const chats: TgChat[] = [];
  for (const u of updates) {
    const c = u.message?.chat ?? u.channel_post?.chat ?? u.my_chat_member?.chat;
    if (c) chats.push(c);
  }
  if (!chats.length) return null;
  const pick = [...chats].reverse().find((c) => c.type === 'private') ?? chats[chats.length - 1]!;
  return { id: String(pick.id), title: chatTitle(pick) };
}

export function chatTitle(c: TgChat): string {
  if (c.type === 'private') return [c.first_name, c.last_name].filter(Boolean).join(' ') || (c.username ? '@' + c.username : String(c.id));
  return c.title || (c.username ? '@' + c.username : String(c.id));
}

/**
 * 发送队列：一条条按顺序发，429 按 retry_after 等一次再发；别的错直接报给调用方。
 * 一个页面只有一个队列，补发的几段话和到点提醒不会抢着发。
 */
export class Outbox {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private f: typeof fetch = fetch, private wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}

  send(token: string, chatId: string, text: string): Promise<TgMessage[]> {
    const run = async () => {
      const out: TgMessage[] = [];
      for (const part of chunk(text)) out.push(await this.one(token, chatId, part));
      return out;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  private async one(token: string, chatId: string, text: string): Promise<TgMessage> {
    try {
      return await sendMessage(token, chatId, text, this.f);
    } catch (e) {
      if (e instanceof TgError && e.code === 429 && e.retryAfter > 0 && e.retryAfter <= 60) {
        await this.wait(e.retryAfter * 1000);
        return sendMessage(token, chatId, text, this.f);
      }
      throw e;
    }
  }
}
