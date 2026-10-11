/**
 * 语音：浏览器自带的听（SpeechRecognition）和说（speechSynthesis）。
 * 不接第三方 TTS；没有的浏览器（Firefox、部分 iOS WebView）就是没有，按钮不出现。
 * 这里只包一层：能力探测、挑音色、长文分段、一次朗读的生命周期；界面状态由调用方自己管。
 */

/** 存在人设卡 `voice` 字段里的朗读偏好。uri 优先，同一台机器上稳定；换了设备找不到就按 name，再找不到按语言挑 */
export interface VoicePref {
  uri?: string;
  name?: string;
  lang?: string;
  /** 0.5–2，默认 1 */
  rate?: number;
  /** 0–2，默认 1 */
  pitch?: number;
}

/** 浏览器 SpeechSynthesisVoice 的最小形状，便于测试造假 */
export interface VoiceLike { voiceURI: string; name: string; lang: string; default?: boolean; localService?: boolean }

export interface RecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
export interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

export interface SynthLike {
  speak(u: SpeechSynthesisUtterance): void;
  cancel(): void;
  getVoices(): VoiceLike[];
  addEventListener?(type: 'voiceschanged', fn: () => void): void;
  removeEventListener?(type: 'voiceschanged', fn: () => void): void;
}

type Globals = { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike; speechSynthesis?: SynthLike; SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance };

/** 语音识别的构造器：标准名或 webkit 前缀（Chrome、Safari）；没有就 undefined */
export function recognitionCtor(g: unknown = globalThis): (new () => RecognitionLike) | undefined {
  const w = g as Globals;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}
export function canListen(g: unknown = globalThis): boolean { return !!recognitionCtor(g); }
export function canSpeak(g: unknown = globalThis): boolean {
  const w = g as Globals;
  return !!w.speechSynthesis && typeof w.SpeechSynthesisUtterance === 'function';
}

/** 朗读前清理：去掉 markdown 记号、链接读成「链接」，动作描写（*……*）保留文字去掉星号 */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '链接')
    .replace(/[*_`~#>]+/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * 按句切开再拼到 max 字以内。Chrome 一段 utterance 太长（十几秒以上）会无声中断，分段是绕过去的办法；
 * 也让「停止」更灵敏。
 */
export function chunkForSpeech(text: string, max = 160): string[] {
  const sentences = text.split(/(?<=[。！？!?；;…\n])/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (s.length > max) {
      if (cur) { out.push(cur); cur = ''; }
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
      continue;
    }
    if (cur && cur.length + s.length > max) { out.push(cur); cur = s; }
    else cur = cur ? cur + s : s;
  }
  if (cur) out.push(cur);
  return out;
}

const langKey = (l: string) => l.toLowerCase().replace('_', '-');
const isZh = (v: VoiceLike) => langKey(v.lang).startsWith('zh');

/**
 * 挑音色：偏好里的 uri → name → 同语言里最像默认的一个 → 浏览器默认 → 第一个。
 * 同语言内：zh-CN 优先于 zh-TW / zh-HK，本机声音优先于联网声音（离线也能用）。
 */
export function pickVoice<V extends VoiceLike>(voices: V[], pref?: VoicePref, lang = 'zh-CN'): V | undefined {
  if (!voices.length) return undefined;
  if (pref?.uri) { const v = voices.find((x) => x.voiceURI === pref.uri); if (v) return v; }
  if (pref?.name) { const v = voices.find((x) => x.name === pref.name); if (v) return v; }
  const want = langKey(pref?.lang || lang);
  const base = want.split('-')[0]!;
  const same = voices.filter((v) => langKey(v.lang).split('-')[0] === base);
  if (same.length) {
    const score = (v: VoiceLike) => (langKey(v.lang) === want ? 4 : 0) + (v.localService ? 2 : 0) + (v.default ? 1 : 0);
    return [...same].sort((a, b) => score(b) - score(a))[0];
  }
  return voices.find((v) => v.default) ?? voices[0];
}

/** 选择器里的顺序：中文在前（zh-CN 最前），其余按语言字母序；同语言里本机声音在前 */
export function sortVoicesForPicker<V extends VoiceLike>(voices: V[]): V[] {
  const rank = (v: VoiceLike) => (langKey(v.lang) === 'zh-cn' ? 0 : isZh(v) ? 1 : 2);
  return [...voices].sort((a, b) => rank(a) - rank(b) || langKey(a.lang).localeCompare(langKey(b.lang)) || Number(!!b.localService) - Number(!!a.localService) || a.name.localeCompare(b.name));
}

/** 「Tingting（zh-CN）」这样的一行 */
export function voiceLabel(v: VoiceLike): string {
  const name = v.name.replace(/^(Microsoft|Google)\s+/, '').replace(/\s*-\s*Chinese.*$/i, '').replace(/\s+Online \(Natural\)/i, '');
  return `${name}（${v.lang}）`;
}

/** 等 getVoices 真的有东西：Chrome 第一次是空的，要等 voiceschanged */
export function loadVoices(synth: SynthLike, timeoutMs = 1500): Promise<VoiceLike[]> {
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; synth.removeEventListener?.('voiceschanged', finish); resolve(synth.getVoices()); };
    synth.addEventListener?.('voiceschanged', finish);
    setTimeout(finish, timeoutMs);
  });
}

/**
 * 一次只读一条。speak() 会打断上一条；stop() 打断当前。
 * onchange 在开始和结束时各叫一次，参数是正在读的 key（结束时 null），由调用方映射到界面状态。
 */
export class Speaker {
  current: string | null = null;
  private gen = 0;
  constructor(private synth: SynthLike, private Utter: typeof SpeechSynthesisUtterance, private onchange: (key: string | null) => void = () => {}) {}

  async speak(key: string, text: string, pref?: VoicePref): Promise<void> {
    // 先换代再 cancel：上一条的回调看到代数不对就不动状态
    const gen = ++this.gen;
    this.synth.cancel();
    const chunks = chunkForSpeech(cleanForSpeech(text));
    if (!chunks.length) { this.set(null); return; }
    const voice = pickVoice(await loadVoices(this.synth), pref) as SpeechSynthesisVoice | undefined;
    if (gen !== this.gen) return;
    this.set(key);
    let left = chunks.length;
    for (const c of chunks) {
      const u = new this.Utter(c);
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      else u.lang = pref?.lang || 'zh-CN';
      u.rate = clamp(pref?.rate ?? 1, 0.5, 2);
      u.pitch = clamp(pref?.pitch ?? 1, 0, 2);
      const finish = () => { if (gen !== this.gen) return; if (--left === 0) this.set(null); };
      u.onend = finish;
      // 自己打断的（speak / stop）代数已经换了，走不到这里；能走到的都是外部打断（别处 cancel、系统收回），当结束
      u.onerror = () => { if (gen !== this.gen) return; this.gen++; this.set(null); };
      this.synth.speak(u);
    }
  }
  stop(): void { this.gen++; this.synth.cancel(); this.set(null); }
  private set(k: string | null) { if (this.current === k) return; this.current = k; this.onchange(k); }
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export interface ListenHandlers {
  /** 识别中的临时结果（整句，会被下一次覆盖） */
  onInterim?(text: string): void;
  /** 定稿的一段 */
  onFinal(text: string): void;
  /** 结束（含出错后），error 是浏览器给的错误名：not-allowed（没给麦克风权限）、no-speech、network… */
  onEnd(error?: string): void;
}

/**
 * 听一段：说完停顿就自动结束（continuous=false），想继续再按一次。
 * 返回 stop：主动停，会先把已识别的定稿吐出来再 onEnd。
 */
export function listen(Ctor: new () => RecognitionLike, lang: string, h: ListenHandlers): () => void {
  const r = new Ctor();
  r.lang = lang; r.continuous = false; r.interimResults = true; r.maxAlternatives = 1;
  let error: string | undefined;
  let ended = false;
  r.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]!;
      if (res.isFinal) final += res[0].transcript; else interim += res[0].transcript;
    }
    if (final) h.onFinal(final);
    h.onInterim?.(interim);
  };
  r.onerror = (e) => { error = e.error; };
  r.onend = () => { if (ended) return; ended = true; h.onEnd(error); };
  try { r.start(); } catch (e) { ended = true; h.onEnd(e instanceof Error ? e.message : String(e)); }
  return () => { try { r.stop(); } catch { /* 已经停了 */ } };
}
