import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import { PocketDB, pluginTable } from './db';

describe('PocketDB', () => {
  it('creates kernel tables and prefixed plugin tables', async () => {
    const db = new PocketDB('test-' + Math.random(), [
      { id: 'my-plugin', name: 'x', version: '0', storage: { tables: { notes: 'id, ts' } } },
    ]);
    await db.open();
    const names = db.tables.map((t) => t.name);
    expect(names).toContain('kv');
    expect(names).toContain(pluginTable('my-plugin', 'notes'));
    await db.setKV('a', { b: 1 });
    expect(await db.getKV('a', null)).toEqual({ b: 1 });
    expect(await db.getKV('missing', 'dflt')).toBe('dflt');
  });
});

describe('upgrade from M0', () => {
  it('opens an M0 database (worlds / lore / campaigns / overlays, memfs keyed by campaign) and drops the old tables', async () => {
    const name = 'up-' + Math.random();
    const old = new Dexie(name);
    old.version(500).stores({
      worlds: 'id, name, createdAt, updatedAt', lore: 'id, worldId, scope, order, enabled', characters: 'id, name', campaigns: 'id, worldId, lastPlayedAt',
      conversations: 'id, campaignId, pluginId', messages: 'id, conversationId, ts', memories: 'id, campaignId, characterId, importance, createdAt',
      overlays: 'id, campaignId, loreEntryId, createdAt', kv: 'key', usage: 'id, ts, conversationId', memfs: '[campaignId+path], campaignId', logs: 'id, ts, level, tag',
    });
    await old.open();
    await old.table('characters').add({ id: 'c', name: '他', core: '', full: '' });
    await old.table('worlds').add({ id: 'w', name: '默认世界', summary: '', createdAt: 0, updatedAt: 0 });
    await old.table('memories').add({ id: 'm', campaignId: 'cp', when: '', text: '旧记忆', importance: 2, sourceMessageIds: [], createdAt: 1 });
    old.close();

    const db = new PocketDB(name, []);
    await db.open();
    const names = db.tables.map((t) => t.name);
    expect(names).toContain('home');
    expect(names).not.toContain('worlds');
    expect(await db.characters.count()).toBe(1);
    expect((await db.memories.get('m'))!.text).toBe('旧记忆');
    db.close();
  });
});
