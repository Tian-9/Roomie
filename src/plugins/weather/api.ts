/**
 * Open-Meteo 的接口和解析：预报、空气质量、城市搜索。不要 Key，允许浏览器跨域。
 * 这里只有纯函数和 fetch 封装，不碰 ctx；失败一律抛错，由 index.ts 决定静默。
 */
import { weatherLabel, aqiLabel, isWet, isSnow } from './codes';

export interface Place {
  name: string;
  /** 省 / 州，可能没有 */
  admin?: string;
  country?: string;
  lat: number;
  lon: number;
  /** 'geo' 定位来的，'search' 手选的 */
  source: 'geo' | 'search';
}

export interface Hour { time: string; temp: number; code: number; rain: number; isDay: boolean }
export interface Day { date: string; code: number; tmax: number; tmin: number; rain: number; sunrise?: string; sunset?: string }

export interface Forecast {
  /** 拉取时刻（毫秒） */
  fetchedAt: number;
  timezone: string;
  current: { time: string; temp: number; feels: number; humidity: number; code: number; wind: number; isDay: boolean };
  /** 从当前小时起的 24 小时 */
  hourly: Hour[];
  /** 昨天在前（days[0]），今天是 days[1]，之后 6 天 */
  days: Day[];
  aqi?: number;
  pm25?: number;
}

export const FORECAST_HOST = 'https://api.open-meteo.com';
export const AIR_HOST = 'https://air-quality-api.open-meteo.com';
export const GEO_HOST = 'https://geocoding-api.open-meteo.com';
/** 反查地名（定位只给经纬度，Open-Meteo 没有反查）；免费无 Key，失败就叫"当前位置" */
export const REVERSE_HOST = 'https://api.bigdatacloud.net';

export const TIMEOUT = 6000;
/** 每小时最多拉一次 */
export const REFRESH_MS = 60 * 60_000;

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const r1 = (n: number) => Math.round(n * 10) / 10;

export function forecastUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), timezone: 'auto', past_days: '1', forecast_days: '7',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
  });
  return `${FORECAST_HOST}/v1/forecast?${q}`;
}
export function airUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({ latitude: String(lat), longitude: String(lon), timezone: 'auto', current: 'us_aqi,pm2_5' });
  return `${AIR_HOST}/v1/air-quality?${q}`;
}
export function geoUrl(name: string): string {
  const q = new URLSearchParams({ name, count: '8', language: 'zh', format: 'json' });
  return `${GEO_HOST}/v1/search?${q}`;
}
export function reverseUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({ latitude: String(lat), longitude: String(lon), localityLanguage: 'zh' });
  return `${REVERSE_HOST}/data/reverse-geocode-client?${q}`;
}

/** 把 Open-Meteo 预报响应整理成 Forecast；字段缺了就给 0，整体结构不对才抛 */
export function parseForecast(raw: unknown, fetchedAt = Date.now()): Forecast {
  const j = (raw ?? {}) as Record<string, any>;
  const cur = j.current, hr = j.hourly, dy = j.daily;
  if (!cur || !hr?.time || !dy?.time) throw new Error('预报响应不完整');
  const start = Math.max(0, (hr.time as string[]).findIndex((t: string) => t >= String(cur.time).slice(0, 13)));
  const hourly: Hour[] = [];
  for (let i = start; i < Math.min(start + 24, hr.time.length); i++) {
    hourly.push({ time: hr.time[i], temp: r1(num(hr.temperature_2m?.[i])), code: num(hr.weather_code?.[i]), rain: num(hr.precipitation_probability?.[i]), isDay: num(hr.is_day?.[i], 1) === 1 });
  }
  const days: Day[] = (dy.time as string[]).map((date, i) => ({
    date, code: num(dy.weather_code?.[i]), tmax: r1(num(dy.temperature_2m_max?.[i])), tmin: r1(num(dy.temperature_2m_min?.[i])), rain: num(dy.precipitation_probability_max?.[i]),
    sunrise: typeof dy.sunrise?.[i] === 'string' ? dy.sunrise[i] : undefined, sunset: typeof dy.sunset?.[i] === 'string' ? dy.sunset[i] : undefined,
  }));
  return {
    fetchedAt, timezone: typeof j.timezone === 'string' ? j.timezone : '',
    current: { time: String(cur.time), temp: r1(num(cur.temperature_2m)), feels: r1(num(cur.apparent_temperature, num(cur.temperature_2m))), humidity: num(cur.relative_humidity_2m), code: num(cur.weather_code), wind: r1(num(cur.wind_speed_10m)), isDay: num(cur.is_day, 1) === 1 },
    hourly, days,
  };
}

export function parseAir(raw: unknown): { aqi?: number; pm25?: number } {
  const c = ((raw ?? {}) as Record<string, any>).current;
  if (!c) return {};
  const aqi = typeof c.us_aqi === 'number' ? Math.round(c.us_aqi) : undefined;
  const pm25 = typeof c.pm2_5 === 'number' ? r1(c.pm2_5) : undefined;
  return { ...(aqi !== undefined ? { aqi } : {}), ...(pm25 !== undefined ? { pm25 } : {}) };
}

export function parseGeo(raw: unknown): Place[] {
  const rs = ((raw ?? {}) as Record<string, any>).results;
  if (!Array.isArray(rs)) return [];
  return rs
    .filter((r) => typeof r?.name === 'string' && typeof r.latitude === 'number' && typeof r.longitude === 'number')
    .map((r) => ({ name: r.name as string, admin: typeof r.admin1 === 'string' ? r.admin1 : undefined, country: typeof r.country === 'string' ? r.country : undefined, lat: r.latitude as number, lon: r.longitude as number, source: 'search' as const }));
}

/** 反查结果里挑一个像城市的名字 */
export function parseReverse(raw: unknown): { name: string; admin?: string; country?: string } | null {
  const j = (raw ?? {}) as Record<string, any>;
  const name = [j.city, j.locality, j.principalSubdivision].find((v) => typeof v === 'string' && v.trim());
  if (!name) return null;
  return { name: String(name).trim(), admin: typeof j.principalSubdivision === 'string' && j.principalSubdivision !== name ? j.principalSubdivision : undefined, country: typeof j.countryName === 'string' ? j.countryName : undefined };
}

export function placeLabel(p: Place): string {
  if (p.admin && p.admin !== p.name) return `${p.name} · ${p.admin}`;
  if (p.country && p.country !== p.name) return `${p.name} · ${p.country}`;
  return p.name;
}

export function isFresh(f: Forecast | null | undefined, now = Date.now()): boolean {
  return !!f && now - f.fetchedAt < REFRESH_MS;
}

export const today = (f: Forecast): Day | undefined => f.days[1] ?? f.days[0];
export const yesterday = (f: Forecast): Day | undefined => (f.days.length > 1 ? f.days[0] : undefined);

const deg = (n: number) => `${Math.round(n)}°C`;

/** 给模型的一行：你那边：北京 12°C 小雨，今天 8~15°C，空气良 */
export function summaryLine(f: Forecast, placeName: string): string {
  const t = today(f);
  const parts = [`${placeName} ${deg(f.current.temp)} ${weatherLabel(f.current.code)}`];
  if (t) parts.push(`今天 ${Math.round(t.tmin)}~${Math.round(t.tmax)}°C${t.rain >= 50 && !isWet(f.current.code) ? `，降水概率 ${t.rain}%` : ''}`);
  const a = aqiLabel(f.aqi);
  if (a) parts.push(`空气${a}`);
  return `你那边：${parts.join('，')}`;
}

/**
 * 今天值得提一嘴的事：降温 / 升温明显、有雨雪、风大、空气差。都没有就返回 []，早上就不打扰。
 * 阈值：最高温和昨天差 ≥ 5°C；今天降水概率 ≥ 50% 或白天有雨雪；风 ≥ 40 km/h；AQI > 150。
 */
export function notable(f: Forecast): string[] {
  const out: string[] = [];
  const t = today(f), y = yesterday(f);
  if (!t) return out;
  if (y) {
    const d = Math.round(t.tmax - y.tmax);
    if (d <= -5) out.push(`比昨天降了 ${-d}°C（最高 ${deg(t.tmax)}）`);
    else if (d >= 5) out.push(`比昨天升了 ${d}°C（最高 ${deg(t.tmax)}）`);
  }
  if (isSnow(t.code)) out.push(`今天有${weatherLabel(t.code)}`);
  else if (isWet(t.code) || t.rain >= 50) out.push(`今天${isWet(t.code) ? `有${weatherLabel(t.code)}` : `可能下雨（${t.rain}%）`}，出门带伞`);
  if (f.current.wind >= 40) out.push(`风大（${Math.round(f.current.wind)} km/h）`);
  if (f.aqi != null && f.aqi > 150) out.push(`空气${aqiLabel(f.aqi)}（AQI ${f.aqi}）`);
  if (Math.round(t.tmax) >= 35) out.push(`高温 ${deg(t.tmax)}`);
  else if (Math.round(t.tmin) <= -10) out.push(`最低 ${deg(t.tmin)}，很冷`);
  return out;
}

/** 带超时的 GET JSON；非 2xx 抛错 */
export async function getJson(url: string, timeout = TIMEOUT): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** 拉预报 + 空气质量；空气质量失败不影响预报 */
export async function fetchForecast(lat: number, lon: number, now = Date.now()): Promise<Forecast> {
  const [fc, air] = await Promise.all([getJson(forecastUrl(lat, lon)), getJson(airUrl(lat, lon)).catch(() => null)]);
  return { ...parseForecast(fc, now), ...parseAir(air) };
}

export async function searchPlaces(name: string): Promise<Place[]> {
  const q = name.trim();
  if (!q) return [];
  return parseGeo(await getJson(geoUrl(q)));
}

export async function reverseGeocode(lat: number, lon: number): Promise<{ name: string; admin?: string; country?: string } | null> {
  try {
    return parseReverse(await getJson(reverseUrl(lat, lon), 4000));
  } catch {
    return null;
  }
}
