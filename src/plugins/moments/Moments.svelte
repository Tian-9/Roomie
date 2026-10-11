<script lang="ts">
  import { NavBar, Placeholder, Avatar, Glyph, Sheet, Button, live, nav, icons } from '$kernel/api';
  import type { CharacterView } from '$kernel/api';
  import { registry } from '$kernel/registry/registry.svelte';
  import { momentsApi, ICON, type Post } from './index';
  import { ago, replyDraft, weekdayOf } from './feed';

  interface Row extends Post { name: string; avatar?: Blob }
  const rows = live(async (): Promise<Row[]> => {
    if (!registry.isEnabled('moments')) return [];
    const [list, chars, current] = await Promise.all([momentsApi.list(), momentsApi.characters(), momentsApi.current()]);
    return list.map((p) => {
      // 发它的人设删了也还显示，归到现在的他名下
      const ch = chars.find((c: CharacterView) => c.id === p.characterId) ?? current;
      return { ...p, name: ch?.name ?? '他', avatar: ch?.avatar };
    });
  }, []);

  let busy = $state(false);
  let picked = $state<Row | null>(null);

  async function postNow() {
    busy = true;
    try {
      const p = await momentsApi.generate();
      if (!p) momentsApi.notify('没发出来', '先在设置里配置 API Key，而且他得已经搬进来');
    } catch (e) { momentsApi.notify('生成失败', e instanceof Error ? e.message : String(e)); }
    finally { busy = false; }
  }
  /** 回他一句：带着这条原文进对话，接着聊 */
  async function reply(p: Row) {
    const id = await momentsApi.conversationFor(p);
    if (!id) { momentsApi.notify('还没和他聊过', '先去信息里跟他说一句'); return; }
    await nav.home();
    nav.push('chat', 'app');
    nav.push('chat', 'conversation', { id, draft: replyDraft(p.text) });
  }
  async function remove() { if (picked) await momentsApi.remove(picked.id); picked = null; }
  const sourceLabel = (p: Post) => (p.source === 'catchup' ? '你不在的时候' : p.source === 'chat' ? '聊天时' : '');
  const dayLabel = (p: Post) => `${Number(p.date.slice(5, 7))}/${Number(p.date.slice(8))} 周${weekdayOf(p.date)}`;
</script>

<NavBar title="动态" large back="桌面">
  {#snippet right()}
    <button class="iconbtn" onclick={postNow} aria-label="让他现在发一条" disabled={busy}><Glyph paths={icons.plus} size={24} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>

{#if rows.value.length === 0}
  <Placeholder title="还没有动态" body="你离开一天再回来，他会对这几天发一条碎碎念；聊到值得记的事他也会发。右上角 + 可以让他现在发一条。" paths={ICON.paths} />
{:else}
  <div class="feed">
    {#each rows.value as p (p.id)}
      <article class="post">
        <Avatar blob={p.avatar} name={p.name} size={40} />
        <div class="body">
          <div class="head"><span class="name">{p.name}</span><button class="more" onclick={() => (picked = p)} aria-label="更多">···</button></div>
          <p class="text">{p.text}</p>
          {#if p.material.length}<div class="mat">{dayLabel(p)} · {p.material.join(' · ')}</div>{/if}
          <div class="meta">
            <span>{ago(p.createdAt)}{sourceLabel(p) ? ' · ' + sourceLabel(p) : ''}</span>
            <span class="acts">
              <button class:on={p.liked} onclick={() => momentsApi.like(p)} aria-label={p.liked ? '取消心' : '点心'}>{p.liked ? '♥' : '♡'}</button>
              <button onclick={() => reply(p)} aria-label="回他一句">回他一句</button>
            </span>
          </div>
          {#if p.liked}<div class="likes">♥ 你</div>{/if}
        </div>
      </article>
    {/each}
  </div>
{/if}
<div style="height:40px"></div>

<Sheet open={!!picked} onclose={() => (picked = null)} title={picked ? dayLabel(picked) : ''}>
  {#if picked}
    <p class="full">{picked.text}</p>
    {#if picked.material.length}<p class="section">他当时看到的：{picked.material.join('、')}</p>{/if}
    <div class="actions">
      <Button kind="plain" onclick={remove}><span style="color:var(--red)">删除这条</span></Button>
      <Button kind="plain" onclick={() => (picked = null)}>关闭</Button>
    </div>
  {/if}
</Sheet>

<style>
  .iconbtn { padding: 8px; display: inline-flex; }
  .feed { background: var(--bg-surface); margin-top: 8px; }
  .post { display: flex; gap: 12px; padding: 14px 16px; border-bottom: 0.5px solid var(--separator); }
  .body { flex: 1; min-width: 0; }
  .head { display: flex; justify-content: space-between; align-items: center; }
  .name { font-weight: 600; color: var(--indigo); font-size: 15px; }
  .more { color: var(--label-3); font-size: 16px; letter-spacing: 1px; padding: 0 4px; }
  .text { margin: 4px 0 6px; font-size: 16px; line-height: 1.45; white-space: pre-wrap; }
  .mat { font-size: 12px; color: var(--label-3); margin-bottom: 6px; }
  .meta { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--label-2); }
  .acts { display: flex; gap: 14px; }
  .acts button { color: var(--tint); font-size: 13px; }
  .acts button.on { color: var(--red); }
  .likes { margin-top: 8px; background: var(--bg-grouped); border-radius: 8px; padding: 6px 10px; font-size: 14px; color: var(--indigo); }
  .full { margin: 0 24px; font-size: 16px; line-height: 1.7; white-space: pre-wrap; max-height: 40vh; overflow-y: auto; }
  .section { margin: 16px 24px 6px; font-size: 13px; color: var(--label-2); }
  .actions { display: flex; flex-direction: column; gap: 6px; margin: 12px 16px 0; align-items: center; }
</style>
