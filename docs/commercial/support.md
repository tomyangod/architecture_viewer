# 客户支持

| 项 | 内容 |
|----|------|
| 工单 | [Gitee Issues](https://gitee.com/heyangyan/architecture_viewer/issues)（首选）· [GitHub Issues](https://github.com/heyangyan/architecture_viewer/issues)（镜像） |
| 邮件 | 在 Issue 里留邮箱即可；对公开票走 [invoice.md](invoice.md) |
| 收款 / 开通 | [billing.md](billing.md) |
| 响应时效 | Community：工作日 24h 内首次回复（尽力）。**Pro / Team 订阅优先**，工作日 8h 内首次回复。 |

落地页页脚可到达本文与发票页。

## 响应分级

| 级别 | 谁 | 目标 |
|------|----|------|
| P0 | 付费开通失败、生产 Webhook 全挂 | 当日首次回复 |
| P1 | 登录 / 许可证 / 漂移误报 | 1 个工作日 |
| P2 | 文档、功能建议 | 排队处理 |

请勿在 Issue 里贴密钥、PAT、完整付款二维码。

## FAQ

1. **怎么安装（CLI）？** Node ≥ 18。`npm i -g arch-viewer` 或 `npx arch-viewer setup`。不需要 VS Code 扩展。
2. **怎么免费开始？** `npx arch-viewer session start` → 改代码 → `npx arch-viewer session report`。或 `init` + `generate` + 拷贝 `templates/architecture-check.yml`。
3. **登录怎么做？** `arch-viewer auth login you@example.com`，stub 模式验证码打在控制台。网页走 `/account.html`。
4. **没登录能不能用？** 能。`generate` / `check` / `session` / `--refine`（自带 Key）是 Community，永不登录墙。
5. **Pro 和免费有何不同？** 免费：自己出图、自己跑 check。Pro：本机文件夹盯梢 + 企微、托管 PR 评论、云端精修/增量同步入口。见 [COMMERCIAL.md](COMMERCIAL.md)、[PRO-LOCAL.md](PRO-LOCAL.md)。
6. **试用多久？** 注册即 7 天。到期后本地仍可手动检查；自动检查与企微需开通或兑换许可证。
7. **怎么付费？** 定价页爱发电 / 微信 / Lemon，或控制台 Stripe。先付款再按 [billing.md](billing.md) 开通。Team 为 ¥999/年/仓库。内网私有化见 [team-onprem.md](team-onprem.md)（¥19,999 / 年起）。
8. **生成质量不好？** 骨架是扫描拼模板，秒级。精修：本机 `--refine` + `DEEPSEEK_API_KEY`；云端精修是 Pro 入口（占位）。
9. **能离线用吗？** Community CLI 完全离线。网页自托管也不依赖 CDN（Mermaid 打进 vendor）。企微推送需要访问企业微信接口。
10. **Webhook 配错了？** Secret 必须与控制台一致。GitHub 勾选 Pull request；Gitee 选 Merge Request Hook。
11. **PR 评论没出现？** PAT 需要 GitHub `repo` 或 Gitee PR 评论权限；私有仓必须填 token。
12. **红灯怎么修？** 本地 `npx arch-viewer generate .`，把 `architecture_viewer/` 一并提交；或按 CLI 每条 ERROR 后的「修复:」提示改 Rel。
13. **数据存在哪？** 自托管 Pro 在 `.data/pro/` 或 `ARCH_PRO_DATA`。token 在 `~/.config/arch-viewer/auth.json`（0600）。不要提交这些目录。
14. **怎么退出登录？** `arch-viewer auth logout` 或控制台右上角「退出」。
15. **许可证兑换失败？** 必须用签发时的同一邮箱登录。见 [billing.md](billing.md)。
16. **要发票？** 填 [invoice.md](invoice.md) 信息表，对公转账后开票。
17. **遥测会上传代码吗？** 默认关。开启后只记命令名/耗时/退出码，不含路径与源码。

## 升级与退订

升级：控制台或定价页付款 → 运营 `admin/grant`。  
退订：Issue 标明邮箱与订单号；已开票月份不退，未履约月协商。Team 按仓库年费，中途加仓另开一单。
