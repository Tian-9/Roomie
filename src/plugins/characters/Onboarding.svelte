<script lang="ts">
  /**
   * 首次引导，三步：1 选他是谁（内置三张 / 一句话生成 / 导入人设卡）→ 2 填 API Key → 3 他开口自我介绍、问三个问题。
   * 答案写进 kernel.userName / kernel.userProfile，整段对话写进和他的私聊，结束直接落在对话里。
   * characters 为空时由插件 setup 推上来；空状态页也能手动进。
   */
  import { NavBar, List, Cell, Field, SectionTitle, Button, Avatar, Glyph, icons } from '$kernel/api';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import type { Character } from '$kernel/storage/db';
  import { repo } from '$kernel/data/repo';
  import { nav } from '$kernel/nav/nav.svelte';
  import { llm } from '$kernel/llm/gateway.svelte';
  import { chat } from '$kernel/chat/engine.svelte';
  import { bus } from '$kernel/bus/bus';
  import { log } from '$kernel/log/log';
  import { CONSOLIDATE_MODEL } from '$kernel/memory/consolidate';
  import { parseCardFile, extractCardFromPng } from '$kernel/importers/charaCard';
  import { tick } from 'svelte';
  import { PRESETS } from './presets';
  import { PERSONA_SCHEMA, PERSONA_SYSTEM, parsePersona, OPENER_SCHEMA, openerSystem, defaultOpener, parseOpener, cleanName, buildProfile, type Opener } from './onboarding';

  let step = $state<1 | 2 | 3>(1);

  // ---- 第一步：他是谁 ----
  let presetId = $state<string | null>(PRESETS[0]!.id);
  let describing = $state(false);
  let description = $state('');
  let more = $state(false);
  let fileInput = $state<HTMLInputElement>();
  let importing = $state(false);
  // 导入走检查页，入库后回到这里：有卡了就直接用它进第二步
  const chars = live(() => db().characters.orderBy('name').toArray(), [] as Character[]);
  let character = $state<Character | null>(null);
  $effect(() => {
    if (step === 1 && !character && chars.value.length) { character = chars.value[0]!; step = 2; }
  });
  const canNext1 = $derived(describing ? description.trim().length > 0 : !!presetId);

  async function onFiles(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    importing = true;
    try {
      const card = await parseCardFile(f);
      const isPng = f.type === 'image/png' || f.name.toLowerCase().endsWith('.png');
      const raw = isPng ? extractCardFromPng(new Uint8Array(await f.arrayBuffer())) : JSON.parse(await f.text());
      nav.push('characters', 'inspect', { card, avatar: isPng ? f : undefined, raw });
    } catch (err) {
      bus.emit('notify', { title: '导入失败', body: err instanceof Error ? err.message : String(err) });
    } finally { importing = false; }
  }

  // ---- 第二步：Key ----
  let key = $state(llm.settings.apiKey);
  let testing = $state(false), testResult = $state('');
  let creating = $state(false), createError = $state('');
  async function test() {
    testing = true; testResult = '';
    try { await llm.save({ apiKey: key }); testResult = '连接正常：' + (await llm.ping()); }
    catch (e) { testResult = e instanceof Error ? e.message : String(e); }
    finally { testing = false; }
  }
  // 按描述生成要调模型，没 Key 就不能往下走；选内置的可以先跳过 Key，聊之前再填
  const canNext2 = $derived(!creating && (llm.configured || (!describing && !!presetId) || !!character));

  async function toStep3() {
    if (creating) return;
    creating = true; createError = '';
    try {
      if (!character) {
        if (describing) character = await generate(description.trim());
        else {
          const p = PRESETS.find((x) => x.id === presetId)!;
          character = await repo.createCharacter({ name: p.name, core: p.core, full: p.full });
        }
      }
      await repo.setCurrentCharacter(character.id);
      step = 3;
      await startOpener(character);
    } catch (e) {
      createError = e instanceof Error ? e.message : String(e);
      log.error('onboarding', `建人设失败：${createError}`);
    } finally { creating = false; }
  }
  async function generate(desc: string): Promise<Character> {
    const r = await llm.chat({
      purpose: 'onboarding', model: CONSOLIDATE_MODEL, effort: 'low', maxTokens: 1200, jsonSchema: PERSONA_SCHEMA,
      system: [{ type: 'text', text: PERSONA_SYSTEM }], messages: [{ role: 'user', content: [{ type: 'text', text: desc }] }],
    });
    const p = parsePersona(r.text);
    if (!p) throw new Error('没生成出合用的人设，再试一次或者先选一张内置的');
    return repo.createCharacter({ name: p.name, core: p.core, full: p.full });
  }

  // ---- 第三步：他开口 ----
  type Bubble = { role: 'user' | 'assistant'; text: string };
  let bubbles = $state<Bubble[]>([]);
  let opener = $state<Opener | null>(null);
  let asked = $state(0); // 已问到第几个问题（0..3）
  let answers = $state<string[]>([]);
  let answer = $state('');
  let finishing = $state(false);
  let scroller = $state<HTMLDivElement>();
  let input = $state<HTMLTextAreaElement>();
  $effect(() => { void bubbles.length; tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight })); });

  async function startOpener(ch: Character) {
    let o = defaultOpener(ch.name);
    if (llm.configured) {
      try {
        const r = await llm.chat({
          purpose: 'onboarding', model: CONSOLIDATE_MODEL, effort: 'low', maxTokens: 400, jsonSchema: OPENER_SCHEMA,
          system: [{ type: 'text', text: openerSystem(ch.name, ch.core) }],
          messages: [{ role: 'user', content: [{ type: 'text', text: '（对话开始）' }] }],
        });
        o = parseOpener(r.text, ch.name);
      } catch (e) { log.warn('onboarding', `开场生成失败，用兜底：${e instanceof Error ? e.message : String(e)}`); }
    }
    opener = o;
    bubbles = [{ role: 'assistant', text: o.intro }];
    await pause(500);
    bubbles.push({ role: 'assistant', text: o.questions[0] });
    asked = 1;
    tick().then(() => input?.focus());
  }
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function reply(skip = false) {
    if (!opener || asked === 0 || finishing) return;
    const t = skip ? '' : answer.trim();
    if (!t && !skip) return;
    // 第一个问题（叫你什么）不能跳过
    if (skip && asked === 1) return;
    answer = '';
    answers.push(t);
    if (t) bubbles.push({ role: 'user', text: t });
    if (asked < 3) {
      await pause(350);
      bubbles.push({ role: 'assistant', text: opener.questions[asked]! });
      asked++;
      tick().then(() => input?.focus());
    } else {
      await finish();
    }
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); reply(); }
  }

  /** 名字和画像落库，整段对话写进私聊，最后一句交给他回；然后落在对话里 */
  async function finish() {
    const ch = character; if (!ch) return;
    finishing = true;
    try {
      const name = cleanName(answers[0] ?? '');
      await chat.setUserName(name);
      await chat.setUserProfile(buildProfile({ sleep: answers[1], busy: answers[2] }));
      const conv = await repo.directConversation(ch);
      // 保留顺序：ts 递增，免得同一毫秒里乱序
      let ts = Date.now() - bubbles.length * 2;
      const lastIsUser = bubbles[bubbles.length - 1]?.role === 'user';
      const toWrite = lastIsUser && llm.configured ? bubbles.slice(0, -1) : bubbles;
      for (const b of toWrite) await repo.addMessage(conv.id, b.role, b.text, { ts: ts++, meta: { onboarding: true } });
      await nav.home();
      nav.push('chat', 'app');
      nav.push('chat', 'conversation', { id: conv.id });
      // 最后一个回答由他接着回：他第一句就会叫出你的名字
      if (lastIsUser && llm.configured) chat.send(conv.id, bubbles[bubbles.length - 1]!.text, { meta: { onboarding: true } }).catch((e) => log.error('onboarding', e instanceof Error ? e.message : String(e)));
    } finally { finishing = false; }
  }
</script>

{#if step === 1}
  <NavBar title="第 1 步 / 3" back={null} />
  <h2 class="h">你想让谁住进来？</h2>
  <p class="sub">他会在信息里和你聊天、记你说过的事、顺手帮你记账提醒。先挑一个，以后随时能换，记忆不会丢。</p>
  <List>
    {#each PRESETS as p (p.id)}
      <Cell title={p.name} subtitle={p.tagline} onclick={() => { presetId = p.id; describing = false; }}>
        {#snippet right()}{#if !describing && presetId === p.id}<Glyph paths={icons.check} size={20} color="var(--tint)" width={2.6} />{/if}{/snippet}
      </Cell>
    {/each}
    <Cell title="自己描述一个" subtitle="一句话，比如「一个爱吐槽但靠谱的学姐」" onclick={() => (describing = true)}>
      {#snippet right()}{#if describing}<Glyph paths={icons.check} size={20} color="var(--tint)" width={2.6} />{/if}{/snippet}
    </Cell>
    {#if describing}
      <Field multiline rows={3} bind:value={description} placeholder="我想要一个……的人" />
    {/if}
  </List>
  {#if more}
    <List footer="支持 PNG / JSON 人设卡。导入前会先进检查页，可疑内容删干净再入库。">
      <Cell title={importing ? '读取中…' : '导入人设卡'} chevron onclick={importing ? undefined : () => fileInput?.click()} />
    </List>
    <input type="file" accept=".png,.json,image/png,application/json" bind:this={fileInput} onchange={onFiles} hidden />
  {:else}
    <div class="center"><button class="link" onclick={() => (more = true)}>更多</button></div>
  {/if}
  <div class="actions"><Button onclick={() => (step = 2)} disabled={!canNext1}>下一步</Button></div>

{:else if step === 2}
  <NavBar title="第 2 步 / 3" back={null} />
  <h2 class="h">填一个 API Key</h2>
  <p class="sub">他靠 Anthropic 的模型说话。Key 只存在这台设备的浏览器里，直接从浏览器调用，不经过任何中转。</p>
  <List footer="在 console.anthropic.com 创建。以后在「设置 → API 与模型」里也能改。">
    <Field label="API Key" type="password" bind:value={key} placeholder="sk-ant-…" oninput={(v) => llm.save({ apiKey: v })} />
    <Cell title={testing ? '测试中…' : '测试连接'} onclick={testing || !llm.configured ? undefined : test} disabled={!llm.configured} />
  </List>
  {#if testResult}<p class="result" class:bad={!testResult.startsWith('连接正常')}>{testResult}</p>{/if}
  {#if describing && !character && !llm.configured}<p class="hint">按描述生成人设需要先填 Key。</p>{/if}
  {#if createError}<p class="result bad">{createError}</p>{/if}
  <div class="actions">
    <Button onclick={toStep3} disabled={!canNext2}>{creating ? (describing && !character ? '正在写人设…' : '请稍等…') : llm.configured ? '下一步' : '先跳过'}</Button>
    {#if !character}<Button kind="plain" onclick={() => (step = 1)}>上一步</Button>{/if}
  </div>

{:else}
  <NavBar title="第 3 步 / 3" back={null} />
  {#if character}
    <div class="hero"><Avatar blob={character.avatar} name={character.name} size={64} /><div class="name">{character.name}</div></div>
  {/if}
  <div class="talk" bind:this={scroller}>
    {#if !opener}<p class="typing">正在输入…</p>{/if}
    {#each bubbles as b, i (i)}
      <div class="bubble {b.role}">{b.text}</div>
    {/each}
    {#if finishing}<p class="typing">正在记下来…</p>{/if}
  </div>
  <div class="composer">
    <textarea bind:this={input} bind:value={answer} rows="1" placeholder={asked === 1 ? '你的名字或昵称' : '回他一句'} onkeydown={onKey} disabled={!opener || asked === 0 || finishing}></textarea>
    <button class="send" onclick={() => reply()} disabled={!answer.trim() || !opener || finishing} aria-label="发送"><Glyph paths={icons.check} size={20} color="var(--tint-fg)" width={2.6} /></button>
  </div>
  {#if asked > 1 && !finishing}<div class="center"><button class="link" onclick={() => reply(true)}>这个不想说</button></div>{/if}
{/if}
<div style="height:40px"></div>

<style>
  .h { font-size: 26px; font-weight: 700; margin: 12px 20px 6px; letter-spacing: -0.3px; }
  .sub { margin: 0 20px 18px; font-size: 15px; line-height: 1.5; color: var(--label-2); }
  .actions { display: flex; flex-direction: column; gap: 10px; margin: 24px 16px 0; align-items: center; }
  .center { display: flex; justify-content: center; margin: 12px 16px 0; }
  .link { color: var(--tint); font-size: 16px; padding: 6px 12px; }
  .result { margin: 8px 32px 0; font-size: 13px; color: var(--green); }
  .result.bad { color: var(--red); }
  .hint { margin: 8px 32px 0; font-size: 13px; color: var(--label-2); }
  .hero { display: flex; align-items: center; gap: 12px; padding: 12px 20px 4px; }
  .name { font-size: 18px; font-weight: 600; }
  .talk { flex: 1 1 auto; min-height: 220px; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
  .bubble { max-width: 78%; padding: 9px 13px; border-radius: 18px; font-size: 16px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; animation: pop 0.2s ease-out; }
  .bubble.assistant { align-self: flex-start; background: var(--bg-surface); color: var(--label); border-bottom-left-radius: 6px; }
  .bubble.user { align-self: flex-end; background: var(--tint); color: var(--tint-fg); border-bottom-right-radius: 6px; }
  @keyframes pop { from { opacity: 0; transform: translateY(6px); } }
  .typing { margin: 0; font-size: 13px; color: var(--label-3); }
  .composer { display: flex; align-items: flex-end; gap: 8px; padding: 8px 12px; background: var(--bg-grouped); position: sticky; bottom: 0; }
  textarea { flex: 1; min-width: 0; background: var(--bg-surface); border: 0; outline: 0; border-radius: 18px; padding: 9px 14px; font-size: 16px; line-height: 1.4; color: var(--label); resize: none; max-height: 120px; }
  textarea:disabled { opacity: 0.5; }
  .send { width: 36px; height: 36px; border-radius: 50%; background: var(--tint); display: inline-grid; place-items: center; flex: 0 0 auto; }
  .send:disabled { opacity: 0.35; }
</style>
