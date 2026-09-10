#!/usr/bin/env node
'use strict';

/**
 * Shared architecture gate entry for all AI hosts.
 * Usage:
 *   node av-gate.js --adapter cursor|claude|generic [repo]
 * Reads optional hook event JSON from stdin.
 */

const path = require('path');
const fs = require('fs');

function findPkgRoot(start) {
  let cur = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(cur, 'lib', 'session-gate.js'))) return cur;
    if (fs.existsSync(path.join(cur, 'node_modules', 'arch-viewer', 'lib', 'session-gate.js'))) {
      return path.join(cur, 'node_modules', 'arch-viewer');
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  // Global install: resolve from this script when copied into .av/hooks
  const cand = path.join(__dirname, '..', '..', 'lib', 'session-gate.js');
  if (fs.existsSync(cand)) return path.join(__dirname, '..', '..');
  try {
    return path.dirname(require.resolve('arch-viewer/package.json'));
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const out = { adapter: 'generic', repo: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--adapter' && argv[i + 1]) {
      out.adapter = argv[++i];
    } else if (!argv[i].startsWith('-')) {
      out.repo = argv[i];
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pkgRoot = findPkgRoot(process.cwd()) || findPkgRoot(__dirname);
  if (!pkgRoot) {
    process.stderr.write('arch-viewer gate: cannot find session-gate module\n');
    process.exit(3);
  }
  const gateLib = require(path.join(pkgRoot, 'lib', 'session-gate.js'));
  const event = gateLib.readStdinJson();
  const roots = event.workspace_roots || event.cwd ? [event.cwd] : null;
  const repo = path.resolve(
    args.repo
    || process.env.AV_HOOK_REPO
    || (Array.isArray(roots) && roots[0])
    || process.env.CLAUDE_PROJECT_DIR
    || process.cwd()
  );

  const cliJs = process.env.AV_HOOK_CLI
    || (fs.existsSync(path.join(pkgRoot, 'lib', 'cli.js')) ? path.join(pkgRoot, 'lib', 'cli.js') : null);
  const gate = gateLib.runGateViaCli(repo, { cliJs });
  const adapted = gateLib.adaptGate(gate, args.adapter, event);
  if (adapted.stderr) process.stderr.write(adapted.stderr);
  process.stdout.write(adapted.stdout || '{}\n');
  process.exit(adapted.exitCode == null ? 0 : adapted.exitCode);
}

main();
