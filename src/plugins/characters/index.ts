import { definePlugin, icons, gradients } from '$kernel/api';
import Characters from './Characters.svelte';
import CharacterDetail from './CharacterDetail.svelte';
import Profile from './Profile.svelte';
import Inspect from './Inspect.svelte';
import Findings from './Findings.svelte';
import Onboarding from './Onboarding.svelte';

export default definePlugin({
  id: 'characters',
  name: '他',
  version: '0.3.0',
  core: true,
  description: '住在手机里的他：人设、记忆、主页。可导入人设卡换人设，记忆不跟卡走。',
  app: { screen: Characters, icon: { paths: icons.person, background: gradients.orange } },
  // profile 是他的主页（状态、记忆、插件挂的段）；detail 是编辑人设卡；onboarding 是首次引导
  screens: { detail: CharacterDetail, profile: Profile, inspect: Inspect, findings: Findings, onboarding: Onboarding },
  /** 还没有人住进来就先走引导 */
  async setup(ctx) {
    if ((await ctx.data.characters()).length === 0) ctx.navigate('onboarding');
  },
});
