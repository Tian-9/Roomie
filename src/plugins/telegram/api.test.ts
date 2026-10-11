import { describe, it, expect, vi } from 'vitest';
import { isValidToken, isValidChatId, maskToken, chunk, formatNotice, call, describe as describeErr, pickChat, chatTitle, normalizeChatId, Outbox, TgError, type TgUpdate } from './api';

const TOKEN = '123456789:AAHxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456';

function fakeFetch(handler: (url: string, body: Record<string, unknown>) => { status?: number; json: unknown }) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    const r = handler(String(url), body);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  return { f: f as unknown as typeof fetch, calls };
}

describe('telegram/api 校验与格式', () => {
  it('token 和 chat id 的形状', () => {
    expect(isValidToken(TOKEN)).toBe(true);
    expect(isValidToken(' ' + TOKEN + ' ')).toBe(true);
    expect(isValidToken('abc')).toBe(false);
    expect(isValidToken('123:short')).toBe(false);
    expect(isValidChatId('123456')).toBe(true);
    expect(isValidChatId('-1001234567890')).toBe(true);
    expect(isValidChatId('@my_channel')).toBe(true);
    expect(isValidChatId('me')).toBe(false);
    expect(isValidChatId('')).toBe(false);
    expect(normalizeChatId('123')).toBe(123);
    expect(normalizeChatId('@ch')).toBe('@ch');
  });

  it('token 只露头尾', () => {
    expect(maskToken(TOKEN)).toBe('123456789:••••3456');
    expect(maskToken('')).toBe('');
  });

  it('分段：按行切，不超过上限，单行过长硬切', () => {
    expect(chunk('')).toEqual([]);
    expect(chunk('短')).toEqual(['短']);
    const parts = chunk(['一'.repeat(10), '二'.repeat(10), '三'.repeat(10)].join('\n'), 25);
    expect(parts).toEqual(['一'.repeat(10) + '\n' + '二'.repeat(10), '三'.repeat(10)]);
    expect(chunk('x'.repeat(30), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(10)]);
    for (const p of chunk('a\n'.repeat(5000))) expect(p.length).toBeLessThanOrEqual(4096);
  });

  it('通知条变文字：标题 + 正文，正文已含标题就不重复', () => {
    expect(formatNotice('开会', '15:00 · 到点了')).toBe('开会\n15:00 · 到点了');
    expect(formatNotice('开会')).toBe('开会');
    expect(formatNotice('阿泽', '阿泽说早')).toBe('阿泽说早');
  });

  it('错误翻成人话', () => {
    expect(describeErr({ ok: false, error_code: 401, description: 'Unauthorized' })).toBe('Bot Token 不对');
    expect(describeErr({ ok: false, error_code: 400, description: 'Bad Request: chat not found' })).toMatch(/找不到这个会话/);
    expect(describeErr({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 7 } })).toMatch(/7 秒/);
    expect(describeErr({ ok: false, error_code: 400, description: 'Bad Request: something odd' })).toBe('Telegram：something odd');
  });
});

describe('telegram/api 调用', () => {
  it('POST JSON 到 bot<token>/<method>，ok=false 抛 TgError', async () => {
    const { f, calls } = fakeFetch((url) => (url.endsWith('/getMe') ? { json: { ok: true, result: { id: 1, is_bot: true, first_name: 'Roomie', username: 'roomie_bot' } } } : { status: 401, json: { ok: false, error_code: 401, description: 'Unauthorized' } }));
    const me = await call<{ username: string }>(TOKEN, 'getMe', {}, f);
    expect(me.username).toBe('roomie_bot');
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
    await expect(call(TOKEN, 'sendMessage', { chat_id: 1, text: 'hi' }, f)).rejects.toMatchObject({ name: 'TgError', code: 401, message: 'Bot Token 不对' });
  });

  it('网络断了也是 TgError', async () => {
    const f = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await expect(call(TOKEN, 'getMe', {}, f)).rejects.toBeInstanceOf(TgError);
  });

  it('从 getUpdates 里挑出私聊，没私聊就最新的会话', () => {
    const ups: TgUpdate[] = [
      { update_id: 1, message: { message_id: 1, date: 1, chat: { id: -100, type: 'supergroup', title: '一个群' }, text: 'x' } },
      { update_id: 2, message: { message_id: 2, date: 2, chat: { id: 42, type: 'private', first_name: '小', last_name: '天' }, text: 'hi' } },
      { update_id: 3, message: { message_id: 3, date: 3, chat: { id: -200, type: 'group', title: '另一个群' }, text: 'y' } },
    ];
    expect(pickChat(ups)).toEqual({ id: '42', title: '小 天' });
    expect(pickChat(ups.filter((u) => u.message!.chat.type !== 'private'))).toEqual({ id: '-200', title: '另一个群' });
    expect(pickChat([])).toBeNull();
    expect(chatTitle({ id: 7, type: 'private', username: 'tian' })).toBe('@tian');
    expect(chatTitle({ id: -1, type: 'channel', username: 'news' })).toBe('@news');
  });

  it('队列按顺序发，长文分段，429 等 retry_after 后重发一次', async () => {
    let n = 0;
    const { f, calls } = fakeFetch((_u, body) => {
      n++;
      if (n === 2) return { status: 429, json: { ok: false, error_code: 429, description: 'Too Many Requests: retry after 3', parameters: { retry_after: 3 } } };
      return { json: { ok: true, result: { message_id: n, date: 0, chat: { id: 42, type: 'private' }, text: body.text } } };
    });
    const waited: number[] = [];
    const box = new Outbox(f, async (ms) => { waited.push(ms); });
    const a = box.send(TOKEN, '42', 'A');
    const b = box.send(TOKEN, '42', 'B');
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.map((m) => m.text)).toEqual(['A']);
    expect(rb.map((m) => m.text)).toEqual(['B']);
    expect(waited).toEqual([3000]);
    expect(calls.map((c) => c.body.text)).toEqual(['A', 'B', 'B']);
    expect(calls[0]!.body).toMatchObject({ chat_id: 42, disable_web_page_preview: true });

    const long = await box.send(TOKEN, '42', 'x'.repeat(5000));
    expect(long).toHaveLength(2);
  });

  it('队列里一条失败不影响后面的', async () => {
    let n = 0;
    const { f } = fakeFetch(() => {
      n++;
      if (n === 1) return { status: 400, json: { ok: false, error_code: 400, description: 'Bad Request: chat not found' } };
      return { json: { ok: true, result: { message_id: n, date: 0, chat: { id: 1, type: 'private' } } } };
    });
    const box = new Outbox(f);
    await expect(box.send(TOKEN, '1', 'a')).rejects.toMatchObject({ code: 400 });
    await expect(box.send(TOKEN, '1', 'b')).resolves.toHaveLength(1);
  });
});
