# 脱敏红→绿样例（试点演示用）

> 性质声明：**这是人为构造的功能演示，不是客户发现。** 仓库名、类名、业务均为虚构通用示例（sample-shop 订单服务）。
> 用途：访谈/首次接入时 2 分钟复现"AI 改码引入跨层依赖 → 红灯 → 修复 → 绿灯"。
> 版本：接入命令钉 `arch-viewer@0.12.2-rc.3`（npm `next`）；下面「实测输出」仍是 2026-09-12 在 rc.2 上录的，演示形态未改。不要用 `@latest`（0.12.1 不含本轮修复）。
> 关联：[触达模板](outreach-kit.md) · [招募与接入流程](seed-users.md) · [验证计划](../plans/pilot-validation-6w.md)

## 一句话说明（演示时口述）

> 这个小仓库分三层：控制器 → 服务 → 存储。正常改动是绿灯；我让 AI 加一个"保存后直接写库"的快捷逻辑，它在控制器里直接 import 了存储层，绕过服务层——这是人工评审容易放过、但结构上明确违规的改动。AV 对照 git HEAD 把它标成 HIGH 红灯；撤销后恢复绿灯。

## 仓库结构（全部为虚构示例）

```text
sample-shop/
├── architecture-rules.yaml          # 团队分层禁令（可选；无此文件内置规则也会报层级穿透）
└── app/
    ├── controllers/order_controller.py
    ├── services/order_service.py
    └── database/orders_repo.py
```

基线代码（依赖方向 controller → service → storage，合规）：

```python
# app/controllers/order_controller.py
from app.services.order_service import OrderService

class OrderController:
    def __init__(self):
        self.service = OrderService()
    def create(self, payload):
        return self.service.place(payload["sku"], payload["qty"])
```

可选的团队规则文件（演示"团队约定也能进灯"）：

```yaml
version: 1
forbid_cross_layer:
  - id: no-controller-to-storage
    from: controller
    to: storage
    message: 控制层不得绕过服务层直接访问存储层
```

## 复现步骤

```bash
# 0. 前置：Node ≥ 18、git
# 1. 建仓并提交基线（文件内容见上，service/storage 两个文件任意最小实现即可）
cd sample-shop && git init && git add -A && git commit -m baseline

# 2. 基线报告：绿灯（对照 git HEAD，无需 session start）
npx --yes arch-viewer@0.12.2-rc.3 session report . --renderer builtin
# 退出码 0

# 3. 模拟 AI 的"快捷"改动：控制器直接 import 存储层
#    在 order_controller.py 顶部加：
#    from app.database.orders_repo import OrdersRepository
#    并在 create() 里调用 OrdersRepository().save(order)

# 4. 再次报告：红灯，退出码 1
npx --yes arch-viewer@0.12.2-rc.3 session report . --renderer builtin

# 5. 撤销违规改动（走服务层），恢复绿灯
git checkout app/controllers/order_controller.py
npx --yes arch-viewer@0.12.2-rc.3 session report . --renderer builtin
# 退出码 0
```

## 实测输出（2026-09-12，rc.2）

**第 4 步红灯（节选，退出码 1）：**

```text
--- 新增关系 ---
  + file:app/controllers/order_controller.py --import--> file:app/database/orders_repo.py

--- 风险发现 ---
  🔴 [HIGH] 层级穿透: 控制器 直接访问 存储，跳过了服务层
     order_controller.py → orders_repo.py (import)
  🔴 [HIGH] 团队分层禁令: 控制层不得绕过服务层直接访问存储层
     order_controller.py → orders_repo.py (import)
  🟠 [MEDIUM] 行为变更无测试跟进: "OrderController.create" 行为指纹变了，关联测试文件本轮未改动
```

要点：每条发现都带**具体文件、方向、规则名**，可人工复核；同时区分"结构违规（HIGH）"与"函数体变化（INFO，不判业务对错）"。

**第 5 步绿灯（退出码 0）：**

```text
✅ 架构验收门通过：退出码 = 0，检测到源码内容变化，未检测到架构结构变化。未检查业务逻辑。
```

## PR 评论形态（托管/自托管 Action 时同一结论出现在 PR 里）

```markdown
<!-- arch-viewer:architecture-diff -->
## 🏛️ 架构变更影响面

**风险等级：🔴 高风险** · 被改实体 2 个 · 受影响下游 0 个

| 类别 | 新增 | 删除 | 修改 | 重命名 |
| --- | ---: | ---: | ---: | ---: |
| 依赖边 | 1 | 0 | — | — |

### ⚠️ 风险发现

- 🔴 **层级穿透**：控制器 直接访问 存储，跳过了服务层 — order_controller.py → orders_repo.py (import)
- ⚪ 1 条提示性发现已折叠
```

修复后**同一条评论更新为绿灯**（upsert，不重复刷屏）。托管公网自动投递目前状态为 NOT RUN（见 [PRO-SAAS.md](../../docs/commercial/PRO-SAAS.md)），试点阶段以本地 CLI 为准，演示 PR 评论可用自托管 Action 或本地 `pr-comment <base-dir> <head-dir>` 命令生成。

## 演示纪律

- 明确说"这是我构造的例子"，不暗示来自某客户。
- 绿灯不等于代码正确：不替代测试、类型检查、安全审查和人工评审，口述时点明。
- 演示改动不提交、不刷新基线消红灯；客户真实仓首次演示在临时分支进行。
- 客户自己的仓跑出的第一条**真实**发现，才记入 [seed-users.md](seed-users.md) 的 Finding 明细。
