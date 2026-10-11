<script lang="ts">
  import { NavBar, List, Cell, Field, SectionTitle, Button, Avatar, Sheet, Toggle } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { repo } from '$kernel/data/repo';
  import { nav } from '$kernel/nav/nav.svelte';

  let { id }: { id: string } = $props();
  const c = live(() => db().characters.get(id), undefined);
  let name = $state(''), core = $state(''), full = $state(''), firstMessage = $state('');
  let useFirst = $state(false);
  let loaded = $state(false);
  let confirmDelete = $state(false);
  $effect(() => {
    const v = c.value;
    if (v && !loaded) { name = v.name; core = v.core; full = v.full; firstMessage = v.firstMessage ?? ''; useFirst = !!v.useFirstMessage; loaded = true; }
  });
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => repo.updateCharacter(id, { name: name.trim() || '未命名', core, full, firstMessage: firstMessage || undefined, useFirstMessage: useFirst }), 400);
  }
  async function startChat() {
    const ch = await db().characters.get(id);
    if (!ch) return;
    const conv = await repo.directConversation(ch);
    await nav.home();
    nav.push('chat', 'app');
    nav.push('chat', 'conversation', { id: conv.id });
  }
  async function remove() {
    await repo.deleteCharacter(id);
    nav.pop();
  }
</script>

<NavBar title={name || '人设'} back="返回" />
{#if c.value}
  <div class="hero"><Avatar blob={c.value.avatar} name={name || '?'} size={88} /></div>
  <List>
    <Field label="名字" bind:value={name} placeholder="他叫什么" oninput={save} />
  </List>
  <SectionTitle text="核心设定（常驻上下文）" />
  <List footer="每轮对话都会带上这一段，尽量精炼。更长的背景放到下面的完整设定里，他需要时才会去读。">
    <Field multiline rows={8} bind:value={core} placeholder="他是谁、什么性格、现在的处境" oninput={save} />
  </List>
  <SectionTitle text="完整设定与示例对话" />
  <List>
    <Field multiline rows={6} bind:value={full} placeholder="示例对话、细节背景" oninput={save} />
  </List>
  <SectionTitle text="开场白" />
  <List footer="酒馆卡的开场白多半是为酒馆场景写的，默认不自动发。写了适合手机聊天的再打开。">
    <Field multiline rows={3} bind:value={firstMessage} placeholder="新对话的第一句话" oninput={save} />
    <Cell title="新对话自动发送">{#snippet right()}<Toggle bind:checked={useFirst} onchange={save} label="自动发送开场白" />{/snippet}</Cell>
  </List>
  <div class="actions">
    <Button onclick={startChat}>开始聊天</Button>
    <Button kind="tinted" onclick={() => nav.push('characters', 'profile', { id })}>他的主页</Button>
    <Button kind="plain" onclick={() => (confirmDelete = true)}><span style="color:var(--red)">删除这个人设</span></Button>
  </div>
{/if}
<div style="height:40px"></div>

<Sheet bind:open={confirmDelete} title="删除这个人设？">
  <p class="warn">会一起删掉和他的全部对话，不能恢复。记忆、状态和笔记是你的，会留下。</p>
  <div class="actions">
    <Button onclick={remove}><span>删除</span></Button>
    <Button kind="tinted" onclick={() => (confirmDelete = false)}>取消</Button>
  </div>
</Sheet>

<style>
  .hero { display: flex; justify-content: center; padding: 8px 0 18px; }
  .actions { display: flex; flex-direction: column; gap: 10px; margin: 24px 16px 0; align-items: center; }
  .warn { font-size: 15px; color: var(--label-2); margin: 0 24px 8px; text-align: center; }
</style>
