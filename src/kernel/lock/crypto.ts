/**
 * 用 PIN 把 API Key 封起来：PBKDF2(SHA-256) 从 PIN 和随机盐导出 AES-GCM 密钥，再加密。
 * 纯 WebCrypto，不依赖界面和数据库；Node 22 / 浏览器都有 globalThis.crypto.subtle。
 *
 * 诚实地说这能挡什么：4–6 位数字只有一百万种组合，拿到了密文（比如导出的备份文件）离线穷举
 * 是几分钟到几小时的事，PBKDF2 的几十万次迭代只是把这事从"瞬间"拖到"要花点功夫"。
 * 它防的是手机借人、浏览器被翻这类随手翻看，不是肯下功夫的人。对话内容不加密，只是被锁屏遮住。
 */

export interface Sealed {
  v: 1;
  /** base64 的 16 字节随机盐 */
  salt: string;
  /** PBKDF2 迭代次数，存下来以后可以调 */
  iter: number;
  /** base64 的 12 字节 GCM nonce */
  iv: string;
  /** base64 密文（含 GCM 校验标签） */
  data: string;
}

/** OWASP 对 PBKDF2-SHA256 的建议值；中端手机上大约半秒 */
export const DEFAULT_ITER = 600_000;

export class WrongPinError extends Error {
  constructor() { super('PIN 不对'); this.name = 'WrongPinError'; }
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function random(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}

/** 从 PIN 导出 AES-GCM 密钥。密钥不可导出，只能拿来加解密。 */
export async function deriveKey(pin: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** 用新盐和 PIN 封装明文；返回的 key 可以留在内存里，之后 reseal 用 */
export async function seal(plain: string, pin: string, opts: { iter?: number } = {}): Promise<{ sealed: Sealed; key: CryptoKey }> {
  const salt = random(16);
  const iter = opts.iter ?? DEFAULT_ITER;
  const key = await deriveKey(pin, salt, iter);
  const sealed = await sealWith(plain, key, { salt: toB64(salt), iter });
  return { sealed, key };
}

/** 用已经导出的密钥重新封装（比如 Key 改了）：盐和迭代不变，nonce 每次都新 */
export async function sealWith(plain: string, key: CryptoKey, prev: Pick<Sealed, 'salt' | 'iter'>): Promise<Sealed> {
  const iv = random(12);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  return { v: 1, salt: prev.salt, iter: prev.iter, iv: toB64(iv), data: toB64(data) };
}

/** 用 PIN 打开。PIN 错时 GCM 校验失败，抛 WrongPinError。 */
export async function open(sealed: Sealed, pin: string): Promise<{ plain: string; key: CryptoKey }> {
  const key = await deriveKey(pin, fromB64(sealed.salt), sealed.iter);
  return { plain: await openWith(sealed, key), key };
}

export async function openWith(sealed: Sealed, key: CryptoKey): Promise<string> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, key, fromB64(sealed.data));
    return dec.decode(plain);
  } catch {
    throw new WrongPinError();
  }
}
