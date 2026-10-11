/**
 * WMO 天气代码（Open-Meteo 用的那套）→ 中文和图标；空气质量按中国的六档。纯表，没有副作用。
 */

export type Sky = 'sun' | 'moon' | 'partly' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder';

const CODES: Record<number, { label: string; sky: Sky }> = {
  0: { label: '晴', sky: 'sun' },
  1: { label: '大致晴', sky: 'sun' },
  2: { label: '多云', sky: 'partly' },
  3: { label: '阴', sky: 'cloud' },
  45: { label: '雾', sky: 'fog' },
  48: { label: '冻雾', sky: 'fog' },
  51: { label: '毛毛雨', sky: 'drizzle' },
  53: { label: '毛毛雨', sky: 'drizzle' },
  55: { label: '毛毛雨', sky: 'drizzle' },
  56: { label: '冻雨', sky: 'drizzle' },
  57: { label: '冻雨', sky: 'drizzle' },
  61: { label: '小雨', sky: 'rain' },
  63: { label: '中雨', sky: 'rain' },
  65: { label: '大雨', sky: 'rain' },
  66: { label: '冻雨', sky: 'rain' },
  67: { label: '冻雨', sky: 'rain' },
  71: { label: '小雪', sky: 'snow' },
  73: { label: '中雪', sky: 'snow' },
  75: { label: '大雪', sky: 'snow' },
  77: { label: '雪粒', sky: 'snow' },
  80: { label: '阵雨', sky: 'rain' },
  81: { label: '阵雨', sky: 'rain' },
  82: { label: '强阵雨', sky: 'rain' },
  85: { label: '阵雪', sky: 'snow' },
  86: { label: '阵雪', sky: 'snow' },
  95: { label: '雷阵雨', sky: 'thunder' },
  96: { label: '雷阵雨伴冰雹', sky: 'thunder' },
  99: { label: '雷阵雨伴冰雹', sky: 'thunder' },
};

export function weatherLabel(code: number): string {
  return CODES[code]?.label ?? '未知';
}
export function skyOf(code: number, isDay = true): Sky {
  const s = CODES[code]?.sky ?? 'cloud';
  return s === 'sun' && !isDay ? 'moon' : s;
}
/** 会不会淋到：雨、雪、雷都算 */
export function isWet(code: number): boolean {
  return code >= 51;
}
export function isSnow(code: number): boolean {
  return (code >= 71 && code <= 77) || code === 85 || code === 86;
}

/** 空气质量：按 US AQI 数值对应中国六档（分段阈值一样） */
export function aqiLabel(aqi: number | null | undefined): string {
  if (aqi == null || !Number.isFinite(aqi)) return '';
  if (aqi <= 50) return '优';
  if (aqi <= 100) return '良';
  if (aqi <= 150) return '轻度污染';
  if (aqi <= 200) return '中度污染';
  if (aqi <= 300) return '重度污染';
  return '严重污染';
}

/** 24x24 线条图标，给 Glyph 用 */
export const SKY_PATHS: Record<Sky, string[]> = {
  sun: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'],
  partly: ['M7 9a3.5 3.5 0 1 1 6.3-2', 'M7 9V7M3 10h1M4.5 5.5l.7.7', 'M8 20h9a4 4 0 0 0 .5-8A5.5 5.5 0 0 0 7 13.5 3.3 3.3 0 0 0 8 20z'],
  cloud: ['M7 19h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 12.5 3.3 3.3 0 0 0 7 19z'],
  fog: ['M5 10h14M3 14h18M6 18h12', 'M8 6h8'],
  drizzle: ['M7 15h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 8.5 3.3 3.3 0 0 0 7 15z', 'M9 18v1M13 18v1M17 18v1'],
  rain: ['M7 14h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 7.5 3.3 3.3 0 0 0 7 14z', 'M8 17l-1 3M12 17l-1 3M16 17l-1 3'],
  snow: ['M7 14h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 7.5 3.3 3.3 0 0 0 7 14z', 'M8 18h.01M12 18h.01M16 18h.01M10 21h.01M14 21h.01'],
  thunder: ['M7 13h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 6.5 3.3 3.3 0 0 0 7 13z', 'M13 13l-2 4h3l-2 4'],
};
