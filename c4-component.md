# C4 Component — 组件详情图

> 📋 模板说明：在此文件中拆解容器内部的组件结构。
> 拆分为 2 张子图：核心服务组件 + 支撑组件。
> 🤖 生成器填入位：从下面第一个 ```mermaid 块开始覆写，保留 ## 子图N 标题格式，参见 AGENT.md。

## 子图1：核心服务 — 网关 + 业务服务 + 调度引擎

```mermaid
C4Component
    title 组件图 — 核心服务组件分解

    Container_Boundary(fe_boundary, "前端应用") {
        Component(fe_router, "路由模块", "框架路由", "页面/接口路由")
        Component(fe_store, "状态管理", "Redux/Vuex/Pinia", "全局数据状态")
        Component(fe_api, "API 封装", "Axios/Fetch", "统一请求/响应拦截")
        Component(fe_ui, "UI 组件库", "Element/AntD", "通用组件")
    }

    Container_Boundary(gw_boundary, "API 网关") {
        Component(gw_auth, "鉴权组件", "JWT/OAuth2", "登录态校验")
        Component(gw_rate, "限流组件", "令牌桶/漏桶", "QPS控制")
        Component(gw_route, "路由组件", "动态路由", "服务发现/负载均衡")
    }

    Container_Boundary(svc_boundary, "业务服务A") {
        Component(svc_ctrl, "Controller 层", "Web框架", "参数校验/响应封装")
        Component(svc_svc, "Service 层", "业务逻辑", "核心领域服务")
        Component(svc_repo, "Repository 层", "ORM/DAO", "数据访问")
        Component(svc_domain, "Domain 模型", "DDD 实体", "聚合根/值对象")
    }

    Container_Boundary(sch_boundary, "调度服务") {
        Component(sch_core, "调度核心", "Quartz/Celery", "Cron/间隔触发")
        Component(sch_job, "Job 注册", "任务注册表", "Job定义/参数")
        Component(sch_lease, "分布式锁", "Redis/DB", "防重复执行")
        Component(sch_state, "状态存储", "持久化", "上次运行/错误")
    }

    Rel(fe_router, fe_api, "调用")
    Rel(fe_api, gw_route, "HTTP")
    Rel(fe_store, fe_router, "更新")

    Rel(gw_route, gw_auth, "鉴权")
    Rel(gw_route, gw_rate, "限流")
    Rel(gw_route, svc_ctrl, "转发")

    Rel(svc_ctrl, svc_svc, "调用")
    Rel(svc_svc, svc_repo, "读写")
    Rel(svc_svc, svc_domain, "操作")

    Rel(sch_core, sch_job, "读取")
    Rel(sch_core, sch_lease, "获取锁")
    Rel(sch_core, sch_state, "读写")
    Rel(sch_core, svc_svc, "触发任务")
```

## 子图2：支撑组件 — Worker + 监控 + 基础设施

```mermaid
C4Component
    title 组件图 — Worker + 监控 + 基础设施

    Container_Boundary(worker_boundary, "异步 Worker") {
        Component(wk_consumer, "消费者", "MQ Client", "拉取/订阅消息")
        Component(wk_handler, "处理器", "业务Handler", "消息转任务")
        Component(wk_retry, "重试机制", "退避/死信", "失败重试/死信")
    }

    Container_Boundary(mon_boundary, "监控服务") {
        Component(mon_metric, "指标采集", "Prometheus SDK", "Counter/Gauge/Histogram")
        Component(mon_agg, "指标聚合", "聚合计算", "统计/汇总")
        Component(mon_alert, "告警检测", "规则引擎", "阈值/趋势检测")
        Component(mon_notify, "通知分发", "多渠道", "邮件/短信/Webhook")
    }

    Container_Boundary(infra_boundary, "基础设施") {
        Component(infra_db, "数据库连接池", "HikariCP/Druid", "连接管理")
        Component(infra_cache, "缓存客户端", "Redis Client", "读写/TTL")
        Component(infra_mq, "MQ Producer", "Kafka/Rabbit", "发布消息")
        Component(infra_log, "日志组件", "Logback/Winston", "结构化日志")
    }

    System_Ext(mq_ext, "消息队列 Broker")
    System_Ext(db_ext, "数据库")
    System_Ext(cache_ext, "Redis")
    ContainerDb(fs_ext, "文件/对象存储", "")

    Rel(wk_consumer, mq_ext, "消费")
    Rel(wk_consumer, wk_handler, "分发")
    Rel(wk_handler, wk_retry, "失败回调")
    Rel(wk_handler, infra_db, "读写")
    Rel(wk_handler, fs_ext, "写文件")

    Rel(mon_metric, mon_agg, "原始指标")
    Rel(mon_agg, mon_alert, "聚合结果")
    Rel(mon_alert, mon_notify, "触发告警")

    Rel(infra_db, db_ext, "连接")
    Rel(infra_cache, cache_ext, "连接")
    Rel(infra_mq, mq_ext, "连接")
```

---

*模板文件 · 请替换为你项目的实际内容*
