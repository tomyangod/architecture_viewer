# C4 System Context — 系统上下文图

> 📋 模板说明：在此文件中描述你的项目在业务环境中的定位、用户角色及外部系统交互。
> 拆分为 2 张子图：系统全景一览 + 外部依赖详情。
> 将下方示例代码替换为你的实际项目内容。
> 🤖 生成器填入位：从下面第一个 ```mermaid 块开始覆写，保留 ## 子图N 标题格式，参见 AGENT.md。

## 子图1： 🔄 系统全景 — 用户与外部系统一览

```mermaid
C4Context
    title 系统上下文图 — [你的项目名称]

    Person(user_a, "用户角色A", "描述该用户使用系统做什么")
    Person(user_b, "用户角色B", "描述该用户使用系统做什么")

    System_Boundary(platform, "[你的项目名称]") {
        System(core, "核心系统", "一句话描述系统的核心能力")
    }

    System_Ext(ext_a, "外部系统A", "描述：提供什么能力 / API 协议")
    System_Ext(ext_b, "外部系统B", "描述：提供什么能力 / API 协议")
    System_Ext(ext_c, "外部数据存储", "描述：数据库 / 文件系统 / 缓存")
    System_Ext(ext_d, "通知服务", "描述：邮件 / 短信 / 站内信")

    Rel(user_a, core, "操作A", "操作方式：Web UI / API / CLI")
    Rel(user_b, core, "操作B", "操作方式")
    Rel(core, ext_a, "调用", "协议：REST / gRPC / ...")
    Rel(core, ext_b, "调用", "协议")
    Rel(core, ext_c, "读写", "驱动")
    Rel(core, ext_d, "发送通知", "协议")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## 子图2： 🔄 外部依赖详情 — 交互协议与数据分类

```mermaid
C4Context
    title 外部依赖详情 — 交互协议与数据流

    System_Boundary(platform, "[你的项目名称]") {
        System(core, "核心系统", "")
    }

    System_Ext(ext_a, "外部系统A", "地址 / 端点")
    System_Ext(ext_b, "外部系统B", "地址 / 端点")
    System_Ext(ext_c, "数据存储C", "连接方式")
    System_Ext(ext_d, "第三方API D", "鉴权方式")
    System_Ext(filesystem, "本地文件系统", "数据文件 / 日志 / 配置")

    Rel(core, ext_a, "具体操作描述", "详细协议")
    Rel(core, ext_b, "具体操作描述", "详细协议")
    Rel(core, ext_c, "具体数据操作", "驱动")
    Rel(core, ext_d, "具体请求", "API")
    Rel(core, filesystem, "数据文件 · 日志 · 配置", "本地IO")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

---

*模板文件 · 请替换为你项目的实际内容*
