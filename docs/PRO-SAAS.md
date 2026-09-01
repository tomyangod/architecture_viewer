# Pro SaaS 最小闭环（账号 + 托管漂移评论）

Architecture Viewer **Community** 继续免费。本页说明如何把同一套 Web 进程当成 **Pro 云** 来卖：客户注册、试用、付费，把 GitHub / Gitee 的 Merge Request / Pull Request webhook 指到你的服务，**由你代跑 `check --filled --drift` 并在 PR 上评论红灯/绿灯**。

不引入新的 npm 运行时依赖。数据在 `.data/pro/store.json`。

## 客户路径

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
