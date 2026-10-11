import type { PluginManifest } from '$kernel/api';
import chat from './chat';
import characters from './characters';
import settings from './settings';
import diary from './diary';
import ledger from './ledger';
import habits from './habits';
import schedule from './schedule';
import dates from './dates';
import weather from './weather';

/** 内置插件清单。顺序决定桌面图标顺序。 */
export const builtinPlugins: PluginManifest[] = [chat, characters, diary, ledger, habits, schedule, dates, weather, settings];
