# P1 首批 2 队接入检查清单（旁路周）

> 版本钉死：`arch-viewer@0.12.2-rc.5`（registry / npm `next`）  
> 主说明：[seed-users.md](seed-users.md) · 演示：[red-green-sample.md](red-green-sample.md)

## 接入前
- [ ] 访谈合格（说得出具体结构事件 / 发现者 / 耗时）
- [ ] 确认非关联团队；语言 Python 或 JS/TS；有真实仓与 PR 流程
- [ ] 说明：本地免费、不要私码/PAT；首周**旁路不阻断**；托管公网 webhook 未承诺

## 接入当日（约 30 分钟，分记客户操作 vs 作者协助分钟）
```bash
npx --yes --package arch-viewer@0.12.2-rc.5 arch-viewer --version
npx --yes --package arch-viewer@0.12.2-rc.5 arch-viewer session report /绝对路径/to/repo --renderer builtin
```
- [ ] 客户自己在真实仓跑通一次 session report
- [ ] 若仓内已有 `.av/layers.json`：重新生成或对照源码复核（旧自动建议可能把调度/监控标成 util）；注意报告里的范围变化提示
- [ ] （可选）按 red-green-sample 做一次人为 layer-skip 红→绿，不 commit、不刷基线消红灯
- [ ] 明确：HIGH 本周只作参考，不进强制 pre-commit/CI，除非客户书面要求
- [ ] 说明当前验证环境是 macOS；Windows / Linux 出现试点再单独复测

## 首周记录（每队）
| 字段 | T1 | T2 |
|---|---|---|
| 匿名 ID |  |  |
| 客户操作分钟 |  |  |
| 作者协助分钟 |  |  |
| 有效发现（条） |  |  |
| 重复/无行动告警 |  |  |
| 是否继续使用 |  |  |
| 是否改变一次评审决定 |  |  |

## 不做
- 不用脏工作区源码打包交付
- 不以旧 rc.2 或主仓未提交改动冒充已发布 rc.3（R18/R19 等未发布项）
- 不把朋友仓 / 自有仓算作非关联客户样本
