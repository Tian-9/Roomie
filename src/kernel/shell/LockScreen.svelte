<script lang="ts">
  /** 锁屏：开了 PIN 之后，打开和从后台回来都盖在最上面，解锁才能用。 */
  import { lock } from '../lock/lock.svelte';
  import { nav } from '../nav/nav.svelte';
  import PinPad from '../ui/PinPad.svelte';
  import Button from '../ui/Button.svelte';
  import Glyph from '../ui/Glyph.svelte';
  import { icons } from '../ui/icons';

  let pin = $state('');
  let error = $state('');
  let busy = $state(false);
  let forgot = $state(false);
  let now = $state(Date.now());
  const show = $derived(lock.enabled && lock.locked);
  const cooling = $derived(lock.cooldownUntil > now);
  const remain = $derived(Math.max(0, Math.ceil((lock.cooldownUntil - now) / 1000)));
  // 冷却倒计时要走表
  $effect(() => { if (!show) return; const t = setInterval(() => (now = Date.now()), 500); return () => clearInterval(t); });
  // 每次锁上都从空白开始
  $effect(() => { if (show) { pin = ''; error = ''; forgot = false; } });

  async function submit(p: string) {
    if (busy || cooling) { pin = ''; return; }
    busy = true;
    try { await lock.unlock(p); pin = ''; error = ''; }
    catch (e) { error = e instanceof Error ? e.message : String(e); pin = ''; }
    finally { busy = false; }
  }
  async function reset() {
    busy = true;
    try { await lock.reset(); await nav.home(); nav.push('settings', 'api'); }
    finally { busy = false; forgot = false; }
  }
</script>

{#if show}
  <div class="lock" data-testid="lock-screen" role="dialog" aria-label="输入 PIN">
    <div class="top">
      <div class="badge"><Glyph paths={icons.lock} size={30} color="var(--label)" width={1.8} /></div>
      <h1>输入 PIN</h1>
      <p>{cooling ? `错太多次了，${remain} 秒后再试` : busy ? '正在核对……' : '解锁后才能聊天'}</p>
    </div>
    {#if forgot}
      <div class="forgot">
        <p>忘了 PIN 只能把 API Key 清掉重新填，锁屏也会关掉。对话、记忆和其他数据都不会丢。</p>
        <Button onclick={reset} disabled={busy}>清除 Key 并解锁</Button>
        <Button kind="plain" onclick={() => (forgot = false)}>取消</Button>
      </div>
    {:else}
      <PinPad bind:value={pin} length={lock.pinLength} active={show && !busy} {error} onfull={submit}>
        {#snippet corner()}<button class="link" onclick={() => (forgot = true)}>忘了？</button>{/snippet}
      </PinPad>
    {/if}
  </div>
{/if}

<style>
  .lock { position: absolute; inset: 0; z-index: 90; background: var(--bg-grouped); color: var(--label); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; padding: calc(var(--safe-top) + 16px) 16px calc(var(--safe-bottom) + 24px); }
  .top { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .badge { width: 56px; height: 56px; border-radius: 50%; background: var(--fill); display: flex; align-items: center; justify-content: center; margin-bottom: 6px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0; }
  p { margin: 0; font-size: 14px; color: var(--label-2); text-align: center; line-height: 1.45; }
  .forgot { display: flex; flex-direction: column; align-items: center; gap: 10px; max-width: 320px; }
  .forgot p { margin-bottom: 6px; }
  .link { font-size: 15px; color: var(--tint); padding: 8px; }
</style>
