<script lang="ts">
  /** 「+」面板 → 记个日程：你自己记一条，发出去是一张日程卡 */
  import type { ComposerActionProps } from '$kernel/api';
  import EventForm from './EventForm.svelte';
  import { scheduleApi, alt } from './index';
  import { whenLabel } from './dates';
  let { onsend, onclose }: ComposerActionProps = $props();
  async function save(v: { title: string; date: string; time: string | null }) {
    const item = await scheduleApi.add({ ...v, source: 'manual' });
    onsend({ text: `[记了一条日程：${whenLabel(item.date, item.time)} ${item.title}]`, cards: [{ tag: 'event', body: JSON.stringify({ id: item.id }), alt: alt(item) }], cardOnly: true });
  }
</script>

<EventForm onsave={save} oncancel={onclose} />
