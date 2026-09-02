'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ws = require('../lib/workspace');
const { main } = require('../lib/cli');

function mkRepo(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, body] of Object.entries(files)) {
    const p = path.join(dir, file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return dir;
}

const SVC_V1 = {
  'svc.js': `function alpha(x) { return x + 1; }\nmodule.exports = { alpha };\n`
};
const SVC_V2 = {
  'svc.js': `function alpha(x) { return x + 1; }\nfunction beta(x) { return x * 2; }\nmodule.exports = { alpha, beta };\n`
};

function captureLog(fn) {
  let out = '';
  const orig = console.log;
  console.log = (s) => { out += String(s) + '\n'; };
  return Promise.resolve(fn())
    .finally(() => { console.log = orig; })
    .then((code) => ({ code, out }));
}

describe('C3 多仓基线管理', () => {
  let root;
  let configPath;
  let repoA;
  let repoB;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'av-ws-'));
    configPath = path.join(root, 'reg.json');
    repoA = mkRepo(path.join(root, 'repoA'), SVC_V1);
    repoB = mkRepo(path.join(root, 'repoB'), SVC_V1);
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('注册表 CRUD：去重、名字冲突、移除', () => {
    const crudConfig = path.join(root, 'crud.json');
    const dirC = mkRepo(path.join(root, 'repoC'), SVC_V1);
    const dirD = mkRepo(path.join(root, 'repoD'), SVC_V1);
    const reg = { path: crudConfig, repos: [] };
    const r1 = ws.addRepo(reg, dirC, 'svc-c');
    assert.equal(r1.added, true);
    const dup = ws.addRepo(reg, dirC, 'svc-c-again');
    assert.equal(dup.added, false);
    assert.match(dup.reason, /已注册/);
    const nameClash = ws.addRepo(reg, dirD, 'svc-c');
    assert.equal(nameClash.added, false);
    assert.match(nameClash.reason, /占用/);
    const r2 = ws.addRepo(reg, dirD, 'svc-d');
    assert.equal(r2.added, true);
    assert.equal(reg.repos.length, 2);
    ws.saveRegistry(reg);
    assert.ok(fs.existsSync(crudConfig));

    const loaded = ws.loadRegistry(crudConfig);
    assert.equal(loaded.repos.length, 2);
    assert.equal(ws.removeRepo(loaded, 'svc-d'), true);
    assert.equal(loaded.repos.length, 1);
    assert.equal(ws.removeRepo(loaded, 'nonexistent'), false);

    const bad = ws.addRepo({ path: crudConfig, repos: [] }, path.join(root, 'nope'), 'x');
    assert.equal(bad.added, false);
    assert.match(bad.reason, /目录不存在/);
  });

  test('CLI workspace add 自动建档基线', async () => {
    const code = await main(['workspace', 'add', repoA, '--name', 'alpha-svc', '--config', configPath]);
    assert.equal(code, 0);
    assert.ok(fs.existsSync(path.join(repoA, '.av', 'graph-baseline.json')));
    const reg = ws.loadRegistry(configPath);
    assert.ok(reg.repos.some((r) => r.name === 'alpha-svc' && r.path === repoA));
  });

  test('CLI workspace report --json：无变更仓 NONE', async () => {
    const { code, out } = await captureLog(() =>
      main(['workspace', 'report', '--config', configPath, '--json'])
    );
    assert.equal(code, 0);
    const parsed = JSON.parse(out.trim());
    assert.equal(parsed[0].status, 'ok');
    assert.equal(parsed[0].level, 'none');
  });

  test('CLI workspace report：检出变更仓 + HTML 落盘', async () => {
    mkRepo(repoA, SVC_V2); // 新增函数 beta
    const { code, out } = await captureLog(() =>
      main(['workspace', 'report', '--config', configPath, '--json'])
    );
    assert.equal(code, 0); // low risk → 退出码 0
    const parsed = JSON.parse(out.trim());
    const a = parsed.find((r) => r.name === 'alpha-svc');
    assert.equal(a.status, 'ok');
    assert.ok(a.counts.total > 0, '应检出新增函数');
    assert.ok(fs.existsSync(path.join(repoA, '.av', 'session-report.html')));

    const text = await captureLog(() => main(['workspace', 'report', '--config', configPath]));
    assert.match(text.out, /多仓架构验收/);
    assert.match(text.out, /仓有变更/);
  });

  test('无基线仓报告为 no-baseline，不崩溃', async () => {
    const reg = ws.loadRegistry(configPath);
    reg.repos.push({ name: 'no-base', path: repoB });
    ws.saveRegistry(reg);
    const { code, out } = await captureLog(() =>
      main(['workspace', 'report', '--config', configPath])
    );
    assert.equal(code, 0);
    assert.match(out, /无基线/);
  });
});
