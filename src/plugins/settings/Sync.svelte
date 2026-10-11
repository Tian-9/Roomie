<script lang="ts">
  /** 多端同步：填自己的 WebDAV，几台设备之间合并数据；看、恢复、删冲突副本。 */
  import { NavBar, List, Cell, SectionTitle, Sheet, Button, Field, Toggle, icons } from '$kernel/api';
  import { gradients } from '$kernel/ui/icons';
  import { bus } from '$kernel/bus/bus';
  import { lock } from '$kernel/lock/lock.svelte';
  import { sync, type SyncConfig } from './sync.svelte';
  import { summarizeBackup, type Backup, type BackupSummary } from './backup';
  import { db } from '$kernel/storage/db';
  import { registry } from '$kernel/registry/registry.svelte';
  import type { Entry } from './webdav';

  let editing = $state(false);
  let form = $state<SyncConfig>({ ...sync.config });
  let password = $state('');
  let busy = $state<'' | 'test' | 'save' | 'sync' | 'list' | 'read' | 'restore' | 'delete'>('');
  let error = $state('');
  let note = $state('');
  let deviceName = $state(sync.device);

  let conflicts = $state<Entry[] | null>(null);
  let conflictError = $state('');
  let picked = $state<{ entry: Entry; backup: Backup; summary: BackupSummary } | null>(null);
  let confirmForget = $state(false);

  function startEdit() { form = { ...sync.config }; password = ''; error = ''; note = ''; editing = true; }

  async function run(what: typeof busy, fn: () => Promise<void>) {
    busy = what; error = '';
    try { await fn(); }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { busy = ''; }
  }

  const canSave = $derived(form.url.trim().length > 0 && form.username.trim().length > 0 && (password.length > 0 || sync.hasPassword));

  function test() {
    return run('test', async () => {
      const r = await sync.test(form, password);
      note = r.exists ? `连上了，服务器上已经有一份（${r.lastModified ? when(r.lastModified) : '时间未知'}），保存后第一次同步会和它合并` : '连上了，服务器上还没有文件，第一次同步会上传这边的数据';
    });
  }
  function save() {
    return run('save', async () => {
      await sync.save(form, password);
      editing = false; note = '';
      if (lock.enabled) bus.emit('notify', { title: '已保存', body: '密码已和 API Key 一起用 PIN 封好' });
    });
  }
  function syncNow() {
    return run('sync', async () => {
      const o = await sync.now();
      if (o.conflicts) conflicts = null;
    });
  }
  function loadConflicts() {
    return run('list', async () => {
      conflictError = '';
      try { conflicts = await sync.listConflicts(); }
      catch (e) { conflicts = []; conflictError = '列不出来：' + (e instanceof Error ? e.message : String(e)); }
    });
  }
  function open(entry: Entry) {
    return run('read', async () => {
      const backup = await sync.readConflict(entry.name);
      picked = { entry, backup, summary: summarizeBackup(backup, db()) };
    });
  }
  function restore() {
    if (!picked) return;
    const b = picked.backup;
    return run('restore', async () => {
      await sync.restoreConflict(b);
      picked = null;
      bus.emit('notify', { title: '已恢复', body: '换成了这份副本，正在重新打开……' });
      setTimeout(() => location.reload(), 600);
    });
  }
  function remove() {
    if (!picked) return;
    const name = picked.entry.name;
    return run('delete', async () => {
      await sync.deleteConflict(name);
      picked = null;
      conflicts = (conflicts ?? []).filter((e) => e.name !== name);
    });
  }
  async function forget() {
    confirmForget = false;
    await run('save', () => sync.forget());
    conflicts = null;
  }

  const when = (s: string | number) => { const d = new Date(s); return isNaN(d.getTime()) ? String(s) : d.toLocaleString('zh-CN', { hour12: false }); };
  const KERNEL_LABELS: Record<string, string> = { home: '当前状态', characters: '人设', conversations: '对话', messages: '消息', memories: '记忆', notes: '笔记', kv: '设置项' };
  /** 表名翻成人话：内核表按上面的表，插件表按插件名（和备份页一样） */
  function label(table: string): string {
    if (KERNEL_LABELS[table]) return KERNEL_LABELS[table];
    for (const p of registry.plugins) {
      for (const t of Object.keys(p.storage?.tables ?? {})) if (`p_${p.id.replace(/-/g, '_')}_${t}` === table) return `${p.name} · ${t}`;
    }
    return table;
  }
  const status = $derived(sync.running ? '正在同步……' : sync.error ? '上次失败' : sync.lastSyncAt ? (sync.dirty ? '有改动还没推' : '已同步') : '还没同步过');
</script>

<NavBar title="多端同步" back="设置" />

<SectionTitle text="服务器" />
{#if sync.configured && !editing}
  <List footer="数据放在你自己的 WebDAV 上，没有别的服务器。换手机时先在新设备填同一个服务器，第一次同步会把东西拉下来合并。">
    <Cell title="地址" value={sync.config.url} />
    <Cell title="账号" value={sync.config.username} />
    <Cell title="文件夹" value={sync.config.folder} />
    <Cell title="改一下" chevron onclick={startEdit} disabled={!!busy} />
  </List>
{:else}
  <List footer={`要一个支持跨域（CORS）的 WebDAV：自己的 Nextcloud 装上放开跨域的应用、rclone serve webdav、dufs 都行；坚果云不放跨域，网页里连不上。${lock.enabled ? '密码会和 API Key 一起用 PIN 封起来。' : '没开锁屏的话密码明文存在本机。'}`}>
    <Field label="地址" bind:value={form.url} placeholder="https://…/dav/" type="url" />
    <Field label="账号" bind:value={form.username} placeholder="登录名" />
    <Field label="密码" bind:value={password} placeholder={sync.hasPassword ? '不改就留空' : '应用专用密码'} type="password" />
    <Field label="文件夹" bind:value={form.folder} placeholder="roomie" />
  </List>
  <div class="btns">
    <Button onclick={test} disabled={!canSave || !!busy}>{busy === 'test' ? '正在连……' : '试一下'}</Button>
    <Button onclick={save} disabled={!canSave || !!busy}>{busy === 'save' ? '正在保存……' : '保存'}</Button>
    {#if sync.configured}<Button kind="plain" onclick={() => (editing = false)} disabled={!!busy}>取消</Button>{/if}
  </div>
  {#if note}<p class="hint ok">{note}</p>{/if}
{/if}

{#if sync.configured}
  <SectionTitle text="同步" />
  <List footer={`打开、从后台回来、这边改了东西十几秒后都会自动同步一次；两边改了同一处时按时间新的算，输掉的那份留在服务器的 ${sync.config.folder}/conflicts/ 里。${sync.lastSyncAt ? `上次：${when(sync.lastSyncAt)}${sync.lastSummary ? '，' + sync.lastSummary : ''}。` : ''}`}>
    <Cell title="现在同步" value={status} icon={{ paths: icons.transfer, background: gradients.blue }} chevron onclick={syncNow} disabled={!!busy || sync.running} />
    <Cell title="自动同步">
      {#snippet right()}<Toggle checked={sync.config.auto} onchange={(v) => sync.save({ auto: v })} />{/snippet}
    </Cell>
    <Field label="这台设备叫" bind:value={deviceName} placeholder="手机" oninput={(v) => sync.setDevice(v)} />
  </List>
  {#if sync.error && !error}<p class="hint err">{sync.error}</p>{/if}

  <SectionTitle text="冲突副本" />
  <List footer="两台设备都改了同一处时，输掉的那边当时的整份数据会留一份在这里。可以看看里面有什么、整个换回来，或者删掉。">
    {#if conflicts === null}
      <Cell title="看看有没有" chevron onclick={loadConflicts} disabled={!!busy} />
    {:else if conflictError}
      <Cell title={conflictError} />
    {:else if !conflicts.length}
      <Cell title="没有冲突副本" />
    {:else}
      {#each conflicts as e (e.name)}
        <Cell title={e.name.replace(/\.json$/, '')} subtitle={e.lastModified ? when(e.lastModified) : undefined} value={e.size ? `${Math.max(1, Math.round(e.size / 1024))} KB` : undefined} chevron onclick={() => open(e)} disabled={!!busy} />
      {/each}
    {/if}
  </List>

  <SectionTitle text="断开" />
  <List footer="忘掉服务器和密码，这边的数据和服务器上的文件都不动。">
    <Cell title="断开同步" onclick={() => (confirmForget = true)} disabled={!!busy} />
  </List>
{/if}
{#if error}<p class="hint err">{error}</p>{/if}

<Sheet open={!!picked} onclose={() => (picked = null)} title="冲突副本">
  {#if picked}
    <List footer={`${picked.entry.name}，导出于 ${when(picked.backup.exportedAt)}`}>
      {#each Object.entries(picked.summary.counts).filter(([t, n]) => t !== 'home' && n > 0) as [table, n] (table)}
        <Cell title={label(table)} value={`${n} 条`} />
      {/each}
    </List>
    <p class="warn">「换成这份」会清空现在的全部数据，换成副本里的，然后重新打开；之后再同步会把它推到服务器。</p>
    <div class="btns">
      <Button onclick={restore} disabled={!!busy}>{busy === 'restore' ? '正在恢复……' : '换成这份'}</Button>
      <Button kind="plain" onclick={remove} disabled={!!busy}>{busy === 'delete' ? '正在删……' : '删掉这份副本'}</Button>
      <Button kind="plain" onclick={() => (picked = null)}>关闭</Button>
    </div>
  {/if}
</Sheet>

<Sheet open={confirmForget} onclose={() => (confirmForget = false)} title="断开同步？">
  <p class="warn">这台设备会忘掉服务器地址和密码；数据不会删，服务器上的文件也不动。</p>
  <div class="btns">
    <Button onclick={forget}>断开</Button>
    <Button kind="plain" onclick={() => (confirmForget = false)}>取消</Button>
  </div>
</Sheet>
<div style="height:40px"></div>

<style>
  .hint { margin: 8px 16px 0; font-size: 13px; color: var(--label-2); line-height: 1.4; }
  .ok { color: var(--green); }
  .err { color: var(--red); }
  .warn { margin: 12px 16px 0; font-size: 14px; color: var(--red); line-height: 1.4; }
  .btns { display: flex; flex-direction: column; align-items: center; gap: 4px; margin: 12px 16px 0; }
</style>
