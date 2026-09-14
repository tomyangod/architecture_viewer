'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');
const { buildGraph, toPersistableGraph } = require('../lib/extract-graph');
const jsts = require('../lib/extract/jsts');
const { walkFiles } = require('../lib/extract/shared');
const { loadSessionRules } = require('../lib/risk-rules');
const { runHostedCheck } = require('../web/lib/pro/host-drift');
const { toolSessionReport, toolExplainFinding, stopWatcher } = require('../mcp/server');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(__dirname, '.hosted-validation-'));
  fs.writeFileSync(path.join(dir, 'service.js'), 'export class Service {}\n');
  t.after(() => {
    stopWatcher(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function snapshot(dir, stats) {
  const graph = toPersistableGraph(buildGraph(dir));
  Object.assign(graph.stats, stats);
  fs.mkdirSync(path.join(dir, '.av'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.av', 'session.json'), JSON.stringify({ baseline: 'snapshot' }));
  fs.writeFileSync(path.join(dir, '.av', 'graph-baseline.json'), JSON.stringify(graph));
}

function assertFailed(result, reason, side) {
  assert.equal(result.ok, false);
  assert.equal(result.reason, reason);
  assert.equal(result.diff, undefined, 'must not compare incomplete graphs');
  assert.equal(result.findings, undefined);
  if (side) assert.match(result.message, new RegExp(side));
  assert.match(result.markdown, /失败|错误/);
}

describe('hosted fail-closed graph validation', () => {
  for (const side of ['head', 'base']) {
    for (const schema of ['schema.sql', 'schema.prisma']) {
      it(`${side} unreadable ${schema} cannot produce a hosted pass`, t => {
        const head = fixture(t);
        const base = fixture(t);
        const badRoot = side === 'head' ? head : base;
        const badFile = path.join(badRoot, schema);
        fs.writeFileSync(badFile, schema.endsWith('.sql') ? 'CREATE TABLE sample (id INT);' : 'model Sample { id Int @id }');
        const read = fs.readFileSync;
        t.mock.method(fs, 'readFileSync', function (file, ...args) {
          if (String(file) === badFile) throw Object.assign(new Error('fixture schema read denied'), { code: 'EACCES' });
          return read.call(this, file, ...args);
        });
        assert.deepEqual(buildGraph(badRoot).stats.unreadableFiles, [schema]);
        assertFailed(runHostedCheck(head, { pr: 1, baseDir: base }), 'SCAN_FAILED', side);
      });
    }

    it(`${side} empty source scan is not a green graph`, (t) => {
      const head = fixture(t);
      const base = fixture(t);
      fs.unlinkSync(path.join(side === 'head' ? head : base, 'service.js'));
      assertFailed(runHostedCheck(head, { pr: 1, baseDir: base }), 'SCAN_FAILED', side);
    });

    it(`${side} missing scan directory is not an empty healthy graph`, (t) => {
      const head = fixture(t);
      const base = fixture(t);
      const root = side === 'head' ? path.join(head, 'missing') : head;
      const baseDir = side === 'base' ? path.join(base, 'missing') : base;
      assertFailed(runHostedCheck(root, { pr: 1, baseDir }), 'SCAN_FAILED');
    });

    for (const excluded of [false, true]) {
      it(`${side} unreadable nested directory ${excluded ? 'is skipped only when excluded' : 'aborts the scan'}`, (t) => {
        const head = fixture(t);
        const base = fixture(t);
        const badRoot = side === 'head' ? head : base;
        const badDir = path.join(badRoot, 'service');
        fs.mkdirSync(badDir);
        fs.writeFileSync(path.join(badDir, 'api.js'), 'export class Api {}\n');
        if (excluded) fs.writeFileSync(path.join(badRoot, '.arch-viewer-ignore'), 'service\n');
        const read = fs.readdirSync;
        t.mock.method(fs, 'readdirSync', function (dir, ...args) {
          if (String(dir) === badDir) throw Object.assign(new Error('fixture nested directory denied'), { code: 'EACCES' });
          return read.call(this, dir, ...args);
        });
        const result = runHostedCheck(head, { pr: 1, baseDir: base });
        if (excluded) {
          assert.equal(result.ok, true, result.message);
          assert.doesNotThrow(() => walkFiles(badRoot, ['.js']));
        } else {
          assertFailed(result, 'SCAN_FAILED');
          assert.deepEqual(walkFiles(badRoot, ['.js']).meta.unreadableDirs, ['service']);
          assert.deepEqual(buildGraph(badRoot).stats.unreadableDirs, ['service']);
        }
      });
    }

    it(`${side} file read failure returned in stats aborts before comparison`, (t) => {
      const head = fixture(t);
      const base = fixture(t);
      const badFile = path.join(side === 'head' ? head : base, 'service.js');
      const read = fs.readFileSync;
      t.mock.method(fs, 'readFileSync', function (file, ...args) {
        if (String(file) === badFile) throw Object.assign(new Error('fixture read denied'), { code: 'EACCES' });
        return read.call(this, file, ...args);
      });
      assertFailed(runHostedCheck(head, { pr: 1, baseDir: base }), 'SCAN_FAILED', side);
    });

    it(`${side} extractor parse failure returned in stats aborts before comparison`, (t) => {
      const head = fixture(t);
      const base = fixture(t);
      const badRoot = side === 'head' ? head : base;
      const extract = jsts.extractFile;
      t.mock.method(jsts, 'extractFile', (file, root) => {
        const result = extract(file, root);
        if (root === badRoot) result.error = 'fixture parser failed';
        return result;
      });
      assertFailed(runHostedCheck(head, { pr: 1, baseDir: base }), 'SCAN_FAILED', side);
    });

    it(`${side} thrown scan exception also returns a failed check`, (t) => {
      const head = fixture(t);
      const base = fixture(t);
      const badRoot = side === 'head' ? head : base;
      const extract = jsts.extractFile;
      t.mock.method(jsts, 'extractFile', (file, root) => {
        if (root === badRoot) throw new Error('fixture extractor exception');
        return extract(file, root);
      });
      assertFailed(runHostedCheck(head, { pr: 1, baseDir: base }), 'SCAN_FAILED');
    });

    it(`${side} malformed layer config cannot produce a green check`, (t) => {
      const head = fixture(t);
      const base = fixture(t);
      const dir = side === 'head' ? head : base;
      fs.mkdirSync(path.join(dir, '.av'));
      fs.writeFileSync(path.join(dir, '.av', 'layers.json'), '{bad json');
      assertFailed(runHostedCheck(head, { pr: 1, baseDir: base }), 'RULES_CONFIG_ERROR', side);
    });
  }

  for (const [stats, reason] of [
    [{ parseErrors: 1 }, 'SCAN_FAILED'],
    [{ unreadableDirs: ['service'] }, 'SCAN_FAILED'],
    [{ unreadableFiles: ['schema.sql'] }, 'SCAN_FAILED'],
    [{ scanTruncated: true }, 'SCAN_FAILED'],
    [{ files: 0, filesParsed: 0 }, 'SCAN_FAILED'],
    [{ layerConfigError: 'fixture damaged layer configuration' }, 'RULES_CONFIG_ERROR']
  ]) {
    it(`persisted base ${reason} is rejected too`, (t) => {
      const head = fixture(t);
      snapshot(head, stats);
      assertFailed(runHostedCheck(head, {}), reason, 'base');
    });
  }

  it('a healthy repository without rules retains default evaluation', (t) => {
    const head = fixture(t);
    const base = fixture(t);
    assert.equal(loadSessionRules(head), null);
    const result = runHostedCheck(head, { pr: 1, baseDir: base });
    assert.equal(result.ok, true);
    assert.ok(result.diff);
  });
});

describe('invalid team rules propagate through existing contracts', () => {
  for (const text of ['forbid_cross_layer: [', 'forbid_cross_layer:\n  - from: controller\n']) {
    it(`loader, hosted, CLI and MCP reject ${JSON.stringify(text)}`, (t) => {
      const head = fixture(t);
      const base = fixture(t);
      snapshot(head, {});
      fs.writeFileSync(path.join(head, 'architecture-rules.yaml'), text);
      assert.throws(() => loadSessionRules(head), { code: 'RULES_CONFIG_ERROR' });
      assertFailed(runHostedCheck(head, { pr: 1, baseDir: base }), 'RULES_CONFIG_ERROR');
      const cli = spawnSync(process.execPath, [path.join(__dirname, '../bin/arch-viewer.js'), 'session', 'report', head], {
        cwd: head,
        encoding: 'utf8'
      });
      assert.equal(cli.status, 2, cli.stdout + cli.stderr);
      assert.match(cli.stderr, /Rules config error/);
      const report = toolSessionReport({ repo: head, confirmRepo: true });
      assert.equal(report.error, 'RULES_CONFIG_ERROR', JSON.stringify(report));
      assert.match(report.message, /规则配置错误/);
      assert.throws(() => toolExplainFinding({ repo: head }), { code: 'RULES_CONFIG_ERROR' });
    });
  }

  it('unreadable rules paths and dangling symlinks do not fall back to defaults', (t) => {
    const head = fixture(t);
    const base = fixture(t);
    const rulesPath = path.join(head, 'architecture-rules.yaml');
    fs.mkdirSync(rulesPath);
    assertFailed(runHostedCheck(head, { pr: 1, baseDir: base }), 'RULES_CONFIG_ERROR');
    fs.rmdirSync(rulesPath);
    fs.symlinkSync(path.join(head, 'missing-rules.yaml'), rulesPath);
    assert.throws(() => loadSessionRules(head), { code: 'ENOENT' });
    assertFailed(runHostedCheck(head, { pr: 1, baseDir: base }), 'RULES_CONFIG_ERROR');
  });
});
