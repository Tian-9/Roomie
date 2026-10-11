import { describe, it, expect } from 'vitest';
import { parsePersona, parseOpener, defaultOpener, cleanName, buildProfile } from './onboarding';
import { PRESETS } from './presets';

describe('内置人设', () => {
  it('三张，名字和 core 都有，core 在 200 到 400 字之间', () => {
    expect(PRESETS).toHaveLength(3);
    for (const p of PRESETS) {
      expect(p.name).toBeTruthy();
      expect(p.core.length).toBeGreaterThan(200);
      expect(p.core.length).toBeLessThan(400);
      expect(p.full).toContain('他：');
    }
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(3);
  });
  it('文案里没有禁词', () => {
    for (const p of PRESETS) for (const s of [p.core, p.full, p.tagline]) expect(s).not.toMatch(/用户|助手|AI|存档|世界|角色/);
  });
});

describe('parsePersona', () => {
  it('解析合法 JSON', () => {
    expect(parsePersona(JSON.stringify({ name: ' 小北 ', core: '他是…', full: '你：嗨\n他：嗨' }))).toEqual({ name: '小北', core: '他是…', full: '你：嗨\n他：嗨' });
  });
  it('缺字段、非 JSON、空名字都返回 null', () => {
    expect(parsePersona('not json')).toBeNull();
    expect(parsePersona(JSON.stringify({ name: '小北' }))).toBeNull();
    expect(parsePersona(JSON.stringify({ name: '  ', core: 'x' }))).toBeNull();
    expect(parsePersona('null')).toBeNull();
  });
  it('名字截到 20 字，full 缺了给空串', () => {
    const p = parsePersona(JSON.stringify({ name: '一'.repeat(30), core: 'c' }))!;
    expect(p.name).toHaveLength(20);
    expect(p.full).toBe('');
  });
});

describe('parseOpener', () => {
  it('合法输出按字段取', () => {
    const o = parseOpener(JSON.stringify({ intro: '嗨', q_name: '叫你啥', q_sleep: '几点睡', q_busy: '忙啥' }), '阿岚');
    expect(o).toEqual({ intro: '嗨', questions: ['叫你啥', '几点睡', '忙啥'] });
  });
  it('坏 JSON 或缺项回落到兜底', () => {
    const d = defaultOpener('阿岚');
    expect(parseOpener('xx', '阿岚')).toEqual(d);
    const o = parseOpener(JSON.stringify({ intro: '嗨', q_name: '' }), '阿岚');
    expect(o.intro).toBe('嗨');
    expect(o.questions).toEqual(d.questions);
    expect(d.intro).toContain('阿岚');
  });
});

describe('cleanName', () => {
  it('去掉"叫我 / 就行"之类的壳', () => {
    expect(cleanName('叫我小北就行')).toBe('小北');
    expect(cleanName('你可以叫我阿杰。')).toBe('阿杰');
    expect(cleanName('我叫 Tian')).toBe('Tian');
    expect(cleanName('  小北吧  ')).toBe('小北');
  });
  it('空的回落到"我"，太长截断', () => {
    expect(cleanName('   ')).toBe('我');
    expect(cleanName('叫我就行')).toBe('我');
    expect(cleanName('一'.repeat(20))).toHaveLength(12);
  });
});

describe('buildProfile', () => {
  it('两项都有', () => {
    expect(buildProfile({ sleep: '一般十二点', busy: '期末考' })).toBe('- 作息：一般十二点\n- 最近在忙：期末考');
  });
  it('没答的不写', () => {
    expect(buildProfile({ sleep: '  ', busy: '找工作' })).toBe('- 最近在忙：找工作');
    expect(buildProfile({})).toBe('');
  });
});
