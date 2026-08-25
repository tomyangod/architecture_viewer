# C4 Container — 容器视图

> 📋 模板说明：在此文件中描述系统内部的主要容器（运行时进程/服务）及其职责划分。
> 拆分为 2 张子图：容器地图一览 + 数据流全景。
> 🤖 生成器填入位：从下面第一个 ```mermaid 块开始覆写，保留 ## 子图N 标题格式，参见 AGENT.md。

## 子图1： 🔄 容器地图 — 内部容器布局

```mermaid
C4Container
    title 容器地图 — 内部容器布局

    Person(user_a, "用户角色A")
    Person(user_b, "用户角色B")

    System_Boundary(platform, "[你的项目名称]") {
        Container(frontend, "前端应用", "技术栈", "职责描述")
        Container(gateway, "API 网关", "技术栈", "职责描述")
        Container(service_a, "服务A", "技术栈", "职责描述")
        Container(service_b, "服务B", "技术栈", "职责描述")
        Container(scheduler, "调度服务", "技术栈", "职责描述")
        Container(worker, "异步Worker", "技术栈", "职责描述")
        Container(monitor, "监控服务", "技术栈", "职责描述")
        ContainerDb(db_primary, "主数据库", "数据库类型", "数据描述")
        ContainerDb(db_cache, "缓存", "Redis/Memcached", "数据描述")
        ContainerDb(db_mq, "消息队列", "Kafka/RabbitMQ", "消息描述")
    }

    System_Ext(ext_a, "外部系统A")
    System_Ext(ext_b, "外部系统B")

    UpdateLayoutConfig($c4ShapeInRow="4", $c4BoundaryInRow="1")
```

## 子图2：数据流全景 — 请求→处理→存储→输出

```mermaid
C4Container
    title 数据流全景 — 请求→处理→存储→输出

    Person(user_a, "用户角色A")
    Person(user_b, "用户角色B")

    System_Boundary(platform, "[你的项目名称]") {
        Container(frontend, "前端", "UI")
        Container(gateway, "网关", "鉴权/路由")
        Container(service_a, "服务A", "业务逻辑")
        Container(service_b, "服务B", "业务逻辑")
        Container(worker, "Worker", "异步处理")
        Container(monitor, "监控", "指标/告警")
        ContainerDb(db, "数据库", "")
        ContainerDb(cache, "缓存", "")
        ContainerDb(mq, "消息队列", "")
        ContainerDb(fs, "文件系统", "本地/对象存储")
    }

    System_Ext(external, "外部依赖", "")

    Rel(user_a, frontend, "访问")
    Rel(user_b, frontend, "访问")
    Rel(frontend, gateway, "HTTP请求")
    Rel(gateway, service_a, "路由")
    Rel(gateway, service_b, "路由")
    Rel(service_a, db, "读写")
    Rel(service_a, cache, "缓存")
    Rel(service_a, mq, "发消息")
    Rel(service_b, db, "读写")
    Rel(service_b, external, "调用")
    Rel(mq, worker, "消费")
    Rel(worker, fs, "写入")
    Rel(monitor, db, "读指标")
    Rel(monitor, service_a, "探测")
    Rel(monitor, service_b, "探测")

    UpdateLayoutConfig($c4ShapeInRow="4", $c4BoundaryInRow="1")
```

---

*模板文件 · 请替换为你项目的实际内容*
