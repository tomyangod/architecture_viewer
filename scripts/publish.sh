#!/usr/bin/env bash
set -euo pipefail

# Architecture Viewer — npm 发布脚本
# 用法：
#   ./scripts/publish.sh              # 正式发布（自动升 patch 版本）
#   ./scripts/publish.sh minor        # 升 minor 版本
#   ./scripts/publish.sh major        # 升 major 版本
#   ./scripts/publish.sh --dry        # dry run（不真正发布）

cd "$(dirname "$0")/.."

echo "=== Architecture Viewer npm 发布 ==="

# 1. 检查登录状态
if ! npm whoami >/dev/null 2>&1; then
  echo "未登录 npm，请先运行: npm login"
  exit 1
fi

# 2. 语法检查
echo "→ 语法检查..."
node --check lib/cli.js
node --check lib/index.js
node --check web/server.js
echo "  OK"

# 3. 运行测试
echo "→ 运行测试..."
if [ -d test ] && ls test/*.test.js >/dev/null 2>&1; then
  node --test test/*.test.js
fi
echo "  OK"

# 4. 升版本号
BUMP="${1:-patch}"
if [ "$BUMP" = "--dry" ]; then
  BUMP="patch"
  DRY=1
fi

echo "→ 升版本号 ($BUMP)..."
npm version "$BUMP" --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")
echo "  v$VERSION"

# 5. 检查 files 清单
echo "→ 检查发布文件清单..."
npm pack --dry-run 2>&1 | grep -E "npm notice" | head -20

# 6. 发布
if [ "${DRY:-0}" = "1" ]; then
  echo "→ Dry run 模式，跳过实际发布"
else
  echo "→ 发布到 npm..."
  npm publish
  echo ""
  echo "✅ 发布成功！"
  echo "   包名: architecture-viewer@$VERSION"
  echo "   安装: npm i -g architecture-viewer"
  echo "   使用: arch-viewer init ./your-repo"
fi
