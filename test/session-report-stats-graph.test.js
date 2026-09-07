'use strict';

/**
 * 「HTML 图与顶部统计」口径说明（整文件展开保留，文案已澄清）。
 *
 * 复现步骤（人工）：
 * 1. 一个文件里先有 3 个 class → session start → 同文件再加第 4 个 class。
 * 2. `arch-viewer session report <repo> --renderer builtin --open`
 * 3. 打开 `.av/session-report.builtin.html`（不要拿六视图对这组数字）。
 * 4. 顶部「新增类型」= 1；#graph-count 应为「1 个变更 · 图上含同文件 4 个 · …」。
 * 5. 中间 Delta #delta-count 仍是 +1。
 * 6. Archify 主 HTML 的框数是另一套口径（稀疏/层摘要），与 builtin 卡片无关。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('node:vm');

const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { buildReportData, generateReport } = require('../lib/session-report');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-stats-graph-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

/** 与 lib/session-report.js 内嵌 HTML 的 computeVisible('changed') 保持同步。 */
function changedFilterVisible(entities) {
  const changedIds = new Set();
  entities.forEach((e) => { if (e.status !== 'unchanged') changedIds.add(e.id); });
  const affectedFiles = new Set();
  entities.forEach((e) => { if (changedIds.has(e.id) && e.path) affectedFiles.add(e.path); });
  return entities.filter((e) => (e.path && affectedFiles.has(e.path)) || changedIds.has(e.id));
}

function extractFormatGraphCount(html) {
  const m = html.match(/function formatGraphCount\([\s\S]*?\n\}/);
  assert.ok(m, 'report must embed formatGraphCount');
  return m[0];
}

/** D.entities = 全量；visible = 图上画出的实体。 */
function runFormatGraphCount(fnSrc, allEntities, visible, filter) {
  const sandbox = {
    D: { entities: allEntities },
    currentFilter: filter,
    visible,
    result: null
  };
  vm.runInNewContext(fnSrc + '\nresult = formatGraphCount(visible, []);', sandbox);
  return sandbox.result;
}

describe('HTML 图 vs 顶部统计（文案澄清，整文件展开保留）', () => {
  it('同文件新增 1 个类：卡片 1，图展开 4，#graph-count 写清两口径', () => {
    const src = 'services/order.py';
    const dir = makeRepo({
      [src]: [
        'class OrderService:',
        '    def create(self):',
        '        pass',
        '',
        'class OrderHelper:',
        '    def help(self):',
        '        pass',
        '',
        'class OrderValidator:',
        '    def ok(self):',
        '        pass',
        ''
      ].join('\n')
    });
    try {
      const base = buildGraph(dir);
      fs.appendFileSync(path.join(dir, src), '\nclass OrderNotifier:\n    def ping(self):\n        pass\n');
      const head = buildGraph(dir);
      const diff = diffGraphs(base, head);
      const data = buildReportData(base, head, diff, [], null, 'stats-graph', null);
      const html = generateReport({
        baseGraph: base, headGraph: head, diff, findings: [],
        repoName: 'stats-graph', sessionStart: null
      });

      assert.equal(data.summary.addedTypes, 1, '顶部「新增类型」卡片');
      const visible = changedFilterVisible(data.entities);
      assert.equal(visible.length, 4, '整文件展开：3 旧 + 1 新');
      assert.equal(data.entities.filter((e) => e.status !== 'unchanged').length, 1);

      assert.match(html, /function formatGraphCount/);
      assert.match(html, /图上含同文件/);

      const label = runFormatGraphCount(
        extractFormatGraphCount(html),
        data.entities,
        visible,
        'changed'
      );
      assert.equal(label, '1 个变更 · 图上含同文件 4 个 · 0 条关系');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('formatGraphCount：展开时写「含同文件」，未展开不写', () => {
    const html = generateReport({
      baseGraph: { nodes: [], edges: [], fingerprint: 'a', stats: {} },
      headGraph: { nodes: [], edges: [], fingerprint: 'b', stats: {} },
      diff: {
        summary: {
          addedNodes: 0, removedNodes: 0, modifiedNodes: 0, movedNodes: 0, renamedNodes: 0,
          addedEdges: 0, removedEdges: 0, reroutedEdges: 0,
          addedTypes: 0, removedTypes: 0, addedPackages: 0, removedPackages: 0,
          addedExternalDeps: 0, removedExternalDeps: 0, violations: 0, totalChanges: 0
        },
        addedNodes: [], removedNodes: [], modifiedNodes: [], movedNodes: [], renamedNodes: [],
        addedEdges: [], removedEdges: [], reroutedEdges: [],
        addedTypes: [], removedTypes: [],
        addedExternalDeps: [], removedExternalDeps: [],
        violations: [],
        base: { fingerprint: 'a' }, head: { fingerprint: 'b' }
      },
      findings: [],
      repoName: 'empty',
      sessionStart: null
    });

    const fn = extractFormatGraphCount(html);
    const all = [
      { id: 'a', status: 'added', path: 'f.py' },
      { id: 'b', status: 'unchanged', path: 'f.py' },
      { id: 'c', status: 'unchanged', path: 'f.py' },
      { id: 'd', status: 'unchanged', path: 'f.py' }
    ];
    assert.equal(
      runFormatGraphCount(fn, all, all, 'changed'),
      '1 个变更 · 图上含同文件 4 个 · 0 条关系'
    );
    assert.equal(
      runFormatGraphCount(fn, [all[0]], [all[0]], 'changed'),
      '1 个变更 · 图上 1 个 · 0 条关系'
    );
  });
});
