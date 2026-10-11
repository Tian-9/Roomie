import './app.css';
import { registerSW } from 'virtual:pwa-register';
import { bus } from '$kernel/bus/bus';
import { mount } from 'svelte';
import App from './App.svelte';
import { builtinPlugins } from './plugins';
import { registry } from '$kernel/registry/registry.svelte';
import { openDB } from '$kernel/storage/db';
import { repo } from '$kernel/data/repo';
import { theme } from '$kernel/theme/theme.svelte';
import { scheduler } from '$kernel/scheduler/scheduler';
import { nav } from '$kernel/nav/nav.svelte';
import { llm } from '$kernel/llm/gateway.svelte';
import { lock } from '$kernel/lock/lock.svelte';
import { chat } from '$kernel/chat/engine.svelte';
import { log } from '$kernel/log/log';
import { catchup } from '$kernel/catchup/catchup';

async function boot() {
  nav.boot();
  for (const p of builtinPlugins) registry.register(p);
  openDB(builtinPlugins);
  log.boot();
  // home 单例先建好，之后界面可以直接 live 读它（liveQuery 里不能写库）
  await repo.home();
  await theme.boot();
  await llm.boot();
  // 开了锁屏的话这里把网关的 Key 交给保险箱；之后所有模型调用都等解锁
  await lock.boot();
  await chat.boot();
  await registry.boot({
    enabled: ['diary', 'ledger', 'habits', 'schedule', 'dates', 'weather', 'review'],
    dock: [
      { pluginId: 'chat', shortcutId: 'app' },
      { pluginId: 'characters', shortcutId: 'app' },
      { pluginId: 'diary', shortcutId: 'app' },
      { pluginId: 'settings', shortcutId: 'app' },
    ],
  });
  catchup.boot();
  // 插件都 setup 完再发 app.resumed，否则没人听
  await scheduler.boot();
}

const updateSW = registerSW({
  onNeedRefresh() {
    bus.emit('notify', { title: '有新版本', body: '点这里更新，正在进行的对话不受影响', action: () => updateSW(true) });
  },
});

mount(App, { target: document.getElementById('app')! });
boot().catch((e) => console.error('[boot]', e));
