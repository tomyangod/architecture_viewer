'use strict';

// W15-03: 四口径一致性验证
//
// 四个口径必须一致（按高信号依赖边过滤后）：
//   1. 顶部统计  summary.addedArchitecturalEdges / removedArchitecturalEdges / violations
//   2. Delta 图  REPORT_DATA.edges（status=added/removed, violation=true）
//   3. findings  跨层违规类 finding 引用的边
//   4. JSON      diff.summary 同上字段（session-report.json 的 diff.summary）
//
// 口径定义：
//   - 高信号依赖边：import / extends / implements / field-type / method-param /
//     method-return / component-props（架构变化，必须进图、进顶栏）
//   - 归属边：declared-in / defined-in（函数属于哪个文件，计入 summary.addedEdges，不进图/顶栏）
//   - 外部边：uses-external / references-external（外部依赖，走 extAdded/extRemoved）
//
// 断言规则：
//   A. 违规边：diff.violations 数 == 图 violation=true 边数 == findings 中违规类数
//   B. 高信号 added 边：diff 中高信号 added 边数 == 图 added 边数
//   C. 高信号 removed 边：diff 中高信号 removed 边数 == 图 removed 边数
//   D. 归属边不进图：图中不应出现 declared-in / defined-in 类型边
//   E. 外部边不进图：图中不应出现 uses-external 类型边（走 extAdded/extRemoved）

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildReportData } = require('../lib/session-report');
const { diffGraphs } = require('../lib/diff-graph');
const { buildGraph } = require('../lib/extract-graph');
const { evaluateRisk } = require('../lib/risk-rules');

// 边类型分类（与 session-report.js 保持一致）
const ARCH_EDGE_TYPES = ['import', 'extends', 'implements', 'field-type', 'method-param', 'method-return', 'component-props', 'di-registered'];
const ATTACH_TYPES = ['declared-in', 'defined-in'];
const EXTERNAL_TYPES = ['uses-external', 'references-external'];

function isHighSignal(e) {
  return ARCH_EDGE_TYPES.includes(e.type);
}
function isAttach(e) {
  return ATTACH_TYPES.includes(e.type);
}
function isExternal(e) {
  return EXTERNAL_TYPES.includes(e.type);
}

// 从 buildReportData 输出里统计图中边
function graphEdgeCounts(reportData) {
  const edges = reportData.edges || [];
  return {
    total: edges.length,
    added: edges.filter(e => e.status === 'added').length,
    removed: edges.filter(e => e.status === 'removed').length,
    rerouted: edges.filter(e => e.status === 'rerouted').length,
    violation: edges.filter(e => e.violation === true).length,
    // 图中不应出现归属边或外部边
    attachLeak: edges.filter(e => isAttach(e)).length,
    externalLeak: edges.filter(e => isExternal(e)).length,
  };
}

// 从 diff 里统计高信号边（排除归属边和外部边）
function diffHighSignalCounts(diff) {
  const added = diff.addedEdges.filter(isHighSignal);
  const removed = diff.removedEdges.filter(isHighSignal);
  const attachAdded = diff.addedEdges.filter(isAttach);
  const attachRemoved = diff.removedEdges.filter(isAttach);
  return {
    added: added.length,
    removed: removed.length,
    violations: (diff.violations || []).length,
    attachAdded: attachAdded.length,
    attachRemoved: attachRemoved.length,
  };
}

// 核心一致性断言：对任意 reportData + diff 跑四口径校验
function assertFourWayConsistent(reportData, diff, findings) {
  const g = graphEdgeCounts(reportData);
  const d = diffHighSignalCounts(diff);

  // A. 违规边：图 violation = diff.violations ∪ findings 跨层端点
  // evaluateRisk 的 layer-skip / cross-layer-violation 会标到图上，但未必回写 diff.violations
  const violationFindings = (findings || []).filter(f =>
    f.rule === 'cross-layer' || f.rule === 'layering' || /跨层|分层|layer/i.test(f.rule || '')
  );
  const findingViolKeys = new Set(
    violationFindings.filter((f) => f.from && f.to).map((f) => `${f.from}|${f.to}`)
  );
  const diffViolKeys = new Set((diff.violations || []).map((v) => `${v.from}|${v.to}`));
  const expectedViol = new Set([...findingViolKeys, ...diffViolKeys]);
  assert.equal(
    expectedViol.size, g.violation,
    `违规边不一致：findings∪diff=${expectedViol.size} vs 图 violation=${g.violation}`
  );
  assert.ok(
    violationFindings.length >= d.violations || findings.length === 0,
    `findings 违规数 ${violationFindings.length} < diff.violations ${d.violations}`
  );

  // B. 高信号 added 边：diff == 图 == 顶栏
  assert.equal(
    d.added, g.added,
    `高信号 added 边不一致：diff=${d.added} vs 图=${g.added}（归属边 ${d.attachAdded} 条应折叠）`
  );
  assert.equal(
    reportData.summary.addedArchitecturalEdges, g.added,
    `顶栏「新增关系」应等于图 added：card=${reportData.summary.addedArchitecturalEdges} vs 图=${g.added}（原始 addedEdges=${reportData.summary.addedEdges}）`
  );

  // C. 高信号 removed 边：diff == 图 == 顶栏
  assert.equal(
    d.removed, g.removed,
    `高信号 removed 边不一致：diff=${d.removed} vs 图=${g.removed}（归属边 ${d.attachRemoved} 条应折叠）`
  );
  assert.equal(
    reportData.summary.removedArchitecturalEdges, g.removed,
    `顶栏「删除关系」应等于图 removed：card=${reportData.summary.removedArchitecturalEdges} vs 图=${g.removed}`
  );
  assert.equal(
    reportData.summary.violations, g.violation,
    `顶栏「分层违规」应等于图 violation：card=${reportData.summary.violations} vs 图=${g.violation}`
  );

  // D. 归属边不进图
  assert.equal(g.attachLeak, 0, `图中泄漏了 ${g.attachLeak} 条归属边（declared-in/defined-in 不应进图）`);

  // E. 外部边不进图
  assert.equal(g.externalLeak, 0, `图中泄漏了 ${g.externalLeak} 条外部边（uses-external 应走 extAdded/extRemoved）`);
}

// 辅助：构造最小图
function makeGraph(nodes, edges, fingerprint) {
  return {
    fingerprint,
    root: '/demo',
    stats: { files: 0, types: 0, edges: edges.length, externalPackages: 0 },
    nodes,
    edges
  };
}

// ─── 场景 1：纯实体级新增边（class A → class B import），无违规 ───
function scenario1_entityEdge() {
  const base = makeGraph([
    { id: 'cls:A', kind: 'class', name: 'A', layer: 'service', lang: 'js', path: 'a.js', methods: [] },
    { id: 'cls:B', kind: 'class', name: 'B', layer: 'util', lang: 'js', path: 'b.js', methods: [] },
    { id: 'file:a.js', kind: 'file', name: 'a.js', path: 'a.js', layer: 'service', lang: 'js' },
    { id: 'file:b.js', kind: 'file', name: 'b.js', path: 'b.js', layer: 'util', lang: 'js' },
  ], [
    { from: 'cls:A', to: 'file:a.js', type: 'declared-in' },
    { from: 'cls:B', to: 'file:b.js', type: 'declared-in' },
  ], 'base1');

  const head = makeGraph([
    { id: 'cls:A', kind: 'class', name: 'A', layer: 'service', lang: 'js', path: 'a.js', methods: ['go'] },
    { id: 'cls:B', kind: 'class', name: 'B', layer: 'util', lang: 'js', path: 'b.js', methods: [] },
    { id: 'file:a.js', kind: 'file', name: 'a.js', path: 'a.js', layer: 'service', lang: 'js' },
    { id: 'file:b.js', kind: 'file', name: 'b.js', path: 'b.js', layer: 'util', lang: 'js' },
  ], [
    { from: 'cls:A', to: 'file:a.js', type: 'declared-in' },
    { from: 'cls:B', to: 'file:b.js', type: 'declared-in' },
    { from: 'cls:A', to: 'cls:B', type: 'import', file: 'a.js', line: 3 },
  ], 'head1');

  const diff = diffGraphs(base, head);
  const findings = [];
  const report = buildReportData(base, head, diff, findings, null, 'demo', null);
  return { report, diff, findings };
}

// ─── 场景 2：文件级跨层违规（file:data → file:controller import）───
function scenario2_fileViolation() {
  const base = makeGraph([
    { id: 'file:data/db.js', kind: 'file', name: 'db.js', path: 'data/db.js', layer: 'storage', lang: 'js' },
    { id: 'file:controller/api.js', kind: 'file', name: 'api.js', path: 'controller/api.js', layer: 'controller', lang: 'js' },
  ], [], 'base2');

  const head = makeGraph([
    { id: 'file:data/db.js', kind: 'file', name: 'db.js', path: 'data/db.js', layer: 'storage', lang: 'js' },
    { id: 'file:controller/api.js', kind: 'file', name: 'api.js', path: 'controller/api.js', layer: 'controller', lang: 'js' },
  ], [
    { from: 'file:data/db.js', to: 'file:controller/api.js', type: 'import', file: 'data/db.js', line: 2 },
  ], 'head2');

  const diff = diffGraphs(base, head);
  // 手动注入违规（模拟 risk-rules 输出）
  diff.violations = [{
    from: 'file:data/db.js', to: 'file:controller/api.js',
    edgeType: 'import', fromLayer: 'storage', toLayer: 'controller'
  }];
  diff.summary.violations = 1;
  const findings = [
    { rule: 'cross-layer', severity: 'high', title: '跨层依赖违规', message: '存储 层直接依赖 控制器 层', from: 'file:data/db.js', to: 'file:controller/api.js', edgeType: 'import' }
  ];
  const report = buildReportData(base, head, diff, findings, null, 'demo', null);
  return { report, diff, findings };
}

// ─── 场景 3：删除文件 + 删除边（service 模块被移除）───
function scenario3_removal() {
  const base = makeGraph([
    { id: 'file:svc.js', kind: 'file', name: 'svc.js', path: 'svc.js', layer: 'service', lang: 'js' },
    { id: 'file:db.js', kind: 'file', name: 'db.js', path: 'db.js', layer: 'storage', lang: 'js' },
    { id: 'cls:Svc', kind: 'class', name: 'Svc', layer: 'service', lang: 'js', path: 'svc.js', methods: ['run'] },
  ], [
    { from: 'cls:Svc', to: 'file:svc.js', type: 'declared-in' },
    { from: 'file:svc.js', to: 'file:db.js', type: 'import', file: 'svc.js', line: 1 },
  ], 'base3');

  const head = makeGraph([
    { id: 'file:db.js', kind: 'file', name: 'db.js', path: 'db.js', layer: 'storage', lang: 'js' },
  ], [], 'head3');

  const diff = diffGraphs(base, head);
  const findings = [
    { rule: 'removed-type', severity: 'medium', title: '类型删除', message: 'class Svc 被删除' }
  ];
  const report = buildReportData(base, head, diff, findings, null, 'demo', null);
  return { report, diff, findings };
}

// ─── 场景 4：新增文件 + 归属边 + 外部依赖（神文件 helpers 被引用）───
function scenario4_godFile() {
  const base = makeGraph([
    { id: 'file:svc.js', kind: 'file', name: 'svc.js', path: 'svc.js', layer: 'service', lang: 'js' },
    { id: 'cls:Svc', kind: 'class', name: 'Svc', layer: 'service', lang: 'js', path: 'svc.js', methods: ['run'] },
  ], [
    { from: 'cls:Svc', to: 'file:svc.js', type: 'declared-in' },
  ], 'base4');

  const head = makeGraph([
    { id: 'file:svc.js', kind: 'file', name: 'svc.js', path: 'svc.js', layer: 'service', lang: 'js' },
    { id: 'file:helpers.js', kind: 'file', name: 'helpers.js', path: 'helpers.js', layer: 'util', lang: 'js' },
    { id: 'cls:Svc', kind: 'class', name: 'Svc', layer: 'service', lang: 'js', path: 'svc.js', methods: ['run', 'help'] },
    { id: 'fn:fmt', kind: 'function', name: 'fmt', layer: 'util', lang: 'js', path: 'helpers.js', methods: [] },
    { id: 'fn:val', kind: 'function', name: 'val', layer: 'util', lang: 'js', path: 'helpers.js', methods: [] },
    { id: 'ext:lodash', kind: 'external', name: 'lodash', builtin: false },
  ], [
    { from: 'cls:Svc', to: 'file:svc.js', type: 'declared-in' },
    { from: 'fn:fmt', to: 'file:helpers.js', type: 'declared-in' },
    { from: 'fn:val', to: 'file:helpers.js', type: 'declared-in' },
    { from: 'file:svc.js', to: 'file:helpers.js', type: 'import', file: 'svc.js', line: 2 },
    { from: 'file:helpers.js', to: 'ext:lodash', type: 'uses-external', file: 'helpers.js', line: 1 },
  ], 'head4');

  const diff = diffGraphs(base, head);
  const findings = [];
  const report = buildReportData(base, head, diff, findings, null, 'demo', null);
  return { report, diff, findings };
}

// ─── 场景 5：混合——新增实体级边 + 文件级违规边 + 外部依赖变化 ───
function scenario5_mixed() {
  const base = makeGraph([
    { id: 'file:data/db.js', kind: 'file', name: 'db.js', path: 'data/db.js', layer: 'storage', lang: 'js' },
    { id: 'file:ctrl/api.js', kind: 'file', name: 'api.js', path: 'ctrl/api.js', layer: 'controller', lang: 'js' },
    { id: 'cls:Repo', kind: 'class', name: 'Repo', layer: 'storage', lang: 'js', path: 'data/db.js', methods: ['find'] },
  ], [
    { from: 'cls:Repo', to: 'file:data/db.js', type: 'declared-in' },
  ], 'base5');

  const head = makeGraph([
    { id: 'file:data/db.js', kind: 'file', name: 'db.js', path: 'data/db.js', layer: 'storage', lang: 'js' },
    { id: 'file:ctrl/api.js', kind: 'file', name: 'api.js', path: 'ctrl/api.js', layer: 'controller', lang: 'js' },
    { id: 'cls:Repo', kind: 'class', name: 'Repo', layer: 'storage', lang: 'js', path: 'data/db.js', methods: ['find', 'save'] },
    { id: 'cls:Ctrl', kind: 'class', name: 'Ctrl', layer: 'controller', lang: 'js', path: 'ctrl/api.js', methods: ['handle'] },
    { id: 'ext:express', kind: 'external', name: 'express', builtin: false },
  ], [
    { from: 'cls:Repo', to: 'file:data/db.js', type: 'declared-in' },
    { from: 'cls:Ctrl', to: 'file:ctrl/api.js', type: 'declared-in' },
    // 文件级跨层违规：storage → controller
    { from: 'file:data/db.js', to: 'file:ctrl/api.js', type: 'import', file: 'data/db.js', line: 3 },
    // 实体级边
    { from: 'cls:Repo', to: 'cls:Ctrl', type: 'import', file: 'data/db.js', line: 4 },
    // 外部依赖
    { from: 'file:ctrl/api.js', to: 'ext:express', type: 'uses-external', file: 'ctrl/api.js', line: 1 },
  ], 'head5');

  const diff = diffGraphs(base, head);
  diff.violations = [{
    from: 'file:data/db.js', to: 'file:ctrl/api.js',
    edgeType: 'import', fromLayer: 'storage', toLayer: 'controller'
  }];
  diff.summary.violations = 1;
  const findings = [
    { rule: 'cross-layer', severity: 'high', title: '跨层依赖违规', message: '存储→控制器', from: 'file:data/db.js', to: 'file:ctrl/api.js', edgeType: 'import' }
  ];
  const report = buildReportData(base, head, diff, findings, null, 'demo', null);
  return { report, diff, findings };
}

// ═══════════════════════════════════════════════════════════════
describe('W15-03: 四口径一致性（顶部统计 / Delta 图 / findings / JSON）', () => {
  const scenarios = [
    ['场景1: 纯实体级新增边，无违规', scenario1_entityEdge],
    ['场景2: 文件级跨层违规', scenario2_fileViolation],
    ['场景3: 删除文件 + 删除边', scenario3_removal],
    ['场景4: 新增神文件 + 归属边 + 外部依赖', scenario4_godFile],
    ['场景5: 混合（实体边 + 文件违规 + 外部依赖）', scenario5_mixed],
  ];

  for (const [name, fn] of scenarios) {
    it(name, () => {
      const { report, diff, findings } = fn();
      assertFourWayConsistent(report, diff, findings);
    });
  }

  it('场景2: 文件级违规边在图中 violation=true 且 status=added', () => {
    const { report } = scenario2_fileViolation();
    const violEdges = report.edges.filter(e => e.violation === true);
    assert.equal(violEdges.length, 1);
    assert.equal(violEdges[0].from, 'file:data/db.js');
    assert.equal(violEdges[0].to, 'file:controller/api.js');
    assert.equal(violEdges[0].status, 'added');
  });

  it('场景3: 删除的文件级 import 边在图中 status=removed', () => {
    const { report } = scenario3_removal();
    const removed = report.edges.filter(e => e.status === 'removed');
    // svc.js → db.js 的 import 边应被标记 removed
    const importRemoved = removed.filter(e => e.type === 'import');
    assert.ok(importRemoved.length >= 1, '应有至少 1 条 removed import 边');
  });

  it('场景4: 归属边不进图但文件级 import 边进图', () => {
    const { report, diff } = scenario4_godFile();
    // helpers.js 的 2 个函数产生 2 条 declared-in 归属边，不应进图
    const attachInGraph = report.edges.filter(e => isAttach(e));
    assert.equal(attachInGraph.length, 0, '归属边不应进图');
    // svc.js → helpers.js 的 import 边应进图
    const importEdges = report.edges.filter(e => e.type === 'import' && e.status === 'added');
    assert.ok(importEdges.length >= 1, '文件级 import 边应进图');
    // 外部依赖边不进图
    const extInGraph = report.edges.filter(e => isExternal(e));
    assert.equal(extInGraph.length, 0, '外部边不应进图');
  });

  it('场景5: 混合场景下违规边和高信号边都正确', () => {
    const { report } = scenario5_mixed();
    // 违规边
    const violEdges = report.edges.filter(e => e.violation === true);
    assert.equal(violEdges.length, 1);
    // 文件级违规边
    const fileViol = violEdges.find(e => e.from.startsWith('file:'));
    assert.ok(fileViol, '应有文件级违规边');
    // 图中无归属边/外部边泄漏
    assert.equal(report.edges.filter(e => isAttach(e)).length, 0);
    assert.equal(report.edges.filter(e => isExternal(e)).length, 0);
  });

  it('真实仓 beginner-demo：v1→v2 跨层补丁四口径一致', () => {
    const src = path.join(__dirname, '..', 'examples', 'beginner-demo');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-four-way-beginner-'));
    try {
      fs.cpSync(path.join(src, 'v1'), dir, { recursive: true });
      const base = buildGraph(dir);
      fs.cpSync(path.join(src, 'v2-ai-patch'), dir, { recursive: true });
      const head = buildGraph(dir);
      const diff = diffGraphs(base, head);
      const findings = evaluateRisk(diff, head, base);
      const report = buildReportData(base, head, diff, findings, null, 'beginner-demo', null);
      assert.ok(findings.some((f) => /cross-layer|layer-skip/i.test(f.rule)),
        `v2 补丁应产生跨层 finding，实际: ${findings.map((f) => f.rule).join(',')}`);
      assertFourWayConsistent(report, diff, findings);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('真实仓 tutorial-demo：routes 直连 database 四口径一致', () => {
    const src = path.join(__dirname, '..', 'examples', 'tutorial-demo');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-four-way-tutorial-'));
    try {
      fs.cpSync(path.join(src, 'app'), path.join(dir, 'app'), { recursive: true });
      const base = buildGraph(dir);
      const routes = path.join(dir, 'app', 'routes', 'todos.py');
      const body = fs.readFileSync(routes, 'utf8');
      fs.writeFileSync(routes, 'from app.database.todo_repo import select_all_todos\n' + body);
      const head = buildGraph(dir);
      const diff = diffGraphs(base, head);
      const findings = evaluateRisk(diff, head, base);
      const report = buildReportData(base, head, diff, findings, null, 'tutorial-demo', null);
      assert.ok(diff.addedEdges.some((e) => e.type === 'import'), '应新增 import 边');
      assertFourWayConsistent(report, diff, findings);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('实提取：新增函数产生 declared-in 时顶栏≠原始边、=图上架构边', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-four-way-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'));
      fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'export class B {}\n');
      fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'export class A {}\n');
      const base = buildGraph(dir);
      fs.writeFileSync(
        path.join(dir, 'src', 'a.js'),
        'import { B } from "./b.js";\nexport class A {}\nexport function added() {}\n'
      );
      const head = buildGraph(dir);
      const diff = diffGraphs(base, head);
      const report = buildReportData(base, head, diff, [], null, 'audit', null);
      const graphAdded = report.edges.filter((e) => e.status === 'added').length;
      const attachAdded = diff.addedEdges.filter(isAttach).length;
      assert.ok(attachAdded >= 1, '应有 declared-in 归属边');
      assert.ok(diff.summary.addedEdges > diff.summary.addedArchitecturalEdges,
        `原始边 ${diff.summary.addedEdges} 应大于架构边 ${diff.summary.addedArchitecturalEdges}`);
      assert.equal(report.summary.addedArchitecturalEdges, graphAdded);
      assert.equal(diff.summary.addedArchitecturalEdges, graphAdded);
      assertFourWayConsistent(report, diff, []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
