import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LockRecord } from './lock.svelte';

vi.mock('../log/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const ITER = 1000;

/** 每个用例都像刷新页面一样：新库、新网关、新锁 */
async function fresh() {
  vi.resetModules();
  const dbm = await import('../storage/db');
  const db = new dbm.PocketDB('lock-test-' + Math.random().toString(36).slice(2));
  // openDB 是单例，用 instance 注入：模块重置后 instance 为空，这里直接塞进去
  vi.doMock('../storage/db', () => ({ ...dbm, db: () => db, openDB: () => db }));
  const { llm } = await import('../llm/gateway.svelte');
  const { lock } = await import('./lock.svelte');
  // resetModules 之后 crypto 也是新实例，WrongPinError 的类要从同一份里拿
  const { open, WrongPinError } = await import('./crypto');
  return { db, llm, lock, open, WrongPinError };
}

describe('lock', () => {
  beforeEach(() => { vi.resetModules(); });

  it('开锁屏后 kv 里没有明文 Key，内存里还有', async () => {
    const { db, llm, lock, open, WrongPinError } = await fresh();
    await llm.boot();
    await llm.save({ apiKey: 'sk-ant-plain' });
    expect((await db.getKV<{ apiKey: string }>('kernel.llm', { apiKey: '' })).apiKey).toBe('sk-ant-plain');

    await lock.boot({ iter: ITER });
    await lock.enable('1234');
    expect(lock.enabled).toBe(true);
    expect(lock.locked).toBe(false);
    expect(llm.settings.apiKey).toBe('sk-ant-plain');
    expect(llm.configured).toBe(true);

    const kv = await db.kv.toArray();
    expect(JSON.stringify(kv)).not.toContain('sk-ant-plain');
    const rec = await db.getKV<LockRecord | null>('kernel.lock', null);
    expect(rec?.hasKey).toBe(true);
    expect(rec?.pinLength).toBe(4);
    expect((await open(rec!.sealed, '1234')).plain).toBe('sk-ant-plain');
  });

  it('开着锁屏时改 Key 走保险箱重封，kv 仍无明文', async () => {
    const { db, llm, lock, open, WrongPinError } = await fresh();
    await llm.boot();
    await lock.boot({ iter: ITER });
    await lock.enable('123456');
    await llm.save({ apiKey: 'sk-ant-second' });
    expect(JSON.stringify(await db.kv.toArray())).not.toContain('sk-ant-second');
    const rec = (await db.getKV<LockRecord | null>('kernel.lock', null))!;
    expect((await open(rec.sealed, '123456')).plain).toBe('sk-ant-second');
    expect(rec.hasKey).toBe(true);
  });

  it('刷新后从 kv 启动：锁着、configured 为真、Key 不在内存；解锁后回来', async () => {
    const a = await fresh();
    await a.llm.boot();
    await a.llm.save({ apiKey: 'sk-ant-x' });
    await a.lock.boot({ iter: ITER });
    await a.lock.enable('2468');
    // 模拟刷新：同一个库，新实例
    vi.resetModules();
    vi.doMock('../storage/db', async () => ({ ...(await vi.importActual<typeof import('../storage/db')>('../storage/db')), db: () => a.db, openDB: () => a.db }));
    const { llm } = await import('../llm/gateway.svelte');
    const { lock } = await import('./lock.svelte');
    const { WrongPinError } = await import('./crypto');
    await llm.boot();
    expect(llm.settings.apiKey).toBe('');
    await lock.boot({ iter: ITER });
    expect(lock.enabled).toBe(true);
    expect(lock.locked).toBe(true);
    expect(lock.pinLength).toBe(4);
    expect(llm.configured).toBe(true); // 锁着也算配置过，补发不会误判成没填 Key

    let readyResolved = false;
    const ready = lock.ready().then(() => (readyResolved = true));
    await Promise.resolve();
    expect(readyResolved).toBe(false);

    await expect(lock.unlock('0000')).rejects.toBeInstanceOf(WrongPinError);
    expect(lock.failures).toBe(1);
    expect(lock.locked).toBe(true);

    await lock.unlock('2468');
    await ready;
    expect(readyResolved).toBe(true);
    expect(lock.locked).toBe(false);
    expect(lock.failures).toBe(0);
    expect(llm.settings.apiKey).toBe('sk-ant-x');
  });

  it('连错 5 次进入冷却，冷却期间不核对', async () => {
    const { llm, lock, WrongPinError } = await fresh();
    await llm.boot();
    await lock.boot({ iter: ITER });
    await lock.enable('1111');
    lock.lockNow();
    for (let i = 0; i < 5; i++) await expect(lock.unlock('9999')).rejects.toBeInstanceOf(WrongPinError);
    expect(lock.coolingDown).toBe(true);
    await expect(lock.unlock('1111')).rejects.toThrow(/等 \d+ 秒/);
    expect(lock.locked).toBe(true);
  });

  it('lockNow 丢掉内存里的 Key；onResume 按空闲时间决定', async () => {
    const { llm, lock, WrongPinError } = await fresh();
    await llm.boot();
    await llm.save({ apiKey: 'sk-ant-y' });
    await lock.boot({ iter: ITER });
    await lock.enable('1234', 5);
    lock.onResume(4 * 60_000);
    expect(lock.locked).toBe(false);
    lock.onResume(5 * 60_000);
    expect(lock.locked).toBe(true);
    expect(llm.settings.apiKey).toBe('');
    await lock.unlock('1234');
    await lock.setIdle(-1);
    lock.onResume(24 * 3600_000);
    expect(lock.locked).toBe(false);
    await lock.setIdle(0);
    lock.onResume(1);
    expect(lock.locked).toBe(true);
  });

  it('关锁屏要 PIN，Key 明文写回 kv；忘了 PIN 清 Key 不丢其他数据', async () => {
    const { db, llm, lock, open, WrongPinError } = await fresh();
    await llm.boot();
    await llm.save({ apiKey: 'sk-ant-z', model: 'm1' });
    await db.setKV('kernel.userName', '小天');
    await lock.boot({ iter: ITER });
    await lock.enable('1234');
    await expect(lock.disable('4321')).rejects.toBeInstanceOf(WrongPinError);
    expect(lock.enabled).toBe(true);
    await lock.disable('1234');
    expect(lock.enabled).toBe(false);
    expect(await db.getKV('kernel.lock', null)).toBeNull();
    expect((await db.getKV<{ apiKey: string; model: string }>('kernel.llm', { apiKey: '', model: '' }))).toMatchObject({ apiKey: 'sk-ant-z', model: 'm1' });

    await lock.enable('5555');
    lock.lockNow();
    await lock.reset();
    expect(lock.enabled).toBe(false);
    expect(lock.locked).toBe(false);
    expect(llm.settings.apiKey).toBe('');
    expect(llm.configured).toBe(false);
    expect(await db.getKV('kernel.lock', null)).toBeNull();
    expect((await db.getKV<{ apiKey: string; model: string }>('kernel.llm', { apiKey: 'x', model: '' }))).toMatchObject({ apiKey: '', model: 'm1' });
    expect(await db.getKV('kernel.userName', '')).toBe('小天');
  });

  it('改 PIN：旧的失效，新的能开，Key 不变', async () => {
    const { db, llm, lock, open, WrongPinError } = await fresh();
    await llm.boot();
    await llm.save({ apiKey: 'sk-ant-c' });
    await lock.boot({ iter: ITER });
    await lock.enable('1234');
    await expect(lock.changePin('0000', '987654')).rejects.toBeInstanceOf(WrongPinError);
    await lock.changePin('1234', '987654');
    expect(lock.pinLength).toBe(6);
    const rec = (await db.getKV<LockRecord | null>('kernel.lock', null))!;
    await expect(open(rec.sealed, '1234')).rejects.toBeInstanceOf(WrongPinError);
    expect((await open(rec.sealed, '987654')).plain).toBe('sk-ant-c');
    expect(await lock.verify('987654')).toBe(true);
    expect(await lock.verify('1234')).toBe(false);
  });

  it('插件秘密：没开锁屏明文在 kv；开了搬进 kernel.lock，kv 里不再有明文；锁着时读要等解锁', async () => {
    const a = await fresh();
    await a.llm.boot();
    await a.lock.boot({ iter: ITER });
    await a.lock.setSecret('plugin.telegram.botToken', '123:tok-plain');
    expect(await a.db.getKV('secret.plugin.telegram.botToken', '')).toBe('123:tok-plain');
    expect(await a.lock.getSecret('plugin.telegram.botToken')).toBe('123:tok-plain');
    await a.lock.setSecret('plugin.sync.pass', '');
    expect(await a.lock.getSecret('plugin.sync.pass')).toBe('');

    await a.lock.enable('1234');
    expect(JSON.stringify(await a.db.kv.toArray())).not.toContain('tok-plain');
    const rec = (await a.db.getKV<LockRecord | null>('kernel.lock', null))!;
    expect(Object.keys(rec.secrets ?? {})).toEqual(['plugin.telegram.botToken']);
    expect(await a.lock.getSecret('plugin.telegram.botToken')).toBe('123:tok-plain');
    // 开着锁屏改：重封
    await a.lock.setSecret('plugin.telegram.botToken', '123:tok-second');
    expect(JSON.stringify(await a.db.kv.toArray())).not.toContain('tok-second');
    expect(await a.lock.getSecret('plugin.telegram.botToken')).toBe('123:tok-second');

    // 刷新：锁着，读要等
    vi.resetModules();
    vi.doMock('../storage/db', async () => ({ ...(await vi.importActual<typeof import('../storage/db')>('../storage/db')), db: () => a.db, openDB: () => a.db }));
    const { llm } = await import('../llm/gateway.svelte');
    const { lock } = await import('./lock.svelte');
    await llm.boot();
    await lock.boot({ iter: ITER });
    expect(lock.locked).toBe(true);
    let got = '';
    const pending = lock.getSecret('plugin.telegram.botToken').then((v) => (got = v));
    await Promise.resolve();
    expect(got).toBe('');
    await expect(lock.setSecret('plugin.telegram.botToken', 'x')).rejects.toThrow(/锁着/);
    await lock.unlock('1234');
    await pending;
    expect(got).toBe('123:tok-second');
    lock.lockNow();
    expect(lock.locked).toBe(true);
  });

  it('插件秘密跟着改 PIN、关锁屏、忘 PIN 走', async () => {
    const { db, llm, lock } = await fresh();
    await llm.boot();
    await llm.save({ apiKey: 'sk-ant-s' });
    await lock.boot({ iter: ITER });
    await lock.enable('1234');
    await lock.setSecret('plugin.telegram.botToken', '9:tok');
    await lock.changePin('1234', '5678');
    expect(await lock.getSecret('plugin.telegram.botToken')).toBe('9:tok');
    await lock.disable('5678');
    expect(await db.getKV('secret.plugin.telegram.botToken', '')).toBe('9:tok');
    expect(await lock.getSecret('plugin.telegram.botToken')).toBe('9:tok');
    await lock.enable('0000');
    expect(await db.getKV('secret.plugin.telegram.botToken', '')).toBe('');
    await lock.reset();
    expect(await lock.getSecret('plugin.telegram.botToken')).toBe('');
    expect(await db.getKV('kernel.lock', null)).toBeNull();
  });
});
