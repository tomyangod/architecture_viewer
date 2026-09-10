'use strict';

/**
 * Universal session architecture gate.
 *
 * Used by:
 *  - MCP av_guard
 *  - CLI `session guard`
 *  - Cursor / Claude Code / generic hook adapters
 *
 * Host-specific stdout (followup_message / decision:block) lives in adapters;
 * this module only produces a host-agnostic gate result.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveSessionBaseline, ensureSessionBaseline, snapshotPath } = require('./session-baseline');
const { formatSessionVerdict, nextStepForVerdict } = require('./session-verdict');
const { EXIT, shouldGate, exitCodeForRisk } = require('./exit-codes');

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Run CLI session report as a subprocess (for hooks that must not import MCP).
 * Ensures a baseline first (git HEAD or auto snapshot) so hooks work without
 * a prior session start ritual.
 * @param {string} repo
 * @param {object} [opts]
 */
function runGateViaCli(repo, opts = {}) {
  const timeout = Math.max(1000, Number(opts.timeoutMs) || Number(process.env.AV_HOOK_TIMEOUT_MS) || 90000);
  const cliJs = opts.cliJs || process.env.AV_HOOK_CLI || path.join(__dirname, 'cli.js');
  const abs = path.resolve(repo);
  let ensured = false;
  try {
    const ensuredRes = ensureSessionBaseline(abs);
    ensured = !!ensuredRes.ensured;
    if (!ensuredRes.ok && ensuredRes.error !== 'NO_BASELINE') {
      return {
        ok: false,
        timedOut: false,
        exitCode: EXIT.SCAN_FAILED,
        level: 'none',
        high: false,
        verdictText: null,
        stdout: '',
        stderr: ensuredRes.message || '',
        error: ensuredRes.error,
        repo: abs,
        baseline: ensuredRes,
        ensured
      };
    }
  } catch (e) {
    return {
      ok: false,
      timedOut: false,
      exitCode: EXIT.SCAN_FAILED,
      level: 'none',
      high: false,
      verdictText: null,
      stdout: '',
      stderr: String(e.message || e),
      error: 'SCAN_FAILED',
      repo: abs,
      baseline: null,
      ensured
    };
  }

  const r = spawnSync(process.execPath, [cliJs, 'session', 'report', abs, '--renderer', 'builtin'], {
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '' }
  });
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';
  const status = r.status == null ? 3 : r.status;
  const timedOut = !!(r.error && /ETIMEDOUT|timed out/i.test(String(r.error.message || r.error)));

  const lines = stdout.split(/\r?\n/);
  const start = lines.findIndex((l) => /结构验收|🟢|🔴|🟠|🔵/.test(l));
  const verdictText = start >= 0 ? lines.slice(start, start + 3).join('\n') : null;
  const high = status === 1 || /结构验收未通过|Risk level: HIGH|🔴/.test(stdout);
  const level = high ? 'high' : /🟠|Risk level: MEDIUM/.test(stdout) ? 'medium'
    : /🔵|Risk level: LOW/.test(stdout) ? 'low' : 'none';

  return {
    ok: status === 0 || status === 1,
    timedOut,
    exitCode: timedOut ? EXIT.SCAN_FAILED : status,
    level,
    high,
    verdictText,
    stdout,
    stderr,
    error: timedOut ? 'timeout' : (r.error ? String(r.error.message || r.error) : null),
    repo: abs,
    baseline: resolveSessionBaseline(abs),
    ensured
  };
}

function followupFromGate(gate) {
  if (gate.timedOut) {
    return 'Architecture Viewer 结构验收超时。请手动调 av_guard（或 session report）查看结构灯后再宣称完成。';
  }
  if (!gate.ok && gate.exitCode === EXIT.NO_BASELINE) {
    return null; // soft: don't nag every turn on empty scratch repos
  }
  if (!gate.high) return null;
  const block = gate.verdictText || '🔴 结构验收未通过（HIGH）。';
  return `${block}\n\n请先处理红灯后再宣称完成（可用 av_explain_finding）。详情链接可选。`;
}

/**
 * Cursor stop adapter stdout.
 * @param {object} gate
 * @param {{ status?: string, loop_count?: number }} event
 */
function adaptCursorStop(gate, event = {}) {
  const status = event.status || 'completed';
  const loopCount = Number(event.loop_count) || 0;
  if (status !== 'completed' || loopCount >= 1) return { stdout: '{}\n', exitCode: 0 };
  const msg = followupFromGate(gate);
  if (!msg) return { stdout: '{}\n', exitCode: 0 };
  return { stdout: JSON.stringify({ followup_message: msg }) + '\n', exitCode: 0 };
}

/**
 * Claude Code Stop adapter.
 * Exit 2 + reason keeps Claude working; exit 0 allows stop.
 * Also emit JSON decision for hosts that honor it.
 */
function adaptClaudeStop(gate, event = {}) {
  // Claude may send stop_hook_active / loop-like fields; be conservative
  if (event.stop_hook_active === true) {
    return { stdout: '{}\n', exitCode: 0 };
  }
  const msg = followupFromGate(gate);
  if (!msg) return { stdout: '{}\n', exitCode: 0 };
  return {
    stdout: JSON.stringify({
      decision: 'block',
      reason: msg,
      systemMessage: msg
    }) + '\n',
    exitCode: 2,
    stderr: msg + '\n'
  };
}

/** Generic: print verdict text; exit 1 on HIGH (CI / scripts). */
function adaptGeneric(gate) {
  const text = gate.verdictText || (gate.high ? 'HIGH' : 'OK');
  return {
    stdout: text + '\n',
    exitCode: gate.high ? 1 : (gate.ok ? 0 : gate.exitCode)
  };
}

function adaptGate(gate, adapter, event) {
  switch (String(adapter || 'generic').toLowerCase()) {
    case 'cursor':
      return adaptCursorStop(gate, event);
    case 'claude':
    case 'claude-code':
      return adaptClaudeStop(gate, event);
    default:
      return adaptGeneric(gate);
  }
}

module.exports = {
  runGateViaCli,
  followupFromGate,
  adaptCursorStop,
  adaptClaudeStop,
  adaptGeneric,
  adaptGate,
  readStdinJson,
  resolveSessionBaseline,
  ensureSessionBaseline,
  snapshotPath,
  formatSessionVerdict,
  nextStepForVerdict,
  shouldGate,
  exitCodeForRisk,
  EXIT
};
