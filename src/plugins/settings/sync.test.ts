import { describe, it, expect, vi, beforeEach } from 'vitest';
import Dexie from 'dexie';
import type { PluginManifest } from '$kernel/api';
import { FakeDav } from './webdav.fake';

vi.mock('$kernel/log/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const plugin: PluginManifest = { id: 'ledger', name: 'x', version: '0', storage: { tables: { entries: 'id, date' } } };

/**
 * 两台"设备"共用一个假服务器。sync 模块用的是全局 db()，这里把它换成可切换的：
 * use(dev) 之后 db() 就是那台设备的库。
 */
async function world() {
  vi.resetModules();
  const dbm = await import('$kernel/storage/db');
  let current: InstanceType<typeof dbm.PocketDB>;
  vi.doMock('$kernel/storage/db', () => ({ ...dbm, db: () => current, openDB: () => current }));
  const { Sync } = await import('./sync.svelte');
  const { exportBackup } = await import('./backup');
  const server = new FakeDav();

  class Store extends Dexie {
    kv!: Dexie.Table<{ key: string; value: unknown }, string>;
    constructor() { super('sync-store-' + Math.random().toString(36).slice(2)); this.version(1).stores({ kv: 'key' }); }
    async get<T>(key: string, fallback: T): Promise<T> { const r = await this.kv.get(key); return r ? (r.value as T) : fallback; }
    set(key: string, value: unknown) { return this.kv.put({ key, value }); }
  }

  async function device(name: string) {
    const db = new dbm.PocketDB('sync-test-' + name + '-' + Math.random().toString(36).slice(2), [plugin]);
    const store = new Store();
    // 构造参数里的 store 类型是模块私有的，形状一样就行
    const s = new Sync({ store: store as never, fetchFn: server.fetch });
    const use = () => { current = db; };
    use();
    await db.home.put({ id: 'home', state: { mood: '', relation: '', facts: [] }, lastActiveAt: 1 });
    await s.setDevice(name);
    await s.save({ url: server.base, username: server.user, folder: 'roomie', auto: false }, server.pass);
    return { db, sync: s, use, name };
  }
  return { server, device, exportBackup };
}

type Dev = Awaited<ReturnType<Awaited<ReturnType<typeof world>>['device']>>;
const msg = (id: string, text: string, ts: number) => ({ id, conversationId: 'cv', role: 'user' as const, content: [{ type: 'text', text }], ts });

describe('sync', () => {
  beforeEach(() => vi.resetModules());

  it('第一台上传，第二台拉下来；之后各改各的能合在一起', async () => {
    const w = await world();
    const a: Dev = await w.device('A');
    await a.db.messages.add(msg('m1', '早', 1));
    await a.db.setKV('kernel.llm', { apiKey: 'sk', model: 'x' });
    await a.db.setKV('kernel.lastSeen', 123);
    await a.db.setKV('plugin.weather.cache', { big: true });
    const o1 = await a.sync.now();
    expect(o1.pushed).toBe(true);
    expect(o1.summary).toContain('第一次上传');
    const uploaded = JSON.parse(w.server.files.get('roomie/roomie.json')!.body);
    expect(uploaded.app).toBe('roomie');
    expect(uploaded.tables.kv.map((r: { key: string }) => r.key).sort()).toEqual(['kernel.llm', 'kernel.sync', 'secret.plugin.settings.webdav']);
    expect(uploaded.tables.logs).toBeUndefined();

    // 再同步一次：什么都没变，不下载不上传
    w.server.requests.length = 0;
    const o1b = await a.sync.now();
    expect(o1b.summary).toBe('已经是最新的');
    expect(w.server.requests.filter((r) => r.startsWith('GET') || r.startsWith('PUT'))).toEqual([]);

    const b: Dev = await w.device('B');
    const o2 = await b.sync.now();
    expect(o2.pulled).toContain('messages');
    expect(o2.reloading).toBe(true); // 拉到了 kernel.llm
    expect(await b.db.messages.count()).toBe(1);
    expect((await b.db.getKV<{ apiKey: string }>('kernel.llm', { apiKey: '' })).apiKey).toBe('sk');
    expect(await b.db.kv.get('plugin.weather.cache')).toBeUndefined(); // 本机缓存没过来
    expect(await b.db.kv.get('kernel.lastSeen')).toBeUndefined();

    // A 发了一句，B 记了一笔；谁先谁后都不丢
    a.use();
    await a.db.messages.add(msg('m2', '午饭吃了', 2));
    await a.db.setKV('kernel.lastSeen', 456);
    await a.sync.now();
    b.use();
    await b.db.table('p_ledger_entries').add({ id: 'e1', date: '2026-10-11', amount: 3200 });
    const o3 = await b.sync.now();
    expect(o3.pulled).toEqual(['messages']);
    expect(o3.pushed).toBe(true);
    expect(o3.conflicts).toBe(0);
    expect(o3.reloading).toBe(false);
    expect(await b.db.messages.count()).toBe(2);
    a.use();
    const o4 = await a.sync.now();
    expect(o4.pulled).toEqual(['p_ledger_entries']);
    expect(await a.db.table('p_ledger_entries').count()).toBe(1);
    expect(await a.db.getKV('kernel.lastSeen', 0)).toBe(456); // 自己的本机状态没被动
  });

  it('两边改了同一处：按时间定输赢，输的那边留冲突副本；删除也能传过去', async () => {
    const w = await world();
    const a: Dev = await w.device('A');
    await a.db.notes.add({ path: '/you.md', content: 'v0', updatedAt: 1 });
    await a.db.messages.add(msg('m1', 'x', 1));
    await a.sync.now();
    const b: Dev = await w.device('B');
    await b.sync.now();

    a.use();
    await a.db.notes.put({ path: '/you.md', content: 'A 改的', updatedAt: 10 });
    await a.db.messages.delete('m1');
    await a.sync.now();
    b.use();
    await b.db.notes.put({ path: '/you.md', content: 'B 改的', updatedAt: 20 });
    const o = await b.sync.now();
    expect(o.conflicts).toBe(1);
    expect(o.summary).toContain('冲突副本');
    expect((await b.db.notes.get('/you.md'))?.content).toBe('B 改的');
    expect(await b.db.messages.count()).toBe(0); // A 的删除过来了
    const copies = [...w.server.files.keys()].filter((p) => p.startsWith('roomie/conflicts/'));
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/-B-远端\.json$/);
    const copy = JSON.parse(w.server.files.get(copies[0]!)!.body);
    expect(copy.tables.notes[0].content).toBe('A 改的');

    const list = await b.sync.listConflicts();
    expect(list.map((e) => e.name)).toEqual([copies[0]!.slice('roomie/conflicts/'.length)]);
    a.use();
    const oa = await a.sync.now();
    expect((await a.db.notes.get('/you.md'))?.content).toBe('B 改的');
    expect(oa.conflicts).toBe(0);
  });

  it('推的时候别的设备抢先写了（412）：重来一遍把它的也合进来', async () => {
    const w = await world();
    const a: Dev = await w.device('A');
    await a.sync.now();
    const b: Dev = await w.device('B');
    await b.sync.now();
    // B 在 A 的 HEAD 之后、PUT 之前写了服务器：用一次性的 fetch 钩子模拟
    a.use();
    await a.db.messages.add(msg('ma', 'a', 1));
    const body = JSON.stringify({ ...JSON.parse(w.server.files.get('roomie/roomie.json')!.body), tables: { ...JSON.parse(w.server.files.get('roomie/roomie.json')!.body).tables, messages: [msg('mb', 'b', 2)] } });
    let injected = false;
    const orig = w.server.fetch;
    (a.sync as unknown as { fetchFn: typeof orig }).fetchFn = async (u, init) => {
      if (!injected && (init?.method ?? 'GET') === 'PUT') { injected = true; w.server.write('roomie/roomie.json', body); }
      return orig(u, init);
    };
    const o = await a.sync.now();
    expect(o.pushed).toBe(true);
    expect((await a.db.messages.toArray()).map((m) => m.id).sort()).toEqual(['ma', 'mb']);
    expect(w.server.requests.filter((r) => r.startsWith('PUT roomie/roomie.json 412'))).toHaveLength(1);
    const final = JSON.parse(w.server.files.get('roomie/roomie.json')!.body);
    expect(final.tables.messages.map((m: { id: string }) => m.id).sort()).toEqual(['ma', 'mb']);
  });

  it('断网、密码错都报人话，本地不动', async () => {
    const w = await world();
    const a: Dev = await w.device('A');
    await a.db.messages.add(msg('m1', 'x', 1));
    w.server.offline = true;
    await expect(a.sync.now()).rejects.toThrow(/连不上/);
    expect(a.sync.error).toMatch(/连不上/);
    w.server.offline = false;
    await a.sync.save({}, 'wrong');
    await expect(a.sync.now()).rejects.toThrow(/密码不对/);
    expect(await a.db.messages.count()).toBe(1);
    expect(w.server.files.size).toBe(0);
    await a.sync.save({}, server_pass(w));
    await a.sync.now();
    expect(a.sync.error).toBe('');
  });

  it('断开：忘掉服务器和密码，数据不动', async () => {
    const w = await world();
    const a: Dev = await w.device('A');
    await a.db.messages.add(msg('m1', 'x', 1));
    await a.sync.now();
    await a.sync.forget();
    expect(a.sync.configured).toBe(false);
    expect(await a.db.kv.get('secret.plugin.settings.webdav')).toBeUndefined();
    expect(await a.db.kv.get('kernel.sync')).toBeUndefined();
    expect(await a.db.messages.count()).toBe(1);
    expect(w.server.files.size).toBe(1);
  });
});

function server_pass(w: { server: FakeDav }) { return w.server.pass; }
