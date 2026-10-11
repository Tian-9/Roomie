/**
 * 多端同步的合并：按表、按主键做三方合并（上次同步时的样子 base、这台设备现在 local、服务器上 remote）。
 * 纯函数，不碰库和网络。行的比较用「键排序后的 JSON」，所以同一行在两台设备上字段顺序不同也不算改过。
 *
 * 规则（每一行）：
 *   两边一样 → 就是它；
 *   只有一边和 base 不同 → 用改过的那边（删掉也算改）；
 *   两边都改了、改得不一样 → 冲突：行里有数字 updatedAt 就大的赢，没有就按两边的"最后写入时间"赢；
 *     第一次同步没有 base，撞上的只会是单例和设置项（home、kv），这时服务器那份赢，新设备跟着它；
 *   一边删、一边改 → 改的赢（删了还能再删，改的内容丢了就没了）。
 *   home、kv 的冲突静默处理（只记日志不留副本）：它们是两台设备都天天写的状态行，不是你的内容。
 * 表级别：这边没有的表（没装的插件）原样放行 remote 的，那边没有的表留 local 的，谁都不替别人删表。
 */
import type { Backup } from './backup';

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

/** 本机缓存，不同步：kv 里这些 key 的行不进同步文件，合并时也不碰 */
export const LOCAL_KV_KEYS = ['kernel.lastSeen'];
/** kv 里 key 以这个结尾的是本机缓存（天气预报缓存等），同样不同步 */
export const LOCAL_KV_SUFFIX = '.cache';

export function isLocalKv(key: unknown): boolean {
  return typeof key === 'string' && (LOCAL_KV_KEYS.includes(key) || key.endsWith(LOCAL_KV_SUFFIX));
}

/** 去掉不该同步的行；返回新对象 */
export function stripLocal(tables: Tables): Tables {
  const out: Tables = {};
  for (const [name, rows] of Object.entries(tables)) {
    out[name] = name === 'kv' ? rows.filter((r) => !isLocalKv(r.key)) : rows.slice();
  }
  return out;
}

/** kv 里开了锁屏的标记行；有它在，明文 secret.* 就不该出现在同一份文件里 */
export const LOCK_KV_KEY = 'kernel.lock';
export const SECRET_KV_PREFIX = 'secret.';

/**
 * 推上去之前：合完的 kv 里有 kernel.lock（这台或别的设备开了锁屏），就不带明文 secret.*。
 * 典型情况：新设备没开锁，先填了同步密码，第一次同步拉到另一台设备的锁；它的明文密码不该跟着锁一起躺在服务器上。
 * 本机那几行留着，解锁时内核会把它们封进锁里再删掉。返回新对象。
 */
export function stripLooseSecrets(tables: Tables): Tables {
  const kv = tables.kv;
  if (!kv || !kv.some((r) => r.key === LOCK_KV_KEY)) return tables;
  const loose = kv.filter((r) => typeof r.key === 'string' && (r.key as string).startsWith(SECRET_KV_PREFIX));
  if (!loose.length) return tables;
  return { ...tables, kv: kv.filter((r) => !loose.includes(r)) };
}

/** 键排序后的 JSON：同样的内容一定得到同样的字符串 */
export function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined';
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const keys = Object.keys(v as Row).filter((k) => (v as Row)[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon((v as Row)[k])).join(',') + '}';
}

/** 整份 tables 的指纹（表名排序），用来判断"这台设备上次同步后有没有改过" */
export async function fingerprint(tables: Tables): Promise<string> {
  const text = canon(tables);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 主键取值：keyPath 可能是一个字段或几个字段（复合主键），拼成一个字符串 */
export function rowKey(row: Row, keyPath: string | string[]): string {
  if (Array.isArray(keyPath)) return keyPath.map((k) => JSON.stringify(row[k])).join('\u0000');
  return JSON.stringify(row[keyPath]);
}

export interface Conflict {
  table: string;
  key: string;
  winner: 'local' | 'remote';
  /** 输掉的那一行；输掉的是"删除"时为 null */
  lost: Row | null;
  /** 静默冲突：只记日志，不留冲突副本（home、kv 这种两台设备都会天天碰的状态行） */
  quiet: boolean;
}

/** 这些表的冲突静默按规则决胜负：home 的 lastActiveAt / catchupAt、kv 里插件的"今天说过了"每台设备都在写，留副本只会把 conflicts/ 塞满 */
export const QUIET_TABLES = ['home', 'kv'];

export interface MergeResult {
  merged: Tables;
  /** 要写进本地库的改动（merged 相对 local 的差） */
  puts: Tables;
  deletes: Record<string, Row[]>;
  /** merged 和 remote 不一样 → 要推上去 */
  remoteDiffers: boolean;
  conflicts: Conflict[];
  /** 冲突里输掉的本地行 / 远端行，按表归好，做冲突副本用 */
  lostLocal: Tables;
  lostRemote: Tables;
}

export interface MergeOptions {
  /** 这边库里每张表的主键；没有的表返回 null（没装的插件） */
  keyPath: (table: string) => string | string[] | null;
  /** 这台设备最后一次写库的时间，和 remoteTime 比谁后写 */
  localTime: number;
  /** 服务器那份的导出时间 */
  remoteTime: number;
  /** 哪些表的冲突不留副本；默认 QUIET_TABLES */
  quiet?: (table: string) => boolean;
}

function index(rows: Row[] | undefined, keyPath: string | string[]): Map<string, Row> {
  const m = new Map<string, Row>();
  for (const r of rows ?? []) m.set(rowKey(r, keyPath), r);
  return m;
}

function updatedAt(r: Row | undefined): number | null {
  const v = r?.updatedAt;
  return typeof v === 'number' ? v : null;
}

export function merge(base: Tables | null, local: Tables, remote: Tables, opts: MergeOptions): MergeResult {
  const merged: Tables = {};
  const puts: Tables = {};
  const deletes: Record<string, Row[]> = {};
  const conflicts: Conflict[] = [];
  const lostLocal: Tables = {};
  const lostRemote: Tables = {};
  let remoteDiffers = false;
  const names = new Set([...Object.keys(local), ...Object.keys(remote)]);

  for (const name of names) {
    const kp = opts.keyPath(name);
    if (!(name in local) || !kp) {
      // 这边没有这张表（插件没装）：远端的原样带着，不替别人删
      const rr = remote[name];
      if (rr) merged[name] = rr;
      continue;
    }
    if (!(name in remote)) {
      // 那边没有这张表：留这边的，推上去
      const ll = local[name] ?? [];
      merged[name] = ll;
      if (ll.length) remoteDiffers = true;
      continue;
    }
    const B = index(base?.[name], kp);
    const L = index(local[name], kp);
    const R = index(remote[name], kp);
    const out: Row[] = [];
    const keys = new Set([...L.keys(), ...R.keys(), ...B.keys()]);
    for (const k of keys) {
      const b = B.get(k), l = L.get(k), r = R.get(k);
      const cb = b ? canon(b) : undefined, cl = l ? canon(l) : undefined, cr = r ? canon(r) : undefined;
      let pick: Row | undefined;
      if (cl === cr) pick = l;
      else if (cl === cb) pick = r; // 只有远端改了
      else if (cr === cb) pick = l; // 只有本地改了
      else if (!l) pick = r; // 本地删了、远端改了：改的赢
      else if (!r) pick = l; // 远端删了、本地改了：改的赢
      else {
        // 第一次同步（没有 base）时撞上的只会是单例和设置项（home、kv），新加入的设备听服务器的
        const ul = updatedAt(l), ur = updatedAt(r);
        const localWins = ul !== null && ur !== null ? ul >= ur : base ? opts.localTime >= opts.remoteTime : false;
        pick = localWins ? l : r;
        const lost = localWins ? r : l;
        const quiet = (opts.quiet ?? ((t) => QUIET_TABLES.includes(t)))(name);
        conflicts.push({ table: name, key: k, winner: localWins ? 'local' : 'remote', lost, quiet });
        if (!quiet) {
          const bucket = localWins ? lostRemote : lostLocal;
          (bucket[name] ??= []).push(lost);
        }
      }
      if (pick) out.push(pick);
      const cp = pick ? canon(pick) : undefined;
      if (cp !== cl) {
        if (pick) (puts[name] ??= []).push(pick);
        else if (l) (deletes[name] ??= []).push(l);
      }
      if (cp !== cr) remoteDiffers = true;
    }
    merged[name] = out;
  }
  return { merged, puts, deletes, remoteDiffers, conflicts, lostLocal, lostRemote };
}

/** 有没有要写进本地库的东西 */
export function hasLocalChanges(r: MergeResult): boolean {
  return Object.values(r.puts).some((x) => x.length) || Object.values(r.deletes).some((x) => x.length);
}

/** 哪些表动了（写进本地库的那部分） */
export function changedTables(r: MergeResult): string[] {
  return [...new Set([...Object.keys(r.puts), ...Object.keys(r.deletes)])];
}

/** 本地写入里有没有碰到内核设置（kernel.* 的 kv）：这些是启动时读进内存的，改了只能重新打开 */
export function touchesKernelKv(r: MergeResult): boolean {
  const rows = [...(r.puts.kv ?? []), ...(r.deletes.kv ?? [])];
  return rows.some((row) => typeof row.key === 'string' && row.key.startsWith('kernel.'));
}

/** 用一份 Backup 的头 + 给定的表拼一份新文件 */
export function withTables(head: Backup, tables: Tables, now: Date): Backup {
  return { app: head.app, kernel: head.kernel, schema: head.schema, exportedAt: now.toISOString(), tables };
}
