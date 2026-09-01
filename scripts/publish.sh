#!/usr/bin/env bash
set -euo pipefail

# Architecture Viewer — npm 发布脚本
# 用法：
#   ./scripts/publish.sh              # 正式发布（package.json 版本与 git tag 一致时直接发布，否则自动升 patch）
#   ./scripts/publish.sh minor        # 强制升 minor 版本
#   ./scripts/publish.sh major        # 强制升 major 版本
#   ./scripts/publish.sh --dry        # dry run（不真正发布；不要求登录；不改 package.json）
#
# 约定：版本号在 Release 提交里升好并打 tag（如 Release 0.2.1 + tag v0.2.1）。
# 脚本检测到当前版本已有同名 git tag 时跳过 bump，直接发布该版本，避免
# dry-run / 正式发布重复 bump 导致「tag 0.2.1、npm 却是 0.2.3」的错版。

cd "$(dirname "$0")/.."

echo "=== Architecture Viewer npm 发布 ==="

ARG="${1:-}"
DRY=0
FORCE_BUMP=""
if [ "$ARG" = "--dry" ]; then
  DRY=1
elif [ -n "$ARG" ]; then
  FORCE_BUMP="$ARG"
fi

# 1. 登录状态（dry-run 不需要登录）
if [ "$DRY" = "0" ]; then
  if ! npm whoami >/dev/null 2>&1; then
    echo "未登录 npm，请先运行: npm login"
    exit 1
  fi
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

# 4. 版本处理
VERSION=$(node -p "require('./package.json').version")
if [ "$DRY" = "1" ]; then
  echo "→ Dry run：保持当前版本 v${VERSION}（不改 package.json）"
else
  if [ -n "$FORCE_BUMP" ]; then
    echo "→ 强制升版本号 ($FORCE_BUMP)..."
    npm version "$FORCE_BUMP" --no-git-tag-version
    VERSION=$(node -p "require('./package.json').version")
  elif git tag -l "v$VERSION" | grep -q "v$VERSION"; then
    echo "→ 当前版本 v$VERSION 已有 git tag，跳过 bump，直接发布"
  else
    echo "→ 升版本号 (patch)..."
    npm version patch --no-git-tag-version
    VERSION=$(node -p "require('./package.json').version")
  fi
  echo "  v$VERSION"
fi

# 5. 检查 files 清单
echo "→ 检查发布文件清单..."
npm pack --dry-run 2>&1 | grep -E "npm notice" | head -20

# 6. 发布
if [ "$DRY" = "1" ]; then
  echo "→ Dry run 模式，跳过实际发布"
  echo ""
  echo "✅ Dry run 完成，包内容与版本如上。正式发布：npm login 后运行 ./scripts/publish.sh"
else
  echo "→ 发布到 npm..."
  npm publish
  echo ""
  echo "✅ 发布成功！"
  echo "   包名: architecture-viewer@$VERSION"
  echo "   安装: npm i -g architecture-viewer"
  echo "   使用: arch-viewer init ./your-repo"
  echo ""
  echo "   提醒：若本次发生了版本 bump，请提交 package.json 并补打 tag："
  echo "     git add package.json && git commit -m 'Release $VERSION' && git tag v$VERSION"
  echo "     git push origin main --tags"
fi
