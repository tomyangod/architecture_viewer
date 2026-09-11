'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { walkSourceFiles } = require('../lib/extract/shared');
const { buildGraph } = require('../lib/extract-graph');
const { toPersistableGraph } = require('../lib/extract/call-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { scan } = require('../lib/scan');
const { loadRepoIgnore, dirIsIgnored } = require('../lib/scan-ignore');
const { formatSessionVerdict } = require('../lib/session-verdict');
const { formatPullRequestComment } = require('../lib/pr-comment');

function writeTree(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
}

describe('repo ignore / vendored exclusion', () => {
  it('loads basename and prefix patterns from .arch-viewer-ignore', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-ignore-'));
    writeTree(repo, {
      '.arch-viewer-ignore': '# comment\nBmccMediaSpider-main\nvendor/legacy-crawler/\n'
    });
    const ignore = loadRepoIgnore(repo);
    assert.equal(ignore.basenames.has('BmccMediaSpider-main'), true);
    assert.equal(ignore.prefixes.has('vendor/legacy-crawler'), true);
    assert.equal(dirIsIgnored(repo, path.join(repo, 'BmccMediaSpider-main'), ignore), true);
    assert.equal(dirIsIgnored(repo, path.join(repo, 'vendor', 'legacy-crawler'), ignore), true);
    assert.equal(dirIsIgnored(repo, path.join(repo, 'src'), ignore), false);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('reads externalDirs from .av/layers.json', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-ext-'));
    fs.mkdirSync(path.join(repo, '.av'));
    fs.writeFileSync(
      path.join(repo, '.av', 'layers.json'),
      JSON.stringify({ app: 'service', externalDirs: ['third_party'] })
    );
    const ignore = loadRepoIgnore(repo);
    assert.equal(ignore.basenames.has('third_party'), true);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('walkSourceFiles skips ignored vendored trees', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-walk-'));
    writeTree(repo, {
      '.arch-viewer-ignore': 'BmccMediaSpider-main\n',
      'app/svc.py': 'class Svc:\n    pass\n',
      'BmccMediaSpider-main/base.py': 'class Spider:\n    pass\n',
      'BmccMediaSpider-main/store/db.py': 'class Db:\n    pass\n'
    });
    const byLang = walkSourceFiles(repo);
    const py = byLang.get('python') || [];
    assert.equal(py.some((p) => p.endsWith('svc.py')), true);
    assert.equal(py.some((p) => p.includes('BmccMediaSpider-main')), false);
    const graph = buildGraph(repo);
    assert.equal((graph.nodes || []).some((n) => String(n.path || '').includes('BmccMediaSpider-main')), false);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('path prefix does not skip the same basename elsewhere', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-pref-'));
    writeTree(repo, {
      '.arch-viewer-ignore': 'vendor/legacy\n',
      'app/ok.py': 'class Ok:\n    pass\n',
      'vendor/legacy/old.py': 'class Old:\n    pass\n',
      'tools/legacy/keep.py': 'class Keep:\n    pass\n'
    });
    const py = walkSourceFiles(repo).get('python') || [];
    assert.equal(py.some((p) => p.endsWith('ok.py')), true);
    assert.equal(py.some((p) => p.endsWith('keep.py')), true);
    assert.equal(py.some((p) => p.endsWith('old.py')), false);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('scan() drift inventory omits ignored top-level modules', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-drift-ig-'));
    writeTree(repo, {
      '.arch-viewer-ignore': 'BmccMediaSpider-main\n',
      'backend/core.py': 'class Core:\n    pass\n',
      'BmccMediaSpider-main/spider.py': 'class Spider:\n    pass\n'
    });
    const inv = scan(repo);
    const labels = (inv.modules || []).map((m) => m.label || m.id);
    assert.equal(labels.some((l) => /BmccMediaSpider/i.test(String(l))), false);
    assert.equal(labels.some((l) => /backend/i.test(String(l))), true);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('drift scan() honors .gitignore even without .arch-viewer-ignore (path parity)', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-gi-parity-'));
    writeTree(repo, {
      '.gitignore': '# keep\nthird/\n*.log\n',
      'app/main.py': 'class Main:\n    pass\n',
      'third/x.py': 'class X:\n    pass\n'
    });
    // drift inventory path
    const labels = scan(repo).modules.map((m) => m.label || m.id);
    assert.equal(labels.some((l) => /third/i.test(String(l))), false);
    assert.equal(labels.some((l) => /app/i.test(String(l))), true);
    // graph extraction path
    const py = walkSourceFiles(repo).get('python') || [];
    assert.equal(py.some((p) => p.includes('third')), false);
    // gitignore entries must NOT leak into AV scope stamping
    const g = toPersistableGraph(buildGraph(repo));
    assert.deepEqual(g.scope.ignorePatterns, []);
    fs.rmSync(repo, { recursive: true, force: true });
  });
});

describe('analysis-scope change explanation', () => {
  it('graph stamps sorted ignore patterns into scope.ignorePatterns', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-scope-stamp-'));
    writeTree(repo, {
      '.arch-viewer-ignore': 'vendor/legacy/\nthird_party\n',
      'app/main.py': 'class Main:\n    pass\n'
    });
    const g = toPersistableGraph(buildGraph(repo));
    assert.deepEqual(g.scope.ignorePatterns, ['third_party', 'vendor/legacy/']);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('adding an ignore rule yields scopeChanged.added and explains the removed nodes', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-scope-diff-'));
    writeTree(repo, {
      'app/core.py': 'class Core:\n    pass\n',
      'acme-crawler/spider.py': 'class Spider:\n    pass\n'
    });
    const base = toPersistableGraph(buildGraph(repo));
    fs.writeFileSync(path.join(repo, '.arch-viewer-ignore'), 'acme-crawler\n');
    const head = toPersistableGraph(buildGraph(repo));
    const diff = diffGraphs(base, head);

    assert.ok(diff.scopeChanged, 'scopeChanged must be present');
    assert.deepEqual(diff.scopeChanged.added, ['acme-crawler']);
    assert.deepEqual(diff.scopeChanged.removed, []);
    // vendored entities show as removed in counts...
    assert.ok((diff.summary.removedNodes || 0) > 0);
    // ...and the verdict / PR comment explain it is a scope change, not deletion.
    const verdict = formatSessionVerdict({
      riskSummary: { level: 'none', counts: {} },
      findings: [],
      summary: diff.summary,
      scopeChanged: diff.scopeChanged
    });
    assert.match(verdict.text, /分析范围变化/);
    assert.match(verdict.text, /acme-crawler/);
    const md = formatPullRequestComment({
      diff,
      impact: { changedCount: 0, impactedCount: 0 },
      findings: []
    });
    assert.match(md, /分析范围变化/);
    assert.match(md, /不代表真实代码删除/);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('unchanged ignore config produces no scopeChanged', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-scope-same-'));
    writeTree(repo, {
      '.arch-viewer-ignore': 'acme-crawler\n',
      'app/core.py': 'class Core:\n    pass\n',
      'acme-crawler/x.py': 'class X:\n    pass\n'
    });
    const base = toPersistableGraph(buildGraph(repo));
    // touch only an owned file
    fs.writeFileSync(path.join(repo, 'app', 'core.py'), 'class Core:\n    x = 1\n');
    const head = toPersistableGraph(buildGraph(repo));
    const diff = diffGraphs(base, head);
    assert.equal(diff.scopeChanged, null);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('old baselines without scope stamp do not raise a false scopeChanged', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-scope-old-'));
    writeTree(repo, {
      '.arch-viewer-ignore': 'acme-crawler\n',
      'app/core.py': 'class Core:\n    pass\n'
    });
    const base = toPersistableGraph(buildGraph(repo));
    delete base.scope; // simulate pre-feature baseline
    const head = toPersistableGraph(buildGraph(repo));
    const diff = diffGraphs(base, head);
    assert.equal(diff.scopeChanged, null);
    fs.rmSync(repo, { recursive: true, force: true });
  });
});
