/** 首次引导的纯函数部分：模型输出的结构、兜底文案、画像拼装。界面在 Onboarding.svelte。 */

/** 按一句描述生成人设的 JSON 结构 */
export const PERSONA_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['name', 'core', 'full'],
  properties: {
    name: { type: 'string', description: '两三个字的中文名字或昵称' },
    core: { type: 'string', description: '约 300 字的常驻设定：他是谁、性格、说话方式、和对方的关系、现在的生活状态。第三人称，用"他"' },
    full: { type: 'string', description: '三四轮示例对话，每行一句，"你：…"和"他：…"交替，体现口吻' },
  },
};

export const PERSONA_SYSTEM = [
  '你在为一个住在对方手机里、每天和对方发消息的人写人设。对方会用一句话描述想要什么样的人，按 JSON 结构输出。',
  '他是现实世界里的普通人：有年龄、职业、作息和自己的生活，没有超能力和奇幻设定。',
  'core 约 300 字，第三人称，用"他"，写清楚他是谁、性格、说话风格（句子长短、用不用表情符号）、怎么关心对方、怎么帮对方记事和提醒。',
  'full 是三四轮示例对话，每行一句，"你：…"和"他：…"交替，体现他的口吻。',
  '不出现"AI""助手""用户""角色"这些词。用中文。',
].join('\n');

export interface Persona { name: string; core: string; full: string }

/** 解析模型生成的人设；缺字段或不是 JSON 就返回 null */
export function parsePersona(text: string): Persona | null {
  let o: unknown;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const { name, core, full } = o as Record<string, unknown>;
  if (typeof name !== 'string' || typeof core !== 'string') return null;
  const n = name.trim().slice(0, 20);
  const c = core.trim();
  if (!n || !c) return null;
  return { name: n, core: c, full: typeof full === 'string' ? full.trim() : '' };
}

/** 他开口的第一句：自我介绍 + 三个问题 */
export interface Opener { intro: string; questions: [string, string, string] }

export const OPENER_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['intro', 'q_name', 'q_sleep', 'q_busy'],
  properties: {
    intro: { type: 'string', description: '一两句自我介绍，像发消息，不写动作不加旁白' },
    q_name: { type: 'string', description: '问对方希望你怎么叫他' },
    q_sleep: { type: 'string', description: '问对方平时几点睡' },
    q_busy: { type: 'string', description: '问对方最近在忙什么' },
  },
};

export function openerSystem(name: string, core: string): string {
  return [
    `你是「${name}」，住在对方手机里的人。设定：${core.slice(0, 800)}`,
    '对方刚把你装进手机，这是你们第一次说话，你还不知道对方叫什么。按 JSON 结构输出：intro 是一两句自我介绍；q_name、q_sleep、q_busy 分别问对方希望你怎么叫他、平时几点睡、最近在忙什么。',
    '每条一行，口语，简短，像发消息；保持自己的口吻；不写动作、神态，不加旁白。用中文。不要用"用户"这个词。',
  ].join('\n');
}

export function defaultOpener(name: string): Opener {
  return {
    intro: `你好，我是${name}。以后就住你手机里了，有事随时找我。`,
    questions: ['先问一下，我该叫你什么？', '你平时一般几点睡？我好知道什么时候别吵你。', '最近在忙什么？'],
  };
}

/** 解析模型给的开场；任何一项缺了就用兜底 */
export function parseOpener(text: string, name: string): Opener {
  const d = defaultOpener(name);
  let o: Record<string, unknown>;
  try { o = JSON.parse(text) as Record<string, unknown>; } catch { return d; }
  if (!o || typeof o !== 'object') return d;
  const pick = (k: string, fb: string) => { const v = o[k]; return typeof v === 'string' && v.trim() ? v.trim() : fb; };
  return { intro: pick('intro', d.intro), questions: [pick('q_name', d.questions[0]), pick('q_sleep', d.questions[1]), pick('q_busy', d.questions[2])] };
}

/** 对方说的名字：去掉"叫我""就行"之类的壳，太长就截断；空的回落到"我" */
export function cleanName(raw: string): string {
  let s = raw.trim().replace(/\s+/g, ' ');
  s = s.replace(/^(你?(可以|就)?叫我|我叫|我是|叫我|喊我|称呼我)\s*/u, '');
  s = s.replace(/\s*(就行|就好|吧|好了|啦|呗)[。.!！~～]*$/u, '');
  s = s.replace(/[。.!！,，、~～]+$/u, '').trim();
  if (!s) return '我';
  return s.length > 12 ? s.slice(0, 12) : s;
}

/** 两个回答拼成常驻画像；没答的不写 */
export function buildProfile(answers: { sleep?: string; busy?: string }): string {
  const lines: string[] = [];
  const sleep = answers.sleep?.trim();
  const busy = answers.busy?.trim();
  if (sleep) lines.push(`- 作息：${sleep}`);
  if (busy) lines.push(`- 最近在忙：${busy}`);
  return lines.join('\n');
}
