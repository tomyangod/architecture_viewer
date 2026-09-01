#!/usr/bin/env bash
# 60 秒演示：Init → Generate → Preview 提示 → CI fail（漂移/坏 Rel）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI=(node "$ROOT/lib/cli.js")
TMP="$(mktemp -d /tmp/arch-viewer-demo.XXXX)"
trap 'rm -rf "$TMP"' EXIT

echo "== 1. Init (≈5s) =="
mkdir -p "$TMP/app/backend"
printf '# Demo Shop\n\nAPI + worker.\n' > "$TMP/app/README.md"
printf 'class OrderService:\n    pass\n' > "$TMP/app/backend/service.py"
printf 'services:\n  api:\n    image: demo-api\n  worker:\n    image: demo-worker\n' > "$TMP/app/docker-compose.yml"
"${CLI[@]}" init "$TMP/app"
ls "$TMP/app/architecture_viewer" | head

echo
echo "== 2. Generate (≈5s) =="
"${CLI[@]}" generate "$TMP/app"

echo
echo "== 3. Preview =="
echo "Cursor: 命令面板 → Architecture Viewer: Preview"
echo "CLI:    打开 $TMP/app/architecture_viewer/architecture_visualized.html （扩展 Webview 无需 http.server）"

echo
echo "== 4. CI fail on broken Rel =="
set +e
"${CLI[@]}" check "$ROOT/eval/demo-drift" --filled
STATUS=$?
set -e
if [ "$STATUS" -eq 0 ]; then
  echo "expected demo-drift to FAIL"
  exit 1
fi
echo "check exited $STATUS (expected non-zero) — CI would go red"

echo
echo "Demo OK. Temp kit: $TMP/app/architecture_viewer"
