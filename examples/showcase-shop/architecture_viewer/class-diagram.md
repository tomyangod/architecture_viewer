# Class Diagram — 代码结构

## 子图1：扫描到的类型

```mermaid
classDiagram
  class App {
    +from main.py
  }
  class InventoryService {
    +from services/inventory_service.py
  }
  class OrderService {
    +from services/order_service.py
  }
  class PaymentService {
    +from services/payment_service.py
  }
  App ..> InventoryService : uses
  InventoryService ..> OrderService : uses
  OrderService ..> PaymentService : uses
```

## 子图2：入口关系

```mermaid
classDiagram
  class Entrypoint {
    +main
  }
  class App {
    +domain
  }
  Entrypoint --> App
```

---

*由 Architecture Viewer Community Generate 根据仓库扫描生成 · 请人工审阅后提交*
