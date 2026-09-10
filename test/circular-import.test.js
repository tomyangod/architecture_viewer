'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { detectCircularImports } = require('../lib/risk-rules');

const file = (id) => ({ id: `file:${id}`, kind: 'file', name: id, path: id });
const imp = (from, to, extra = {}) => ({ from: `file:${from}`, to: `file:${to}`, type: 'import', ...extra });

function run(headEdges, baseEdges, addedEdges) {
  const mk = (edges) => ({
    nodes: [
      file('a.py'), file('b.py'), file('c.py')
    ],
    edges
  });
  const findings = [];
  detectCircularImports(findings, mk(headEdges), mk(baseEdges), addedEdges || []);
  return findings;
}

test('W14-04: mutual import A→B→A via new edges → HIGH circular-import', () => {
  const findings = run(
    [imp('a.py', 'b.py', { file: 'a.py', line: 3 }), imp('b.py', 'a.py', { file: 'b.py', line: 7 })],
    [],
    [imp('a.py', 'b.py', { file: 'a.py', line: 3 }), imp('b.py', 'a.py', { file: 'b.py', line: 7 })]
  );
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].rule, 'circular-import');
  assert.strictEqual(findings[0].severity, 'high');
  assert.match(findings[0].detail, /a\.py → b\.py → a\.py/);
  assert.strictEqual(findings[0].file, 'a.py');
});

test('W14-04: pre-existing historical ring (all edges in baseline) → silent', () => {
  const edges = [imp('a.py', 'b.py'), imp('b.py', 'a.py')];
  const findings = run(edges, edges, []);
  assert.strictEqual(findings.length, 0);
});

test('W14-04: 3-node ring closed by one new edge → MEDIUM, chain lists all files', () => {
  const findings = run(
    [imp('a.py', 'b.py'), imp('b.py', 'c.py'), imp('c.py', 'a.py', { file: 'c.py', line: 9 })],
    [imp('a.py', 'b.py'), imp('b.py', 'c.py')],
    [imp('c.py', 'a.py', { file: 'c.py', line: 9 })]
  );
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].severity, 'medium');
  assert.match(findings[0].message, /3 个文件/);
  assert.match(findings[0].detail, /c\.py/);
});

test('W14-04: new edge without return path → no finding', () => {
  const findings = run(
    [imp('a.py', 'b.py')],
    [],
    [imp('a.py', 'b.py')]
  );
  assert.strictEqual(findings.length, 0);
});

test('W14-04: same ring via two new edges reported once', () => {
  const edges = [imp('a.py', 'b.py', { file: 'a.py' }), imp('b.py', 'a.py', { file: 'b.py' })];
  const findings = run(edges, [], edges);
  assert.strictEqual(findings.length, 1);
});

test('W14-04: 4-node ring closed by one new edge → MEDIUM, Tarjan SCC', () => {
  const nodes = [file('a.py'), file('b.py'), file('c.py'), file('d.py')];
  const headEdges = [imp('a.py', 'b.py'), imp('b.py', 'c.py'), imp('c.py', 'd.py'), imp('d.py', 'a.py', { file: 'd.py', line: 4 })];
  const baseEdges = [imp('a.py', 'b.py'), imp('b.py', 'c.py'), imp('c.py', 'd.py')];
  const findings = [];
  detectCircularImports(
    findings,
    { nodes, edges: headEdges },
    { nodes, edges: baseEdges },
    [imp('d.py', 'a.py', { file: 'd.py', line: 4 })]
  );
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].severity, 'medium');
  assert.match(findings[0].message, /4 个文件/);
  assert.match(findings[0].detail, /d\.py/);
});

test('W14-04: non-import edges and self-imports ignored', () => {
  const findings = [];
  detectCircularImports(
    findings,
    { nodes: [file('a.py'), file('b.py')], edges: [imp('a.py', 'a.py'), { from: 'file:a.py', to: 'file:b.py', type: 'declared-in' }] },
    { nodes: [file('a.py'), file('b.py')], edges: [] },
    []
  );
  assert.strictEqual(findings.length, 0);
});
