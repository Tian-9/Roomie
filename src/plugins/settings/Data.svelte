<script lang="ts">
  /** 数据：整库导出成一个 JSON 文件；导入时先预览，确认后整库替换。 */
  import { NavBar, List, Cell, SectionTitle, Sheet, Button, icons } from '$kernel/api';
  import { gradients } from '$kernel/ui/icons';
  import { live } from '$kernel/storage/live.svelte';
  import { db } from '$kernel/storage/db';
  import { registry } from '$kernel/registry/registry.svelte';
  import { bus } from '$kernel/bus/bus';
  import { log } from '$kernel/log/log';
  import { exportBackup, importBackup, parseBackup, summarizeBackup, backupFileName, type Backup, type BackupSummary } from './backup';

  const counts = live(async () => ({
    characters: await db().characters.count(), messages: await db().messages.count(),
    memories: await db().memories.count(), notes: await db().notes.count(),
  }), { characters: 0, messages: 0, memories: 0, notes: 0 });

  let fileInput: HTMLInputElement;
  let busy = $state<'' | 'export' | 'read' | 'import'>('');
  let pending = $state<{ backup: Backup; summary: BackupSummary; name: string } | null>(null);
  let error = $state('');

  function download(text: string, name: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  async function exportAll() {
    busy = 'export'; error = '';
    try {
      const b = await exportBackup(db());
      download(JSON.stringify(b), backupFileName());
      log.info('backup', '导出全部', { tables: Object.fromEntries(Object.entries(b.tables).map(([k, v]) => [k, v.length])) });
    } catch (e) { error = '导出失败：' + (e instanceof Error ? e.message : String(e)); }
    finally { busy = ''; }
  }
  async function onFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    busy = 'read'; error = '';
    try {
      const backup = parseBackup(await f.text(), db().verno);
      pending = { backup, summary: summarizeBackup(backup, db()), name: f.name };
    } catch (err) { error = err instanceof Error ? err.message : String(err); }
    finally { busy = ''; }
  }
  async function confirmImport() {
    if (!pending) return;
    const { backup, summary } = pending;
    busy = 'import'; error = '';
    try {
      // 后悔药：先把现在的数据下载一份，再清库
      download(JSON.stringify(await exportBackup(db())), backupFileName().replace('.json', '-before-import.json'));
      const res = await importBackup(db(), backup);
      log.info('backup', '导入完成', { written: res.written, skipped: res.skipped, exportedAt: summary.exportedAt });
      pending = null;
      // 内核的设置（API、外观、插件开关、称呼）都是启动时从 kv 读进内存的，整库换掉后只能重启
      bus.emit('notify', { title: '导入完成', body: '正在重新打开……' });
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      error = '导入失败，现有数据没有变：' + (e instanceof Error ? e.message : String(e));
      log.error('backup', '导入失败', { error: String(e) });
      pending = null;
    } finally { busy = ''; }
  }

  const KERNEL_LABELS: Record<string, string> = { home: '当前状态', characters: '人设', conversations: '对话', messages: '消息', memories: '记忆', notes: '笔记', kv: '设置项' };
  /** 把表名翻成人话：内核表按上面的表，插件表按插件名 */
  function label(table: string): string {
    if (KERNEL_LABELS[table]) return KERNEL_LABELS[table];
    for (const p of registry.plugins) {
      for (const t of Object.keys(p.storage?.tables ?? {})) {
        if (`p_${p.id.replace(/-/g, '_')}_${t}` === table) return `${p.name} · ${t}`;
      }
    }
    return table;
  }
  const unit = (table: string) => (table === 'characters' ? '张' : table === 'messages' ? '条' : table === 'notes' ? '篇' : table === 'kv' ? '项' : '条');
  const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false }); };
</script>

<NavBar title="备份与恢复" back="设置" />
<input type="file" accept=".json,application/json" bind:this={fileInput} onchange={onFile} hidden />

<SectionTitle text="现在有" />
<List>
  <Cell title="人设" value={`${counts.value.characters} 张`} />
  <Cell title="消息" value={`${counts.value.messages} 条`} />
  <Cell title="记忆" value={`${counts.value.memories} 条`} />
  <Cell title="笔记" value={`${counts.value.notes} 篇`} />
</List>

<SectionTitle text="备份" />
<List footer="所有数据只在这台设备的浏览器里，清了缓存就没了。导出的是一个 JSON 文件，包含人设（含头像）、对话、记忆、笔记、设置和各插件的数据；API Key 也在里面，别把文件发给别人。日志和用量不导。">
  <Cell title="导出全部" icon={{ paths: icons.receipt, background: gradients.blue }} chevron onclick={exportAll} disabled={!!busy} />
</List>
<List footer="选一个之前导出的文件，先看预览再确认。导入会清空现在的全部数据再写入；确认前会自动先下载一份现在的数据，万一导错了可以再导回来。">
  <Cell title="从备份导入" icon={{ paths: icons.plug, background: gradients.gray }} chevron onclick={() => fileInput.click()} disabled={!!busy} />
</List>
{#if busy === 'export'}<p class="hint">正在打包……</p>{/if}
{#if busy === 'read'}<p class="hint">正在读取文件……</p>{/if}
{#if error}<p class="hint err">{error}</p>{/if}

<Sheet open={!!pending} onclose={() => (pending = null)} title="导入预览">
  {#if pending}
    <List footer={`来自 ${when(pending.summary.exportedAt)} 的备份（${pending.name}）`}>
      {#each Object.entries(pending.summary.counts).filter(([t]) => t !== 'home') as [table, n] (table)}
        <Cell title={label(table)} value={`${n} ${unit(table)}`} />
      {/each}
    </List>
    {#if pending.summary.unknown.length}
      <p class="note">这些数据属于现在没装的插件，会跳过：{pending.summary.unknown.map(label).join('、')}</p>
    {/if}
    {#if pending.summary.missing.length}
      <p class="note">备份里没有这些数据，导入后会是空的：{pending.summary.missing.map(label).join('、')}</p>
    {/if}
    <p class="warn">确认后会清空现在的 {counts.value.messages} 条消息、{counts.value.memories} 条记忆和其他全部数据，换成备份里的，然后重新打开。</p>
    <div class="btns">
      <Button onclick={confirmImport} disabled={busy === 'import'}>{busy === 'import' ? '正在导入……' : '清空并导入'}</Button>
      <Button kind="plain" onclick={() => (pending = null)}>取消</Button>
    </div>
  {/if}
</Sheet>
<div style="height:40px"></div>

<style>
  .hint { margin: 8px 16px 0; text-align: center; font-size: 13px; color: var(--label-2); }
  .err { color: var(--red); text-align: left; }
  .note { margin: 8px 16px 0; font-size: 13px; color: var(--label-2); line-height: 1.4; }
  .warn { margin: 12px 16px 0; font-size: 14px; color: var(--red); line-height: 1.4; }
  .btns { display: flex; flex-direction: column; align-items: center; gap: 4px; margin: 12px 16px 0; }
</style>
