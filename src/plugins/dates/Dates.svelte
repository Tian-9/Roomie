<script lang="ts">
  import { NavBar, Placeholder, Glyph, Sheet, List, Cell, Field, Button, Toggle, live, icons } from '$kernel/api';
  import { datesApi, ICON, type DateEntry, type DateRow } from './index';
  import { isoDate, parseDate, validMonthDay, daysText, nthText, dateLabel, weekday, shortDate, KINDS, KIND_LABEL, type Kind } from './dates';

  const entries = live(() => datesApi.dates().toArray(), [] as DateEntry[]);
  const td = isoDate();
  const rows = $derived(datesApi.rows(entries.value, td));
  const noLunar = $derived(!datesApi.lunar() && entries.value.some((e) => e.lunar));

  let adding = $state(false);
  let editing = $state<DateEntry | null>(null);
  let title = $state('');
  let kind = $state<Kind>('birthday');
  let date = $state(td);
  let lunar = $state(false);
  let withYear = $state(true);
  let error = $state('');

  function reset(e?: DateEntry) {
    title = e?.title ?? '';
    kind = e?.kind ?? 'birthday';
    lunar = e?.lunar ?? false;
    withYear = e ? e.year !== undefined : true;
    date = e ? `${e.year ?? Number(td.slice(0, 4))}-${String(e.month).padStart(2, '0')}-${String(e.day).padStart(2, '0')}` : td;
    error = '';
  }
  function openAdd() { reset(); adding = true; }
  function openEdit(e: DateEntry) { reset(e); editing = e; }

  /** 表单 → 一条；农历按月日填，年份当农历年 */
  function read(): Omit<DateEntry, 'id' | 'createdAt' | 'source'> | null {
    const t = title.trim();
    if (!t) { error = '叫什么？'; return null; }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m) { error = '选一个日期'; return null; }
    const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
    const isLunar = lunar && kind !== 'countdown';
    if (!validMonthDay(month, day, isLunar) || (!isLunar && !parseDate(date))) { error = '日期不对'; return null; }
    if (isLunar && !datesApi.lunar()) { error = '算农历要先开日程'; return null; }
    const keepYear = kind === 'countdown' || withYear;
    return { title: t.slice(0, 40), kind, month, day, lunar: isLunar, ...(keepYear ? { year } : {}) };
  }
  async function add() {
    const v = read();
    if (!v) return;
    await datesApi.add({ ...v, source: 'manual' });
    adding = false;
  }
  async function save() {
    const v = read();
    if (!v || !editing) return;
    await datesApi.update(editing.id, { ...v, year: v.year });
    editing = null;
  }
  async function remove() { if (editing) await datesApi.remove(editing.id); editing = null; }

  const big = (r: DateRow) => (r.occ ? (r.occ.days < 0 ? `${-r.occ.days}` : `${r.occ.days}`) : '—');
  const unit = (r: DateRow) => (r.occ ? (r.occ.days < 0 ? '天前' : r.occ.days === 0 ? '' : '天') : '');
  const sub = (r: DateRow) => `${KIND_LABEL[r.e.kind]} · ${dateLabel(r.e)}`;
  /** 第二行：下一次是哪天、第几个 */
  const next = (r: DateRow) => {
    if (!r.occ) return r.e.lunar ? '开日程才能算农历' : '';
    const n = nthText(r.e.kind, r.occ.nth);
    const when = r.occ.days === 0 ? '就是今天' : r.occ.days < 0 ? `${shortDate(r.occ.date)} ${weekday(r.occ.date)}，已经过了` : `${shortDate(r.occ.date)} ${weekday(r.occ.date)}`;
    return `${when}${n ? ` · ${n}` : ''}`;
  };
</script>

{#snippet form(submit: () => void, label: string)}
  <div onkeydown={(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } }} role="presentation">
    <List>
      <Field label="叫什么" bind:value={title} placeholder="妈妈生日、在一起、考研…" oninput={() => (error = '')} />
      <Field label="日期" bind:value={date} type="date" oninput={() => (error = '')} />
    </List>
    <p class="section">是什么</p>
    <List footer={kind === 'countdown' ? '只有那一天，到了就结束，比如考试、出发。' : '每年都过，记了年份他会知道是第几个。'}>
      {#each KINDS as k (k)}
        <Cell title={KIND_LABEL[k]} value={kind === k ? '✓' : ''} onclick={() => (kind = k)} />
      {/each}
    </List>
    {#if kind !== 'countdown'}
      <p class="section">更多</p>
      <List footer={lunar ? '农历按月日填：八月十五就选 8 月 15 日，年份当农历年。' : '不记年份就只记月日，算不出几岁。'}>
        <Cell title="记年份">{#snippet right()}<Toggle bind:checked={withYear} label="记年份" />{/snippet}</Cell>
        <Cell title="农历">{#snippet right()}<Toggle bind:checked={lunar} label="农历" />{/snippet}</Cell>
      </List>
    {/if}
  </div>
  {#if error}<p class="err">{error}</p>{/if}
  <div class="actions">
    <Button onclick={submit} disabled={!title.trim()}>{label}</Button>
    {#if editing}<Button kind="plain" onclick={remove}><span style="color:var(--red)">删除</span></Button>{/if}
  </div>
{/snippet}

<NavBar title="纪念日" large back="桌面">
  {#snippet right()}
    <button class="iconbtn" onclick={openAdd} aria-label="记一个日子"><Glyph paths={icons.plus} size={24} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>

{#if rows.length === 0}
  <Placeholder title="还没记下什么日子" body="右上角 + 记一个，或者直接跟他说「我妈生日是 10 月 14 号」。快到的时候他会提一句。" paths={ICON.paths} />
{:else}
  {#if noLunar}<p class="hint warn">有农历的日子，开了日程才能算出哪天。</p>{/if}
  <div class="cards">
    {#each rows as r (r.e.id)}
      <button class="entry" class:today={r.occ?.days === 0} class:past={!!r.occ && r.occ.days < 0} onclick={() => openEdit(r.e)}>
        <div class="t">
          <div class="name">{r.e.title}</div>
          <div class="meta">{sub(r)}</div>
          {#if next(r)}<div class="meta">{next(r)}</div>{/if}
        </div>
        <div class="count">
          <span class="n">{r.occ?.days === 0 ? '今天' : big(r)}</span>
          {#if unit(r)}<span class="u">{unit(r)}</span>{/if}
        </div>
      </button>
    {/each}
  </div>
  <p class="hint">点一条可以改或删。</p>
{/if}
<div style="height:40px"></div>

<Sheet bind:open={adding} title="记一个日子">
  {@render form(add, '记下')}
</Sheet>

<Sheet open={!!editing} onclose={() => (editing = null)} title={editing?.title ?? ''}>
  {#if editing}{@render form(save, '保存')}{/if}
</Sheet>

<style>
  .iconbtn { padding: 8px; display: inline-flex; }
  .cards { display: flex; flex-direction: column; gap: 10px; padding: 8px 16px 0; }
  .entry { display: flex; align-items: center; gap: 12px; width: 100%; background: var(--bg-surface); border-radius: var(--radius-cell); padding: 14px 16px; text-align: left; color: var(--label); }
  .entry:active { background: var(--fill-2); }
  .t { flex: 1; min-width: 0; }
  .name { font-size: 17px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { font-size: 13px; color: var(--label-2); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count { display: flex; align-items: baseline; gap: 3px; color: var(--tint); flex: 0 0 auto; }
  .n { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
  .u { font-size: 13px; color: var(--label-2); }
  .today .count { color: var(--red, #e5281a); }
  .past { opacity: 0.55; }
  .past .count { color: var(--label-2); }
  .section { font-size: 13px; color: var(--label-2); margin: 22px 32px 7px; }
  .hint { font-size: 13px; color: var(--label-2); margin: 10px 32px 0; }
  .warn { color: var(--red, #e5281a); margin-top: 8px; }
  .err { margin: 8px 32px 0; font-size: 13px; color: var(--red); text-align: center; }
  .actions { display: flex; flex-direction: column; gap: 6px; margin: 12px 16px 0; align-items: center; }
</style>
