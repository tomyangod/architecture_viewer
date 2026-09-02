# 小白演示仓 · beginner-demo

这是一个**故意写得很短**的迷你订单系统，用来跟做「AI 会话架构验收」教程。

## 目录说明

| 目录 | 含义 |
|------|------|
| `v1/` | **改之前**：分层干净（控制器 → 服务 → 仓储） |
| `v2-ai-patch/` | **模拟 AI 改坏**：新增 `PaymentService`，且控制器直接碰了仓储 |

## 一键跟做（推荐）

在仓库根目录：

```bash
bash scripts/beginner-demo.sh
```

脚本会：复制 v1 → 记录基线 → 叠上 AI 补丁 → 生成报告 → 自动打开 HTML。

## 手动跟做

```bash
# 1. 复制一份干净代码到临时目录
DEMO=/tmp/av-beginner-demo
rm -rf "$DEMO" && cp -R examples/beginner-demo/v1 "$DEMO"

# 2. AI 改代码前：拍一张「基线」
node lib/cli.js session start "$DEMO"

# 3. 模拟 AI 改坏（把 v2 补丁盖上去）
cp examples/beginner-demo/v2-ai-patch/service/payment_service.py "$DEMO/service/"
cp examples/beginner-demo/v2-ai-patch/controller/order_controller.py "$DEMO/controller/"

# 4. 看架构变了什么
node lib/cli.js session report "$DEMO" --open
```

浏览器会打开 `.av/session-report.html`。你会看到：

- 新增类型：`PaymentService`
- 风险：控制器 → 仓储 **层级穿透**（HIGH）

完整图文攻略：[docs/beginner-guide/index.html](../../docs/beginner-guide/index.html)

离线预览一份已生成的报告样例：[sample-session-report.html](./sample-session-report.html)（打开后点「仅违规」）
