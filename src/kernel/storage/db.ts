import Dexie, { type Table } from 'dexie';
import type { PluginManifest } from '../api/types';

/** 内核表。字段定义见 docs/ARCHITECTURE.md 第 5 节。 */

/** 他：人设卡。可以有好几张（换人设），但记忆、状态、笔记不跟卡走，都是你的 */
export interface Character {
  id: string; name: string; avatar?: Blob;
  core: string; full: string; firstMessage?: string;
  /** 新对话是否自动发开场白；酒馆卡的开场白多半不合小手机场景，默认不发 */
  useFirstMessage?: boolean;
  voice?: Record<string, unknown>;
}
/** 当前状态：他的情绪、你们的关系、仍然成立的事实。进 L0 */
export interface State { mood: string; relation: string; facts: string[] }
/**
 * 你的世界和他的这一局：全库只有一行，id 固定为 'home'。
 * Pocketverse 的 Campaign（多世界、多存档）退化到这里；界面上不出现"存档"。
 */
export interface Home {
  id: 'home';
  state: State;
  /** 上次有消息的时间，和 catchupAt 一起决定下次补发的档位 */
  lastActiveAt: number;
  /** 上次补发的时间 */
  catchupAt?: number;
}
export const HOME_ID = 'home';
export const EMPTY_STATE: State = { mood: '', relation: '', facts: [] };

export interface Conversation {
  id: string; kind: string; participantIds: string[]; pluginId: string;
  /** 上次记忆整理处理到的消息 ts */
  consolidatedUpTo?: number;
  /** 上次整理失败（出错或预览里取消）时处理到的消息 ts；之后再攒够一批回复才会再试 */
  consolidateFailedAt?: number;
}
export interface Message {
  id: string; conversationId: string; role: 'user' | 'assistant' | 'system';
  content: unknown[]; ts: number; tokens?: number;
  /** 附加信息：用过的工具名、卡片、引用、补发标记等 */
  meta?: Record<string, unknown>;
}
/** 情节记忆归你，不归哪张卡。characterId 只记"这是谁视角记的" */
export interface EpisodicMemory {
  id: string; characterId?: string; when: string; text: string;
  importance: 1 | 2 | 3; sourceMessageIds: string[]; createdAt: number;
}
/** 他的笔记本 /memories：Claude memory 工具的后端，一棵树。表名 notes（M0 的 memfs 主键是 [campaignId+path]，Dexie 不能改主键，只能换表） */
export interface MemFile { path: string; content: string; updatedAt: number }
export interface KV { key: string; value: unknown }
export interface LogRecord { id: string; ts: number; level: 'info' | 'warn' | 'error'; tag: string; message: string; data?: Record<string, unknown> }
export interface UsageRecord {
  id: string; ts: number; model: string; conversationId?: string; purpose: string;
  input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number;
  webSearches?: number;
}

const KERNEL_SCHEMA: Record<string, string> = {
  home: 'id',
  characters: 'id, name',
  conversations: 'id, pluginId',
  messages: 'id, conversationId, ts',
  memories: 'id, characterId, importance, createdAt',
  kv: 'key',
  usage: 'id, ts, conversationId',
  notes: 'path',
  logs: 'id, ts, level, tag',
};

/** 内核表结构改动时递增。6：M1，删 worlds / lore / campaigns / overlays，memfs 换成 notes */
const KERNEL_VERSION = 6;

export class PocketDB extends Dexie {
  home!: Table<Home, string>;
  characters!: Table<Character, string>;
  conversations!: Table<Conversation, string>;
  messages!: Table<Message, string>;
  memories!: Table<EpisodicMemory, string>;
  kv!: Table<KV, string>;
  usage!: Table<UsageRecord, string>;
  notes!: Table<MemFile, string>;
  logs!: Table<LogRecord, string>;

  constructor(name = 'roomie', plugins: PluginManifest[] = []) {
    super(name);
    const schema = { ...KERNEL_SCHEMA };
    for (const p of plugins) {
      for (const [t, s] of Object.entries(p.storage?.tables ?? {})) schema[pluginTable(p.id, t)] = s;
    }
    // 版本号 = 内核版本 * 100 + 插件表数量：内核改表或加插件表都会触发升级，Dexie 会补建新表、删掉不再声明的表。
    const pluginTables = Object.keys(schema).length - Object.keys(KERNEL_SCHEMA).length;
    this.version(KERNEL_VERSION * 100 + pluginTables).stores(schema);
  }

  async getKV<T>(key: string, fallback: T): Promise<T> {
    const row = await this.kv.get(key);
    return row ? (row.value as T) : fallback;
  }
  async setKV<T>(key: string, value: T): Promise<void> {
    await this.kv.put({ key, value });
  }
}

export function pluginTable(pluginId: string, table: string): string {
  return `p_${pluginId.replace(/-/g, '_')}_${table}`;
}

let instance: PocketDB | undefined;
export function openDB(plugins: PluginManifest[]): PocketDB {
  if (!instance) instance = new PocketDB('roomie', plugins);
  return instance;
}
export function db(): PocketDB {
  if (!instance) throw new Error('数据库尚未打开，先调用 openDB()');
  return instance;
}
