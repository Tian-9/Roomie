import { describe, it, expect } from 'vitest';
import { assemble, triggered, DEFAULT_RULES } from './assemble';
import type { Character, Message, State } from '../storage/db';

const ch: Character = { id: 'c', name: '林晚秋', core: '图书馆管理员', full: '' };
const state: State = { mood: '', relation: '刚认识', facts: ['邮差昨天来过'] };
const msg = (role: Message['role'], text: string, ts: number): Message => ({ id: String(ts), conversationId: 'x', role, content: [{ type: 'text', text }], ts });
const base = { character: ch, userName: '我', state, highlights: [], now: new Date(2026, 9, 8, 9, 0) };

describe('assemble', () => {
  it('builds L0 in fixed order without any world or lorebook section; last system block cached', () => {
    const r = assemble({ ...base, history: [], userText: '嗨', memoryIndex: '- /memories/user.md：对方', pluginStable: ['<记账>本月预算 3000</记账>'] });
    const titles = r.system.map((b) => b.text.split('\n')[0]);
    expect(titles).toEqual(['# 规则', '# 对方', '# 你：林晚秋', '# 当前状态', '# 你的记忆目录 /memories', '<记账>本月预算 3000</记账>']);
    expect(r.system.at(-1)!.cache).toBe(true);
    expect(r.system.find((b) => b.text.startsWith('# 当前状态'))!.text).toContain('你和对方的关系：刚认识');
    expect(r.system.find((b) => b.text.startsWith('# 当前状态'))!.text).toContain('- 邮差昨天来过');
    const sys = r.system.map((b) => b.text).join('\n');
    expect(sys).not.toMatch(/世界|用户|扮演/);
    expect(DEFAULT_RULES).not.toMatch(/用户|扮演/);
  });

  it('puts plugin volatile parts, the clock and the user text in the last user message only', () => {
    const r = assemble({ ...base, history: [msg('assistant', '你来了', 1)], userText: '那个邮差呢', pluginVolatile: ['<本周支出>¥120</本周支出>'] });
    const sys = r.system.map((b) => b.text).join();
    expect(sys).not.toContain('本周支出');
    const last = r.messages.at(-1)!;
    expect(last.role).toBe('user');
    const text = last.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    expect(text).toContain('<本周支出>');
    expect(text).toContain('现在是');
    expect(text.endsWith('那个邮差呢')).toBe(true);
  });

  it('puts the second cache breakpoint on the second-to-last message', () => {
    const r = assemble({ ...base, history: [msg('user', 'a', 1), msg('assistant', 'b', 2)], userText: 'c' });
    const prev = r.messages.at(-2)!;
    const pb = prev.content.at(-1)!;
    expect(pb.type === 'text' && pb.cache).toBe(true);
  });

  it('adds the tool rules only with tools, and the share rule only with a resolver', () => {
    const none = assemble({ ...base, history: [], userText: 'x' }).system[0]!.text;
    expect(none).not.toContain('memory_search');
    const tools = assemble({ ...base, history: [], userText: 'x', hasTools: true, hasShare: true }).system[0]!.text;
    expect(tools).toContain('memory_search');
    expect(tools).toContain('share 工具');
    expect(tools).not.toMatch(/lore|overlay|世界书/);
  });
});

describe('L1 triggers', () => {
  it('matches any keyword case-insensitively, and no keywords means always', () => {
    expect(triggered(['花了', 'Spent'], '今天午饭花了 32')).toBe(true);
    expect(triggered(['花了', 'Spent'], 'I SPENT 32')).toBe(true);
    expect(triggered(['花了'], '明天开会')).toBe(false);
    expect(triggered(undefined, '')).toBe(true);
    expect(triggered([], '')).toBe(true);
  });
});

describe('card alt in history', () => {
  it('keeps card-only replies in history via alt, and does not double user cardOnly text', () => {
    const card = { pluginId: 'ledger', tag: 'bill', body: '{"id":"p1"}', attrs: {}, alt: '[记了一笔：午饭 ¥32]' };
    const history: Message[] = [
      { ...msg('user', '[记一笔：打车 ¥28]', 1), meta: { cardOnly: true, cards: [{ ...card, alt: '[账单] 打车' }] } },
      { ...msg('assistant', '', 2), meta: { cards: [card] } },
      { ...msg('assistant', '记上了', 3), meta: { cards: [{ ...card, alt: '[分享了歌：晴天 - 周杰伦]' }] } },
    ];
    const r = assemble({ ...base, history, userText: '谢谢' });
    const texts = r.messages.map((m) => m.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n'));
    expect(texts[0]).toBe('[记一笔：打车 ¥28]');
    expect(texts[0]).not.toContain('[账单]');
    expect(texts[1]).toContain('[记了一笔：午饭 ¥32]');
    expect(texts[1]).toContain('记上了\n[分享了歌：晴天 - 周杰伦]');
  });

  it('quotes name whose words were quoted, and a recalled message shows only that it was recalled', () => {
    const history: Message[] = [
      msg('assistant', '明天别迟到', 1),
      { ...msg('user', '知道了', 2), meta: { quote: { id: '1', role: 'assistant', text: '明天别迟到' } } },
      { ...msg('user', '你撤回了一条消息', 3), meta: { narration: true, recalled: true } },
      { ...msg('assistant', '怎么了？', 4) },
      { ...msg('user', '没事', 5), meta: { quote: { id: '2', role: 'user', text: '知道了' } } },
    ];
    const r = assemble({ ...base, history, userText: '晚安' });
    const texts = r.messages.map((m) => m.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n'));
    // texts[0] 是补的「（对话开始）」
    expect(texts[2]).toContain('（引用你的话「明天别迟到」）\n知道了');
    expect(texts[2]).toContain('（我撤回了一条消息）');
    expect(texts[2]).not.toContain('你撤回了');
    expect(texts[4]).toContain('（引用自己之前的话「知道了」）\n没事');
  });
});
