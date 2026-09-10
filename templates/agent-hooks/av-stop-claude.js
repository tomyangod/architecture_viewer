#!/usr/bin/env node
'use strict';
/** Claude Code Stop → shared gate with --adapter claude */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const gate = path.join(__dirname, 'av-gate.js');
const input = fs.readFileSync(0);
const r = spawnSync(process.execPath, [gate, '--adapter', 'claude'], {
  input,
  encoding: 'utf8',
  timeout: Number(process.env.AV_HOOK_TIMEOUT_MS) || 120000,
  env: process.env
});
process.stdout.write(r.stdout || '{}\n');
if (r.stderr) process.stderr.write(r.stderr);
process.exit(r.status == null ? 0 : r.status);
