'use strict';

// W15-05: 绿灯文案 — 不说「无变化」，说「未检测到架构结构变化（源代码内容可能已修改）」
//
// 验收标准：
//   函数体内改动、注释改动等非架构变化时，报告明确写
//   「未检测到架构结构变化（源代码内容可能已修改）」，不说「无变化」
//
// 两种绿灯场景：
//   A. 零结构变化（totalChanges=0）：函数体/注释改了但结构指纹不变
//      → CLI: "未检测到架构结构变化（源代码内容可能已修改）"
//      → MCP: "未检测到架构结构变化（源代码内容可能已修改）"
//      → HTML: "未检测到架构结构变化——不是源码没变"
//      → PR:  "未检测到架构结构变更...源代码内容可能已修改"
//   B. 有结构变化但无风险（totalChanges>0, findings=0）
//      → CLI: "有 N 项架构变更，但无风险发现"
//      → MCP: "有 N 项架构变更，但无风险发现"

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'arch-viewer.js');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, DEEPSEEK_API_KEY: '' }
  });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-w1505-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.js'),
    'class App {\n  run() { return 1; }\n}\nmodule.exports = { App };\n');
  return dir;
}

describe('W15-05: 绿灯文案 — 「未检测到架构结构变化」而非「无变化」', () => {

  // ── A. 零结构变化：改函数体/注释，结构指纹不变 ──
  it('A1. CLI 零结构变化时输出「未检测到架构结构变化」而非「无风险发现」', () => {
    const dir = makeRepo();
    try {
      let r = run(['session', 'start', dir], dir);
      assert.equal(r.status, 0, r.stderr);
      // 改函数体（不改变结构）: run() 返回值从 1 改为 2
      fs.writeFileSync(path.join(dir, 'src', 'app.js'),
        'class App {\n  run() { return 2; }\n}\nmodule.exports = { App };\n');
      r = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      // 不应出现旧文案「无风险发现」
      assert.ok(!/无风险发现/.test(r.stdout), `不应出现「无风险发现」，实际: ${r.stdout}`);
      // 应出现新文案
      assert.match(r.stdout, /未检测到架构结构变化/);
      assert.match(r.stdout, /检测到源码内容变化/);
      assert.match(r.stdout, /函数体实现差异|未判定业务对错|未检查业务逻辑/);
      assert.ok(!/源代码内容可能已修改/.test(r.stdout), '有 contentFingerprint 时应明确说源码变了');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('A2. CLI 零结构变化时不说「无变化」（禁止词检测）', () => {
    const dir = makeRepo();
    try {
      let r = run(['session', 'start', dir], dir);
      assert.equal(r.status, 0, r.stderr);
      // 只改注释
      fs.writeFileSync(path.join(dir, 'src', 'app.js'),
        '// this is a comment\nclass App {\n  run() { return 1; }\n}\nmodule.exports = { App };\n');
      r = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      // 禁止出现「无变化」（太绝对，暗示代码完全没改）
      assert.ok(!/^\s*无变化\s*$/m.test(r.stdout), `不应出现裸「无变化」: ${r.stdout}`);
      assert.match(r.stdout, /未检测到架构结构变化/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('A3. HTML 零结构变化时展示「检测到源码内容变化」', () => {
    const dir = makeRepo();
    try {
      let r = run(['session', 'start', dir], dir);
      assert.equal(r.status, 0, r.stderr);
      fs.writeFileSync(path.join(dir, 'src', 'app.js'),
        'class App {\n  run() { return 42; }\n}\nmodule.exports = { App };\n');
      r = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      const html = fs.readFileSync(path.join(dir, '.av', 'session-report.html'), 'utf8');
      assert.match(html, /未检测到架构结构变化/);
      assert.match(html, /检测到源码内容变化/);
      // 风险标签不应该是「无风险」（过于绝对），应是「无架构风险」
      assert.match(html, /无架构风险/);
      assert.ok(!/无风险<\//.test(html), '不应出现裸「无风险」标签');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('A4. 完全没改文件时输出「源码与结构均未变化」', () => {
    const dir = makeRepo();
    try {
      let r = run(['session', 'start', dir], dir);
      assert.equal(r.status, 0, r.stderr);
      r = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /源码与结构均未变化/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── B. 有结构变化但无风险 ──
  it('B1. CLI 有结构变化无风险时输出「有 N 项架构变更，但无风险发现」', () => {
    const dir = makeRepo();
    try {
      // 初始：两个文件，app.js import helper.js
      fs.writeFileSync(path.join(dir, 'src', 'helper.js'),
        'class Helper {\n  aid() { return 0; }\n}\nmodule.exports = { Helper };\n');
      fs.writeFileSync(path.join(dir, 'src', 'app.js'),
        'const { Helper } = require("./helper");\nclass App {\n  run() { const h = new Helper(); return h.aid(); }\n}\nmodule.exports = { App };\n');
      let r = run(['session', 'start', dir], dir);
      assert.equal(r.status, 0, r.stderr);
      // 新增一个被 app.js 引用的工具类（结构变化，有 import 边，无违规）
      fs.writeFileSync(path.join(dir, 'src', 'util.js'),
        'class Util {\n  fmt() { return "ok"; }\n}\nmodule.exports = { Util };\n');
      fs.writeFileSync(path.join(dir, 'src', 'app.js'),
        'const { Helper } = require("./helper");\nconst { Util } = require("./util");\nclass App {\n  run() { const h = new Helper(); const u = new Util(); return u.fmt() + h.aid(); }\n}\nmodule.exports = { App };\n');
      r = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      // 有结构变化时不应出现「未检测到架构结构变化」
      assert.ok(!/未检测到架构结构变化/.test(r.stdout), `有变化时不应说「未检测到」: ${r.stdout}`);
      // 应出现「架构变更」字样
      assert.match(r.stdout, /架构变更/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── C. PR comment 文案 ──
  it('C. PR comment 旧基线（无 contentFingerprint）仍写「源代码内容可能已修改」', () => {
    const { formatPullRequestComment } = require('../lib/pr-comment');
    const diff = { summary: { totalChanges: 0, addedTypes: 0, removedTypes: 0, addedEdges: 0, removedEdges: 0, addedExternalDeps: 0, removedExternalDeps: 0 } };
    const findings = [];
    const riskSummary = { level: 'none' };
    const impact = { changedCount: 0, impactedCount: 0 };
    const text = formatPullRequestComment({
      diff, findings, riskSummary, impact,
      repoName: 'demo', baseRef: 'main', headRef: 'feature',
      baselineChanged: false
    });
    assert.match(text, /未检测到架构结构变更/);
    assert.match(text, /源代码内容可能已修改/);
  });

  it('C2. PR comment 有 sourceChanged 时写「已检测到源码内容变化」', () => {
    const { formatPullRequestComment } = require('../lib/pr-comment');
    const diff = { summary: { totalChanges: 0, sourceChanged: true, addedTypes: 0, removedTypes: 0, addedEdges: 0, removedEdges: 0, addedExternalDeps: 0, removedExternalDeps: 0 } };
    const text = formatPullRequestComment({
      diff, findings: [], riskSummary: { level: 'none' }, impact: { changedCount: 0, impactedCount: 0 },
      repoName: 'demo', baseRef: 'main', headRef: 'feature',
      baselineChanged: false
    });
    assert.match(text, /已检测到源码内容变化/);
  });
});
