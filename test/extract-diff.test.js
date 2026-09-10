'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildGraph, extractGraphTo } = require('../lib/extract-graph');
const { diffGraphs, formatDiffText } = require('../lib/diff-graph');
const { buildReportData, generateReport, formatFileLocLabel, fileLocSeverity } = require('../lib/session-report');
const { evaluateRisk, summarizeFindings } = require('../lib/risk-rules');

/* --- 临时仓库 fixture --- */
function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-extract-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe('extract: 多语言图提取', () => {
  it('从 Python + JS 仓库提取节点和边', () => {
    const dir = makeRepo({
      'services/order_service.py': `
import os
from models.order import Order

class OrderService:
    def create(self, order: Order) -> Order:
        pass
`,
      'models/order.py': `
class Order:
    def total(self) -> float:
        return 0.0
`,
      'src/index.js': `
const { Order } = require('./models/order');
class App {
  start() {}
}
module.exports = { App };
`
    });
    const graph = buildGraph(dir);
    // 至少 3 个文件节点 + 3 个类型节点
    assert.ok(graph.stats.files >= 3, `files=${graph.stats.files}`);
    assert.ok(graph.stats.nodes >= 6, `nodes=${graph.stats.nodes}`);
    assert.ok(graph.stats.edges >= 3, `edges=${graph.stats.edges}`);
    assert.ok(graph.fingerprint.length === 16);
    assert.ok(graph.languages.includes('python'));
    assert.ok(graph.languages.includes('javascript'));
    // OrderService → Order 方法参数/返回类型边
    const typeEdges = graph.edges.filter((e) => e.type === 'method-param' || e.type === 'method-return');
    assert.ok(typeEdges.length > 0, 'should have method type edges');
  });

  it('fingerprint 相同仓库稳定', () => {
    const dir = makeRepo({
      'main.py': 'class App:\n    pass\n'
    });
    const g1 = buildGraph(dir);
    const g2 = buildGraph(dir);
    assert.equal(g1.fingerprint, g2.fingerprint);
  });

  it('extractGraphTo 写入 JSON 文件', () => {
    const dir = makeRepo({ 'main.py': 'class App:\n    pass\n' });
    const out = path.join(dir, 'out', 'graph.json');
    const g = extractGraphTo(dir, out);
    assert.ok(fs.existsSync(out));
    const parsed = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(parsed.fingerprint, g.fingerprint);
  });
});

describe('diff: 架构图差分', () => {
  it('相同仓库 diff 为空', () => {
    const dir = makeRepo({ 'main.py': 'class App:\n    pass\n' });
    const g = buildGraph(dir);
    const d = diffGraphs(g, g);
    assert.equal(d.summary.addedNodes, 0);
    assert.equal(d.summary.removedNodes, 0);
    assert.equal(d.summary.addedEdges, 0);
    assert.equal(d.summary.removedEdges, 0);
    assert.equal(d.summary.changeScale, 'none');
    assert.equal(d.summary.riskLevel, undefined);
  });

  it('新增类型检测', () => {
    const base = makeRepo({
      'models/order.py': 'class Order:\n    pass\n'
    });
    // head = base + 新文件
    const head = makeRepo({
      'models/order.py': 'class Order:\n    pass\n',
      'services/svc.py': 'from models.order import Order\nclass OrderService:\n    def create(self, o: Order) -> None:\n        pass\n'
    });
    const gBase = buildGraph(base);
    const gHead = buildGraph(head);
    const d = diffGraphs(gBase, gHead);
    assert.ok(d.summary.addedNodes > 0, `addedNodes=${d.summary.addedNodes}`);
    assert.ok(d.addedTypes.some((t) => t.node.kind === 'class' && t.node.name === 'OrderService'));
    assert.ok(d.summary.changeScale !== 'none');
  });

  it('删除类型检测', () => {
    const base = makeRepo({
      'models/order.py': 'class Order:\n    pass\n',
      'models/extra.py': 'class Extra:\n    pass\n'
    });
    const head = makeRepo({
      'models/order.py': 'class Order:\n    pass\n'
    });
    const d = diffGraphs(buildGraph(base), buildGraph(head));
    assert.ok(d.summary.removedNodes > 0);
    assert.ok(d.removedTypes.some((t) => t.node.name === 'Extra'));
  });

  it('修改方法检测', () => {
    const base = makeRepo({
      'svc.py': 'class Svc:\n    def foo(self):\n        pass\n'
    });
    const head = makeRepo({
      'svc.py': 'class Svc:\n    def foo(self):\n        pass\n    def bar(self):\n        pass\n'
    });
    const d = diffGraphs(buildGraph(base), buildGraph(head));
    assert.ok(d.modifiedNodes.length > 0);
    const mod = d.modifiedNodes[0];
    const methodChange = mod.changes.find((c) => c.field === 'methods');
    assert.ok(methodChange, 'should detect method change');
    assert.ok(methodChange.added.includes('bar'));
  });

  it('仅 path/layer 变化归为 moved，不入 modified', () => {
    const base = {
      fingerprint: 'b', root: '/r', stats: {},
      nodes: [{ id: 'cls:A', name: 'A', kind: 'class', path: 'old/a.py', layer: 'util', methods: ['x'], modifiers: [] }],
      edges: []
    };
    const head = {
      fingerprint: 'h', root: '/r', stats: {},
      nodes: [{ id: 'cls:A', name: 'A', kind: 'class', path: 'new/a.py', layer: 'service', methods: ['x'], modifiers: [] }],
      edges: []
    };
    const d = diffGraphs(base, head);
    assert.equal(d.modifiedNodes.length, 0);
    assert.equal(d.movedNodes.length, 1);
    assert.equal(d.movedNodes[0].id, 'cls:A');
    assert.ok(d.movedNodes[0].changes.some((c) => c.field === 'path'));
    assert.ok(d.movedNodes[0].changes.some((c) => c.field === 'layer'));
    assert.equal(d.summary.movedNodes, 1);
    const text = formatDiffText(d);
    assert.match(text, /移动/);
  });

  it('methods 顺序不同不产生 modified（canonical）', () => {
    const base = {
      fingerprint: 'b', root: '/r', stats: {},
      nodes: [{ id: 'cls:A', name: 'A', kind: 'class', path: 'a.py', layer: 'util', methods: ['b', 'a'], modifiers: [] }],
      edges: []
    };
    const head = {
      fingerprint: 'h', root: '/r', stats: {},
      nodes: [{ id: 'cls:A', name: 'A', kind: 'class', path: 'a.py', layer: 'util', methods: ['a', 'b'], modifiers: [] }],
      edges: []
    };
    const d = diffGraphs(base, head);
    assert.equal(d.modifiedNodes.length, 0);
    assert.equal(d.movedNodes.length, 0);
  });

  it('同端点边类型变更归为 rerouted', () => {
    const base = {
      fingerprint: 'b', root: '/r', stats: {},
      nodes: [
        { id: 'cls:A', name: 'A', kind: 'class', path: 'a.py', layer: 'service' },
        { id: 'cls:B', name: 'B', kind: 'class', path: 'b.py', layer: 'domain' }
      ],
      edges: [{ from: 'cls:A', to: 'cls:B', type: 'implements' }]
    };
    const head = {
      fingerprint: 'h', root: '/r', stats: {},
      nodes: [
        { id: 'cls:A', name: 'A', kind: 'class', path: 'a.py', layer: 'service' },
        { id: 'cls:B', name: 'B', kind: 'class', path: 'b.py', layer: 'domain' }
      ],
      edges: [{ from: 'cls:A', to: 'cls:B', type: 'import' }]
    };
    const d = diffGraphs(base, head);
    assert.equal(d.addedEdges.length, 0);
    assert.equal(d.removedEdges.length, 0);
    assert.equal(d.reroutedEdges.length, 1);
    assert.equal(d.reroutedEdges[0].fromType, 'implements');
    assert.equal(d.reroutedEdges[0].toType, 'import');
    assert.match(formatDiffText(d), /重连/);
  });

  it('formatDiffText 输出中文报告', () => {
    const base = makeRepo({ 'a.py': 'class A:\n    pass\n' });
    const head = makeRepo({
      'a.py': 'class A:\n    pass\n',
      'b.py': 'class B:\n    pass\n'
    });
    const d = diffGraphs(buildGraph(base), buildGraph(head));
    const text = formatDiffText(d);
    assert.match(text, /架构变更报告/);
    assert.match(text, /汇总/);
    assert.match(text, /新增类型/);
    assert.match(text, /B/);
  });

  it('重命名检测：同文件同类名相似 → 归入 renamedNodes', () => {
    const base = makeRepo({
      'svc.js': 'function generateBlockOrch4() { return 1; }\n'
    });
    const head = makeRepo({
      'svc.js': 'function generateBlockAuto() { return 1; }\n'
    });
    const d = diffGraphs(buildGraph(base), buildGraph(head));
    assert.ok(d.renamedNodes.length > 0, 'should detect rename');
    assert.equal(d.renamedNodes[0].oldName, 'generateBlockOrch4');
    assert.equal(d.renamedNodes[0].newName, 'generateBlockAuto');
    // 归并后不再出现在 added/removed
    assert.equal(d.summary.removedNodes, 0, 'removed should be 0 after merge');
    assert.equal(d.summary.addedNodes, 0, 'added should be 0 after merge');
    assert.ok(d.summary.renamedNodes >= 1);
    // formatDiffText 输出重命名段
    const text = formatDiffText(d);
    assert.match(text, /重命名/);
  });

  it('重命名不误匹配：完全不同的名字仍报删+增', () => {
    const base = makeRepo({
      'svc.js': 'function foo() { return 1; }\n'
    });
    const head = makeRepo({
      'svc.js': 'function bar() { return 2; }\n'
    });
    const d = diffGraphs(buildGraph(base), buildGraph(head));
    assert.equal(d.renamedNodes.length, 0, 'foo→bar should NOT be rename');
    assert.ok(d.summary.removedNodes > 0);
    assert.ok(d.summary.addedNodes > 0);
  });

  it('跨目录移动检测：同名 + 同文件 basename + 路径变化 → moved 配对，不报删+增', () => {
    const base = makeRepo({
      'web/lib/pro/auth.js': 'function requestLoginCode() { return 1; }\n'
    });
    const head = makeRepo({
      'lib/pro/auth.js': 'function requestLoginCode() { return 1; }\n'
    });
    const d = diffGraphs(buildGraph(base), buildGraph(head));
    const moves = d.renamedNodes.filter((r) => r.moved);
    assert.ok(moves.length >= 2, 'file + function should be paired as moves');
    assert.ok(moves.every((m) => m.fromPath.includes('web/lib/pro') && m.toPath === m.fromPath.replace('web/lib/pro', 'lib/pro')));
    // 随文件迁移的函数不再报为类型删除/新增
    assert.equal(d.removedTypes.filter((t) => t.node.name === 'requestLoginCode').length, 0);
    assert.equal(d.addedTypes.filter((t) => t.node.name === 'requestLoginCode').length, 0);
    const text = formatDiffText(d);
    assert.match(text, /移动（跨目录/);
  });

  it('跨目录移动不误匹配：basename 不同的同名实体仍报删+增', () => {
    const base = makeRepo({
      'web/foo.js': 'function load() { return 1; }\n'
    });
    const head = makeRepo({
      'lib/bar.js': 'function load() { return 2; }\n'
    });
    const d = diffGraphs(buildGraph(base), buildGraph(head));
    assert.equal(d.renamedNodes.filter((r) => r.moved).length, 0);
  });

  it('已有文件内新增函数检测（childEntities）', () => {
    const base = makeRepo({
      'svc.js': 'function foo() { return 1; }\n'
    });
    const head = makeRepo({
      'svc.js': 'function foo() { return 1; }\nfunction bar() { return 2; }\n'
    });
    const d = diffGraphs(buildGraph(base), buildGraph(head));
    // foo exists in both, bar is new → should be in modifiedNodes with childEntities
    const mod = d.modifiedNodes.find(m =>
      m.changes.some(c => c.field === 'childEntities')
    );
    assert.ok(mod, 'should detect childEntities change');
    const childChange = mod.changes.find(c => c.field === 'childEntities');
    assert.ok(childChange.added.length > 0, 'should have added child entity');
    assert.ok(childChange.removed.length === 0, 'should have no removed child entity');
  });
});

describe('B1-3: 报告过滤（高信号优先）', () => {
  it('文本报告默认折叠归属关系边，提示 --all', () => {
    const base = makeRepo({
      'models/order.py': 'class Order:\n    pass\n'
    });
    const head = makeRepo({
      'models/order.py': 'class Order:\n    pass\n',
      'services/svc.py': 'from models.order import Order\nclass Svc:\n    def use(self, o: Order) -> None:\n        pass\n'
    });
    const d = diffGraphs(buildGraph(base), buildGraph(head));
    // 前提：新增边里确实有归属边
    const attach = d.addedEdges.filter((e) => ['declared-in', 'defined-in'].includes(e.type));
    assert.ok(attach.length > 0, 'fixture should produce attachment edges');

    const text = formatDiffText(d);
    assert.ok(!/--declared-in-->/.test(text), 'default should hide declared-in edges');
    assert.ok(!/--defined-in-->/.test(text), 'default should hide defined-in edges');
    assert.match(text, /归属关系/, 'should hint at folded attachment edges');
    // 依赖边仍然可见
    assert.match(text, /新增关系/);
  });

  it('文本报告 --all 展开归属关系边且不再提示', () => {
    const base = makeRepo({
      'models/order.py': 'class Order:\n    pass\n'
    });
    const head = makeRepo({
      'models/order.py': 'class Order:\n    pass\n',
      'services/svc.py': 'from models.order import Order\nclass Svc:\n    def use(self, o: Order) -> None:\n        pass\n'
    });
    const d = diffGraphs(buildGraph(base), buildGraph(head));
    const textAll = formatDiffText(d, { all: true });
    assert.match(textAll, /--declared-in-->|--defined-in-->/, '--all should list attachment edges');
    assert.ok(!/--all 查看/.test(textAll), '--all mode should not show the fold hint');
  });

  // Hand-built graphs/diff for deterministic HTML payload checks
  function fixtureReport() {
    const baseGraph = {
      fingerprint: '0'.repeat(16), root: '/base', stats: {},
      nodes: [
        { id: 'cls:SvcOld', name: 'SvcOld', kind: 'class', layer: 'service', path: 'svc.js' },
        { id: 'cls:Keep', name: 'Keep', kind: 'class', layer: 'util', path: 'keep.js' }
      ],
      edges: [{ from: 'cls:SvcOld', to: 'cls:Keep', type: 'import' }]
    };
    const headGraph = {
      fingerprint: '1'.repeat(16), root: '/head', stats: {},
      nodes: [
        { id: 'cls:SvcNew', name: 'SvcNew', kind: 'class', layer: 'service', path: 'svc.js' },
        { id: 'cls:Added', name: 'Added', kind: 'class', layer: 'service', path: 'add.js' },
        { id: 'cls:Keep', name: 'Keep', kind: 'class', layer: 'util', path: 'keep.js', methods: ['extra'] }
      ],
      edges: [
        { from: 'cls:SvcNew', to: 'cls:Keep', type: 'import' },
        { from: 'cls:Added', to: 'cls:Keep', type: 'import' },
        { from: 'cls:Added', to: 'file:add.js', type: 'declared-in' }
      ]
    };
    const diff = {
      addedNodes: [{ id: 'cls:Added', node: headGraph.nodes[1] }],
      removedNodes: [],
      modifiedNodes: [{ id: 'cls:Keep', changes: [{ field: 'methods', added: ['extra'], removed: [] }] }],
      movedNodes: [],
      renamedNodes: [{
        kind: 'class', oldName: 'SvcOld', newName: 'SvcNew', path: 'svc.js',
        from: baseGraph.nodes[0], to: headGraph.nodes[0]
      }],
      addedEdges: [
        { from: 'cls:Added', to: 'cls:Keep', type: 'import' },
        { from: 'cls:Added', to: 'file:add.js', type: 'declared-in' }
      ],
      removedEdges: [],
      reroutedEdges: [],
      addedTypes: [{ node: headGraph.nodes[1] }], removedTypes: [],
      addedPackages: [], removedPackages: [],
      addedExternalDeps: [], removedExternalDeps: [], violations: [],
      summary: {
        addedNodes: 1, removedNodes: 0, modifiedNodes: 1, movedNodes: 0, renamedNodes: 1,
        addedEdges: 2, removedEdges: 0, reroutedEdges: 0, addedTypes: 1, removedTypes: 0,
        addedPackages: 0, removedPackages: 0, addedExternalDeps: 0,
        removedExternalDeps: 0, violations: 0, totalChanges: 5, changeScale: 'low',
        addedArchitecturalEdges: 1, removedArchitecturalEdges: 0, reroutedArchitecturalEdges: 0
      }
    };
    return { baseGraph, headGraph, diff };
  }

  it('HTML payload: 实体状态分类为 added/renamed/modified，归属边不入图', () => {
    const { baseGraph, headGraph, diff } = fixtureReport();
    const data = buildReportData(baseGraph, headGraph, diff, [], 'demo', null);
    const statusById = Object.fromEntries(data.entities.map((e) => [e.id, e.status]));
    assert.equal(statusById['cls:Added'], 'added');
    assert.equal(statusById['cls:SvcNew'], 'renamed');
    assert.equal(statusById['cls:SvcOld'], 'renamed');
    assert.equal(statusById['cls:Keep'], 'modified');
    assert.equal(data.renamed.length, 1);
    assert.equal(data.renamed[0].newName, 'SvcNew');
    // 归属边（declared-in）不进入架构图
    assert.ok(data.edges.every((e) => e.type !== 'declared-in'), 'attachment edges must be excluded');
    assert.ok(data.edges.some((e) => e.from === 'cls:Added' && e.status === 'added'));
    assert.equal(data.summary.addedArchitecturalEdges, data.edges.filter((e) => e.status === 'added').length);
    assert.ok(data.summary.addedEdges > data.summary.addedArchitecturalEdges);
  });

  it('HTML 默认「仅变更」过滤（未变更项折叠）', () => {
    const { baseGraph, headGraph, diff } = fixtureReport();
    const html = generateReport({
      baseGraph, headGraph, diff, findings: [], repoName: 'demo', sessionStart: null
    });
    assert.match(html, /let currentFilter = 'changed'/, 'default filter must be changed');
    assert.match(html, /class="filter-btn active" data-filter="changed"/, 'changed button must be active');
    assert.ok(!/data-filter="all"[^>]*class="[^"]*active/.test(html), 'all button must not be active');
    // 重命名组在前端脚本中有渲染入口
    assert.match(html, /重命名/);
    assert.match(html, /id="graph-delta"/, 'must include Delta middle panel');
    assert.match(html, /addedArchitecturalEdges/);
    assert.match(html, /Before \/ Delta \/ After/);
    assert.match(html, /av-delta-glow/, 'delta nodes must pulse/highlight');
    assert.match(html, /node-badge-bg/, 'changed nodes carry a corner +/~/− chip');
    assert.match(html, /绿=新增/);
    assert.match(html, /FILE_HEADER_H = 36/, 'file header is two lines so path and badges do not collide');
    assert.match(html, /svgEl\.setAttribute\('width', tw\)/, 'SVG uses content width so After text does not shrink into overlap');
    assert.match(html, /empty-inline/, 'empty edge list is compact, not a huge checkmark');
    assert.match(html, /locInfo\.label/, 'loc badge uses preformatted label (skips fake +100%)');
  });

  it('行数角标：无基线数据不写 +100%，有基线才标增长', () => {
    assert.equal(formatFileLocLabel({ base: 0, head: 1095, delta: 1095, deltaPercent: 100 }), '');
    assert.equal(fileLocSeverity({ base: 0, head: 1095, delta: 1095, deltaPercent: 100 }), '');
    assert.equal(formatFileLocLabel({ base: 200, head: 360, delta: 160, deltaPercent: 80 }), '+160行 · +80%');
    assert.equal(fileLocSeverity({ base: 200, head: 360, delta: 160, deltaPercent: 80 }), 'growth');
    assert.equal(fileLocSeverity({ base: 400, head: 750, delta: 350, deltaPercent: 88 }), 'growth-med');
    assert.equal(formatFileLocLabel({ base: 400, head: 390, delta: -10, deltaPercent: -3 }), '');
  });

  it('HTML 内联脚本必须可解析（浏览器里不能白屏）', () => {
    const { baseGraph, headGraph, diff } = fixtureReport();
    const html = generateReport({
      baseGraph, headGraph, diff, findings: [], repoName: 'demo', sessionStart: null
    });
    const m = html.match(/<script>([\s\S]*)<\/script>/);
    assert.ok(m, 'report must contain an inline <script> block');
    const vm = require('node:vm');
    // 模板字符串转义/括号错误会让整个内联脚本在浏览器里 SyntaxError、页面白屏
    assert.doesNotThrow(() => new vm.Script(m[1]), 'inline script must parse');
  });

  it('HTML 风险筛选条在有 finding 时仍可解析', () => {
    const { baseGraph, headGraph, diff } = fixtureReport();
    const html = generateReport({
      baseGraph, headGraph, diff,
      findings: [{ rule: 'layer-skip', severity: 'high', title: 't', message: 'm', file: 'src/a.js', line: 1 }],
      repoName: 'demo', sessionStart: null
    });
    assert.match(html, /id="finding-filters"/);
    const m = html.match(/<script>([\s\S]*)<\/script>/);
    const vm = require('node:vm');
    assert.doesNotThrow(() => new vm.Script(m[1]), 'inline script must parse with findings');
  });
});

describe('B1-3 续: 风险引擎边契约（regression）', () => {
  const { evaluateRisk } = require('../lib/risk-rules');

  it('evaluateRisk 在含新增边的真实 diff 上不崩溃（裸边契约）', () => {
    const base = makeRepo({ 'a.py': 'class A:\n    pass\n' });
    const head = makeRepo({
      'a.py': 'class A:\n    pass\n',
      'b.py': 'from a import A\nclass B:\n    def go(self, a: A) -> None:\n        pass\n'
    });
    const bg = buildGraph(base);
    const hg = buildGraph(head);
    const d = diffGraphs(bg, hg);
    assert.ok(d.addedEdges.length > 0, 'fixture must produce added edges');
    // 旧实现用 e.edge.type 访问裸边，遇到新增边即 TypeError
    const findings = evaluateRisk(d, hg, bg);
    assert.ok(Array.isArray(findings));
  });

  it('孤立实体规则：无架构边的新 class 报 LOW，新 function 不报', () => {
    const base = makeRepo({ 'keep.py': 'class Keep:\n    pass\n' });
    const head = makeRepo({
      'keep.py': 'class Keep:\n    pass\n',
      'orphans.py': 'class Lonely:\n    pass\n\ndef helper():\n    pass\n'
    });
    const bg = buildGraph(base);
    const hg = buildGraph(head);
    const d = diffGraphs(bg, hg);
    const orphans = evaluateRisk(d, hg, bg).filter((f) => f.rule === 'orphan-entity');
    assert.ok(orphans.some((f) => /Lonely/.test(f.message)), 'unwired class should be flagged');
    assert.ok(!orphans.some((f) => /helper/.test(f.message)), 'bare function must not be flagged');
  });

  it('层级穿透：controller 直达 storage 产生 HIGH finding', () => {
    const headGraph = {
      nodes: [
        { id: 'cls:Ctl', name: 'Ctl', kind: 'class', layer: 'controller', path: 'ctl.py' },
        { id: 'cls:Repo', name: 'Repo', kind: 'class', layer: 'storage', path: 'repo.py' }
      ],
      edges: []
    };
    const baseGraph = { nodes: [], edges: [] };
    const diff = {
      addedNodes: [], removedNodes: [], modifiedNodes: [], renamedNodes: [],
      addedEdges: [{ from: 'cls:Ctl', to: 'cls:Repo', type: 'import', file: 'ctl.py', line: 1 }],
      removedEdges: [], addedTypes: [], removedTypes: [],
      addedPackages: [], removedPackages: [],
      addedExternalDeps: [], removedExternalDeps: [], violations: [], summary: {}
    };
    const findings = evaluateRisk(diff, headGraph, baseGraph);
    const skip = findings.find((f) => f.rule === 'layer-skip');
    assert.ok(skip, 'layer-skip finding expected');
    assert.equal(skip.severity, 'high');
  });
});

describe('guessLayer: 分层识别智能化', () => {
  it('database/ 内置正则识别为 storage', () => {
    const dir = makeRepo({
      'database/db.py': 'class DB:\n    pass\n'
    });
    const g = buildGraph(dir);
    const dbNode = g.nodes.find(n => n.path === 'database/db.py');
    assert.equal(dbNode.layer, 'storage');
  });

  it('.av/layers.json 项目级配置覆盖默认分层', () => {
    const dir = makeRepo({
      'mydata/store.py': 'class Store:\n    pass\n',
      'routes/handler.py': 'class Handler:\n    pass\n'
    });
    // mydata 不在内置正则中，用配置映射为 storage
    fs.mkdirSync(path.join(dir, '.av'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.av', 'layers.json'),
      JSON.stringify({ mydata: 'storage' }));

    const g = buildGraph(dir);
    const storeNode = g.nodes.find(n => n.path === 'mydata/store.py');
    assert.equal(storeNode.layer, 'storage');

    // routes 在内置正则中为 controller，不被配置覆盖
    const handlerNode = g.nodes.find(n => n.path === 'routes/handler.py');
    assert.equal(handlerNode.layer, 'controller');
  });

  it('.av/layers.json 配置优先于内置正则', () => {
    const dir = makeRepo({
      'tools/helper.py': 'class Helper:\n    pass\n'
    });
    // tools/helper.py 内置映射为 util，用户配置覆盖为 service
    fs.mkdirSync(path.join(dir, '.av'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.av', 'layers.json'),
      JSON.stringify({ tools: 'service' }));

    const g = buildGraph(dir);
    const node = g.nodes.find(n => n.path === 'tools/helper.py');
    assert.equal(node.layer, 'service');
  });

  it('无 .av/layers.json 时回退内置正则', () => {
    const dir = makeRepo({
      'services/svc.py': 'class Svc:\n    pass\n'
    });
    const g = buildGraph(dir);
    const node = g.nodes.find(n => n.path === 'services/svc.py');
    assert.equal(node.layer, 'service');
  });
});

describe('summary.changeScale vs 权威 risk.level', () => {
  it('storage→controller：changeScale 是规模启发式，risk.level 才是 findings 严重度', () => {
    const dir = makeRepo({
      'storage/repo.py': 'class Repo:\n    pass\n',
      'controller/api.py': 'class Api:\n    pass\n'
    });
    const base = buildGraph(dir);
    fs.writeFileSync(path.join(dir, 'storage/repo.py'), 'from controller import api\nclass Repo:\n    pass\n');
    const head = buildGraph(dir);
    const diff = diffGraphs(base, head);
    const findings = evaluateRisk(diff, head, base);
    const risk = summarizeFindings(findings);
    const report = buildReportData(base, head, diff, findings, null, 'audit', null);

    assert.equal(diff.summary.riskLevel, undefined, 'diff.summary 不得再叫 riskLevel');
    assert.equal(diff.summary.changeScale, 'medium', `violations*5 规模应为 medium，实际 ${diff.summary.changeScale}`);
    assert.equal(risk.level, 'high');
    assert.equal(report.risk.level, 'high');
    assert.equal(report.summary.changeScale, 'medium');
    assert.equal(report.summary.riskLevel, undefined);
    assert.ok(findings.some((f) => f.rule === 'cross-layer-violation' && f.severity === 'high'));
  });
});
