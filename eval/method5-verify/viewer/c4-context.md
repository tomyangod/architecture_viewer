# C4 Context — 系统全景

## 子图1：系统与使用者

```mermaid
C4Context
    title changedetection.io 系统全景

    Person(user, "使用者")
    System(sys, "changedetection.io", "python")
    System_Ext(ext_runtime, "python ecosystem")

    Rel(user, sys, "使用")
    Rel(sys, ext_runtime, "uses")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## 子图2：运行时与交付面

```mermaid
C4Context
    title 交付与入口

    Person(dev, "开发者")
    Person(ops, "运维")
    System(sys, "changedetection.io", "local app")
    System_Ext(vcs, "Git")
    System_Ext(ci, "Dockerfile, github-actions")

    Rel(dev, sys, "开发")
    Rel(ops, sys, "部署/监控")
    Rel(dev, vcs, "提交")
    Rel(vcs, ci, "触发")
    Rel(ci, sys, "发布")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

---

*由 Architecture Viewer Community Generate 根据仓库扫描生成 · 请人工审阅后提交*
