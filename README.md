# Roomie

住在你口袋里的他。一个纯前端 PWA：有性格、有长期记忆，顺手帮你记账、提醒、复盘。

[English](README.en.md) · 设计基线：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## 这是什么

Roomie 是 [Pocketverse](https://github.com/Tian-9/pocketverse) 的现实世界分支。Pocketverse 是一部跑在浏览器里的"小手机"，里面住着角色扮演用的虚拟角色；Roomie 把同一套外壳、插件系统和三层记忆搬到现实生活：

- **一个人，不是一个助手。** 他有人设、有情绪、记得你说过的话。帮你干事是顺带的，关系才是主线。
- **能力是插件，不是人。** 记账、日程、复盘是装在他身上的能力包；装了理财插件他就会看账本，装了厨房插件他就会按冰箱推荐菜。人格和记忆始终只有一份。
- **纯前端，自带 Key。** 静态部署，数据在你的浏览器里，模型 Key 在本地，没有服务器。
- **打开时补发。** 浏览器不能后台推送，所以他在你打开手机时才"拿起手机"：说早安、补昨天的复盘。

## 状态

**M3：走出浏览器。** 能聊、能记、能提醒之后，这一轮把门锁上、把手机接上、把几台设备连起来：

- **首次引导**：挑一个他（内置三张人设，或一句话让模型写一个，也能导入人设卡），填 Claude API Key，他先开口自我介绍、问你叫什么、几点睡、最近在忙什么，然后直接在信息里聊。
- **七个能力包**：账本（聊天里说一句「午饭 32」他就记上）、习惯（想坚持的事、打卡、连续天数）、日程（「明天下午三点开会」他记下来，到点提醒；能订阅 Google 日历）、纪念日（生日、倒数日，农历也行）、天气（你那边今天什么天气，降温有雨会提一句）、复盘（离开一天回来他说早安、聊昨天，周日晚上有周小结）、动态（他对你这几天的一两句碎碎念，可以点心、回他一句接着聊）。都是插件，设置里能开关。
- **打开时补发**：离开多久决定他说什么，各插件要说的话合成一条他发来的消息，早安只说一次。
- **锁屏与 Key 加密**：设一个 4–6 位 PIN，打开和从后台回来要输；API Key、Bot Token、同步密码都用它封起来，浏览器数据库和备份文件里都没有明文。
- **Telegram 推送**（默认不开）：页面开着的时候，到点提醒和他回来说的话发一份到你手机的 Telegram；要自己建一个 Bot。
- **备份与多端同步**：设置里整库导出一个 JSON，换手机导回来；或者填一个自己的 WebDAV，几台设备按行三方合并，两边都改过的留冲突副本。
- **语音**：输入框里按麦克风说话，他的消息能朗读，音色在人设里选；用浏览器自带的能力，不接第三方。

后面的打算见架构文档第 7 节的 M4。

## 上手指南

**先试什么**

1. 打开页面，挑一个他（或者写一句"我想要一个……的人"让模型生成），填 Key，回答他的三个问题。
2. 在信息里随便聊几句，顺口说一句「午饭花了 32」「明天下午三点开会」「我妈生日 10 月 14 号」，看他记没记上：桌面上的账本、日程、纪念日里都能翻到。
3. 关掉页面，第二天早上再打开：他会说早安、聊昨天，动态页多一条他的碎碎念。等不及的话，把手机时间调到第二天也行。
4. 设置 → 插件，把不想要的关掉，桌面图标随之消失。

**要你自己准备的**

- **Claude API Key**：在 [console.anthropic.com](https://console.anthropic.com/) 申请，填在设置 → API 与模型（或首次引导第二步）。Key 只存在你这台设备的浏览器里，按量付费，设置页能看到本月花了多少。
- **部署到 GitHub Pages**（想在手机上当 App 用就需要）：fork 或推到自己的仓库后，到仓库 Settings → Pages 把 Source 设为 **GitHub Actions**，之后每次推到 `main` 自动发布；手机浏览器打开后"添加到主屏幕"。不设这一项，部署工作流会报 404。
- **Telegram Bot**（可选）：在 Telegram 里找 [@BotFather](https://t.me/BotFather) 发 `/newbot` 拿到 Token；设置 → 插件里打开 Telegram，桌面上的 Telegram 里填 Token、先给你的 Bot 发一句话再点「找到我」。注意发消息的是这个页面，页面全关着就没人发（电脑上留一个标签页就行），在 Telegram 里回他他看不到。
- **WebDAV**（可选，多端同步用）：要一个允许跨域的 WebDAV。自己的 Nextcloud（装 WebAppPassword 之类放开 CORS 的应用，或反代加 `Access-Control-Allow-Origin` 等头）、`rclone serve webdav`、`dufs` 都行；坚果云不放跨域，网页里连不上。服务器要允许 `PUT / MKCOL / PROPFIND`，放行 `Authorization / If-Match / Depth` 头并暴露 `ETag`。填在设置 → 多端同步，先「试一下」再保存。
- **Google 日历**（可选）：电脑上打开 Google 日历 → 右上角齿轮 → 设置 → 左边点要订阅的日历 → 往下拉到「集成日历」→ 复制「iCal 格式的私密地址」，贴到日程右上角地球图标的「订阅日历」里。只读、单向：你在 Google 里加的事会进日程，他记的不会写回 Google；没有后台，打开 Roomie 时才拉一次（几小时内不重复），所以在 Google 里改了要下次打开才看到。Google 这个地址不给浏览器跨域许可，直接拉多半会被拦，两条路：一是 Google 日历设置 → 导入和导出 → 导出，把 .ics 文件导进来（同一个日历再导就是更新）；二是自己架一个中转，比如免费的 Cloudflare Worker，把它的地址填在「自建中转」里（`{url}` 的位置会换成编码后的日历地址）。别用公共代理，那等于把整本日历交给别人。Worker 代码：

  ```js
  export default {
    async fetch(req) {
      const url = new URL(req.url).searchParams.get('url') ?? '';
      if (!url.startsWith('https://calendar.google.com/')) return new Response('nope', { status: 400 });
      const r = await fetch(url, { cf: { cacheTtl: 0 } });
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'text/calendar', 'access-control-allow-origin': '*' } });
    },
  };
  ```

  部署后填 `https://你的.workers.dev/?url={url}`。想更稳可以把地址写死在 Worker 里、再加一个只有你知道的查询参数当口令。
- **锁屏**（建议开）：设置 → 锁屏与 Key 加密。PIN 不存在任何地方，忘了只能清掉 Key 重填，其他数据不丢。

## 开发

```bash
npm install
npm run dev      # 本地预览，桌面浏览器会显示手机外框
npm run lint     # 类型检查 + 单元测试
npm run build    # 产物在 dist/
```

推到 main 会自动部署到 GitHub Pages（需在仓库 Settings → Pages 里把 Source 设为 GitHub Actions）。

## 约定

见 [CLAUDE.md](CLAUDE.md)。改设计先改 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
