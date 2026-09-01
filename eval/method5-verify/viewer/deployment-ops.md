# Deploy & Ops — 部署运维

## 子图1：交付路径

```mermaid
flowchart LR
  build["构建 python"]
  d0["Dockerfile"]
  d1["github-actions"]
  build --> d0
  d0 --> d1
```

## 子图2：运行时探测

```mermaid
flowchart TB
  health["健康检查"] --> app["changedetection.io"]
  app --> logs["logs"]
  app --> cfg["config"]
```

---

*由 Architecture Viewer Community Generate 根据仓库扫描生成 · 请人工审阅后提交*
