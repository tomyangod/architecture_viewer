# 发票与对公开通

适用：个人支付宝/微信暂未直连时的 **对公转账 + 开票**，以及 Stripe 收据。

## 价格

- Pro：¥29 / 月 / 账号（无限托管仓库数以公平使用为限，异常用量另行协商）
- Team：¥999 / 年 / 仓库（私有化与组织规范另议）

## 对公流程

1. 客户在 `/account.html` 注册（记下邮箱）。
2. 向运营提供：公司抬头、税号、邮箱、开通月数。
3. 转账备注「Architecture Viewer Pro + 注册邮箱」。
4. 运营执行：

```bash
curl -X POST "$ARCH_PUBLIC_URL/api/pro/admin/grant" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ARCH_PRO_ADMIN_TOKEN" \
  -d '{"email":"客户注册邮箱","days":31}'
```

5. 开票信息由运营用财务软件开具后发到客户邮箱。收款账号以合同/报价单为准（本仓库不存放账户密钥）。

## Stripe

配置 `ARCH_STRIPE_SECRET_KEY` 与 `ARCH_STRIPE_PRICE_ID` 后，控制台「用卡支付」走 Checkout。Webhook 指向 `POST /api/pro/billing/stripe`。发票由 Stripe 自动发送。
