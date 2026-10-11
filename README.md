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

**M1：一个人。** M0 从 Pocketverse 搬来的骨架上，世界书、多世界、多存档都拆掉了：记忆、状态、他的笔记都只有一份，跟你走，换人设也还在。插件接口里没有"存档"，多了按时间段读对话、L1 触发词和补发时他顺口说一句的口子。

现在能做的：导入或新建一个人设，配置 Claude API Key，和他聊天，他会记住事情，离开后回来他会补写日记。

下一步见架构文档第 7 节：首次打开引导；记账、日程、每日复盘三个插件。

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
