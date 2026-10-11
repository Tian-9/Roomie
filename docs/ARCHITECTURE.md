# Roomie 架构

> 住在你口袋里的他。外壳是一部虚拟手机，人格和记忆只有一份，能力靠插件长出来。本文是项目的设计基线，代码以此为准，改设计先改这里。English: [ARCHITECTURE.en.md](ARCHITECTURE.en.md)。

## 0. 一句话

**微内核 + 插件 + 三层记忆，服务一个人。** 内核只管手机外壳、存储、模型网关、上下文拼装、补发和插件注册表。聊天、日记、记账、日程，全部是插件。内核不认识"记账"是什么，也不认识"他"是谁，只认识角色卡和记忆。

## 1. 和 Pocketverse 的关系

Roomie 从 [Pocketverse](https://github.com/Tian-9/pocketverse) 分叉。Pocketverse 为多宇宙角色扮演设计：多个世界、多张角色卡、每局一个存档，记忆挂在存档上。Roomie 只有一个世界（你的现实），所以：

| | Pocketverse | Roomie |
|---|---|---|
| 世界 | 多个，有世界书正典 | 一个，没有世界书；"正典"就是你的数据 |
| 角色 | 多张卡，各开各局 | 一位常驻的他；可换人设，但记忆不跟卡走 |
| 存档 | 一卡多局，记忆按局隔离 | 一份记忆，跟用户走 |
| 插件 | 朋友圈、红包、论坛、商店等剧情功能 | 记账、日程、复盘等生活功能 |
| 补发 | 他在剧情里过了几天 | 他在现实里等了你几天 |

能原样复用的：Shell、Storage、LLM 网关、Context 拼装器、Catchup、Scheduler、Theme、UI 组件库、Registry、Bus、角色卡导入。砍掉的：世界书（lore）、风格预设（style）、覆盖层（overlay）以及所有剧情插件。

## 2. 目标与非目标

目标：

- 纯前端 PWA，静态文件部署（GitHub Pages），加到主屏幕即可用，无服务器。
- 自带 API Key，浏览器直连 Claude；Gemini / OpenAI 兼容为辅。
- 一个有人格的他：角色卡定义性格，三层记忆让他记得你。
- 一切可见功能都是插件，能力包可开关，开关后桌面随之变化。
- 关系优先，干活克制：第一版只做记录、提醒、回忆三类低风险能力，不做有外部副作用的操作（发邮件、改日历）。
- 视觉统一：插件只能用内核组件库拼界面。

非目标（现在不做，口子留着）：

- 后台运行、锁屏推送。浏览器做不到，用"打开时补发"代替；Telegram Bot 推送以后做成插件。
- 多端同步。先本地，同步以后做成插件。
- 第三方插件沙箱。第一版只有内置插件。
- 向量检索。关键词 + 模型自主搜索够用。

## 3. 技术栈

| 层 | 选择 | 理由 |
|---|---|---|
| 构建 | Vite | 快，零配置，PWA 插件现成 |
| 语言 | TypeScript，strict | 让编译器替人查错 |
| UI | Svelte 5 | 写法最接近 HTML，产物最小，手机上启动快 |
| 样式 | Tailwind + CSS 变量 | 变量是主题系统的根 |
| 存储 | Dexie（IndexedDB） | 带版本迁移，插件可以声明自己的表 |
| 搜索 | MiniSearch | 几 KB 的内存 BM25，记忆的关键词检索 |
| 模型 | `@anthropic-ai/sdk`（浏览器模式）为主 | 缓存、工具循环、memory 工具全用上 |
| PWA | vite-plugin-pwa | manifest + service worker 只做离线缓存 |

## 4. 仓库结构

```
roomie/
  docs/                  设计文档（本文，中英两份）
  src/
    kernel/              内核，插件不能绕过它
      shell/             锁屏、桌面、Dock、通知条
      lock/              PIN 锁屏状态机 + WebCrypto 封装 API Key
      registry/          插件注册表、贡献点收集、services
      bus/               事件总线
      storage/           Dexie 实例、schema、插件表命名空间、live 查询
      llm/               模型网关：Claude 适配器、流式、缓存、计费
      chat/              聊天引擎：工具循环、标签解析
      context/           上下文拼装：L0/L1/L2、笔记（memfs）、搜索、工具
      memory/            记忆整理（Haiku 合并）
      catchup/           补发：按档位合成一次调用
      scheduler/         前台定时器 + 回到前台触发补发
      data/              repo（写）与 view（插件只读视图）
      importers/         人设卡 PNG/JSON 和导入前扫描
      theme/             主题 token
      nav/               导航栏与浏览器历史
      ui/                基础组件库
      speech/            语音：浏览器自带的听（SpeechRecognition）和说（speechSynthesis），不接第三方 TTS
      api/               $kernel/api：插件唯一能 import 的入口
    plugins/
      chat/              信息（内核级，不可关闭）；输入框的麦克风（识别结果填进输入框，不自动发）和他消息上的朗读按钮，浏览器不支持就不出现
      characters/        他：人设、主页、记忆、人设卡导入、首次引导；编辑人设里选朗读音色和语速，存人设卡的 voice 字段
      diary/             日记：他写给自己的一天（示范插件）
      ledger/            账本：记一笔、查一下、上周花销
      habits/            习惯：想坚持的事、打卡、连续天数
      schedule/          日程：安排、待办、到点提醒、农历和节假日
      dates/             纪念日：生日、纪念日、倒数日
      weather/           天气：你那边今天什么天气
      review/            复盘：早安 + 昨天的复盘、周小结
      settings/          API、外观、插件开关、锁屏、日志、整库导出导入、多端同步
    main.ts              启动：内核 → 注册插件 → 挂载 shell
```

规则：`plugins/*` 只能 import `$kernel/api`，不能 import 内核内部模块，也不能互相 import。插件间通信走事件总线或 `services`。

## 5. 核心数据模型

内核表（M1 起，见 `src/kernel/storage/db.ts`）：`home`、`characters`、`conversations`、`messages`、`memories`、`notes`、`kv`、`usage`、`logs`。Pocketverse 的 `worlds`、`lore`、`overlays`、`campaigns` 已删除；旧库打开时 Dexie 会删掉这些表，`memfs` 因为主键变了（Dexie 不能改主键）换成了 `notes`。

备份：设置 → 数据 → 导出全部，把 `db.tables` 里除 `logs` / `usage` 之外的每张表（含插件表）打成一个 JSON（`src/plugins/settings/backup.ts`），Blob 转 base64，文件头 `{ app: 'roomie', kernel, schema, exportedAt }`。导入先预览再整库替换（一个事务里清空再写，失败回滚），只接受内核版本相同的备份；备份里有而当前没装的插件表跳过。多端同步（6.6）建在这个格式上。

```ts
// 他：人设卡。可以有好几张（换人设），但下面的东西都不跟卡走
interface Character { id; name; avatar?; core; full; firstMessage?; useFirstMessage?; voice? }

// 你的世界和他的这一局：全库只有一行，id 固定 'home'。Pocketverse 的 Campaign 退化到这里
interface Home { id: 'home'; state: State; lastActiveAt: number; catchupAt?: number }

// 当前状态：他的情绪、你们的关系、最近 20 条事实，进 L0
interface State { mood: string; relation: string; facts: string[] }

// 记忆归你，不归哪张卡。characterId 只记"这是谁视角记的"
interface EpisodicMemory { id; characterId?; when; text; importance: 1|2|3; sourceMessageIds; createdAt }

// 他的笔记本 /memories（Claude memory 工具的后端），全库一棵树
interface MemFile { path; content; updatedAt }

// 一张卡一个私聊会话；记忆整理的进度记在会话上
interface Conversation { id; kind; participantIds; pluginId; consolidatedUpTo?; consolidateFailedAt? }
```

你的名字和画像在 kv（`kernel.userName`、`kernel.userProfile`），L0 常驻。"常驻的他"是 kv 里的一个指针（`kernel.currentCharacter`）：最近给谁发消息谁就是，补发只找他。界面上不出现"存档"和"世界"。

插件看到的是 `ctx.data`：`currentCharacter()`、`character(id)`、`characters()`、`state()`、`memories(opts)`、`messages({ from, to, limit })`、`userProfile()`，全是只读快照。

### 5.1 三层记忆

和 Pocketverse 一致，只是"正典"换了来源：

- **L0 常驻**：全局规则、用户画像、他的 core、当前状态、近期要事（importance=3）、各插件 `promptContributors` 的稳定部分。进 system，参与缓存。
- **L1 触发**：扫最近几条消息的关键词，命中插件登记的触发规则（记账插件：提到"花了"就带上本周支出；日程插件：提到"明天"就带上明天的安排）。进最后一条用户消息。登记方式是 `promptContributors[].triggers: string[]`：给了就只在命中时才调 `volatile`，不给就每轮都调。
- **L2 按需**：模型自己调工具翻：`memory_search`、`memory_recent`、memfs，以及插件工具（`ledger_query`、`schedule_list`）。

写回：模型调 `state_update` / memory 工具直接落库；每 N 轮或切出 App 时用 Haiku 合并一次，产出情节记忆和状态变化。

## 6. 内核模块

Shell、Registry、Bus、Storage、LLM 网关、Context 拼装器、Theme、Scheduler、补发（Catchup）的设计与 Pocketverse 相同，不再重复；细节以 Pocketverse 的 `docs/ARCHITECTURE.md` 第 5 节为准，Roomie 的差异点如下。

### 6.1 补发 = 他在等你

Pocketverse 的补发是"角色在剧情里过了几天，补发朋友圈、日记"。Roomie 里补发是产品核心，不是附属：

- 回到前台立刻查一次；前台开着每小时再查一次。
- 档位不变：`h6`（≥ 6 小时）、`d1`（≥ 24 小时）、`days`（≥ 2 天）、`attach`（挂在下一次聊天回复上）。
- 插件登记 `catchup: [{ id, tier, collect(ctx) }]`，内核把所有插件的事合成**一次**调用。第一版预期的补发项：
  - 复盘插件（`d1`）：早安 + 昨天的复盘；（`attach`，周日晚上 / 周一）周小结。日记插件（`h6`）另写他自己的日记。
  - 日程插件（`attach`）：今天有什么，顺口提一句；（`h6`）走开这几小时里到点了的事，问一句怎么样了。
  - 记账插件（`days`，周一）：上周花销小结。
- 他开口的第一句由内核拼：每段的 schema 可以带一个可选的 `say` 字段（他处理完想顺口说的一句），内核把问候语（`h6` 不打招呼、`d1`"早"、`days`"好久不见"）和各段的 `say` 合成**一条**他发来的消息，写进和他的私聊，并发 `notify`。没人想说话就不发。段上标 `greets: true` 表示它的 `say` 自带问候（复盘按时段说早安 / 回来了），它真开口了内核就不再加档位问候，而且它的 `say` 排在最前面，不管插件顺序。system 里告诉模型各段拼的是同一条消息：只有要求打招呼的那段打招呼，几段材料里的同一件事只说一遍，「在回消息就留空」的规则在补发里不适用。预算：一次最多一轮调用。

### 6.2 能力包是插件

"专精"不是角色，是插件。一个能力包通常提供：

| 贡献点 | 记账插件（`src/plugins/ledger`，已实现） |
|---|---|
| `app` | 账本界面：本月合计和分类条、按天流水、左滑删除、导出 CSV |
| `tools` | `ledger_add`、`ledger_query`、`ledger_delete`：他能替你记一笔、查一下、删一笔。金额整数分，日期 `YYYY-MM-DD`，自然语言由模型翻成数字，插件只校验 |
| `promptContributors.volatile` | 本周支出一行摘要，`triggers` 是「花了、买了、多少钱…」，提到才注入 |
| `composerActions` | 「+」面板里的"记一笔"：你主动发，产出带账单卡的 `OutgoingMessage` |
| `outputHandlers` | `bill` 账单卡片（`attrs` 里带快照，那笔删了也还能显示） |
| `catchup` | `days` 档：周一到周三回来、上周有记录且这周没说过，他顺口提一句上周花销（`say`）；复盘插件的周小结开着就不提（花销由周小结一起说） |
| `profileSections` | 他的主页上挂"本月花了多少" |
| `services` | `ledger`：`monthTotal()`、`range(from, to)`，复盘插件拿昨天花了多少用这个 |
| `storage` | `p_ledger_entries` 表（`id, date, category`） |

内核的 `ctx.addCard`、`share`、`services` 机制全部沿用。插件不自己听 `app.resumed` 调模型。

已有的能力包（各插件合入时在这里补一行自己的贡献点）：

- `habits` 习惯打卡：表 `habits` / `checks`；工具 `habit_add`、`habit_check`、`habit_status`；`check` 卡片；`volatile` 一行连续天数（触发词：打卡、坚持、习惯…）；补发 `attach` 档晚上八点后问一句今天没打的；主页段「习惯」；服务 `habits`（`summary()` / `status()`）。
- `review` 复盘（`src/plugins/review`，已实现）：`p_review_reviews` 表（`id, date, kind, createdAt`，`kind` 日报 / 周报）；工具 `review_read`；补发 `d1` 档"早安 + 昨天的复盘"（`greets`，按设置里的早安时段说早安或回来了，离开几天就看几天，最多 7 天）、`attach` 档周小结（周日 18 点后或周一，一周一次，设置里可关）；材料从 `ledger` / `habits` / `schedule` / `lunar` 服务拿，没装哪个就不提哪样；复盘本按天列出正文和当天材料（聊了几条、花了多少、做完 / 没做的日程）；不进每轮提示词；服务 `review`（`weeklyEnabled()`，账本据此决定要不要单独提上周花销）。
- `schedule` 日程与提醒（`src/plugins/schedule`，已实现）：`p_schedule_items` 表；工具 `schedule_add` / `schedule_list` / `schedule_done` / `schedule_remove`；`event` 卡片；「+」面板"记个日程"；`volatile` 一段今天 / 明天 / 下个假期（触发词：明天、后天、几点、提醒…）；补发 `attach` 档"今天还有什么"（一天提一次）、`h6` 档"你走开时错过了什么"；主页上挂下一件事；前台每半分钟查一次到点的提醒（内核 `notify` + 浏览器 `Notification`，不承诺后台推送）；服务 `schedule`（今天 / 区间 / 接下来几件）和 `lunar`（农历、法定节假日表，2026 按国办通知，2027 预估）。
- `dates` 纪念日 / 倒数日（`src/plugins/dates`，已实现）：`p_dates_dates` 表（`id, month, day`，字段 title / month / day / year? / lunar / kind）；工具 `date_add` / `date_list` / `date_remove`，kind 分生日、纪念日（每年过，记了年份算几岁 / 几周年）和倒数日（只有那一天）；`date` 卡片；`volatile` 一行七天内的日子（没有就不注入）加一句 stable 的记法说明；补发 `attach` 档今天或明天有日子他顺口提一句（每次只提一回）；主页上挂最近的一个；农历日子通过 `ctx.service('lunar')` 从日程插件拿换算，日程没开就只支持公历；服务 `dates`（`upcoming(days)` / `summary()`）。
- `weather` 天气（`src/plugins/weather`，已实现）：Open-Meteo 预报 + 空气质量 + 城市搜索，不要 Key；定位（反查地名）或手选城市，地点和预报缓存存 `settings`，每小时最多拉一次；`volatile` 一行「你那边：北京 12°C 小雨，今天 8~15°C，空气良」，没有触发词（每轮一行，没设地点或拉不到就不带）；补发 `attach` 档早上 5–11 点只在明显变化时（降温 / 升温 ≥ 5°C、有雨雪、风大、空气差、高温 / 严寒）提一句，一天一次；界面一屏：当前 + 24 小时 + 7 天 + 日出日落；网络失败静默退回缓存，聊天不受影响；服务 `weather`（`line()` 一行、`today()` 结构化的今天含 `notes`、`place()`），复盘 / 早安插件拿今天天气用这个。
- `moments` 动态（`src/plugins/moments`，已实现）：Pocketverse 朋友圈换个壳，他发的不是自己的剧情，是对你这几天的观察，一两句碎碎念。`p_moments_posts` 表（`id, characterId, date, createdAt`，字段 text / source 补发 · 聊天 · 手动 / liked / material 一行一项）；补发 `d1` 档「发一条」（和复盘拼在同一次调用里，没有 `say`，结果进动态页并 `notify`；离开几天看几天最多 3 天；一天最多一条）；材料和复盘同源：`ctx.data.messages()` 加 `ledger` / `habits` / `schedule` / `lunar` / `weather` 服务，没装不提；工具 `moments_post`（聊到值得记的事他顺手发一条）；`volatile` 最近三条带点没点心，触发词「动态、那条、你发的…」，提到才注入；动态页按时间列出，可点心、可「回他一句」——带着原文预填跳进和他的对话接着聊（内核加了 `ctx.data.conversationWith(characterId)` 和会话界面的 `draft` 参数），不另做评论；主页段「动态」最近一条；服务 `moments`（`latest()`）。
- `telegram` Telegram 推送（`src/plugins/telegram`，已实现，默认不开）：Bot API 是普通 HTTPS，浏览器直连 `api.telegram.org`，不要服务器；Bot Token 存 `ctx.secrets`（开了锁屏就和 Key 一起被 PIN 封起来），chat id 和开关存 `settings`；设置页一屏：说明限制、填 Token（`getMe` 检查）、「找到我」（`getUpdates` 挑出你的私聊自动填 chat id）、发一条测试、两个开关、最近一次发送结果；`onEvent.notify` 把通知条（日程到点等）攒 2.5 秒合成一条发出去，`onEvent['catchup.done']` 把他刚合成的那条整段发出去并丢掉补发期间攒下的通知条（手机上只收一条）；工具 `telegram_send`（对方说"发到我 Telegram"），配好了才在 system 里加一句说明；发送队列按顺序发、超 4096 字分段、429 按 `retry_after` 等一次。诚实的限制写在设置页：发消息的是这个页面，页面全关着就没人发，在 Telegram 里回他他看不到。

### 6.3 推送

浏览器后台定时器会被节流（Chrome 后台标签最多每分钟一次，超过 5 分钟进密集节流），手机切走后页面随时可能被回收。所以：

- 前台开着：`scheduler` 每小时查一次补发，这是现成的。
- 页面关着：不保证。Periodic Background Sync 只有 Chrome/Android 支持，作为可选增强。
- 真要主动找你：`telegram` 插件（见 6.2）把到点提醒和他回来时说的话经 Bot API 发到手机上，仍然要这个页面开着（电脑上留一个标签页）。Email 收发走 Gmail API + 浏览器 OAuth。WhatsApp 不做。

### 6.4 首次引导

新装开的第一件事不是导卡，是认识一个人。`characters` 插件的 `setup` 发现一张卡都没有，就把 `onboarding` 界面推上来，三步：

1. **他是谁**：内置三张人设（`src/plugins/characters/presets/`：温和的室友、损友、安静的书呆子，各 300 字 core）任选；或者写一句"我想要一个……的人"，由便宜模型按 JSON 结构生成名字、core 和示例对话；"更多"里保留导入 PNG / JSON 人设卡，走原来的检查页。
2. **API Key**：沿用网关设置，Key 只存在本机浏览器。选了内置人设可以先跳过，聊之前再填；按描述生成必须先填。
3. **他开口**：用他的口吻生成一句自我介绍和三个问题（叫你什么、平时几点睡、最近在忙什么），没 Key 或生成失败就用兜底文案。第一个答案经 `cleanName` 写进 `kernel.userName`，后两个拼成 `kernel.userProfile`；整段对话原样写进和他的私聊（`meta.onboarding`），最后一句交给聊天引擎让他接着回，所以他第一句就会叫出你的名字。

结束直接落在和他的对话里。空状态页（信息、他）也能手动再进引导。

### 6.5 锁屏与 Key 加密

目标是手机借人、浏览器被翻时对话和 Key 不裸露；诚实地说它防的是随手翻看，不是肯下功夫的人。

- **PIN**：4–6 位数字，设置 → 安全 → 锁屏与 Key 加密。PIN 本身不存任何地方；解锁后内存里只留 PBKDF2 导出的、不可导出的 AES 密钥，锁上就丢。
- **Key 加密**（`src/kernel/lock/crypto.ts`）：PBKDF2-SHA256（600k 次，`iter` 存在记录里以后可调）+ 随机 16 字节盐 → AES-256-GCM，12 字节随机 nonce。密文存 kv `kernel.lock`（`LockRecord`：`pinLength`、`idleMinutes`、`sealed`、`hasKey`）。开了锁屏后 kv `kernel.llm` 里的 `apiKey` 永远是空串：网关 `Gateway.save` 把 Key 交给挂进来的 `vault`（`KeyVault` 接口：`persist` / `ready` / `sealed`）加密另存。PIN 错 = GCM 校验失败，不另存校验值。
- **何时锁**：启动时只要有 `kernel.lock` 就锁；从后台回来（`visibilitychange`）超过 `idleMinutes` 分钟就锁（0 立即，-1 只在打开时）。锁屏是 `shell/LockScreen.svelte`，盖在所有界面和发送前预览之上（z 90），不进导航栈。
- **锁着时模型调用怎么办**：`llm.configured` 在锁着且封了 Key 时为真，所以补发、记忆整理不会误判成"没填 Key"而放弃；`Gateway.chat` / `ping` 先 `await vault.ready()`，解锁后才真的发。
- **忘了 PIN**：唯一出路是"清除 Key 重新填"（锁屏页和设置页都有）：删 `kernel.lock`、把 `kernel.llm.apiKey` 写成空、关锁屏，其他数据一样不动（用 PIN 封着的其他密文也一起没了，只能重填）。
- **防连点**：连错 5 次冷却 30 秒，只在内存里，刷新就清零。不要把它说成防暴力破解。
- **插件的秘密**（`ctx.secrets.get / set / locked`）：Bot Token、同步密码这类东西和 Key 同一套保管。没开锁屏时明文在 kv `secret.plugin.<id>.<key>`；开锁屏那一刻全部封进 `LockRecord.secrets`（每个秘密一份 `Sealed`，和 Key 同一把密钥、同一个盐，nonce 各自随机）并删掉 kv 明文；关锁屏解出来写回 kv；改 PIN 一起重封；忘了 PIN 清 Key 时也一起清掉。锁着时 `get` 和模型调用一样等到解锁，定时发东西的插件先看 `locked` 决定要不要等。
- **备份**：整库导出照常导 `kv`，所以开了锁屏的备份里 Key 是密文（`kernel.lock`），`kernel.llm.apiKey` 为空；导入到别的设备后用同一个 PIN 解锁即可。没开锁屏时备份里 Key 仍是明文，数据页的说明会按开没开分别写清楚。对话在备份里始终是明文，不加密。

### 6.6 多端同步

没有 Roomie 的服务器。你填一个自己的 WebDAV（Nextcloud、rclone serve webdav、dufs……），几台设备各自和服务器上的一份文件做合并。代码在 `src/plugins/settings/`：`webdav.ts`（够用的客户端）、`merge.ts`（合并，纯函数）、`sync.svelte.ts`（控制器）、`Sync.svelte`（设置 → 数据 → 多端同步）。

- **同步单位**：整库备份格式（6.2 之前那段说的 `backup.ts` 的 JSON），服务器上只有一个 `<文件夹>/roomie.json`，加一个 `conflicts/` 目录。`logs` / `usage` 不同步；kv 里 `kernel.lastSeen` 和所有以 `.cache` 结尾的 key（天气预报缓存等）是本机缓存，不进文件、合并时也不碰。插件要存不该同步的缓存，key 以 `.cache` 结尾即可。
- **三方合并，按表按主键**：这台设备记着上次同步完的样子（base）。每一行：两边一样就是它；只有一边和 base 不同就用改过的那边（删掉也算改）；两边都改了才算冲突，行里有数字 `updatedAt` 就大的赢，没有就按两边的最后写入时间（本地最后一次写库 vs 远端文件的 `exportedAt`）；一边删一边改，改的赢。`home` 和 `kv` 的冲突静默处理（只记日志、不留副本）：`lastActiveAt`、`catchupAt`、插件的「今天说过了」每台设备都在写，不是你的内容。第一次同步没有 base，撞上的只会是单例和设置项（`home`、kv），这时服务器那份赢，新设备跟着它。这边没装的插件的表原样放行，那边没有的表留这边的，谁都不替别人删表。写回本地只写有差的行，正在进行的对话不受影响；拉到 `kernel.*` 的设置项时重新打开页面（它们是启动时读进内存的）。
- **并发**：PUT 带 `If-Match: <上次的 ETag>`（第一次 `If-None-Match: *`），别的设备抢先写了就 412，整个流程重来一遍把它写的也合进来，最多三次。服务器文件没变（ETag 相同）就不下载。
- **冲突副本**：有冲突时，输掉的一方当时的整份快照先传到 `conflicts/<时间>-<设备名>-本机|远端.json`，再动真文件。设置页能列出、预览、整库换回来（之后再同步会把它推上去）、删掉。它是完整备份，也能用「从备份导入」恢复。
- **什么时候同步**：打开时、从后台回来超过一分钟、本地写库后十五秒（`Dexie.on('storagemutated')`，合并写回时不算）、手动点。自动同步可关。离线就跳过。
- **存在哪**：服务器地址、账号、文件夹、自动开关在 kv `kernel.sync`，随数据同步；密码走 6.5 说的插件秘密（`secret.plugin.settings.webdav`，开了锁屏就被 PIN 封着；`lock.hasSecret` 锁着时也能答有没有存过）；base、ETag、设备名放在另一个只在本机的 IndexedDB 库 `roomie-sync` 里，整库导入导出碰不到它。
- **诚实的限制**：浏览器直连 WebDAV 受跨域限制，服务器得返回 `Access-Control-Allow-Origin`、允许 PUT / MKCOL / PROPFIND 和 `Authorization` / `If-Match` / `Depth` 头、暴露 `ETag`。自建的能配（Nextcloud 装 WebAppPassword 之类，或反代加头），坚果云不放跨域，网页里连不上。没开锁屏时密码明文在 kv `secret.*`（和 API Key 一样），而且会随 kv 同步到服务器；开了锁屏两者都是密文。备份文件本身不加密。GitHub Gist 作为第二种后端留了口子（`WebDav` 换成同样 stat / get / put 形状的类即可），这版没做。

## 7. 里程碑

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **M0 搬家** ✅ | 从 Pocketverse 搬骨架：内核全留，插件只留信息 / 他 / 日记 / 设置；删掉世界书、风格、剧情插件；改名 | `npm run lint` 和 `npm run build` 过，能导入一张卡、配 Key、聊天、补写日记 |
| **M1 一个人** ✅ | 记忆改挂用户：删 `worlds` / `lore` / `overlays` / `campaigns` 表和相关内核代码、lorebook / preset / stChat 导入器，`Campaign` 退化为 `home` 单例，界面上去掉"世界 / 存档 / 剧情时间"；插件接口去掉 `campaignId`，加 `ctx.data.messages()`、`triggers`、补发 `say` | 换人设后他仍记得你；旧库打开能升级；设置和主页里看不到任何"世界 / 存档" |
| **M2 能力包** ✅ | 首次打开引导（他自我介绍、问你几个问题，答案进用户画像）；记账、习惯、日程提醒、纪念日、天气、复盘六个插件；补发做成"打开时他跟你说早安 + 昨日小结"；整库导出导入 | 清库打开走完引导能聊天；开关插件桌面随之变化；离开一天回来有早安和复盘；说"昨天花了多少"他能答 |
| M3 走出浏览器 | Telegram Bot 推送插件；PIN 加密 Key | 关掉网页也能在 Telegram 收到他的消息 |

## 8. 文案

- 他的第三人称一律用"他"。
- 不出现"用户""助手""AI"这些词；界面上他就是他，你就是你。
