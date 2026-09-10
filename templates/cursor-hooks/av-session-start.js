#!/usr/bin/env node
'use strict';

/**
 * Cursor sessionStart spike / 模板脚本（Architecture Viewer）
 *
 * 契约（官方）：
 *   stdin:  { session_id, is_background_agent, composer_mode? }
 *   stdout: { env?, additional_context? }
 *
 * 产品约束（见 docs/plans/cursor-hooks-spike.md）：
 *   - fire-and-forget：不要假设 Agent 等你跑完
 *   - 不要依赖 additional_context 一定进模型（已知丢失 bug）
 *   - Cloud Agent 不跑 sessionStart → 主强制必须在 stop
 */

const fs = require('fs');

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function main() {
  const input = readStdin();
  const sessionId = input.session_id || input.conversation_id || '';
  const mode = input.composer_mode || '';

  // env 相对可靠；后续 stop hook 可读
  const out = {
    env: {
      AV_HOOK_SESSION_ID: String(sessionId),
      AV_HOOK_COMPOSER_MODE: String(mode),
      AV_HOOK_SESSION_START_AT: new Date().toISOString()
    }
  };

  // 软提示：有则更好，无则不影响门禁（W23-04 不得依赖此字段）
  if (process.env.AV_HOOK_EMIT_CONTEXT === '1') {
    out.additional_context =
      'Architecture Viewer：完成代码改动后，结构验收由 stop hook 自动跑；不必要求用户打开 HTML。';
  }

  process.stdout.write(JSON.stringify(out) + '\n');
}

main();
