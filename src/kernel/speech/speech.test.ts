import { describe, it, expect, vi } from 'vitest';
import { canListen, canSpeak, cleanForSpeech, chunkForSpeech, pickVoice, sortVoicesForPicker, voiceLabel, loadVoices, Speaker, listen, type VoiceLike, type RecognitionLike, type SynthLike } from './speech';

const V = (name: string, lang: string, extra: Partial<VoiceLike> = {}): VoiceLike => ({ voiceURI: 'uri:' + name, name, lang, ...extra });

describe('能力探测', () => {
  it('没有 SpeechRecognition 就不能听', () => {
    expect(canListen({})).toBe(false);
    expect(canListen({ webkitSpeechRecognition: class {} })).toBe(true);
    expect(canListen({ SpeechRecognition: class {} })).toBe(true);
  });
  it('朗读要 speechSynthesis 和 Utterance 都在', () => {
    expect(canSpeak({})).toBe(false);
    expect(canSpeak({ speechSynthesis: {} })).toBe(false);
    expect(canSpeak({ speechSynthesis: {}, SpeechSynthesisUtterance: class {} })).toBe(true);
  });
});

describe('cleanForSpeech', () => {
  it('去掉 markdown 记号，链接读成「链接」', () => {
    expect(cleanForSpeech('*笑了笑* 你看 **这个** https://a.b/c?d=1 吧')).toBe('笑了笑 你看 这个 链接 吧');
    expect(cleanForSpeech('[文章](https://x.y)\n\n\n`code`')).toBe('文章\ncode');
  });
});

describe('chunkForSpeech', () => {
  it('按句切，拼到上限以内', () => {
    expect(chunkForSpeech('今天天气不错。要不要出去走走？我请你喝奶茶！', 12)).toEqual(['今天天气不错。', '要不要出去走走？', '我请你喝奶茶！']);
    expect(chunkForSpeech('短。句。', 10)).toEqual(['短。句。']);
  });
  it('一句超长就硬切', () => {
    expect(chunkForSpeech('一'.repeat(25), 10)).toEqual(['一'.repeat(10), '一'.repeat(10), '一'.repeat(5)]);
  });
  it('空文本没有段', () => { expect(chunkForSpeech('  ')).toEqual([]); });
});

describe('pickVoice', () => {
  const voices = [V('Alex', 'en-US', { default: true }), V('Meijia', 'zh-TW', { localService: true }), V('Tingting', 'zh-CN', { localService: true }), V('Google 普通话', 'zh-CN')];
  it('uri 优先，其次 name', () => {
    expect(pickVoice(voices, { uri: 'uri:Meijia' })?.name).toBe('Meijia');
    expect(pickVoice(voices, { uri: 'uri:gone', name: 'Google 普通话' })?.name).toBe('Google 普通话');
  });
  it('没偏好或偏好找不到：zh-CN 本机的那个', () => {
    expect(pickVoice(voices)?.name).toBe('Tingting');
    expect(pickVoice(voices, { uri: 'x', name: 'y' })?.name).toBe('Tingting');
  });
  it('没有同语言就退到默认', () => {
    expect(pickVoice([V('Alex', 'en-US', { default: true }), V('Anna', 'de-DE')])?.name).toBe('Alex');
    expect(pickVoice([])).toBeUndefined();
  });
  it('偏好语言只有英文时按偏好语言挑', () => {
    expect(pickVoice(voices, { lang: 'en-US' })?.name).toBe('Alex');
  });
});

describe('选择器排序和标签', () => {
  it('zh-CN 最前，然后其他中文，再按语言', () => {
    const s = sortVoicesForPicker([V('Alex', 'en-US'), V('Meijia', 'zh-TW'), V('Google 普通话', 'zh-CN'), V('Tingting', 'zh-CN', { localService: true }), V('Anna', 'de-DE')]);
    expect(s.map((v) => v.name)).toEqual(['Tingting', 'Google 普通话', 'Meijia', 'Anna', 'Alex']);
  });
  it('标签去掉厂商前缀', () => {
    expect(voiceLabel(V('Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)', 'zh-CN'))).toBe('Xiaoxiao（zh-CN）');
    expect(voiceLabel(V('Tingting', 'zh-CN'))).toBe('Tingting（zh-CN）');
  });
});

class FakeUtter {
  voice: VoiceLike | null = null; lang = ''; rate = 1; pitch = 1;
  onend: (() => void) | null = null; onerror: ((e: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}
function fakeSynth(voices: VoiceLike[] = [V('Tingting', 'zh-CN')]) {
  const spoken: FakeUtter[] = [];
  const synth: SynthLike & { spoken: FakeUtter[]; finishAll(): void } = {
    spoken,
    speak(u) { spoken.push(u as unknown as FakeUtter); },
    cancel() { for (const u of spoken.splice(0)) u.onerror?.({ error: 'interrupted' }); },
    getVoices: () => voices,
    finishAll() { for (const u of spoken.splice(0)) u.onend?.(); },
  };
  return synth;
}

describe('Speaker', () => {
  it('分段读完才算结束，onchange 开始结束各一次', async () => {
    const synth = fakeSynth();
    const changes: (string | null)[] = [];
    const sp = new Speaker(synth, FakeUtter as unknown as typeof SpeechSynthesisUtterance, (k) => changes.push(k));
    await sp.speak('m1', '第一句' + '很长'.repeat(50) + '。第二句' + '很长'.repeat(50) + '。', { rate: 1.3 });
    expect(synth.spoken).toHaveLength(2);
    expect(synth.spoken[0]!.voice?.name).toBe('Tingting');
    expect(synth.spoken[0]!.rate).toBeCloseTo(1.3);
    expect(sp.current).toBe('m1');
    synth.spoken[0]!.onend?.();
    expect(sp.current).toBe('m1');
    synth.finishAll();
    expect(sp.current).toBeNull();
    expect(changes).toEqual(['m1', null]);
  });
  it('再读一条会打断上一条，被打断的不算结束', async () => {
    const synth = fakeSynth();
    const sp = new Speaker(synth, FakeUtter as unknown as typeof SpeechSynthesisUtterance);
    await sp.speak('a', '一。');
    await sp.speak('b', '二。');
    expect(sp.current).toBe('b');
    synth.finishAll();
    expect(sp.current).toBeNull();
  });
  it('stop 清掉状态；空文本不读', async () => {
    const synth = fakeSynth();
    const sp = new Speaker(synth, FakeUtter as unknown as typeof SpeechSynthesisUtterance);
    await sp.speak('a', '一。');
    sp.stop();
    expect(sp.current).toBeNull();
    await sp.speak('b', '   ');
    expect(synth.spoken).toHaveLength(0);
    expect(sp.current).toBeNull();
  });
  it('别处 cancel 了（另一个 Speaker、系统收回）也算结束，不会卡在朗读中', async () => {
    const synth = fakeSynth();
    const changes: (string | null)[] = [];
    const sp = new Speaker(synth, FakeUtter as unknown as typeof SpeechSynthesisUtterance, (k) => changes.push(k));
    await sp.speak('a', '一。');
    synth.cancel();
    expect(sp.current).toBeNull();
    expect(changes).toEqual(['a', null]);
  });
  it('没有任何音色也能读，lang 落到 zh-CN', async () => {
    const synth = fakeSynth([]);
    const sp = new Speaker(synth, FakeUtter as unknown as typeof SpeechSynthesisUtterance);
    await sp.speak('a', '一。');
    expect(synth.spoken[0]!.voice).toBeNull();
    expect(synth.spoken[0]!.lang).toBe('zh-CN');
  });
});

describe('loadVoices', () => {
  it('一开始为空就等 voiceschanged', async () => {
    let list: VoiceLike[] = [];
    let handler: (() => void) | undefined;
    const synth: SynthLike = { speak() {}, cancel() {}, getVoices: () => list, addEventListener: (_t, fn) => { handler = fn; }, removeEventListener: () => {} };
    const p = loadVoices(synth, 5000);
    list = [V('Tingting', 'zh-CN')];
    handler?.();
    expect(await p).toHaveLength(1);
  });
  it('一直没有就超时返回空', async () => {
    vi.useFakeTimers();
    const synth: SynthLike = { speak() {}, cancel() {}, getVoices: () => [] };
    const p = loadVoices(synth, 10);
    vi.advanceTimersByTime(20);
    expect(await p).toEqual([]);
    vi.useRealTimers();
  });
});

describe('listen', () => {
  let last: FakeRec | undefined;
  class FakeRec implements RecognitionLike {
    lang = ''; continuous = true; interimResults = false; maxAlternatives = 1;
    started = false; stopped = false;
    onresult: RecognitionLike['onresult'] = null; onerror: RecognitionLike['onerror'] = null; onend: RecognitionLike['onend'] = null; onstart = null;
    constructor() { last = this; }
    start() { this.started = true; }
    stop() { this.stopped = true; this.onend?.(); }
    abort() {}
  }
  const ev = (parts: [string, boolean][], from = 0) => ({ resultIndex: from, results: parts.map(([t, f]) => ({ isFinal: f, 0: { transcript: t } })) });

  it('临时结果和定稿分开给，说完自动结束', () => {
    const interim: string[] = [], final: string[] = [];
    let ended: string | undefined | 'never' = 'never';
    listen(FakeRec, 'zh-CN', { onInterim: (t) => interim.push(t), onFinal: (t) => final.push(t), onEnd: (e) => (ended = e) });
    expect(last!.started).toBe(true);
    expect(last!.lang).toBe('zh-CN');
    expect(last!.continuous).toBe(false);
    expect(last!.interimResults).toBe(true);
    last!.onresult!(ev([['今天', false]]));
    last!.onresult!(ev([['今天天气', false]]));
    last!.onresult!(ev([['今天天气不错', true]]));
    last!.onend!();
    expect(interim).toEqual(['今天', '今天天气', '']);
    expect(final).toEqual(['今天天气不错']);
    expect(ended).toBeUndefined();
  });
  it('出错带着错误名结束，主动 stop 也会结束一次', () => {
    const ends: (string | undefined)[] = [];
    listen(FakeRec, 'zh-CN', { onFinal: () => {}, onEnd: (e) => ends.push(e) });
    last!.onerror!({ error: 'not-allowed' });
    last!.onend!();
    expect(ends).toEqual(['not-allowed']);
    const stop = listen(FakeRec, 'zh-CN', { onFinal: () => {}, onEnd: (e) => ends.push(e) });
    stop();
    last!.onend!();
    expect(ends).toEqual(['not-allowed', undefined]);
  });
  it('start 抛错（比如已经在听）也会结束', () => {
    class Throws extends FakeRec { override start() { throw new Error('busy'); } }
    const ends: (string | undefined)[] = [];
    listen(Throws, 'zh-CN', { onFinal: () => {}, onEnd: (e) => ends.push(e) });
    expect(ends).toEqual(['busy']);
  });
});
