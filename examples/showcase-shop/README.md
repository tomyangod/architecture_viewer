# Coffee Shop · 咖啡订单平台（Showcase）

> Architecture Viewer 官方演示仓库。结构刻意覆盖 **六视图扫描面**：compose 服务、前端入口、后端领域类、异步 Worker、deploy/CI。

## 60 秒故事

顾客在 Web 下单 → API 落库 / 扣库存 → 消息队列通知烘焙 Worker → 微信/短信通知出杯。

```
顾客 ──► frontend ──► api ──► postgres
                      │  └──► redis (会话/库存缓存)
                      └──► mq ──► worker ──► 通知渠道
```

## 目录

```
examples/showcase-shop/
├── README.md
├── package.json
├── docker-compose.yml
├── frontend/index.html
├── backend/
│   ├── main.py
│   └── services/{order,payment,inventory}_service.py
├── worker/worker.py
├── deploy/{Dockerfile,k8s-deployment.yaml}
└── config/settings.yml
```

## 用 Architecture Viewer 生成

> ⚠️ **注意**：`architecture_viewer/` 下的六视图（6 个 `.md`）是**手写精修版**，
> 刻意覆盖了「顾客 / 店员 / 支付网关 / 下单主路径」等生动叙事。
> 运行 `generate` 会用自动扫描结果**覆盖**这些手写图（生成的是通用模板）。
>
> * **首次脚手架**：`init` + `generate` 生成初始六视图，然后手动精修。
>
> * **后续验证**：只需跑 `check`，不要重复 `generate`。
>
> * **想试 generate**：请复制到 `/tmp` 再跑，避免覆盖手写稿。
>
>   ```bash
>   cp -R examples/showcase-shop /tmp/showcase-test
>   node lib/cli.js generate /tmp/showcase-test
>   node lib/cli.js check /tmp/showcase-test/architecture_viewer --filled --drift --repo /tmp/showcase-test
>   ```

```bash
# 在仓库根目录（仅首次脚手架，勿重复执行）
node lib/cli.js init examples/showcase-shop
node lib/cli.js generate examples/showcase-shop

# 后续验证只需 check（不覆盖手写图）
node lib/cli.js check examples/showcase-shop/architecture_viewer --filled --drift --repo examples/showcase-shop
```

官网静态分享页：`/samples/showcase/`（已烘焙，无需实时扫描）。

重新烘焙静态页（改图后执行）：

```bash
npm run bake:samples
```

