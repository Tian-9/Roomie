import type { ChatMessage, TextBlock } from '../llm/types';
import type { Character, EpisodicMemory, Message, State } from '../storage/db';
import { modelTextOf } from '../data/repo';
import { expandMacros } from './macros';

export interface AssembleInput {
  /** 正在说话的他 */
  character: Character;
  userName: string;
  userProfile?: string;
  state: State;
  /** 近期要事（importance 高的情节记忆，已按时间排序） */
  highlights: EpisodicMemory[];
  /** memory 工具目录（空字符串表示没有） */
  memoryIndex?: string;
  history: Message[];
  /** 本轮用户输入；为空表示让他接着说（重新生成） */
  userText?: string;
  /** 插件注入：稳定部分进 system，易变部分进最后一条用户消息 */
  pluginStable?: string[];
  pluginVolatile?: string[];
  now?: Date;
  windowSize?: number;
  hasTools?: boolean;
  /** 有 share 工具（至少一个分享解析器） */
  hasShare?: boolean;
  /** 挂了服务端联网工具 */
  hasWeb?: boolean;
  /** 有 handle_attached 工具（有插件登记了依附的事） */
  hasAttach?: boolean;
  /** 自定义对话规则，空则用默认 */
  rules?: string;
}

export const DEFAULT_RULES = [
  '你是住在对方手机里的人，和对方在手机上聊天。这是纯线上的文字聊天，不是小说。',
  '始终以自己的身份、口吻和视角说话，不要跳出来解释自己是 AI。',
  '只写你打出来的字：不写动作、神态、环境描写，不用括号或星号加旁白。情绪靠语气、标点和表情符号。',
  '一次回复 1 到 4 条消息，每条一行，用换行分开，像连发几条微信。短的一句话就一条，不要编号，不要独白。',
  '长度和对方匹配，对方一句你就一两句。',
  '不要替对方说话或决定对方的行动。',
  '不要反复提同一个梗、同一件事，前面说过的话不要换个说法再说一遍。',
  '用中文回复，除非人设要求其他语言。',
].join('\n');

const TOOL_RULES = [
  '你有一些工具可以查资料和记事：',
  '- 想不起来以前发生过什么时用 memory_search 或 memory_recent。',
  '- 你们的关系、你的情绪或当前事实发生明确变化时，用 state_update 记下来。',
  '- /memories 是你的笔记本，用 memory 工具维护。只记长期有用的事：对方的偏好、约定、重要的身份信息、你们关系的里程碑。不要记聊天进度和流水账，对话记录本来就在。目录每轮都给你了，只在确实相关时才打开文件，不要每轮都翻。',
  '查完资料后正常回复，不要向对方复述你查了什么。',
].join('\n');
const SHARE_RULE = '- 想给对方分享一首歌、一篇文章之类的东西时用 share 工具，它会查真实资料返回给你，并把卡片发给对方。引用歌词或原文只能引工具返回的原句，查不到就不引，不要编。';
const ATTACH_RULE = '- 最后一条消息里如果有「顺手处理的事」（比如今天有什么安排要提一句），先用 handle_attached 按它给的 key 和结构提交，再回消息。像真人一样顺手就做了，不要在消息里复述。';
const WEB_RULE = '- 你可以上网（web_search 查、web_fetch 读网页）。只在确实需要外部信息时用：对方问起最近的事、要核实一个事实、或者分享的东西本地没查到。闲聊不要搜。';

function toolRules(input: AssembleInput): string {
  if (!input.hasTools) return '';
  const extra = [input.hasShare ? SHARE_RULE : '', input.hasAttach ? ATTACH_RULE : '', input.hasWeb ? WEB_RULE : ''].filter(Boolean);
  const lines = TOOL_RULES.split('\n');
  // 「查完资料后…」收尾句保持在最后
  return [...lines.slice(0, -1), ...extra, lines[lines.length - 1]!].join('\n');
}

function section(title: string, body: string | undefined): TextBlock | null {
  const b = body?.trim();
  return b ? { type: 'text', text: `# ${title}\n${b}` } : null;
}

export function stateText(s: State): string {
  const parts: string[] = [];
  if (s.relation) parts.push(`你和对方的关系：${s.relation}`);
  if (s.mood) parts.push(`你现在的情绪：${s.mood}`);
  if (s.facts.length) parts.push('当前事实：\n' + s.facts.map((f) => `- ${f}`).join('\n'));
  return parts.join('\n');
}

/**
 * 拼装请求。顺序固定：规则 → 对方 → 你（他的 core）→ 当前状态 → 近期要事 → 记忆目录 → 插件稳定部分。
 * 缓存断点两处：system 末尾、倒数第二条消息末尾。易变内容（插件易变部分、时间、本轮输入）只进最后一条用户消息。
 */
export function assemble(input: AssembleInput): { system: TextBlock[]; messages: ChatMessage[] } {
  const { windowSize = 60, now = new Date() } = input;

  const system = [
    section('规则', (input.rules?.trim() || DEFAULT_RULES) + (input.hasTools ? '\n\n' + toolRules(input) : '')),
    section('对方', `对方的名字是「${input.userName}」。${input.userProfile ? '\n' + input.userProfile : ''}`),
    section(`你：${input.character.name}`, input.character.core),
    section('当前状态', stateText(input.state)),
    input.highlights.length ? section('近期要事', input.highlights.map((m) => `- ${m.when ? m.when + '：' : ''}${m.text}`).join('\n')) : null,
    section('你的记忆目录 /memories', input.memoryIndex),
    ...(input.pluginStable ?? []).map((t) => (t.trim() ? ({ type: 'text', text: t } as TextBlock) : null)),
  ].filter((b): b is TextBlock => !!b);
  system[system.length - 1]!.cache = true;

  const recent = input.history.slice(-windowSize);
  const messages: ChatMessage[] = [];
  for (const m of recent) {
    if (m.role === 'system') continue;
    // 正文 + 卡片 alt：只有卡片的回复（分享了歌）也要进历史
    const text = modelTextOf(m).trim();
    if (!text) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) last.content.push({ type: 'text', text });
    else messages.push({ role: m.role, content: [{ type: 'text', text }] });
  }

  const tail: string[] = [];
  tail.push(...(input.pluginVolatile ?? []).filter((t) => t.trim()));
  tail.push(`现在是 ${now.toLocaleString('zh-CN', { hour12: false })}。`);
  if (input.userText?.trim()) tail.push(input.userText.trim());

  const last = messages[messages.length - 1];
  if (last?.role === 'user') last.content.push({ type: 'text', text: tail.join('\n\n') });
  else messages.push({ role: 'user', content: [{ type: 'text', text: tail.join('\n\n') }] });

  if (messages[0]?.role === 'assistant') messages.unshift({ role: 'user', content: [{ type: 'text', text: '（对话开始）' }] });

  if (messages.length >= 2) {
    const prev = messages[messages.length - 2]!;
    const pb = prev.content[prev.content.length - 1]!;
    if (pb.type === 'text') pb.cache = true;
  }
  // 酒馆占位符：{{user}} / {{char}} → 名字。只在拼装时替换，数据里保留原样。
  const names = { user: input.userName, char: input.character.name };
  for (const b of system) b.text = expandMacros(b.text, names);
  for (const m of messages) for (const b of m.content) if (b.type === 'text') b.text = expandMacros(b.text, names);
  return { system, messages };
}

/** L1 触发：扫描文本里出现了登记的任一触发词（不分大小写）。没登记触发词视为总是命中 */
export function triggered(triggers: string[] | undefined, scanText: string): boolean {
  if (!triggers?.length) return true;
  const lower = scanText.toLowerCase();
  return triggers.some((k) => k && lower.includes(k.toLowerCase()));
}
