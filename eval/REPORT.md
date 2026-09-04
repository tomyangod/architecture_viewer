# Generate quality eval

| Repo | Status | Errors | Drift | Languages | Title | Modules |
|------|--------|--------|-------|-----------|-------|---------|
| berkshire | PASS | 0 | 0 | python | Valuation Monitor · 估值纪律监控引擎 | ai-berkshire-main, portfolio, research, thesis, utils |
| publicopinion | PASS | 0 | 0 | javascript, python | publicopinionmonitor_v2 | backend, base, cmd_arg, css, data_collection, database, debug, js, libs, model, proxy, runtime, store, backend/core, backend/routes, backend/services, data_collection/reliability, data_collection/weibo, data_collection/xhs, debug/wechat_platform_automation, debug/xhs, js/dashboard, js/index, js/shared, store/xhs |
| v18 | PASS | 0 | 0 | javascript, python | v18 | BmccMediaSpider-main, backend, blackbox, cmd_arg, csv_generator, data_collection, database, debug, js, libs, runtime, BmccMediaSpider-main/base, BmccMediaSpider-main/cmd_arg, BmccMediaSpider-main/constant, BmccMediaSpider-main/database, BmccMediaSpider-main/libs, BmccMediaSpider-main/media_platform, BmccMediaSpider-main/mermaid, BmccMediaSpider-main/model, BmccMediaSpider-main/proxy, BmccMediaSpider-main/readmes_of_all_modules, BmccMediaSpider-main/store, backend/core, backend/routes, backend/services, data_collection/reliability, data_collection/xiaohongshu, debug/wechat_platform_automation, js/core, js/features |
| shop-frontend | PASS | 0 | 0 | javascript | Shop Frontend | src, src/catalog, src/checkout |
| order-go | PASS | 0 | 0 | go | Order Go | cmd, internal, cmd/ordersvc, internal/catalog, internal/checkout |

## 通过率与归因

- 本轮 5 仓：通过 5，失败 0，跳过 0（跳过=本机无此路径，不计入失败）。
- 覆盖：既有 Python/Node 三仓 + 仓内前端夹具 `shop-frontend`（Vue/TS）+ Go 夹具 `order-go`。
- 人为改动夹具：`eval/demo-drift` 必须红灯（未声明 Rel + 模板占位）。命令：`node lib/cli.js check eval/demo-drift --filled`。
- 失败仓的 reason 列记录 protocol / drift 摘要；完整错误见命令输出。

Outputs written only to `eval/out/<id>/` (does not overwrite diagrams in the real repos).
