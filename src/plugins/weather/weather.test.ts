import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { PluginContext } from '$kernel/api';
import plugin, { weatherApi, collectMorning } from './index';
import { FORECAST, AIR, GEO } from './fixtures';

const kv = new Map<string, unknown>();
const calls: string[] = [];
let failNext = false;
const cctx = { characterId: 'c1', characterName: 'A', elapsedMs: 0, days: 0, tier: 'chat' as const, elapsedText: '' };

beforeAll(() => {
  const ctx = {
    id: 'weather',
    settings: { get: async <T,>(k: string, d: T) => (kv.has(k) ? (kv.get(k) as T) : d), set: async (k: string, v: unknown) => { kv.set(k, v); } },
    emit() {},
  } as unknown as PluginContext;
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    if (failNext) { failNext = false; throw new TypeError('Failed to fetch'); }
    const body = url.includes('air-quality') ? AIR : url.includes('geocoding') ? GEO : FORECAST;
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  plugin.setup!(ctx);
});
beforeEach(() => { calls.length = 0; });

describe('weather plugin', () => {
  it('stays silent with no place: no line, no fetch, no morning note', async () => {
    expect(await plugin.promptContributors![0]!.volatile!({ conversationId: 'cv', characterId: 'c1' })).toBe('');
    expect(await weatherApi.today()).toBeNull();
    expect(await collectMorning(cctx, new Date('2026-10-11T08:00:00'))).toBeNull();
    expect(calls).toEqual([]);
  });

  it('fetches once per hour after a place is set, and the line goes into the prompt', async () => {
    await weatherApi.setPlace({ name: '北京', lat: 39.9, lon: 116.4, source: 'search' });
    expect(calls.filter((u) => u.includes('/v1/forecast'))).toHaveLength(1);
    expect(calls.filter((u) => u.includes('air-quality'))).toHaveLength(1);
    calls.length = 0;
    expect(await plugin.promptContributors![0]!.volatile!({ conversationId: 'cv', characterId: 'c1' })).toBe('你那边：北京 12°C 小雨，今天 8~15°C，空气良');
    expect(await weatherApi.refresh()).toBeTruthy();
    expect(calls).toEqual([]);
    const svc = plugin.services!.weather as { line(): Promise<string>; today(): Promise<{ notes: string[]; place: string } | null> };
    expect(await svc.line()).toContain('北京 12°C');
    expect((await svc.today())!.notes).toEqual(['比昨天降了 6°C（最高 15°C）', '今天有小雨，出门带伞']);
  });

  it('keeps the old forecast when the network fails', async () => {
    failNext = true;
    const f = await weatherApi.refresh({ force: true });
    expect(f?.current.temp).toBe(12.3);
    expect(await weatherApi.line()).toContain('北京');
  });

  it('mentions the weather in the morning once a day, only when something is notable', async () => {
    expect(await collectMorning(cctx, new Date('2026-10-11T13:00:00'))).toBeNull();
    const item = await collectMorning(cctx, new Date('2026-10-11T08:00:00'));
    expect(item?.label).toBe('今天的天气');
    expect(item?.prompt).toContain('比昨天降了 6°C');
    expect(item?.prompt).toContain('带伞');
    await item!.apply({ mentioned: false }, cctx);
    expect(await collectMorning(cctx, new Date('2026-10-11T08:30:00'))).not.toBeNull();
    await item!.apply({ mentioned: true, say: '今天降温，多穿点' }, cctx);
    expect(await collectMorning(cctx, new Date('2026-10-11T09:00:00'))).toBeNull();
    expect(await collectMorning(cctx, new Date('2026-10-12T09:00:00'))).not.toBeNull();
    // 没什么变化的日子不打扰
    const cache = kv.get('cache') as { days: { tmax: number; code: number; rain: number }[]; aqi?: number };
    cache.days[0]!.tmax = 16; cache.days[1]!.code = 2; cache.days[1]!.rain = 10;
    expect(await collectMorning(cctx, new Date('2026-10-12T09:00:00'))).toBeNull();
  });
});
