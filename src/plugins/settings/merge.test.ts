import { describe, it, expect } from 'vitest';
import { canon, stripLocal, stripLooseSecrets, merge, rowKey, hasLocalChanges, touchesKernelKv, changedTables, fingerprint, type Tables } from './merge';

const kp = (t: string) => (t === 'notes' ? 'path' : t === 'unknown_here' ? null : t === 'pair' ? ['a', 'b'] : 'id');
const opts = (localTime = 100, remoteTime = 50) => ({ keyPath: kp, localTime, remoteTime });

describe('canon / strip', () => {
  it('键顺序不同算同一行，undefined 字段忽略', () => {
    expect(canon({ a: 1, b: [1, { d: 2, c: 3 }] })).toBe(canon({ b: [1, { c: 3, d: 2 }], a: 1, e: undefined }));
    expect(canon({ a: 1 })).not.toBe(canon({ a: 2 }));
    expect(canon(null)).toBe('null');
  });
  it('kv 里本机缓存不进同步', () => {
    const t: Tables = { kv: [{ key: 'kernel.lastSeen', value: 1 }, { key: 'plugin.weather.cache', value: {} }, { key: 'kernel.llm', value: {} }], messages: [{ id: 'm' }] };
    const s = stripLocal(t);
    expect(s.kv!.map((r) => r.key)).toEqual(['kernel.llm']);
    expect(s.messages).toEqual([{ id: 'm' }]);
    expect(t.kv!.length).toBe(3); // 原对象不动
  });
  it('有 kernel.lock 的文件不带明文 secret.*；没锁就原样', () => {
    const locked: Tables = { kv: [{ key: 'kernel.lock', value: { v: 1 } }, { key: 'secret.plugin.settings.webdav', value: 'pw' }, { key: 'kernel.sync', value: {} }] };
    expect(stripLooseSecrets(locked).kv!.map((r) => r.key)).toEqual(['kernel.lock', 'kernel.sync']);
    expect(locked.kv).toHaveLength(3);
    const open: Tables = { kv: [{ key: 'secret.plugin.settings.webdav', value: 'pw' }] };
    expect(stripLooseSecrets(open)).toBe(open);
    expect(stripLooseSecrets({ notes: [] })).toEqual({ notes: [] });
  });
  it('复合主键', () => {
    expect(rowKey({ a: 1, b: 'x' }, ['a', 'b'])).toBe(rowKey({ b: 'x', a: 1 }, ['a', 'b']));
  });
  it('指纹稳定', async () => {
    expect(await fingerprint({ a: [{ x: 1, y: 2 }] })).toBe(await fingerprint({ a: [{ y: 2, x: 1 }] }));
  });
});

describe('merge', () => {
  const base: Tables = { messages: [{ id: 'm1', text: 'a' }], kv: [{ key: 'k', value: 1 }] };

  it('两边各加了不同的行：都留下，本地要写、远端要推', () => {
    const local: Tables = { messages: [{ id: 'm1', text: 'a' }, { id: 'm2', text: 'local' }], kv: base.kv! };
    const remote: Tables = { messages: [{ id: 'm1', text: 'a' }, { id: 'm3', text: 'remote' }], kv: base.kv! };
    const r = merge(base, local, remote, opts());
    expect(r.merged.messages!.map((m) => m.id).sort()).toEqual(['m1', 'm2', 'm3']);
    expect(r.puts.messages).toEqual([{ id: 'm3', text: 'remote' }]);
    expect(r.deletes.messages).toBeUndefined();
    expect(r.remoteDiffers).toBe(true);
    expect(r.conflicts).toEqual([]);
    expect(changedTables(r)).toEqual(['messages']);
  });

  it('只有一边改了同一行：用改过的；一边删了另一边没动：删', () => {
    const local: Tables = { messages: [{ id: 'm1', text: 'a' }], kv: [{ key: 'k', value: 2 }] };
    const remote: Tables = { messages: [], kv: [{ key: 'k', value: 1 }] };
    const r = merge(base, local, remote, opts());
    expect(r.merged.messages).toEqual([]);
    expect(r.merged.kv).toEqual([{ key: 'k', value: 2 }]);
    expect(r.deletes.messages).toEqual([{ id: 'm1', text: 'a' }]);
    expect(r.puts.kv).toBeUndefined();
    expect(r.remoteDiffers).toBe(true); // kv 要推
    expect(hasLocalChanges(r)).toBe(true);
  });

  it('两边都没改：什么都不做', () => {
    const r = merge(base, base, base, opts());
    expect(hasLocalChanges(r)).toBe(false);
    expect(r.remoteDiffers).toBe(false);
    expect(r.merged).toEqual(base);
  });

  it('两边都改了同一行：有 updatedAt 大的赢，没有按写入时间；输掉的留在 lost 里', () => {
    const b: Tables = { notes: [{ path: '/a', content: '0', updatedAt: 1 }], kv: [{ key: 'k', value: 0 }] };
    const local: Tables = { notes: [{ path: '/a', content: 'L', updatedAt: 5 }], kv: [{ key: 'k', value: 'L' }] };
    const remote: Tables = { notes: [{ path: '/a', content: 'R', updatedAt: 9 }], kv: [{ key: 'k', value: 'R' }] };
    const r = merge(b, local, remote, opts(100, 50));
    expect(r.merged.notes![0]!.content).toBe('R'); // updatedAt 大
    expect(r.merged.kv![0]!.value).toBe('L'); // localTime 100 > remoteTime 50
    expect(r.conflicts.map((c) => `${c.table}:${c.winner}:${c.quiet}`).sort()).toEqual(['kv:local:true', 'notes:remote:false']);
    expect(r.lostLocal.notes).toEqual([{ path: '/a', content: 'L', updatedAt: 5 }]);
    expect(r.lostRemote.kv).toBeUndefined(); // kv 的冲突静默，不留副本
    const loud = merge(b, local, remote, { ...opts(100, 50), quiet: () => false });
    expect(loud.lostRemote.kv).toEqual([{ key: 'k', value: 'R' }]);
    expect(r.puts.notes).toEqual([{ path: '/a', content: 'R', updatedAt: 9 }]);
    expect(r.remoteDiffers).toBe(true);
    expect(touchesKernelKv(r)).toBe(false);
  });

  it('一边删一边改：改的赢，不算冲突', () => {
    const local: Tables = { messages: [], kv: base.kv! };
    const remote: Tables = { messages: [{ id: 'm1', text: 'edited' }], kv: base.kv! };
    const r = merge(base, local, remote, opts());
    expect(r.merged.messages).toEqual([{ id: 'm1', text: 'edited' }]);
    expect(r.conflicts).toEqual([]);
    expect(r.puts.messages).toEqual([{ id: 'm1', text: 'edited' }]);
  });

  it('第一次同步没有 base：撞上的单例听服务器的，各自独有的都留下', () => {
    const local: Tables = { home: [{ id: 'home', state: { mood: '' } }], messages: [{ id: 'm2' }], kv: [] };
    const remote: Tables = { home: [{ id: 'home', state: { mood: '开心' } }], messages: [{ id: 'm1' }], kv: [{ key: 'kernel.llm', value: { model: 'x' } }] };
    const r = merge(null, local, remote, { keyPath: kp, localTime: 999, remoteTime: 1 });
    expect(r.merged.home).toEqual(remote.home);
    expect(r.merged.messages!.map((m) => m.id).sort()).toEqual(['m1', 'm2']);
    expect(r.conflicts[0]).toMatchObject({ table: 'home', winner: 'remote', quiet: true });
    expect(r.lostLocal).toEqual({});
    expect(r.puts.kv).toEqual(remote.kv);
    expect(touchesKernelKv(r)).toBe(true);
    expect(r.remoteDiffers).toBe(true); // m2 要推
  });

  it('这边没装的插件表原样放行，那边没有的表留这边的', () => {
    const local: Tables = { messages: [], p_mine_x: [{ id: 1 }] };
    const remote: Tables = { messages: [], unknown_here: [{ id: 'u' }] };
    const r = merge(null, local, remote, opts());
    expect(r.merged.unknown_here).toEqual([{ id: 'u' }]);
    expect(r.merged.p_mine_x).toEqual([{ id: 1 }]);
    expect(r.puts.unknown_here).toBeUndefined();
    expect(r.remoteDiffers).toBe(true);
  });

  it('复合主键的表也能对上', () => {
    const b: Tables = { pair: [{ a: 1, b: 'x', v: 0 }] };
    const r = merge(b, { pair: [{ b: 'x', a: 1, v: 0 }] }, { pair: [{ a: 1, b: 'x', v: 2 }] }, opts());
    expect(r.merged.pair).toEqual([{ a: 1, b: 'x', v: 2 }]);
    expect(r.conflicts).toEqual([]);
  });
});
