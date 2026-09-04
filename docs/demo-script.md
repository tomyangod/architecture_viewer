# 60 秒 Demo 拍摄脚本

> 成片任务见 W05-03（双语字幕）。本文件是分镜与口播，用来录屏 / 导出 GIF。
> 素材落点：`docs/demo.gif`（README 首屏引用）；成片可另存 `docs/demo.mp4`。

## 一句话卖点（口播开场 0–3s）

> AI 改完代码，一条命令看清架构变了什么——有没有跨层、删了谁、会波及谁。

## 道具

| 项 | 说明 |
|----|------|
| Node ≥ 18 | 已装 `arch-viewer` 或用 `npx` |
| 演示仓 | 推荐复制 `examples/beginner-demo/v1` 到 `/tmp/av-demo`（勿直接改 examples） |
| 终端 + 浏览器 | 终端占左半屏，浏览器打开 HTML 报告占右半屏 |
| 分辨率 | 1280×720 或以上；字号加大，避免录屏糊 |

准备：

```bash
rm -rf /tmp/av-demo
cp -R examples/beginner-demo/v1 /tmp/av-demo
cd /tmp/av-demo
```

## 分镜（总长 ≈ 60s）

| 秒 | 画面 | 操作 / 口播 |
|----|------|-------------|
| 0–3 | 标题卡或终端全屏 | 口播一句话卖点 |
| 3–12 | 终端 | `npx arch-viewer session start .` → 出现基线指纹、文件/类型计数。口播：「改之前先拍照。」 |
| 12–28 | 编辑器 | 人为引入架构坏味道：例如在 controller 里直接 import repository/storage，或删除一个被引用的 service 文件。口播：「模拟 AI 顺手重构。」 |
| 28–45 | 终端 | `npx arch-viewer session report . --open` → 终端出现 Risk / 计数；浏览器打开 Before / **Delta** / After。口播：「红灯只亮在刀刃上。」 |
| 45–55 | 浏览器特写 | 指着跨层违规或类型删除 + 影响面 Top；口播：「PR 里也能自动贴同一份评论。」 |
| 55–60 | 收尾卡 | 命令：`npx arch-viewer setup`；链接仓库；Community ¥0 / Pro ¥29/月 |

## 备用 B 轨：漂移红灯（若时间够，可替换 12–45s）

用于强调「CI 抓漂移」而不是会话门：

```bash
# 在 architecture_viewer 仓库根目录
npx arch-viewer check eval/demo-drift --filled
# 必须非零退出：未声明 Rel + 模板占位
```

口播：「坏图进不了主干——这就是漂移红灯。」

## 导出建议

1. 录屏工具：QuickTime / OBS / Kap
2. 先出 60s MP4，再压成循环 GIF（≤ 8MB，优先保证字可读）
3. GIF 覆盖 `docs/demo.gif`；MP4 留给落地页与 W05-03
4. 字幕：中文主轨；英文字幕轨在 W05-03 补齐

## 验收自检

- [ ] 前 12 秒出现 `session start` 成功输出
- [ ] 中段有可见代码改动
- [ ] 后段 HTML 报告可见 Before/Delta/After 或风险列表
- [ ] 结尾露出安装命令与仓库链接
- [ ] 无密钥、无真实客户仓路径入镜
