<script lang="ts">
  /**
   * 数字键盘 + 圆点：锁屏页和设置里设 PIN 都用它。
   * 给了 length 就显示固定个数的点、凑够自动 onfull；没给就按已输入的位数显示（最多 max 位），由外面放"下一步"。
   * active 时也接物理键盘的数字 / 退格 / 回车。
   */
  import type { Snippet } from 'svelte';
  let { value = $bindable(''), length, max = 6, active = true, error = '', onfull, onenter, corner }: {
    value?: string; length?: number; max?: number; active?: boolean; error?: string;
    onfull?: (pin: string) => void; onenter?: (pin: string) => void; corner?: Snippet;
  } = $props();
  const limit = $derived(length ?? max);
  const slots = $derived(length ?? Math.max(4, value.length));
  let shaking = $state(false);
  $effect(() => { if (error) { shaking = true; const t = setTimeout(() => (shaking = false), 450); return () => clearTimeout(t); } });

  function press(d: string) {
    if (value.length >= limit) return;
    value += d;
    if (length && value.length === length) onfull?.(value);
  }
  function back() { value = value.slice(0, -1); }
  function onkey(e: KeyboardEvent) {
    if (!active) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); back(); }
    else if (e.key === 'Enter') { e.preventDefault(); onenter?.(value); }
  }
</script>

<svelte:window onkeydown={onkey} />

<div class="pinpad" data-testid="pinpad">
  <div class="dots" class:shake={shaking} aria-label={`已输入 ${value.length} 位`}>
    {#each Array.from({ length: slots }) as _, i (i)}
      <span class="dot" class:on={i < value.length}></span>
    {/each}
  </div>
  <div class="msg" class:err={!!error}>{error || ' '}</div>
  <div class="keys">
    {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as d (d)}
      <button class="key" onclick={() => press(d)} aria-label={d}>{d}</button>
    {/each}
    <div class="key soft">{#if corner}{@render corner()}{/if}</div>
    <button class="key" onclick={() => press('0')} aria-label="0">0</button>
    <button class="key soft" onclick={back} aria-label="退格" disabled={!value.length}>⌫</button>
  </div>
</div>

<style>
  .pinpad { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 16px; }
  .dots { display: flex; gap: 14px; height: 20px; align-items: center; }
  .dot { width: 13px; height: 13px; border-radius: 50%; border: 1.5px solid var(--label); opacity: 0.85; transition: background 0.12s; }
  .dot.on { background: var(--label); }
  .shake { animation: shake 0.45s; }
  @keyframes shake { 0%, 100% { transform: translateX(0) } 20% { transform: translateX(-10px) } 40% { transform: translateX(10px) } 60% { transform: translateX(-6px) } 80% { transform: translateX(6px) } }
  .msg { font-size: 13px; color: var(--label-2); min-height: 18px; text-align: center; }
  .msg.err { color: var(--red); }
  .keys { display: grid; grid-template-columns: repeat(3, 72px); gap: 14px 22px; margin-top: 10px; }
  .key { width: 72px; height: 72px; border-radius: 50%; background: var(--fill); font-size: 28px; font-weight: 400; display: flex; align-items: center; justify-content: center; transition: background 0.1s; user-select: none; }
  .key:active { background: var(--label-3); }
  .key:disabled { opacity: 0.35; }
  .key.soft { background: transparent; font-size: 17px; }
  .key.soft:active { background: var(--fill-2); }
</style>
