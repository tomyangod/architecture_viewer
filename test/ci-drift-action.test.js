'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci-drift-action.mjs');
const EXAMPLE = path.join(ROOT, 'architecture-rules.example.yaml');
const DEMO = path.join(ROOT, 'eval', 'demo-drift');
const VIOLATE = path.join(ROOT, 'eval', 'fixtures', 'rules-violate');
const OK = path.join(ROOT, 'eval', 'fixtures', 'rules-ok');

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('W08-01 ci-drift-action', () => {
  it('demo-drift 红灯，评论含视图名与缺失项', () => {
    const r = run(['--kit', DEMO, '--filled', '--no-drift', '--no-comment']);
    assert.notEqual(r.status, 0);
    const out = (r.stdout || '') + (r.stderr || '');
    assert.match(out, /c4-container\.md/);
    assert.match(out, /NOT DECLARED|ghost_service|placeholder/);
    assert.match(out, /建议动作/);
    assert.match(out, /arch-viewer:architecture-drift/);
  });

  it('rules-violate 红灯评论含规则名', () => {
    const r = run(['--kit', VIOLATE, '--no-drift', '--rules', EXAMPLE, '--no-comment']);
    assert.notEqual(r.status, 0);
    const out = (r.stdout || '') + (r.stderr || '');
    assert.match(out, /no-controller-to-storage/);
    assert.match(out, /node-id-snake/);
    assert.match(out, /团队规范/);
  });

  it('rules-ok 通过且默认不强制评论通过', () => {
    const r = run(['--kit', OK, '--no-drift', '--rules', EXAMPLE, '--no-comment']);
    assert.equal(r.status, 0, r.stderr);
    const out = (r.stdout || '') + (r.stderr || '');
    assert.match(out, /通过/);
  });

  it('workflow 与 Gitee 等价配置存在', () => {
    const fs = require('fs');
    assert.ok(fs.existsSync(path.join(ROOT, '.github', 'workflows', 'architecture-drift.yml')));
    assert.ok(fs.existsSync(path.join(ROOT, '.gitee', 'workflows', 'architecture-drift.yml')));
    const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'architecture-drift.yml'), 'utf8');
    assert.match(yml, /ci-drift-action\.mjs/);
    assert.match(yml, /--rules/);
    assert.match(yml, /demo-drift/);
  });
});
