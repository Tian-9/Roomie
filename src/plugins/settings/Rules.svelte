<script lang="ts">
  import { NavBar, List, SectionTitle, Button } from '$kernel/api';
  import { chat } from '$kernel/chat/engine.svelte';
  import { DEFAULT_RULES } from '$kernel/context/assemble';
  let text = $state(chat.rules || DEFAULT_RULES);
  let t: ReturnType<typeof setTimeout> | undefined;
  function save() { clearTimeout(t); t = setTimeout(() => chat.setRules(text.trim() === DEFAULT_RULES.trim() ? '' : text), 400); }
  function reset() { text = DEFAULT_RULES; chat.setRules(''); }
</script>

<NavBar title="对话规则" back="设置" />
<SectionTitle text="每轮都在最前面的基础规则" />
<List footer="每轮对话都排在最前面的基础规则，换人设也一样生效。相当于 SillyTavern 预设里的主提示词。">
  <div class="box"><textarea bind:value={text} rows="12" oninput={save} spellcheck="false"></textarea></div>
</List>
<div class="actions"><Button kind="plain" onclick={reset}>恢复默认</Button></div>
<div style="height:40px"></div>

<style>
  .box { padding: 8px 12px; background: var(--bg-surface); }
  textarea { width: 100%; border: 0; outline: 0; background: transparent; font-size: 15px; line-height: 1.5; resize: vertical; }
  .actions { display: flex; justify-content: center; margin: 16px; }
</style>
