<script lang="ts">
  /** 聊天里的打卡卡片。body 是 {habitId, name, date, count, unit}，打卡那一刻的数字，不随后来变。 */
  import { Glyph, icons } from '$kernel/api';
  let { body }: { body: string; attrs?: Record<string, string> } = $props();
  const d = $derived.by((): { name: string; date: string; count: number; unit: string } => {
    try { const o = JSON.parse(body); return { name: String(o.name ?? '习惯'), date: String(o.date ?? ''), count: Number(o.count ?? 0), unit: String(o.unit ?? '天') }; }
    catch { return { name: '习惯', date: '', count: 0, unit: '天' }; }
  });
  const nth = $derived(d.unit === '周' ? `连续 ${d.count} 周` : `第 ${d.count} 天`);
</script>

<div class="card">
  <span class="mark"><Glyph paths={icons.check} size={20} color="#fff" width={2.6} /></span>
  <div class="t">
    <div class="name">{d.name}</div>
    <div class="nth">{nth}</div>
  </div>
  {#if d.date}<div class="date">{d.date.slice(5).replace('-', '/')}</div>{/if}
</div>

<style>
  .card { display: flex; align-items: center; gap: 12px; width: 230px; padding: 12px 14px; border-radius: 12px; background: var(--bg-surface); border: 0.5px solid var(--separator); color: var(--label); text-align: left; }
  .mark { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(180deg, #5df777 0%, #11c036 100%); display: grid; place-items: center; flex: 0 0 auto; }
  .t { flex: 1; min-width: 0; }
  .name { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nth { font-size: 13px; color: var(--label-2); margin-top: 2px; }
  .date { font-size: 12px; color: var(--label-3); font-variant-numeric: tabular-nums; align-self: flex-start; }
</style>
