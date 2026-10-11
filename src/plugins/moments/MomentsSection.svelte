<script lang="ts">
  /** 他的主页上的一段：最近一条动态。动态是他发的，但记忆全库一份，不按人设分，所以不看 characterId。 */
  import { List, Cell, live, nav } from '$kernel/api';
  import { momentsApi, type Post } from './index';
  import { ago, excerpt } from './feed';
  const latest = live(async (): Promise<Post | null> => (await momentsApi.list())[0] ?? null, null);
</script>

<List>
  {#if latest.value}
    <Cell title={excerpt(latest.value.text, 40)} subtitle={ago(latest.value.createdAt) + (latest.value.liked ? ' · 你点了心' : '')} chevron onclick={() => nav.push('moments', 'app')} />
  {:else}
    <Cell title="还没发过动态" subtitle="离开一天再回来，他会对这几天说一句" chevron onclick={() => nav.push('moments', 'app')} />
  {/if}
</List>
