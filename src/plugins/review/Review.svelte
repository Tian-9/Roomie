<script lang="ts">
  import { NavBar, Placeholder, Avatar, Glyph, Sheet, List, Cell, Field, Toggle, Button, live, icons } from '$kernel/api';
  import type { CharacterView } from '$kernel/api';
  import { registry } from '$kernel/registry/registry.svelte';
  import { bus } from '$kernel/bus/bus';
  import { reviewApi, ICON, reviewTitle, materialLines, type ReviewRow, type ReviewSettings } from './index';
  import { DEFAULT_SETTINGS, addDays, ymd, weekdayOf } from './review';

  interface Row extends ReviewRow { name: string; avatar?: Blob }
  const rows = live(async (): Promise<Row[]> => {
    if (!registry.isEnabled('review')) return [];
    const [list, chars, current] = await Promise.all([reviewApi.list(), reviewApi.characters(), reviewApi.current()]);
    return list.map((r) => {
      // 写它的人设删了也还显示，归到现在的他名下
      const ch = chars.find((c: CharacterView) => c.id === r.characterId) ?? current;
      return { ...r, name: ch?.name ?? '他', avatar: ch?.avatar };
    });
  }, []);

  let reading = $state<Row | null>(null);
  let configuring = $state(false);
  let busy = $state(false);
  let morningFrom = $state(String(DEFAULT_SETTINGS.morningFrom));
  let morningTo = $state(String(DEFAULT_SETTINGS.morningTo));
  let weekly = $state(DEFAULT_SETTINGS.weekly);

  async function openSettings() {
    const s = await reviewApi.settings();
    morningFrom = String(s.morningFrom); morningTo = String(s.morningTo); weekly = s.weekly;
    configuring = true;
  }
  async function saveSettings() {
    const s: ReviewSettings = { morningFrom: Number(morningFrom), morningTo: Number(morningTo), weekly };
    await reviewApi.saveSettings(s);
    configuring = false;
  }
  async function writeNow() {
    busy = true;
    try {
      const date = addDays(ymd(), -1);
      if (await reviewApi.forDate('daily', date)) { bus.emit('notify', { title: '昨天已经复盘过了', body: '删掉那篇可以重写' }); return; }
      const r = await reviewApi.write(date);
      if (!r) bus.emit('notify', { title: '没写出来', body: '先在设置里配置 API Key，而且他得已经搬进来' });
    } catch (e) { bus.emit('notify', { title: '生成失败', body: e instanceof Error ? e.message : String(e) }); }
    finally { busy = false; }
  }
  async function remove() { if (reading) await reviewApi.reviews().delete(reading.id); reading = null; }
  const when = (r: ReviewRow) => (r.kind === 'weekly' ? '周小结' : r.material.from === r.material.to ? `周${weekdayOf(r.date)}` : '几天');
</script>

<NavBar title="复盘" large back="桌面">
  {#snippet right()}
    <button class="iconbtn" onclick={openSettings} aria-label="复盘设置"><Glyph paths={icons.gear} size={22} color="var(--tint)" width={2} /></button>
    <button class="iconbtn" onclick={writeNow} aria-label="让他现在复盘昨天" disabled={busy}><Glyph paths={icons.plus} size={24} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>

{#if rows.value.length === 0}
  <Placeholder title="还没有复盘" body="你离开一天以上再回来，他会先跟你说早安，顺便聊聊昨天：聊了什么、花了多少、今天有什么。右上角 + 可以让他现在复盘昨天。" paths={ICON.paths} />
{:else}
  <div class="feed">
    {#each rows.value as r (r.id)}
      <button class="entry" onclick={() => (reading = r)}>
        <div class="date" class:weekly={r.kind === 'weekly'}><span class="d">{r.date.slice(5).replace('-', '/')}</span><span class="w">{when(r)}</span></div>
        <div class="body">
          <div class="who"><Avatar blob={r.avatar} name={r.name} size={22} /> {r.name}{r.source === 'auto' ? '' : ' · 手动'}</div>
          <p class="text">{r.text}</p>
        </div>
      </button>
    {/each}
  </div>
{/if}
<div style="height:40px"></div>

<Sheet open={!!reading} onclose={() => (reading = null)} title={reading ? reviewTitle(reading) : ''}>
  {#if reading}
    <p class="full">{reading.text}</p>
    {#if reading.say}
      <p class="section">他当时说的</p>
      <p class="say">{reading.say}</p>
    {/if}
    <p class="section">那{reading.kind === 'weekly' ? '周' : '天'}的材料</p>
    <List>
      {#each materialLines(reading.material) as line, i (i)}<Cell title={line} />{/each}
    </List>
    <div class="actions">
      <Button kind="plain" onclick={remove}><span style="color:var(--red)">删除这篇</span></Button>
      <Button kind="plain" onclick={() => (reading = null)}>关闭</Button>
    </div>
  {/if}
</Sheet>

<Sheet bind:open={configuring} title="复盘设置">
  <List footer="这段时间里回来他说早安，别的时候说「回来了」。小时数，0 到 24。">
    <Field label="早上从几点" type="number" bind:value={morningFrom} placeholder="5" />
    <Field label="到几点" type="number" bind:value={morningTo} placeholder="11" />
  </List>
  <List footer="周日晚上或周一，他会把这一周回看一遍，放在复盘本里，聊天时顺口提一句。">
    <Cell title="周小结">
      {#snippet right()}<Toggle checked={weekly} label="周小结" onchange={(v) => (weekly = v)} />{/snippet}
    </Cell>
  </List>
  <div class="actions"><Button onclick={saveSettings}>保存</Button></div>
</Sheet>

<style>
  .iconbtn { padding: 8px; display: inline-flex; }
  .feed { background: var(--bg-surface); margin-top: 8px; }
  .entry { display: flex; gap: 14px; width: 100%; padding: 14px 16px; border-bottom: 0.5px solid var(--separator); text-align: left; }
  .entry:active { background: var(--fill-2); }
  .date { display: flex; flex-direction: column; align-items: center; flex: 0 0 52px; padding-top: 2px; }
  .d { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .w { font-size: 11px; color: var(--label-2); }
  .weekly .d { color: var(--tint); }
  .body { flex: 1; min-width: 0; }
  .who { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--label-2); margin-bottom: 4px; }
  .text { margin: 0; font-size: 15px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
  .full { margin: 0 24px; font-size: 16px; line-height: 1.7; white-space: pre-wrap; max-height: 40vh; overflow-y: auto; }
  .say { margin: 0 24px; font-size: 15px; line-height: 1.6; color: var(--label-2); white-space: pre-wrap; }
  .section { margin: 16px 24px 6px; font-size: 13px; color: var(--label-2); }
  .actions { display: flex; flex-direction: column; gap: 6px; margin: 12px 16px 0; align-items: center; }
</style>
