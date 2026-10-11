import { describe, it, expect } from 'vitest';
import { kernelTools, shareTool } from './tools';

describe('kernel tools', () => {
  it('all tool names satisfy the API pattern', () => {
    for (const t of kernelTools) expect(t.spec.name).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
  });
});

describe('share tool', () => {
  const ctx = { character: { id: 'c', name: '林晚秋' } as any, state: { mood: '', relation: '', facts: [] }, cards: [] as any[], attached: [] as any[] };
  const resolver = { type: 'music', label: '歌', hint: 'music：歌', resolve: async (q: any) => ({ card: { type: 'music', title: q.title, quote: q.quote }, forModel: `找到了 ${q.title}，{{char}} 可以引` }) };

  it('is absent without resolvers and lists resolver types as the enum', async () => {
    expect(shareTool([])).toBeNull();
    const t = shareTool([resolver])!;
    expect(t.spec.name).toBe('share');
    expect((t.spec.inputSchema as any).properties.type.enum).toEqual(['music']);
    expect(t.spec.description).toContain('music：歌');
  });

  it('dispatches by type, collects the card and expands macros in the text for the model', async () => {
    const t = shareTool([resolver])!;
    const out = await t.handler({ type: 'music', title: '晴天', quote: '  x ' }, ctx as any);
    expect(out).toBe('找到了 晴天，林晚秋 可以引');
    expect(ctx.cards).toEqual([{ type: 'music', title: '晴天', quote: 'x' }]);
    expect(await t.handler({ type: 'movie', title: 'x' }, ctx as any)).toContain('没有「movie」');
    expect(await t.handler({ type: 'music', title: ' ' }, ctx as any)).toContain('title 不能为空');
  });
});

describe('handle_attached tool', () => {
  it('applies the matching task once and rejects unknown keys', async () => {
    const { attachedTool, attachedPrompt } = await import('./tools');
    const applied: unknown[] = [];
    const task = { key: 'schedule_today', ctx: { characterId: 'c' } as any, item: { label: '今天的安排', prompt: '今天有什么', schema: { type: 'object' }, apply: async (o: unknown) => { applied.push(o); } } };
    const ctx = { character: { id: 'c', name: 'x' } as any, state: { mood: '', relation: '', facts: [] }, cards: [], attached: [task] };
    expect(attachedPrompt([task])).toContain('key：schedule_today');
    expect(await attachedTool.handler({ key: 'schedule_today', output: { said: true } }, ctx as any)).toBe('今天的安排 已处理。');
    expect(applied).toEqual([{ said: true }]);
    expect(await attachedTool.handler({ key: 'schedule_today', output: {} }, ctx as any)).toContain('没有 key');
    expect(attachedPrompt([])).toBe('');
  });
});
