<script lang="ts">
  /**
   * 账本：顶部本月合计和分类条，下面按天分组的流水。左滑一条露出删除；点一条看详情也能删。
   * 右上角：手记一笔、导出 CSV。
   */
  import { NavBar, Placeholder, Sheet, List, Cell, Button, Glyph, live, icons } from '$kernel/api';
  import { ledgerApi } from './index';
  import EntryForm from './EntryForm.svelte';
  import { ymd, monthRange, byDay, byCategory, sum, yuan, toCSV, type Entry } from './ledger';

  let month = $state(ymd().slice(0, 7));
  const rows = live(() => ledgerApi.range(...(Object.values(monthRange(month + '-01')) as [string, string])), [] as Entry[], () => [month]);
  const total = $derived(sum(rows.value));
  const cats = $derived(byCategory(rows.value));
  const days = $derived(byDay(rows.value));
  const isThisMonth = $derived(month === ymd().slice(0, 7));
  function shiftMonth(n: number) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y!, m! - 1 + n, 1);
    month = ymd(d).slice(0, 7);
  }
  const colors: Record<string, string> = { 餐饮: 'var(--orange)', 交通: 'var(--tint)', 购物: 'var(--pink)', 居住: 'var(--indigo)', 娱乐: 'var(--purple)', 其他: 'var(--label-3)' };

  let adding = $state(false);
  let busy = $state(false);
  let reading = $state<Entry | null>(null);
  async function add(v: { amount: number; category: Entry['category']; note: string; date: string }) {
    busy = true;
    try { await ledgerApi.add({ ...v, source: 'manual' }); adding = false; month = v.date.slice(0, 7); }
    finally { busy = false; }
  }
  async function remove(id: string) { await ledgerApi.remove(id); if (reading?.id === id) reading = null; open = null; }

  // 左滑露出删除：记录按下的 x，水平位移超过 60 就露出；点别处收回
  let open = $state<string | null>(null);
  let startX = 0, startY = 0, moved = false;
  function down(e: PointerEvent) { startX = e.clientX; startY = e.clientY; moved = false; }
  function move(e: PointerEvent, id: string) {
    if (e.buttons === 0 && e.pointerType === 'mouse') return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) moved = true;
    if (dx < -60) open = id;
    else if (dx > 30 && open === id) open = null;
  }
  function tap(e: Entry) { if (moved) { moved = false; return; } if (open) { open = null; return; } reading = e; }

  async function exportCSV() {
    const all = await ledgerApi.entries().toArray();
    const blob = new Blob([toCSV(all)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `账本-${ymd()}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const weekday = (d: string) => ['日', '一', '二', '三', '四', '五', '六'][new Date(d + 'T00:00').getDay()];
  const dayLabel = (d: string) => (d === ymd() ? '今天' : d.slice(5).replace('-', '/'));
</script>

<NavBar title="账本" large back="桌面">
  {#snippet right()}
    <button class="iconbtn" onclick={exportCSV} aria-label="导出 CSV"><Glyph paths={['M12 4v12', 'm7 11 5 5 5-5', 'M4 20h16']} size={22} color="var(--tint)" width={2.2} /></button>
    <button class="iconbtn" onclick={() => (adding = true)} aria-label="记一笔"><Glyph paths={icons.plus} size={24} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>

<div class="head">
  <div class="month">
    <button class="nav" onclick={() => shiftMonth(-1)} aria-label="上个月"><Glyph paths={icons.chevronLeft} size={18} width={2.4} /></button>
    <span class="m">{month.replace('-', ' 年 ')} 月</span>
    <button class="nav" onclick={() => shiftMonth(1)} aria-label="下个月" disabled={isThisMonth}><Glyph paths={icons.chevronRight} size={18} width={2.4} /></button>
  </div>
  <div class="total" data-testid="month-total">{yuan(total)}</div>
  <div class="hint">{isThisMonth ? '本月' : '当月'}一共 {rows.value.length} 笔</div>
  {#if cats.length}
    <div class="bar" aria-hidden="true">
      {#each cats as c (c.category)}<span style="flex:{c.amount};background:{colors[c.category]}"></span>{/each}
    </div>
    <div class="legend">
      {#each cats as c (c.category)}
        <span class="lg"><i style="background:{colors[c.category]}"></i>{c.category} {yuan(c.amount)}</span>
      {/each}
    </div>
  {/if}
</div>

{#if rows.value.length === 0}
  <Placeholder title={isThisMonth ? '这个月还没记账' : '这个月没有记录'} body="在聊天里说一句「午饭 32」他就记上了，或者点右上角 + 自己记。" paths={icons.receipt} />
{:else}
  {#each days as d (d.date)}
    <div class="day">
      <div class="dh"><span>{dayLabel(d.date)} 周{weekday(d.date)}</span><span>{yuan(d.total)}</span></div>
      <div class="list">
        {#each d.items as e (e.id)}
          <div class="row" class:open={open === e.id}>
            <button class="main" onpointerdown={down} onpointermove={(ev) => move(ev, e.id)} onclick={() => tap(e)}>
              <span class="dot" style="background:{colors[e.category]}"></span>
              <span class="txt"><span class="t">{e.note || e.category}</span><span class="s">{e.category}{e.source === 'tool' ? ' · 他记的' : ''}</span></span>
              <span class="amt">{yuan(e.amount)}</span>
            </button>
            <button class="del" onclick={() => remove(e.id)} aria-label="删除">删除</button>
          </div>
        {/each}
      </div>
    </div>
  {/each}
{/if}
<div style="height:40px"></div>

<Sheet bind:open={adding} title="记一笔">
  {#if adding}<EntryForm onsubmit={add} oncancel={() => (adding = false)} {busy} />{/if}
</Sheet>
<Sheet open={!!reading} onclose={() => (reading = null)} title={reading ? yuan(reading.amount) : ''}>
  {#if reading}
    <List>
      <Cell title="分类" value={reading.category} />
      <Cell title="备注" value={reading.note || '无'} />
      <Cell title="日期" value={reading.date} />
      <Cell title="来源" value={reading.source === 'tool' ? '他记的' : '手记'} />
    </List>
    <div class="actions">
      <Button kind="plain" onclick={() => remove(reading!.id)}><span style="color:var(--red)">删掉这笔</span></Button>
      <Button kind="plain" onclick={() => (reading = null)}>关闭</Button>
    </div>
  {/if}
</Sheet>

<style>
  .iconbtn { padding: 8px; display: inline-flex; }
  .head { margin: 8px 16px 12px; padding: 16px; border-radius: var(--radius-card); background: var(--bg-surface); }
  .month { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; color: var(--label-2); }
  .nav { display: inline-flex; padding: 4px; color: var(--tint); }
  .nav:disabled { opacity: 0.3; }
  .total { font-size: 36px; font-weight: 700; text-align: center; margin-top: 6px; font-variant-numeric: tabular-nums; letter-spacing: -0.5px; }
  .hint { font-size: 13px; color: var(--label-2); text-align: center; margin-top: 2px; }
  .bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin-top: 14px; gap: 2px; }
  .bar span { display: block; min-width: 3px; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 10px; font-size: 12px; color: var(--label-2); }
  .lg { display: inline-flex; align-items: center; gap: 5px; }
  .lg i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .day { margin-top: 8px; }
  .dh { display: flex; justify-content: space-between; padding: 6px 32px 4px; font-size: 13px; color: var(--label-2); }
  .list { background: var(--bg-surface); margin: 0 16px; border-radius: var(--radius-cell); overflow: hidden; }
  .row { position: relative; overflow: hidden; }
  .row + .row::before { content: ''; position: absolute; top: 0; left: 44px; right: 0; border-top: 0.5px solid var(--separator); z-index: 1; }
  .main { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 16px; min-height: 52px; text-align: left; background: var(--bg-surface); position: relative; z-index: 1; transition: padding-right 0.18s ease; touch-action: pan-y; }
  .row.open .main { padding-right: 88px; }
  .main:active { background: var(--fill-2); }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; }
  .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .t { font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .s { font-size: 12px; color: var(--label-2); }
  .amt { font-size: 16px; font-variant-numeric: tabular-nums; }
  .del { position: absolute; top: 0; right: 0; bottom: 0; width: 72px; background: var(--red); color: #fff; font-size: 15px; z-index: 2; transform: translateX(100%); transition: transform 0.18s ease; }
  .row.open .del { transform: none; }
  .actions { display: flex; flex-direction: column; gap: 6px; margin: 12px 16px 0; align-items: center; }
</style>
