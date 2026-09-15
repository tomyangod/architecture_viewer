# 固定试点版发布冒烟清单

> 当前候选：0.12.2-rc.6（解释闭环 / 分层门禁解耦；发布记录见 docs/commercial/npm-publish.md）。rc.4（默认交付收缩）与 rc.3（81e6c43）已于 2026-09-14 发布。历史 rc.2 本地验收记录保留在下方，勿改写。每项记录版本、执行时间、命令和结果；未执行写 NOT RUN，不用本地模拟替代远端验收。

## 本次本地验收记录（2026-09-11）

| 检查 | 结果 |
|------|------|
| 环境 | macOS arm64，Node v25.8.2，npm 11.11.1；其他 Node/OS 组合未在本次复验 |
| 源码定向测试 | 首轮 W24 + CLI/MCP：118/118；基线/scope 21/21、托管/规则 140/140；最终目录遍历/YAML 兼容及关联回归 86/86 |
| 既有 `prepublishOnly` | 全部已知审查问题修复后 840 通过、0 失败、1 跳过（需付费 API 的盲评回归未启用） |
| 实际 tarball | 141 文件，版本/清单检查通过，不含 `.av` / `.data` / `.env` / `pm` / `test` |
| 仓库外全新安装 | 最终重新打包并重建本次消费目录后，223 条 CLI/MCP/scope/Pro/clone/规则/退出码/setup/guard 回归全部通过 |
| 同一快照 CLI 实测 | 无基线 exit 4；初始 exit 0 → 跨层 import exit 1 → 修复 exit 0；改排除配置出现范围变化提示；损坏 YAML exit 2 |
| 本机 Web | 安装包健康检查报告 rc.2；浏览器 Team ¥99/人/月、人工申请且无自助下单 |
| 主仓基线 | SHA-256 前后核对未变；未刷新、未自动接受架构变化 |
| 结构复检 | 对照现有快照，使用 session report 同源管线只读生成：78 项结构变更，HIGH 30 / MEDIUM 8 / LOW 38 / INFO 1；HIGH 全为 broad-impact；跨层违规/类型删除/新增外部依赖均为 0，仍待负责人接受 |
| 远端验证 | npm `next=0.12.2-rc.2` 已发布；registry 全新安装 + CLI 冒烟（0→1→0、坏规则 exit 2）通过；真实公网 PR、客户接入仍 **NOT RUN** |

已知非核心限制：npm 包不带落地页演示媒体，本地浏览器请求 `demo.zh.vtt` 返回 404；本轮不据此宣称营销视频可用，源码部署演示媒体另行验收。

干净安装回归只向消费目录补入现有测试和规则 fixtures，没有复制生产源码或主仓依赖。Node 的测试发现会忽略路径中的 `node_modules`，执行时先进入已安装包根，再用 `node --test test/…`。

日志、清单和 tarball 保存在本次会话的 `pilot-0.12.2-rc.2` 产物目录。以下清单用于提交/发布审批后的最终复核，不能用本地通过替代未执行项。

**审查后重新打包**：此前冒烟包已被最终修复版替换，不用于分发。当前 tarball SHA-256：`e485c081ef2818a4ce5b65ae32d5440ce61bf063ed1e2e529a6843a9369f931b`。修复包括两端图完整性检查、YAML/规则结构拒绝静默容错、HEAD 排除范围与缓存迁移，并补齐子目录不可读与合法列表多空格缩进的复核反馈及回归。

## 本地源代码与安装包

- [ ] `npm run prepublishOnly` 通过既有语法检查与测试；记录 skip 项及原因。
- [ ] 包版本、lockfile、CHANGELOG 一致；新增源码已纳入包。
- [ ] tarball 不含 `.env`、`.data`、`.av`、客户数据或临时文件；记录清单及 SHA-256。
- [ ] 全新目录安装 tarball，安装后 CLI `--version` 为当前候选版（现为 0.12.2-rc.3）。
- [ ] 所有场景在临时演示仓执行，不写主仓/客户仓基线或 IDE 全局配置。

## CLI 与 MCP

- [ ] 临时 Git 仓未改动时 `session report --renderer builtin` exit 0，对照 git HEAD。
- [ ] 新增跨层 import 时报告包含具体 finding、JSON/HTML，exit 1；修复后 exit 0。
- [ ] 非 Git 仓无快照时 report exit 4；仅临时仓可使用 `session start` 建快照。
- [ ] 无效规则明确返回配置错误，不伪装绿灯。
- [ ] 新增目录排除时显示分析范围变化，不将排除当成代码修复。
- [ ] MCP `initialize` 返回包版本，`tools/list` 有 8 个工具（含 `av_guard`、`av_status`），均显式要求 repo。
- [ ] 安装包中的 MCP 可对临时仓调用 `av_guard`，结果与 CLI 同源；结束时关闭进程。
- [ ] setup 只在隔离 HOME/临时项目验证，不修改维护者真实 AI 工具配置。

## 托管与网页

- [ ] 无效/不可达 PR base 明确返回错误，不用 head 自比较。
- [ ] 团队规则格式错误返回 `RULES_CONFIG_ERROR`，正常无配置可运行。
- [ ] 本地 HTTP/Webhook 自动化红灯、修复绿灯及同评论更新测试通过。
- [ ] Team 为人工试点申请，无固定订单金额、旧付款链接或自动 grant。
- [ ] 本机 Web 健康端点响应正常，定价及申请入口显示一致。
- [ ] 真实远端 PR 链路：按 [PRO-SAAS](../../docs/commercial/PRO-SAAS.md#真实托管-pr-验收发布后执行) 记录 PR、base/head SHA、评论 ID 和投递结果。未获授权时 **NOT RUN**。

## 架构与最终发布

- [ ] 生成结构报告并审核 HIGH；不把影响面告警等同实际违规，也不自动忽略。
- [ ] 负责人已明确接受本轮变更；基线刷新不作为自动步骤。
- [ ] 提交范围经确认，无遗失的新源码。禁止从未审查的脏工作区直接发布。
- [ ] 从干净提交重打包复验；只有批准后才发布 `next`，不改 `latest`。
- [ ] registry 全新安装及 integrity 比对通过后，才把版本发给试点团队。

## 扩展验收（暂缓）

VS Code 扩展打包与 Marketplace 不属于本轮 CLI/MCP/托管试点准出要求，不以本清单宣称已验证。恢复该渠道时另跑现有 VSIX 构建和浏览器测试。
