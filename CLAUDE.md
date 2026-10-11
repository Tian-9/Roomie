# Roomie 开发约定

设计基线在 docs/ARCHITECTURE.md（英文版 docs/ARCHITECTURE.en.md，两份同步改），改设计先改文档。从 Pocketverse 分叉而来，内核约定沿用。

## 跑之前
- `npm run lint`（类型检查 + 单元测试）和 `npm run build` 必须过。
- 浏览器行为用 Playwright 对 `npx vite preview --port 4173` 跑一遍，Chromium 在 /opt/pw-browsers/chromium。

## 容易踩的坑
- Svelte 5 的 `$state` 对象是 Proxy，直接存进 Dexie 会 DataCloneError。写库前用 `$state.snapshot(x)`。
- `liveQuery` 里不能写库（创建默认世界、创建存档都算写），先在 `$effect` 里解析出 id，再把 id 作为 `live(fn, initial, deps)` 的 deps。
- 查询函数里读到的 Svelte 状态不会被追踪，依赖状态的 live 查询必须传 deps。
- `Sheet` 用 `open={!!x}` 驱动时一定传 `onclose={() => (x = null)}`，否则点背景关掉后同一项点不开。
- 页面和弹窗都登记进浏览器历史（`nav.push` / `Sheet` 自动做），系统返回走 popstate。不要自己调 `history.*`，返回一律 `nav.pop()`。`pop()` / `home()` 是异步的（等 popstate），返回后再 push 必须 `await`。
- 屏幕是叠着渲染的，Playwright 选择器要用 `p.locator('.screen').last()` 限定到最上层。
- 提示词里易变内容（时间、L1 命中、插件动态）只能进最后一条用户消息，system 必须稳定，否则缓存全废。
- 工具名只能是字母、数字、下划线、连字符（API 校验 `^[a-zA-Z0-9_-]{1,128}$`），不能带点。假接口不校验这个，真接口会 400；`definePlugin` 和 tools.test.ts 已加校验。
- 他分享东西（歌、文章、链接）一律走内核 `share` 工具 + 插件 `shares` 解析器，卡片用通用 `ShareCard`，不要为每种类型新加输出标签和卡片组件。引用原文必须经解析器校验。
- 离开回来的补发（写复盘、报日程、周小结）一律登记到 manifest 的 `catchup`，由内核按角色、按档位合成一次调用；`attach` 档挂在下一次聊天回复或补发上。插件不要自己听 `app.resumed` 调模型。
- 用户主动发的东西（记一笔、发首歌…）走「+」面板 `composerActions`，产出 `OutgoingMessage`；插件工具往回复里放卡片用 `ctx.addCard`，不要新造消息类型。
- 插件只能 import `$kernel/api`，不能 import 内核内部模块或其他插件；跨插件跳转走 `nav.push(pluginId, screen, params)`。读存档、世界、角色、记忆、条目目录走 `ctx.data`（只读快照），界面响应式查询用 `$kernel/api` 的 `live`。`ctx.data` 缺什么就加到它上面，别绕过去读 `db()`。
- 开发机可能是 macOS（文件系统不区分大小写）：两个文件名不能只差大小写。`inspect.svelte.ts` 和 `Inspect.svelte` 曾经撞车，在 Mac 上直接 29 个类型错误。

## 文案
- 第三人称一律用"他"。
- 界面上不出现"用户""助手""AI""存档""世界"。

## 和 Pocketverse 的边界
- 能力包是插件，不是角色；人格和记忆只有一份。不要为"理财专精""厨师专精"建新角色。
- 没有世界书、没有存档：记忆、状态、他的笔记（`notes` 表）全库一份，`home` 表只有一行（`HOME_ID`）。不要给任何东西加 `campaignId`。
- "常驻的他"是 kv `kernel.currentCharacter`，最近给谁发消息谁就是；补发只找他。
- 插件读对话走 `ctx.data.messages({ from, to })`，不要 import `$kernel/storage/db`。
- `promptContributors` 的 `volatile` 想省 token 就登记 `triggers`，命中才注入。
- 补发段想让他顺口说一句，在自己的 schema 里加可选的 `say`，内核会合成一条他发来的消息；插件不要自己往 `messages` 表写。段的 `say` 自带问候就标 `greets: true`，内核不再在前面加「早」。
- Dexie 不能改主键：表的主键要变只能换表名（`memfs` → `notes` 就是这么来的）。
