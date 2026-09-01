# Edge-case 四仓：用法1 vs 用法7s（dsh + 路径闸门 + 扫尾）

样本同 [SCORE-EDGE.md](./SCORE-EDGE.md)：ntfy · vaultwarden · zigbee2mqtt · caddy  
日期：2026-08-31  
流水线：`usage7-gated.js` → `usage7-sweep.js`  
产物：`/tmp/arch-orch/out/usage7g-*` → `usage7s-*`；用法1 仍用既有 `usage1-*`

## 一句话

在 **常规 Web 应用** 上用法7s 可追平用法1；本页是 7s 在 edge 上的对照（当时 orch4 尚未接 shape）。**orch4+shape 正式验收**见 [SCORE-EDGE-ACCEPT.md](./SCORE-EDGE-ACCEPT.md)（四仓 Δ +1.50），不要用本页的 orch4 6.8 当分。

当时结论：7s 在 edge 上 **显著好于当时的 orch4**，但仍 **逊于用法1**（约 **7.7 vs 8.5**，Δ ≈ −0.8）。路径闸门四仓幻觉 0；差距来自「动态入口可达性误判」和「七层模板密度」。

## 闸门跑通情况

| 仓 | 7g 轮次 | 终局幻觉 | 首轮假路径（被打回） |
|----|--------:|--------:|----------------------|
| ntfy | 2 | **0** | `github/workflows/build.yaml` |
| vaultwarden | 2 | **0** | `github/workflows` |
| zigbee2mqtt | 2 | **0** | `github/workflows/ci.yml` |
| caddy | 1 | **0** | （首轮即过） |

路径闸门在 edge 上同样有效：假路径一出现就打回，四仓终局 **hallu=0**。

## 交付分（主结论）

| 仓库 | 用法1 | 用法7s | orch4（对照） | Δ(7s−U1) | 说明 |
|------|------:|-------:|-------------:|---------:|------|
| ntfy | 8.6 | **8.0** | 7.5 | −0.6 | 投递通道齐全；仍有同路径双节点 |
| vaultwarden | 8.4 | **7.8** | 7.2 | −0.6 | 有 main/mail；误把 notifications.rs 标成 WS |
| zigbee2mqtt | 8.5 | **7.2** | 5.8 | −1.3 | **相对 orch4 大胜**：主干不再标「可选」 |
| caddy | 8.3 | **7.6** | 6.5 | −0.7 | 反代/TLS 故事对；节点偏密、模板层位有争 |
| **均分** | **8.5** | **7.7** | **6.8** | **−0.8** | |

相对 orch4：用法7s **+0.9**（edge 场景 dsh 探索完胜编排模板）。  
相对用法1：仍差 **0.8**（主要在 z2m）。

## 机评快照（`score-edge.js`）

格式：幻觉 / 层错 / 结构 high / 视觉 high / 节点数

| 仓 | 用法1 | 用法7s | orch4 |
|----|-------|--------|-------|
| ntfy | 0/0/0/0/22 | 0/0/**1**/0/30 | 0/0/0/0/27 |
| vaultwarden | 0/1/0/0/20 | 0/0/**1**/0/36 | 0/0/0/0/22 |
| zigbee2mqtt | 0/0/**8**/0/19 | 0/0/**11**/0/33 | 0/0/0/0/26* |
| caddy | 0/0/1/0/21 | 0/1/0/0/39 | 0/0/0/2/26 |

\* orch4 结构 high=0 是因为它服从了错误的「lib=旁路」启发式，把主干标成可选——**过闸不等于故事对**。

用法1 / 用法7s 在 z2m 上的大量 structure high，几乎全是同一误伤：`lib/controller.ts` 等被判「入口不可达」。真实入口是根目录 `index.js` 动态拉起，静态 import 图追不上。

## 相对 orch4：7s 赢在哪

| 失败模式（orch4） | 用法7s 表现 |
|-------------------|-------------|
| z2m 整棵 `lib/` 标「可选」 | 正常画 controller / mqtt / zigbee（故事对） |
| vaultwarden 漏 main/mail | 扫到 `src/main.rs`、`src/mail.rs` |
| caddy 把 templates 当「前端产品层」 | 放进请求处理层（更合理） |
| 硬凑 7 层空壳 | dsh 仍偏密，但空层不强制 |

## 相对用法1：7s 仍输在哪

1. **密度**：块1 常 23–39 节点，用法1 约 19–22。闸门「宁可多画」策略在网关型仓库更显臃肿。  
2. **可达性误伤**：z2m 机评结构 high 仍高，扫尾无法消掉（规则本身错）。  
3. **小硬伤**：ntfy 同路径双节点；vaultwarden 把 `notifications.rs` 误标实时推送。  
4. **无产品前端时的 actor 注入**：扫尾爱注入「访问 Web 界面」，对 caddy/vaultwarden 略违和。

## 和五仓追平结论怎么拼

```
常规 Web 应用五仓：  用法7s ≈ 用法1（盲评噪声带内）
Edge 四仓：          用法1 8.5  >  用法7s 7.7  ≫  用法5/orch4 6.8
```

用法7s 的核心优势（路径硬闸门 + 确定性扫尾）在 edge 上**照样成立**（幻觉归零、视觉硬伤被扫掉），但 **「探索自由」救不了「旁路启发式把主干打死」这类规则错误**——dsh 敢画主干，structureGates 仍按错误可达性扣分；orch4 则干脆不画/标可选。

产品含义：

1. 用法7s 是用法5 在 edge 上更优的 Agent 路径。  
2. 要真正追平用法1，还得修 **动态入口可达性**（不要把 `lib/` 整包判旁路），并允许网关类仓库 **空层不画、节点更稀**。

## 复现

```bash
export DEEPSEEK_API_KEY=sk-...
node eval/orch/usage7-gated.js ntfy vaultwarden zigbee2mqtt caddy
node eval/orch/usage7-sweep.js ntfy vaultwarden zigbee2mqtt caddy
node eval/orch/score-edge.js --variants usage1,usage7g,usage7s,orch4 \
  ntfy vaultwarden zigbee2mqtt caddy
```
