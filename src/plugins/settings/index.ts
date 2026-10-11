import { definePlugin, icons } from '$kernel/api';
import { gradients } from '$kernel/ui/icons';
import Settings from './Settings.svelte';
import Plugins from './Plugins.svelte';
import Appearance from './Appearance.svelte';
import ApiSettings from './ApiSettings.svelte';
import Rules from './Rules.svelte';
import Logs from './Logs.svelte';
import RawStream from './RawStream.svelte';
import Data from './Data.svelte';
import Lock from './Lock.svelte';
import Sync from './Sync.svelte';
import { sync } from './sync.svelte';

export default definePlugin({
  id: 'settings',
  name: '设置',
  version: '0.1.0',
  core: true,
  description: 'API、外观、插件开关、锁屏、数据备份、多端同步。',
  app: { screen: Settings, icon: { paths: icons.gear, background: gradients.gray } },
  screens: { plugins: Plugins, appearance: Appearance, api: ApiSettings, rules: Rules, logs: Logs, rawstream: RawStream, data: Data, lock: Lock, sync: Sync },
  shortcuts: [{ id: 'plugins', label: '插件', screen: 'plugins', icon: { paths: icons.plug, background: gradients.black } }],
  // 多端同步在这里起步：打开时查一次，之后听本地改动和回到前台
  setup: () => sync.boot(),
});
