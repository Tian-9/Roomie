<script lang="ts">
  /**
   * 他的主页。身份（名字、头像）读人设卡；状态、记忆、笔记是你们之间的，全库一份，不跟卡走。
   * 插件通过 profileSections 往这里挂段，主页本身不认识段的内容。
   */
  import { NavBar, List, Cell, Field, SectionTitle, Placeholder, Button, Sheet, Avatar, icons } from '$kernel/api';
  import type { ProfileSection } from '$kernel/api';
  import type { EpisodicMemory, MemFile } from '$kernel/storage/db';
  import { registry } from '$kernel/registry/registry.svelte';
  import { live } from '$kernel/storage/live.svelte';
  import { db, HOME_ID, EMPTY_STATE } from '$kernel/storage/db';
  import { repo } from '$kernel/data/repo';
  import { chat } from '$kernel/chat/engine.svelte';
  import { nav } from '$kernel/nav/nav.svelte';
  import { bus } from '$kernel/bus/bus';
  import { ulid } from 'ulid';

  let { id }: { id: string } = $props();
  const character = live(() => db().characters.get(id), undefined);
  const home = live(() => db().home.get(HOME_ID), undefined);
  const cur = $derived(home.value?.state ?? EMPTY_STATE);
  type Section = ProfileSection & { pluginId: string };
  const sections = $derived<Section[]>(registry.plugins.filter((p) => registry.isEnabled(p.id)).flatMap((p) => (p.profileSections ?? []).map((s) => ({ ...s, pluginId: p.id }))));
  async function startChat() {
    const ch = character.value; if (!ch) return;
    const conv = await repo.directConversation(ch);
    await nav.home();
    nav.push('chat', 'app');
    nav.push('chat', 'conversation', { id: conv.id });
  }
  const memories = live(() => db().memories.reverse().sortBy('createdAt'), [] as EpisodicMemory[]);
  const files = live(() => db().notes.toArray(), [] as MemFile[]);
  let busy = $state(false);
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

  // ---- 编辑：记忆 ----
  let mem = $state<EpisodicMemory | null>(null);
  let memText = $state(''), memWhen = $state(''), memImp = $state<1 | 2 | 3>(2);
  function openMem(m: EpisodicMemory | null) {
    mem = m ?? { id: '', characterId: id, when: '', text: '', importance: 2, sourceMessageIds: [], createdAt: Date.now() };
    memText = mem.text; memWhen = mem.when; memImp = mem.importance;
  }
  async function saveMem() {
    if (!mem || !memText.trim()) { mem = null; return; }
    const row: EpisodicMemory = { ...$state.snapshot(mem), id: mem.id || ulid(), text: memText.trim(), when: memWhen.trim(), importance: memImp };
    await db().memories.put(row); mem = null;
  }
  async function deleteMem() { if (mem?.id) await db().memories.delete(mem.id); mem = null; }

  // ---- 编辑：状态 ----
  let editingState = $state(false);
  let st = $state({ relation: '', mood: '', facts: '' });
  function openState() {
    st = { relation: cur.relation, mood: cur.mood, facts: cur.facts.join('\n') };
    editingState = true;
  }
  async function saveState() {
    await repo.updateState({
      relation: st.relation.trim(), mood: st.mood.trim(),
      facts: st.facts.split('\n').map((f) => f.trim()).filter(Boolean).slice(0, 20),
    });
    editingState = false;
  }

  // ---- 编辑：笔记文件 ----
  let file = $state<MemFile | null>(null);
  let fileText = $state('');
  function openFile(f: MemFile) { file = f; fileText = f.content; }
  async function saveFile() { if (file) await db().notes.put({ ...$state.snapshot(file), content: fileText, updatedAt: Date.now() }); file = null; }
  async function deleteFile() { if (file) await db().notes.delete(file.path); file = null; }

  async function consolidateNow() {
    const c = character.value; if (!c) return;
    const conv = await repo.directConversation(c);
    busy = true;
    try {
      const ok = await chat.consolidateNow(conv.id);
      bus.emit('notify', { title: ok ? '整理完成' : '没有新内容需要整理' });
    } catch (e) { bus.emit('notify', { title: '整理失败', body: e instanceof Error ? e.message : String(e) }); }
    finally { busy = false; }
  }
</script>

<NavBar title={character.value?.name ?? '主页'} back="返回" />
{#if character.value}
  <div class="hero">
    <Avatar blob={character.value.avatar} name={character.value.name} size={88} />
    <div class="name">{character.value.name}</div>
  </div>
  <List footer="他在对话中用 state_update 更新，记忆整理也会更新。点任意一行手改。">
    <Cell title="状态" subtitle={cur.mood || '—'} onclick={openState} />
    <Cell title="和你" subtitle={cur.relation || '—'} onclick={openState} />
    {#each cur.facts as f, i (i)}<Cell title={f} onclick={openState} />{/each}
  </List>
  {#each sections as sec (sec.pluginId + '/' + sec.id)}
    {@const Comp = sec.component}
    {#if sec.label}<SectionTitle text={sec.label} />{/if}
    <Comp characterId={id} />
  {/each}
  <SectionTitle text={`他记得什么 · ${memories.value.length}`} />
  {#if memories.value.length === 0}
    <Placeholder title="还没有记忆" body="每聊 12 轮会自动整理一次，也可以现在手动整理，或者自己写一条。" paths={icons.sparkle} />
  {:else}
    <List footer="三星的会作为近期要事常驻上下文，其余靠他主动回忆。记忆是你们之间的，换人设也还在。点一条可以改或删。">
      {#each memories.value as m (m.id)}
        <Cell title={m.text} subtitle={`${stars(m.importance)}${m.when ? ' · ' + m.when : ''}`} chevron onclick={() => openMem(m)} />
      {/each}
    </List>
  {/if}
  {#if files.value.length}
    <SectionTitle text="他自己的笔记 /memories" />
    <List footer="他通过 memory 工具自己维护的文件，可以手改。">
      {#each files.value as f (f.path)}<Cell title={f.path.replace('/memories/', '')} subtitle={f.content.split('\n')[0]} chevron onclick={() => openFile(f)} />{/each}
    </List>
  {/if}
  <div class="actions">
    <Button onclick={startChat}>发消息</Button>
    <Button kind="tinted" onclick={consolidateNow} disabled={busy}>{busy ? '整理中…' : '现在整理记忆'}</Button>
    <Button kind="plain" onclick={() => openMem(null)}>手写一条记忆</Button>
    <Button kind="plain" onclick={() => nav.push('characters', 'detail', { id })}>编辑人设</Button>
  </div>
{/if}
<div style="height:40px"></div>

<Sheet open={!!mem} onclose={() => (mem = null)} title={mem?.id ? '编辑记忆' : '新记忆'}>
  {#if mem}
    <List>
      <Field multiline rows={3} bind:value={memText} placeholder="发生了什么，一两句话" />
      <Field label="时间" bind:value={memWhen} placeholder="大致时间，可空" />
    </List>
    <div class="seg">
      {#each [1, 2, 3] as n (n)}<button class:on={memImp === n} onclick={() => (memImp = n as 1 | 2 | 3)}>{stars(n)}</button>{/each}
    </div>
    <p class="hint">三星：改变关系或生活的大事，会常驻上下文。二星：值得记住。一星：日常。</p>
    <div class="actions">
      <Button onclick={saveMem}>保存</Button>
      {#if mem.id}<Button kind="plain" onclick={deleteMem}><span style="color:var(--red)">删除</span></Button>{/if}
    </div>
  {/if}
</Sheet>
<Sheet bind:open={editingState} title="当前状态">
  <List footer="事实一行一条，最多 20 条。">
    <Field multiline rows={2} bind:value={st.mood} placeholder="状态：他现在的情绪，一句话" />
    <Field multiline rows={2} bind:value={st.relation} placeholder="和你：他和你现在的关系，一句话" />
    <Field multiline rows={5} bind:value={st.facts} placeholder="当前事实，一行一条" />
  </List>
  <div class="actions"><Button onclick={saveState}>保存</Button></div>
</Sheet>
<Sheet open={!!file} onclose={() => (file = null)} title={file?.path.replace('/memories/', '')}>
  {#if file}
    <div class="box"><textarea bind:value={fileText} rows="10" spellcheck="false"></textarea></div>
    <div class="actions">
      <Button onclick={saveFile}>保存</Button>
      <Button kind="plain" onclick={deleteFile}><span style="color:var(--red)">删除文件</span></Button>
    </div>
  {/if}
</Sheet>

<style>
  .hero { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 0 18px; }
  .name { font-size: 20px; font-weight: 600; }
  .actions { display: flex; flex-direction: column; gap: 10px; margin: 16px 16px 0; align-items: center; }
  .seg { display: flex; gap: 6px; margin: 12px 16px 0; }
  .seg button { flex: 1; padding: 8px; border-radius: 8px; background: var(--fill-2); color: var(--label-2); letter-spacing: 2px; }
  .seg button.on { background: var(--tint); color: var(--tint-fg); }
  .hint { margin: 8px 24px 0; font-size: 12px; color: var(--label-2); }
  .box { margin: 0 16px; background: var(--bg-surface); border-radius: 12px; padding: 8px 12px; }
  textarea { width: 100%; border: 0; outline: 0; background: transparent; font-size: 14px; line-height: 1.5; resize: vertical; font-family: ui-monospace, Menlo, monospace; }
</style>
