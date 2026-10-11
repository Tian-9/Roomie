<script lang="ts">
  /** 他的主页上的一段：每个习惯的连续数。习惯是你的，不按人设分，所以不看 characterId。 */
  import { List, Cell, live, nav } from '$kernel/api';
  import { habitsApi, type Habit, type Check } from './index';
  import { streak, today, describe } from './streak';
  const habits = live(() => habitsApi.habits().toArray(), [] as Habit[]);
  const checks = live(() => habitsApi.checks().toArray(), [] as Check[]);
  const rows = $derived.by(() => {
    const td = today();
    const by = new Map<string, Set<string>>();
    for (const c of checks.value) (by.get(c.habitId) ?? by.set(c.habitId, new Set()).get(c.habitId)!).add(c.date);
    return habits.value.filter((h) => !h.archived).sort((a, b) => a.createdAt - b.createdAt).map((h) => ({ h, s: streak(h.cadence, by.get(h.id) ?? new Set<string>(), td) }));
  });
</script>

<List footer={rows.length ? '聊天里说「今天跑了」他就会记上；晚上八点后没打的他会问一句。' : undefined}>
  {#if rows.length === 0}
    <Cell title="还没有想坚持的事" subtitle="在习惯里加一件，或者直接跟他说" chevron onclick={() => nav.push('habits', 'app')} />
  {/if}
  {#each rows as { h, s } (h.id)}
    <Cell title={h.name} subtitle={describe('', s)} value={s.donePeriod ? '✓' : ''} chevron onclick={() => nav.push('habits', 'app')} />
  {/each}
</List>
