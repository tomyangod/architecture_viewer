'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const BIN = path.join(__dirname, '..', 'bin', 'arch-viewer.js');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, DEEPSEEK_API_KEY: '' }
  });
}

describe('CLI bin shim smoke (spawn)', () => {
  it('help prints usage and exits 0 (regression: shim must invoke main)', () => {
    const r = run(['help']);
    assert.equal(r.status, 0, 'stderr: ' + r.stderr);
    assert.match(r.stdout, /Architecture Viewer CLI/);
    assert.match(r.stdout, /arch-viewer (init|generate|check)/);
  });

  it('--version / -V 打印 package.json 版本', () => {
    const expected = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
    for (const flag of ['--version', '-V', 'version']) {
      const r = run([flag]);
      assert.equal(r.status, 0, flag + ' stderr: ' + r.stderr);
      assert.equal(r.stdout.trim(), expected);
    }
  });

  it('unknown command exits 2, not silent 0', () => {
    const r = run(['definitely-not-a-command']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Unknown command/);
  });

  it('--refine without API key exits 1 with readable error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-cli-nokey-'));
    try {
      const r = run(['generate', dir, '--refine'], dir);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr + r.stdout, /[Kk]ey|API|DEEPSEEK/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init + generate + check end-to-end on a tiny fixture', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-cli-e2e-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'src', 'app.py'),
        'from flask import Flask\napp = Flask(__name__)\n\n@app.route("/")\ndef index():\n    return "ok"\n'
      );

      const init = run(['init', dir], dir);
      assert.equal(init.status, 0, init.stderr);
      assert.match(init.stdout, /Initialized kit/);

      const kitDir = path.join(dir, 'architecture_viewer');
      assert.ok(fs.existsSync(path.join(kitDir, 'architecture_visualized.html')));

      // init 后未 generate：模板占位还在 → --filled 必须红灯
      const checkTpl = run(['check', kitDir, '--filled', '--drift', '--repo', dir], dir);
      assert.equal(checkTpl.status, 1, 'unfilled kit must fail --filled');

      // generate 骨架后：check 必须真实执行（OK 或 DRIFT/ERROR 输出），退出码 0/1 均可
      const gen = run(['generate', dir], dir);
      assert.equal(gen.status, 0, gen.stderr);
      const checkOk = run(['check', kitDir, '--filled', '--drift', '--repo', dir], dir);
      assert.ok([0, 1].includes(checkOk.status), 'check should run, not crash');
      assert.match(checkOk.stdout + checkOk.stderr, /OK|DRIFT|ERROR/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('CLI archify-export', () => {
  function fixtureRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-cli-ax-'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'src', 'app.py'),
      'from flask import Flask\napp = Flask(__name__)\n\n@app.route("/")\ndef index():\n    return "ok"\n'
    );
    return dir;
  }

  it('无基线时退出码 4 并提示先 session start（退出码契约）', () => {
    const dir = fixtureRepo();
    try {
      const r = run(['archify-export', dir, '--scope', 'layers'], dir);
      assert.equal(r.status, 4);
      assert.match(r.stderr + r.stdout, /session start/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('非法 --scope 退出码 2', () => {
    const dir = fixtureRepo();
    try {
      const r = run(['archify-export', dir, '--scope', 'bogus'], dir);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /Invalid --scope/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('session start 后导出 --json 退出码 0，IR 三件套落盘', () => {
    const dir = fixtureRepo();
    try {
      const start = run(['session', 'start', dir], dir);
      assert.equal(start.status, 0, start.stderr);

      const r = run(['archify-export', dir, '--scope', 'layers', '--json'], dir);
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.ok(out.files && out.files.head);
      assert.equal(out.sidecar.scopeUsed, 'layers');
      assert.ok(fs.existsSync(path.join(dir, '.av', 'archify-layers.head.json')));
      assert.ok(fs.existsSync(path.join(dir, '.av', 'archify-layers.base.json')));
      assert.ok(fs.existsSync(path.join(dir, '.av', 'archify-layers.sidecar.json')));

      const head = JSON.parse(fs.readFileSync(path.join(dir, '.av', 'archify-layers.head.json'), 'utf8'));
      assert.equal(head.diagram_type, 'architecture');
      assert.equal(head.layout.mode, 'grid');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('CLI session report renderer', () => {
  it('--renderer builtin 写出内置 HTML，不依赖 Archify', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-cli-rend-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'app.py'), 'class App:\n    pass\n');
      const start = run(['session', 'start', dir], dir);
      assert.equal(start.status, 0, start.stderr);
      const r = run(['session', 'report', dir, '--renderer', 'builtin'], dir);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /\[builtin\]/);
      const html = fs.readFileSync(path.join(dir, '.av', 'session-report.html'), 'utf8');
      assert.match(html, /架构变更报告|REPORT_DATA/);
      assert.ok(fs.existsSync(path.join(dir, '.av', 'session-report.builtin.html')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('session start 刷新基线时清掉旧报告', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-cli-stale-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'app.py'), 'class App:\n    pass\n');
      const first = run(['session', 'start', dir], dir);
      assert.equal(first.status, 0, first.stderr);
      const av = path.join(dir, '.av');
      fs.writeFileSync(path.join(av, 'session-report.json'), '{"findings":[]}');
      fs.writeFileSync(path.join(av, 'session-report.html'), '<html>stale</html>');
      fs.writeFileSync(path.join(av, 'session-report.archify.html'), '<html>stale-archify</html>');
      fs.writeFileSync(path.join(av, 'archify-changed.sidecar.json'), '{}');
      fs.writeFileSync(path.join(av, 'archify-layers.head.json'), '{}');
      const second = run(['session', 'start', dir], dir);
      assert.equal(second.status, 0, second.stderr);
      assert.match(second.stdout, /Cleared stale session report/);
      assert.ok(!fs.existsSync(path.join(av, 'session-report.json')));
      assert.ok(!fs.existsSync(path.join(av, 'session-report.html')));
      assert.ok(!fs.existsSync(path.join(av, 'session-report.archify.html')));
      assert.ok(!fs.existsSync(path.join(av, 'archify-changed.sidecar.json')));
      assert.ok(!fs.existsSync(path.join(av, 'archify-layers.head.json')));
      assert.ok(fs.existsSync(path.join(av, 'graph-baseline.json')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
