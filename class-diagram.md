# Class Diagram — 核心类结构图

> 📋 模板说明：在此文件中展示后端核心类及其关系。
> 按模块拆分为 2 张子图：业务核心类 + 基础支撑类。
> 🤖 生成器填入位：从下面第一个 ```mermaid 块开始覆写，保留 ## 子图N 标题格式，参见 AGENT.md。

## 子图1：业务核心类 — 领域模型 + 服务类

```mermaid
classDiagram
    direction TB

    class BaseEntity {
        +id Long
        +createdAt DateTime
        +updatedAt DateTime
        +createdBy String
    }

    class AggregateRootA {
        +fieldA String
        +fieldB Int
        +doBusinessLogic() void
        +validate() bool
    }

    class AggregateRootB {
        +refId Long
        +status Enum
        +transitionTo(next Enum) void
    }

    class ValueObjectX {
        +part1 String
        +part2 String
        +isValid() bool
        +equals(other Object) bool
    }

    BaseEntity <|-- AggregateRootA
    BaseEntity <|-- AggregateRootB
    AggregateRootA --> ValueObjectX : contains
    AggregateRootB --> AggregateRootA : references

    class ServiceA {
        +repositoryA RepositoryA
        +doSomething(id Long) AggregateRootA
        +create(cmd CreateCommand) Long
    }

    class ServiceB {
        +repositoryB RepositoryB
        +publishEvent(domainEvent DomainEvent) void
    }

    class RepositoryA {
        <<interface>>
        +findById(id Long) AggregateRootA
        +save(entity AggregateRootA) void
        +delete(id Long) void
    }

    class RepositoryB {
        <<interface>>
        +findById(id Long) AggregateRootB
        +save(entity AggregateRootB) void
    }

    class RepositoryAImpl {
        +findById(id Long) AggregateRootA
        +save(entity AggregateRootA) void
    }

    class RepositoryBImpl {
        +findById(id Long) AggregateRootB
        +save(entity AggregateRootB) void
    }

    RepositoryA <|.. RepositoryAImpl
    RepositoryB <|.. RepositoryBImpl

    ServiceA --> RepositoryA : uses
    ServiceB --> RepositoryB : uses
    ServiceA --> AggregateRootA : operates
    ServiceB --> AggregateRootB : operates
```

## 子图2：基础支撑类 — 基础设施 + 横切关注点

```mermaid
classDiagram
    direction TB

    class Cache {
        <<interface>>
        +get(key String) Object
        +set(key String, value Object, ttlSec Int) void
        +delete(key String) void
    }

    class RedisCache {
        +redisClient RedisClient
        +get(key String) Object
        +set(key String, value Object, ttlSec Int) void
    }

    class LocalCache {
        +map ConcurrentHashMap
        +get(key String) Object
        +set(key String, value Object, ttlSec Int) void
    }

    Cache <|.. RedisCache
    Cache <|.. LocalCache

    class CacheManager {
        +createCache(type String) Cache
        +getMultiLevelCache() Cache
    }

    CacheManager ..> Cache : creates

    class MessagePublisher {
        <<interface>>
        +publish(topic String, message Object) void
    }

    class KafkaPublisher {
        +producer KafkaProducer
        +publish(topic String, message Object) void
    }

    MessagePublisher <|.. KafkaPublisher

    class EventBus {
        +subscribers Map
        +subscribe(event Class, handler Handler) void
        +publish(event DomainEvent) void
    }

    class Logger {
        +info(msg String, ctx Map) void
        +warn(msg String, ctx Map) void
        +error(msg String, err Throwable, ctx Map) void
    }

    class RetryTemplate {
        +maxAttempts Int
        +backoffMs Long
        +execute(supplier Supplier) Object
    }

    class Tracer {
        +startSpan(name String) Span
        +endSpan(span Span, tags Map) void
        +injectContext(carrier Map) void
    }

    class HealthChecker {
        +check() HealthStatus
        +addCheck(name String, check Supplier) void
    }

    ServiceA --> Cache : uses
    ServiceA --> RetryTemplate : uses
    ServiceA --> Logger : logs
    ServiceA --> Tracer : tracing
    ServiceB --> MessagePublisher : publishes
    ServiceB --> EventBus : fires events
    HealthChecker --> RedisCache : probes
    HealthChecker --> KafkaPublisher : probes
```

---

*模板文件 · 请替换为你项目的实际内容*
