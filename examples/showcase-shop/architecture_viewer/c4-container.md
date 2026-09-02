# C4 Container — 容器视图

## 子图1：内部容器布局

```mermaid
C4Container
    title Coffee Shop · 咖啡订单平台（Showcase） 容器地图

    Person(user, "使用者")

    System_Boundary(platform, "Coffee Shop · 咖啡订单平台（Showcase）") {
        Container(frontend, "frontend", "compose", "docker-compose.yml")
        Container(api, "api", "compose", "docker-compose.yml")
        Container(worker, "worker", "compose", "docker-compose.yml")
        Container(postgres, "postgres", "compose", "docker-compose.yml")
        Container(redis, "redis", "compose", "docker-compose.yml")
        Container(mq, "mq", "compose", "docker-compose.yml")
        Container(backend, "backend", "javascript", "backend")
        Container(config, "config", "javascript", "backend")
        Container(deploy, "deploy", "Ops", "ops")
        Container(backend_services, "backend/services", "javascript", "backend")
    }

    System_Ext(ext_dep, "外部依赖")

    Rel(user, frontend, "访问")
    Rel(backend_services, ext_dep, "调用")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## 子图2：协作数据流

```mermaid
C4Container
    title 容器协作

    Person(user, "使用者")

    System_Boundary(platform, "Coffee Shop · 咖啡订单平台（Showcase）") {
        Container(frontend, "frontend", "compose", "docker-compose.yml")
        Container(api, "api", "compose", "docker-compose.yml")
        Container(worker, "worker", "compose", "docker-compose.yml")
        Container(postgres, "postgres", "compose", "docker-compose.yml")
        Container(redis, "redis", "compose", "docker-compose.yml")
        Container(mq, "mq", "compose", "docker-compose.yml")
        Container(backend, "backend", "javascript", "backend")
        Container(config, "config", "javascript", "backend")
        Container(deploy, "deploy", "Ops", "ops")
        Container(backend_services, "backend/services", "javascript", "backend")
    }

    System_Ext(ext_dep, "外部依赖")

    Rel(user, frontend, "访问")
    Rel(frontend, api, "协作")
    Rel(api, worker, "协作")
    Rel(worker, postgres, "协作")
    Rel(postgres, redis, "协作")
    Rel(redis, mq, "协作")
    Rel(mq, backend, "协作")
    Rel(backend, config, "协作")
    Rel(config, deploy, "协作")
    Rel(deploy, backend_services, "协作")
    Rel(backend_services, ext_dep, "调用")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

---

*由 Architecture Viewer Community Generate 根据仓库扫描生成 · 请人工审阅后提交*
