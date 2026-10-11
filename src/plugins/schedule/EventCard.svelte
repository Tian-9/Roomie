<script lang="ts">
  /** 聊天里的日程卡。body 是 {id}，状态从表里实时取；点卡片进日程界面。 */
  import { live, nav, Glyph, icons } from '$kernel/api';
  import { scheduleApi, type ScheduleItem } from './index';
  import { relativeLabel, isoDate } from './dates';
  let { body }: { body: string; attrs?: Record<string, string> } = $props();
  const id = $derived.by(() => { try { return String(JSON.parse(body).id ?? ''); } catch { return ''; } });
  const row = live(() => scheduleApi.items().get(id), undefined as ScheduleItem | undefined, () => [id]);
  const i = $derived(row.value);
  const overdue = $derived(!!i && !i.done && (i.remindAt ? i.remindAt < Date.now() - 30 * 60_000 : i.date < isoDate()));
  function toggle(e: Event) { e.stopPropagation(); if (i) scheduleApi.setDone(i.id, !i.done); }
</script>

<button class="card" class:done={!!i?.done} onclick={() => nav.push('schedule', 'app')}>
  <span class="check" role="checkbox" aria-checked={!!i?.done} aria-label="完成" tabindex="0" onclick={toggle} onkeydown={(e) => { if (e.key === ' ' || e.key === 'Enter') toggle(e); }}>
    {#if i?.done}<Glyph paths={icons.check} size={14} color="#fff" width={3} />{/if}
  </span>
  <span class="body">
    <span class="title">{i?.title ?? '（这条已经删了）'}</span>
    {#if i}<span class="when" class:overdue>{relativeLabel(i.date)}{i.time ? ' ' + i.time : ' · 待办'}{overdue ? ' · 过了' : ''}</span>{/if}
  </span>
  <span class="tag">日程</span>
</button>

<style>
  .card { display: flex; align-items: center; gap: 10px; width: 230px; padding: 10px 12px; border-radius: 12px; background: var(--bg-surface); border: 0.5px solid var(--separator); text-align: left; color: var(--label); }
  .check { flex: 0 0 22px; width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid var(--label-3); display: grid; place-items: center; }
  .done .check { background: var(--green); border-color: var(--green); }
  .body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .title { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .done .title { text-decoration: line-through; color: var(--label-2); }
  .when { font-size: 12px; color: var(--label-2); margin-top: 2px; }
  .when.overdue { color: var(--red); }
  .tag { font-size: 11px; color: var(--label-3); align-self: flex-start; }
</style>
