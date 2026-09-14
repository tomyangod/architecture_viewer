'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { generateToDir } = require('../lib/index');
const cache = require('../lib/cache');

function mkRepo(root) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'demo-app', version: '1.0.0' }, null, 2)
  );
  fs.writeFileSync(
    path.join(root, 'src', 'auth.js'),
    "class AuthService {\n  login(u) { return u; }\n}\nmodule.exports = { AuthService };\n"
  );
  fs.writeFileSync(
    path.join(root, 'src', 'billing.js'),
    "class BillingService {\n  charge(a) { return a; }\n}\nmodule.exports = { BillingService };\n"
  );
}

describe('W07-01 增量生成引擎', () => {
  let repoRoot;
  let kitDir;

  beforeEach(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'av-incr-'));
    repoRoot = path.join(tmp, 'repo');
    kitDir = path.join(tmp, 'kit');
    fs.mkdirSync(repoRoot, { recursive: true });
    mkRepo(repoRoot);
  });

  afterEach(() => fs.rmSync(path.dirname(repoRoot), { recursive: true, force: true }));

  function snapshotDiagrams() {
    const out = {};
    for (const f of fs.readdirSync(kitDir)) {
      if (f.endsWith('.md')) out[f] = fs.readFileSync(path.join(kitDir, f), 'utf8');
    }
    return out;
  }

  it('首次生成写全部 6 张图并落缓存', () => {
    const r = generateToDir(repoRoot, kitDir, { compatSix: true });
    assert.equal(r.cached, false);
    assert.equal(r.written.length, 6);
    assert.ok(fs.existsSync(cache.cachePath(kitDir)), 'cache file written');
    const c = JSON.parse(fs.readFileSync(cache.cachePath(kitDir), 'utf8'));
    assert.equal(c.version, 1);
    assert.ok(c.manifestHash);
    assert.equal(Object.keys(c.diagrams).length, 6);
  });

  it('无改动二次生成命中缓存：written=0 且更快', () => {
    const cold = generateToDir(repoRoot, kitDir, { compatSix: true });
    assert.equal(cold.cached, false);
    const warm = generateToDir(repoRoot, kitDir, { compatSix: true });
    assert.equal(warm.cached, true, 'warm run should be cache hit');
    assert.equal(warm.written.length, 0, 'no diagrams rewritten');
    assert.equal(warm.changedDiagrams.length, 0);
    assert.equal(warm.unchangedDiagrams.length, 6);
    // 快路径应明显更快（跳过扫描）；宽松断言，避免 CI 抖动
    assert.ok(warm.timing.ms <= cold.timing.ms + 5, 'warm not slower than cold');
  });

  it('清单指纹对源码改动敏感（mtime/size 变化）', () => {
    generateToDir(repoRoot, kitDir, { compatSix: true });
    const before = cache.sourceManifest(repoRoot);
    // 改动一个源文件
    fs.writeFileSync(
      path.join(repoRoot, 'src', 'billing.js'),
      "class BillingService {\n  charge(a) { return a * 2; }\n  refund(a) { return a; }\n}\nmodule.exports = { BillingService };\n"
    );
    const after = cache.sourceManifest(repoRoot);
    assert.notEqual(before.hash, after.hash, 'manifest hash must change on edit');
  });

  it('单模块改动：仅相关视图重写，其余视图字节不变', () => {
    generateToDir(repoRoot, kitDir, { compatSix: true });
    const before = snapshotDiagrams();

    // 架构级改动：新增一个 worker 模块（目录 + 新类），deployment 视图不应受影响
    fs.mkdirSync(path.join(repoRoot, 'worker'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, 'worker', 'queue.js'),
      "class QueueWorker {\n  process(job) { return job; }\n}\nmodule.exports = { QueueWorker };\n"
    );
    const r = generateToDir(repoRoot, kitDir, { compatSix: true });
    assert.equal(r.cached, false);
    assert.ok(r.changedDiagrams.length >= 1, 'at least one diagram regenerated');
    assert.ok(r.changedDiagrams.length < 6, 'not all diagrams regenerated');
    assert.ok(r.unchangedDiagrams.includes('deployment-ops.md'), 'deployment view unaffected by new module');

    const after = snapshotDiagrams();
    // 未变动视图内容字节一致
    for (const f of r.unchangedDiagrams) {
      assert.equal(after[f], before[f], `unchanged diagram ${f} must be byte-identical`);
    }
    // 重写的视图确实在 written 列表
    for (const f of r.changedDiagrams) {
      assert.ok(r.written.includes(f), `changed diagram ${f} should be written`);
    }
  });

  it('缓存文件损坏时安全回退全量生成', () => {
    generateToDir(repoRoot, kitDir, { compatSix: true });
    fs.writeFileSync(cache.cachePath(kitDir), '{ not valid json');
    const r = generateToDir(repoRoot, kitDir, { compatSix: true });
    assert.equal(r.cached, false);
    assert.equal(r.written.length, 6);
    assert.ok(r.protocol.ok, 'regenerated diagrams still validate');
  });

  it('overwritten templates or manual output edits cannot reuse a cached PASS', () => {
    generateToDir(repoRoot, kitDir, { compatSix: true });
    const file = path.join(kitDir, 'c4-context.md');
    const generated = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, '# Reinitialized\n*模板文件 · 请替换*\n');
    const result = generateToDir(repoRoot, kitDir, { compatSix: true });
    assert.equal(result.cached, false);
    assert.ok(result.changedDiagrams.includes('c4-context.md'));
    assert.equal(fs.readFileSync(file, 'utf8'), generated);
    assert.equal(result.protocol.ok, true);
  });

  for (const change of [
    data => { data.engine = 'llm'; },
    data => { data.generationKey = 'previous-build'; },
    data => { delete data.check; }
  ]) {
    it('requires the requested engine, generator identity and recorded validation', () => {
      generateToDir(repoRoot, kitDir, { compatSix: true });
      const data = cache.loadCache(kitDir);
      change(data);
      cache.saveCache(kitDir, data);
      const result = generateToDir(repoRoot, kitDir, { compatSix: true });
      assert.equal(result.cached, false);
      assert.equal(result.protocol.ok, true);
      assert.equal(result.semantics.status, 'unverified');
    });
  }

  it('preserves full cached drift details rather than inventing an empty PASS', () => {
    generateToDir(repoRoot, kitDir, { compatSix: true });
    const data = cache.loadCache(kitDir);
    data.check.drift = { ok: false, missing: [{ label: 'fixture-worker' }], extra: [] };
    cache.saveCache(kitDir, data);
    const result = generateToDir(repoRoot, kitDir, { compatSix: true });
    assert.equal(result.cached, true);
    assert.equal(result.drift.ok, false);
    assert.deepEqual(result.drift.missing, data.check.drift.missing);
  });

  it('detects same-size source changes with preserved mtimes', () => {
    const file = path.join(repoRoot, 'src', 'billing.js');
    const stat = fs.statSync(file);
    const before = cache.sourceManifest(repoRoot);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('BillingService', 'InvoiceService'));
    fs.utimesSync(file, stat.atime, stat.mtime);
    assert.equal(fs.statSync(file).size, stat.size);
    assert.notEqual(cache.sourceManifest(repoRoot).hash, before.hash);
  });

  it('tracks layer, exclusion and project-description inputs, including hidden config', () => {
    for (const rel of [
      'architecture.layers.json', '.av/layers.json', '.arch-viewer-ignore',
      '.gitignore', 'README.md'
    ]) {
      const before = cache.sourceManifest(repoRoot);
      const file = path.join(repoRoot, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, rel.endsWith('.json') ? '{}' : 'runtime/\n');
      assert.notEqual(cache.sourceManifest(repoRoot).hash, before.hash, rel);
    }
  });

  it('refinePayloadScale：无改动增量 payload 为 0，全量非 0', () => {
    const r = generateToDir(repoRoot, kitDir, { compatSix: true });
    assert.ok(r.payloadScale.fullBytes > 0, 'full payload non-empty');
    // 模拟无改动：changed 为空
    const scale = cache.refinePayloadScale(
      { 'a.md': 'x'.repeat(100), 'b.md': 'y'.repeat(100) },
      []
    );
    assert.equal(scale.incrementalBytes, 0);
    assert.equal(scale.reductionPct, 100);
    // 模拟单视图改动
    const partial = cache.refinePayloadScale(
      { 'a.md': 'x'.repeat(100), 'b.md': 'y'.repeat(300) },
      ['a.md']
    );
    assert.equal(partial.reductionPct, 75);
  });
});
