import { ulid } from 'ulid';
import { db, HOME_ID, EMPTY_STATE } from '../storage/db';
import type { Character, Conversation, Home, Message, State } from '../storage/db';
import type { MessageCard } from '../api/types';
import { expandMacros } from '../context/macros';

/** 常驻的他：kv 里 `kernel.currentCharacter`。最近给谁发消息，谁就是他；补发、桌面只看他 */
const CURRENT_KEY = 'kernel.currentCharacter';

/**
 * 领域操作。全库只有一局（home 单例）：记忆、状态、笔记都是你的，不按卡隔离。
 * 一张卡一个私聊会话；换卡聊天记录各算各的，但他记得的事不变。
 */
export const repo = {
  /** home 单例，没有就建。启动时调一次，之后界面可以直接 live 读 db().home.get(HOME_ID) */
  async home(): Promise<Home> {
    const existing = await db().home.get(HOME_ID);
    if (existing) return existing;
    const fresh: Home = { id: HOME_ID, state: { ...EMPTY_STATE, facts: [] }, lastActiveAt: 0 };
    await db().home.put(fresh);
    return fresh;
  },

  async updateState(state: State): Promise<void> {
    await this.home();
    await db().home.update(HOME_ID, { state: { mood: state.mood, relation: state.relation, facts: [...state.facts] } });
  },

  async createCharacter(input: Omit<Character, 'id'>): Promise<Character> {
    const c: Character = { ...input, id: ulid() };
    await db().characters.add(c);
    return c;
  },

  async updateCharacter(id: string, patch: Partial<Character>) {
    await db().characters.update(id, patch);
  },

  /** 删卡只删和这张卡的对话；记忆、状态、笔记是你的，留下 */
  async deleteCharacter(id: string) {
    await db().transaction('rw', [db().characters, db().conversations, db().messages, db().kv], async () => {
      const convs = await db().conversations.filter((c) => c.participantIds.includes(id)).toArray();
      for (const cv of convs) await db().messages.where('conversationId').equals(cv.id).delete();
      await db().conversations.bulkDelete(convs.map((c) => c.id));
      await db().characters.delete(id);
      if ((await db().getKV<string | null>(CURRENT_KEY, null)) === id) await db().kv.delete(CURRENT_KEY);
    });
  },

  /** 常驻的他：指针指向的卡；没指针或卡已删就取第一张 */
  async currentCharacter(): Promise<Character | undefined> {
    const id = await db().getKV<string | null>(CURRENT_KEY, null);
    if (id) { const c = await db().characters.get(id); if (c) return c; }
    return db().characters.orderBy('name').first();
  },

  async setCurrentCharacter(id: string) {
    await db().setKV(CURRENT_KEY, id);
  },

  /** 他的私聊会话，没有就建，并写入开场白。打开和他的聊天，他就成了常驻的他。 */
  async directConversation(character: Character, pluginId = 'chat'): Promise<Conversation> {
    await this.setCurrentCharacter(character.id);
    const found = await db().conversations.where('pluginId').equals(pluginId).filter((c) => c.kind === 'direct' && c.participantIds[0] === character.id).first();
    if (found) return found;
    const conv: Conversation = { id: ulid(), kind: 'direct', participantIds: [character.id], pluginId };
    await db().conversations.add(conv);
    if (character.useFirstMessage && character.firstMessage?.trim()) {
      const userName = await db().getKV('kernel.userName', '我');
      await this.addMessage(conv.id, 'assistant', expandMacros(character.firstMessage.trim(), { user: userName, char: character.name }));
    }
    return conv;
  },

  async addMessage(conversationId: string, role: Message['role'], text: string, extra: Partial<Message> = {}): Promise<Message> {
    const m: Message = { id: ulid(), conversationId, role, content: [{ type: 'text', text }], ts: Date.now(), ...extra };
    await db().messages.add(m);
    await this.home();
    await db().home.update(HOME_ID, { lastActiveAt: Date.now() });
    return m;
  },

  async messagesOf(conversationId: string): Promise<Message[]> {
    return db().messages.where('conversationId').equals(conversationId).sortBy('ts');
  },

  async characterOfConversation(conv: Conversation): Promise<Character | undefined> {
    const id = conv.participantIds[0];
    return id ? db().characters.get(id) : undefined;
  },
};

export function textOf(m: Message): string {
  return (m.content as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
}

/** 消息上挂的卡片（meta.cards） */
export function cardsOf(m: Message): MessageCard[] {
  return (m.meta?.cards as MessageCard[] | undefined) ?? [];
}

/**
 * 给模型看的文字：正文 + 各卡片的 alt。只有卡片的回复这样才能进历史，否则他下一轮就不记得自己发过。
 * 从「+」面板发的 cardOnly 消息，text 本身就是给模型的描述，不再追加 alt。
 */
export function modelTextOf(m: Message): string {
  // 撤回：界面上是一行小灰字，模型只知道撤回了，看不到原文（{{user}} 在拼装时换成名字）
  if (m.meta?.recalled) return '（{{user}}撤回了一条消息）';
  const text = textOf(m).trim();
  const q = quoteOf(m);
  // 引用：在正文前写明引的是谁的哪句。引自己的是「自己之前的话」，引对方的是「你的话」，两个方向都成立
  const quoted = q ? `（引用${q.role === m.role ? '自己之前' : '你'}的话「${q.text}」）` : '';
  if (m.meta?.cardOnly) return [quoted, text].filter(Boolean).join('\n');
  const alts = cardsOf(m).map((c) => c.alt?.trim()).filter((s): s is string => !!s);
  return [quoted, text, ...alts].filter(Boolean).join('\n');
}

/** 消息引用的那句（meta.quote）：发送时就把原文截一段存下来，原消息删了、撤回了也照样显示 */
export interface MessageQuote { id: string; role: Message['role']; text: string }
export function quoteOf(m: Message): MessageQuote | undefined {
  const q = m.meta?.quote as MessageQuote | undefined;
  return q && q.text ? q : undefined;
}

/** 聊天列表里的一行预览：有卡片 alt 用 alt，否则用正文 */
export function previewOf(m: Message): string {
  const alts = cardsOf(m).map((c) => c.alt?.trim()).filter((s): s is string => !!s);
  const text = textOf(m).trim();
  if (m.meta?.cardOnly) return alts.join(' ') || text;
  return text || alts.join(' ');
}
