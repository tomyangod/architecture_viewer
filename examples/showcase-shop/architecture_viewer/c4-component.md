# C4 Component — 组件详情

## 子图1：模块组件

```mermaid
C4Component
    title Coffee Shop · 咖啡订单平台（Showcase） 模块组件

    Container_Boundary(app, "Coffee Shop · 咖啡订单平台（Showcase）") {
        Component(c_frontend, "frontend", "compose", "module 1")
        Component(c_api, "api", "compose", "module 2")
        Component(c_worker, "worker", "compose", "module 3")
        Component(c_postgres, "postgres", "compose", "module 4")
        Component(c_redis, "redis", "compose", "module 5")
        Component(c_mq, "mq", "compose", "module 6")
    }

    Rel(c_frontend, c_api, "依赖")
    Rel(c_api, c_worker, "依赖")
    Rel(c_worker, c_postgres, "依赖")
    Rel(c_postgres, c_redis, "依赖")
    Rel(c_redis, c_mq, "依赖")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## 子图2：领域类组件

```mermaid
C4Component
    title 领域类

    Container_Boundary(domain, "domain") {
        Component(boundary_api, "API/入口", "iface", "")
        Component(cls_app, "App", "class", "")
        Component(cls_inventory_service, "InventoryService", "class", "")
        Component(cls_order_service, "OrderService", "class", "")
        Component(cls_payment_service, "PaymentService", "class", "")
    }

    Rel(boundary_api, cls_app, "调用")
    Rel(cls_app, cls_inventory_service, "协作")
    Rel(cls_inventory_service, cls_order_service, "协作")
    Rel(cls_order_service, cls_payment_service, "协作")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

---

*由 Architecture Viewer Community Generate 根据仓库扫描生成 · 请人工审阅后提交*
