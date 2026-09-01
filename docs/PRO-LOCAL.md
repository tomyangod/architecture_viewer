# 本地 Pro：不上 GitHub 也能盯架构图

给**技术小白**。代码可以只在自己电脑里，不必上 Gitee / GitHub。

一句话：告诉控制台「项目在哪个文件夹」，点检查。图和代码对不上就红灯；试用期内还可以定时查、推企业微信。

## 你要先有的

1. 电脑已装 **Node.js 18+**（终端输入 `node -v` 能看到版本）。
2. 已经下载本项目，并打开终端进入项目目录。

## 第 1 步：启动网页

```bash
cd /你下载的/architecture_viewer
ARCH_PRO_LOCAL=1 npm run web
```

浏览器打开：http://127.0.0.1:3847/account.html

关掉这个终端窗口，网页就停了。要一直用，窗口别关。

## 第 2 步：注册试用

邮箱 + 密码（至少 8 位）→ **注册并试用 7 天**。

## 第 3 步：先给自己的项目出图（免费）

在**你的业务项目**文件夹里（不是 Architecture Viewer 自己）：

```bash
cd /Users/你/你的项目
npx arch-viewer init .
npx arch-viewer generate .
```

会多出一个 `architecture_viewer/` 文件夹，里面是六张图。

## 第 4 步：接到控制台

1. **项目文件夹绝对路径**填：`/Users/你/你的项目`（要从 `/` 或盘符写起，不要写 `我的项目`）。
2. **自动检查间隔**：试用中可填 `15`（每 15 分钟查一次）；只想手动点就填 `0`。
3. **企业微信**（可选）：群里添加「群机器人」，复制 Webhook 地址贴上。
4. 点 **保存本地项目** → **现在检查**。

- **绿灯**：图和代码对得上。
- **红灯**：图过期了，或模板没填完。

## 第 5 步：红灯了怎么修

在你的业务项目里再生成一次图：

```bash
cd /Users/你/你的项目
npx arch-viewer generate .
```

回到控制台再点 **现在检查**。变绿就可以。

想先看「故意坏图」长什么样：把路径填成本仓库里的  
`…/architecture_viewer/eval/demo-drift`，点检查一定是红灯。

## 试用到期后还能干什么

| 还能用 | 需要兑换许可证 / 付费 |
|--------|----------------------|
| 点「现在检查」，控制台红灯/绿灯 | 每隔几分钟自动检查 |
| 命令行 `npx arch-viewer check …` | 企业微信自动推送 |
| 继续出图 `generate` | Gitee/GitHub 上的 PR 自动评论 |

控制台点 **兑换许可证**，或让运营对公开通。见 [invoice.md](invoice.md)。

## 企业微信怎么拿地址

1. 打开一个企业微信群 → 右上角 `…` → **消息推送 / 群机器人**（不同版本名字略有差别）。
2. 添加机器人，复制 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…`。
3. 贴到控制台。只有试用中或已付费才会真正发出去。

## 常见问题

**找不到文件夹？** 必须是绝对路径。Mac 可在 Finder 里选中文件夹，按 Option 右键「将 … 拷贝为路径名」。

**检查说没有套件？** 先在该文件夹跑过 `npx arch-viewer init .` 和 `generate`。

**网页打不开？** 终端里要有一行 `Architecture Viewer Web  http://127.0.0.1:3847`。没有就再执行第 1 步。

**生产服务器上的云网站？** 不要开本地扫盘。设 `ARCH_PRO_LOCAL=0`。本机自用才设 `ARCH_PRO_LOCAL=1`。

Gitee/GitHub 上的 PR 评论用法见 [PRO-SAAS.md](PRO-SAAS.md)。
