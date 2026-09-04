# stub

## 子图1：ok

```mermaid
C4Component
    title ok
    Container_Boundary(app, "app") {
        Component(order_service, "order service", "Go", "")
        Component(order_repo, "order repo", "SQL", "")
    }
    Rel(order_service, order_repo, "SQL")
    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## 子图2：ok2

```mermaid
C4Component
    title ok2
    Container_Boundary(app, "app") {
        Component(order_service, "order service", "Go", "")
        Component(order_repo, "order repo", "SQL", "")
    }
    Rel(order_service, order_repo, "SQL")
    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

---

*generated stub*
