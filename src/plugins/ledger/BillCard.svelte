<script lang="ts">
  /** 聊天里的账单卡。body 是 {id}，attrs 里带一份快照：那笔删了也还能显示，只是标「已删」 */
  import { live } from '$kernel/api';
  import { ledgerApi } from './index';
  import { yuan, type Entry } from './ledger';
  let { body, attrs = {} }: { body: string; attrs?: Record<string, string> } = $props();
  const id = $derived.by(() => { try { return String(JSON.parse(body).id ?? ''); } catch { return ''; } });
  // undefined = 还没查到，null = 查了没有（删了）
  const row = live(async () => (await ledgerApi.entries().get(id)) ?? null, undefined as Entry | null | undefined, () => [id]);
  const e = $derived(row.value ?? undefined);
  const amount = $derived(e ? e.amount : Number(attrs.amount) || 0);
  const category = $derived(e?.category ?? attrs.category ?? '其他');
  const note = $derived(e?.note ?? attrs.note ?? '');
  const date = $derived(e?.date ?? attrs.date ?? '');
  const gone = $derived(row.value === null);
</script>

<div class="bill" class:gone>
  <div class="top">
    <span class="tag">{category}</span>
    <span class="amt">{yuan(amount)}</span>
  </div>
  <div class="sub">{note || category}{date ? ' · ' + date.slice(5).replace('-', '/') : ''}{gone ? ' · 已删' : ''}</div>
  <div class="foot">账本</div>
</div>

<style>
  .bill { width: 230px; border-radius: 10px; overflow: hidden; text-align: left; background: #2db66c; color: #fff; }
  .bill.gone { background: #a9d9bd; }
  .top { display: flex; align-items: baseline; justify-content: space-between; padding: 12px 12px 2px; }
  .tag { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.25); }
  .amt { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .sub { font-size: 12px; opacity: 0.9; padding: 0 12px 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .foot { font-size: 11px; padding: 5px 12px; background: rgba(255,255,255,0.18); }
</style>
