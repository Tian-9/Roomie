import { db, HOME_ID, EMPTY_STATE } from '../storage/db';
import type { Character } from '../storage/db';
import { repo, textOf, cardsOf } from './repo';
import type { DataView, CharacterView } from '../api/types';

const toView = (c: Character): CharacterView => ({ id: c.id, name: c.name, avatar: c.avatar, core: c.core });

/** PluginContext.data 的实现：插件读内核数据的唯一入口，只读。 */
export const dataView: DataView = {
  async currentCharacter() {
    const c = await repo.currentCharacter();
    return c ? toView(c) : undefined;
  },
  async character(id) {
    const c = await db().characters.get(id);
    return c ? toView(c) : undefined;
  },
  async characters() {
    return (await db().characters.toArray()).map(toView);
  },
  async state() {
    const h = await db().home.get(HOME_ID);
    return structuredClone(h?.state ?? EMPTY_STATE);
  },
  async memories(opts = {}) {
    const min = opts.minImportance ?? 1;
    const all = await db().memories.filter((m) => m.importance >= min).reverse().sortBy('createdAt');
    return all.slice(0, opts.limit ?? all.length).map((m) => ({ id: m.id, characterId: m.characterId, when: m.when, text: m.text, importance: m.importance, createdAt: m.createdAt }));
  },
  async messages({ from, to, limit }) {
    const convs = await db().conversations.where('pluginId').equals('chat').toArray();
    const who = new Map(convs.map((c) => [c.id, c.participantIds[0]]));
    const rows = await db().messages.where('ts').between(from, to, true, false).filter((m) => who.has(m.conversationId)).sortBy('ts');
    const picked = limit && rows.length > limit ? rows.slice(-limit) : rows;
    return picked.map((m) => {
      const alts = cardsOf(m).map((c) => c.alt?.trim()).filter((s): s is string => !!s);
      return { id: m.id, conversationId: m.conversationId, characterId: who.get(m.conversationId), role: m.role, text: [textOf(m).trim(), ...alts].filter(Boolean).join('\n'), ts: m.ts };
    });
  },
  async conversationWith(characterId) {
    const c = await db().conversations.where('pluginId').equals('chat').filter((x) => x.kind === 'direct' && x.participantIds[0] === characterId).first();
    return c?.id;
  },
  async userProfile() {
    const [name, profile] = await Promise.all([db().getKV('kernel.userName', '我'), db().getKV('kernel.userProfile', '')]);
    return { name, profile };
  },
};
