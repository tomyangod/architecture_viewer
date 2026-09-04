# Generate quality eval

| Repo | Status | Errors | Drift | Languages | Title | Modules |
|------|--------|--------|-------|-----------|-------|---------|
| berkshire | PASS | 0 | 0 | python | Valuation Monitor · 估值纪律监控引擎 | ai-berkshire-main, portfolio, research, thesis, utils |
| publicopinion | PASS | 0 | 0 | javascript, python | publicopinionmonitor_v2 | backend, base, cmd_arg, css, data_collection, database, debug, js, libs, model, proxy, runtime, store, backend/core, backend/routes, backend/services, data_collection/reliability, data_collection/weibo, data_collection/xhs, debug/wechat_platform_automation, debug/xhs, js/dashboard, js/index, js/shared, store/xhs |
| v18 | PASS | 0 | 0 | javascript, python | v18 | BmccMediaSpider-main, backend, blackbox, cmd_arg, csv_generator, data_collection, database, debug, js, libs, runtime, BmccMediaSpider-main/base, BmccMediaSpider-main/cmd_arg, BmccMediaSpider-main/constant, BmccMediaSpider-main/database, BmccMediaSpider-main/libs, BmccMediaSpider-main/media_platform, BmccMediaSpider-main/mermaid, BmccMediaSpider-main/model, BmccMediaSpider-main/proxy, BmccMediaSpider-main/readmes_of_all_modules, BmccMediaSpider-main/store, backend/core, backend/routes, backend/services, data_collection/reliability, data_collection/xiaohongshu, debug/wechat_platform_automation, js/core, js/features |
| shop-frontend | PASS | 0 | 0 | javascript | Shop Frontend | src, src/catalog, src/checkout |
| order-go | PASS | 0 | 0 | go | Order Go | cmd, internal, cmd/ordersvc, internal/catalog, internal/checkout |

| Repo | 冷启动 ms | 热启动 ms | 耗时下降 | 热启动缓存 | 全量 token | 增量 token | token 下降 |
|------|----------|----------|---------|-----------|-----------|-----------|-----------|
| berkshire | 32 | 9 | 72% | 命中 | 1914 | 0 | 100% |
| publicopinion | 21 | 12 | 43% | 命中 | 3402 | 0 | 100% |
| v18 | 40 | 24 | 40% | 命中 | 3688 | 0 | 100% |
| shop-frontend | 2 | 0 | 100% | 命中 | 1430 | 0 | 100% |
| order-go | 2 | 0 | 100% | 命中 | 1783 | 0 | 100% |

## 通过率与归因

- 本轮 5 仓：通过 5，失败 0，跳过 0（跳过=本机无此路径，不计入失败）。
- 覆盖：既有 Python/Node 三仓 + 仓内前端夹具 `shop-frontend`（Vue/TS）+ Go 夹具 `order-go`。
- 人为改动夹具：`eval/demo-drift` 必须红灯（未声明 Rel + 模板占位）。命令：`node lib/cli.js check eval/demo-drift --filled`。
- 失败仓的 reason 列记录 protocol / drift 摘要；完整错误见命令输出。

## 增量生成（W07-01）

- 冷启动=删缓存全量扫描+生成；热启动=无改动二次 Generate，应命中缓存跳过扫描与生成。
- 热启动缓存命中：5/5 全部命中；平均耗时下降 71%（目标 ≥80%）。
- 精修 payload 规模：无改动时增量重喂 0 张图（token -100%）；单模块改动时仅重喂内容变化的视图（由 test/incremental 覆盖，目标 ≥50%）。


Outputs written only to `eval/out/<id>/` (does not overwrite diagrams in the real repos).
