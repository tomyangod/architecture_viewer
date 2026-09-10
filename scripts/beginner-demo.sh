#!/usr/bin/env bash
# 小白一键演示：AI 会话架构验收（超详细逐步说明）
# 用法：在仓库根目录执行  bash scripts/beginner-demo.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI=(node "$ROOT/lib/cli.js")
SRC_V1="$ROOT/examples/beginner-demo/v1"
SRC_V2="$ROOT/examples/beginner-demo/v2-ai-patch"
DEMO="${AV_DEMO_DIR:-/tmp/av-beginner-demo}"
OPEN_BROWSER="${AV_DEMO_OPEN:-1}"

c_cyan()  { printf '\033[36m%s\033[0m\n' "$*"; }
c_green() { printf '\033[32m%s\033[0m\n' "$*"; }
c_yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }
c_bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
hr()      { printf '\n────────────────────────────────────────\n\n'; }

pause() {
  if [[ "${AV_DEMO_NOPAUSE:-}" == "1" ]]; then return 0; fi
  printf '\033[90m按回车继续下一步…\033[0m'
  read -r _
}

die() { echo "错误: $*" >&2; exit 1; }

[[ -d "$SRC_V1" ]] || die "找不到演示仓 $SRC_V1（请在 architecture_viewer 仓库根目录执行）"
[[ -f "$ROOT/lib/cli.js" ]] || die "找不到 lib/cli.js"

c_bold "╔══════════════════════════════════════════════╗"
c_bold "║  Architecture Viewer · 小白演示（新手攻略）  ║"
c_bold "╚══════════════════════════════════════════════╝"
echo
echo "本演示模拟一次真实场景："
echo "  1) 你有一份分层干净的小项目"
echo "  2) AI 写完代码后，你用工具验收「结构有没有塌」"
echo "  3) 报告会标出跨层违规（控制器直连仓储）"
echo
echo "演示目录：$DEMO"
echo "（设 AV_DEMO_NOPAUSE=1 可跳过回车；AV_DEMO_OPEN=0 不自动开浏览器）"
hr
pause

# ---------- 步骤 1 ----------
c_cyan "【步骤 1/4】准备一份干净的迷你订单系统（v1）"
echo "复制 examples/beginner-demo/v1 → $DEMO"
rm -rf "$DEMO"
mkdir -p "$DEMO"
cp -R "$SRC_V1"/. "$DEMO"/
echo
echo "当前分层（干净）："
echo "  controller/  → 只调用 service"
echo "  service/     → 调用 repository + domain"
echo "  repository/  → 存订单"
echo "  domain/      → Order 模型"
echo
find "$DEMO" -type f -name '*.py' | sed "s|$DEMO/|  |" | sort
hr
pause

# ---------- 步骤 2 ----------
c_cyan "【步骤 2/4】AI 改代码之前：记录架构基线"
echo "命令："
echo "  node lib/cli.js session start $DEMO"
echo
echo "含义：给现在的代码结构拍一张「快照」，存在 $DEMO/.av/graph-baseline.json"
echo
"${CLI[@]}" session start "$DEMO"
hr
pause

# ---------- 步骤 3 ----------
c_cyan "【步骤 3/4】模拟 AI 改坏了架构"
echo "正在把 v2-ai-patch 叠到演示仓上："
echo "  + 新增 service/payment_service.py（支付服务）"
echo "  ~ 改坏 controller/order_controller.py（控制器直接 import 仓储）"
echo
cp "$SRC_V2/service/payment_service.py" "$DEMO/service/"
cp "$SRC_V2/controller/order_controller.py" "$DEMO/controller/"
echo "变更后的控制器关键几行："
c_yellow "  from repository.order_repository import OrderRepository  # ← 跨层！"
c_yellow "  order = self.repo.find(order_id)                         # ← 跳过服务层"
hr
pause

# ---------- 步骤 4 ----------
c_cyan "【步骤 4/4】生成会话报告（看 AI 改了什么结构）"
echo "命令："
if [[ "$OPEN_BROWSER" == "1" ]]; then
  echo "  node lib/cli.js session report $DEMO --open"
else
  echo "  node lib/cli.js session report $DEMO"
fi
echo
REPORT_ARGS=(session report "$DEMO")
[[ "$OPEN_BROWSER" == "1" ]] && REPORT_ARGS+=(--open)
set +e
"${CLI[@]}" "${REPORT_ARGS[@]}"
STATUS=$?
set -e
echo
c_green "报告已生成："
echo "  文本/终端：上面就是摘要"
echo "  HTML：$DEMO/.av/session-report.html"
echo "  JSON：$DEMO/.av/session-report.json"
echo
c_bold "你应该看到："
echo "  · 新增类型 PaymentService"
echo "  · 风险 HIGH：OrderController → OrderRepository 层级穿透"
echo "  · HTML 图里橙色/红色标出违规边"
echo
if [[ "$STATUS" -eq 1 ]]; then
  c_yellow "退出码 1 = 检测到高风险（正常，方便接 CI）"
elif [[ "$STATUS" -eq 0 ]]; then
  echo "退出码 0（若未检出 HIGH，请检查补丁是否复制成功）"
else
  echo "退出码 $STATUS"
fi
hr

c_bold "下一步可以试什么？"
echo "  A. 打开 HTML，点「仅变更 / 仅违规」过滤按钮"
echo "  B. 看图文攻略：docs/guides/beginner-guide/index.html"
echo "  C. 在自己的项目里："
echo "       node lib/cli.js session start ."
echo "       # … 让 AI / 自己改代码 …"
echo "       node lib/cli.js session report . --open"
echo "  D. Cursor/VS Code：F5 开扩展 → 命令面板 Session Start / Session Report"
echo
c_green "Demo 完成。"
