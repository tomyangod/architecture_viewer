#!/usr/bin/env node
'use strict';
/** Cursor sessionStart — soft env only; never depend on additional_context. */
const fs = require('fs');
function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch { return {}; }
}
const input = readStdin();
process.stdout.write(JSON.stringify({
  env: {
    AV_HOOK_SESSION_ID: String(input.session_id || input.conversation_id || ''),
    AV_HOOK_COMPOSER_MODE: String(input.composer_mode || ''),
    AV_HOOK_SESSION_START_AT: new Date().toISOString()
  }
}) + '\n');
