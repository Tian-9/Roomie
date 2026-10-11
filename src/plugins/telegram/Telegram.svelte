<script lang="ts">
  /** Telegram 一屏：说明限制、填 Bot Token 和会话、发测试、两个转发开关。 */
  import { onMount } from 'svelte';
  import { NavBar, List, Cell, Field, Toggle, SectionTitle } from '$kernel/api';
  import { telegramApi, DEFAULTS, type TgSettings, type LastSent } from './index';
  import { isValidToken, isValidChatId, maskToken } from './api';

  let s = $state<TgSettings>({ ...DEFAULTS });
  let token = $state('');
  let last = $state<LastSent | null>(null);
  let bot = $state('');
  let busy = $state<'' | 'me' | 'find' | 'test'>('');
  let msg = $state<{ text: string; bad: boolean } | null>(null);
  let ready = $state(false);

  const tokenOk = $derived(isValidToken(token));
  const chatOk = $derived(isValidChatId(s.chatId));
  const when = (t: number) => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

  onMount(async () => {
    [s, token, last] = await Promise.all([telegramApi.settings(), telegramApi.token(), telegramApi.last()]);
    ready = true;
  });

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  function onToken(v: string) {
    token = v;
    bot = '';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { telegramApi.setToken(v).catch((e) => (msg = { text: e instanceof Error ? e.message : String(e), bad: true })); }, 300);
  }
  function onChatId(v: string) {
    s.chatId = v;
    telegramApi.save({ chatId: v.trim(), chatTitle: '' }).then((n) => (s = n));
  }
  async function run(kind: typeof busy, fn: () => Promise<string>) {
    if (busy) return;
    busy = kind; msg = null;
    try { msg = { text: await fn(), bad: false }; }
    catch (e) { msg = { text: e instanceof Error ? e.message : String(e), bad: true }; }
    finally { busy = ''; last = await telegramApi.last(); }
  }
  const checkBot = () => run('me', async () => { const me = await telegramApi.me(); bot = me.username ? '@' + me.username : me.first_name; return `连上了：${bot}`; });
  const find = () => run('find', async () => {
    const r = await telegramApi.discover();
    if (!r) return '还没收到你的消息。先在 Telegram 里打开你的 bot，点开始或随便发一句，再点这里。';
    s = await telegramApi.settings();
    return `找到了：${r.title}`;
  });
  const test = () => run('test', async () => { await telegramApi.test(); return '发出去了，看看手机。'; });
  async function flip(key: 'notices' | 'say', v: boolean) { s = await telegramApi.save({ [key]: v }); }
</script>

<NavBar title="Telegram" back="桌面" />

<SectionTitle text="这是什么" />
<List footer="发消息的是这个页面：Bot API 是普通网络请求，浏览器直接发给 Telegram，不经过任何服务器，Token 只存在这台设备上。但页面全关着就没人发，手机切走一会儿也可能停。最合适的用法是电脑上留一个标签页开着。在 Telegram 里回他，他看不到；要聊，回这里来。">
  <Cell title="他说的话，手机上也收一份" subtitle="到点提醒、他回来时主动说的话，还有你让他「发到 Telegram」的东西" />
</List>

<SectionTitle text="怎么弄" />
<List>
  <Cell title="1. 建一个 Bot" subtitle="Telegram 里找 @BotFather，发 /newbot，起个名字，它会给你一串 Token" />
  <Cell title="2. 给你的 Bot 发一句话" subtitle="随便发什么，这样它才允许给你发消息，也才能在下面找到你" />
  <Cell title="3. 发一条测试" subtitle="收到了就行；没收到看下面的提示" />
</List>

<SectionTitle text="Bot" />
<List footer={ready && token && !tokenOk ? 'Token 的样子不对，应该像 123456789:AAH…，从 @BotFather 那条消息里整段复制。' : '和 API Key 放在一起保管：开了锁屏就一起加密，备份里也跟着走。'}>
  <Field label="Bot Token" type="password" value={token} placeholder="123456789:AAH…" oninput={onToken} />
  <Cell title={busy === 'me' ? '检查中…' : bot ? `已连上 ${bot}` : '检查 Token'} subtitle={token && !bot ? maskToken(token) : undefined} disabled={!tokenOk} onclick={tokenOk && busy !== 'me' ? checkBot : undefined} />
</List>

<SectionTitle text="发给谁" />
<List footer="chat id 是 Telegram 里你这个人的编号。给 Bot 发过一句话之后点「找到我」会自动填上；也可以手填（群是负数，频道可以写 @名字）。">
  <Field label="chat id" value={s.chatId} placeholder="点下面自动找，或手填数字" oninput={onChatId} />
  <Cell title={busy === 'find' ? '找着呢…' : s.chatTitle ? `找到了：${s.chatTitle}` : '找到我'} subtitle={s.chatTitle ? s.chatId : undefined} disabled={!tokenOk} onclick={tokenOk && busy !== 'find' ? find : undefined} />
  <Cell title={busy === 'test' ? '发送中…' : '发一条测试'} disabled={!tokenOk || !chatOk} onclick={tokenOk && chatOk && busy !== 'test' ? test : undefined} />
</List>
{#if msg}<p class="result" class:bad={msg.bad}>{msg.text}</p>{/if}

<SectionTitle text="发什么" />
<List footer="都只在页面开着的时候发。他回复你消息的内容不会转发，那是你们在这里聊的。">
  <Cell title="到点提醒" subtitle="日程到点、各处弹出来的提醒条">{#snippet right()}<Toggle checked={s.notices} label="到点提醒" onchange={(v) => flip('notices', v)} />{/snippet}</Cell>
  <Cell title="他回来时说的话" subtitle="你离开一阵再打开，他主动说的那一整段">{#snippet right()}<Toggle checked={s.say} label="他回来时说的话" onchange={(v) => flip('say', v)} />{/snippet}</Cell>
</List>

{#if last}
  <SectionTitle text="最近一次" />
  <List footer={last.ok ? undefined : last.error}>
    <Cell title={last.ok ? '发出去了' : '没发出去'} subtitle={last.text} value={when(last.at)} />
  </List>
{/if}
<div style="height:40px"></div>

<style>
  .result { margin: 8px 32px 0; font-size: 13px; color: var(--green); }
  .result.bad { color: var(--red); }
</style>
