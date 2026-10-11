import { definePlugin, icons, gradients } from '$kernel/api';
import Characters from './Characters.svelte';
import CharacterDetail from './CharacterDetail.svelte';
import Profile from './Profile.svelte';
import Inspect from './Inspect.svelte';
import Findings from './Findings.svelte';

export default definePlugin({
  id: 'characters',
  name: '他',
  version: '0.2.0',
  core: true,
  description: '住在手机里的他：人设、记忆、主页。可导入角色卡换人设，记忆不跟卡走。',
  app: { screen: Characters, icon: { paths: icons.person, background: gradients.orange } },
  // profile 是他的主页（状态、记忆、插件挂的段）；detail 是编辑人设卡
  screens: { detail: CharacterDetail, profile: Profile, inspect: Inspect, findings: Findings },
});
