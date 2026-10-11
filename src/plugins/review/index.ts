import { definePlugin, gradients } from '$kernel/api';
import type { PluginContext, CatchupContext, CatchupItem, MessageView } from '$kernel/api';
import { ulid } from 'ulid';
import Review from './Review.svelte';
import {
  ymd, isYmd, dayStart, addDays, yuan, isMorning, normalizeSettings, weeklyWeek, dailyWindow, describeMaterial, materialLines, reviewTitle,
  type Review as ReviewRow, type Material, type MaterialSummary, type ReviewSettings, type ReviewKind,
} from './review';

export type { Review as ReviewRow, Material, MaterialSummary, ReviewSettings } from './review';
export { reviewTitle, materialLines } from './review';

/**
 * 复盘：离开一天回来，他发来一条消息——早安，昨天聊了什么、花了多少、今天有什么，像人一样三四句话说完。
 * 日记是他写给自己的，复盘是他对你说的，所以是两个插件。
 * 日报登记在补发 d1 档，周小结登记在 attach 档（周日晚上 / 周一挂在下一次回复或补发上），材料从别的插件的服务拿，没装就不提。
 */
export const ICON = { paths: ['M12 4v2', 'm5.3 7.3 1.4 1.4', 'm18.7 7.3-1.4 1.4', 'M3 15h2', 'M19 15h2', 'M7.5 15a4.5 4.5 0 0 1 9 0', 'M4 19h16'], background: gradients.orange };

/** 别的插件的服务，这里只声明用到的最小形状；金额都是分 */
interface LedgerService { range(from: string, to: string): Promise<{ amount: number; category: string; note: string; date: string }[]> }
interface HabitsService { summary(): Promise<string> }
interface ScheduleService { range(from: string, to: string): Promise<{ title: string; date: string; time?: string; done: 0 | 1 }[]>; today(): Promise<{ title: string; date: string; time?: string; done: 0 | 1 }[]> }
interface LunarService { dayLine(date: string): string }

let ctx: PluginContext;

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fmtItem = (i: { title: string; time?: string }) => `${i.time ? i.time + ' ' : ''}${i.title}`;

export const reviewApi = {
  reviews: () => ctx.table<ReviewRow>('reviews'),
  characters: () => ctx.data.characters(),
  current: () => ctx.data.currentCharacter(),
  async settings(): Promise<ReviewSettings> {
    return normalizeSettings(await ctx.settings.get<Partial<ReviewSettings> | null>('settings', null));
  },
  async saveSettings(s: ReviewSettings) {
    await ctx.settings.set('settings', normalizeSettings(s));
  },
  async forDate(kind: ReviewKind, date: string): Promise<ReviewRow | undefined> {
    return this.reviews().where('date').equals(date).filter((r) => r.kind === kind).first();
  },
  async list(): Promise<ReviewRow[]> {
    return (await this.reviews().reverse().sortBy('createdAt'));
  },
  /** 攒一天（或一段）的材料：对话、花销、习惯、日程、今天的节气；装了哪个插件就有哪一项 */
  async material(from: string, to: string, today = ymd()): Promise<Material> {
    const [msgs, you] = await Promise.all([
      ctx.data.messages({ from: dayStart(from), to: dayStart(addDays(to, 1)), limit: 120 }),
      ctx.data.userProfile(),
    ]);
    const talked = msgs.filter((x: MessageView) => x.role !== 'system');
    const transcript = talked.map((x) => `${x.role === 'user' ? you.name || '对方' : '我'}：${x.text.slice(0, 200)}`).join('\n');
    const m: Material = { from, to, messages: talked.length, transcript };

    const ledger = ctx.service<LedgerService>('ledger');
    if (ledger) {
      try {
        const xs = await ledger.range(from, to);
        m.spent = {
          total: xs.reduce((a, e) => a + e.amount, 0), count: xs.length,
          lines: xs.slice(0, 12).map((e) => `${e.category} ${yuan(e.amount)}${e.note ? '（' + e.note + '）' : ''}`),
        };
      } catch { /* 账本没准备好就不提钱 */ }
    }
    const habits = ctx.service<HabitsService>('habits');
    if (habits) { try { const s = await habits.summary(); if (s) m.habits = s; } catch { /* 同上 */ } }
    const schedule = ctx.service<ScheduleService>('schedule');
    if (schedule) {
      try {
        const [past, td] = await Promise.all([schedule.range(from, to), schedule.today()]);
        m.schedule = {
          done: past.filter((i) => i.done).map(fmtItem),
          missed: past.filter((i) => !i.done).map(fmtItem),
          today: td.filter((i) => !i.done && i.date === today).map(fmtItem),
        };
      } catch { /* 同上 */ }
    }
    const lunar = ctx.service<LunarService>('lunar');
    if (lunar) { try { const l = lunar.dayLine(today); if (l) m.dayLine = l; } catch { /* 同上 */ } }
    return m;
  },
  async save(r: Omit<ReviewRow, 'id' | 'createdAt'>): Promise<ReviewRow | null> {
    const text = r.text.trim();
    if (!text) return null;
    const row: ReviewRow = { ...r, id: ulid(), text, createdAt: Date.now() };
    await this.reviews().add(row);
    ctx.emit('review.written', { id: row.id, kind: row.kind, date: row.date });
    return row;
  },
  /** 手动：让他现在复盘昨天（或指定的一天）。补发走内核 catchup，这里只出 text，不往对话里发 */
  async write(date = addDays(ymd(), -1)): Promise<ReviewRow | null> {
    if (!ctx.llm.configured) return null;
    const ch = await ctx.data.currentCharacter();
    if (!ch) return null;
    const [m, you] = await Promise.all([this.material(date, date), ctx.data.userProfile()]);
    const { text } = await ctx.llm.chat({
      system: `你是「${ch.name}」，住在对方手机里的人。设定：${ch.core.slice(0, 800)}\n你在给对方写一段某一天的复盘：${TEXT_RULES}不要提到"用户"这个词，称呼对方用你平时的叫法。只输出正文。`,
      user: `复盘 ${date}。\n${describeMaterial(m, you.name || '对方')}`,
      maxTokens: 500, effort: 'low',
    });
    const { transcript: _t, ...summary } = m;
    return this.save({ kind: 'daily', date, characterId: ch.id, text, say: '', source: 'manual', material: summary });
  },
};

const TEXT_RULES = '80 到 200 字，第二人称对他说，像朋友回看那一天：发生了什么、做成了什么、落下了什么，可以点一下你注意到的事。不要日期标题，不要分点，材料里没有的不要编。';

/** 补发 · 日报：离开 ≥ 24 小时回来，把这段时间复盘一下，顺口跟对方说早安 / 回来了 */
export async function collectDaily(c: CatchupContext, now = new Date()): Promise<CatchupItem | null> {
  const today = ymd(now);
  const { from, to } = dailyWindow(today, Math.max(1, c.days));
  if (await reviewApi.forDate('daily', to)) return null; // 这天复盘过了（手动写过也算）
  const [m, you, s] = await Promise.all([reviewApi.material(from, to, today), ctx.data.userProfile(), reviewApi.settings()]);
  const morning = isMorning(now.getHours(), s);
  const greet = c.days >= 2 ? '好久不见之类的话' : morning ? '早安之类的话' : '「回来了」之类的话';
  const hour = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  const span = from === to ? '昨天' : '这几天';
  // 没装账本就不提钱，没装日程就不提安排：说明里也不留口子
  const topics = [`${span}聊了什么`, ...(m.spent ? ['花了多少'] : []), ...(m.habits ? ['坚持的事怎么样'] : []), ...(m.schedule ? ['今天有什么'] : [])].join('、');
  return {
    label: '复盘',
    greets: true,
    prompt: `现在是 ${hour}，${morning ? '算早上' : '不算早上'}，对方离开了 ${c.elapsedText}。你拿起手机跟他说几句：开头打个招呼（${greet}），然后像人一样三四句话说完——${topics}。材料里没有的就不提，不要编，不要念材料。
say 是发到对话里的这几句（口语、短，不要分点，不超过 120 字）；text 是写进复盘本的一段（${TEXT_RULES}）。
${span}什么都没有的话，text 留空，say 还是要打招呼、随便聊一句。
材料：
${describeMaterial(m, you.name || '对方')}`,
    schema: {
      type: 'object', additionalProperties: false, required: ['text', 'say'],
      properties: { text: { type: 'string', description: '写进复盘本的一段，没东西可写就留空' }, say: { type: 'string', description: '发到对话里的几句，含开头的招呼' } },
    },
    async apply(out: unknown, cc: CatchupContext) {
      const o = (out ?? {}) as { text?: unknown; say?: unknown };
      const { transcript: _t, ...summary } = m;
      const r = await reviewApi.save({ kind: 'daily', date: to, characterId: cc.characterId, text: str(o.text), say: str(o.say, 400), source: 'auto', material: summary });
      if (r) ctx.notify(`${cc.characterName} 写了${span}的复盘`, r.text.slice(0, 60), 'app');
    },
  };
}

/** 补发 · 周小结：周日晚上或周一，挂在下一次回复或补发上，一周一次；设置里可以关 */
export async function collectWeekly(_c: CatchupContext, now = new Date()): Promise<CatchupItem | null> {
  const s = await reviewApi.settings();
  if (!s.weekly) return null;
  const week = weeklyWeek(now);
  if (!week) return null;
  if (await reviewApi.forDate('weekly', week)) return null;
  const to = addDays(week, 6);
  const [m, you, dailies] = await Promise.all([reviewApi.material(week, to, ymd(now)), ctx.data.userProfile(), reviewApi.reviews().where('date').between(week, to, true, true).filter((r) => r.kind === 'daily').toArray()]);
  const dailyText = dailies.sort((a, b) => a.date.localeCompare(b.date)).map((r) => `${r.date}：${r.text.slice(0, 200)}`).join('\n');
  // 周报不需要整周的对话原文，有日报就用日报，没有就只给条数
  const material = { ...m, transcript: dailyText ? '' : m.transcript.split('\n').slice(-40).join('\n') };
  return {
    label: '周小结',
    prompt: `这周（${week} 到 ${to}）过完了，给对方来一份周小结。text 写进复盘本（150 到 250 字，第二人称对他说，回看这一周：聊得多的事、花销、坚持的事、做成和落下的，可以提一句下周；不要日期标题，不要分点，材料里没有的不要编）。
如果你是在回消息，回复里顺口提一句这周的小结就行，say 留空；不是在回消息就把想说的一两句放在 say。
${dailyText ? `这周的每日复盘：\n${dailyText}\n` : ''}材料：
${describeMaterial(material, you.name || '对方')}`,
    schema: {
      type: 'object', additionalProperties: false, required: ['text'],
      properties: { text: { type: 'string', description: '周小结正文' }, say: { type: 'string', description: '不在回消息时顺口说的一两句，在回消息就留空' } },
    },
    async apply(out: unknown, cc: CatchupContext) {
      const o = (out ?? {}) as { text?: unknown; say?: unknown };
      const { transcript: _t, ...summary } = m;
      const r = await reviewApi.save({ kind: 'weekly', date: week, characterId: cc.characterId, text: str(o.text), say: str(o.say, 400), source: 'auto', material: summary });
      if (r) ctx.notify(`${cc.characterName} 写了这周的小结`, r.text.slice(0, 60), 'app');
    },
  };
}

export default definePlugin({
  id: 'review',
  name: '复盘',
  version: '0.1.0',
  description: '离开一天回来，他发来一条消息：早安，昨天聊了什么、花了多少、今天有什么。历次复盘按天留着，周日晚上还有周小结。',
  app: { screen: Review, icon: ICON },
  storage: { tables: { reviews: 'id, date, kind, createdAt' } },
  tools: [{
    name: 'review_read',
    label: '翻复盘',
    description: '翻以前给对方写的复盘。不给日期就列出最近几篇的日期和开头，给日期（YYYY-MM-DD）就读那一天的；周小结的日期是那周的周一。',
    inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD，可选' } } },
    async handler(input: unknown) {
      const date = str((input as { date?: unknown })?.date, 10);
      const all = await reviewApi.list();
      if (!all.length) return '还没写过复盘。';
      if (!date) return all.slice(0, 10).map((r) => `- ${r.date}${r.kind === 'weekly' ? '（周小结）' : ''}：${r.text.slice(0, 40).replace(/\n/g, ' ')}…`).join('\n');
      if (!isYmd(date)) return '日期要写成 YYYY-MM-DD。';
      const hits = all.filter((r) => r.date === date || (r.kind === 'daily' && r.material.from <= date && date <= r.material.to));
      if (!hits.length) return '那天没写复盘。';
      return hits.map((r) => `${reviewTitle(r)}${r.kind === 'weekly' ? '（周小结）' : ''}\n${r.text}\n（${materialLines(r.material).join('；')}）`).join('\n\n');
    },
  }],
  catchup: [
    { id: 'daily', tier: 'd1', collect: (c) => collectDaily(c) },
    { id: 'weekly', tier: 'attach', collect: (c) => collectWeekly(c) },
  ],
  /** 给别的插件（账本）用：`weeklyEnabled()` 周小结开着没有；开着的话上周花销由周小结一起说，账本不用再提 */
  services: { review: { weeklyEnabled: async () => (await reviewApi.settings()).weekly } },
  setup(c) { ctx = c; },
});
