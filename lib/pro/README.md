# Pro 核心（账号 / 权益 / 存储）

无框架依赖的 Pro 商业逻辑核心，CLI / MCP / 网页三方复用。
Express 交付层（路由、Stripe、Webhook、本地许可 ticker）留在 `web/lib/pro/`，反向依赖本目录。

| 文件 | 职责 |
|---|---|
| `auth.js` | 邮箱验证码登录、会话签发/校验/销毁、密码登录（预留） |
| `auth-client.js` | CLI 侧客户端：`loginFlow` / `whoamiAsync` / `logoutFlow` / `requireUser`，token 持久化 |
| `entitlement.js` | 计划与权益：trial / pro 判定、`publicUser` 视图 |
| `store.js` | JSON 持久化（用户 / 会话 / 验证码 / 事件） |
| `crypto.js` | HMAC / 加解密工具 |

## 命令

```bash
arch-viewer auth login [email] [--code 123456]   # 邮箱验证码登录
arch-viewer auth whoami                          # 查看当前登录邮箱与 Pro 状态
arch-viewer auth logout                          # 退出登录
```

流程：输入邮箱 → 服务端生成 6 位验证码 → 输入验证码 → 校验通过后本地持久化 token。

- **stub 模式**（`NODE_ENV !== production`）：不发邮件，验证码直接打印在控制台
  （同时打印在服务端日志），方便本地与 CI 走通流程。
- **生产模式**：验证码由邮件服务商发送（`auth.js` 的
  `sendLoginCode()` 预留接入点，替换为 Resend / SES / 阿里云邮件推送即可）。

## 凭据存储

| 文件 | 内容 | 说明 |
|---|---|---|
| `~/.config/arch-viewer/auth.json` | token / email / 登录时间 | 权限 `0600`；`ARCH_CONFIG_DIR` 或 `XDG_CONFIG_HOME` 可改位置 |
| `~/.config/arch-viewer/pro-data/` | 本地模式服务端数据（用户 / 会话 / 验证码） | `ARCH_PRO_DATA` 可改位置 |

token 有效期 30 天（服务端 session），重启终端仍登录。

## 两种传输模式

| 模式 | 触发条件 | 说明 |
|---|---|---|
| 本地（默认） | 未设 `ARCH_API_BASE` | CLI 直接 require 本目录模块，无需起服务 |
| 远程 | `ARCH_API_BASE=https://your-host` | 走 HTTP API（`/api/pro/auth/*`），Bearer token 认证 |

HTTP 端点（远程模式 / 网页共用，路由在 `web/lib/pro/routes.js`）：

- `POST /api/pro/auth/request-code` `{ email }` → `{ ok, expiresInSec, devCode? }`
- `POST /api/pro/auth/verify-code` `{ email, code }` → `{ token, user }`（同时下发 cookie）
- `GET  /api/pro/auth/me`（Bearer 或 cookie）→ `{ user }`
- `POST /api/pro/auth/logout`（Bearer 或 cookie）→ `{ ok }`

## Pro 门禁用法

Pro 命令（云端精修、增量同步）用 `requirePro`，未登录 / 过期会提示升级并带定价页链接：

```js
const auth = require('./pro/auth-client');
const user = await auth.requirePro({ feature: 'cloud_refine' });
```

```bash
arch-viewer pro refine [repo]   # 需登录，试用或 Pro
arch-viewer pro sync [repo]
```

Community 的 `generate` / `check` / `session` / `--refine`（自带 Key）**不要**调用门禁。

特性开关（服务端）：`ARCH_PRO_FEATURES='{"cloud_refine":false}'` 或 `ARCH_PRO_FEATURES_OFF=incremental_sync`。  
定价链接：`ARCH_PRICING_URL`（默认 [docs/commercial/COMMERCIAL.md](../../docs/commercial/COMMERCIAL.md)）。

`requireUser()` 只检查登录态，不谈升级；网页路由用 `auth.requireProFeature(req, feature)`。

## 安全说明

- 验证码在服务端以 HMAC 哈希存储，10 分钟过期，最多尝试 5 次。
- 首次登录自动建档为 7 天 trial 用户（无密码，密码字段留空）。
- `auth.json` 仅存 token，不存验证码或密码；`logout` 同时销毁服务端会话。
