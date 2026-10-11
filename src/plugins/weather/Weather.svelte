<script lang="ts">
  /** 天气一屏：当前 + 24 小时 + 7 天。第一次打开先问定位，拒绝了就手选城市。 */
  import { onMount } from 'svelte';
  import { NavBar, List, Cell, Sheet, Button, Placeholder, Glyph, icons } from '$kernel/api';
  import { weatherApi, ICON } from './index';
  import { placeLabel, today as todayOf, type Forecast, type Place, type Day } from './api';
  import { weatherLabel, skyOf, aqiLabel, SKY_PATHS } from './codes';
  import CityPicker from './CityPicker.svelte';

  let place = $state<Place | null>(null);
  let fc = $state<Forecast | null>(null);
  let loading = $state(false);
  let locating = $state(false);
  let picking = $state(false);
  let geoFailed = $state('');
  let ready = $state(false);

  const td = $derived(fc ? todayOf(fc) : undefined);
  const week = $derived(fc ? fc.days.slice(1) : []);
  const range = $derived.by(() => {
    if (!week.length) return { lo: 0, hi: 1 };
    const lo = Math.min(...week.map((d) => d.tmin)), hi = Math.max(...week.map((d) => d.tmax));
    return { lo, hi: hi === lo ? lo + 1 : hi };
  });
  const updated = $derived(fc ? new Date(fc.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
  const sunrise = $derived(td?.sunrise?.slice(11, 16) ?? '');
  const sunset = $derived(td?.sunset?.slice(11, 16) ?? '');

  async function load(force = false) {
    loading = true;
    try {
      fc = await weatherApi.refresh({ force });
    } finally {
      loading = false;
    }
  }
  async function locate() {
    locating = true; geoFailed = '';
    try {
      place = await weatherApi.locate();
      picking = false;
      fc = await weatherApi.cached();
    } catch (e) {
      geoFailed = e instanceof Error ? e.message : '定位失败';
      picking = true;
    } finally {
      locating = false;
    }
  }
  async function pick(p: Place) {
    picking = false;
    place = p;
    fc = null;
    loading = true;
    try {
      await weatherApi.setPlace($state.snapshot(p));
      fc = await weatherApi.cached();
    } finally {
      loading = false;
    }
  }
  onMount(async () => {
    place = await weatherApi.place();
    fc = await weatherApi.cached();
    ready = true;
    if (place) { load(); return; }
    // 首次：先问定位；拒绝了弹城市列表（浏览器记住了拒绝的话会立刻失败，直接进列表）
    locate();
  });

  const hourLabel = (t: string, i: number) => (i === 0 ? '现在' : `${t.slice(11, 13)}时`);
  const dayLabel = (d: Day, i: number) => (i === 0 ? '今天' : i === 1 ? '明天' : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(d.date + 'T00:00:00').getDay()]);
  const bar = (d: Day) => {
    const span = range.hi - range.lo;
    return `left:${((d.tmin - range.lo) / span) * 100}%; width:${Math.max(6, ((d.tmax - d.tmin) / span) * 100)}%`;
  };
</script>

<NavBar title="天气" back="桌面">
  {#snippet right()}
    {#if place}
      <button class="iconbtn" onclick={() => (picking = true)} aria-label="换地点"><Glyph paths={icons.globe} size={22} color="var(--tint)" width={2} /></button>
    {/if}
  {/snippet}
</NavBar>

{#if !ready}
  <div style="height:200px"></div>
{:else if !place}
  <Placeholder title="你在哪儿" body="知道你那边的天气，他才能提醒你带伞、加衣服。定位只用来查天气，不会存到别处。" paths={ICON.paths} />
  <div class="actions">
    <Button onclick={locate} disabled={locating}>{locating ? '正在定位…' : '用我的位置'}</Button>
    <Button kind="tinted" onclick={() => (picking = true)}>手动选城市</Button>
    {#if geoFailed}<p class="err">定位没成功：{geoFailed}</p>{/if}
  </div>
{:else if !fc}
  {#if loading}
    <Placeholder title={place.name} body="正在查…" paths={ICON.paths} />
  {:else}
    <Placeholder title={place.name} body="暂时拿不到预报，可能是网络不通。聊天不受影响。" paths={ICON.paths} />
    <div class="actions"><Button kind="tinted" onclick={() => load(true)}>再试一次</Button></div>
  {/if}
{:else}
  <section class="now" class:night={!fc.current.isDay}>
    <div class="city">{placeLabel(place)}</div>
    <div class="temp">{Math.round(fc.current.temp)}°</div>
    <div class="desc"><Glyph paths={SKY_PATHS[skyOf(fc.current.code, fc.current.isDay)]} size={20} width={1.8} /> {weatherLabel(fc.current.code)}</div>
    {#if td}<div class="hilo">最高 {Math.round(td.tmax)}° · 最低 {Math.round(td.tmin)}°</div>{/if}
    <div class="facts">
      <span>体感 {Math.round(fc.current.feels)}°</span>
      <span>湿度 {fc.current.humidity}%</span>
      <span>风 {Math.round(fc.current.wind)} km/h</span>
      {#if fc.aqi != null}<span class="aqi" data-level={aqiLabel(fc.aqi)}>空气{aqiLabel(fc.aqi)} {fc.aqi}</span>{/if}
    </div>
  </section>

  <div class="label">24 小时</div>
  <div class="hours">
    {#each fc.hourly as h, i (h.time)}
      <div class="hour">
        <div class="h-t">{hourLabel(h.time, i)}</div>
        <Glyph paths={SKY_PATHS[skyOf(h.code, h.isDay)]} size={22} width={1.8} />
        <div class="h-r">{h.rain >= 30 ? `${h.rain}%` : ''}</div>
        <div class="h-d">{Math.round(h.temp)}°</div>
      </div>
    {/each}
  </div>

  <div class="label">7 天</div>
  <List>
    {#each week as d, i (d.date)}
      <div class="day">
        <span class="d-n">{dayLabel(d, i)}</span>
        <span class="d-i"><Glyph paths={SKY_PATHS[skyOf(d.code)]} size={22} width={1.8} /></span>
        <span class="d-r">{d.rain >= 30 ? `${d.rain}%` : ''}</span>
        <span class="d-lo">{Math.round(d.tmin)}°</span>
        <span class="d-bar"><i style={bar(d)}></i></span>
        <span class="d-hi">{Math.round(d.tmax)}°</span>
      </div>
    {/each}
  </List>

  <div style="height:12px"></div>
  <List>
    {#if sunrise}<Cell title="日出 / 日落" value={`${sunrise} / ${sunset}`} />{/if}
    {#if fc.pm25 != null}<Cell title="PM2.5" value={`${fc.pm25} μg/m³`} />{/if}
    <Cell title={`更新于 ${updated}`} subtitle="数据来自 Open-Meteo，每小时最多更新一次" value={loading ? '更新中…' : '刷新'} onclick={() => load(true)} disabled={loading} />
  </List>
  <div style="height:40px"></div>
{/if}

<Sheet bind:open={picking} title="换个地方">
  <CityPicker onpick={pick} onlocate={locate} {locating} />
  {#if geoFailed}<p class="err">定位没成功：{geoFailed}</p>{/if}
</Sheet>

<style>
  .iconbtn { padding: 8px; display: inline-flex; }
  .actions { display: flex; flex-direction: column; gap: 10px; margin: 0 24px; }
  .err { font-size: 13px; color: var(--red); text-align: center; margin: 8px 24px 0; }
  .now { padding: 8px 20px 18px; text-align: center; }
  .city { font-size: 20px; font-weight: 600; }
  .temp { font-size: 76px; font-weight: 200; line-height: 1.1; letter-spacing: -2px; }
  .desc { display: inline-flex; align-items: center; gap: 6px; font-size: 17px; color: var(--label-2); }
  .hilo { font-size: 15px; color: var(--label-2); margin-top: 4px; }
  .facts { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 14px; margin-top: 12px; font-size: 13px; color: var(--label-2); }
  .aqi[data-level='轻度污染'], .aqi[data-level='中度污染'] { color: var(--orange); }
  .aqi[data-level='重度污染'], .aqi[data-level='严重污染'] { color: var(--red); }
  .label { padding: 0 20px 6px; font-size: 13px; color: var(--label-2); text-transform: uppercase; margin-top: 8px; }
  .hours { display: flex; gap: 4px; overflow-x: auto; padding: 10px 12px; margin: 0 16px 14px; background: var(--bg-surface); border-radius: var(--radius-cell); scrollbar-width: none; }
  .hours::-webkit-scrollbar { display: none; }
  .hour { flex: 0 0 52px; display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .h-t { font-size: 12px; color: var(--label-2); white-space: nowrap; }
  .h-r { font-size: 11px; color: var(--tint); min-height: 13px; }
  .h-d { font-size: 16px; font-weight: 500; }
  .day { display: grid; grid-template-columns: 3.2em 28px 2.6em 2.6em 1fr 2.6em; align-items: center; gap: 8px; padding: 10px 16px; position: relative; font-size: 16px; }
  .day + .day::before { content: ''; position: absolute; top: 0; left: 16px; right: 0; border-top: 0.5px solid var(--separator); }
  .d-i { display: inline-flex; }
  .d-r { font-size: 12px; color: var(--tint); }
  .d-lo { color: var(--label-2); text-align: right; font-variant-numeric: tabular-nums; }
  .d-hi { text-align: right; font-variant-numeric: tabular-nums; }
  .d-bar { position: relative; height: 5px; border-radius: 3px; background: var(--fill-2); }
  .d-bar i { position: absolute; top: 0; height: 100%; border-radius: 3px; background: linear-gradient(90deg, #4fb6ff, #ffbd47); }
</style>
