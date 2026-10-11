<script lang="ts">
  import { NavBar, List, Cell, Field, SectionTitle, Button, Avatar, Sheet, Toggle, Glyph, icons } from '$kernel/api';
  import { canSpeak, loadVoices, pickVoice, sortVoicesForPicker, voiceLabel, Speaker, type VoicePref, type VoiceLike } from '$kernel/api';
  import { onDestroy } from 'svelte';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { repo } from '$kernel/data/repo';
  import { nav } from '$kernel/nav/nav.svelte';

  let { id }: { id: string } = $props();
  const c = live(() => db().characters.get(id), undefined);
  let name = $state(''), core = $state(''), full = $state(''), firstMessage = $state('');
  let useFirst = $state(false);
  let loaded = $state(false);
  let confirmDelete = $state(false);
  $effect(() => {
    const v = c.value;
    if (v && !loaded) { name = v.name; core = v.core; full = v.full; firstMessage = v.firstMessage ?? ''; useFirst = !!v.useFirstMessage; loaded = true; }
  });
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => repo.updateCharacter(id, { name: name.trim() || '未命名', core, full, firstMessage: firstMessage || undefined, useFirstMessage: useFirst }), 400);
  }
  // 朗读音色：存人设卡 voice 字段。没有 speechSynthesis 的浏览器整段不显示
  const speakable = canSpeak();
  let voice = $state<VoicePref>({});
  let voices = $state<VoiceLike[]>([]);
  let pickVoiceOpen = $state(false);
  let previewing = $state(false);
  const speaker = speakable ? new Speaker(speechSynthesis, SpeechSynthesisUtterance, (k) => (previewing = !!k)) : null;
  $effect(() => {
    const v = c.value;
    if (v && speakable && !voicesLoaded) { voicesLoaded = true; voice = (v.voice as VoicePref | undefined) ?? {}; loadVoices(speechSynthesis).then((l) => (voices = sortVoicesForPicker(l))); }
  });
  let voicesLoaded = false;
  const chosen = $derived(voices.length ? pickVoice(voices, voice) : undefined);
  const voiceName = $derived(voice.uri || voice.name ? (chosen ? voiceLabel(chosen) : (voice.name ?? '') + '（这台设备上没有）') : '跟随系统');
  const RATES: { label: string; value: number }[] = [{ label: '慢', value: 0.8 }, { label: '正常', value: 1 }, { label: '快', value: 1.2 }, { label: '很快', value: 1.5 }];
  const rateLabel = $derived(RATES.find((r) => r.value === (voice.rate ?? 1))?.label ?? `${voice.rate}×`);
  function saveVoice(patch: Partial<VoicePref>) {
    voice = { ...voice, ...patch };
    const snap = $state.snapshot(voice);
    return repo.updateCharacter(id, { voice: snap as Record<string, unknown> });
  }
  function chooseVoice(v: VoiceLike | null) {
    void saveVoice(v ? { uri: v.voiceURI, name: v.name, lang: v.lang } : { uri: undefined, name: undefined, lang: undefined });
    pickVoiceOpen = false;
    preview();
  }
  function cycleRate() {
    const i = RATES.findIndex((r) => r.value === (voice.rate ?? 1));
    void saveVoice({ rate: RATES[(i + 1) % RATES.length]!.value });
  }
  function preview() {
    if (!speaker) return;
    if (previewing) { speaker.stop(); return; }
    void speaker.speak('preview', `你好，我是${name || '他'}。今天过得怎么样？`, $state.snapshot(voice));
  }
  onDestroy(() => speaker?.stop());
  async function startChat() {
    const ch = await db().characters.get(id);
    if (!ch) return;
    const conv = await repo.directConversation(ch);
    await nav.home();
    nav.push('chat', 'app');
    nav.push('chat', 'conversation', { id: conv.id });
  }
  async function remove() {
    await repo.deleteCharacter(id);
    nav.pop();
  }
</script>

<NavBar title={name || '人设'} back="返回" />
{#if c.value}
  <div class="hero"><Avatar blob={c.value.avatar} name={name || '?'} size={88} /></div>
  <List>
    <Field label="名字" bind:value={name} placeholder="他叫什么" oninput={save} />
  </List>
  <SectionTitle text="核心设定（常驻上下文）" />
  <List footer="每轮对话都会带上这一段，尽量精炼。更长的背景放到下面的完整设定里，他需要时才会去读。">
    <Field multiline rows={8} bind:value={core} placeholder="他是谁、什么性格、现在的处境" oninput={save} />
  </List>
  <SectionTitle text="完整设定与示例对话" />
  <List>
    <Field multiline rows={6} bind:value={full} placeholder="示例对话、细节背景" oninput={save} />
  </List>
  <SectionTitle text="开场白" />
  <List footer="酒馆卡的开场白多半是为酒馆场景写的，默认不自动发。写了适合手机聊天的再打开。">
    <Field multiline rows={3} bind:value={firstMessage} placeholder="新对话的第一句话" oninput={save} />
    <Cell title="新对话自动发送">{#snippet right()}<Toggle bind:checked={useFirst} onchange={save} label="自动发送开场白" />{/snippet}</Cell>
  </List>
  {#if speakable}
    <SectionTitle text="声音" />
    <List footer={voices.length ? '长按他的消息可以朗读，用的是这台设备自带的声音，不走网络。' : '这台设备没有可用的音色，朗读会用系统默认的声音。'}>
      <Cell title="音色" value={voiceName} chevron onclick={() => (pickVoiceOpen = true)} disabled={!voices.length} />
      <Cell title="语速" value={rateLabel} onclick={cycleRate} />
      <Cell title={previewing ? '停止' : '试听'} onclick={preview}>{#snippet right()}<Glyph paths={previewing ? icons.stopSquare : icons.speaker} size={18} color="var(--tint)" />{/snippet}</Cell>
    </List>
  {/if}
  <div class="actions">
    <Button onclick={startChat}>开始聊天</Button>
    <Button kind="tinted" onclick={() => nav.push('characters', 'profile', { id })}>他的主页</Button>
    <Button kind="plain" onclick={() => (confirmDelete = true)}><span style="color:var(--red)">删除这个人设</span></Button>
  </div>
{/if}
<div style="height:40px"></div>

<Sheet bind:open={pickVoiceOpen} title="音色">
    <List>
      <Cell title="跟随系统" subtitle="这台设备的默认中文声音" onclick={() => chooseVoice(null)}>{#snippet right()}{#if !voice.uri && !voice.name}<Glyph paths={icons.check} size={18} color="var(--tint)" width={2.4} />{/if}{/snippet}</Cell>
      {#each voices as v (v.voiceURI)}
        <Cell title={voiceLabel(v)} subtitle={v.localService ? '本机' : '联网'} onclick={() => chooseVoice(v)}>{#snippet right()}{#if chosen?.voiceURI === v.voiceURI && (voice.uri || voice.name)}<Glyph paths={icons.check} size={18} color="var(--tint)" width={2.4} />{/if}{/snippet}</Cell>
      {/each}
    </List>
</Sheet>

<Sheet bind:open={confirmDelete} title="删除这个人设？">
  <p class="warn">会一起删掉和他的全部对话，不能恢复。记忆、状态和笔记是你的，会留下。</p>
  <div class="actions">
    <Button onclick={remove}><span>删除</span></Button>
    <Button kind="tinted" onclick={() => (confirmDelete = false)}>取消</Button>
  </div>
</Sheet>

<style>
  .hero { display: flex; justify-content: center; padding: 8px 0 18px; }
  .actions { display: flex; flex-direction: column; gap: 10px; margin: 24px 16px 0; align-items: center; }
  .warn { font-size: 15px; color: var(--label-2); margin: 0 24px 8px; text-align: center; }
</style>
