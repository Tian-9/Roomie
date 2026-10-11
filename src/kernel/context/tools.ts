import { db } from '../storage/db';
import type { Character, State } from '../storage/db';
import type { ToolSpec } from '../llm/types';
import { search } from './search';
import { runMemoryCommand, type MemCommand } from './memfs';
import { bus } from '../bus/bus';
import { expandMacros } from './macros';
import { chat } from '../chat/engine.svelte';
import { registry } from '../registry/registry.svelte';
import { repo } from '../data/repo';
import type { ShareCard, ShareResolver } from '../share/types';
import type { CatchupContext, CatchupItem } from '../api/types';
import { log } from '../log/log';

export interface AttachedTask { key: string; item: CatchupItem; ctx: CatchupContext }
export interface ToolContext {
  /** 正在说话的他 */
  character: Character;
  /** 当前状态；state_update 改完会同步到这里，同一轮后面的工具看到的是新值 */
  state: State;
  /** 本轮工具产生的分享卡，引擎收完写进消息 meta */
  cards: ShareCard[];
  /** 挂在这一轮上顺手处理的事（如报一句今天的安排），材料在最后一条用户消息里 */
  attached: AttachedTask[];
}
export type ToolHandler = (input: any, ctx: ToolContext) => Promise<string>;
export interface KernelTool { spec: ToolSpec; handler: ToolHandler; /** UI 状态文案 */ label: string }

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');

export const kernelTools: KernelTool[] = [
  {
    label: '回忆',
    spec: { name: 'memory_search', description: '搜索以前发生过的事（情节记忆）。', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    async handler(input) {
      const mems = await db().memories.toArray();
      const hits = search(mems.map((m) => ({ id: m.id, kind: 'mem', title: m.when, text: m.text })), str(input?.query, 200), 10);
      if (!hits.length) return '没有相关记忆。';
      return hits.map((h) => { const m = mems.find((x) => x.id === h.id)!; return `- ${m.when ? m.when + '：' : ''}${m.text}`; }).join('\n');
    },
  },
  {
    label: '回忆',
    spec: { name: 'memory_recent', description: '最近发生的事，按时间倒序。', inputSchema: { type: 'object', properties: { n: { type: 'integer', minimum: 1, maximum: 30 } } } },
    async handler(input) {
      const n = Math.min(30, Math.max(1, Number(input?.n) || 10));
      const mems = await db().memories.reverse().sortBy('createdAt');
      if (!mems.length) return '还没有记忆。';
      return mems.slice(0, n).map((m) => `- ${m.when ? m.when + '：' : ''}${m.text}`).join('\n');
    },
  },
  {
    label: '看自己的设定',
    spec: { name: 'character_read', description: '读你自己的完整设定和示例对话。', inputSchema: { type: 'object', properties: {} } },
    async handler(_input, ctx) {
      const c = ctx.character;
      return expandForModel(`## ${c.name}\n${c.full || c.core}`, ctx);
    },
  },
  {
    label: '记下变化',
    spec: {
      name: 'state_update',
      description: '更新当前状态：你和对方的关系、你的情绪、当前事实。只在有明确变化时调用。facts 是替换而不是追加，传完整列表（最多 20 条）。',
      inputSchema: { type: 'object', properties: {
        relation: { type: 'string', description: '你和对方现在的关系，一句话' },
        mood: { type: 'string', description: '你现在的情绪，一句话' },
        facts: { type: 'array', items: { type: 'string' }, maxItems: 20 },
      } },
    },
    async handler(input, ctx) {
      const s: State = { ...ctx.state, facts: [...ctx.state.facts] };
      if (typeof input?.relation === 'string') s.relation = input.relation.slice(0, 120);
      if (typeof input?.mood === 'string') s.mood = input.mood.slice(0, 120);
      if (Array.isArray(input?.facts)) s.facts = input.facts.filter((f: unknown) => typeof f === 'string').map((f: string) => f.slice(0, 160)).slice(0, 20);
      await repo.updateState(s);
      ctx.state = s;
      bus.emit('memory.written', { kind: 'state', id: 'home' });
      return '已更新状态。';
    },
  },
  {
    label: '翻笔记',
    spec: { name: 'memory', builtin: 'memory' },
    async handler(input) {
      return runMemoryCommand(input as MemCommand);
    },
  },
];

/**
 * share 工具：按已启用插件的分享解析器动态生成（type 枚举随插件变），所以不在 kernelTools 里。
 * 没有任何解析器就不给模型这个工具。
 */
export function shareTool(resolvers: ShareResolver[]): KernelTool | null {
  if (!resolvers.length) return null;
  const types = resolvers.map((r) => r.type);
  return {
    label: '分享',
    spec: {
      name: 'share',
      description: '在聊天里分享一样东西给对方，像微信里转发一首歌。插件会去查真实资料返回给你，并把卡片直接发给对方（你不用再描述卡片）。只在聊天里自然想分享时用，一轮最多一次。\n' + resolvers.map((r) => `- ${r.hint}`).join('\n'),
      inputSchema: { type: 'object', properties: {
        type: { type: 'string', enum: types },
        title: { type: 'string', description: '名字，如歌名' },
        subtitle: { type: 'string', description: '歌手 / 作者 / 来源，知道就填' },
        quote: { type: 'string', description: '想引用的一句原文（如一句歌词），可不填。会在查到的原文里校验，没有的会被去掉' },
      }, required: ['type', 'title'] },
    },
    async handler(input, ctx) {
      const type = str(input?.type, 32);
      const r = resolvers.find((x) => x.type === type);
      if (!r) return `没有「${type}」这种分享类型，可选：${types.join('、')}`;
      const title = str(input?.title, 120).trim();
      if (!title) return 'title 不能为空';
      const res = await r.resolve(
        { type, title, subtitle: str(input?.subtitle, 120).trim() || undefined, quote: str(input?.quote, 200).trim() || undefined },
        { characterId: ctx.character.id },
      );
      ctx.cards.push(res.card);
      return expandForModel(res.forModel, ctx);
    },
  };
}

/**
 * handle_attached：处理"挂在这一轮上"的事。工具表要稳定（缓存前缀），所以有依附登记就一直挂着，
 * 每一轮具体有没有事、按什么结构提交，写在最后一条用户消息里。
 */
export const attachedTool: KernelTool = {
  label: '顺手处理',
  spec: {
    name: 'handle_attached',
    description: '处理最后一条消息里「顺手处理的事」。每件事有一个 key 和要求的结构，按结构把结果放在 output 里提交，一件事调一次。没有列出来的事不要调。',
    inputSchema: { type: 'object', properties: { key: { type: 'string' }, output: { type: 'object', additionalProperties: true } }, required: ['key', 'output'] },
  },
  async handler(input, ctx) {
    const key = str(input?.key, 64);
    const t = ctx.attached.find((x) => x.key === key);
    if (!t) return `这一轮没有 key 为「${key}」的事。`;
    await t.item.apply(input?.output, t.ctx);
    ctx.attached = ctx.attached.filter((x) => x !== t);
    log.info('catchup', `聊天里顺手处理了 ${t.item.label}`, { characterId: t.ctx.characterId, key });
    return `${t.item.label} 已处理。`;
  },
};

/** 给最后一条用户消息的材料：每件事的说明和提交结构 */
export function attachedPrompt(tasks: AttachedTask[]): string {
  if (!tasks.length) return '';
  return '<顺手处理的事>\n你在回消息，顺便把这些也处理了。每件事用 handle_attached 工具提交，key 和结构如下；处理完再正常回复消息，不要在消息里复述。\n\n'
    + tasks.map((t) => `## ${t.item.label}（key：${t.key}）\n${t.item.prompt}\n提交结构（output）：${JSON.stringify(t.item.schema)}`).join('\n\n')
    + '\n</顺手处理的事>';
}

/** 工具返回给模型的文本也要替换占位符 */
export function expandForModel(text: string, ctx: ToolContext): string {
  return expandMacros(text, { user: chat.userName, char: ctx.character.name });
}

const EXTRA_LABELS: Record<string, string> = { share: '分享', handle_attached: '顺手处理', web_search: '上网搜', web_fetch: '看网页' };

export function toolLabel(name: string): string {
  const k = kernelTools.find((t) => t.spec.name === name)?.label ?? EXTRA_LABELS[name];
  if (k) return k;
  for (const p of registry.plugins) {
    const t = p.tools?.find((x) => x.name === name);
    if (t) return t.label ?? `${p.name}：${name.split('_').pop()}`;
  }
  return name;
}
