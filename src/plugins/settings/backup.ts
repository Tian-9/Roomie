/**
 * 整库导出 / 导入：遍历 Dexie 的所有表打成一个 JSON，导入时清空再写。
 * 纯函数，不碰界面；settings 是核心插件，和 Logs.svelte 一样可以直接拿 db 实例。
 * 格式只在这里定义，以后多端同步（WebDAV / Gist）也建在它上面。
 */
import type Dexie from 'dexie';

export const APP_TAG = 'roomie';
/** 默认不导出的表：日志和用量只是本机的流水，不是你的数据 */
export const SKIP_TABLES = ['logs', 'usage'];

export interface Backup {
  app: typeof APP_TAG;
  /** 内核表结构版本（db.verno 的百位），不同就拒绝导入 */
  kernel: number;
  /** 导出时的 db.verno，仅供排错 */
  schema: number;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export interface BackupSummary {
  exportedAt: string;
  kernel: number;
  /** 每张表的行数；只包含文件里有的表 */
  counts: Record<string, number>;
  /** 文件里有、当前库没有的表（比如没装的插件），导入时跳过 */
  unknown: string[];
  /** 当前库有、文件里没有的表，导入后会是空的 */
  missing: string[];
}

export interface ImportResult {
  /** 写入的表和行数 */
  written: Record<string, number>;
  skipped: string[];
}

/** 从 db.verno 取内核版本：db.ts 里 verno = 内核版本 * 100 + 插件表数 */
export function kernelVersion(verno: number): number {
  return Math.floor(verno / 100);
}

/* ---------- 值编码：Blob / Date 不能进 JSON ---------- */

type Encoded = { $blob: { type: string; base64: string } } | { $date: string };

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** 递归把 Blob 转 base64、Date 转 ISO；普通值原样返回（新对象，不改原值） */
export async function encodeValue(v: unknown): Promise<unknown> {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Blob) return { $blob: { type: v.type, base64: bytesToBase64(new Uint8Array(await v.arrayBuffer())) } } satisfies Encoded;
  if (v instanceof Date) return { $date: v.toISOString() } satisfies Encoded;
  if (Array.isArray(v)) return Promise.all(v.map(encodeValue));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const e = await encodeValue(x);
    if (e !== undefined) out[k] = e;
  }
  return out;
}

/** encodeValue 的逆：同步，导入事务里直接用 */
export function decodeValue(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(decodeValue);
  const o = v as Record<string, unknown>;
  if ('$blob' in o && o.$blob && typeof o.$blob === 'object') {
    const b = o.$blob as { type?: string; base64?: string };
    return new Blob([base64ToBytes(b.base64 ?? '')], { type: b.type ?? '' });
  }
  if ('$date' in o && typeof o.$date === 'string') return new Date(o.$date);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) out[k] = decodeValue(x);
  return out;
}

/* ---------- 导出 ---------- */

export async function exportBackup(db: Dexie, opts: { skip?: string[]; now?: Date } = {}): Promise<Backup> {
  const skip = new Set(opts.skip ?? SKIP_TABLES);
  const tables: Record<string, unknown[]> = {};
  for (const t of db.tables) {
    if (skip.has(t.name)) continue;
    const rows = await t.toArray();
    tables[t.name] = (await encodeValue(rows)) as unknown[];
  }
  return {
    app: APP_TAG,
    kernel: kernelVersion(db.verno),
    schema: db.verno,
    exportedAt: (opts.now ?? new Date()).toISOString(),
    tables,
  };
}

export function backupFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `roomie-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

/* ---------- 解析 / 预览 ---------- */

/** 解析备份文本并校验头部；版本不对直接抛错，错误信息可以原样给人看 */
export function parseBackup(text: string, currentVerno: number): Backup {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { throw new Error('这不是一个有效的备份文件（JSON 解析失败）'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('这不是一个有效的备份文件');
  const o = raw as Partial<Backup>;
  if (o.app !== APP_TAG) throw new Error('这不是 Roomie 的备份文件');
  if (typeof o.kernel !== 'number' || !o.tables || typeof o.tables !== 'object') throw new Error('备份文件缺少必要字段');
  const want = kernelVersion(currentVerno);
  if (o.kernel !== want) {
    throw new Error(o.kernel < want
      ? `备份来自旧版本（内核 ${o.kernel}，当前 ${want}），这一版还不能升级旧备份`
      : `备份来自更新的版本（内核 ${o.kernel}，当前 ${want}），先更新 Roomie 再导入`);
  }
  for (const [name, rows] of Object.entries(o.tables)) {
    if (!Array.isArray(rows)) throw new Error(`备份里的表 ${name} 格式不对`);
  }
  return o as Backup;
}

export function summarizeBackup(b: Backup, db: Dexie): BackupSummary {
  const here = new Set(db.tables.map((t) => t.name));
  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(b.tables)) counts[name] = rows.length;
  return {
    exportedAt: b.exportedAt,
    kernel: b.kernel,
    counts,
    unknown: Object.keys(b.tables).filter((n) => !here.has(n)),
    missing: db.tables.map((t) => t.name).filter((n) => !SKIP_TABLES.includes(n) && !(n in b.tables)),
  };
}

/* ---------- 导入 ---------- */

/**
 * 整库替换：一个事务里清空当前库的每张表（logs / usage 除外），再写入备份里的行。
 * 备份里有、库里没有的表跳过并在结果里列出。中途出错整个事务回滚，现有数据不动。
 */
export async function importBackup(db: Dexie, b: Backup, opts: { keep?: string[] } = {}): Promise<ImportResult> {
  const keep = new Set(opts.keep ?? SKIP_TABLES);
  const targets = db.tables.filter((t) => !keep.has(t.name));
  const here = new Set(targets.map((t) => t.name));
  const skipped = Object.keys(b.tables).filter((n) => !here.has(n));
  // 先在事务外解码，事务里不 await 别的东西
  const decoded: Record<string, unknown[]> = {};
  for (const t of targets) decoded[t.name] = (decodeValue(b.tables[t.name] ?? []) as unknown[]);
  const written: Record<string, number> = {};
  await db.transaction('rw', targets, async () => {
    for (const t of targets) {
      await t.clear();
      const rows = decoded[t.name] ?? [];
      if (rows.length) await t.bulkPut(rows);
      written[t.name] = rows.length;
    }
  });
  return { written, skipped };
}
