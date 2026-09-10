#!/usr/bin/env node
'use strict';

/**
 * Cursor stop spike / 模板脚本（Architecture Viewer）
 *
 * 契约（官方）：
 *   stdin:  { status: completed|aborted|error, loop_count, workspace_roots?, ... }
 *   stdout: { followup_message? }  或  {}
 *
 * 硬规则：
 *   - 绿灯 / 无事可做 → 必须打印 {}
 *   - 非空 followup_message 会自动变成下一条用户消息
 *   - loop_limit 在 hooks.json 设为 1；脚本内再挡 loop_count >= 1
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function resolveRepo(input) {
  if (process.env.AV_HOOK_REPO) return path.resolve(process.env.AV_HOOK_REPO);
  const roots = input.workspace_roots;
  if (Array.isArray(roots) && roots[0]) return path.resolve(roots[0]);
  return process.cwd();
}

function loadFixtureReport() {
  const p = process.env.AV_HOOK_FIXTURE_REPORT;
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function runSessionReport(repo) {
  const timeout = Math.max(1000, Number(process.env.AV_HOOK_TIMEOUT_MS) || 90000);
  const cliJs = process.env.AV_HOOK_CLI;
  let cmd;
  let args;
  if (cliJs) {
    cmd = process.execPath;
    args = [cliJs, 'session', 'report', repo, '--renderer', 'builtin'];
  } else {
    cmd = 'arch-viewer';
    args = ['session', 'report', repo, '--renderer', 'builtin'];
  }
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout,
    env: { ...process.env, DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '' }
  });
  return {
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error ? String(r.error.message || r.error) : null
  };
}

function verdictFromFixture(report) {
  if (report.verdict && report.verdict.text) return report.verdict.text;
  const level = (report.risk && report.risk.level) || report.riskLevel || 'none';
  const n = (report.risk && report.risk.findings && report.risk.findings.length)
    || report.findingsCount
    || 0;
  if (level === 'high') {
    return `🔴 结构验收未通过 · ${n} 项风险\n详情（可选）：.av/session-report.html`;
  }
  return null;
}

function isHighFromCli(result) {
  if (result.status === 4 || result.status === 2) return false;
  if (result.status === 1) return true;
  return /结构验收未通过|Risk level: HIGH|🔴/.test(result.stdout || '');
}

function extractVerdictBlock(stdout) {
  const lines = String(stdout).split(/\r?\n/);
  const start = lines.findIndex((l) => /结构验收|🟢|🔴|🟠|🔵/.test(l));
  if (start < 0) return null;
  return lines.slice(start, start + 3).join('\n');
}

function main() {
  const input = readStdin();
  const status = input.status || '';
  const loopCount = Number(input.loop_count) || 0;

  // 用户中止 / 错误：不打扰
  if (status !== 'completed') {
    emit({});
    return;
  }
  // 本会话已自动 followup 过
  if (loopCount >= 1) {
    emit({});
    return;
  }

  // Dry-run / 单测：注入假报告
  const fixture = loadFixtureReport();
  if (fixture) {
    const level = (fixture.risk && fixture.risk.level) || fixture.riskLevel || 'none';
    if (level === 'high') {
      const text = verdictFromFixture(fixture)
        || '🔴 结构验收未通过';
      emit({
        followup_message:
          `${text}\n\n请先处理上述红灯后再宣称完成（可用 av_explain_finding）。不要打开 HTML 也能修；详情链接可选。`
      });
      return;
    }
    emit({});
    return;
  }

  const repo = resolveRepo(input);
  const result = runSessionReport(repo);
  if (result.error && /ETIMEDOUT|timed out/i.test(result.error)) {
    emit({
      followup_message:
        'Architecture Viewer stop hook 扫描超时。请手动跑 session report（或 av_session_report）查看结构灯，再继续。'
    });
    return;
  }

  if (isHighFromCli(result)) {
    const block = extractVerdictBlock(result.stdout)
      || '🔴 结构验收未通过（HIGH）。请查看 session report。';
    emit({
      followup_message:
        `${block}\n\n请先处理红灯后再宣称完成。详情链接可选；可用 av_explain_finding。`
    });
    return;
  }

  emit({});
}

main();
