<script lang="ts">
  /** 他的主页上的账本段：本月、本周花了多少，点进账本 */
  import { List, Cell, live, nav } from '$kernel/api';
  import type { ProfileSectionProps } from '$kernel/api';
  import { ledgerApi } from './index';
  import { ymd, weekRange, monthRange, sum, byCategory, yuan } from './ledger';
  let { characterId: _characterId }: ProfileSectionProps = $props();
  const stats = live(async () => {
    const d = ymd();
    const m = monthRange(d), w = weekRange(d);
    const month = await ledgerApi.range(m.from, m.to);
    const week = month.filter((e) => e.date >= w.from && e.date <= w.to);
    const top = byCategory(month)[0];
    return { month: sum(month), week: sum(week), count: month.length, top: top ? `${top.category} ${yuan(top.amount)}` : '' };
  }, { month: 0, week: 0, count: 0, top: '' });
  const s = $derived(stats.value);
</script>

<List>
  <Cell title="本月花了" subtitle={s.count ? `${s.count} 笔${s.top ? ' · 最多是' + s.top : ''}` : '还没记过账'} value={yuan(s.month)} chevron onclick={() => nav.push('ledger', 'app')} />
  <Cell title="本周" value={yuan(s.week)} />
</List>
