'use strict';

// W15-01: 主仓 / worktree / 子目录 session start 不检查错目录
//
// 验收标准：
//   三种场景各跑一次 session start，回显路径正确；
//   worktree 场景明确警告；路径不一致时中止，不会静默用错。

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const {
  detectPathMismatch,
  sessionPaths,
  isGitWorktree,
  findGitRoot
} = require('../lib/session-paths');

const BIN = path.join(__dirname, '..', 'bin', 'arch-viewer.js');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, DEEPSEEK_API_KEY: '' }
  });
}

function gitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-paths-'));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 't@t.test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

function gitRepoWithCommit() {
  const dir = gitRepo();
  fs.writeFileSync(path.join(dir, 'app.js'), 'class App {}\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('session-paths fail-closed', () => {
  it('samePath / isInside 把 macOS /var 与 /private/var 视为同一路径', () => {
    const dir = gitRepo();
    try {
      const resolved = path.resolve(dir);
      let real;
      try { real = fs.realpathSync(resolved); } catch { real = resolved; }
      const { samePath, isInside } = require('../lib/session-paths');
      assert.equal(samePath(resolved, real), true);
      assert.equal(isInside(path.join(resolved, '.av'), real), true);
      assert.equal(isInside(path.join(real, '.av'), resolved), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sessionPaths 的基线目录与报告目录同属检查目录', () => {
    const p = sessionPaths('/tmp/example-repo');
    assert.equal(p.baselineDir, p.reportDir);
    assert.ok(p.baselineSavedTo.startsWith(p.baselineDir));
    assert.ok(p.reportEntry.startsWith(p.reportDir));
  });

  it('cwd 与 repo 为两个 Git 根时中止，confirmRepo 可放行', () => {
    const a = gitRepo();
    const b = gitRepo();
    const prev = process.cwd();
    try {
      process.chdir(a);
      const blocked = detectPathMismatch(b, {});
      assert.ok(blocked);
      assert.equal(blocked.error, 'PATH_MISMATCH');
      assert.equal(blocked.abort, true);

      const allowed = detectPathMismatch(b, { confirmRepo: b });
      assert.equal(allowed, null);
    } finally {
      process.chdir(prev);
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });
});

describe('W15-01: 主仓 / worktree / 子目录 session start', () => {
  it('主仓：回显检查目录 = 主仓根，基线写在主仓 .av，无 worktree 警告', () => {
    const dir = gitRepoWithCommit();
    try {
      const r = run(['session', 'start', dir], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, new RegExp(`Checking repo:\\s+${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      assert.match(r.stdout, new RegExp(`Baseline saved to:\\s+${path.join(dir, '.av', 'graph-baseline.json').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      assert.ok(!/Git worktree/.test(r.stdout), `主仓不应出现 worktree 警告: ${r.stdout}`);
      assert.ok(!/不是 Git 仓库根/.test(r.stdout), `主仓根不应提示子目录: ${r.stdout}`);
      assert.equal(isGitWorktree(dir), false);
      assert.equal(findGitRoot(dir), dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('worktree：回显检查目录 = worktree，明确警告，基线不写主仓', () => {
    const main = gitRepoWithCommit();
    const wt = path.join(os.tmpdir(), `av-wt-${Date.now()}`);
    try {
      execFileSync('git', ['worktree', 'add', '--detach', wt], { cwd: main, stdio: 'ignore' });
      assert.equal(isGitWorktree(wt), true, '检出目录应被识别为 worktree');
      assert.equal(isGitWorktree(main), false);

      const r = run(['session', 'start', wt], wt);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, new RegExp(`Checking repo:\\s+${wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      assert.match(r.stdout, /Git worktree，不是主仓/);
      assert.ok(fs.existsSync(path.join(wt, '.av', 'graph-baseline.json')), '基线应写在 worktree');
      assert.ok(!fs.existsSync(path.join(main, '.av', 'graph-baseline.json')), '主仓不应被写入基线');
    } finally {
      try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: main, stdio: 'ignore' }); } catch { /* ignore */ }
      fs.rmSync(wt, { recursive: true, force: true });
      fs.rmSync(main, { recursive: true, force: true });
    }
  });

  it('子目录：回显检查目录 = 子目录，警告不是 Git 根，基线写在子目录 .av', () => {
    const dir = gitRepoWithCommit();
    const sub = path.join(dir, 'src');
    try {
      fs.mkdirSync(sub);
      fs.writeFileSync(path.join(sub, 'mod.js'), 'class Mod {}\n');
      const r = run(['session', 'start', sub], sub);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, new RegExp(`Checking repo:\\s+${sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      assert.match(r.stdout, /不是 Git 仓库根/);
      assert.match(r.stdout, /Git 根目录/);
      assert.ok(fs.existsSync(path.join(sub, '.av', 'graph-baseline.json')), '基线应写在子目录');
      assert.ok(!fs.existsSync(path.join(dir, '.av', 'graph-baseline.json')), '主仓根不应被写入基线');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('路径不一致：在 worktree 里对主仓跑 start 会中止，不写基线', () => {
    const main = gitRepoWithCommit();
    const wt = path.join(os.tmpdir(), `av-wt-mismatch-${Date.now()}`);
    try {
      execFileSync('git', ['worktree', 'add', '--detach', wt], { cwd: main, stdio: 'ignore' });
      const r = run(['session', 'start', main], wt);
      assert.notEqual(r.status, 0, '路径不一致必须非 0 退出');
      assert.match(r.stderr + r.stdout, /PATH_MISMATCH|不一致|中止/);
      assert.ok(!fs.existsSync(path.join(main, '.av', 'graph-baseline.json')), '中止后主仓无基线');
      assert.ok(!fs.existsSync(path.join(wt, '.av', 'graph-baseline.json')), '中止后 worktree 无基线');
    } finally {
      try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: main, stdio: 'ignore' }); } catch { /* ignore */ }
      fs.rmSync(wt, { recursive: true, force: true });
      fs.rmSync(main, { recursive: true, force: true });
    }
  });
});
