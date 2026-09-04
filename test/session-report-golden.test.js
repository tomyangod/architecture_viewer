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
    const expected = fs.readFileSync(GOLDEN_PATH, 'utf8');
    assert.equal(rendered, expected);
  });
});
