<script lang="ts">
  /** 聊天里的纪念日卡。body 是记下那一刻的快照 {id, title, kind, label, days?, date?, nth?}；点卡片进纪念日界面。 */
  import { nav, Glyph } from '$kernel/api';
  import { ICON } from './index';
  import { daysText, KIND_LABEL, type Kind } from './dates';
  let { body }: { body: string; attrs?: Record<string, string> } = $props();
  const d = $derived.by((): { title: string; kind: Kind; label: string; days?: number; nth?: string } => {
    try {
      const o = JSON.parse(body);
      return { title: String(o.title ?? '日子'), kind: (o.kind ?? 'anniversary') as Kind, label: String(o.label ?? ''), ...(typeof o.days === 'number' ? { days: o.days } : {}), ...(o.nth ? { nth: String(o.nth) } : {}) };
    } catch { return { title: '日子', kind: 'anniversary', label: '' }; }
  });
</script>

<button class="card" onclick={() => nav.push('dates', 'app')}>
  <span class="mark"><Glyph paths={ICON.paths} size={20} color="#fff" width={1.8} /></span>
  <span class="t">
    <span class="name">{d.title}</span>
    <span class="when">{d.days === undefined ? d.label : daysText(d.days)}{d.nth ? ` · ${d.nth}` : ''}</span>
  </span>
  <span class="tag">{KIND_LABEL[d.kind] ?? '纪念日'}</span>
</button>

<style>
  .card { display: flex; align-items: center; gap: 12px; width: 230px; padding: 12px 14px; border-radius: 12px; background: var(--bg-surface); border: 0.5px solid var(--separator); color: var(--label); text-align: left; }
  .mark { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(180deg, #ff6b9d 0%, #e8275b 100%); display: grid; place-items: center; flex: 0 0 auto; }
  .t { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .when { font-size: 13px; color: var(--label-2); margin-top: 2px; }
  .tag { font-size: 11px; color: var(--label-3); align-self: flex-start; }
</style>
