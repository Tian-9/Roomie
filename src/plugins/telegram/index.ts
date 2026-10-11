import { definePlugin, gradients } from '$kernel/api';
import type { PluginContext, PromptContext } from '$kernel/api';
import Telegram from './Telegram.svelte';
import { Outbox, getMe, getUpdates, pickChat, formatNotice, isValidToken, isValidChatId, TgError, type TgUser } from './api';

export { isValidToken, isValidChatId, maskToken } from './api';

/**
 * Telegram 推送：他说的话经 Bot API 发到你手机上的 Telegram。
 *
 * 诚实的限制：发消息的是这个页面。Bot API 是普通 HTTPS，浏览器直连 api.telegram.org，不要服务器，
 * 但页面全关着就没人发。所以它的用法是：电脑上留一个标签页开着，手机 Telegram 能收到到点提醒和他回来时说的话。
 * 在 Telegram 里回他，他看不到；要聊回这里来。
 */

export const ICON = { paths: ['M21 4L3 11l7 3 3 7 8-17z', 'M10 14l11-10'], background: gradients.blue };

/** 设置（ctx.settings），token 不在这里，在 ctx.secrets */
export interface TgSettings {
  chatId: string;
  chatTitle: string;
  /** 转发通知条：到点提醒、他回来时说的话的摘要 */
  notices: boolean;
  /** 转发他回来时主动说的整段话（补发合成的那条） */
  say: boolean;
}
export const DEFAULTS: TgSettings = { chatId: '', chatTitle: '', notices: true, say: true };

/** 最近一次发送的结果，设置页显示用 */
export interface LastSent { at: number; ok: boolean; text: string; error?: string }

let ctx: PluginContext | null = null;
const outbox = new Outbox();
/** 补发合成的消息在 catchup.done 之前刚写进对话，往回找这么久以内的 */
const SAY_WINDOW = 5 * 60_000;
/**
 * 通知条先攒一会儿再发：几秒内的几条并成一条；补发过程中各插件弹的"他写了复盘"之类，
 * 等 catchup.done 来了就整个丢掉，只发他合成的那一整段，手机上不会连收三四条。
 */
const NOTICE_DELAY = 2500;
let pending: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function queueNotice(text: string) {
  pending.push(text);
  if (!flushTimer) flushTimer = setTimeout(flushNotices, NOTICE_DELAY);
}
function dropNotices() {
  pending = [];
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
}
function flushNotices() {
  flushTimer = null;
  const batch = pending.splice(0);
  if (batch.length) telegramApi.send(batch.join('\n\n')).catch(() => {});
}

export const telegramApi = {
  settings: async (): Promise<TgSettings> => ({ ...DEFAULTS, ...(await ctx!.settings.get<Partial<TgSettings>>('settings', {})) }),
  async save(patch: Partial<TgSettings>) {
    const next = { ...(await this.settings()), ...patch };
    await ctx!.settings.set('settings', next);
    return next;
  },
  token: () => ctx!.secrets.get('botToken'),
  setToken: (t: string) => ctx!.secrets.set('botToken', t.trim()),
  last: () => ctx!.settings.get<LastSent | null>('last', null),
  /** 填好了 token 和 chat id 就算配好了 */
  async configured(): Promise<boolean> {
    if (!ctx || ctx.secrets.locked) return false;
    const [t, s] = await Promise.all([this.token(), this.settings()]);
    return isValidToken(t) && isValidChatId(s.chatId);
  },
  /** 问 Telegram 这个 token 是谁的 bot */
  async me(): Promise<TgUser> {
    const t = await this.token();
    if (!isValidToken(t)) throw new TgError('先填 Bot Token');
    return getMe(t);
  },
  /** 你先给 bot 发过一句话，这里就能从 getUpdates 里找到你的 chat id */
  async discover(): Promise<{ id: string; title: string } | null> {
    const t = await this.token();
    if (!isValidToken(t)) throw new TgError('先填 Bot Token');
    const found = pickChat(await getUpdates(t));
    if (found) await this.save({ chatId: found.id, chatTitle: found.title });
    return found;
  },
  /**
   * 发一段话。没配好、锁着就静默不发（返回 false）；发失败记在 last 里并抛出去，调用方决定要不要在意。
   */
  async send(text: string): Promise<boolean> {
    if (!ctx || !text.trim()) return false;
    if (!(await this.configured())) return false;
    const [t, s] = await Promise.all([this.token(), this.settings()]);
    try {
      await outbox.send(t, s.chatId, text);
      await ctx.settings.set('last', { at: Date.now(), ok: true, text: text.slice(0, 120) } satisfies LastSent);
      ctx.emit('telegram.sent', { text });
      return true;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await ctx.settings.set('last', { at: Date.now(), ok: false, text: text.slice(0, 120), error } satisfies LastSent);
      console.warn('[telegram] 发送失败', error);
      throw e;
    }
  },
  /** 设置页的"发一条测试" */
  async test(): Promise<void> {
    const name = (await ctx!.data.currentCharacter())?.name ?? 'Roomie';
    await this.send(`${name}：这条是从 Roomie 发来的测试。以后页面开着的时候，到点提醒和我回来时说的话会发到这里。`);
  },
  /** 补发完了：把他刚合成的那条整段转发（通知条只带了前两行） */
  async forwardSay(characterId: string): Promise<boolean> {
    if (!ctx) return false;
    const s = await this.settings();
    if (!s.say) { flushNotices(); return false; }
    // 补发期间攒下的通知条（他写了复盘、周小结…）不发了，合成的那段话已经把事说了
    dropNotices();
    const now = Date.now();
    const msgs = await ctx.data.messages({ from: now - SAY_WINDOW, to: now + 1000 });
    const mine = msgs.filter((m) => m.role === 'assistant' && m.characterId === characterId && m.text.trim());
    const last = mine[mine.length - 1];
    if (!last) return false;
    return this.send(last.text).catch(() => false);
  },
  async forwardNotice(p: { title: string; body?: string; pluginId?: string }): Promise<boolean> {
    if (!ctx) return false;
    if (p.pluginId === 'telegram') return false;
    // 补发那条的通知条是摘要，整段走 forwardSay；它没开才用摘要兜底
    const s = await this.settings();
    if (p.pluginId === 'chat' && s.say) return false;
    if (!s.notices) return false;
    if (!(await this.configured())) return false;
    queueNotice(formatNotice(p.title, p.body));
    return true;
  },
};

export default definePlugin({
  id: 'telegram',
  name: 'Telegram',
  version: '0.1.0',
  description: '页面开着的时候，到点提醒和他主动说的话也发一份到你手机的 Telegram。要自己建一个 Bot，页面关了就不发。',
  app: { screen: Telegram, icon: ICON },
  promptContributors: [{
    id: 'telegram',
    stable: async () => ((await telegramApi.configured()) ? '对方把这里连到了他手机上的 Telegram。他让你把什么东西"发到 Telegram / 发到手机上"，就用 telegram_send 发过去，正文照原样给，不要加称呼和解释。' : ''),
  }],
  tools: [{
    name: 'telegram_send',
    label: '发到 Telegram',
    description: '把一段文字发到对方手机上的 Telegram（对方说"发到我 Telegram""发手机上"时用）。只发纯文字；没设置好会告诉你。',
    inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string', description: '要发的内容' } } },
    async handler(input: unknown, _p: PromptContext) {
      const text = typeof (input as { text?: unknown })?.text === 'string' ? ((input as { text: string }).text).trim() : '';
      if (!text) return '要发什么？内容不能空。';
      if (!(await telegramApi.configured())) return '对方还没把 Telegram 设置好（桌面上的 Telegram 里填 Bot Token 和会话）。告诉他一声就行，别重试。';
      try {
        await telegramApi.send(text);
        return '发到 Telegram 了。';
      } catch (e) {
        return `没发出去：${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }],
  onEvent: {
    notify: (p) => { telegramApi.forwardNotice(p).catch(() => {}); },
    'catchup.done': (p) => { telegramApi.forwardSay(p.characterId).catch(() => {}); },
  },
  setup(c) { ctx = c; },
  // 关掉插件后 onEvent 的订阅还在（内核不解绑），用 ctx 为空来兜底
  teardown() { ctx = null; dropNotices(); },
});
