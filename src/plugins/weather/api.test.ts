import { describe, it, expect } from 'vitest';
import { parseForecast, parseAir, parseGeo, parseReverse, summaryLine, notable, isFresh, forecastUrl, airUrl, geoUrl, placeLabel, today, yesterday, type Forecast } from './api';
import { weatherLabel, skyOf, aqiLabel, isWet } from './codes';
import { FORECAST, AIR, GEO, GEO_EMPTY, REVERSE } from './fixtures';

const T0 = Date.parse('2026-10-11T01:15:00Z');
const fc = (): Forecast => ({ ...parseForecast(FORECAST, T0), ...parseAir(AIR) });

describe('parse recorded Open-Meteo responses', () => {
  it('reads current, 24 hours from the current hour, and 8 days with yesterday first', () => {
    const f = fc();
    expect(f.timezone).toBe('Asia/Shanghai');
    expect(f.current).toEqual({ time: '2026-10-11T09:15', temp: 12.3, feels: 10.1, humidity: 71, code: 61, wind: 14.8, isDay: true });
    expect(f.hourly).toHaveLength(24);
    expect(f.hourly[0]!.time).toBe('2026-10-11T09:00');
    expect(f.hourly[23]!.time).toBe('2026-10-12T08:00');
    expect(f.hourly[0]!.isDay).toBe(true);
    expect(f.hourly[12]!.isDay).toBe(false);
    expect(f.days).toHaveLength(8);
    expect(yesterday(f)!.date).toBe('2026-10-10');
    expect(today(f)).toMatchObject({ date: '2026-10-11', code: 61, tmax: 15.2, tmin: 8.4, rain: 72, sunrise: '2026-10-11T06:19' });
    expect(f.aqi).toBe(62);
    expect(f.pm25).toBe(17.4);
  });

  it('rejects a response without the three blocks, tolerates missing fields', () => {
    expect(() => parseForecast({})).toThrow('不完整');
    expect(() => parseForecast({ current: {}, hourly: {}, daily: { time: [] } })).toThrow();
    const f = parseForecast({ current: { time: '2026-10-11T09:15' }, hourly: { time: ['2026-10-11T09:00'] }, daily: { time: ['2026-10-11'] } });
    expect(f.current.temp).toBe(0);
    expect(f.hourly).toEqual([{ time: '2026-10-11T09:00', temp: 0, code: 0, rain: 0, isDay: true }]);
    expect(parseAir({})).toEqual({});
    expect(parseAir(null)).toEqual({});
  });

  it('parses geocoding hits and an empty search', () => {
    const ps = parseGeo(GEO);
    expect(ps).toHaveLength(2);
    expect(ps[0]).toEqual({ name: '北京市', admin: '北京市', country: '中国', lat: 39.9075, lon: 116.39723, source: 'search' });
    expect(placeLabel(ps[0]!)).toBe('北京市 · 中国');
    expect(placeLabel({ name: '杭州市', admin: '浙江省', lat: 0, lon: 0, source: 'search' })).toBe('杭州市 · 浙江省');
    expect(parseGeo(GEO_EMPTY)).toEqual([]);
    expect(parseGeo({ results: [{ name: 'x' }] })).toEqual([]);
  });

  it('picks a city name out of a reverse geocode', () => {
    expect(parseReverse(REVERSE)).toEqual({ name: '北京市', admin: undefined, country: '中国' });
    expect(parseReverse({ locality: '西湖区', principalSubdivision: '浙江省' })).toEqual({ name: '西湖区', admin: '浙江省', country: undefined });
    expect(parseReverse({})).toBeNull();
  });

  it('builds URLs with what the parser needs', () => {
    const u = new URL(forecastUrl(39.9, 116.4));
    expect(u.host).toBe('api.open-meteo.com');
    expect(u.searchParams.get('past_days')).toBe('1');
    expect(u.searchParams.get('timezone')).toBe('auto');
    expect(u.searchParams.get('daily')).toContain('sunrise');
    expect(new URL(airUrl(1, 2)).searchParams.get('current')).toBe('us_aqi,pm2_5');
    expect(new URL(geoUrl('北京')).searchParams.get('language')).toBe('zh');
  });
});

describe('codes', () => {
  it('maps WMO codes and AQI bands', () => {
    expect(weatherLabel(0)).toBe('晴');
    expect(weatherLabel(61)).toBe('小雨');
    expect(weatherLabel(999)).toBe('未知');
    expect(skyOf(0, false)).toBe('moon');
    expect(skyOf(0)).toBe('sun');
    expect(skyOf(95)).toBe('thunder');
    expect(isWet(3)).toBe(false);
    expect(isWet(71)).toBe(true);
    expect([0, 50, 51, 100, 150, 200, 300, 301].map(aqiLabel)).toEqual(['优', '优', '良', '良', '轻度污染', '中度污染', '重度污染', '严重污染']);
    expect(aqiLabel(undefined)).toBe('');
  });
});

describe('lines', () => {
  it('summarises in one line for the prompt', () => {
    expect(summaryLine(fc(), '北京')).toBe('你那边：北京 12°C 小雨，今天 8~15°C，空气良');
    const dry = fc();
    dry.current.code = 2; dry.aqi = undefined;
    expect(summaryLine(dry, '北京')).toBe('你那边：北京 12°C 多云，今天 8~15°C，降水概率 72%');
  });

  it('flags only what is worth a morning mention', () => {
    expect(notable(fc())).toEqual(['比昨天降了 6°C（最高 15°C）', '今天有小雨，出门带伞']);
    const calm = fc();
    calm.days[0]!.tmax = 16; calm.days[1]!.code = 2; calm.days[1]!.rain = 20; calm.aqi = 40;
    expect(notable(calm)).toEqual([]);
    calm.days[1]!.rain = 55;
    expect(notable(calm)).toEqual(['今天可能下雨（55%），出门带伞']);
    calm.days[1]!.rain = 0; calm.current.wind = 45; calm.aqi = 180; calm.days[1]!.tmax = 36;
    expect(notable(calm)).toEqual(['比昨天升了 20°C（最高 36°C）', '风大（45 km/h）', '空气中度污染（AQI 180）', '高温 36°C']);
    calm.days[1]!.code = 73; calm.current.wind = 0; calm.aqi = 10; calm.days[1]!.tmax = 16; calm.days[1]!.tmin = -12;
    expect(notable(calm)).toEqual(['今天有中雪', '最低 -12°C，很冷']);
  });

  it('cache is fresh for an hour', () => {
    const f = fc();
    expect(isFresh(f, T0 + 59 * 60_000)).toBe(true);
    expect(isFresh(f, T0 + 61 * 60_000)).toBe(false);
    expect(isFresh(null)).toBe(false);
  });
});
