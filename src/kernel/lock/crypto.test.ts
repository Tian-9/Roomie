import { describe, it, expect } from 'vitest';
import { seal, sealWith, open, openWith, isValidPin, WrongPinError, DEFAULT_ITER } from './crypto';

// 测试里把迭代压低，600k 次每个用例要半秒
const ITER = 1000;

describe('lock/crypto', () => {
  it('seal → open 往返，密文里看不到明文', async () => {
    const { sealed } = await seal('sk-ant-secret-123', '1234', { iter: ITER });
    expect(sealed.v).toBe(1);
    expect(sealed.iter).toBe(ITER);
    expect(JSON.stringify(sealed)).not.toContain('sk-ant');
    expect(atob(sealed.data)).not.toContain('sk-ant');
    const { plain } = await open(sealed, '1234');
    expect(plain).toBe('sk-ant-secret-123');
  });

  it('PIN 错了抛 WrongPinError', async () => {
    const { sealed } = await seal('sk-ant-secret', '1234', { iter: ITER });
    await expect(open(sealed, '1235')).rejects.toBeInstanceOf(WrongPinError);
    await expect(open(sealed, '12345')).rejects.toBeInstanceOf(WrongPinError);
  });

  it('密文被改动后打不开', async () => {
    const { sealed } = await seal('sk-ant-secret', '0000', { iter: ITER });
    const bytes = Uint8Array.from(atob(sealed.data), (c) => c.charCodeAt(0));
    bytes[0]! ^= 0xff;
    const tampered = { ...sealed, data: btoa(String.fromCharCode(...bytes)) };
    await expect(open(tampered, '0000')).rejects.toBeInstanceOf(WrongPinError);
  });

  it('同一个 PIN 两次 seal 盐和密文都不同', async () => {
    const a = await seal('same', '1234', { iter: ITER });
    const b = await seal('same', '1234', { iter: ITER });
    expect(a.sealed.salt).not.toBe(b.sealed.salt);
    expect(a.sealed.data).not.toBe(b.sealed.data);
  });

  it('sealWith 用留在内存里的密钥重封，换了 nonce，原 PIN 仍能打开', async () => {
    const { sealed, key } = await seal('old-key', '4321', { iter: ITER });
    const re = await sealWith('new-key', key, sealed);
    expect(re.salt).toBe(sealed.salt);
    expect(re.iv).not.toBe(sealed.iv);
    expect(await openWith(re, key)).toBe('new-key');
    expect((await open(re, '4321')).plain).toBe('new-key');
  });

  it('空字符串也能封（还没填 Key 就开锁屏）', async () => {
    const { sealed } = await seal('', '1234', { iter: ITER });
    expect((await open(sealed, '1234')).plain).toBe('');
  });

  it('PIN 只接受 4–6 位数字', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('123456')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('1234567')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(isValidPin('')).toBe(false);
  });

  it('默认迭代次数不低于 OWASP 建议', () => {
    expect(DEFAULT_ITER).toBeGreaterThanOrEqual(600_000);
  });
});
