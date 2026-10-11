<script lang="ts">
  /** 记一条日程的表单：标题、日期、时间（可空）。日程界面和「+」面板共用。 */
  import { List, Field, Button } from '$kernel/api';
  import { isoDate, parseDate, normalizeTime } from './dates';
  let { onsave, oncancel, saveLabel = '记下' }: { onsave: (v: { title: string; date: string; time: string | null }) => void | Promise<void>; oncancel: () => void; saveLabel?: string } = $props();
  let title = $state('');
  let date = $state(isoDate());
  let time = $state('');
  let error = $state('');
  async function save() {
    const t = title.trim();
    if (!t) { error = '写一句要做什么'; return; }
    if (!parseDate(date)) { error = '日期不对'; return; }
    const tm = time.trim() ? normalizeTime(time) : null;
    if (time.trim() && !tm) { error = '时间不对'; return; }
    await onsave({ title: t, date, time: tm });
  }
</script>

<div onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); } }} role="presentation">
  <List footer="不填时间就是当天的待办。填了时间，页面开着到点会弹一下。">
    <Field label="做什么" bind:value={title} placeholder="开会、买牛奶…" oninput={() => (error = '')} />
    <Field label="日期" bind:value={date} type="date" oninput={() => (error = '')} />
    <Field label="时间" bind:value={time} type="time" placeholder="可不填" oninput={() => (error = '')} />
  </List>
</div>
{#if error}<p class="err">{error}</p>{/if}
<div class="actions">
  <Button onclick={save}>{saveLabel}</Button>
  <Button kind="plain" onclick={oncancel}>取消</Button>
</div>

<style>
  .err { margin: 8px 32px 0; font-size: 13px; color: var(--red); text-align: center; }
  .actions { display: flex; flex-direction: column; gap: 8px; margin: 12px 16px 0; align-items: center; }
</style>
