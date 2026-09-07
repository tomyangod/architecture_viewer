'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { buildReportData, generateReport } = require('../lib/session-report');
const { assertReportContract, normalizeReportForGolden } = require('../lib/report-contract');
const { diffGraphs } = require('../lib/diff-graph');

const GOLDEN_DIR = path.join(__dirname, 'goldens');
const GOLDEN_PATH = path.join(GOLDEN_DIR, 'session-report-delta.json');

function miniGraphs() {
  const base = {
    fingerprint: 'basefp000000001',
    root: '/demo',
    stats: { files: 2, types: 2, edges: 1 },
    nodes: [
      { id: 'file:keep.js', kind: 'file', name: 'keep.js', path: 'keep.js', layer: 'util', lang: 'js', lineCount: 10 },
      { id: 'file:old.js', kind: 'file', name: 'old.js', path: 'old.js', layer: 'util', lang: 'js', lineCount: 8 },
      { id: 'file:gone.js', kind: 'file', name: 'gone.js', path: 'gone.js', layer: 'service', lang: 'js', lineCount: 6 },
      { id: 'ext:fs', kind: 'external', name: 'fs', builtin: true },
      { id: 'ext:left-pad', kind: 'external', name: 'left-pad', builtin: false },
      { id: 'cls:Keep', name: 'Keep', kind: 'class', layer: 'util', path: 'keep.js', lang: 'js', methods: ['a'], modifiers: [] },
      { id: 'cls:MoveMe', name: 'MoveMe', kind: 'class', layer: 'util', path: 'old.js', lang: 'js', methods: [], modifiers: [] },
      { id: 'cls:Gone', name: 'Gone', kind: 'class', layer: 'service', path: 'gone.js', lang: 'js', methods: [], modifiers: [] }
    ],
    edges: [
      { from: 'cls:Keep', to: 'cls:MoveMe', type: 'implements' },
      { from: 'cls:Gone', to: 'cls:Keep', type: 'import' }
    ]
  };
  const head = {
    fingerprint: 'headfp000000001',
    root: '/demo',
    stats: { files: 2, types: 2, edges: 1 },
    nodes: [
      { id: 'file:keep.js', kind: 'file', name: 'keep.js', path: 'keep.js', layer: 'util', lang: 'js', lineCount: 14 },
      { id: 'file:new.js', kind: 'file', name: 'new.js', path: 'new.js', layer: 'service', lang: 'js', lineCount: 9 },
      { id: 'ext:fs', kind: 'external', name: 'fs', builtin: true },
      { id: 'ext:flask', kind: 'external', name: 'flask', builtin: false },
      { id: 'cls:Keep', name: 'Keep', kind: 'class', layer: 'util', path: 'keep.js', lang: 'js', methods: ['a', 'b'], modifiers: [] },
      { id: 'cls:MoveMe', name: 'MoveMe', kind: 'class', layer: 'service', path: 'new.js', lang: 'js', methods: [], modifiers: [] },
      { id: 'cls:New', name: 'New', kind: 'class', layer: 'service', path: 'new.js', lang: 'js', methods: [], modifiers: [] }
    ],
    edges: [
      { from: 'cls:Keep', to: 'cls:MoveMe', type: 'import' },
      { from: 'cls:New', to: 'cls:Keep', type: 'import' }
    ]
  };
  return { base, head, diff: diffGraphs(base, head) };
}

describe('session-report golden + delivery contract', () => {
  it('payload 满足 delivery contract（fail-closed）', () => {
    const { base, head, diff } = miniGraphs();
    const data = buildReportData(base, head, diff, [], null, 'demo', null);
    assert.doesNotThrow(() => assertReportContract(data));
    assert.equal(data.schemaVersion, 1);
    assert.ok(data.moved.some((m) => m.id === 'cls:MoveMe'));
    assert.ok(data.rerouted.some((e) => e.from === 'cls:Keep' && e.to === 'cls:MoveMe'));
    assert.equal(data.entities.find((e) => e.id === 'cls:MoveMe').status, 'moved');
    assert.ok(data.edges.some((e) => e.status === 'rerouted'));
    // structure: 文件清单含增/删/改三种状态，外部依赖含新增/删除/内置
    const byPath = Object.fromEntries(data.structure.files.map((f) => [f.path, f]));
    assert.equal(byPath['new.js'].status, 'added');
    assert.equal(byPath['gone.js'].status, 'removed');
    assert.equal(byPath['keep.js'].status, 'modified');
    assert.equal(byPath['keep.js'].delta, 4);
    const depByName = Object.fromEntries(data.structure.deps.map((d) => [d.name, d]));
    assert.equal(depByName['flask'].status, 'added');
    assert.equal(depByName['left-pad'].status, 'removed');
    assert.equal(depByName['fs'].status, 'unchanged');
    assert.equal(depByName['fs'].builtin, true);
  });

  it('缺字段时 contract 拒绝交付', () => {
    assert.throws(
      () => assertReportContract({ schemaVersion: 1 }),
      /REPORT_CONTRACT/
    );
  });

  it('HTML 含 Before/Delta/After 三栏与无障碍语义标记', () => {
    const { base, head, diff } = miniGraphs();
    const html = generateReport({
      baseGraph: base, headGraph: head, diff, findings: [], impact: null,
      repoName: 'demo', sessionStart: null
    });
    assert.match(html, /id="graph-before"/);
    assert.match(html, /id="graph-delta"/);
    assert.match(html, /id="graph-after"/);
    assert.match(html, /id="structure-details"/);
    assert.match(html, /id="structure-body"/);
    assert.match(html, /项目结构/);
    assert.match(html, /lang="zh-CN"/);
    assert.match(html, /meta name="viewport"/);
    assert.match(html, /triple-graph/);
  });

  it('golden: 规范化 report payload 与金文件逐字节一致', () => {
    const { base, head, diff } = miniGraphs();
    const data = buildReportData(base, head, diff, [], null, 'demo', null);
    const normalized = normalizeReportForGolden(data);
    const rendered = JSON.stringify(normalized, null, 2) + '\n';

    if (process.env.UPDATE_GOLDENS === '1') {
      fs.mkdirSync(GOLDEN_DIR, { recursive: true });
      fs.writeFileSync(GOLDEN_PATH, rendered);
    }

    assert.ok(fs.existsSync(GOLDEN_PATH), `missing golden; run UPDATE_GOLDENS=1 to create ${GOLDEN_PATH}`);
    const expected = fs.readFileSync(GOLDEN_PATH, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(rendered, expected);
  });
});
