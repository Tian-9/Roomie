/**
 * 多端同步：把整库备份放到你自己的 WebDAV 上，几台设备各自和它做三方合并。没有 Roomie 的服务器。
 *
 * - 服务器上只有一个文件 <文件夹>/roomie.json（备份格式），加一个 conflicts/ 目录放冲突副本。
 * - 这台设备记着上次同步完的样子（base，存在另一个只在本机的 IndexedDB 库 roomie-sync 里）和那个文件的 ETag。
 * - 同步 = 导出本地 → 看服务器文件的 ETag 变没变 → 变了就下载 → merge(base, local, remote) → 差的部分写进本地库、
 *   合完的推上去（If-Match 带上 ETag，别的设备抢先写了就重来一遍）→ base 换成合完的。
 * - 冲突（同一行两边都改了）按行决胜负，输掉的一方整份快照留在 conflicts/ 里，可以在设置里看、恢复、删。
 * - 什么时候同步：打开时、从后台回来时、本地改动后十几秒、手动点。配置在 kv kernel.sync（随数据同步），
 *   密码走插件秘密 lock.getSecret（开了锁屏就被 PIN 封着），本机状态（base / ETag / 设备名）不同步。
 */
import Dexie from 'dexie';
import { db } from '$kernel/storage/db';
import { bus } from '$kernel/bus/bus';
import { log } from '$kernel/log/log';
import { lock } from '$kernel/lock/lock.svelte';
import { exportBackup, importBackup, parseBackup, decodeValue, SKIP_TABLES, type Backup } from './backup';
import { merge, stripLocal, stripLooseSecrets, withTables, hasLocalChanges, touchesKernelKv, changedTables, type Tables, type Row, type MergeResult } from './merge';
import { WebDav, DavError, normalizeUrl, isValidUrl, type Entry, type FetchLike } from './webdav';

export interface SyncConfig {
  url: string;
  username: string;
  /** 服务器上的文件夹名，相对 url */
  folder: string;
  /** 打开 / 回来 / 改动后自动同步 */
  auto: boolean;
}
export const SYNC_KV = 'kernel.sync';
/** 密码走插件秘密：kv secret.plugin.settings.webdav，开了锁屏就封进 kernel.lock */
export const SECRET_NAME = 'plugin.settings.webdav';
export const FILE_NAME = 'roomie.json';
export const CONFLICT_DIR = 'conflicts';
const DEFAULTS: SyncConfig = { url: '', username: '', folder: 'roomie', auto: true };
/** 改动后等这么久再推，免得一句话一次请求 */
const DEBOUNCE_MS = 15_000;
/** 从后台回来超过这么久才查一次 */
const RESUME_MIN_MS = 60_000;

/** 本机状态：上次同步完的样子 */
interface LocalState {
  base: Tables;
  etag: string;
  syncedAt: number;
}

export interface SyncOutcome {
  /** 一句话结果，给界面 */
  summary: string;
  pulled: string[];
  pushed: boolean;
  conflicts: number;
  reloading: boolean;
}

/** 本机状态存在另一个库里：整库导入 / 导出不会碰它 */
class SyncStore extends Dexie {
  kv!: Dexie.Table<{ key: string; value: unknown }, string>;
  constructor(name = 'roomie-sync') {
    super(name);
    this.version(1).stores({ kv: 'key' });
  }
  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.kv.get(key);
    return row ? (row.value as T) : fallback;
  }
  set(key: string, value: unknown) { return this.kv.put({ key, value }); }
}

function guessDevice(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '设备';
  return os + '-' + Math.random().toString(36).slice(2, 6);
}

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

export class Sync {
  config = $state<SyncConfig>({ ...DEFAULTS });
  /** 密码存过没有（锁着时也能知道） */
  hasPassword = $state(false);
  running = $state(false);
  lastSyncAt = $state(0);
  lastSummary = $state('');
  error = $state('');
  /** 上次同步后本地有没有改过 */
  dirty = $state(false);
  device = $state('');

  private store: SyncStore;
  private fetchFn: FetchLike | undefined;
  private changedAt = 0;
  private applying = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<SyncOutcome> | null = null;
  private booted = false;

  constructor(opts: { store?: SyncStore; fetchFn?: FetchLike } = {}) {
    this.store = opts.store ?? new SyncStore();
    this.fetchFn = opts.fetchFn;
  }

  get configured() { return isValidUrl(this.config.url) && this.config.username.trim().length > 0 && this.hasPassword; }

  async boot() {
    this.config = { ...DEFAULTS, ...(await db().getKV<Partial<SyncConfig>>(SYNC_KV, {})) };
    this.hasPassword = await lock.hasSecret(SECRET_NAME);
    this.lastSyncAt = (await this.store.get<LocalState | null>('state', null))?.syncedAt ?? 0;
    this.device = await this.store.get<string>('device', '');
    if (!this.device) { this.device = guessDevice(); await this.store.set('device', this.device); }
    if (this.booted) return;
    this.booted = true;
    // 本地任何一张要同步的表写了，就记一下时间，自动同步开着的话过一会儿推
    Dexie.on('storagemutated', (parts) => {
      if (this.applying) return;
      for (const part of Object.keys(parts)) {
        const m = /^idb:\/\/roomie\/([^/]+)\//.exec(part);
        const table = m?.[1] ?? '';
        if (!m || SKIP_TABLES.includes(table)) continue;
        this.changedAt = Date.now();
        this.dirty = true;
        this.schedule(DEBOUNCE_MS);
        break;
      }
    });
    bus.on('app.resumed', ({ elapsedMs }) => { if (elapsedMs >= RESUME_MIN_MS) this.schedule(0); });
    // 打开时查一次；锁着的话 secrets.get 会等到解锁
    this.schedule(0);
  }

  private schedule(ms: number) {
    if (!this.config.auto || !this.configured) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.now().catch(() => {}); }, ms);
  }

  /** 存配置；密码给了空串就保留原来的 */
  async save(cfg: Partial<SyncConfig>, password?: string) {
    this.config = { ...this.config, ...cfg, url: normalizeUrl(cfg.url ?? this.config.url), folder: (cfg.folder ?? this.config.folder).replace(/^\/+|\/+$/g, '') || 'roomie' };
    await db().setKV(SYNC_KV, $state.snapshot(this.config));
    if (password !== undefined && password !== '') {
      await lock.setSecret(SECRET_NAME, password);
      this.hasPassword = true;
    }
  }

  async setDevice(name: string) {
    this.device = name.trim() || guessDevice();
    await this.store.set('device', this.device);
  }

  /** 断开：忘掉服务器、密码和本机状态；服务器上的文件不动，数据不动 */
  async forget() {
    this.config = { ...DEFAULTS };
    await db().kv.delete(SYNC_KV);
    await lock.setSecret(SECRET_NAME, '');
    this.hasPassword = false;
    await this.store.kv.delete('state');
    this.lastSyncAt = 0; this.lastSummary = ''; this.error = ''; this.dirty = false;
  }

  private async client(cfg = this.config, password?: string): Promise<WebDav> {
    const pass = password ?? (await lock.getSecret(SECRET_NAME));
    return new WebDav({ url: cfg.url, username: cfg.username, password: pass }, this.fetchFn);
  }

  /** 试连：建文件夹、看文件在不在。返回服务器上有没有现成的文件 */
  async test(cfg: SyncConfig, password: string): Promise<{ exists: boolean; lastModified?: string }> {
    if (!isValidUrl(cfg.url)) throw new DavError('地址要以 http:// 或 https:// 开头', 'http');
    const dav = await this.client({ ...cfg, url: normalizeUrl(cfg.url) }, password || (await lock.getSecret(SECRET_NAME)));
    const folder = cfg.folder.replace(/^\/+|\/+$/g, '') || 'roomie';
    await dav.mkcol(folder);
    const st = await dav.stat(`${folder}/${FILE_NAME}`);
    return { exists: !!st, lastModified: st?.lastModified };
  }

  /** 现在同步一次；已经在同步就等那一次 */
  now(): Promise<SyncOutcome> {
    if (this.pending) return this.pending;
    this.pending = this.run().finally(() => { this.pending = null; });
    return this.pending;
  }

  private async run(): Promise<SyncOutcome> {
    if (!this.configured) throw new Error('还没有填服务器');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('现在没有网络');
    this.running = true; this.error = '';
    try {
      let out: SyncOutcome | null = null;
      for (let attempt = 0; attempt < 3 && !out; attempt++) {
        try { out = await this.once(); }
        catch (e) {
          // 别的设备抢先写了：再来一遍，这次会把它写的拉下来合并
          if (e instanceof DavError && e.kind === 'conflict' && attempt < 2) { log.info('sync', '服务器文件刚被别的设备改过，重来'); continue; }
          throw e;
        }
      }
      const o = out!;
      this.lastSyncAt = Date.now();
      this.lastSummary = o.summary;
      this.dirty = false;
      log.info('sync', o.summary, { pulled: o.pulled, pushed: o.pushed, conflicts: o.conflicts });
      if (o.reloading) {
        bus.emit('notify', { title: '另一台设备改了设置', body: '已同步过来，正在重新打开……' });
        setTimeout(() => location.reload(), 800);
      }
      return o;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      log.error('sync', '同步失败：' + this.error);
      throw e;
    } finally {
      this.running = false;
    }
  }

  private keyPath(table: string): string | string[] | null {
    const t = db().tables.find((x) => x.name === table);
    const kp = t?.schema.primKey.keyPath;
    return kp === undefined ? null : kp;
  }

  private async once(): Promise<SyncOutcome> {
    const dav = await this.client();
    const path = `${this.config.folder}/${FILE_NAME}`;
    const state = await this.store.get<LocalState | null>('state', null);
    const head = await exportBackup(db());
    const local = stripLocal(head.tables as Tables);
    const localTime = this.changedAt || Date.now();
    const now = new Date();

    // 服务器上有什么；文件夹不在就先建
    const st = await dav.stat(path);
    if (!st) await dav.mkcol(this.config.folder);
    let remote: Tables | null = null;
    let remoteTime = 0;
    let etag = st?.etag ?? '';
    if (st && state && st.etag && st.etag === state.etag) {
      // 没变：上次合完的就是服务器上的
      remote = state.base;
      remoteTime = state.syncedAt;
    } else if (st) {
      const got = await dav.get(path);
      if (got) {
        const b = parseBackup(got.text, db().verno);
        remote = stripLocal(b.tables as Tables);
        remoteTime = Date.parse(b.exportedAt) || 0;
        etag = got.etag || etag;
      }
    }

    const res: MergeResult = remote
      ? merge(state?.base ?? null, local, remote, { keyPath: (t) => this.keyPath(t), localTime, remoteTime })
      : { merged: local, puts: {}, deletes: {}, remoteDiffers: true, conflicts: [], lostLocal: {}, lostRemote: {} };

    // 冲突副本先传，再动真文件：输掉的一方整份留着
    let conflictNote = '';
    const loud = res.conflicts.filter((c) => !c.quiet);
    const quiet = res.conflicts.filter((c) => c.quiet);
    if (quiet.length) log.info('sync', `${quiet.length} 处状态行两边都改过，按时间取新的`, { conflicts: quiet.map((c) => `${c.table}:${c.key}→${c.winner}`) });
    if (loud.length) {
      await dav.mkcol(`${this.config.folder}/${CONFLICT_DIR}`);
      const names: string[] = [];
      if (Object.keys(res.lostLocal).length) {
        const name = `${stamp(now)}-${this.device}-本机.json`;
        await dav.put(`${this.config.folder}/${CONFLICT_DIR}/${name}`, JSON.stringify(withTables(head, local, now)));
        names.push(name);
      }
      if (Object.keys(res.lostRemote).length && remote) {
        const name = `${stamp(now)}-${this.device}-远端.json`;
        await dav.put(`${this.config.folder}/${CONFLICT_DIR}/${name}`, JSON.stringify(withTables(head, remote, new Date(remoteTime || now))));
        names.push(name);
      }
      conflictNote = `${loud.length} 处两边都改过，留了冲突副本`;
      log.warn('sync', conflictNote, { conflicts: loud.map((c) => `${c.table}:${c.key}→${c.winner}`), files: names });
    }

    // 推：先推再写本地，推失败（412）本地什么都没动，重来即可
    let pushed = false;
    if (res.remoteDiffers) {
      const file = withTables(head, stripLooseSecrets(res.merged), now);
      etag = await dav.put(path, JSON.stringify(file), st ? { ifMatch: etag || undefined } : { ifNoneMatch: true });
      pushed = true;
    }

    // 写本地
    const pulled = changedTables(res);
    if (hasLocalChanges(res)) await this.apply(res);

    await this.store.set('state', { base: res.merged, etag, syncedAt: Date.now() } satisfies LocalState);

    const parts: string[] = [];
    if (pulled.length) parts.push(`拉下来 ${pulled.length} 张表的改动`);
    if (pushed) parts.push(remote ? '推上去了这边的改动' : '第一次上传');
    if (conflictNote) parts.push(conflictNote);
    const summary = parts.length ? parts.join('，') : '已经是最新的';
    return { summary, pulled, pushed, conflicts: loud.length, reloading: touchesKernelKv(res) };
  }

  /** 把合并结果里和本地不同的行写进库：只动差的行，正在进行的对话不受影响 */
  private async apply(res: MergeResult) {
    const names = changedTables(res);
    const tables = names.map((n) => db().table(n));
    const puts: Record<string, Row[]> = {};
    const dels: Record<string, unknown[]> = {};
    for (const n of names) {
      const kp = this.keyPath(n)!;
      puts[n] = (decodeValue(res.puts[n] ?? []) as Row[]);
      dels[n] = (res.deletes[n] ?? []).map((r) => (Array.isArray(kp) ? kp.map((k) => r[k]) : r[kp]));
    }
    this.applying = true;
    try {
      await db().transaction('rw', tables, async () => {
        for (const n of names) {
          const p = puts[n] ?? [], d = dels[n] ?? [];
          if (p.length) await db().table(n).bulkPut(p);
          if (d.length) await db().table(n).bulkDelete(d as never[]);
        }
      });
    } finally {
      // storagemutated 在事务提交后才发，稍等一下再放开
      setTimeout(() => { this.applying = false; }, 50);
    }
  }

  /* ---------- 冲突副本 ---------- */

  async listConflicts(): Promise<Entry[]> {
    const dav = await this.client();
    const list = await dav.list(`${this.config.folder}/${CONFLICT_DIR}`);
    return list.filter((e) => e.name.endsWith('.json')).sort((a, b) => (a.name < b.name ? 1 : -1));
  }

  /** 读一份冲突副本，交给调用方预览 */
  async readConflict(name: string): Promise<Backup> {
    const dav = await this.client();
    const got = await dav.get(`${this.config.folder}/${CONFLICT_DIR}/${name}`);
    if (!got) throw new Error('这份副本已经不在服务器上了');
    return parseBackup(got.text, db().verno);
  }

  /** 用一份副本整库替换本地（和导入备份一样），之后本地和 base 不同，下次同步会推上去 */
  async restoreConflict(b: Backup) {
    this.applying = true;
    try { await importBackup(db(), b); }
    finally { setTimeout(() => { this.applying = false; }, 50); }
    this.changedAt = Date.now();
  }

  async deleteConflict(name: string) {
    const dav = await this.client();
    await dav.delete(`${this.config.folder}/${CONFLICT_DIR}/${name}`);
  }
}

export const sync = new Sync();
