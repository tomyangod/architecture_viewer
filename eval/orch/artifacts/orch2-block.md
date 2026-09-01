# Block Diagram — 分层模块

本图展示 changedetection.io 的核心分层架构，从用户界面到数据存储与运维部署，箭头表示真实运行时数据流方向。

## 子图1：分层全景

```mermaid
flowchart TB
    subgraph L_frontend["🖥️ 前端界面"]
        direction LR
        ui_blueprint["🛒 UI蓝图<br/><small>changedetectionio/blueprint/ui</small>"]
        static_assets["🛒 静态资源<br/><small>changedetectionio/static</small>"]
    end

    subgraph L_api["🔌 API层"]
        direction LR
        watchlist_blueprint["🛒 监控列表<br/><small>changedetectionio/blueprint/watchlist</small>"]
        add_watch_ui["🛒 添加监控界面<br/><small>changedetectionio/blueprint/add_watch_ui</small>"]
        settings_blueprint["🛒 设置界面<br/><small>changedetectionio/blueprint/settings</small>"]
        api_watch["🔌 监控API<br/><small>changedetectionio/api/Watch.py</small>"]
        api_notifications["🔌 通知API<br/><small>changedetectionio/api/Notifications.py</small>"]
        api_search["🔌 搜索API<br/><small>changedetectionio/api/Search.py</small>"]
        api_tags["🔌 标签API<br/><small>changedetectionio/api/Tags.py</small>"]
        api_spec["🔌 OpenAPI规范<br/><small>changedetectionio/api/Spec.py</small>"]
    end

    subgraph L_schedule["⏰ 调度层"]
        direction LR
        scheduler["⏰ 调度器<br/><small>changedetectionio/queue_handlers.py</small>"]
        queue["⏰ 任务队列<br/><small>changedetectionio/custom_queue.py</small>"]
    end

    subgraph L_worker["⚙️ 工作进程"]
        direction LR
        worker_pool["⚙️ 工作池<br/><small>changedetectionio/worker_pool.py</small>"]
        worker["⚙️ 工作进程<br/><small>changedetectionio/worker.py</small>"]
        content_fetchers["⚙️ 内容抓取器<br/><small>changedetectionio/content_fetchers</small>"]
        browser_steps["⚙️ 浏览器步骤<br/><small>changedetectionio/browser_steps</small>"]
        diff_engine["⚙️ 差异引擎<br/><small>changedetectionio/diff</small>"]
        processors["⚙️ 处理器<br/><small>changedetectionio/processors</small>"]
    end

    subgraph L_storage["💾 存储层"]
        direction LR
        datastore[("💾 数据存储<br/><small>changedetectionio/store</small>")]
        model["💾 数据模型<br/><small>changedetectionio/model</small>"]
    end

    subgraph L_monitor["🔍 监控处理"]
        direction LR
        realtime["🔍 实时事件<br/><small>changedetectionio/realtime</small>"]
        conditions["🔍 条件评估<br/><small>changedetectionio/conditions</small>"]
        llm["🔍 LLM集成<br/><small>changedetectionio/llm</small>"]
    end

    subgraph L_ops["🚀 运维部署"]
        direction LR
        docker["🚀 Docker部署<br/><small>Dockerfile</small>"]
        compose["🚀 编排配置<br/><small>docker-compose.yml</small>"]
        entrypoint["🚀 入口脚本<br/><small>docker-entrypoint.sh</small>"]
    end

    ui_blueprint -->|调用监控API| api_watch
    ui_blueprint -->|管理通知| api_notifications
    watchlist_blueprint -->|搜索监控| api_search
    add_watch_ui -->|创建监控| api_watch
    settings_blueprint -->|配置通知| api_notifications
    api_watch -->|提交检查任务| scheduler
    scheduler -->|入队任务| queue
    queue -->|分发任务| worker_pool
    worker_pool -->|执行任务| worker
    worker -->|抓取网页| content_fetchers
    content_fetchers -->|执行浏览器步骤| browser_steps
    content_fetchers -->|保存快照| datastore
    worker -->|保存结果| datastore
    worker -->|计算差异| diff_engine
    diff_engine -->|处理差异| processors
    processors -->|评估条件| conditions
    conditions -->|智能过滤| llm
    conditions -->|触发通知| api_notifications
    realtime -->|推送实时更新| ui_blueprint
    docker -->|编排服务| compose
    compose -->|启动入口| entrypoint

    classDef frontend fill:#fce4ec,stroke:#333,stroke-width:2px;
    classDef api fill:#ede7f6,stroke:#333,stroke-width:2px;
    classDef schedule fill:#fff3e0,stroke:#333,stroke-width:2px;
    classDef worker fill:#e8f5e9,stroke:#333,stroke-width:2px;
    classDef storage fill:#e0f7fa,stroke:#333,stroke-width:2px;
    classDef monitor fill:#fffde7,stroke:#333,stroke-width:2px;
    classDef ops fill:#e8f5e9,stroke:#333,stroke-width:2px;

    class ui_blueprint,static_assets frontend;
    class watchlist_blueprint,add_watch_ui,settings_blueprint,api_watch,api_notifications,api_search,api_tags,api_spec api;
    class scheduler,queue schedule;
    class worker_pool,worker,content_fetchers,browser_steps,diff_engine,processors worker;
    class datastore,model storage;
    class realtime,conditions,llm monitor;
    class docker,compose,entrypoint ops;
```

---
*由 Architecture Viewer 编排流水线生成 · 已过事实核查*
