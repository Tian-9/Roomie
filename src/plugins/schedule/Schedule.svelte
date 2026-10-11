<script lang="ts">
  /** 日程界面：顶上今天是什么日子，下面过期 / 今天 / 明天 / 以后 / 已完成。勾圆圈完成，点标题看详情。 */
  import { NavBar, Placeholder, Sheet, Button, Glyph, live, icons, nav } from '$kernel/api';
  import { registry } from '$kernel/registry/registry.svelte';
  import { scheduleApi, type ScheduleItem } from './index';
  import { isoDate, addDays, relativeLabel, longDate, weekday, daysBetween, shortDate } from './dates';
  import { dayLine, nextHoliday } from './holidays';
  import EventForm from './EventForm.svelte';

  const today = isoDate();
  const rows = live(() => (registry.isEnabled('schedule') ? scheduleApi.items().toArray() : Promise.resolve([] as ScheduleItem[])), [] as ScheduleItem[]);
  const sorted = $derived([...rows.value].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '99').localeCompare(b.time ?? '99') || a.createdAt - b.createdAt));
  const tomorrow = addDays(today, 1);
  const groups = $derived.by(() => {
    // 订阅来的日历事件过了就过了，不算过期
    const open = sorted.filter((i) => !i.done && (i.date >= today || i.source !== 'calendar'));
    const done = sorted.filter((i) => i.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)).slice(0, 20);
    return [
      { key: 'overdue', label: '过期', items: open.filter((i) => i.date < today) },
      { key: 'today', label: '今天', items: open.filter((i) => i.date === today) },
      { key: 'tomorrow', label: '明天', items: open.filter((i) => i.date === tomorrow) },
      { key: 'later', label: '以后', items: open.filter((i) => i.date > tomorrow) },
      { key: 'done', label: '已完成', items: done },
    ].filter((g) => g.items.length);
  });
  const holiday = nextHoliday(today);
  const holidayLine = $derived.by(() => {
    if (!holiday) return '';
    const d = daysBetween(today, holiday.from);
    if (d <= 0) return `${holiday.name}放假到 ${shortDate(holiday.to)}`;
    return `${holiday.name} ${shortDate(holiday.from)} 起，还有 ${d} 天${holiday.tentative ? '（安排未公布，预估）' : ''}`;
  });

  let adding = $state(false);
  let viewing = $state<ScheduleItem | null>(null);
  // 浏览器通知权限：有带时间的日程、还没问过，才露出这一行
  let perm = $state<NotificationPermission | 'unsupported'>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const askPerm = $derived(perm === 'default' && rows.value.some((i) => i.time && !i.done));
  async function requestPerm() { try { perm = await Notification.requestPermission(); } catch { perm = 'denied'; } }

  async function save(v: { title: string; date: string; time: string | null }) {
    await scheduleApi.add({ ...v, source: 'manual' });
    adding = false;
  }
  async function toggle(i: ScheduleItem) { await scheduleApi.setDone(i.id, !i.done); }
  async function remove() { if (viewing) await scheduleApi.remove(viewing.id); viewing = null; }
  async function toggleViewing() { if (viewing) { await toggle(viewing); viewing = null; } }
  const overdueTime = (i: ScheduleItem) => !i.done && i.date === today && !!i.remindAt && i.remindAt < Date.now() - 30 * 60_000;
  const timeLabel = (i: ScheduleItem) => (i.time ? `${i.time}${i.endTime ? '–' + i.endTime : ''}` : i.allDay ? '全天' : '待办');
  function when(i: ScheduleItem, g: string) {
    if (g === 'today' || g === 'tomorrow') return timeLabel(i);
    return `${relativeLabel(i.date, today)}${i.time ? ' ' + i.time : i.allDay ? ' 全天' : ''}`;
  }
  const sourceLabel = (i: ScheduleItem) => (i.source === 'tool' ? '他记的' : i.source === 'calendar' ? '日历订阅来的，要改去日历里改' : '你记的');
</script>

<NavBar title="日程" large back="桌面">
  {#snippet right()}
    <button class="iconbtn" onclick={() => nav.push('schedule', 'calendars')} aria-label="订阅日历"><Glyph paths={icons.globe} size={22} color="var(--tint)" width={2} /></button>
    <button class="iconbtn" onclick={() => (adding = true)} aria-label="记个日程"><Glyph paths={icons.plus} size={24} color="var(--tint)" width={2.2} /></button>
  {/snippet}
</NavBar>

<div class="head">
  <div class="big">{longDate(today)} <span class="wd">{weekday(today)}</span></div>
  <div class="sub">{dayLine(today)}</div>
  {#if holidayLine}<div class="sub hol">{holidayLine}</div>{/if}
</div>

{#if askPerm}
  <button class="perm" onclick={requestPerm}>开启到点提醒 · 页面开着时到点会弹通知</button>
{/if}

{#if groups.length === 0}
  <Placeholder title="还没有安排" body="在聊天里说「明天下午三点开会」他会记下来；右上角 + 也可以自己记，不填时间就是待办。用 Google 日历的话，右上角地球图标可以把日历订阅进来。" paths={['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4M16 3v4']} />
{:else}
  {#each groups as g (g.key)}
    <div class="section" class:overdue={g.key === 'overdue'} class:finished={g.key === 'done'}>
      <div class="label">{g.label}{g.key === 'overdue' ? ` · ${g.items.length}` : ''}</div>
      <div class="list">
        {#each g.items as i (i.id)}
          <div class="row" class:done={!!i.done} class:late={g.key === 'overdue' || overdueTime(i)}>
            <button class="check" aria-label={i.done ? '取消完成' : '完成'} aria-checked={!!i.done} role="checkbox" onclick={() => toggle(i)}>
              {#if i.done}<Glyph paths={icons.check} size={14} color="#fff" width={3} />{/if}
            </button>
            <button class="main" onclick={() => (viewing = i)}>
              <span class="title">{i.title}</span>
              <span class="when">{when(i, g.key)}{overdueTime(i) ? ' · 过了' : ''}</span>
            </button>
          </div>
        {/each}
      </div>
    </div>
  {/each}
{/if}
<div style="height:40px"></div>

<Sheet bind:open={adding} title="记个日程">
  <EventForm onsave={save} oncancel={() => (adding = false)} />
</Sheet>
<Sheet open={!!viewing} onclose={() => (viewing = null)} title={viewing?.title ?? ''}>
  {#if viewing}
    <p class="detail">{relativeLabel(viewing.date, today)} · {longDate(viewing.date)} {weekday(viewing.date)} · {timeLabel(viewing)}{viewing.done ? ' · 已完成' : ''}</p>
    {#if viewing.place}<p class="detail">{viewing.place}</p>{/if}
    <p class="detail dim">{sourceLabel(viewing)}</p>
    <div class="actions">
      <Button onclick={toggleViewing}>{viewing.done ? '标成没做' : '完成'}</Button>
      <Button kind="plain" onclick={remove}><span style="color:var(--red)">{viewing.source === 'calendar' ? '这里不显示' : '删掉'}</span></Button>
    </div>
  {/if}
</Sheet>

<style>
  .iconbtn { padding: 8px; display: inline-flex; }
  .head { padding: 4px 20px 12px; }
  .big { font-size: 22px; font-weight: 700; }
  .wd { font-size: 15px; font-weight: 500; color: var(--label-2); margin-left: 4px; }
  .sub { font-size: 13px; color: var(--label-2); margin-top: 2px; }
  .hol { color: var(--tint); }
  .perm { display: block; margin: 0 16px 12px; padding: 10px 14px; border-radius: 12px; background: var(--fill-2); font-size: 13px; color: var(--tint); width: calc(100% - 32px); text-align: left; }
  .section { margin-bottom: 18px; }
  .label { padding: 0 20px 6px; font-size: 13px; color: var(--label-2); text-transform: uppercase; }
  .overdue .label { color: var(--red); }
  .list { background: var(--bg-surface); }
  .row { display: flex; align-items: center; gap: 12px; padding: 0 16px; min-height: 48px; position: relative; }
  .row + .row::before { content: ''; position: absolute; top: 0; left: 50px; right: 0; border-top: 0.5px solid var(--separator); }
  .check { flex: 0 0 22px; width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid var(--label-3); display: grid; place-items: center; }
  .done .check { background: var(--green); border-color: var(--green); }
  .main { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 0; text-align: left; color: var(--label); }
  .title { font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .done .title { text-decoration: line-through; color: var(--label-2); }
  .when { font-size: 14px; color: var(--label-2); flex: 0 0 auto; font-variant-numeric: tabular-nums; }
  .late .when { color: var(--red); }
  .finished .row { opacity: 0.7; }
  .detail { margin: 0 24px; font-size: 15px; }
  .dim { color: var(--label-2); font-size: 13px; margin-top: 4px; }
  .actions { display: flex; flex-direction: column; gap: 6px; margin: 16px 16px 0; align-items: center; }
</style>
