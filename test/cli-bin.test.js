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
