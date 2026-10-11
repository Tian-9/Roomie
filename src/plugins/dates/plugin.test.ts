import { describe, it, expect, beforeAll } from 'vitest';
import { openDB, db, pluginTable } from '$kernel/storage/db';
import type { PluginContext, PromptContext } from '$kernel/api';
import plugin, { datesApi, collectSoon } from './index';
import { isoDate, addDays, type LunarResolver } from './dates';

const tool = (name: string) => plugin.tools!.find((t) => t.name === name)!;
const pc = (addCard?: PromptContext['addCard']): PromptContext => ({ conversationId: 'cv1', characterId: 'c1', addCard });
const cctx = { characterId: 'c1', characterName: 'A', elapsedMs: 0, days: 0, tier: 'chat' as const, elapsedText: '' };
const kv = new Map<string, unknown>();
let lunarOn = true;
/** 假农历服务：农历 = 公历 */
const toLunar: LunarResolver = (iso) => { const [y, m, d] = iso.split('-').map(Number) as [number, number, number]; return { year: y, month: m, day: d, isLeap: false }; };
const today = isoDate();
const in3 = addDays(today, 3);
const md = (iso: string) => ({ month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)) });

beforeAll(async () => {
  openDB([plugin]);
  const ctx = {
    id: 'dates',
    table: (n: string) => db().table(pluginTable('dates', n)),
    settings: { get: async <T,>(k: string, d: T) => (kv.has(k) ? (kv.get(k) as T) : d), set: async (k: string, v: unknown) => { kv.set(k, v); } },
    service: (name: string) => (name === 'lunar' && lunarOn ? { toLunar } : undefined),
    emit() {},
  } as unknown as PluginContext;
  await plugin.setup!(ctx);
});

describe('工具', () => {
  it('date_add 校验月日和年份，记完带卡，重复不重复记', async () => {
    expect(await tool('date_add').handler({ title: '', kind: 'birthday', month: 1, day: 1 }, pc())).toContain('title');
    expect(await tool('date_add').handler({ title: 'x', kind: 'birthday', month: 2, day: 30 }, pc())).toContain('月、日不对');
    expect(await tool('date_add').handler({ title: 'x', kind: 'birthday', month: '十', day: 1 }, pc())).toContain('月、日不对');
    expect(await tool('date_add').handler({ title: 'x', kind: 'countdown', month: 6, day: 7 }, pc())).toContain('year');
    expect(await tool('date_add').handler({ title: 'x', kind: 'birthday', month: 6, day: 7, year: 1800 }, pc())).toContain('1900');
    const cards: string[] = [];
    const r = await tool('date_add').handler({ title: '妈妈生日', kind: 'birthday', ...md(in3), year: 1977 }, pc((tag, body, _a, alt) => cards.push(`${tag} ${JSON.parse(body).days} ${alt}`)));
    expect(r).toContain('记下了：妈妈生日 3 天后（');
    expect(r).toContain('49 岁');
    expect(cards).toEqual(['date 3 [生日：妈妈生日 · 3 天后]']);
    expect(await tool('date_add').handler({ title: '妈妈生日', kind: 'birthday', ...md(in3) }, pc())).toContain('已经记过了');
    expect(await datesApi.dates().count()).toBe(1);
  });
  it('农历要日程开着；倒数日不管农历', async () => {
    lunarOn = false;
    expect(await tool('date_add').handler({ title: '奶奶生日', kind: 'birthday', month: 8, day: 15, lunar: true }, pc())).toContain('日程');
    lunarOn = true;
    expect(await tool('date_add').handler({ title: '奶奶生日', kind: 'birthday', month: 8, day: 15, lunar: true }, pc())).toContain('记下了：奶奶生日');
    const r = (await tool('date_add').handler({ title: '出发', kind: 'countdown', ...md(addDays(today, 40)), year: Number(addDays(today, 40).slice(0, 4)), lunar: true }, pc())) as string;
    expect(r).toContain('40 天后');
    expect(r).not.toContain('农历');
  });
  it('date_list 按快到的排，date_remove 按 id 或名字删', async () => {
    const out = (await tool('date_list').handler({}, pc())) as string;
    const lines = out.split('\n');
    expect(lines[0]).toContain('妈妈生日 3 天后');
    expect(lines.length).toBe(3);
    expect(await tool('date_remove').handler({ id: '没有的' }, pc())).toContain('没找到');
    expect(await tool('date_remove').handler({ id: '出发' }, pc())).toContain('删掉了：出发');
    const id = lines.find((l) => l.includes('奶奶生日'))!.match(/\[(\w+)\]/)![1]!;
    expect(await tool('date_remove').handler({ id }, pc())).toContain('删掉了：奶奶生日');
    expect(await datesApi.dates().count()).toBe(1);
  });
});

describe('提示词和补发', () => {
  it('七天内有事才注入一行', async () => {
    const vol = plugin.promptContributors![0]!.volatile!;
    expect(await vol(pc())).toContain('纪念日：妈妈生日 3 天后');
    await datesApi.add({ title: '在一起', kind: 'anniversary', ...md(addDays(today, 30)), lunar: false, source: 'manual' });
    expect((await vol(pc())).includes('在一起')).toBe(false);
    expect((await datesApi.upcoming(40)).map((r) => r.e.title)).toEqual(['妈妈生日', '在一起']);
  });
  it('今天或明天有日子才提，提过这次就不再提', async () => {
    expect(await collectSoon(cctx, today)).toBeNull();
    const item = await collectSoon(cctx, addDays(today, 2));
    expect(item?.prompt).toContain('明天是妈妈生日（生日，49 岁）');
    await item!.apply({ mentioned: false }, cctx);
    expect(await collectSoon(cctx, addDays(today, 2))).not.toBeNull();
    await item!.apply({ mentioned: true }, cctx);
    expect(await collectSoon(cctx, addDays(today, 2))).toBeNull();
    expect(await collectSoon(cctx, addDays(today, 3))).toBeNull(); // 同一次生日，前一天提过了
    // 明年再提
    const next = await collectSoon(cctx, addDays(in3, 365 - 1));
    expect(next?.prompt ?? '').toMatch(/妈妈生日/);
    kv.clear();
  });
});
