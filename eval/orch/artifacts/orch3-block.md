# Block Diagram — 分层模块

> 本图展示 changedetection.io 的核心分层架构与运行时数据流。用户通过 `changedetection.py` 启动 Flask 应用，创建监控任务后由队列调度 worker 抓取网页内容，检测到变化后经 `notification_service` 调用通知渠道发送告警。

## 子图1：分层全景

```mermaid
flowchart TB
    subgraph L_frontend["🖥️ 前端界面"]
        direction LR
        templates["🛒 页面模板<br/><small>changedetectionio/templates</small>"]
        static["🛒 静态资源<br/><small>changedetectionio/static</small>"]
    end

    subgraph L_api["🔌 API层"]
        direction LR
        entrypoint["🛒 进程入口<br/><small>changedetection.py</small>"]
        flask_app["🛒 Flask应用<br/><small>changedetectionio/flask_app.py</small>"]
        api["🛒 REST API<br/><small>changedetectionio/api</small>"]
    end

    subgraph L_schedule["⏰ 调度层"]
        direction LR
        queue_handlers["🛒 任务队列处理<br/><small>changedetectionio/queue_handlers.py</small>"]
    end

    subgraph L_worker["⚙️ 工作层"]
        direction LR
        worker["🛒 采集Worker<br/><small>changedetectionio/worker.py</small>"]
        worker_pool["🛒 Worker池<br/><small>changedetectionio/worker_pool.py</small>"]
        content_fetchers["🛒 抓取器<br/><small>changedetectionio/content_fetchers</small>"]
    end

    subgraph L_storage["💾 存储层"]
        direction LR
        store[("💾 数据存储<br/><small>changedetectionio/store</small>")]
    end

    subgraph L_monitor["🔔 监控通知层"]
        direction LR
        notification_service["🛒 通知服务<br/><small>changedetectionio/notification_service.py</small>"]
        notification["🛒 通知渠道<br/><small>changedetectionio/notification</small>"]
        realtime["🛒 实时推送<br/><small>changedetectionio/realtime</small>"]
    end

    subgraph L_ops["🚀 运维部署"]
        direction LR
        docker_compose["🛒 Docker编排<br/><small>docker-compose.yml</small>"]
    end

    templates -->|渲染页面| flask_app
    static -->|提供静态资源| flask_app
    entrypoint -->|启动应用| flask_app
    flask_app -->|挂载API| api
    api -->|投递重检任务| queue_handlers
    queue_handlers -->|分发任务| worker_pool
    worker_pool -->|调度Worker| worker
    worker -->|调用抓取器| content_fetchers
    content_fetchers -->|保存快照| store
    worker -->|检测到变更| notification_service
    notification_service -->|发送通知| notification
    notification_service -->|推送实时事件| realtime
    docker_compose -->|容器启动| entrypoint

    classDef frontendClass fill:#fce4ec,stroke:#333,stroke-width:2px;
    classDef apiClass fill:#ede7f6,stroke:#333,stroke-width:2px;
    classDef scheduleClass fill:#fff3e0,stroke:#333,stroke-width:2px;
    classDef workerClass fill:#e8f5e9,stroke:#333,stroke-width:2px;
    classDef storageClass fill:#e0f7fa,stroke:#333,stroke-width:2px;
    classDef monitorClass fill:#fffde7,stroke:#333,stroke-width:2px;
    classDef opsClass fill:#e8f5e9,stroke:#333,stroke-width:2px;

    class templates,static frontendClass;
    class entrypoint,flask_app,api apiClass;
    class queue_handlers scheduleClass;
    class worker,worker_pool,content_fetchers workerClass;
    class store storageClass;
    class notification_service,notification,realtime monitorClass;
    class docker_compose opsClass;
```

---
*由 Architecture Viewer 编排流水线生成 · 已过事实核查*
