# 客户支持

渠道：Gitee Issue https://gitee.com/heyangyan/architecture_viewer/issues  
工作日响应目标：24 小时内首次回复（Community 尽力；Pro 订阅用户优先）。

## FAQ

1. **如何免费开始？** `npx arch-viewer init . && npx arch-viewer generate .`，再拷贝 `templates/architecture-check.yml`。
2. **Pro 和免费有何不同？** 免费：自己出图、自己跑 `check`。Pro：本机文件夹自动盯 + 企微提醒，或把 Gitee/GitHub PR 评论托管出去。本地上手见 [PRO-LOCAL.md](PRO-LOCAL.md)。
3. **试用多久？** 注册即 7 天。到期后本地仍可手动「现在检查」；自动检查与企微需兑换许可证。
4. **如何付费？** 控制台 Stripe 订阅（¥29/月），或对公转账后管理员开通。见 [invoice.md](invoice.md)。
5. **Webhook 配错了？** Secret 必须与控制台完全一致。GitHub 勾选 Pull request；Gitee 选 Merge Request Hook。
6. **评论没出现？** PAT 需要 `repo`（GitHub）或 Gitee 的 PR 评论权限；私有仓必须填 token。
7. **红灯如何修？** 本地 `npx arch-viewer generate .` 后把 `architecture_viewer/` 一并提交。
8. **能离线用吗？** Community CLI / 扩展完全离线。本地 Pro 检查在本机跑，不需要 GitHub。企微推送需要能访问企业微信接口。
9. **数据存在哪？** 自托管时在 `.data/pro/`。不要把该目录提交到 git。
10. **如何退出登录？** 控制台右上角「退出」。
11. **许可证兑换失败？** 必须用签发时的同一邮箱登录。
12. **生成图质量？** 骨架免费秒级；精修需 DeepSeek Key（`--refine` / 落地页填 Key）。
