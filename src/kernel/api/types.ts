import type { Component } from 'svelte';
import type { Table } from 'dexie';
import type { ShareResolver } from '../share/types';

export type { ShareCard, ShareQuery, ShareResult, ShareResolver, ShareContext } from '../share/types';

/** 插件清单：插件通过 definePlugin() 声明，内核据此收集贡献点。 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** 内核级插件不可关闭 */
  core?: boolean;
  /** 桌面图标与主界面 */
  app?: AppContribution;
  /** 暴露给 Dock 的快捷方式 */
  shortcuts?: Shortcut[];
  /** 其他可打开的界面，按 id 导航 */
  screens?: Record<string, Component<any>>;
  /** 往提示词里注入的内容：稳定部分进 system，易变部分进最后一条用户消息 */
  promptContributors?: PromptContributor[];
  /** L2 工具：他能自己调的 */
  tools?: ToolDef[];
  /** 解析模型输出里的标签 */
  outputHandlers?: OutputHandler[];
  /** 分享解析器：内核的 share 工具按 type 分发到这里 */
  shares?: ShareResolver[];
  /** 补发登记：离开一段时间回来，内核按档位把各插件的事拼成一次调用 */
  catchup?: CatchupContributor[];
  /** 聊天输入框「+」面板里的项：你主动发东西（记一笔、发首歌…） */
  composerActions?: ComposerAction[];
  /** 他的主页上挂的段（本月花了多少、下一件日程…） */
  profileSections?: ProfileSection[];
  /**
   * 给别的插件用的服务，按名字取（`ctx.service('wallet')`）。插件不能互相 import，跨插件要调东西只能走这里。
   * 形状由提供方在自己的 index.ts 里写注释说明，不进 $kernel/api：内核不认识服务的内容。
   */
  services?: Record<string, unknown>;
  /** 自有数据表：表名 -> Dexie schema 字符串，内核会加 p_<id>_ 前缀 */
  storage?: { tables: Record<string, string> };
  /** 事件订阅 */
  onEvent?: Partial<EventHandlers>;
  /** 启用时调用 */
  setup?(ctx: PluginContext): void | Promise<void>;
  /** 停用时调用 */
  teardown?(): void | Promise<void>;
}

export interface AppContribution {
  screen: Component<any>;
  /** 图标样式：内置渐变名或自定义 CSS 背景 */
  icon: IconSpec;
  badge?: () => number;
}

export interface IconSpec {
  /** 图标内容：SVG path 的 d 字符串数组（24x24 坐标系） */
  paths: string[];
  /** 背景：预设名或任意 CSS background 值 */
  background: string;
  /** 描边还是填充 */
  mode?: 'stroke' | 'fill';
}

export interface Shortcut {
  id: string;
  label: string;
  icon?: IconSpec;
  /** 目标界面：插件 screens 里的 key，或 'app' 表示主界面 */
  screen: string;
  params?: Record<string, unknown>;
}

export interface PromptContributor {
  id: string;
  /** 稳定部分，进 system，参与缓存 */
  stable?: (ctx: PromptContext) => string | Promise<string>;
  /** 易变部分，进最后一条用户消息 */
  volatile?: (ctx: PromptContext) => string | Promise<string>;
  /**
   * L1 触发词：给了就只在最近几条消息或本轮输入里出现其中一个词时才调 volatile（不分大小写）。
   * 记账插件登记「花了、买了」，提到才带上本周支出；不给就每轮都调。
   */
  triggers?: string[];
}

export interface PromptContext {
  conversationId: string;
  /** 正在说话的他 */
  characterId: string;
  /**
   * 工具处理时可用：往这一轮回复里加一张卡片，由本插件 outputHandlers 里同名 tag 的组件渲染。
   * alt 是这张卡的一句话文字版（如「[发了一个红包：¥8.88「生日快乐」]」），进后续轮次的历史和聊天列表预览；不给的话模型下一轮就不记得发过。
   */
  addCard?(tag: string, body: string, attrs?: Record<string, string>, alt?: string): void;
}

/** 消息里的一张卡片：pluginId + tag 决定用哪个组件渲染，alt 是给模型和列表预览看的一句话 */
export interface MessageCard {
  pluginId: string;
  tag: string;
  body: string;
  attrs: Record<string, string>;
  alt?: string;
}

/** 用户从「+」面板发出去的消息：text 给模型看，cards 给人看 */
export interface OutgoingMessage {
  text: string;
  /** alt 是卡片在聊天列表里的预览文字（如「[红包] 恭喜发财」），cardOnly 时没有它列表就会显示给模型看的 text */
  cards?: { tag: string; body: string; attrs?: Record<string, string>; alt?: string }[];
  /** 只显示卡片，不显示 text 气泡 */
  cardOnly?: boolean;
}

export interface ComposerActionProps {
  conversationId: string;
  characterId: string;
  onsend(msg: OutgoingMessage): void;
  onclose(): void;
}

export interface ComposerAction {
  id: string;
  label: string;
  icon: IconSpec;
  /** 在弹窗里渲染的组件，接收 ComposerActionProps */
  component: Component<any>;
}

export interface ProfileSectionProps {
  characterId: string;
}

/** 他的主页上的一段，由插件提供；主页本身不认识段的内容 */
export interface ProfileSection {
  id: string;
  /** 段标题，如「钱包」；不给就不显示标题 */
  label?: string;
  /** 接收 ProfileSectionProps */
  component: Component<any>;
}

export interface ToolDef {
  name: string;
  /** 聊天状态栏里显示的动作，如「发朋友圈」 */
  label?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: unknown, ctx: PromptContext) => Promise<unknown>;
}

export interface OutputHandler {
  /** 匹配的标签名，如 'moment' 对应 <moment>…</moment> */
  tag: string;
  /** 渲染卡片的组件，接收 { body, attrs } */
  component: Component<any>;
  /** 解析到标签时的副作用，如落库 */
  onParsed?: (body: string, attrs: Record<string, string>, ctx: PromptContext) => void | Promise<void>;
}

/** 补发档位：h6 ≥ 6 小时，d1 ≥ 24 小时，days ≥ 2 天；attach 不触发，挂在这个角色下一次模型调用上（聊天回复或补发） */
export type CatchupTier = 'h6' | 'd1' | 'days' | 'attach';

export interface CatchupContext {
  characterId: string;
  characterName: string;
  /** 距上次和他互动（或上次补发）的时长 */
  elapsedMs: number;
  /** 整天数，days 档才有意义 */
  days: number;
  /** 这次达到的档位；chat 表示挂在一次聊天回复上 */
  tier: Exclude<CatchupTier, 'attach'> | 'chat';
  /** 给模型看的时长，如「大约 8 小时」「3 天」 */
  elapsedText: string;
}

export interface CatchupItem {
  /** 这一段的标题，如「日记」 */
  label: string;
  /** 材料和任务说明 */
  prompt: string;
  /**
   * 这一段的 JSON schema，内核挂到总 schema 的一个属性下。
   * 可以约定一个可选字符串字段 `say`（他想顺口跟对方说的一句），内核会把各段的 say 合成一条他发来的消息。
   */
  schema: Record<string, unknown>;
  /** 这一段的 say 自带问候（如复盘按时段说早安 / 回来了），内核就不再在前面加「早」「好久不见」 */
  greets?: boolean;
  /** 模型答完，这一段的结果 */
  apply(output: unknown, ctx: CatchupContext): Promise<void>;
}

export interface CatchupContributor {
  id: string;
  tier: CatchupTier;
  /** 收集这次要处理的事；null 表示没事 */
  collect(ctx: CatchupContext): Promise<CatchupItem | null>;
}

/** 内核事件表。插件自定义事件用 `<pluginId>.<name>` 命名。 */
export interface KernelEvents {
  'app.opened': { pluginId: string };
  'app.closed': { pluginId: string };
  'app.resumed': { elapsedMs: number };
  'plugin.enabled': { pluginId: string };
  'plugin.disabled': { pluginId: string };
  'theme.changed': { themeId: string };
  'notify': { title: string; body?: string; pluginId?: string; screen?: string; action?: () => void };
  'llm.turn.start': { conversationId: string };
  'llm.turn.end': { conversationId: string; usage: { input: number; output: number; cacheRead: number; cacheWrite: number }; model: string };
  'llm.turn.error': { conversationId: string; message: string };
  'memory.written': { kind: 'state' | 'episodic' | 'notes'; id: string };
  'memory.consolidated': { conversationId: string; memories: number };
  'catchup.done': { characterId: string; tier: string; keys: string[] };
}
export type EventName = keyof KernelEvents | (string & {});
export type EventHandlers = {
  [K in keyof KernelEvents]: (payload: KernelEvents[K]) => void;
} & Record<string, (payload: any) => void>;

export interface PluginContext {
  id: string;
  /** 发事件 */
  emit<K extends keyof KernelEvents>(name: K, payload: KernelEvents[K]): void;
  emit(name: string, payload: unknown): void;
  /** 导航 */
  navigate(screen: string, params?: Record<string, unknown>): void;
  back(): void;
  /** 通知条 */
  notify(title: string, body?: string, screen?: string): void;
  /** 本插件的键值设置 */
  settings: {
    get<T>(key: string, fallback: T): Promise<T>;
    set<T>(key: string, value: T): Promise<void>;
  };
  /**
   * 本插件的秘密（Bot token、同步密码…）：和 API Key 同一套保管方式，开了锁屏就用 PIN 封起来，没开就明文在 kv。
   * 锁着时 get 会等到解锁；定时发东西这类不想等的，先看 locked。空串表示没有。
   */
  secrets: {
    get(key: string): Promise<string>;
    set(key: string, value: string): Promise<void>;
    readonly locked: boolean;
  };
  /** 本插件在 manifest.storage 里声明的表 */
  table<T = unknown>(name: string): Table<T, any>;
  /** 调模型，自动记账到本插件名下 */
  llm: {
    chat(req: PluginChatRequest): Promise<{ text: string }>;
    configured: boolean;
  };
  /** 内核数据的只读视图：他、状态、记忆。插件读这些一律走这里，不直接碰库 */
  data: DataView;
  /** 别的插件提供的服务；提供它的插件没开就是 undefined，调用方要能退化 */
  service<T = unknown>(name: string): T | undefined;
}

/**
 * 内核数据的只读视图。返回的是快照，改了也不会写回；写记忆、写状态只能由模型通过内核工具做。
 * 在 live() 里调用也能被 Dexie 追踪，表一变界面就刷新。
 */
export interface DataView {
  /** 常驻的他：最近给谁发消息谁就是；补发只找他 */
  currentCharacter(): Promise<CharacterView | undefined>;
  character(id: string): Promise<CharacterView | undefined>;
  characters(): Promise<CharacterView[]>;
  /** 当前状态：他的情绪、你们的关系、当前事实。全库一份 */
  state(): Promise<StateView>;
  /** 情节记忆，新的在前。全库一份，不按卡分 */
  memories(opts?: { limit?: number; minImportance?: 1 | 2 | 3 }): Promise<MemoryView[]>;
  /** 和他的对话，按时间段（ts 毫秒，含 from 不含 to），旧的在前；日记、复盘、周报翻对话用这个 */
  messages(opts: { from: number; to: number; limit?: number }): Promise<MessageView[]>;
  /** 你：名字和画像（引导里填的、他慢慢记下的） */
  userProfile(): Promise<{ name: string; profile: string }>;
  /** 和他的私聊会话 id；还没聊过就是 undefined（只找不建）。插件想把人带进对话用 `nav.push('chat', 'conversation', { id, draft? })` */
  conversationWith(characterId: string): Promise<string | undefined>;
}

export interface CharacterView { id: string; name: string; avatar?: Blob; core: string }
export interface StateView { mood: string; relation: string; facts: string[] }
/** 一条消息的只读视图；text 已含卡片的文字版（alt） */
export interface MessageView { id: string; conversationId: string; characterId?: string; role: 'user' | 'assistant' | 'system'; text: string; ts: number }
export interface MemoryView { id: string; characterId?: string; when: string; text: string; importance: 1 | 2 | 3; createdAt: number }

export interface PluginChatRequest {
  system: string;
  user: string;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
  /** 用便宜模型 */
  cheap?: boolean;
  /** 要结构化输出时给 JSON schema，返回的 text 就是一段合法 JSON */
  jsonSchema?: Record<string, unknown>;
}

