<script lang="ts">
  /** 导入前检查：字段可编辑，可疑项另开一页，确认后才入库。卡里带的附加设定集（lorebook）不导入：Roomie 只有你的现实。 */
  import { NavBar, List, Field, SectionTitle, Button, Cell } from '$kernel/api';
  import type { ParsedCard } from '$kernel/importers/charaCard';
  import { cardToCharacterFields } from '$kernel/importers/charaCard';
  import { sanitize } from '$kernel/importers/scan';
  import { repo } from '$kernel/data/repo';
  import { nav } from '$kernel/nav/nav.svelte';
  import { bus } from '$kernel/bus/bus';
  import { draft } from './draft.svelte';

  let { card, avatar, raw }: { card?: ParsedCard; avatar?: Blob; raw?: unknown } = $props();
  // 从角色列表进来时带 card，总是新开草稿；子页面不带 card，共用草稿
  // svelte-ignore state_referenced_locally
  if (card && draft.card !== card) draft.start(card, avatar, raw);
  const f = draft.fields;
  // 检查页卸载（左上角返回、导入、放弃）就清草稿，下次导入不会带上这次的
  $effect(() => () => draft.reset());

  async function doImport() {
    const c0 = draft.card!;
    const fields = cardToCharacterFields({ ...c0, name: f.name, description: f.description, personality: f.personality, scenario: f.scenario, firstMessage: f.first_mes, exampleDialogue: f.mes_example, systemPrompt: f.system_prompt, creatorNotes: f.creator_notes });
    const c = await repo.createCharacter({ ...fields, avatar: draft.avatar });
    bus.emit('notify', { title: `已导入 ${c.name}`, pluginId: 'characters' });
    await nav.pop();
    nav.push('characters', 'detail', { id: c.id });
  }
  function exportSkeleton() {
    const skel = sanitize(draft.raw ?? { ...$state.snapshot(draft.fields), character_book: draft.card?.characterBook });
    const blob = new Blob([JSON.stringify(skel, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${f.name || 'card'}.skeleton.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function abandon() { nav.pop(); }
  const n = $derived(draft.open.length);
  const ignoredN = $derived(draft.findings.length - draft.open.length);
  const hasBook = $derived(!!draft.card?.characterBook);
</script>

<NavBar title="导入前检查" back="返回" />
<SectionTitle text="扫描" />
<List footer="扫描只在本机做，不调任何接口。它只是提醒，判断由你来做。">
  {#if draft.findings.length === 0}
    <Cell title="没有发现可疑内容" subtitle="破限、擦边、未成年、非自愿、极端暴力都没匹配到" />
  {:else}
    <Cell title={n ? `${n} 处可疑内容待处理` : '可疑内容都处理完了'} subtitle={ignoredN ? `另有 ${ignoredN} 处已标记为没问题` : '点进去逐条编辑或标记'} chevron onclick={() => nav.push('characters', 'findings')} />
  {/if}
</List>

<SectionTitle text="字段" />
<List><Field label="名字" bind:value={f.name} /></List>
<SectionTitle text="描述" /><List><Field multiline rows={6} bind:value={f.description} /></List>
<SectionTitle text="性格" /><List><Field multiline rows={2} bind:value={f.personality} /></List>
<SectionTitle text="场景" /><List><Field multiline rows={2} bind:value={f.scenario} /></List>
<SectionTitle text="开场白" /><List><Field multiline rows={3} bind:value={f.first_mes} /></List>
<SectionTitle text="示例对话" /><List><Field multiline rows={4} bind:value={f.mes_example} /></List>
<SectionTitle text="作者系统提示" /><List footer="这一段会原样进常驻设定，破限常藏在这里。不认识的指令建议删掉。"><Field multiline rows={3} bind:value={f.system_prompt} /></List>
<SectionTitle text="作者备注（不进上下文）" /><List><Field multiline rows={2} bind:value={f.creator_notes} /></List>

{#if hasBook}
  <List footer="这张卡带了附加设定集（lorebook）。Roomie 里只有你的现实，这部分不导入；需要的背景可以并进上面的描述里。">
    <Cell title="卡里带的设定集" value="不导入" />
  </List>
{/if}
<div class="actions">
  <Button onclick={doImport}>导入{n ? `（仍有 ${n} 处未处理）` : ''}</Button>
  <Button kind="tinted" onclick={exportSkeleton}>导出结构（脱敏，给开发者看格式）</Button>
  <Button kind="plain" onclick={abandon}><span style="color:var(--red)">放弃</span></Button>
</div>
<div style="height:40px"></div>

<style>.actions { display: flex; flex-direction: column; gap: 10px; margin: 20px 16px 0; align-items: center; }</style>
