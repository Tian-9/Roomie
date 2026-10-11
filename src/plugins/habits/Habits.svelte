<script lang="ts">
  import { NavBar, Placeholder, Glyph, Sheet, List, Cell, Field, Button, live, icons } from '$kernel/api';
  import { habitsApi, HABIT_ICON, type Habit, type Check } from './index';
  import { streak, today, lastDays, dow, CADENCES, CADENCE_LABEL, isDue, type Cadence, type Streak } from './streak';

  interface Row { h: Habit; s: Streak; dots: { d: string; on: boolean; due: boolean }[] }
  const habits = live(() => habitsApi.habits().toArray(), [] as Habit[]);
  const checks = live(() => habitsApi.checks().toArray(), [] as Check[]);
  const td = today();
  const week = lastDays(td, 7);
  const rows = $derived.by((): Row[] => {
    const by = new Map<string, Set<string>>();
    for (const c of checks.value) (by.get(c.habitId) ?? by.set(c.habitId, new Set()).get(c.habitId)!).add(c.date);
    return habits.value.filter((h) => !h.archived).sort((a, b) => a.createdAt - b.createdAt).map((h) => {
      const set = by.get(h.id) ?? new Set<string>();
      return { h, s: streak(h.cadence, set, td), dots: week.map((d) => ({ d, on: set.has(d), due: isDue(h.cadence, d) })) };
    });
  });
  const archived = $derived(habits.value.filter((h) => h.archived));

  let adding = $state(false);
  let editing = $state<Habit | null>(null);
  let name = $state('');
  let cadence = $state<Cadence>('daily');

  function openAdd() { name = ''; cadence = 'daily'; adding = true; }
  async function add() {
    if (!name.trim()) return;
    await habitsApi.add(name, cadence);
    adding = false;
  }
  function openEdit(h: Habit) { name = h.name; cadence = h.cadence; editing = h; }
  async function saveEdit() {
    if (editing && name.trim()) await habitsApi.update(editing.id, { name: name.trim().slice(0, 30), cadence });
    editing = null;
  }
  async function archive(on: boolean) { if (editing) await habitsApi.update(editing.id, { archived: on ? 1 : 0 }); editing = null; }
  async function remove() { if (editing) await habitsApi.remove(editing.id); editing = null; }
  async function toggle(r: Row) {
    if (r.s.doneToday) await habitsApi.uncheck(r.h.id, td);
    else await habitsApi.check(r.h, td, 'manual');
  }

  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let pressed = false;
  function pressStart(h: Habit) { pressed = false; pressTimer = setTimeout(() => { pressed = true; openEdit(h); }, 450); }
  function pressEnd() { clearTimeout(pressTimer); }
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
</script>

<NavBar title="习惯" large back="桌面">
  {#snippet right()}
    <button class="iconbtn" onclick={openAdd} aria-label="加一件想坚持的事"><Glyph paths={icons.plus} size={24} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>

{#if rows.length === 0 && archived.length === 0}
  <Placeholder title="还没有想坚持的事" body="右上角 + 加一件，或者直接跟他说「我想每天跑步」。做了就打卡，他会记得连续天数，晚上没打他会问一句。" paths={HABIT_ICON.paths} />
{:else}
  <div class="cards">
    {#each rows as r (r.h.id)}
      <div class="habit" role="listitem" onpointerdown={() => pressStart(r.h)} onpointerup={pressEnd} onpointerleave={pressEnd} onpointercancel={pressEnd} oncontextmenu={(e) => { e.preventDefault(); openEdit(r.h); }}>
        <div class="head">
          <div class="t">
            <div class="name">{r.h.name}</div>
            <div class="meta">{CADENCE_LABEL[r.h.cadence]}{r.s.dueToday || r.s.donePeriod ? '' : ' · 今天休息'}</div>
          </div>
          <div class="streak"><span class="n">{r.s.count}</span><span class="u">{r.s.unit === '周' ? '周' : '天'}</span></div>
        </div>
        <div class="dots" aria-label="最近 7 天">
          {#each r.dots as dot (dot.d)}
            <div class="dot" class:on={dot.on} class:rest={!dot.due && !dot.on} class:today={dot.d === td}><span class="wd">{WD[dow(dot.d)]}</span><span class="pip"></span></div>
          {/each}
        </div>
        <button class="check" class:done={r.s.doneToday} onclick={() => { if (!pressed) toggle(r); }} aria-pressed={r.s.doneToday}>
          {#if r.s.doneToday}<Glyph paths={icons.check} size={18} width={2.6} /> 今天已打卡{:else}今天打卡{/if}
        </button>
      </div>
    {/each}
  </div>
  {#if archived.length}
    <p class="section">已归档</p>
    <List footer="长按一张卡可以改名、换频率或归档。">
      {#each archived as h (h.id)}<Cell title={h.name} subtitle={CADENCE_LABEL[h.cadence]} value="已归档" onclick={() => openEdit(h)} />{/each}
    </List>
  {:else}
    <p class="hint">长按一张卡可以改名、换频率或归档。</p>
  {/if}
{/if}
<div style="height:40px"></div>

<Sheet bind:open={adding} title="想坚持什么">
  <List footer="名字短一点，他聊天时好认：跑步、早睡、背单词。">
    <Field label="名字" bind:value={name} placeholder="跑步" />
  </List>
  <p class="section">频率</p>
  <List>
    {#each CADENCES as c (c)}
      <Cell title={CADENCE_LABEL[c]} subtitle={c === 'daily' ? '每天一次' : c === 'weekdays' ? '周一到周五，周末不算断' : '一周打一次就算坚持'} value={cadence === c ? '✓' : ''} onclick={() => (cadence = c)} />
    {/each}
  </List>
  <div class="actions"><Button onclick={add} disabled={!name.trim()}>加上</Button></div>
</Sheet>

<Sheet open={!!editing} onclose={() => (editing = null)} title={editing?.name ?? ''}>
  {#if editing}
    <List>
      <Field label="名字" bind:value={name} />
    </List>
    <p class="section">频率</p>
    <List>
      {#each CADENCES as c (c)}
        <Cell title={CADENCE_LABEL[c]} value={cadence === c ? '✓' : ''} onclick={() => (cadence = c)} />
      {/each}
    </List>
    <div class="actions">
      <Button onclick={saveEdit} disabled={!name.trim()}>保存</Button>
      <Button kind="plain" onclick={() => archive(!editing!.archived)}>{editing.archived ? '恢复' : '归档（保留记录）'}</Button>
      <Button kind="plain" onclick={remove}><span style="color:var(--red)">删除，连打卡记录一起</span></Button>
    </div>
  {/if}
</Sheet>

<style>
  .iconbtn { padding: 8px; display: inline-flex; }
  .cards { display: flex; flex-direction: column; gap: 12px; padding: 8px 16px 0; }
  .habit { background: var(--bg-surface); border-radius: var(--radius-cell); padding: 14px 16px 12px; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
  .head { display: flex; align-items: flex-start; gap: 12px; }
  .t { flex: 1; min-width: 0; }
  .name { font-size: 17px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { font-size: 13px; color: var(--label-2); margin-top: 2px; }
  .streak { display: flex; align-items: baseline; gap: 3px; color: var(--tint); }
  .n { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
  .u { font-size: 13px; color: var(--label-2); }
  .dots { display: flex; justify-content: space-between; margin: 12px 4px 12px; }
  .dot { display: flex; flex-direction: column; align-items: center; gap: 5px; }
  .wd { font-size: 11px; color: var(--label-3); }
  .pip { width: 22px; height: 22px; border-radius: 50%; background: var(--fill-2); }
  .dot.on .pip { background: linear-gradient(180deg, #5df777 0%, #11c036 100%); }
  .dot.rest .pip { background: transparent; border: 1px dashed var(--separator); box-sizing: border-box; }
  .dot.today .wd { color: var(--tint); font-weight: 600; }
  .check { width: 100%; padding: 11px; border-radius: 10px; font-size: 16px; font-weight: 600; background: var(--tint); color: var(--tint-fg); display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  .check:active { opacity: 0.7; }
  .check.done { background: color-mix(in srgb, var(--tint) 15%, transparent); color: var(--tint); }
  .section { font-size: 13px; color: var(--label-2); margin: 22px 32px 7px; }
  .hint { font-size: 13px; color: var(--label-2); margin: 10px 32px 0; }
  .actions { display: flex; flex-direction: column; gap: 6px; margin: 12px 16px 0; align-items: center; }
</style>
