import { definePlugin, icons, gradients } from '$kernel/api';
import type { PluginContext, PromptContext, CatchupContext, MessageView } from '$kernel/api';
import { ulid } from 'ulid';
import Diary from './Diary.svelte';

export interface DiaryEntry {
  id: string;
  /** 写的时候是哪个人设；日记是他的，换人设也还在 */
  characterId: string;
  /** YYYY-MM-DD，真实日期 */
  date: string; text: string; createdAt: number;
  source: 'auto' | 'manual';
}

let ctx: PluginContext;
export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const diaryApi = {
  entries: () => ctx.table<DiaryEntry>('entries'),
  characters: () => ctx.data.characters(),
  current: () => ctx.data.currentCharacter(),
  async forDate(date: string) {
    return this.entries().where('date').equals(date).first();
  },
  /** 写某一天日记的材料：那天的对话、最近记忆、前一篇 */
  async material(characterId: string, date: string) {
    const ch = await ctx.data.character(characterId);
    if (!ch) return null;
    const [y, m, d] = date.split('-').map(Number);
    const start = new Date(y!, m! - 1, d).getTime(), end = start + 86400_000;
    const [msgs, mems, state, you] = await Promise.all([
      ctx.data.messages({ from: start, to: end, limit: 60 }),
      ctx.data.memories({ limit: 6 }),
      ctx.data.state(),
      ctx.data.userProfile(),
    ]);
    const talked = msgs.filter((x: MessageView) => x.role !== 'system');
    const prev = (await this.entries().reverse().sortBy('date')).filter((e) => e.date < date)[0];
    const transcript = talked.map((x) => `${x.role === 'user' ? you.name : '我'}：${x.text}`).join('\n');
    return {
      ch, mood: state.mood, talked: talked.length > 0,
      rules: '第一人称，写给自己看的，不是给别人看的。150 到 300 字。写那天真正在意的事和没说出口的想法，可以有情绪，可以不完整，不要总结式的流水账，不要带日期标题。',
      text: `${prev ? `前一篇日记（别重复）：\n${prev.text.slice(0, 300)}\n\n` : ''}那天的对话：\n${transcript || '（那天没有和对方说话）'}\n\n最近记得的事：\n${mems.map((x) => '- ' + x.text).join('\n') || '（无）'}`,
    };
  },
  async save(characterId: string, date: string, text: string, source: DiaryEntry['source']) {
    const body = text.trim();
    if (!body) return null;
    const entry: DiaryEntry = { id: ulid(), characterId, date, text: body, createdAt: Date.now(), source };
    await this.entries().add(entry);
    ctx.emit('diary.written', { entryId: entry.id, characterId });
    return entry;
  },
  /** 手动：让他现在写某一天的日记（补发走内核 catchup） */
  async write(characterId: string, date: string, source: DiaryEntry['source']) {
    if (!ctx.llm.configured) return null;
    const m = await this.material(characterId, date);
    if (!m) return null;
    const { text } = await ctx.llm.chat({
      system: `你是「${m.ch.name}」，住在对方手机里的人。设定：${m.ch.core.slice(0, 800)}\n你在写自己的日记。${m.rules}不要提到"用户"这个词，称呼对方用你平时的叫法。只输出日记正文。`,
      user: `今天是 ${date}。\n${m.text}\n现在的情绪：${m.mood || '平常'}`,
      maxTokens: 600, effort: 'low',
    });
    return this.save(characterId, date, text, source);
  },
};

/** 补发 · 昨天的日记：离开 ≥ 6 小时，昨天有对话、还没写 */
async function collectWrite(c: CatchupContext) {
  const y = new Date(); y.setDate(y.getDate() - 1);
  const date = today(y);
  if (await diaryApi.forDate(date)) return null;
  const m = await diaryApi.material(c.characterId, date);
  if (!m || !m.talked) return null;
  return {
    label: '日记',
    prompt: `补写昨天（${date}）的日记。${m.rules}不想写就 text 留空。\n${m.text}`,
    schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', description: '日记正文，不写留空' } } },
    async apply(out: unknown, cc: CatchupContext) {
      const e = await diaryApi.save(cc.characterId, date, String((out as { text?: string } | undefined)?.text ?? ''), 'auto');
      if (e) ctx.notify(`${cc.characterName} 写了昨天的日记`, e.text.slice(0, 60), 'app');
    },
  };
}

export default definePlugin({
  id: 'diary',
  name: '日记',
  version: '0.5.0',
  description: '他每天写一篇日记，他眼里的今天。他能翻自己的日记，你也能看。',
  app: { screen: Diary, icon: { paths: icons.diary, background: gradients.pink } },
  storage: { tables: { entries: 'id, characterId, date' } },
  promptContributors: [{
    id: 'last-diary',
    async volatile(_p: PromptContext) {
      const last = (await ctx.table<DiaryEntry>('entries').reverse().sortBy('date'))[0];
      if (!last) return '';
      return `<你最近一篇日记 ${last.date}>\n${last.text.slice(0, 400)}\n</你最近一篇日记>`;
    },
  }],
  tools: [{
    name: 'diary_read',
    label: '翻日记',
    description: '翻自己以前的日记。不给日期就列出最近几篇的日期和开头，给日期（YYYY-MM-DD）就读那一篇。',
    inputSchema: { type: 'object', properties: { date: { type: 'string' } } },
    async handler(input: unknown) {
      const date = String((input as { date?: unknown })?.date ?? '').trim();
      const all = await ctx.table<DiaryEntry>('entries').reverse().sortBy('date');
      if (!all.length) return '还没写过日记。';
      if (!date) return all.slice(0, 10).map((e) => `- ${e.date}：${e.text.slice(0, 40).replace(/\n/g, ' ')}…`).join('\n');
      const e = all.find((x) => x.date === date);
      return e ? `${e.date}\n${e.text}` : '那天没写。';
    },
  }],
  catchup: [{ id: 'write', tier: 'h6', collect: collectWrite }],
  setup(c) { ctx = c; },
});
