<script lang="ts">
  /** 换地点：用定位，或者搜城市（Open-Meteo geocoding，中文） */
  import { List, Cell, Field, Glyph, icons } from '$kernel/api';
  import { searchPlaces, type Place } from './api';
  let { onpick, onlocate, locating = false }: { onpick: (p: Place) => void; onlocate: () => void; locating?: boolean } = $props();
  let q = $state('');
  let results = $state<Place[]>([]);
  let searching = $state(false);
  let failed = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;

  function input(v: string) {
    q = v;
    if (timer) clearTimeout(timer);
    const mine = ++seq;
    if (!v.trim()) { results = []; failed = false; searching = false; return; }
    searching = true;
    timer = setTimeout(async () => {
      try {
        const rs = await searchPlaces(v);
        if (mine !== seq) return;
        results = rs; failed = false;
      } catch {
        if (mine !== seq) return;
        results = []; failed = true;
      } finally {
        if (mine === seq) searching = false;
      }
    }, 350);
  }
</script>

<List>
  <Cell title={locating ? '正在定位…' : '用我的位置'} icon={{ paths: icons.globe, background: 'var(--tint)' }} onclick={onlocate} disabled={locating} />
</List>
<div style="height:12px"></div>
<List footer={failed ? '搜不到，网络好像不通。' : !q.trim() ? '输入城市名，中英文都行。' : undefined}>
  <Field label="城市" placeholder="北京 / Tokyo" value={q} oninput={input} />
  {#if searching}
    <Cell title="搜索中…" disabled />
  {:else if q.trim() && !failed && results.length === 0}
    <Cell title="没找到这个地方" disabled />
  {/if}
  {#each results as p (`${p.lat},${p.lon}`)}
    <Cell title={p.name} subtitle={[p.admin, p.country].filter((x) => x && x !== p.name).join(' · ') || undefined} onclick={() => onpick(p)}>
      {#snippet right()}<Glyph paths={icons.chevronRight} size={16} color="var(--label-3)" width={2.4} />{/snippet}
    </Cell>
  {/each}
</List>
