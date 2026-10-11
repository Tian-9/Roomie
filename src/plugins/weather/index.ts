import { definePlugin, gradients } from '$kernel/api';
import type { PluginContext, CatchupContext, CatchupItem } from '$kernel/api';
import Weather from './Weather.svelte';
import { fetchForecast, isFresh, summaryLine, notable, today as todayOf, reverseGeocode, type Forecast, type Place } from './api';
import { weatherLabel, aqiLabel } from './codes';

export type { Forecast, Place, Day, Hour } from './api';

export const ICON = { paths: ['M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 11.5 3.3 3.3 0 0 0 7 18z', 'M15 4.5a3.5 3.5 0 0 1 3.5 3.5'], background: gradients.blue };
/** 早上几点之间他会提一句今天的天气 */
export const MORNING = [5, 11] as const;
/** 聊天里等预报最多等这么久，超时就不带天气 */
const CHAT_WAIT = 2500;

let ctx: PluginContext;
let inflight: Promise<Forecast | null> | null = null;

/** 复盘 / 早安插件拿的"今天"：一句话 + 结构化字段 */
export interface TodayBrief {
  place: string;
  temp: number;
  label: string;
  tmin: number;
  tmax: number;
  /** 今天最大降水概率 0–100 */
  rain: number;
  aqi?: number;
  aqiLabel: string;
  /** 值得提的事（降温、有雨、风大…），没有就是空数组 */
  notes: string[];
  /** 给模型的一行 */
  line: string;
}

export const weatherApi = {
  place: () => ctx.settings.get<Place | null>('place', null),
  async setPlace(p: Place | null) {
    await ctx.settings.set('place', p);
    await ctx.settings.set('cache', null);
    if (p) await this.refresh({ force: true });
  },
  cached: () => ctx.settings.get<Forecast | null>('cache', null),
  /**
   * 拿预报：缓存一小时内直接给；过期就重拉。网络失败返回旧缓存（可能是 null），不抛。
   * 同一时刻只会有一个请求在飞。
   */
  async refresh(opts: { force?: boolean } = {}): Promise<Forecast | null> {
    const cache = await this.cached();
    if (!opts.force && isFresh(cache)) return cache;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const p = await this.place();
        if (!p) return null;
        const f = await fetchForecast(p.lat, p.lon);
        await ctx.settings.set('cache', f);
        ctx.emit('weather.updated', { place: p.name });
        return f;
      } catch (e) {
        console.warn('[weather] 拉预报失败', e);
        return cache;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },
  /** 给聊天用：有缓存立刻回，顺手在后台刷新；没缓存最多等 CHAT_WAIT */
  async quick(): Promise<Forecast | null> {
    const cache = await this.cached();
    if (isFresh(cache)) return cache;
    const p = this.refresh();
    if (cache) { p.catch(() => {}); return cache; }
    return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), CHAT_WAIT))]);
  },
  /** 用浏览器定位设地点；拒绝或失败抛错，调用方决定怎么退 */
  async locate(): Promise<Place> {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return reject(new Error('没有定位'));
      navigator.geolocation.getCurrentPosition(resolve, (e) => reject(new Error(e.message || '定位失败')), { timeout: 10_000, maximumAge: 10 * 60_000 });
    });
    const lat = Math.round(pos.coords.latitude * 1000) / 1000, lon = Math.round(pos.coords.longitude * 1000) / 1000;
    const named = await reverseGeocode(lat, lon);
    const place: Place = { name: named?.name ?? '当前位置', admin: named?.admin, country: named?.country, lat, lon, source: 'geo' };
    await this.setPlace(place);
    return place;
  },
  async line(): Promise<string> {
    const [p, f] = await Promise.all([this.place(), this.quick()]);
    return p && f ? summaryLine(f, p.name) : '';
  },
  async today(): Promise<TodayBrief | null> {
    const [p, f] = await Promise.all([this.place(), this.quick()]);
    const t = f ? todayOf(f) : undefined;
    if (!p || !f || !t) return null;
    return { place: p.name, temp: f.current.temp, label: weatherLabel(f.current.code), tmin: t.tmin, tmax: t.tmax, rain: t.rain, aqi: f.aqi, aqiLabel: aqiLabel(f.aqi), notes: notable(f), line: summaryLine(f, p.name) };
  },
};

const isoDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 补发 · 依附档：早上有明显变化（降温、有雨…）才提一句，一天一次 */
export async function collectMorning(_c: CatchupContext, now = new Date()): Promise<CatchupItem | null> {
  const h = now.getHours();
  if (h < MORNING[0] || h >= MORNING[1]) return null;
  const day = isoDate(now);
  if ((await ctx.settings.get('said', '')) === day) return null;
  const [p, f] = await Promise.all([weatherApi.place(), weatherApi.quick()]);
  if (!p || !f) return null;
  const notes = notable(f);
  if (!notes.length) return null;
  return {
    label: '今天的天气',
    prompt: `对方那边（${p.name}）今天：${notes.join('；')}。现在 ${Math.round(f.current.temp)}°C ${weatherLabel(f.current.code)}。像朋友顺口提醒一句就行（带伞、加衣服），不要报天气预报。如果是在回消息，就揉进回复里，say 留空；不是的话把那句放 say。提了 mentioned 给 true，这次不合适提给 false。`,
    schema: { type: 'object', additionalProperties: false, required: ['mentioned', 'say'], properties: { mentioned: { type: 'boolean' }, say: { type: 'string', description: '想顺口说的那句；在回消息就留空' } } },
    async apply(out: unknown) {
      if ((out as { mentioned?: boolean } | undefined)?.mentioned !== false) await ctx.settings.set('said', day);
    },
  };
}

export default definePlugin({
  id: 'weather',
  name: '天气',
  version: '0.1.0',
  description: '他知道你那边今天什么天气，降温、有雨会说一句"带伞"。用 Open-Meteo，不要 Key；定位拒绝了可以手选城市。',
  app: { screen: Weather, icon: ICON },
  promptContributors: [{
    id: 'here',
    // 没有触发词：每轮一行，便宜。没设地点或拉不到就不带，聊天不受影响
    volatile: () => weatherApi.line().catch(() => ''),
  }],
  catchup: [{ id: 'morning', tier: 'attach', collect: (c) => collectMorning(c) }],
  /**
   * 服务 weather（复盘 / 早安插件用）：
   * - line(): Promise<string>  给模型的一行，如「你那边：北京 12°C 小雨，今天 8~15°C，空气良」；没设地点或拉不到就是 ''
   * - today(): Promise<TodayBrief | null>  结构化的今天（地名、温度、最高最低、降水概率、AQI、值得提的事 notes）
   * - place(): Promise<Place | null>  设的地点
   * 都不抛错，网络失败退化成缓存或空。
   */
  services: {
    weather: { line: () => weatherApi.line().catch(() => ''), today: () => weatherApi.today().catch(() => null), place: () => weatherApi.place().catch(() => null) },
  },
  onEvent: {
    // 回到前台顺手刷一次（一小时内有缓存就不会真的发请求）
    'app.resumed': () => { if (ctx) weatherApi.refresh().catch(() => {}); },
  },
  setup(c) { ctx = c; weatherApi.refresh().catch(() => {}); },
});
