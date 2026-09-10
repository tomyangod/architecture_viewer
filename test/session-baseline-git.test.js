'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  resolveSessionBaseline,
  headCachePath,
  gitHeadSha
} = require('../lib/session-baseline');

const BIN = path.join(__dirname, '..', 'bin', 'arch-viewer.js');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, DEEPSEEK_API_KEY: '', AV_BASELINE: '' }
  });
}

function git(cwd, args) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'av', GIT_AUTHOR_EMAIL: 'av@test', GIT_COMMITTER_NAME: 'av', GIT_COMMITTER_EMAIL: 'av@test' }
  });
}

function makeGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-git-base-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'app.js'),
    'class App {\n  run() { return 1; }\n}\nmodule.exports = { App };\n');
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'av@test']);
  git(dir, ['config', 'user.name', 'av']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['add', 'src/app.js']);
  const commit = git(dir, ['commit', '-q', '-m', 'init']);
  assert.equal(commit.status, 0, commit.stderr);
  return dir;
}

describe('W23-03 git HEAD 基线', () => {
  it('无 git 且无快照 → NO_BASELINE', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-nogit-'));
    try {
      const r = resolveSessionBaseline(dir);
      assert.equal(r.ok, false);
      assert.equal(r.error, 'NO_BASELINE');
      const cli = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(cli.status, 4);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('无 git + session start 快照 → kind=snapshot', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-snap-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'app.js'),
        'class App {\n  run() { return 1; }\n}\nmodule.exports = { App };\n');
      const start = run(['session', 'start', dir], dir);
      assert.equal(start.status, 0, start.stderr);
      const r = resolveSessionBaseline(dir);
      assert.equal(r.ok, true);
      assert.equal(r.kind, 'snapshot');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('有 git：不 start 也能 report，对照 HEAD 并写缓存', () => {
    const dir = makeGitRepo();
    try {
      const r = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /对照 git HEAD/);
      assert.ok(fs.existsSync(headCachePath(dir)));
      const resolved = resolveSessionBaseline(dir);
      assert.equal(resolved.kind, 'git-head');
      assert.equal(resolved.cacheHit, true);
      assert.equal(resolved.gitHead, gitHeadSha(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('工作区改结构后 report 有变更且标明未提交；commit 后缓存失效且再 report 结构对齐', () => {
    const dir = makeGitRepo();
    try {
      let r = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(r.status, 0, r.stderr);
      const sha1 = gitHeadSha(dir);
      const cache1 = JSON.parse(fs.readFileSync(headCachePath(dir), 'utf8'));
      assert.equal(cache1.gitHead, sha1);

      fs.writeFileSync(path.join(dir, 'src', 'util.js'),
        'class Util {\n  fmt() { return "ok"; }\n}\nmodule.exports = { Util };\n');
      fs.writeFileSync(path.join(dir, 'src', 'app.js'),
        'const { Util } = require("./util");\nclass App {\n  run() { return new Util().fmt(); }\n}\nmodule.exports = { App };\n');

      r = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /含未提交改动/);
      assert.match(r.stdout, /结构变更|架构变更/);

      git(dir, ['add', 'src/util.js', 'src/app.js']);
      const c2 = git(dir, ['commit', '-q', '-m', 'add util']);
      assert.equal(c2.status, 0, c2.stderr);
      const sha2 = gitHeadSha(dir);
      assert.notEqual(sha2, sha1);

      r = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      const cache2 = JSON.parse(fs.readFileSync(headCachePath(dir), 'utf8'));
      assert.equal(cache2.gitHead, sha2);
      assert.match(r.stdout, /对照 git HEAD/);
      assert.ok(!/含未提交改动/.test(r.stdout));
      assert.match(r.stdout, /结构验收通过/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('MCP：git 仓无快照也可 av_session_report', () => {
    const { handleToolCall, stopWatcher } = require('../mcp/server');
    const dir = makeGitRepo();
    try {
      const report = handleToolCall({
        name: 'av_session_report',
        arguments: { repo: dir, confirmRepo: dir }
      });
      assert.ok(!report.error, report.message);
      assert.equal(report.baselineKind, 'git-head');
      assert.ok(report.verdict && report.verdict.text);
      assert.match(report.verdict.text, /对照 git HEAD/);
    } finally {
      try { stopWatcher(dir); } catch { /* ignore */ }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
