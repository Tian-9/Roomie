<script lang="ts">
  /** 订阅日历一屏：说明怎么个轻法、贴 Google 的私密地址、导入 .ics 文件、看每个日历的上次同步、刷新间隔、自建中转。 */
  import { NavBar, List, Cell, Field, SectionTitle, Sheet, Button, live } from '$kernel/api';
  import { feeds, FEED_DEFAULTS, INTERVAL_OPTIONS, isValidFeedUrl, type Feed, type FeedSettings } from './feeds';

  const s = live(() => feeds.settings(), { ...FEED_DEFAULTS } as FeedSettings);
  let url = $state('');
  let relay = $state('');
  let relayLoaded = false;
  let busy = $state<'' | 'add' | 'file' | 'sync' | 'one' | 'remove'>('');
  let msg = $state<{ text: string; bad: boolean } | null>(null);
  let picking = $state(false);
  let viewing = $state<Feed | null>(null);
  let fileFor = $state<string | undefined>(undefined);
  let fileInput: HTMLInputElement | undefined = $state();

  $effect(() => { if (!relayLoaded && s.value) { relay = s.value.relay; relayLoaded = true; } });

  const urlOk = $derived(isValidFeedUrl(url));
  const intervalLabel = $derived(INTERVAL_OPTIONS.find((o) => o.hours === s.value.intervalHours)?.label ?? `${s.value.intervalHours} 小时`);
  const when = (t: number) => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const sub = (f: Feed) => (f.lastError ? `上次没拉到：${f.lastError}` : f.lastSyncAt ? `${when(f.lastSyncAt)} 更新 · ${f.count ?? 0} 件` : '还没同步过');

  async function run(kind: typeof busy, fn: () => Promise<string>) {
    if (busy) return;
    busy = kind; msg = null;
    try { msg = { text: await fn(), bad: false }; }
    catch (e) { msg = { text: e instanceof Error ? e.message : String(e), bad: true }; }
    finally { busy = ''; }
  }
  const summary = (r: { added: number; updated: number; removed: number; total: number }) => `拿到 ${r.total} 件${r.added ? `，新来 ${r.added}` : ''}${r.updated ? `，改了 ${r.updated}` : ''}${r.removed ? `，没了 ${r.removed}` : ''}`;

  const add = () => run('add', async () => {
    const r = await feeds.addUrl(url);
    url = '';
    if (r.error) throw new Error(`订阅加上了，但这次没拉到：${r.error}`);
    return `${r.feed.name}：${summary(r.result!)}`;
  });
  function pickFile(forId?: string) { fileFor = forId; fileInput?.click(); }
  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    const text = await f.text();
    const forId = fileFor; fileFor = undefined;
    viewing = null;
    await run('file', async () => { const r = await feeds.importFile(text, { feedId: forId, name: f.name.replace(/\.ics$/i, '') }); return `${r.feed.name}：${summary(r.result)}`; });
  }
  const syncAll = () => run('sync', async () => { await feeds.syncDue(true); const bad = (await feeds.settings()).feeds.filter((f) => f.lastError); return bad.length ? `有 ${bad.length} 个没拉到，看下面` : '都更新了'; });
  const syncOne = (f: Feed) => run('one', async () => { const r = await feeds.syncOne(f.id, true); viewing = null; return `${f.name}：${summary(r)}`; });
  const removeFeed = (f: Feed) => run('remove', async () => { await feeds.remove(f.id); viewing = null; return `${f.name} 删掉了，它带来的日程也一起清了`; });
  async function setInterval_(h: number) { await feeds.save({ intervalHours: h }); picking = false; }
  let relayTimer: ReturnType<typeof setTimeout> | null = null;
  function onRelay(v: string) {
    relay = v;
    if (relayTimer) clearTimeout(relayTimer);
    relayTimer = setTimeout(() => { feeds.save({ relay: v.trim() }).catch(() => {}); }, 400);
  }
</script>

<NavBar title="订阅日历" back="日程" />

<SectionTitle text="这是什么" />
<List footer="没有后台：打开这里的时候他去拉一次，存在这台设备上，平时读本地的；几个小时内再打开不重复拉。你在 Google 日历里加的事，下次打开这里他才知道。只读、单向，他记的日程不会写回 Google。">
  <Cell title="把 Google 日历的事拿进日程" subtitle="和他记的日程排在一起，到点会提醒，回来时他也会提" />
</List>

<SectionTitle text="怎么拿到地址" />
<ol class="steps">
  <li>电脑上打开 Google 日历，右上角齿轮 → 设置</li>
  <li>左边「我的日历的设置」里点要订阅的那个日历</li>
  <li>往下拉到「集成日历」，复制「iCal 格式的私密地址」（calendar.google.com/calendar/ical/ 开头、basic.ics 结尾），贴到下面</li>
</ol>
<p class="foot">这串地址等同密码，拿到就能看整本日历。它和 API Key 放在一起保管，开了锁屏就一起加密。觉得泄露了，去 Google 日历同一个地方点「重置」再重新贴。</p>

<SectionTitle text="贴地址" />
<List footer={url && !urlOk ? '地址的样子不对，应该是 https:// 开头的一整串。' : '贴好点「订阅」，马上拉一次。'}>
  <Field label="私密地址" value={url} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" oninput={(v) => (url = v)} />
  <Cell title={busy === 'add' ? '拉取中…' : '订阅'} disabled={!urlOk || !!busy} onclick={urlOk && !busy ? add : undefined} />
</List>

<SectionTitle text="或者导入文件" />
<List footer="Google 日历设置 → 导入和导出 → 导出，解压后每个日历一个 .ics。导入是一次性的，日历改了要重新导；同一个日历再导一次会更新而不是重复。">
  <Cell title={busy === 'file' ? '导入中…' : '选一个 .ics 文件'} disabled={!!busy} onclick={busy ? undefined : () => pickFile()} />
</List>
<input bind:this={fileInput} type="file" accept=".ics,text/calendar" style="display:none" onchange={onFile} />

{#if msg}<p class="result" class:bad={msg.bad}>{msg.text}</p>{/if}

{#if s.value.feeds.length}
  <SectionTitle text="订阅了的" />
  <List>
    {#each s.value.feeds as f (f.id)}
      <Cell title={f.name} subtitle={sub(f)} value={f.kind === 'file' ? '文件' : undefined} chevron onclick={() => (viewing = f)} />
    {/each}
  </List>

  <SectionTitle text="刷新" />
  <List footer="打开和回到前台时，上次拉取超过这个间隔就在后台再拉一次。文件导入的不会自动更新。">
    <Cell title="最少隔多久" value={intervalLabel} chevron onclick={() => (picking = true)} />
    <Cell title={busy === 'sync' ? '刷新中…' : '现在刷新全部'} disabled={!!busy || !s.value.feeds.some((f) => f.kind === 'url')} onclick={busy ? undefined : syncAll} />
  </List>
{/if}

<SectionTitle text="拉不到的时候" />
<List footer={'Google 的私密地址不给浏览器跨域许可，直接拉多半会被拦。两条路：一是用上面的导入文件；二是自己架一个中转（比如一个 Cloudflare Worker，README 里有十来行的例子），把它的地址填在这里，{url} 的位置会换成编码后的日历地址，没写 {url} 就直接接在后面。别用网上的公共代理，那等于把日历给了别人。'}>
  <Field label="自建中转" value={relay} placeholder="https://你的中转/?url={url}" oninput={onRelay} />
</List>
<div style="height:40px"></div>

<Sheet open={!!viewing} onclose={() => (viewing = null)} title={viewing?.name ?? ''}>
  {#if viewing}
    <p class="detail">{viewing.kind === 'url' ? '地址订阅' : '文件导入'} · {sub(viewing)}</p>
    <div class="actions">
      {#if viewing.kind === 'url'}
        <Button onclick={() => syncOne(viewing!)}>{busy === 'one' ? '拉取中…' : '现在刷新'}</Button>
      {:else}
        <Button onclick={() => pickFile(viewing!.id)}>换一个文件更新</Button>
      {/if}
      <Button kind="plain" onclick={() => removeFeed(viewing!)}><span style="color:var(--red)">删掉这个日历</span></Button>
    </div>
  {/if}
</Sheet>

<Sheet bind:open={picking} title="最少隔多久">
  <List>
    {#each INTERVAL_OPTIONS as o (o.hours)}
      <Cell title={o.label} value={o.hours === s.value.intervalHours ? '✓' : undefined} onclick={() => setInterval_(o.hours)} />
    {/each}
  </List>
</Sheet>

<style>
  .steps { margin: 0 16px; padding: 12px 16px 12px 36px; background: var(--bg-surface); border-radius: 12px; font-size: 15px; line-height: 1.45; }
  .steps li + li { margin-top: 8px; }
  .foot { margin: 6px 32px 18px; font-size: 13px; color: var(--label-2); line-height: 1.4; }
  .result { margin: 8px 32px 0; font-size: 13px; color: var(--green); }
  .result.bad { color: var(--red); }
  .detail { margin: 0 24px; font-size: 14px; color: var(--label-2); }
  .actions { display: flex; flex-direction: column; gap: 6px; margin: 16px 16px 0; align-items: center; }
</style>
