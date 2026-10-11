import { db, HOME_ID } from '../storage/db';
import { repo } from '../data/repo';
import type { Character, Home } from '../storage/db';
import type { CatchupContext, CatchupContributor, CatchupItem, CatchupTier } from '../api/types';
import { llm } from '../llm/gateway.svelte';
import { bus } from '../bus/bus';
import { registry } from '../registry/registry.svelte';
import { scheduler } from '../scheduler/scheduler';
import { log } from '../log/log';

const H = 3600_000, D = 24 * H;
/** 档位阈值。TODO：做成设置项。 */
export const TIERS: Record<Exclude<CatchupTier, 'attach'>, number> = { h6: 6 * H, d1: D, days: 2 * D };
const ORDER: Exclude<CatchupTier, 'attach'>[] = ['h6', 'd1', 'days'];
/** 前台开着的时候也每隔这么久查一次：不然网页挂一天，谁也不会动 */
export const TICK = 60 * 60_000;
/** 他开口的第一句按档位：h6 不打招呼，d1 早，days 好久不见 */
export const GREETING: Record<Exclude<CatchupTier, 'attach'>, string> = { h6: '', d1: '早。', days: '好久不见。' };

export function tierFor(elapsedMs: number): Exclude<CatchupTier, 'attach'> | null {
  if (elapsedMs >= TIERS.days) return 'days';
  if (elapsedMs >= TIERS.d1) return 'd1';
  if (elapsedMs >= TIERS.h6) return 'h6';
  return null;
}

/** 达到的档位 reached 是否覆盖登记的档位 wanted（高档含低档，attach 总是带上） */
export function covers(reached: Exclude<CatchupTier, 'attach'>, wanted: CatchupTier): boolean {
  if (wanted === 'attach') return true;
  return ORDER.indexOf(reached) >= ORDER.indexOf(wanted);
}

export function elapsedText(ms: number): string {
  if (ms < H) return '不到一小时';
  if (ms >= 2 * D) return `${Math.floor(ms / D)} 天`;
  if (ms >= D) return '一天多';
  return `大约 ${Math.round(ms / H)} 小时`;
}

/** 各段结果里的 say 合成他发来的一条消息；没人想说就不发 */
export function composeSay(tier: Exclude<CatchupTier, 'attach'>, outputs: unknown[]): string {
  const says = outputs.map((o) => (o && typeof o === 'object' && typeof (o as { say?: unknown }).say === 'string' ? (o as { say: string }).say.trim() : '')).filter(Boolean);
  if (!says.length) return '';
  return [GREETING[tier], ...says].filter(Boolean).join('\n');
}

interface Collected { key: string; item: CatchupItem }

/**
 * 补发：回到前台时，算他等了你多久、定档位，把各插件登记的事拼成一次模型调用，结果分发回插件，
 * 各段想说的话（say）合成一条他发来的消息。只找常驻的他。设计见 docs/ARCHITECTURE.md 6.1。
 */
class Catchup {
  private running = false;

  boot() {
    const kick = () => { this.run().catch((e) => log.error('catchup', e instanceof Error ? e.message : String(e))); };
    // 前台定时器切到后台会被清掉，回到前台先补一次，再重新上表
    let stop: (() => void) | null = null;
    const arm = () => { stop?.(); stop = scheduler.every(TICK, kick); };
    bus.on('app.resumed', () => { kick(); arm(); });
    arm();
  }

  contributors(): { pluginId: string; c: CatchupContributor }[] {
    return registry.plugins.filter((p) => registry.isEnabled(p.id)).flatMap((p) => (p.catchup ?? []).map((c) => ({ pluginId: p.id, c })));
  }

  /** 有没有依附档的登记（决定聊天要不要挂 handle_attached 工具；工具表要稳定，所以只看登记不看有没有事） */
  hasAttach(): boolean {
    return this.contributors().some((x) => x.c.tier === 'attach');
  }

  private context(ch: Character, elapsedMs: number, tier: CatchupContext['tier']): CatchupContext {
    return { characterId: ch.id, characterName: ch.name, elapsedMs, days: Math.floor(elapsedMs / D), tier, elapsedText: elapsedText(elapsedMs) };
  }

  /** 聊天回复前收集依附的事：挂在这一轮上处理 */
  async collectAttached(ch: Character, now = Date.now()): Promise<{ key: string; item: CatchupItem; ctx: CatchupContext }[]> {
    const home = await repo.home();
    const ctx = this.context(ch, Math.max(0, now - home.lastActiveAt), 'chat');
    const out: { key: string; item: CatchupItem; ctx: CatchupContext }[] = [];
    for (const { pluginId, c } of this.contributors()) {
      if (c.tier !== 'attach') continue;
      try {
        const item = await c.collect(ctx);
        if (item) out.push({ key: `${pluginId}_${c.id}`, item, ctx });
      } catch (e) { log.warn('catchup', `${pluginId}/${c.id} 收集失败：${e instanceof Error ? e.message : String(e)}`); }
    }
    return out;
  }

  async run(now = Date.now()) {
    if (this.running) { log.info('catchup', '跳过：上一次还在进行'); return; }
    if (!llm.configured) return;
    const contributors = this.contributors();
    if (!contributors.length) return;
    this.running = true;
    try {
      const home = await repo.home();
      if (!home.lastActiveAt) return; // 还没聊过，没什么好补的
      const ch = await repo.currentCharacter();
      if (!ch) return;
      const elapsed = now - Math.max(home.lastActiveAt, home.catchupAt ?? 0);
      const tier = tierFor(elapsed);
      if (!tier) return;
      await this.runFor(home, ch, tier, elapsed, contributors, now).catch((e) => log.error('catchup', `${ch.name}：${e instanceof Error ? e.message : String(e)}`, { characterId: ch.id }));
    } finally { this.running = false; }
  }

  async runFor(home: Home, ch: Character, tier: Exclude<CatchupTier, 'attach'>, elapsedMs: number, contributors: { pluginId: string; c: CatchupContributor }[], now: number) {
    const ctx = this.context(ch, elapsedMs, tier);
    const items: Collected[] = [];
    for (const { pluginId, c } of contributors) {
      if (!covers(tier, c.tier)) continue;
      try {
        const item = await c.collect(ctx);
        if (item) items.push({ key: `${pluginId}_${c.id}`, item });
      } catch (e) { log.warn('catchup', `${pluginId}/${c.id} 收集失败：${e instanceof Error ? e.message : String(e)}`); }
    }
    // 没事也记一下时间，不然下次回来还按同一段离开时长再算一遍
    await db().home.update(HOME_ID, { catchupAt: now });
    if (!items.length) { log.info('catchup', `${ch.name}：${tier} 档，没有要处理的事`); return; }
    log.info('catchup', `${ch.name}：${tier} 档（离开 ${ctx.elapsedText}），处理 ${items.map((i) => i.item.label).join('、')}`, { keys: items.map((i) => i.key) });

    const mems = await db().memories.reverse().sortBy('createdAt');
    const system = `你是「${ch.name}」，住在对方手机里的人。设定：${ch.core.slice(0, 800)}
你有一阵没碰手机了，现在拿起手机处理几件事。每件事按它的说明回答，用中文，按给定的 JSON 结构输出。
保持自己的口吻，像真人用手机：短、口语、不解释。不要提到"用户"这个词，称呼对方用你平时的叫法。不想做的事可以不做，各段说明里写了怎么表示。
有的事带一个 say 字段：那是你处理完想顺口跟对方说的一句话，会和别的话拼成一条消息发给对方，没话说就留空。`;
    const user = [
      `# 情况\n对方离开了${ctx.elapsedText}。现在是 ${new Date(now).toLocaleString('zh-CN', { hour12: false })}。\n你现在的情绪：${home.state.mood || '平常'}\n最近记得的事：\n${mems.slice(0, 6).map((m) => '- ' + m.text).join('\n') || '（没什么特别的）'}`,
      '# 要处理的事',
      ...items.map(({ key, item }) => `## ${item.label}（字段 ${key}）\n${item.prompt}`),
    ].join('\n\n');
    const schema = {
      type: 'object', additionalProperties: false, required: items.map((i) => i.key),
      properties: Object.fromEntries(items.map((i) => [i.key, i.item.schema])),
    };
    const r = await llm.chat({
      purpose: 'catchup', effort: 'low', maxTokens: 1500, jsonSchema: schema,
      system: [{ type: 'text', text: system }], messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    });
    let out: Record<string, unknown>;
    try { out = JSON.parse(r.text) as Record<string, unknown>; }
    catch { log.error('catchup', `${ch.name}：模型没有返回合法 JSON`, { stopReason: r.stopReason, head: r.text.slice(0, 120) }); return; }
    const done: string[] = [];
    for (const { key, item } of items) {
      try { await item.apply(out[key], ctx); done.push(key); }
      catch (e) { log.error('catchup', `${key} 落库失败：${e instanceof Error ? e.message : String(e)}`); }
    }
    // 各段想说的话合成一条他发来的消息
    const say = composeSay(tier, done.map((k) => out[k]));
    if (say) {
      const conv = await repo.directConversation(ch);
      await repo.addMessage(conv.id, 'assistant', say, { meta: { catchup: tier } });
      bus.emit('notify', { title: ch.name, body: say.split('\n').slice(0, 2).join(' '), pluginId: 'chat', screen: 'app' });
    }
    bus.emit('catchup.done', { characterId: ch.id, tier, keys: done });
  }
}

export const catchup = new Catchup();
