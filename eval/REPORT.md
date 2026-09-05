# Generate quality eval

| Repo | Status | Errors | Drift | Languages | Title | Modules |
|------|--------|--------|-------|-----------|-------|---------|
| berkshire | PASS | 0 | 0 | python | Valuation Monitor · 估值纪律监控引擎 | ai-berkshire-main, portfolio, research, thesis, utils |
| publicopinion | PASS | 0 | 0 | javascript, python | publicopinionmonitor_v2 | backend, base, cmd_arg, css, data_collection, database, debug, js, libs, model, proxy, runtime, store, backend/core, backend/routes, backend/services, data_collection/reliability, data_collection/weibo, data_collection/xhs, debug/wechat_platform_automation, debug/xhs, js/dashboard, js/index, js/shared, store/xhs |
| v18 | PASS | 0 | 0 | javascript, python | v18 | BmccMediaSpider-main, backend, blackbox, cmd_arg, csv_generator, data_collection, database, debug, js, libs, runtime, BmccMediaSpider-main/base, BmccMediaSpider-main/cmd_arg, BmccMediaSpider-main/constant, BmccMediaSpider-main/database, BmccMediaSpider-main/libs, BmccMediaSpider-main/media_platform, BmccMediaSpider-main/mermaid, BmccMediaSpider-main/model, BmccMediaSpider-main/proxy, BmccMediaSpider-main/readmes_of_all_modules, BmccMediaSpider-main/store, backend/core, backend/routes, backend/services, data_collection/reliability, data_collection/xiaohongshu, debug/wechat_platform_automation, js/core, js/features |
| shop-frontend | PASS | 0 | 0 | javascript | Shop Frontend | src, src/catalog, src/checkout |
| order-go | PASS | 0 | 0 | go | Order Go | cmd, internal, cmd/ordersvc, internal/catalog, internal/checkout |
| java-order | PASS | 0 | 0 | java | Java Order Service | src |

| Repo | 冷启动 ms | 热启动 ms | 耗时下降 | 热启动缓存 | 全量 token | 增量 token | token 下降 |
|------|----------|----------|---------|-----------|-----------|-----------|-----------|
| berkshire | 34 | 9 | 74% | 命中 | 1914 | 0 | 100% |
| publicopinion | 43 | 12 | 72% | 命中 | 3402 | 0 | 100% |
| v18 | 94 | 26 | 72% | 命中 | 3742 | 0 | 100% |
| shop-frontend | 2 | 0 | 100% | 命中 | 1527 | 0 | 100% |
| order-go | 3 | 0 | 100% | 命中 | 1783 | 0 | 100% |
| java-order | 2 | 0 | 100% | 命中 | 1773 | 0 | 100% |

| Repo | Drift 检查项 | Missing | 误报 FP | 误报率 |
|------|-----------|---------|---------|--------|
| berkshire | 6 | 0 | 0 | 0% |
| publicopinion | 28 | 0 | 0 | 0% |
| v18 | 32 | 0 | 0 | 0% |
| shop-frontend | 3 | 0 | 0 | 0% |
| order-go | 8 | 0 | 0 | 0% |
| java-order | 4 | 0 | 0 | 0% |

## 通过率与归因

- 本轮 6 仓：通过 6，失败 0，跳过 0（跳过=本机无此路径，不计入失败）。
- 覆盖：Python/Node 三仓 + 前端夹具 `shop-frontend`（Vue/TS）+ Go 夹具 `order-go`+ Java 夹具 `java-order`（Spring/Maven）。
- 人为改动夹具：`eval/demo-drift` 必须红灯（未声明 Rel + 模板占位）。命令：`node lib/cli.js check eval/demo-drift --filled`。
- 失败仓的 reason 列记录 protocol / drift 摘要；完整错误见命令输出。

## 增量生成（W07-01）

- 冷启动=删缓存全量扫描+生成；热启动=无改动二次 Generate，应命中缓存跳过扫描与生成。
- 热启动缓存命中：6/6 全部命中；平均耗时下降 86%（目标 ≥80%）。
- 热启动跳过全部内容读取/解析/生成与 LLM 调用，仅做 stat 清单比对；上表 wall-clock 为骨架路径，评测夹具均 <40ms，绝对耗时体感即时、比值受进程噪声影响。
- 真正的成本引擎是精修（refine，网络+token 主导）：无改动时重喂 0 张图（token -100%，且整段 LLM 调用跳过）；单模块改动仅重喂内容变化的视图（由 test/incremental 覆盖，目标 ≥50%）。

## 漂移检测精度（W10-01）

- 误报率 = 启发式 FP / drift missing 总数；FP 判定：drift 报缺失但 diagram 里有 CamelCase 形式（snake→CamelCase 反查命中）。
- 本轮 drift missing 为 0 的仓：6/6（FP 率 0%）。
- 目标：误报率 <20%（零漂移仓自动达标）。


Outputs written only to `eval/out/<id>/` (does not overwrite diagrams in the real repos).
