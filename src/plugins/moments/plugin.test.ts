import { describe, it, expect, beforeAll } from 'vitest';
import { openDB, db, pluginTable } from '$kernel/storage/db';
import type { PluginContext, CatchupContext, MessageView, PromptContext } from '$kernel/api';
import plugin, { momentsApi, collectPost } from './index';
import { ymd, addDays, dayStart } from './feed';

const services = new Map<string, unknown>();
const notices: string[] = [];
const today = ymd();
const yday = addDays(today, -1);
const messages: MessageView[] = [
  { id: 'm1', conversationId: 'cv', role: 'user', text: '今天加班到十点', ts: dayStart(yday) + 22 * 3600_000 },
  { id: 'm2', conversationId: 'cv', role: 'assistant', text: '早点睡', ts: dayStart(yday) + 22 * 3600_000 + 1 },
  { id: 'm3', conversationId: 'cv', role: 'system', text: '（系统）', ts: dayStart(yday) + 23 * 3600_000 },
];
const cctx = (days = 1): CatchupContext => ({ characterId: 'c1', characterName: '阿树', elapsedMs: days * 86400_000 + 3600_000, days, tier: days >= 2 ? 'days' : 'd1', elapsedText: days >= 2 ? `${days} 天` : '一天多' });
const pctx: PromptContext = { conversationId: 'cv', characterId: 'c1' };
const tool = (name: string) => plugin.tools!.find((t) => t.name === name)!;

beforeAll(() => {
  openDB([plugin]);
  const ctx = {
    id: 'moments',
    table: (n: string) => db().table(pluginTable('moments', n)),
    settings: { get: async <T,>(_k: string, d: T) => d, set: async () => {} },
    emit() {},
    notify: (title: string) => { notices.push(title); },
    service: (name: string) => services.get(name),
    llm: { configured: false },
    data: {
      messages: async ({ from, to }: { from: number; to: number }) => messages.filter((m) => m.ts >= from && m.ts < to),
      userProfile: async () => ({ name: '小明', profile: '' }),
      currentCharacter: async () => ({ id: 'c1', name: '阿树', core: '' }),
      characters: async () => [{ id: 'c1', name: '阿树', core: '' }],
      state: async () => ({ mood: '', relation: '', facts: [] }),
      conversationWith: async (id: string) => (id === 'c1' ? 'cv' : undefined),
    },
  } as unknown as PluginContext;
  plugin.setup!(ctx);
});

describe('moments catch-up', () => {
  it('asks for one post about yesterday from the conversation only, and saves it with the material', async () => {
    const item = await collectPost(cctx(1));
    expect(item).not.toBeNull();
    expect(item!.greets).toBeUndefined();
    expect(item!.prompt).toContain('对方昨天的事');
    expect(item!.prompt).toContain('聊了 2 条');
    expect(item!.prompt).toContain('小明：今天加班到十点');
    expect(item!.prompt).not.toContain('花了');
    expect(item!.schema).toMatchObject({ required: ['post', 'text'] });
    await item!.apply({ post: true, text: '「他昨天又加班到十点。」' }, cctx(1));
    const [p] = await momentsApi.list();
    expect(p?.text).toBe('他昨天又加班到十点。');
    expect(p?.date).toBe(yday);
    expect(p?.source).toBe('catchup');
    expect(p?.material).toEqual(['聊了 2 条']);
    expect(p?.liked).toBe(false);
    expect(notices).toEqual(['阿树 发了一条动态']);
    // 今天发过了就不再收集：一天最多一条
    expect(await collectPost(cctx(1))).toBeNull();
  });

  it('skips when he decides not to post, covers a longer absence, and pulls other plugins when present', async () => {
    await momentsApi.posts().clear();
    services.set('ledger', { range: async () => [{ amount: 8800, category: '餐饮', note: '火锅', date: yday }] });
    services.set('weather', { line: async () => '北京 12°C 小雨' });
    const item = await collectPost(cctx(3));
    expect(item!.prompt).toContain('对方这几天的事');
    expect(item!.prompt).toContain(`${addDays(today, -3)} 到 ${yday}`);
    expect(item!.prompt).toContain('小明花了 ¥88');
    expect(item!.prompt).toContain('天气：北京 12°C 小雨');
    await item!.apply({ post: false, text: '想说的' }, cctx(3));
    expect(await momentsApi.posts().count()).toBe(0);
    await item!.apply({ post: true, text: '' }, cctx(3));
    expect(await momentsApi.posts().count()).toBe(0);
    await item!.apply({ post: true, text: '火锅好吃吧。' }, cctx(3));
    expect((await momentsApi.list())[0]?.material).toEqual(['聊了 2 条', '花了 ¥88', '北京 12°C 小雨']);
    services.clear();
  });

  it('lists recent posts in the prompt so he does not repeat himself', async () => {
    const item = await collectPost(cctx(2));
    expect(item).toBeNull(); // 今天已经发过
    await momentsApi.posts().clear();
    await momentsApi.add({ characterId: 'c1', date: yday, text: '老动态', source: 'manual', material: [], createdAt: dayStart(yday) });
    const again = await collectPost(cctx(1));
    expect(again!.prompt).toContain('- 老动态');
  });
});

describe('moments tool and prompt', () => {
  it('posts from chat with today\'s date, and the volatile only lists recent posts when triggered', async () => {
    await momentsApi.posts().clear();
    expect(await tool('moments_post').handler({ text: '  ' }, pctx)).toBe('正文不能为空。');
    expect(await tool('moments_post').handler({ text: '「今天他请我喝了奶茶。」' }, pctx)).toContain('发出去了');
    const [p] = await momentsApi.list();
    expect(p).toMatchObject({ text: '今天他请我喝了奶茶。', date: today, source: 'chat', material: [] });
    const pc = plugin.promptContributors![0]!;
    expect(pc.triggers).toContain('动态');
    await momentsApi.like(p!);
    const v = await pc.volatile!(pctx);
    expect(v).toContain('<你最近发的动态>');
    expect(v).toContain(`${today}：今天他请我喝了奶茶。（对方点了心）`);
    await momentsApi.posts().clear();
    expect(await pc.volatile!(pctx)).toBe('');
  });

  it('finds his conversation for a reply', async () => {
    const p = (await momentsApi.add({ characterId: 'c1', date: today, text: 'x', source: 'manual', material: [] }))!;
    expect(await momentsApi.conversationFor(p)).toBe('cv');
    // 发它的人设删了：退回现在的他
    expect(await momentsApi.conversationFor({ ...p, characterId: 'gone' })).toBe('cv');
    await expect((plugin.services!.moments as { latest(): Promise<unknown> }).latest()).resolves.toMatchObject({ id: p.id });
  });
});
