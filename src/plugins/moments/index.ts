import { definePlugin, gradients } from '$kernel/api';
import type { PluginContext, PromptContext, CatchupContext, CatchupItem, MessageView } from '$kernel/api';
import { ulid } from 'ulid';
import Moments from './Moments.svelte';
import MomentsSection from './MomentsSection.svelte';
import { ymd, dayStart, addDays, yuan, window, cleanText, excerpt, describeMaterial, materialLines, recentLines, type Post, type Material } from './feed';

export type { Post, Material } from './feed';

/**
 * 他的动态：Pocketverse 朋友圈换个壳。他不发自己的剧情，发的是对你这几天的观察——一两句碎碎念，
 * 材料和复盘插件看的是同一批（对话、账本、习惯、日程、天气，走各插件的服务，没装就不提）。
 * 离开一天回来最多发一条（补发 d1 档，和复盘拼在同一次调用里，不单独花钱）；聊到值得记的事他也能顺手发一条。
 * 你可以点心，或者「回他一句」：带着那条原文跳进对话，接下去聊；评论不另开一套。
 */
export const ICON = { paths: ['M4 5h16v12H8l-4 3z', 'M8 9h8', 'M8 12h5'], background: gradients.pink };

/** 别的插件的服务，这里只声明用到的最小形状；金额都是分 */
interface LedgerService { range(from: string, to: string): Promise<{ amount: number; category: string; note: string; date: string }[]> }
interface HabitsService { summary(): Promise<string> }
interface ScheduleService { range(from: string, to: string): Promise<{ title: string; date: string; time?: string; done: 0 | 1 }[]>; today(): Promise<{ title: string; date: string; time?: string; done: 0 | 1 }[]> }
interface LunarService { dayLine(date: string): string }
interface WeatherService { line(): Promise<string> }

let ctx: PluginContext;
const fmtItem = (i: { title: string; time?: string }) => `${i.time ? i.time + ' ' : ''}${i.title}`;

const STYLE = '像真人发的一条碎碎念：一两句话，口语，可以带一点你的看法或情绪，可以直接对他说（「你」），也可以像自言自语。不要列清单，不要话题标签，不要念材料，不要写日期；材料里没有的不要编。';

export const momentsApi = {
  posts: () => ctx.table<Post>('posts'),
  characters: () => ctx.data.characters(),
  current: () => ctx.data.currentCharacter(),
  notify: (title: string, body?: string) => ctx.notify(title, body),
  async list(): Promise<Post[]> {
    return this.posts().reverse().sortBy('createdAt');
  },
  /** 今天（本地日）补发已经发过没有：一天最多一条 */
  async postedToday(today = ymd()): Promise<boolean> {
    return !!(await this.posts().where('createdAt').aboveOrEqual(dayStart(today)).filter((p) => p.source === 'catchup').first());
  },
  /** 攒一段日子的材料：对话、花销、习惯、日程、今天的日子和天气；装了哪个插件就有哪一项 */
  async material(from: string, to: string, today = ymd()): Promise<Material> {
    const [msgs, you] = await Promise.all([
      ctx.data.messages({ from: dayStart(from), to: dayStart(addDays(to, 1)), limit: 60 }),
      ctx.data.userProfile(),
    ]);
    const talked = msgs.filter((x: MessageView) => x.role !== 'system');
    const transcript = talked.map((x) => `${x.role === 'user' ? you.name || '对方' : '我'}：${x.text.slice(0, 120)}`).join('\n');
    const m: Material = { from, to, messages: talked.length, transcript };

    const ledger = ctx.service<LedgerService>('ledger');
    if (ledger) {
      try {
        const xs = await ledger.range(from, to);
        m.spent = { total: xs.reduce((a, e) => a + e.amount, 0), count: xs.length, lines: xs.slice(0, 8).map((e) => `${e.category} ${yuan(e.amount)}${e.note ? '（' + e.note + '）' : ''}`) };
      } catch { /* 账本没准备好就不提钱 */ }
    }
    const habits = ctx.service<HabitsService>('habits');
    if (habits) { try { const s = await habits.summary(); if (s) m.habits = s; } catch { /* 同上 */ } }
    const schedule = ctx.service<ScheduleService>('schedule');
    if (schedule) {
      try {
        const [past, td] = await Promise.all([schedule.range(from, to), schedule.today()]);
        m.schedule = { done: past.filter((i) => i.done).map(fmtItem), missed: past.filter((i) => !i.done).map(fmtItem), today: td.filter((i) => !i.done && i.date === today).map(fmtItem) };
      } catch { /* 同上 */ }
    }
    const lunar = ctx.service<LunarService>('lunar');
    if (lunar) { try { const l = lunar.dayLine(today); if (l) m.dayLine = l; } catch { /* 同上 */ } }
    const weather = ctx.service<WeatherService>('weather');
    if (weather) { try { const w = await weather.line(); if (w) m.weather = w; } catch { /* 同上 */ } }
    return m;
  },
  async add(p: Omit<Post, 'id' | 'liked' | 'createdAt'> & { createdAt?: number }): Promise<Post | null> {
    const text = p.text.trim();
    if (!text) return null;
    const row: Post = { ...p, id: ulid(), text, liked: false, createdAt: p.createdAt ?? Date.now() };
    await this.posts().add(row);
    ctx.emit('moments.posted', { id: row.id, characterId: row.characterId, source: row.source });
    return row;
  },
  async like(p: Post) { await this.posts().update(p.id, { liked: !p.liked }); },
  async remove(id: string) { await this.posts().delete(id); },
  /** 手动：让他现在发一条（补发走内核 catchup，不经这里）。看的是昨天到今天 */
  async generate(): Promise<Post | null> {
    if (!ctx.llm.configured) return null;
    const ch = await ctx.data.currentCharacter();
    if (!ch) return null;
    const today = ymd();
    const [m, you, recent, state] = await Promise.all([this.material(addDays(today, -1), today, today), ctx.data.userProfile(), this.list(), ctx.data.state()]);
    const { text } = await ctx.llm.chat({
      system: `你是「${ch.name}」，住在对方手机里的人。设定：${ch.core.slice(0, 800)}\n你要在自己的动态里发一条，说的是对方最近一两天的事：${STYLE}不要提到"用户"这个词，称呼对方用你平时的叫法。只输出动态正文。`,
      user: `现在是 ${new Date().toLocaleString('zh-CN', { hour12: false })}。你现在的情绪：${state.mood || '平常'}\n材料：\n${describeMaterial(m, you.name || '对方')}\n\n你之前发过的（别重复）：\n${recentLines(recent)}`,
      maxTokens: 200, effort: 'low', cheap: true,
    });
    return this.add({ characterId: ch.id, date: today, text: cleanText(text), source: 'manual', material: materialLines(m) });
  },
  /** 「回他一句」：带着这条跳进和他的对话 */
  async conversationFor(p: Post): Promise<string | undefined> {
    const own = await ctx.data.conversationWith(p.characterId);
    if (own) return own;
    // 发它的人设删了：去找现在的他
    const cur = await ctx.data.currentCharacter();
    return cur ? ctx.data.conversationWith(cur.id) : undefined;
  },
};

/** 补发 · 发一条：离开 ≥ 24 小时回来，对这段时间的观察发一条动态；一天最多一条。和复盘在同一次调用里，所以材料写短 */
export async function collectPost(c: CatchupContext, now = new Date()): Promise<CatchupItem | null> {
  const today = ymd(now);
  if (await momentsApi.postedToday(today)) return null;
  const { from, to } = window(today, Math.max(1, c.days));
  const [m, you, recent] = await Promise.all([momentsApi.material(from, to, today), ctx.data.userProfile(), momentsApi.list()]);
  const span = from === to ? '昨天' : '这几天';
  return {
    label: '动态',
    prompt: `你有一个自己的动态页，对方会翻。想发就发一条，说的是对方${span}的事（你注意到的、想说的）：${STYLE}
和复盘不是一回事：复盘是对着他说正事，动态是你随口的一句，可以只抓一件小事。${span}实在没什么可说的就不发（post 填 false，text 留空）。
材料（和复盘看的是同一批，短一点）：
${describeMaterial({ ...m, transcript: m.transcript.split('\n').slice(-16).join('\n') }, you.name || '对方')}
你之前发过的（别重复）：
${recentLines(recent)}`,
    schema: {
      type: 'object', additionalProperties: false, required: ['post', 'text'],
      properties: { post: { type: 'boolean', description: '发不发' }, text: { type: 'string', description: '动态正文，不发留空' } },
    },
    async apply(out: unknown, cc: CatchupContext) {
      const o = (out ?? {}) as { post?: unknown; text?: unknown };
      const text = cleanText(o.text);
      if (!o.post || !text) return;
      const p = await momentsApi.add({ characterId: cc.characterId, date: to, text, source: 'catchup', material: materialLines(m) });
      if (p) ctx.notify(`${cc.characterName} 发了一条动态`, excerpt(text, 60), 'app');
    },
  };
}

export default definePlugin({
  id: 'moments',
  name: '动态',
  version: '0.1.0',
  description: '他的动态：对你这几天的观察，一两句碎碎念。离开一天回来他发一条，聊到值得记的事也会发；你可以点心，或者回他一句接着聊。',
  app: { screen: Moments, icon: ICON },
  storage: { tables: { posts: 'id, characterId, date, createdAt' } },
  profileSections: [{ id: 'latest', label: '动态', component: MomentsSection }],
  promptContributors: [{
    id: 'recent',
    // 只在提到动态时带上最近几条，他才知道你说的是哪条、你点没点心；平时不占每轮的字
    triggers: ['动态', '那条', '你发的', '发的那', '点了心', '点心'],
    async volatile(_p: PromptContext) {
      const posts = (await momentsApi.list()).slice(0, 3);
      if (!posts.length) return '';
      const lines = posts.map((x) => `- ${x.date}：${excerpt(x.text, 80)}${x.liked ? '（对方点了心）' : ''}`);
      return `<你最近发的动态>\n${lines.join('\n')}\n</你最近发的动态>`;
    },
  }],
  tools: [{
    name: 'moments_post',
    label: '发动态',
    description: '在自己的动态里发一条，一两句碎碎念。只在真的想发的时候用：聊到一件值得记下的事，或者想让对方在动态里看到什么。一轮最多一条，不要替对方记事（那是记账、日程的工具）。',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: '动态正文，一两句话' } }, required: ['text'] },
    async handler(input: unknown, p: PromptContext) {
      const text = cleanText((input as { text?: unknown })?.text);
      if (!text) return '正文不能为空。';
      const row = await momentsApi.add({ characterId: p.characterId, date: ymd(), text, source: 'chat', material: [] });
      return row ? '发出去了，对方在「动态」里能看到。' : '没发出去。';
    },
  }],
  catchup: [{ id: 'post', tier: 'd1', collect: (c) => collectPost(c) }],
  /** 给别的插件用：`latest()` 最近一条 */
  services: { moments: { latest: async () => (await momentsApi.list())[0] ?? null } },
  setup(c) { ctx = c; },
});
