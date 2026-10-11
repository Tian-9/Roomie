<script lang="ts">
  /** 锁屏与 Key 加密：设 PIN、改 PIN、多久后重新锁、忘了 PIN 的出路。 */
  import { NavBar, List, Cell, SectionTitle, Sheet, Button, PinPad, Toggle, Glyph, icons } from '$kernel/api';
  import { lock, IDLE_OPTIONS } from '$kernel/lock/lock.svelte';
  import { llm } from '$kernel/llm/gateway.svelte';
  import { isValidPin, WrongPinError } from '$kernel/lock/crypto';

  type Flow = 'set' | 'off' | 'change' | 'reset';
  let flow = $state<Flow | null>(null);
  /** 流程里的第几步：set 是 输入→确认；change 是 旧→新→确认；off 只有一步 */
  let step = $state(0);
  let pin = $state('');
  let first = $state('');
  let old = $state('');
  let error = $state('');
  let busy = $state(false);

  function start(f: Flow) { flow = f; step = 0; pin = ''; first = ''; old = ''; error = ''; }
  function close() { flow = null; }
  const idleLabel = $derived(IDLE_OPTIONS.find((o) => o.minutes === lock.idleMinutes)?.label ?? `${lock.idleMinutes} 分钟`);

  const title = $derived.by(() => {
    if (flow === 'set') return step === 0 ? '设一个 PIN' : '再输一遍';
    if (flow === 'off') return '输入 PIN 关掉锁屏';
    if (flow === 'change') return step === 0 ? '先输现在的 PIN' : step === 1 ? '新 PIN' : '再输一遍新 PIN';
    return '';
  });
  const canNext = $derived(flow === 'off' || (flow === 'change' && step === 0) ? pin.length >= 4 : isValidPin(pin));

  async function run(fn: () => Promise<void>) {
    busy = true; error = '';
    try { await fn(); }
    catch (e) { error = e instanceof WrongPinError ? 'PIN 不对' : e instanceof Error ? e.message : String(e); pin = ''; }
    finally { busy = false; }
  }

  async function next() {
    if (!canNext || busy) return;
    if (flow === 'set') {
      if (step === 0) { first = pin; pin = ''; step = 1; return; }
      if (pin !== first) { error = '两次输的不一样，再来一次'; pin = ''; first = ''; step = 0; return; }
      await run(async () => { await lock.enable(pin); close(); });
    } else if (flow === 'off') {
      await run(async () => { await lock.disable(pin); close(); });
    } else if (flow === 'change') {
      if (step === 0) {
        await run(async () => {
          if (!(await lock.verify(pin))) throw new WrongPinError();
          old = pin; pin = ''; step = 1;
        });
        return;
      }
      if (step === 1) { first = pin; pin = ''; step = 2; return; }
      if (pin !== first) { error = '两次输的不一样，再来一次'; pin = ''; first = ''; step = 1; return; }
      await run(async () => { await lock.changePin(old, pin); close(); });
    }
  }
  async function reset() { await run(async () => { await lock.reset(); close(); }); }
</script>

<NavBar title="锁屏与 Key 加密" back="设置" />
<SectionTitle text="锁屏" />
<List footer={lock.enabled
  ? `打开和从后台回来超过设定时间都要输 PIN。API Key 用这个 PIN 加密后存放，浏览器的数据库里看不到明文；PIN 本身不存，刷新页面要重输。`
  : `开了之后打开要输 PIN，API Key 会用 PIN 加密后存放，浏览器的数据库里看不到明文。${llm.settings.apiKey ? '' : '还没填 Key 也可以先开，之后填的 Key 会直接加密存。'}`}>
  <Cell title="锁屏">{#snippet right()}<Toggle checked={lock.enabled} label="锁屏" onchange={(v) => start(v ? 'set' : 'off')} />{/snippet}</Cell>
  {#if lock.enabled}
    <Cell title="修改 PIN" chevron onclick={() => start('change')} />
    <Cell title="立即锁定" onclick={() => lock.lockNow()} />
  {/if}
</List>

{#if lock.enabled}
  <SectionTitle text="从后台回来多久后要重新输" />
  <List footer="切到别的应用再回来，离开超过这个时间就锁。「只在打开时」是只有刷新或重新打开才锁。">
    {#each IDLE_OPTIONS as o (o.minutes)}
      <Cell title={o.label} onclick={() => lock.setIdle(o.minutes)}>
        {#snippet right()}{#if lock.idleMinutes === o.minutes}<Glyph paths={icons.check} size={20} color="var(--tint)" width={2.6} />{/if}{/snippet}
      </Cell>
    {/each}
  </List>

  <SectionTitle text="忘了 PIN" />
  <List footer="PIN 不存在任何地方，忘了就解不开 Key。出路是把 Key 清掉重新填，锁屏关掉；对话、记忆和其他数据一样不动。">
    <Cell title="清除 Key，重新填" onclick={() => start('reset')} />
  </List>
{/if}

<SectionTitle text="它能挡什么" />
<p class="limits">4 到 6 位数字只有一百万种组合。它防的是手机借人、浏览器被翻这类随手翻看：锁屏盖住对话，Key 不是明文。拿到这台设备肯下功夫的人，离线穷举 PIN 是几小时的事，所以它是一道门，不是保险箱。对话内容本身不加密，只是被锁屏遮住；导出的备份里对话也是明文。连错 5 次要等 30 秒，但刷新页面就清零。</p>

<Sheet open={!!flow && flow !== 'reset'} onclose={close} {title}>
  {#if flow && flow !== 'reset'}
    <PinPad bind:value={pin} active={true} {error} onenter={next} />
    <p class="hint">{flow === 'set' || (flow === 'change' && step >= 1) ? '4 到 6 位数字' : ' '}</p>
    <div class="btns">
      <Button onclick={next} disabled={!canNext || busy}>{busy ? '请稍等……' : flow === 'off' ? '关掉锁屏' : (flow === 'set' && step === 1) || (flow === 'change' && step === 2) ? '完成' : '下一步'}</Button>
      <Button kind="plain" onclick={close}>取消</Button>
    </div>
  {/if}
</Sheet>

<Sheet open={flow === 'reset'} onclose={close} title="清除 Key">
  <p class="warn">会把 API Key 清掉并关闭锁屏，之后要重新填 Key。对话、记忆、笔记和插件数据都不动。</p>
  <div class="btns">
    <Button onclick={reset} disabled={busy}>{busy ? '请稍等……' : '清除 Key 并关掉锁屏'}</Button>
    <Button kind="plain" onclick={close}>取消</Button>
  </div>
</Sheet>
<div style="height:40px"></div>

<style>
  .limits { margin: 0 32px; font-size: 13px; color: var(--label-2); line-height: 1.45; }
  .hint { margin: 0 16px; text-align: center; font-size: 13px; color: var(--label-2); }
  .warn { margin: 8px 16px 0; font-size: 14px; color: var(--label); line-height: 1.45; }
  .btns { display: flex; flex-direction: column; align-items: center; gap: 4px; margin: 12px 16px 0; }
</style>
