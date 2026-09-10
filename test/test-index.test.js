'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { evaluateRisk, summarizeFindings } = require('../lib/risk-rules');
const { computeImpact } = require('../lib/impact');
const {
  buildTestIndex,
  productionTargetsWithTestChanges,
  relatedTestsForPath
} = require('../lib/extract/test-index');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-tidx-'));
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

  it('R17：高影响 × 无测试 → HIGH，但 reportOnly 不计入 gateLevel', () => {
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
    assert.equal(hit.severity, 'high');
    assert.equal(hit.reportOnly, true);
    const summary = summarizeFindings(findings);
    assert.equal(summary.level, 'high');
    assert.notEqual(summary.gateLevel, 'high');
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
