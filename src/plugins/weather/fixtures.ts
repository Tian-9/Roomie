/**
 * 录下来的 Open-Meteo 响应（字段和真实接口一致，数值是 2026-10-11 北京的一次抓取整理后的）。
 * 沙盒里连不上外网，单测和 Playwright 都用这份。只给测试 import。
 */
const h2 = (n: number) => String(n).padStart(2, '0');
const hoursFrom = (date: string) => Array.from({ length: 24 }, (_, i) => `${date}T${h2(i)}:00`);

/** past_days=1：hourly / daily 都从昨天开始 */
export const FORECAST = {
  latitude: 39.875, longitude: 116.375, generationtime_ms: 0.4, utc_offset_seconds: 28800, timezone: 'Asia/Shanghai', timezone_abbreviation: 'GMT+8', elevation: 49,
  current_units: { time: 'iso8601', interval: 'seconds', temperature_2m: '°C', apparent_temperature: '°C', relative_humidity_2m: '%', weather_code: 'wmo code', wind_speed_10m: 'km/h', is_day: '' },
  current: { time: '2026-10-11T09:15', interval: 900, temperature_2m: 12.3, apparent_temperature: 10.1, relative_humidity_2m: 71, weather_code: 61, wind_speed_10m: 14.8, is_day: 1 },
  hourly_units: { time: 'iso8601', temperature_2m: '°C', weather_code: 'wmo code', precipitation_probability: '%', is_day: '' },
  hourly: {
    time: [...hoursFrom('2026-10-10'), ...hoursFrom('2026-10-11'), ...hoursFrom('2026-10-12'), ...hoursFrom('2026-10-13'), ...hoursFrom('2026-10-14'), ...hoursFrom('2026-10-15'), ...hoursFrom('2026-10-16'), ...hoursFrom('2026-10-17')],
    temperature_2m: Array.from({ length: 192 }, (_, i) => Math.round((10 + 6 * Math.sin(((i % 24) - 6) / 24 * Math.PI * 2) - (i >= 24 && i < 48 ? 4 : 0)) * 10) / 10),
    weather_code: Array.from({ length: 192 }, (_, i) => (i >= 30 && i < 40 ? 61 : i % 24 > 20 || i % 24 < 6 ? 1 : 2)),
    precipitation_probability: Array.from({ length: 192 }, (_, i) => (i >= 30 && i < 40 ? 70 : 5)),
    is_day: Array.from({ length: 192 }, (_, i) => (i % 24 >= 6 && i % 24 < 18 ? 1 : 0)),
  },
  daily_units: { time: 'iso8601', weather_code: 'wmo code', temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_probability_max: '%', sunrise: 'iso8601', sunset: 'iso8601' },
  daily: {
    time: ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'],
    weather_code: [2, 61, 3, 1, 0, 0, 2, 80],
    temperature_2m_max: [21.4, 15.2, 17.8, 19.5, 20.1, 21.0, 19.7, 16.3],
    temperature_2m_min: [11.0, 8.4, 7.9, 9.2, 10.3, 10.8, 9.9, 8.1],
    precipitation_probability_max: [10, 72, 20, 5, 0, 0, 15, 60],
    sunrise: ['2026-10-10T06:18', '2026-10-11T06:19', '2026-10-12T06:20', '2026-10-13T06:21', '2026-10-14T06:22', '2026-10-15T06:23', '2026-10-16T06:24', '2026-10-17T06:25'],
    sunset: ['2026-10-10T17:41', '2026-10-11T17:40', '2026-10-12T17:38', '2026-10-13T17:37', '2026-10-14T17:35', '2026-10-15T17:34', '2026-10-16T17:32', '2026-10-17T17:31'],
  },
};

export const AIR = {
  latitude: 39.9, longitude: 116.4, generationtime_ms: 0.2, utc_offset_seconds: 28800, timezone: 'Asia/Shanghai', timezone_abbreviation: 'GMT+8', elevation: 49,
  current_units: { time: 'iso8601', interval: 'seconds', us_aqi: 'USAQI', pm2_5: 'μg/m³' },
  current: { time: '2026-10-11T09:00', interval: 3600, us_aqi: 62, pm2_5: 17.4 },
};

export const GEO = {
  results: [
    { id: 1816670, name: '北京市', latitude: 39.9075, longitude: 116.39723, elevation: 49, feature_code: 'PPLC', country_code: 'CN', admin1_id: 2038349, timezone: 'Asia/Shanghai', population: 18960744, country_id: 1814991, country: '中国', admin1: '北京市' },
    { id: 2038349, name: '北京市', latitude: 39.9, longitude: 116.4, elevation: 44, feature_code: 'ADM1', country_code: 'CN', timezone: 'Asia/Shanghai', country_id: 1814991, country: '中国' },
  ],
  generationtime_ms: 1.2,
};
export const GEO_EMPTY = { generationtime_ms: 0.8 };

export const REVERSE = {
  latitude: 39.875, longitude: 116.375, continent: '亚洲', continentCode: 'AS', countryName: '中国', countryCode: 'CN', principalSubdivision: '北京市', principalSubdivisionCode: 'CN-BJ', city: '北京市', locality: '西城区', postcode: '', plusCode: '8PFRVXXF+XX',
};
