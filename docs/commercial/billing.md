# Pro 收款与开通 SOP

> 先收款、再开通。国内走爱发电 / 微信；海外走 Lemon Squeezy（可沙箱）；卡支付仍可用已有 Stripe Checkout。
> 公开链接由 `web/lib/billing.js` 读环境变量，落地页定价区与控制台可点。

## 公开收款链接

| 通道 | 环境变量 | 默认占位（运营上线前替换） |
|------|----------|---------------------------|
| 爱发电 | `ARCH_PAY_AFDIAN_URL` | `https://afdian.com/a/architecture-viewer` |
| 微信 | `ARCH_PAY_WECHAT_URL` | 本文件 [微信收款](#微信收款) 锚点（Gitee 上可点） |
| Lemon Squeezy | `ARCH_PAY_LEMON_URL` | `https://arch-viewer.lemonsqueezy.com/`（店面占位 / 沙箱店） |
| Stripe | `ARCH_STRIPE_*` | 控制台「用卡支付」→ Checkout（见 [PRO-SAAS.md](PRO-SAAS.md)） |

落地页：`/#pricing` · API：`GET /api/billing/links` · 说明：本文件。

价格（2026-09-16 COMMERCIAL v3）：**Pro ¥29 / 月或 ¥199 / 年（赞助档）** · **Team 入门包 ¥4,999 / 年（人工报价）** · **AI 改码架构体检 ¥1,999 / 次**（早鸟 **¥999** 限 3 席至 2026-09-30，见 [diagnostic-service.md](diagnostic-service.md)） · Team 按席 ¥99 / 人 / 月仍验证期人工申请，与 [COMMERCIAL.md](COMMERCIAL.md) 一致。

Team 验证期不开放自助下单：落地页定价卡「申请试点」或 `POST /api/billing/team-application` `{ email, repoUrl?, channel, teamSize? }`，只登记意向、不生成订单、不开通；`repoUrl` 选填，填写时才校验 `http(s)://` 格式。人工报价（2 个工作日内联系）成交后由管理员走开通流程。

---

## 付款 → 核验 → 开通 Pro

### 1. 付款（客户）

1. 打开落地页定价区或 `/account.html`，先用邮箱注册 / 登录（记下注册邮箱）。
2. 选通道付款：
   - **爱发电**：点「爱发电」赞助 ¥29（或「包月」档），留言写注册邮箱。
   - **微信**：按 [微信收款](#微信收款) 转账，备注 `AV-Pro + 注册邮箱`。
   - **Lemon Squeezy**：海外卡支付商品页；Checkout 成功页邮箱尽量与注册邮箱一致。
   - **Stripe**：控制台「用卡支付」（已配置 `ARCH_STRIPE_*` 时）。
3. 保存付款截图 / 订单号，发到运营邮箱或 Issue（勿贴完整卡号）。

### 2. 核验（运营）

1. 对照通道后台：爱发电订单留言、微信账单备注、Lemon 订单邮箱、Stripe Dashboard。
2. 确认金额 ≥ ¥29（或等价外币）且备注邮箱能对应到 `/account.html` 账号。
3. 有疑义先邮件确认，勿重复开通。

### 3. 开通 Pro（运营）

**方式 A · 管理员 API（推荐）**

```bash
curl -X POST "$ARCH_PUBLIC_URL/api/pro/admin/grant" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ARCH_PRO_ADMIN_TOKEN" \
  -d '{"email":"客户注册邮箱","days":31}'
```

**方式 B · 许可证兑换**

```bash
# 签发（运营机）
curl -X POST "$ARCH_PUBLIC_URL/api/pro/admin/license" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ARCH_PRO_ADMIN_TOKEN" \
  -d '{"email":"客户注册邮箱","days":31}'
# 把返回的 avpro.… 发给客户，在控制台「兑换许可证」粘贴
```

**方式 C · Stripe Webhook**

已配置 `ARCH_STRIPE_WEBHOOK_SECRET` 时，`checkout.session.completed` 自动 `grantPro`，无需本步。

开通后请客户执行 `arch-viewer auth whoami` 或刷新控制台，确认 `entitlement=pro` / `active=true`。

---

## 微信收款

暂无独立商户号时：

1. 运营用个人/对公微信收款码（**勿**把静态二维码提交进公开 git；放在私密运营文档或 `ARCH_PAY_WECHAT_URL` 指向的私有页）。
2. 客户转账备注：
   - Pro：`AV-Pro you@example.com`
   - 架构体检：`AV-Diagnostic` + 微信号或邮箱（私有仓不要写仓库 URL）
   - Team：`AV-Team` + 注册邮箱（成交后开通，见 [invoice.md](invoice.md)）
3. 运营按上文「核验 → 开通」执行；**体检不是开通许可证**，核验后按 [diagnostic-service.md](diagnostic-service.md) 排期交付（到账后 48 小时内）。
4. 需要发票：走 [invoice.md](invoice.md) 对公流程。

把 `ARCH_PAY_WECHAT_URL` 设成你托管的说明页后，定价区「微信预约 / 微信」按钮会直达该页。落地页体检卡的预约按钮 `id="pay-wechat"` 指向本锚点（或环境变量覆盖）。

### 诊断服务（同一微信通道）

不另开商户、不新增支付链接。客户按上表转 **¥999**（早鸟，2026-09-30 前且 3 席未满）或 **¥1,999**，备注 `AV-Diagnostic`。无有效发现全额退款，条件写在成交页。私有仓扫描在客户机器上跑，零上传。

---

## 爱发电

1. 在爱发电创建创作者页，设赞助方案「Architecture Viewer Pro · ¥29/月」。
2. 要求赞助留言填写注册邮箱。
3. 把创作者页 URL 写入 `ARCH_PAY_AFDIAN_URL`。
4. 到账后按「核验 → 开通」执行（可半自动：导出 CSV 对账 + grant 脚本）。

---

## Lemon Squeezy（海外 / 沙箱）

1. 注册 [Lemon Squeezy](https://www.lemonsqueezy.com/)，创建 Store（测试可用 Test Mode）。
2. 新建 Product：`Architecture Viewer Pro`，订阅或一次性 $4（约合 ¥29，可按汇率微调）。
3. 复制 Storefront / Product 公开链接 → `ARCH_PAY_LEMON_URL`。
4. 沙箱店面占位默认：`https://arch-viewer.lemonsqueezy.com/`（上线前换成真实 slug）。
5. Webhook（可选，后续自动化）：订单 `order_created` → 调本仓 `admin/grant`；现阶段允许人工开通。

税务/VAT 由 Lemon 代扣，适合海外个人客户；国内客户优先爱发电 / 微信。

---

## 环境变量速查

```bash
# .env
ARCH_PAY_AFDIAN_URL=https://afdian.com/a/你的创作者名
ARCH_PAY_WECHAT_URL=https://你的域名/pay-wechat.html
ARCH_PAY_LEMON_URL=https://你的店.lemonsqueezy.com/checkout/buy/……

# 已有
ARCH_PUBLIC_URL=https://arch.example.com
ARCH_PRO_ADMIN_TOKEN=…
# ARCH_STRIPE_SECRET_KEY=…
# ARCH_STRIPE_PRICE_ID=…
```

查询当前生效链接：

```bash
curl -s http://127.0.0.1:3847/api/billing/links | jq .
```

---

## 相关文档

- [COMMERCIAL.md](COMMERCIAL.md) — 定价与 Community 边界  
- [PRO-SAAS.md](PRO-SAAS.md) — 账号 / Webhook / Stripe  
- [invoice.md](invoice.md) — 对公与开票  
- [support.md](support.md) — 工单渠道  
