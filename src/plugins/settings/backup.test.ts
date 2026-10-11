import { describe, it, expect } from 'vitest';
import { PocketDB, pluginTable } from '$kernel/storage/db';
import { exportBackup, importBackup, parseBackup, summarizeBackup, encodeValue, decodeValue, backupFileName, kernelVersion } from './backup';

import type { PluginManifest } from '$kernel/api';
const plugin: PluginManifest = { id: 'diary', name: 'x', version: '0', storage: { tables: { entries: 'id, date' } } };
function fresh(plugins: PluginManifest[] = [plugin]) { return new PocketDB('bk-' + Math.random(), plugins); }

async function seed(db: PocketDB) {
  await db.characters.add({ id: 'c1', name: '他', core: '温和', full: '……', avatar: new Blob([new Uint8Array([137, 80, 78, 71, 0, 255])], { type: 'image/png' }) });
  await db.conversations.add({ id: 'cv', kind: 'direct', participantIds: ['c1'], pluginId: 'chat' });
  await db.messages.bulkAdd([
    { id: 'm1', conversationId: 'cv', role: 'user', content: [{ type: 'text', text: '早' }], ts: 1 },
    { id: 'm2', conversationId: 'cv', role: 'assistant', content: [{ type: 'text', text: '早呀' }], ts: 2, meta: { tools: ['share'] } },
  ]);
  await db.memories.add({ id: 'mem', characterId: 'c1', when: '昨天', text: '他记得你爱喝冰美式', importance: 2, sourceMessageIds: ['m1'], createdAt: 3 });
  await db.notes.add({ path: '/memories/you.md', content: '# 你', updatedAt: 4 });
  await db.setKV('kernel.enabled', { diary: true });
  await db.setKV('kernel.llm', { apiKey: 'sk-test', model: 'x' });
  await db.logs.add({ id: 'l', ts: 1, level: 'info', tag: 'boot', message: 'x' });
  await db.usage.add({ id: 'u', ts: 1, model: 'x', purpose: 'chat', input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0 });
  await db.table(pluginTable('diary', 'entries')).add({ id: 'd1', date: '2026-10-10', text: '今天……' });
}

describe('encode / decode', () => {
  it('round-trips Blob and Date, leaves plain values alone', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/png' });
    const date = new Date('2026-10-11T00:00:00Z');
    const v = { a: 1, b: 'x', c: null, d: [blob, date, { e: blob }], f: { g: true } };
    const enc = await encodeValue(v);
    expect(JSON.parse(JSON.stringify(enc))).toEqual(enc); // 完全可 JSON 化
    const dec = decodeValue(JSON.parse(JSON.stringify(enc))) as typeof v;
    expect(dec.a).toBe(1); expect(dec.c).toBeNull(); expect(dec.f).toEqual({ g: true });
    expect(dec.d[0]).toBeInstanceOf(Blob);
    expect(new Uint8Array(await (dec.d[0] as Blob).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 250]));
    expect((dec.d[0] as Blob).type).toBe('image/png');
    expect((dec.d[1] as Date).toISOString()).toBe(date.toISOString());
    expect((dec.d[2] as { e: Blob }).e).toBeInstanceOf(Blob);
  });
});

describe('export → import', () => {
  it('exporting then importing into an empty database gives the same rows; logs / usage are not exported', async () => {
    const a = fresh(); await a.open(); await seed(a);
    const backup = await exportBackup(a, { now: new Date('2026-10-11T08:00:00Z') });
    expect(backup.app).toBe('roomie');
    expect(backup.kernel).toBe(kernelVersion(a.verno));
    expect(backup.exportedAt).toBe('2026-10-11T08:00:00.000Z');
    expect(Object.keys(backup.tables)).not.toContain('logs');
    expect(Object.keys(backup.tables)).not.toContain('usage');
    expect(backup.tables[pluginTable('diary', 'entries')]).toHaveLength(1);

    const text = JSON.stringify(backup); // 走一遍文本，和真实文件一致
    const b = fresh(); await b.open();
    const parsed = parseBackup(text, b.verno);
    const sum = summarizeBackup(parsed, b);
    expect(sum.counts.characters).toBe(1); expect(sum.counts.messages).toBe(2); expect(sum.unknown).toEqual([]); expect(sum.missing).toEqual([]);
    const res = await importBackup(b, parsed);
    expect(res.skipped).toEqual([]);
    expect(res.written.messages).toBe(2);

    const c = (await b.characters.get('c1'))!;
    expect(c.name).toBe('他');
    expect(c.avatar).toBeInstanceOf(Blob);
    expect(new Uint8Array(await c.avatar!.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71, 0, 255]));
    expect(await b.messages.where('conversationId').equals('cv').sortBy('ts')).toEqual(await a.messages.where('conversationId').equals('cv').sortBy('ts'));
    expect(await b.memories.toArray()).toEqual(await a.memories.toArray());
    expect(await b.notes.toArray()).toEqual(await a.notes.toArray());
    expect(await b.getKV('kernel.enabled', null)).toEqual({ diary: true });
    expect(await b.getKV('kernel.llm', null)).toEqual({ apiKey: 'sk-test', model: 'x' });
    expect(await b.table(pluginTable('diary', 'entries')).count()).toBe(1);
    expect(await b.logs.count()).toBe(0);
    a.close(); b.close();
  });

  it('replaces existing data wholesale and keeps logs', async () => {
    const a = fresh(); await a.open(); await seed(a);
    const backup = await exportBackup(a);
    const b = fresh(); await b.open();
    await b.characters.add({ id: 'old', name: '旧的', core: '', full: '' });
    await b.messages.add({ id: 'oldmsg', conversationId: 'x', role: 'user', content: [], ts: 9 });
    await b.logs.add({ id: 'keep', ts: 1, level: 'info', tag: 'boot', message: 'x' });
    await importBackup(b, backup);
    expect(await b.characters.get('old')).toBeUndefined();
    expect(await b.messages.get('oldmsg')).toBeUndefined();
    expect(await b.characters.count()).toBe(1);
    expect(await b.logs.count()).toBe(1);
    a.close(); b.close();
  });

  it('skips tables the current database does not have and reports them; empties tables the backup lacks', async () => {
    const a = fresh([plugin, { id: 'habits', name: 'h', version: '0', storage: { tables: { habits: 'id' } } }]);
    await a.open(); await seed(a);
    await a.table(pluginTable('habits', 'habits')).add({ id: 'h1' });
    const backup = await exportBackup(a);
    const b = fresh([plugin, { id: 'ledger', name: 'l', version: '0', storage: { tables: { entries: 'id' } } }]);
    await b.open();
    await b.table(pluginTable('ledger', 'entries')).add({ id: 'e1' });
    const sum = summarizeBackup(backup, b);
    expect(sum.unknown).toEqual([pluginTable('habits', 'habits')]);
    expect(sum.missing).toEqual([pluginTable('ledger', 'entries')]);
    const res = await importBackup(b, backup);
    expect(res.skipped).toEqual([pluginTable('habits', 'habits')]);
    expect(await b.table(pluginTable('ledger', 'entries')).count()).toBe(0);
    expect(await b.characters.count()).toBe(1);
    a.close(); b.close();
  });

  it('rolls back when a row cannot be written', async () => {
    const a = fresh(); await a.open(); await seed(a);
    const backup = await exportBackup(a);
    (backup.tables.characters as unknown[]).push({ name: '没有主键' }); // 缺 id，bulkPut 会失败
    const b = fresh(); await b.open();
    await b.characters.add({ id: 'old', name: '旧的', core: '', full: '' });
    await expect(importBackup(b, backup)).rejects.toThrow();
    expect(await b.characters.get('old')).toBeDefined();
    expect(await b.messages.count()).toBe(0);
    a.close(); b.close();
  });
});

describe('parseBackup', () => {
  it('rejects junk, other apps and other kernel versions', () => {
    expect(() => parseBackup('not json', 601)).toThrow('JSON');
    expect(() => parseBackup('[]', 601)).toThrow('有效');
    expect(() => parseBackup(JSON.stringify({ app: 'pocketverse', kernel: 6, tables: {} }), 601)).toThrow('Roomie');
    expect(() => parseBackup(JSON.stringify({ app: 'roomie', tables: {} }), 601)).toThrow('字段');
    expect(() => parseBackup(JSON.stringify({ app: 'roomie', kernel: 5, schema: 500, tables: {} }), 601)).toThrow('旧版本');
    expect(() => parseBackup(JSON.stringify({ app: 'roomie', kernel: 7, schema: 700, tables: {} }), 601)).toThrow('更新的版本');
    expect(() => parseBackup(JSON.stringify({ app: 'roomie', kernel: 6, schema: 601, tables: { kv: {} } }), 601)).toThrow('格式');
  });
  it('accepts a backup whose plugin-table count differs, as long as the kernel version matches', () => {
    const b = parseBackup(JSON.stringify({ app: 'roomie', kernel: 6, schema: 603, exportedAt: 'x', tables: { kv: [] } }), 601);
    expect(b.schema).toBe(603);
  });
});

it('names the file by local date', () => {
  expect(backupFileName(new Date(2026, 9, 11, 9))).toBe('roomie-2026-10-11.json');
});
