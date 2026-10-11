<script lang="ts">
  /** 「+」面板 → 记一笔：落库后发出去一张账单卡加一句「记一笔：午饭 32 元」 */
  import type { ComposerActionProps } from '$kernel/api';
  import EntryForm from './EntryForm.svelte';
  import { ledgerApi } from './index';
  import { yuan, ymd, type Category } from './ledger';
  let { onsend, onclose }: ComposerActionProps = $props();
  async function submit(v: { amount: number; category: Category; note: string; date: string }) {
    const e = await ledgerApi.add({ ...v, source: 'manual' });
    const what = `${e.note || e.category} ${yuan(e.amount)}`;
    onsend({
      text: `记一笔：${what}${e.date === ymd() ? '' : '，' + e.date}（分类 ${e.category}，已经记进账本了，不用再记）`,
      cards: [{ tag: 'bill', body: JSON.stringify({ id: e.id }), attrs: { amount: String(e.amount), category: e.category, note: e.note, date: e.date }, alt: `[记一笔] ${what}` }],
    });
  }
</script>

<EntryForm submit="记上" onsubmit={submit} oncancel={onclose} />
