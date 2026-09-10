# 发票与对公开通

适用：Team / Pro 对公采购、个人微信暂未直连时的转账 + 开票，以及 Stripe / Lemon 电子收据。

落地页页脚「发票」链到本文。收款步骤见 [billing.md](billing.md)，工单见 [support.md](support.md)。

## 价格（与 COMMERCIAL.md 一致）

| 档位 | 价格 | 开票内容建议 |
|------|------|--------------|
| Pro | ¥29 / 月 / 账号 | 软件服务费 / 技术服务费 |
| Team | **¥999 / 年 / 仓库** | 同上；备注仓库 URL |
| 私有化 On-prem | **¥19,999 / 年起** | 软件服务费；档位见 [team-onprem.md](team-onprem.md) |

## 开票信息收集（客户填）

请一次性发到 Gitee Issue（标题：`发票 + 公司名`）或运营邮箱，**不要**在公开仓提交税号扫描件。

| 字段 | 必填 | 说明 |
|------|------|------|
| 注册邮箱 | 是 | `/account.html` 登录邮箱，用于开通 |
| 档位 | 是 | Pro 月付 / Team 年付（写仓库 HTTPS URL） |
| 开通时长 | 是 | 月数或年数 |
| 公司抬头 | 是 | 与营业执照一致 |
| 纳税人识别号 | 是 | 统一社会信用代码 |
| 开户行 + 账号 | 专票必填 | 普票可空 |
| 注册地址 + 电话 | 专票必填 | 普票可空 |
| 发票类型 | 是 | 电子普票 / 电子专票 |
| 接收邮箱 | 是 | 收 PDF 的财务邮箱 |
| 金额 | 是 | 与转账一致 |

模板：

```
抬头：
税号：
档位：Team / 仓库 https://gitee.com/org/repo / 1 年
注册邮箱：you@company.com
发票类型：电子普票
接收邮箱：finance@company.com
```

## 对公流程

1. 客户在 `/account.html` 注册（记下邮箱）。Team 可先在落地页「下单 Team」拿到 `orderId`。
2. 按上表提交开票信息 + 转账（备注 `AV-Pro` 或 `AV-Team` + 注册邮箱 + orderId）。
3. 运营核验到账后开通：

```bash
# Pro
curl -X POST "$ARCH_PUBLIC_URL/api/pro/admin/grant" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ARCH_PRO_ADMIN_TOKEN" \
  -d '{"email":"客户注册邮箱","days":31}'

# Team（¥999/年/仓库）
curl -X POST "$ARCH_PUBLIC_URL/api/pro/admin/grant" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ARCH_PRO_ADMIN_TOKEN" \
  -d '{"email":"客户注册邮箱","days":365,"plan":"team","repoUrl":"https://gitee.com/org/repo"}'
```

4. 财务开具电子发票发到「接收邮箱」。收款账号以合同/报价单为准（本仓库不存放账户密钥）。

## Stripe / Lemon 收据

- Stripe：控制台「用卡支付」后由 Stripe 发收据，一般可作入账附件；国内专票仍走对公。
- Lemon Squeezy：海外客户电子发票由 Lemon 出具；Team 商品页 `ARCH_PAY_LEMON_TEAM_URL`。
