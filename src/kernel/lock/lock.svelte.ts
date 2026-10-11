import { db } from '../storage/db';
import { llm } from '../llm/gateway.svelte';
import { log } from '../log/log';
import { seal, sealWith, open, openWith, isValidPin, WrongPinError, type Sealed } from './crypto';

/** kv `kernel.lock`：有这一行就是开了锁屏 */
export interface LockRecord {
  v: 1;
  /** PIN 位数，锁屏页凑够位数自动校验 */
  pinLength: number;
  /** 从后台回来超过这么多分钟要重新输 PIN；0 立即，-1 只在打开时 */
  idleMinutes: number;
  /** 用 PIN 封起来的 API Key */
  sealed: Sealed;
  /** 封起来的是不是空字符串：锁着的时候界面也要知道"有没有 Key" */
  hasKey: boolean;
  /** 插件的秘密（Bot token 之类），按名字各封一份，和 Key 用同一把密钥 */
  secrets?: Record<string, Sealed>;
}

export const LOCK_KV = 'kernel.lock';
/** 没开锁屏时插件秘密明文存在 kv 的这个前缀下；开了锁屏就搬进 LockRecord.secrets */
export const SECRET_PREFIX = 'secret.';
export const IDLE_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 0, label: '立即' },
  { minutes: 1, label: '1 分钟' },
  { minutes: 5, label: '5 分钟' },
  { minutes: 15, label: '15 分钟' },
  { minutes: 30, label: '30 分钟' },
  { minutes: -1, label: '只在打开时' },
];
/** 连错这么多次后要等一会儿才能再试；只在内存里，刷新就清零，诚实地说这只是防手滑连点 */
const MAX_FAILURES = 5;
const COOLDOWN_MS = 30_000;

/**
 * 锁屏：PIN 只在内存里（准确说只留导出的密钥，PIN 本身不留），刷新页面要重输。
 * 开了锁屏之后，API Key 不再明文写进 kv 的 kernel.llm，而是加密后存在 kernel.lock 里；
 * 网关通过 vault 接口把 Key 的读写交给这里。
 */
class Lock {
  enabled = $state(false);
  locked = $state(false);
  pinLength = $state(4);
  idleMinutes = $state(5);
  /** 连错几次 */
  failures = $state(0);
  /** 冷却到什么时候（时间戳），0 表示没在冷却 */
  cooldownUntil = $state(0);

  private record: LockRecord | null = null;
  /** 解锁后留在内存里的密钥，锁上时丢掉 */
  private key: CryptoKey | null = null;
  /** 解锁后解出来的插件秘密，锁上时丢掉 */
  private plain = new Map<string, string>();
  private waiters: (() => void)[] = [];
  private hiddenAt: number | null = null;
  private iter: number | undefined;

  async boot(opts: { iter?: number } = {}) {
    this.iter = opts.iter;
    const rec = await db().getKV<LockRecord | null>(LOCK_KV, null);
    if (rec && rec.v === 1) {
      this.record = rec;
      this.enabled = true;
      this.locked = true;
      this.pinLength = rec.pinLength;
      this.idleMinutes = rec.idleMinutes;
      llm.vault = this.vault;
      // 锁着时内存里不该有 Key；kernel.llm 里本来也没有，这里防御一下
      llm.setSecret('');
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) { this.hiddenAt = Date.now(); return; }
        if (this.hiddenAt === null) return;
        const elapsed = Date.now() - this.hiddenAt;
        this.hiddenAt = null;
        this.onResume(elapsed);
      });
    }
  }

  /** 从后台回来：超过设定的空闲时间就锁 */
  onResume(elapsedMs: number) {
    if (!this.enabled || this.locked || this.idleMinutes < 0) return;
    if (elapsedMs >= this.idleMinutes * 60_000) this.lockNow();
  }

  /** 网关看到的保险箱 */
  private vault = {
    persist: (apiKey: string) => this.persist(apiKey),
    ready: () => this.ready(),
    get sealed() { return lock.locked && !!lock.record?.hasKey; },
  };

  /** 解锁了才继续；聊天、补发、记忆整理在锁屏期间都在这里等 */
  ready(): Promise<void> {
    if (!this.locked) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  get coolingDown() { return this.cooldownUntil > Date.now(); }

  async unlock(pin: string): Promise<void> {
    if (!this.record) { this.locked = false; return; }
    if (this.coolingDown) throw new Error(`错太多次了，等 ${Math.ceil((this.cooldownUntil - Date.now()) / 1000)} 秒再试`);
    try {
      const { plain, key } = await open(this.record.sealed, pin);
      this.key = key;
      llm.setSecret(plain);
      this.locked = false;
      this.failures = 0;
      this.cooldownUntil = 0;
      const w = this.waiters.splice(0);
      for (const r of w) r();
      log.info('lock', '已解锁');
    } catch (e) {
      if (e instanceof WrongPinError) {
        this.failures++;
        if (this.failures >= MAX_FAILURES) { this.cooldownUntil = Date.now() + COOLDOWN_MS; this.failures = 0; log.warn('lock', 'PIN 连错 5 次，冷却 30 秒'); }
      }
      throw e;
    }
  }

  /** 立刻锁上：丢掉内存里的 Key 和密钥 */
  lockNow() {
    if (!this.enabled || this.locked) return;
    this.key = null;
    this.plain.clear();
    llm.setSecret('');
    this.locked = true;
    log.info('lock', '已锁屏');
  }

  /** 开锁屏：把现在的 Key 封起来，kernel.llm 里的明文抹掉 */
  async enable(pin: string, idleMinutes = this.idleMinutes): Promise<void> {
    if (!isValidPin(pin)) throw new Error('PIN 要 4 到 6 位数字');
    const apiKey = llm.settings.apiKey;
    const { sealed, key } = await seal(apiKey, pin, { iter: this.iter });
    this.key = key;
    // 插件的秘密一起搬进来：kv 里的明文封好后删掉
    const rows = await db().kv.where('key').startsWith(SECRET_PREFIX).toArray();
    const secrets: Record<string, Sealed> = {};
    for (const r of rows) {
      const name = r.key.slice(SECRET_PREFIX.length);
      const v = typeof r.value === 'string' ? r.value : '';
      if (!v) continue;
      secrets[name] = await sealWith(v, key, sealed);
      this.plain.set(name, v);
    }
    this.record = { v: 1, pinLength: pin.length, idleMinutes, sealed, hasKey: apiKey.trim().length > 0, ...(rows.length ? { secrets } : {}) };
    await db().setKV(LOCK_KV, this.record);
    if (rows.length) await db().kv.bulkDelete(rows.map((r) => r.key));
    this.enabled = true;
    this.locked = false;
    this.pinLength = pin.length;
    this.idleMinutes = idleMinutes;
    llm.vault = this.vault;
    await llm.save({}); // 重写 kernel.llm，这次 apiKey 会被抹成空
    log.info('lock', '开了锁屏', { idleMinutes });
  }

  /** 关锁屏：要 PIN；Key 解出来明文写回 kernel.llm */
  async disable(pin: string): Promise<void> {
    if (!this.record) return;
    const { plain, key } = await open(this.record.sealed, pin);
    // 插件的秘密解出来明文写回 kv
    for (const [name, sealed] of Object.entries(this.record.secrets ?? {})) {
      const v = await openWith(sealed, key);
      if (v) await db().setKV(SECRET_PREFIX + name, v);
    }
    llm.vault = null;
    this.record = null;
    this.key = null;
    this.plain.clear();
    this.enabled = false;
    this.locked = false;
    await db().kv.delete(LOCK_KV);
    await llm.save({ apiKey: plain });
    log.info('lock', '关了锁屏');
  }

  async changePin(oldPin: string, newPin: string): Promise<void> {
    if (!this.record) return;
    if (!isValidPin(newPin)) throw new Error('PIN 要 4 到 6 位数字');
    const { plain, key: oldKey } = await open(this.record.sealed, oldPin);
    const { sealed, key } = await seal(plain, newPin, { iter: this.iter });
    const secrets: Record<string, Sealed> = {};
    for (const [name, old] of Object.entries(this.record.secrets ?? {})) secrets[name] = await sealWith(await openWith(old, oldKey), key, sealed);
    this.key = key;
    this.record = { ...this.record, sealed, pinLength: newPin.length, ...(this.record.secrets ? { secrets } : {}) };
    this.pinLength = newPin.length;
    await db().setKV(LOCK_KV, this.record);
    log.info('lock', '换了 PIN');
  }

  async setIdle(minutes: number): Promise<void> {
    this.idleMinutes = minutes;
    if (!this.record) return;
    this.record = { ...this.record, idleMinutes: minutes };
    await db().setKV(LOCK_KV, this.record);
  }

  /** 忘了 PIN 的出路：Key 清掉重新填，锁屏关掉，其他数据一样不动 */
  async reset(): Promise<void> {
    llm.vault = null;
    this.record = null;
    this.key = null;
    this.plain.clear();
    this.enabled = false;
    this.locked = false;
    this.failures = 0;
    this.cooldownUntil = 0;
    await db().kv.delete(LOCK_KV);
    await llm.save({ apiKey: '' });
    const w = this.waiters.splice(0);
    for (const r of w) r();
    log.warn('lock', '忘了 PIN：清掉 Key 和插件的秘密，关了锁屏');
  }

  /**
   * 插件的秘密（Bot token 之类）：没开锁屏时明文在 kv `secret.<name>`；开了就和 Key 一样用 PIN 封在 kernel.lock 里。
   * 锁着时读会等到解锁，和模型调用一样；想不等就先看 locked。没有就是空串。
   */
  async getSecret(name: string): Promise<string> {
    if (!this.record) return db().getKV<string>(SECRET_PREFIX + name, '');
    await this.ready();
    const cached = this.plain.get(name);
    if (cached !== undefined) return cached;
    const sealed = this.record?.secrets?.[name];
    if (!sealed || !this.key) return '';
    const v = await openWith(sealed, this.key);
    this.plain.set(name, v);
    return v;
  }

  /** 写插件的秘密；空串就是删掉。锁着时不能改。 */
  async setSecret(name: string, value: string): Promise<void> {
    if (!this.record) {
      if (value) await db().setKV(SECRET_PREFIX + name, value);
      else await db().kv.delete(SECRET_PREFIX + name);
      return;
    }
    if (!this.key) throw new Error('锁着的时候不能改');
    const secrets = { ...(this.record.secrets ?? {}) };
    if (value) { secrets[name] = await sealWith(value, this.key, this.record.sealed); this.plain.set(name, value); }
    else { delete secrets[name]; this.plain.delete(name); }
    this.record = { ...this.record, secrets };
    await db().setKV(LOCK_KV, this.record);
  }

  /** 有没有存过这一项（锁着时也能答，不用解）：设置页锁着时也要知道"填过密码没" */
  async hasSecret(name: string): Promise<boolean> {
    if (!this.record) return !!(await db().getKV<string>(SECRET_PREFIX + name, ''));
    return !!this.record.secrets?.[name];
  }

  /** 核对一下 PIN，设置页里改东西前用 */
  async verify(pin: string): Promise<boolean> {
    if (!this.record) return true;
    try { await open(this.record.sealed, pin); return true; }
    catch (e) { if (e instanceof WrongPinError) return false; throw e; }
  }

  /** 网关每次 save 都会把 Key 交到这里；用内存里的密钥重封 */
  private async persist(apiKey: string): Promise<void> {
    if (!this.record) return;
    if (!this.key) throw new Error('锁着的时候不能改 Key');
    const sealed = await sealWith(apiKey, this.key, this.record.sealed);
    this.record = { ...this.record, sealed, hasKey: apiKey.trim().length > 0 };
    await db().setKV(LOCK_KV, this.record);
  }
}

export const lock = new Lock();
