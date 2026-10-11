<script lang="ts">
  /** 记一笔的表单：金额、分类、备注、日期。「+」面板和账本里的手记共用；校验和解析走 ledger.ts */
  import { List, Field, Button } from '$kernel/api';
  import { CATEGORIES, parseAmount, parseDate, ymd, type Category } from './ledger';
  let { submit = '记上', busy = false, onsubmit, oncancel }: {
    submit?: string; busy?: boolean;
    onsubmit: (e: { amount: number; category: Category; note: string; date: string }) => void | Promise<void>;
    oncancel: () => void;
  } = $props();
  let amount = $state('');
  let category = $state<Category>('餐饮');
  let note = $state('');
  let date = $state(ymd());
  let error = $state('');
  async function go() {
    const cents = parseAmount(amount);
    if (cents === null) { error = '金额得是个正数，比如 32 或 28.5'; return; }
    const d = parseDate(date);
    if (!d) { error = '日期格式是 2026-10-11'; return; }
    await onsubmit({ amount: cents, category, note: note.trim(), date: d });
  }
</script>

<div onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } }} role="presentation">
  <List>
    <Field label="金额" bind:value={amount} placeholder="0.00" type="number" oninput={() => (error = '')} />
    <Field label="备注" bind:value={note} placeholder="午饭、打车…" />
    <Field label="日期" bind:value={date} type="date" oninput={() => (error = '')} />
  </List>
  <div class="cats" role="radiogroup" aria-label="分类">
    {#each CATEGORIES as c (c)}
      <button type="button" class="cat" class:on={category === c} role="radio" aria-checked={category === c} onclick={() => (category = c)}>{c}</button>
    {/each}
  </div>
</div>
{#if error}<p class="err">{error}</p>{/if}
<div class="actions">
  <Button onclick={go} disabled={busy}>{submit}</Button>
  <Button kind="plain" onclick={oncancel}>取消</Button>
</div>

<style>
  .cats { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 16px 0; }
  .cat { padding: 6px 14px; border-radius: 999px; background: var(--fill-2); color: var(--label); font-size: 15px; }
  .cat.on { background: var(--tint); color: var(--tint-fg); }
  .err { margin: 8px 32px 0; font-size: 13px; color: var(--red); text-align: center; }
  .actions { display: flex; flex-direction: column; gap: 8px; margin: 12px 16px 0; align-items: center; }
</style>
