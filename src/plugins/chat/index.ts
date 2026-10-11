import { definePlugin, icons, gradients } from '$kernel/api';
import ChatList from './ChatList.svelte';
import Conversation from './Conversation.svelte';

export default definePlugin({
  id: 'chat',
  name: '信息',
  version: '0.2.0',
  core: true,
  description: '和他发消息。内核级，不可关闭。',
  app: { screen: ChatList, icon: { paths: icons.chat, background: gradients.green } },
  screens: { conversation: Conversation },
});
