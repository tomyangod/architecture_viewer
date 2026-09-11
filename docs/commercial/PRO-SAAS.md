# Pro SaaS 最小闭环（账号 + 托管增量结构评论）

Architecture Viewer **Community** 继续免费。本页说明如何把同一套 Web 进程当成 **Pro 云** 来卖：客户注册、试用、付费，把 GitHub / Gitee 的 Merge Request / Pull Request webhook 指到你的服务，**由你代跑增量结构验收（对照 PR base 的 session diff + 风险 + 影响面）并在 PR 上评论**。

不引入新的 npm 运行时依赖。数据在 `.data/pro/store.json`。

## 本地版（不上 GitHub / Gitee）

小白教程：[PRO-LOCAL.md](PRO-LOCAL.md) · 网页版 `/local-pro.html`。

本机运行 `ARCH_PRO_LOCAL=1 npm run web` 后，在 `/account.html`：

1. 注册（7 天试用）。
2. 填**项目文件夹绝对路径**（不是仓库网址）。
3. 点 **现在检查**：控制台亮红灯/绿灯。
4. 可选填企业微信群机器人 Webhook，红灯会推一条 Markdown。
5. 间隔分钟数 > 0 时，服务在后台按点再查（试用或许可证有效才跑）。
6. **试用到期后仍可手动「现在检查」**；自动检查与企微推送需兑换许可证。命令行 `npx arch-viewer check` 一直免费。

生产云上的共享主机请设 `ARCH_PRO_LOCAL=0`，避免扫到别人的磁盘。自托管本机设 `ARCH_PRO_LOCAL=1`。可用 `ARCH_PRO_LOCAL_ROOT` 限制允许的根目录。

## 客户路径（Gitee / GitHub 托管评论）

1. 打开 `/account.html` 注册（自动 7 天试用）。
2. 填仓库 HTTPS URL + 能写评论的 PAT。
3. 把控制台给出的 **Webhook URL** 和 **Secret** 配到：
   - **GitHub**：Settings → Webhooks → Pull requests，Secret = 控制台 Secret。
   - **Gitee**：管理 → WebHooks → Merge Request，密码/Token = 控制台 Secret。
4. 开 PR：托管检查评论带 `<!-- av-drift-bot -->`，同一 PR 后续推送会更新同一条评论。
5. 试用到期后：Stripe 订阅，或运营发许可证兑换，或对公转账后管理员开通。

## 环境变量

复制 `.env.example`。生产必须设置：

| 变量 | 作用 |
|------|------|
| `ARCH_PRO_SECRET` | 会话加密、PAT 加密（生产必填） |
| `ARCH_PUBLIC_URL` | 对外根 URL，用于 Webhook 与 Stripe 回跳 |
| `ARCH_PRO_ADMIN_TOKEN` | 管理员开通 / 签发许可证 |
| `ARCH_PRO_LICENSE_SECRET` | 许可证 HMAC（可与 SECRET 相同） |
| `ARCH_STRIPE_SECRET_KEY` | Stripe 密钥（可选；不配则走许可证/对公） |
| `ARCH_STRIPE_PRICE_ID` | ¥29/月 价格 ID |
| `ARCH_STRIPE_WEBHOOK_SECRET` | Stripe `checkout.session.completed` |
| `ARCH_COOKIE_SECURE=1` | HTTPS 下给 Cookie 加 Secure |

## 管理员开通（对公转账 / 发票客户）

```bash
# 直接开通 31 天
curl -X POST "$ARCH_PUBLIC_URL/api/pro/admin/grant" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ARCH_PRO_ADMIN_TOKEN" \
  -d '{"email":"user@example.com","days":31}'

# 签发许可证让用户在控制台自行兑换
curl -X POST "$ARCH_PUBLIC_URL/api/pro/admin/license" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ARCH_PRO_ADMIN_TOKEN" \
  -d '{"email":"user@example.com","days":31}'
```

## Docker

```bash
export ARCH_PRO_SECRET=$(openssl rand -hex 32)
docker compose up -d
```

## 与 Community Action 的分工

| | Community | Pro 托管 |
|--|-----------|----------|
| 谁跑检查 | 客户自己的 GitHub Actions | 你的服务器 |
| 评论 | 客户需自配 token 脚本 | 本服务用客户 PAT 发评 |
| 卖点 | 模板免费 | 不用维护 CI、评论始终在 |

漏斗日志：`.data/pro/funnel.log`（signup / trial / login / pay / drift_ok / drift_found）。

## 真实托管 PR 验收（发布后执行）

> 当前本地自动化只覆盖模拟投递、基线比较与评论更新，不能证明公网部署、PAT、clone 和 provider API 已连通。真实远端验收状态：**NOT RUN**。需要维护者另行授权创建/更新 PR 或配置服务。

使用经许可的演示仓，不使用客户私有代码；GitHub 和 Gitee 分别验收，只测一个平台不能宣称另一个已通过。

1. 部署已经复验的固定版本，记录包版本或源提交及健康检查结果。密钥由维护者输入部署环境，验收记录不含 PAT、Webhook secret 或完整请求头。
2. 演示仓配置明确的层边界。由维护者授权专用、最小权限、可撤销的凭据，并按上面的客户路径连接 webhook。
3. 从无违规的 base 建 PR，只新增一条确定违例的 import。记录 PR URL、完整 base/head SHA、provider 投递状态与服务侧脱敏日志。
4. 确认评论红灯指向该新增依赖，且比较的确是 PR base，而非 head 自比较或旧图文漂移。记录评论 ID。
5. 在同一个 PR 修复该依赖并推送；确认下一次投递后同一评论 ID 被更新为绿灯，没有重复评论。
6. 在隔离演示环境模拟无法获取 base、规则语法错误两种情况；确认控制台/任务状态明确失败（规则错误为 `RULES_CONFIG_ERROR`），不能把先前绿灯当成本次结果。不可为此修改生产正常仓的凭据或基线。
7. 回收演示 webhook 和专用凭据；记录结果、未通过项、操作者和时间。只保留脱敏证据。

验收记录最少包括：平台、部署版本、PR、base/head、红灯证据、修复 head、前后评论 ID、错误场景结果和清理状态。真实付款及续费另行验证，管理员开通和沙箱支付不能代替付费证据。
