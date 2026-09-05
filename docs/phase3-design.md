# Phase 3 技术设计稿（多仓聚合 · 跨仓依赖 · 规范市场）

> 配套 [pm/retrospective-12w.md](../pm/retrospective-12w.md)。W13 backlog 启动条件见该复盘 §五。  
> 本文只定数据模型、API 轮廓与里程碑，不写实现排期细节。

## 1. 目标与非目标

**目标**

- 组织下多个 Git 仓库的架构图可聚合浏览（资产台账）。
- 跨仓库依赖边可计算并可视化（服务 / 包 / OpenAPI 级，先粗后细）。
- 团队可分享 / 订阅 `architecture-rules` 模板（规范市场雏形）。

**非目标（Phase 3 不做）**

- 替代 IDE；不强制 Marketplace 扩展。
- 自动改客户业务代码。
- 通用 CMDB；只做「架构图 + 漂移门禁」相关资产。

## 2. 多仓聚合数据模型

```
Org
  id, name, plan (team|onprem), createdAt

Repo
  id, orgId, url, displayName, provider (github|gitee|gitlab|other)
  lastScanAt, fingerprint, kitPath (relative or object key)

Asset (台账行)
  id, orgId, repoId
  kind: service | module | system | datastore | queue | external
  key: stable id (from diagram / inventory)
  title, layer?, owners[] (email), tags[]
  firstSeenAt, lastSeenAt, status: active | removed | drifted

Snapshot
  id, repoId, createdAt, source: session|generate|ci
  inventoryFingerprint
  diagrams: { name → contentHash }   // 对象存储或 git LFS
  riskSummary?: { level, findingCount }

EdgeCross (跨仓)
  id, orgId
  fromAssetId, toAssetId
  kind: http | grpc | npm | maven | message | other
  evidence: { repoId, path?, confidence }
  lastSeenAt
```

索引：`(orgId, repoId)`、`(orgId, kind, key)`、`(orgId, lastSeenAt)`。  
隐私：默认不存源码正文；只存图源 hash、元数据、可选脱敏路径。

## 3. API 轮廓（Web / 内网）

前缀建议：`/api/org/:orgId/…`（Team / On-prem 鉴权）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/repos` | 列出已绑定仓 |
| POST | `/repos` | 绑定（OAuth 授权后选仓，或 On-prem 填 URL + PAT 存客户侧） |
| POST | `/repos/:id/scan` | 触发生成 / session 对齐；异步 job |
| GET | `/assets?q=&kind=` | 台账检索 |
| GET | `/assets/:id` | 详情 + 所属仓 + 最近风险 |
| GET | `/graph/cross` | 跨仓边 + 节点（过滤 org） |
| GET/PUT | `/rules/templates` | 规范模板 CRUD（市场只读订阅另表） |
| POST | `/rules/templates/:id/fork` | 拷到本 org |

OAuth（W13-01）：GitHub / Gitee authorization code → 存 refresh（加密）→ 列仓 → clone 或 API 拉树 → 复用现有 `lib/` 生成。  
On-prem：无 OAuth 时允许「登记 URL + 客户机 runner 推 Snapshot」。

## 4. 跨仓依赖图方案

**证据优先级（高→低）**

1. 显式：`architecture-rules` / 图内 `Rel` 指向他仓 System_Ext，且 Asset 台账能解析到他仓。  
2. 包依赖：`package.json` / `go.mod` / `pom.xml` 中指向 org 内另一 Repo 的模块名。  
3. 运行时配置：环境变量 / compose 服务名与他仓 inventory.services 交集（低置信，需人工确认）。

**算法草图**

1. 每仓扫描 → 更新 Asset + 仓内边（已有）。  
2. 对 org 内所有 Repo 建 `key → assetId` 字典（服务名、npm 包名规范化）。  
3. 抽取候选跨仓边 → 去重 → `confidence` 分档 → UI 默认只显示 high/medium。  
4. 漂移：若边的 from/to Asset `status=removed` 或 fingerprint 大变，标记 `EdgeCross` 待审。

**可视化**：复用 Viewer；新增「组织视图」页，Mermaid/`graph TD` 或 Archify 图层，节点点击进单仓六视图。

## 5. 规范模板市场

- 模板 = 版本化的 `architecture-rules.yaml` + 说明 Markdown + 适用栈标签。  
- 发布者：官方 / 组织内共享；Phase 3 不做公开付费货架，只做「org 内 + 官方只读」。  
- Fork 后本地修改不回写上游；升级靠显式「同步官方版本」diff。

## 6. 里程碑（建议顺序）

| 里程碑 | 交付 | 依赖 |
|---|---|---|
| M1 | Org/Repo/Snapshot 持久化 + 单页「多仓列表」 | W13-01 OAuth 或 On-prem runner |
| M2 | Asset 台账检索 + 单仓风险汇总 | M1 |
| M3 | EdgeCross v1（包名 + 显式 Rel）+ 组织图 | M2 |
| M4 | 官方 rules 模板只读订阅 + fork | W07-02 rules 已有 |
| M5 | 置信度审阅流与审计日志（On-prem） | M3 |

## 7. 风险

- OAuth 与私有仓克隆的密钥治理（只存客户 VPC）。  
- 跨仓误边导致「架构噪音」——必须置信度与默认折叠。  
- 范围蔓延成通用服务目录；用 Asset.kind 白名单约束。
