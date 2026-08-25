# Deployment & Operations View — 部署运维图

> 📋 模板说明：在此文件中展示运行时进程拓扑、数据资产、配置结构与健康检查。
> 运维关注的 5 大要素：启动顺序 · 健康检查 · 配置文件 · 数据资产 · 消费端。
> 🤖 生成器填入位：从下面第一个 ```mermaid 块开始覆写，保留 ## 子图N 标题格式，参见 AGENT.md。

## 进程与数据总览

```mermaid
flowchart TB
    subgraph PROCESS["🔢 启动顺序 / 进程拓扑"]
        direction LR
        S1["① 基础设施<br/>DB · Redis · MQ · K8s"]
        S2["② 配置中心<br/>Nacos · Apollo · Consul"]
        S3["③ 核心服务<br/>Gateway · Service A · Service B"]
        S4["④ 异步任务<br/>Worker · 调度器 · Job"]
        S5["⑤ 监控探针<br/>Prometheus · Agent · Sidecar"]
    end

    subgraph HEALTH["✅ 健康检查"]
        direction LR
        HC1["Gateway /health → 200<br/>+ 依赖级联探测"]
        HC2["服务 /actuator/health<br/>Liveness · Readiness"]
        HC3["DB / Redis / MQ<br/>连接池状态 + 探测查询"]
        HC4["Worker 心跳<br/>日志心跳 + 任务进度上报"]
    end

    subgraph CONFIG["⚙️ 配置文件"]
        direction LR
        C1[("application.yml<br/>服务端口 · 数据源 · 日志级别")]
        C2[("bootstrap.yml<br/>配置中心地址 · 环境")]
        C3[("业务配置<br/>feature flags · 规则参数")]
        C4[("Secret<br/>密码 · Token · 密钥（KMS）")]
    end

    subgraph FILES["📁 关键数据资产"]
        direction LR
        F1[("数据库表<br/>核心业务库 · 分库分表")]
        F2[("缓存 Key 空间<br/>前缀约定 · TTL 策略")]
        F3[("消息 Topic<br/>分区数 · 副本 · 消费组")]
        F4[("日志与审计<br/>结构化日志 · 操作审计")]
        F5[("备份与快照<br/>DB 备份 · 对象存储归档")]
    end

    subgraph CONSUMERS["📥 消费端 / 下游依赖"]
        direction LR
        D1["客户端应用<br/>Web · App · 小程序"]
        D2["开放平台<br/>第三方 API 接入方"]
        D3["分析/数仓<br/>ETL · BI · 报表"]
        D4["运维平台<br/>监控大盘 · 告警中心"]
    end

    S1 --> S2 --> S3 --> S4 --> S5
    S3 -.-> HC2
    S4 -.-> HC4
    S1 -.-> HC3

    S3 --> C1
    S3 --> C2
    S3 --> C3
    S2 --> C4

    S3 --> F1
    S3 --> F2
    S3 --> F3
    S4 --> F4
    S1 --> F5

    F1 --> D1
    F1 --> D2
    F3 --> D3
    F4 --> D4

    classDef proc fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    classDef hc fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef conf fill:#e8eaf6,stroke:#283593,stroke-width:1.5px
    classDef data fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef cons fill:#fce4ec,stroke:#c2185b,stroke-width:2px

    class S1,S2,S3,S4,S5 proc
    class HC1,HC2,HC3,HC4 hc
    class C1,C2,C3,C4 conf
    class F1,F2,F3,F4,F5 data
    class D1,D2,D3,D4 cons

    style PROCESS fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style HEALTH fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    style CONFIG fill:#e8eaf6,stroke:#3949ab,stroke-width:1.5px,stroke-dasharray:4 4
    style FILES fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    style CONSUMERS fill:#fce4ec,stroke:#c2185b,stroke-width:2px
```

---

*模板文件 · 请替换为你项目的实际内容*
