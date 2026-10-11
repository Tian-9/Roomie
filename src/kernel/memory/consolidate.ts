import { ulid } from 'ulid';
import { db } from '../storage/db';
import type { Character, EpisodicMemory, Message, State } from '../storage/db';
import { textOf, repo } from '../data/repo';
import { llm } from '../llm/gateway.svelte';
import { bus } from '../bus/bus';
import { expandMacros } from '../context/macros';
import { log } from '../log/log';

export const CONSOLIDATE_EVERY = 12; // 每多少条新的回复合并一次
export const CONSOLIDATE_MODEL = 'claude-haiku-5-5';

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['memories', 'state'],
  properties: {
    memories: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['text', 'when', 'importance'], properties: {
      text: { type: 'string', description: '一两句话，第三人称，写清楚谁对谁做了什么' },
      when: { type: 'string', description: '大致时间，不确定就写相对时间，如"今天下午"' },
      importance: { type: 'integer', minimum: 1, maximum: 3, description: '3=改变关系或生活的大事，2=值得记住，1=日常' },
    } } },
    state: { type: 'object', additionalProperties: false, properties: {
      relation: { type: 'string' }, mood: { type: 'string' },
      facts: { type: 'array', maxItems: 20, items: { type: 'string' } },
    } },
  },
};

export interface ConsolidateOutput {
  memories: { text: string; when: string; importance: 1 | 2 | 3 }[];
  state: { relation?: string; mood?: string; facts?: string[] };
}

export function buildPrompt(state: State, character: Character, msgs: Message[], existing: EpisodicMemory[]) {
  const transcript = msgs.filter((m) => m.role !== 'system').map((m) => `${m.role === 'user' ? '{{user}}' : character.name}：${textOf(m)}`).join('\n');
  const prior = existing.slice(-15).map((m) => `- ${m.when}：${m.text}`).join('\n');
  return {
    system: `你是记忆整理员。下面是「${character.name}」和对方的一段聊天，提取值得长期记住的内容，输出 JSON。
规则：
- memories：只记发生了的事和透露的信息（对方的生活、偏好、约定、情绪起伏），不记寒暄。已经在"已有记忆"里的不要重复。
- state：只填确实变化了的字段，没变就不填。facts 是当前仍然成立的事实的完整列表（可基于旧列表增删）。
- 全部用中文。`,
    user: `# ${character.name}\n${character.core.slice(0, 600)}\n\n# 当前状态\n关系：${state.relation || '未知'}；情绪：${state.mood || '未知'}\n事实：\n${state.facts.map((f) => '- ' + f).join('\n') || '（无）'}\n\n# 已有记忆（最近）\n${prior || '（无）'}\n\n# 需要整理的对话\n${transcript}`,
  };
}

/** 写记忆，返回合并后的状态（由调用方落库） */
export async function applyOutput(state: State, character: Character, out: ConsolidateOutput, sourceIds: string[]) {
  const now = Date.now();
  const mems: EpisodicMemory[] = (out.memories ?? []).filter((m) => m.text?.trim()).map((m) => ({
    id: ulid(), characterId: character.id, when: m.when ?? '', text: m.text.trim(),
    importance: ([1, 2, 3].includes(m.importance) ? m.importance : 2) as 1 | 2 | 3, sourceMessageIds: sourceIds, createdAt: now,
  }));
  if (mems.length) await db().memories.bulkAdd(mems);

  const st = out.state ?? {};
  const next: State = { ...state, facts: [...state.facts] };
  if (st.relation) next.relation = st.relation;
  if (st.mood) next.mood = st.mood;
  if (Array.isArray(st.facts) && st.facts.length) next.facts = st.facts.slice(0, 20);
  return { mems, state: next };
}

const inflight = new Set<string>();

/** 对一个会话做一次合并：处理 consolidatedUpTo 之后的消息。 */
export async function consolidate(conversationId: string, opts: { force?: boolean; reason?: string } = {}): Promise<boolean> {
  if (inflight.has(conversationId)) { log.info('consolidate', '跳过：上一次还在进行', { conversationId }); return false; }
  const conv = await db().conversations.get(conversationId);
  if (!conv) return false;
  const character = conv.participantIds[0] ? await db().characters.get(conv.participantIds[0]) : undefined;
  if (!character || !llm.configured) return false;
  const since = conv.consolidatedUpTo ?? 0;
  const msgs = (await db().messages.where('conversationId').equals(conversationId).sortBy('ts')).filter((m) => m.ts > since);
  const replies = msgs.filter((m) => m.role === 'assistant').length;
  if (!opts.force && replies < CONSOLIDATE_EVERY) return false;
  if (replies === 0) return false;
  const lastTs = msgs[msgs.length - 1]!.ts;
  // 上次失败（出错、或你在预览里取消了）的那批不立刻重试：等失败点之后再攒够一批回复。刷新页面也不会重来，这个标记存在库里。
  const failedAt = conv.consolidateFailedAt ?? 0;
  if (!opts.force && failedAt) {
    const sinceFail = msgs.filter((m) => m.ts > failedAt && m.role === 'assistant').length;
    if (sinceFail < CONSOLIDATE_EVERY) { log.info('consolidate', `跳过：上次失败后只有 ${sinceFail} 条新回复，攒够 ${CONSOLIDATE_EVERY} 条再试`, { conversationId }); return false; }
  }

  inflight.add(conversationId);
  const t0 = Date.now();
  log.info('consolidate', `开始：${character.name}，${msgs.length} 条消息（${replies} 条回复），触发：${opts.reason ?? (opts.force ? '手动' : '未知')}`, { conversationId, since });
  try {
    const home = await repo.home();
    const existing = await db().memories.orderBy('createdAt').toArray();
    const prompt0 = buildPrompt(home.state, character, msgs, existing);
    const userName = await db().getKV('kernel.userName', '我');
    const prompt = { system: prompt0.system, user: expandMacros(prompt0.user, { user: userName, char: character.name }) };
    const r = await llm.chat({
      model: CONSOLIDATE_MODEL, effort: 'low', maxTokens: 4000, purpose: 'consolidate', conversationId,
      system: [{ type: 'text', text: prompt.system }], messages: [{ role: 'user', content: [{ type: 'text', text: prompt.user }] }],
      jsonSchema: SCHEMA,
    });
    let out: ConsolidateOutput;
    try { out = JSON.parse(r.text) as ConsolidateOutput; }
    catch {
      await db().conversations.update(conversationId, { consolidateFailedAt: lastTs });
      log.error('consolidate', '模型没有返回合法 JSON，这批消息不再自动重试', { conversationId, stopReason: r.stopReason, head: r.text.slice(0, 120) });
      return false;
    }
    const { mems, state } = await applyOutput(home.state, character, out, msgs.map((m) => m.id));
    await repo.updateState(state);
    await db().conversations.update(conversationId, { consolidatedUpTo: lastTs, consolidateFailedAt: undefined });
    log.info('consolidate', `完成：${mems.length} 条记忆，${Date.now() - t0} ms`, { conversationId });
    bus.emit('memory.consolidated', { conversationId, memories: mems.length });
    return true;
  } catch (e) {
    await db().conversations.update(conversationId, { consolidateFailedAt: lastTs });
    log.error('consolidate', `失败：${e instanceof Error ? e.message : String(e)}，这批消息不再自动重试`, { conversationId });
    throw e;
  } finally {
    inflight.delete(conversationId);
  }
}
