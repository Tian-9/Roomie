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

**M0：从 Pocketverse 搬过来的骨架。** 内核（外壳、存储、模型网关、上下文拼装、补发、组件库）原样保留，只留了四个插件：信息、他、日记、设置。世界书、朋友圈、红包、论坛、商店等角色扮演插件已删除。

现在能做的：导入或新建一个角色，配置 Claude API Key，和他聊天，他会记住事情，离开后回来他会补写日记。

下一步见架构文档第 7 节：记忆改为跟随用户而不是跟随存档；砍掉世界与多存档；加记账、日程、每日复盘三个插件。

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
