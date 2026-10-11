<script lang="ts">
  /** 他的主页上的一段：最近的一个日子。日子是你的，不按人设分，所以不看 characterId。 */
  import { List, Cell, live, nav } from '$kernel/api';
  import type { ProfileSectionProps } from '$kernel/api';
  import { datesApi, type DateEntry } from './index';
  import { isoDate, daysText, nthText, shortDate, weekday } from './dates';
  let { characterId: _characterId }: ProfileSectionProps = $props();
  const entries = live(() => datesApi.dates().toArray(), [] as DateEntry[]);
  const next = $derived(datesApi.rows(entries.value, isoDate()).find((r) => r.occ && r.occ.days >= 0));
  const n = $derived(next?.occ ? nthText(next.e.kind, next.occ.nth) : '');
</script>

<List>
  {#if next?.occ}
    <Cell title={`${next.e.title} · ${daysText(next.occ.days)}`} subtitle={`${shortDate(next.occ.date)} ${weekday(next.occ.date)}${n ? ` · ${n}` : ''}`} chevron onclick={() => nav.push('dates', 'app')} />
  {:else}
    <Cell title="还没记下什么日子" subtitle="生日、纪念日跟他说一声他就记得" chevron onclick={() => nav.push('dates', 'app')} />
  {/if}
</List>
