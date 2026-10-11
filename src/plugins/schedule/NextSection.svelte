<script lang="ts">
  /** 他的主页上的日程段：今天还有几件、下一件是什么 */
  import { List, Cell, live, nav } from '$kernel/api';
  import type { ProfileSectionProps } from '$kernel/api';
  import { scheduleApi, type ScheduleItem } from './index';
  import { isoDate, whenLabel } from './dates';
  let { characterId: _characterId }: ProfileSectionProps = $props();
  const today = isoDate();
  const rows = live(() => scheduleApi.upcoming(3, today), [] as ScheduleItem[]);
  const todayLeft = $derived(rows.value.filter((i) => i.date === today).length);
  const next = $derived(rows.value[0]);
</script>

<List>
  <Cell title={next ? `${whenLabel(next.date, next.time, today)} ${next.title}` : '没有记下的安排'} subtitle={next ? (todayLeft ? `今天还有 ${todayLeft} 件` : '今天没别的了') : '说一句"明天下午三点开会"他就记下来'} chevron onclick={() => nav.push('schedule', 'app')} />
</List>
