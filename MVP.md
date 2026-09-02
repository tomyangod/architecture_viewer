# MVP 使用说明（最小可行产品）

当前你已经可以**不装扩展、不配 API Key**，用浏览器看完核心效果，再决定下一步。

> **零基础请先看**：[小白超详细使用攻略](docs/beginner-guide/index.html)（4 个 Demo + 逐步截图式说明）  
> **一键体验「AI 改坏架构也能看见」**：`npm run demo:beginner:step`（逐步按回车）或 `npm run demo:beginner`（不停顿）

---

## 1. 30 秒打开看效果

网页服务若已在跑，直接打开：

| 打开什么 | 地址 | 你看到什么 |
|----------|------|------------|
| 落地页（中文） | http://127.0.0.1:3847/ | 产品介绍、演示入口、定价 |
| 落地页（英文） | http://127.0.0.1:3847/?lang=en | 右上角也可点 **EN / 中文** 切换 |
| **六视图 MVP（必看）** | http://127.0.0.1:3847/samples/showcase/ | Coffee Shop 完整 C4 六视图 |
| 漂移红灯演示 | http://127.0.0.1:3847/samples/drift-fail/ | 故意坏图（Validate 会失败） |

若打不开，在仓库根目录执行：

```bash
cd /Users/yanheyang/Desktop/architecture_viewer
npm run web
```

---

## 2. 在六视图页里怎么操作

打开 `/samples/showcase/` 后：

1. **切 Tab**：顶部 / 侧边切换 Context → Container → Component → Block → Class → Deploy  
2. **子图**：部分 Tab 还有子 Tab（同一视图多张图）  
3. **缩放 / 平移**：滚轮缩放，拖动画布（视具体 Viewer 工具栏）  
4. **搜索**：用搜索框找模块名（如 `api`、`worker`）  
5. **导出**：工具栏可下 PNG（若开启 download）

这就是「交付物」——给评审、新人、老板看的架构门户。

---

## 3. 三条使用路径（由浅到深）

### 路径 A · 只看效果（推荐你现在做）

1. 打开落地页 → 点「打开六视图分享页」  
2. 再打开「漂移红灯」页，理解：**坏图会挂 CI**  
3. 英文页 `?lang=en` 看海外叙事是否顺眼  

**决策点**：图好不好看？六视图对你是否够用？

对真实开源仓逐步跟做（Uptime Kuma / listmonk / 网页变更监测）：[docs/OSS-TUTORIAL.md](docs/OSS-TUTORIAL.md)。

### 路径 B · CLI 在演示仓上跑一遍（5 分钟）

```bash
cd /Users/yanheyang/Desktop/architecture_viewer

# 校验：故意坏图必须失败
node lib/cli.js check eval/demo-drift --filled
# 期望：exit ≠ 0，看到 Rel 未声明 / 模板占位

# 在官方演示仓上重新生成（可选）
node lib/cli.js generate examples/showcase-shop
node lib/cli.js check examples/showcase-shop/architecture_viewer \
  --filled --drift --repo examples/showcase-shop
```

**决策点**：扫描骨架图质量能否接受？是否还要用 Cursor Chat 按 `AGENT.md` 精修？

### 路径 C · 扩展（作者主形态，下一步）

1. 用 Cursor / VS Code **打开本仓库**  
2. 按 **F5** 启动 Extension Development Host  
3. 在新窗口打开任意项目（或 `examples/showcase-shop`）  
4. 命令面板依次：

| 命令 | 作用 |
|------|------|
| `Architecture Viewer: Init Kit` | 把套件拷进仓库 |
| `Architecture Viewer: Generate` | 扫描并写 6 个 `.md` |
| `Architecture Viewer: Preview` | Webview 看图（无需 python server） |
| `Architecture Viewer: Validate` | 协议 + 漂移检查 |

**决策点**：作者工作流是否顺手？是否值得上架 Marketplace？

---

## 4. 产品边界（你现在买到的是什么）

| 已有（Community MVP） | 尚未有（Pro / Team 路线） |
|----------------------|---------------------------|
| 六视图 Viewer + 离线 Mermaid | GitHub/Gitee 云端一键导入 |
| CLI Init / Generate / Check | 账号登录与付费门禁 |
| 网页落地页 + 静态分享样例 | 增量生成引擎 |
| 扩展四命令（本地 F5） | PR 评论漂移标注 |
| 坏图 CI 红灯夹具 | `architecture-rules.yaml` 团队规范 |

**收费理由已定**：不是「出一张漂亮图」，而是「图与代码不一致就红灯」。

定价骨架：Pro **¥29/月**；Team **¥999/年/仓库**。详见 [COMMERCIAL.md](COMMERCIAL.md)。

---

## 5. 建议你怎么决定下一步

按你的目标选一条：

1. **先验证「图好不好看」** → 只刷路径 A；反馈：哪些视图多余 / 缺什么。  
2. **先验证「生成够不够」** → 路径 B，对你自己的一个真实仓库 `generate`，把不满意的点记下来。  
3. **先验证「作者会不会天天用」** → 路径 C（F5 扩展），用一周再谈上架。  
4. **冲上架与获客** → 进 W02（vsce 打包）+ W04（教程文 / 种子用户）。  

WBS 看板：

```bash
node pm/scripts/wbs.mjs status
```

本周还剩：**W01-04 Playwright**（装好依赖后可跑）、**W01-05 英文落地页**（已支持 `?lang=en`）。

---

## 6. 常用命令速查

```bash
npm run web                          # 官网 + 样例
npm test                             # 单测
npx playwright test                  # E2E 冒烟（需先 npx playwright install chromium）
node lib/cli.js generate <repo>      # 生成六视图
node lib/cli.js check <kit> --filled --drift --repo <repo>
node pm/scripts/wbs.mjs status       # 商业化任务看板
```

英文 README：[README.en.md](README.en.md)
