'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { evaluateRisk, summarizeFindings, applyBehaviorTestCoupling } = require('../lib/risk-rules');
const { computeImpact } = require('../lib/impact');
const {
  buildTestIndex,
  changedTestFiles,
  productionTargetsWithTestChanges,
  relatedTestsForPath
} = require('../lib/extract/test-index');

const repos = [];
afterEach(() => {
  for (const dir of repos.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(__dirname, '.av-tidx-'));
  repos.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe('W20-01b: test-index', () => {
  it('import + 命名约定建立 tests 边，不进分层图节点', () => {
    const dir = makeRepo({
      'src/todo.js': `export function createTodo(t) { return t; }\n`,
      'src/todo.test.js': `
import { createTodo } from './todo';
test('x', () => createTodo('a'));
`
    });
    const idx = buildTestIndex(dir);
    assert.ok(idx.files.some((f) => f.path === 'src/todo.test.js'));
    assert.ok(idx.edges.some((e) => e.from === 'src/todo.test.js' && e.to === 'src/todo.js' && e.type === 'tests'));
    const g = buildGraph(dir);
    // test-index 是旁路数据，不挂到图节点/边上，也不进结构指纹。
    assert.ok(!g.testIndex);
    assert.ok(!(g.edges || []).some((e) => e.type === 'tests'));
    assert.ok(!JSON.stringify({ n: g.nodes.map((n) => n.id), e: g.edges }).includes('"type":"tests"'));
  });

  it('命名约定低置信度链接', () => {
    const dir = makeRepo({
      'lib/util.js': `export function add(a,b){return a+b}\n`,
      'lib/util.spec.js': `const { add } = require('./util');\n`
    });
    const idx = buildTestIndex(dir);
    const edge = idx.edges.find((e) => e.to === 'lib/util.js');
    assert.ok(edge);
    assert.ok(edge.confidence === 'high' || edge.confidence === 'low');
  });

  for (const [label, testPath, source] of [
    ['submodule', 'tests/test_flow.py', 'from data_collection.xhs import core\n'],
    ['aliased submodule', 'tests/test_flow.py', 'from data_collection.xhs import core as crawler\n'],
    ['multiline submodule', 'tests/test_flow.py', 'from data_collection.xhs import (\n    core as crawler,\n)\n'],
    ['relative submodule', 'data_collection/xhs/test_flow.py', 'from . import core as crawler\n'],
    ['multiline parent relative', 'data_collection/xhs/tests/test_flow.py', 'from .. import (\n    core as crawler,\n)\n'],
    ['symbol', 'tests/test_flow.py', 'from data_collection.xhs.core import XhsCrawler\n'],
    ['aliased symbol', 'tests/test_flow.py', 'from data_collection.xhs.core import XhsCrawler as Crawler\n'],
    ['module alias', 'tests/test_flow.py', 'import data_collection.xhs.core as crawler\n']
  ]) {
    it(`Python AST association resolves ${label} to the production module`, () => {
      const dir = makeRepo({
        'data_collection/xhs/__init__.py': '',
        'data_collection/xhs/core.py': 'class XhsCrawler:\n    pass\n',
        [testPath]: source
      });
      const idx = buildTestIndex(dir);
      assert.deepEqual(idx.edges, [{
        from: testPath, to: 'data_collection/xhs/core.py',
        type: 'tests', confidence: 'high', via: 'import'
      }]);
    });
  }

  it('Python package-defined symbols stay associated with the defining __init__.py', () => {
    const dir = makeRepo({
      'data_collection/xhs/__init__.py': 'class XhsCrawler:\n    pass\n',
      'tests/test_flow.py': 'from data_collection.xhs import XhsCrawler as Crawler\n'
    });
    assert.deepEqual(buildTestIndex(dir).edges.map((e) => e.to), ['data_collection/xhs/__init__.py']);
  });

  it('Python comments and strings containing import examples are not import evidence', () => {
    const dir = makeRepo({
      'data_collection/xhs/core.py': 'class XhsCrawler:\n    pass\n',
      'tests/test_examples.py': [
        '# from data_collection.xhs import core',
        '# from data_collection.xhs.core import XhsCrawler',
        'example = "import data_collection.xhs.core"',
        '"""',
        'from data_collection.xhs.core import XhsCrawler',
        'from data_collection.xhs import (',
        '    core as crawler,',
        ')',
        '"""',
        ''
      ].join('\n')
    });
    assert.deepEqual(buildTestIndex(dir).edges, []);
  });

  it('unchanged Python tests remain associations, not test-change or execution evidence', () => {
    const dir = makeRepo({
      'data_collection/xhs/core.py': 'def crawl():\n    return 1\n',
      'tests/test_flow.py': 'from data_collection.xhs import core\n'
    });
    const base = buildTestIndex(dir);
    fs.writeFileSync(path.join(dir, 'data_collection/xhs/core.py'), 'def crawl():\n    return 2\n');
    const head = buildTestIndex(dir);
    assert.equal(relatedTestsForPath(head, 'data_collection/xhs/core.py').length, 1);
    assert.equal(changedTestFiles(base, head).size, 0);
    assert.equal(productionTargetsWithTestChanges(base, head).targets.size, 0);
    fs.appendFileSync(path.join(dir, 'tests/test_flow.py'), '# test file changed, but was not executed\n');
    const changed = productionTargetsWithTestChanges(base, buildTestIndex(dir));
    assert.deepEqual([...changed.changedTests], ['tests/test_flow.py']);
    assert.deepEqual(changed.targets.get('data_collection/xhs/core.py').testFiles, ['tests/test_flow.py']);
  });

  it('LF/CRLF-only test edits do not count as test changes, but whitespace edits do', () => {
    const source = 'from data_collection.xhs import core\n# test evidence\n';
    const dir = makeRepo({
      'data_collection/xhs/core.py': 'def crawl():\n    return 1\n',
      'tests/test_flow.py': source
    });
    const base = buildTestIndex(dir);
    fs.writeFileSync(path.join(dir, 'tests/test_flow.py'), source.replace(/\n/g, '\r\n'));
    const converted = buildTestIndex(dir);
    assert.equal(changedTestFiles(base, converted).size, 0);
    assert.equal(productionTargetsWithTestChanges(base, converted).targets.size, 0);
    fs.writeFileSync(path.join(dir, 'tests/test_flow.py'), source.replace('test evidence', 'test  evidence'));
    assert.deepEqual([...changedTestFiles(base, buildTestIndex(dir))], ['tests/test_flow.py']);
  });

  it('legacy incompatible test hashes are unknown, not attributed as test changes', () => {
    const base = { files: [{ path: 'test_core.py', contentHash: 'legacy' }], edges: [] };
    const head = {
      files: [{ path: 'test_core.py', contentHash: 'normalized', contentHashVersion: 'lf-v1' }],
      edges: [{ from: 'test_core.py', to: 'core.py', via: 'import', confidence: 'high' }]
    };
    assert.equal(changedTestFiles(base, head).size, 0);
    assert.equal(productionTargetsWithTestChanges(base, head).targets.size, 0);
    assert.equal(changedTestFiles(null, head).size, 0);
    assert.equal(changedTestFiles(base, null).size, 0);
    const findings = [];
    applyBehaviorTestCoupling(findings, {
      behaviorChanges: [{ id: 'core#crawl', path: 'core.py', name: 'crawl' }]
    }, new Map([['file:core.py', { total: 12 }]]), { testIndexBase: base, testIndexHead: head });
    assert.equal(findings[0].severity, 'medium');
    assert.equal(findings[0].testEvidence, 'unknown-test-change-status');
    assert.doesNotMatch(findings[0].message + findings[0].title, /本轮未改动|无测试跟进|关联测试文件未改动/);
    assert.match(findings[0].message, /内容比较证据不足/);
  });
});

describe('W20-01b: R16/R17', () => {
  it('R16：行为指纹变化 × 无测试变更 → MEDIUM', () => {
    const dir = makeRepo({
      'src/todo.js': `
export function createTodo(repo, title) {
  return repo.save(title);
}
`,
      'src/todo.test.js': `
import { createTodo } from './todo';
test('ok', () => {});
`
    });
    const base = buildGraph(dir);
    const baseIdx = buildTestIndex(dir);
    fs.writeFileSync(path.join(dir, 'src/todo.js'), `
export function createTodo(repo, title) {
  if (!title) throw new Error('empty');
  repo.save(title);
  return repo.publish(title);
}
`);
    const head = buildGraph(dir);
    const headIdx = buildTestIndex(dir);
    const diff = diffGraphs(base, head);
    assert.ok(diff.behaviorChanges.length >= 1);
    const findings = evaluateRisk(diff, head, base, null, {
      testIndexBase: baseIdx,
      testIndexHead: headIdx
    });
    const hit = findings.find((f) => f.rule === 'behavior-changed-no-test');
    assert.ok(hit, findings.map((f) => f.rule).join(','));
    assert.equal(hit.severity, 'medium');
    assert.equal(hit.reportOnly, true);
    assert.match(hit.detail, /todo\.test\.js|未找到/);
  });

  it('有关联测试变更 → 不报 R16 / R17 降 INFO', () => {
    const dir = makeRepo({
      'src/todo.js': `
export function createTodo(repo, title) {
  return repo.save(title);
}
`,
      'src/todo.test.js': `
import { createTodo } from './todo';
test('ok', () => createTodo({}, 'a'));
`
    });
    const base = buildGraph(dir);
    const baseIdx = buildTestIndex(dir);
    fs.writeFileSync(path.join(dir, 'src/todo.js'), `
export function createTodo(repo, title) {
  return repo.publish(title);
}
`);
    fs.writeFileSync(path.join(dir, 'src/todo.test.js'), `
import { createTodo } from './todo';
test('ok', () => createTodo({ publish: () => 1 }, 'a'));
`);
    const head = buildGraph(dir);
    const headIdx = buildTestIndex(dir);
    const { targets } = productionTargetsWithTestChanges(baseIdx, headIdx);
    assert.ok(targets.has('src/todo.js'));
    const diff = diffGraphs(base, head);
    const findings = evaluateRisk(diff, head, base, null, {
      testIndexBase: baseIdx,
      testIndexHead: headIdx
    });
    assert.ok(!findings.some((f) => f.rule === 'behavior-changed-no-test' && f.severity === 'medium'));
  });

  for (const hasMapping of [false, true]) {
  it(`R17：高影响 × ${hasMapping ? '已识别且未改动的测试 → HIGH' : '未知测试关联 → MEDIUM'}`, () => {
    // Build a fan-in graph so changing core.js impacts many importers
    const files = {
      'src/core.js': `
export function core(repo) {
  return repo.save(1);
}
`
    };
    for (let i = 0; i < 12; i++) {
      files[`src/leaf${i}.js`] = `import { core } from './core';\nexport function L${i}(){ return core({save:x=>x}); }\n`;
    }
    if (hasMapping) files['tests/test_core.js'] = "const { core } = require('../src/core');\n";
    const dir = makeRepo(files);
    const base = buildGraph(dir);
    const baseIdx = buildTestIndex(dir);
    fs.writeFileSync(path.join(dir, 'src/core.js'), `
export function core(repo) {
  if (!repo) throw new Error('x');
  return repo.publish(1);
}
`);
    const head = buildGraph(dir);
    const headIdx = buildTestIndex(dir);
    const diff = diffGraphs(base, head);
    // Attach call edges so reverse impact has more signal; imports alone should suffice.
    require('../lib/extract-graph').attachCallEdges(head, { calls: true });
    const impact = computeImpact(diff, base, head);
    const coreImpact = (impact.items || []).find((it) => String(it.id).includes('core'));
    assert.ok(coreImpact && (coreImpact.direct.length + coreImpact.transitive.length) >= 10,
      `expected broad impact on core, got ${JSON.stringify(coreImpact)}`);
    const findings = evaluateRisk(diff, head, base, impact, {
      testIndexBase: baseIdx,
      testIndexHead: headIdx
    });
    const hit = findings.find((f) => f.rule === 'behavior-changed-broad-impact');
    assert.ok(hit, findings.map((f) => `${f.rule}:${f.severity}`).join(','));
    assert.equal(hit.severity, hasMapping ? 'high' : 'medium');
    assert.equal(hit.reportOnly, true);
    assert.equal(hit.testEvidence, hasMapping ? 'unchanged-associated-tests' : 'unrecognized-test-mapping');
    if (!hasMapping) {
      assert.match(hit.message, /未识别到测试关联/);
      assert.doesNotMatch(hit.message + hit.title, /无测试跟进|关联测试未改|本轮未改动/);
    }
    const summary = summarizeFindings(findings);
    assert.equal(summary.level, hasMapping ? 'high' : 'medium');
    assert.notEqual(summary.gateLevel, 'high');
  });
  }

  it('R16 unknown mapping is not an assertion that tests did not change', () => {
    const findings = [];
    applyBehaviorTestCoupling(findings, {
      behaviorChanges: [{ id: 'core#crawl', path: 'core.py', name: 'crawl' }]
    }, new Map(), {
      testIndexBase: { files: [], edges: [] },
      testIndexHead: { files: [], edges: [] }
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].testEvidence, 'unrecognized-test-mapping');
    assert.deepEqual(findings[0].testFiles, []);
    assert.match(findings[0].message, /无法判断测试是否跟进/);
    assert.doesNotMatch(findings[0].message + findings[0].title, /无测试跟进|本轮未改动/);
  });

  it('R17 naming-only association cannot promote behavioral risk to HIGH', () => {
    const findings = [];
    const index = {
      files: [{ path: 'test_core.py', contentHash: 'same' }],
      edges: [{ from: 'test_core.py', to: 'core.py', via: 'naming', confidence: 'low' }]
    };
    applyBehaviorTestCoupling(findings, {
      behaviorChanges: [{ id: 'core#crawl', path: 'core.py', name: 'crawl' }]
    }, new Map([['file:core.py', { total: 12 }]]), { testIndexBase: index, testIndexHead: index });
    assert.equal(findings[0].severity, 'medium');
    assert.equal(findings[0].confidence, 'low');
  });

  it('R17 changed associated test files are not evidence of execution or coverage', () => {
    const findings = [];
    const edge = { from: 'test_core.py', to: 'core.py', via: 'import', confidence: 'high' };
    applyBehaviorTestCoupling(findings, {
      behaviorChanges: [{ id: 'core#crawl', path: 'core.py', name: 'crawl' }]
    }, new Map([['file:core.py', { total: 12 }]]), {
      testIndexBase: { files: [{ path: 'test_core.py', contentHash: 'before' }], edges: [edge] },
      testIndexHead: { files: [{ path: 'test_core.py', contentHash: 'after' }], edges: [edge] }
    });
    assert.equal(findings[0].severity, 'info');
    assert.equal(findings[0].testEvidence, 'changed-associated-tests');
    assert.deepEqual(findings[0].testFiles, ['test_core.py']);
    assert.match(findings[0].message, /未验证测试执行或覆盖/);
    assert.doesNotMatch(findings[0].title, /已有测试跟进/);
  });

  it('missing comparison indexes cannot establish test changes', () => {
    for (const opts of [
      { testIndexHead: { files: [], edges: [] } },
      { testIndexBase: { files: [], edges: [] } }
    ]) {
      const findings = [];
      applyBehaviorTestCoupling(findings, {
        behaviorChanges: [{ id: 'core#crawl', path: 'core.py', name: 'crawl' }]
      }, new Map([['file:core.py', { total: 12 }]]), opts);
      assert.deepEqual(findings, []);
    }
  });

  it('relatedTestsForPath 能找到命名约定测试', () => {
    const dir = makeRepo({
      'pkg/foo.py': 'def foo():\n    return 1\n',
      'pkg/test_foo.py': 'from pkg.foo import foo\n'
    });
    const idx = buildTestIndex(dir);
    const rel = relatedTestsForPath(idx, 'pkg/foo.py');
    assert.ok(rel.length >= 1);
  });
});
