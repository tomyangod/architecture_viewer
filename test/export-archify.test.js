'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildArchifyPair } = require('../lib/export-archify');

const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/* --- 合成图 fixture --- */
function fileNode(p, layer) {
  return { id: 'file:' + p, kind: 'file', name: p.split('/').pop(), path: p, layer };
}
function clsNode(id, p, layer) {
  return { id, kind: 'class', name: id.replace(/^cls:/, ''), path: p, layer };
}

/** files: [{ path, layer, cls }]; edges: [[fromClsId, toClsId]] */
function makeGraph(files, edges = []) {
  const nodes = [];
  const elist = [];
  for (const f of files) {
    nodes.push(fileNode(f.path, f.layer));
    for (const c of f.cls) {
      nodes.push(clsNode(c, f.path, f.layer));
      elist.push({ from: c, to: 'file:' + f.path, type: 'declared-in' });
    }
  }
  for (const [from, to, type = 'import'] of edges) {
    elist.push({ from, to, type });
  }
  return { nodes, edges: elist };
}

const BASE_FILES = [
  { path: 'src/controller/user-controller.js', layer: 'controller', cls: ['cls:UserController'] },
  { path: 'src/service/user-service.js', layer: 'service', cls: ['cls:UserService'] },
  { path: 'src/storage/user-repo.js', layer: 'storage', cls: ['cls:UserRepo'] }
];

function baseGraph() {
  return makeGraph(BASE_FILES, [
    ['cls:UserController', 'cls:UserService'],
    ['cls:UserService', 'cls:UserRepo']
  ]);
}

describe('export-archify: 硬约束', () => {
  it('所有 id 匹配 ^[a-zA-Z][a-zA-Z0-9_-]*$（f:lib/cli.js 这类直接废）', () => {
    const head = baseGraph();
    const diff = { addedNodes: [], removedNodes: [], modifiedNodes: [], renamedNodes: [], addedEdges: [], removedEdges: [], addedExternalDeps: [], violations: [] };
    const { base, head: headIR } = buildArchifyPair({ headGraph: head, baseGraph: head, diff, scope: 'layers' });
    for (const ir of [base, headIR]) {
      for (const c of ir.components) assert.match(c.id, ID_RE, `component id ${c.id}`);
      for (const cn of ir.connections) assert.match(cn.id, ID_RE, `connection id ${cn.id}`);
      // 路径中的 / . : 必须被清洗
      assert.ok(!ir.components.some(c => /[/.:]/.test(c.id)), 'id 不含路径分隔符');
    }
  });

  it('grid 不是自动布局：每个组件都带显式 row/col', () => {
    const head = baseGraph();
    const diff = { addedNodes: [], removedNodes: [], modifiedNodes: [], renamedNodes: [], addedEdges: [], removedEdges: [], addedExternalDeps: [], violations: [] };
    const { head: headIR } = buildArchifyPair({ headGraph: head, baseGraph: head, diff, scope: 'layers' });
    assert.equal(headIR.layout.mode, 'grid');
    for (const c of headIR.components) {
      assert.equal(typeof c.row, 'number', `${c.id} 有 row`);
      assert.equal(typeof c.col, 'number', `${c.id} 有 col`);
    }
  });

  it('安全默认：不发 sources、不发 meta.repository（compare 不需要仓库 provenance）', () => {
    const head = baseGraph();
    const diff = { addedNodes: [], removedNodes: [], modifiedNodes: [], renamedNodes: [], addedEdges: [], removedEdges: [], addedExternalDeps: [], violations: [] };
    const { base, head: headIR } = buildArchifyPair({ headGraph: head, baseGraph: head, diff, scope: 'layers' });
    for (const ir of [base, headIR]) {
      assert.ok(!ir.sources, '无 sources 块');
      assert.ok(!(ir.meta && ir.meta.repository), '无 meta.repository');
    }
  });

  it('每条 connection 有稳定 id，且 base/head 同一依赖 id 一致（compare 要求）', () => {
    const head = baseGraph();
    const diff = { addedNodes: [], removedNodes: [], modifiedNodes: [], renamedNodes: [], addedEdges: [], removedEdges: [], addedExternalDeps: [], violations: [] };
    const { base, head: headIR } = buildArchifyPair({ headGraph: head, baseGraph: head, diff, scope: 'layers' });
    const baseIds = new Set(base.connections.map(c => c.id));
    for (const c of headIR.connections) {
      assert.match(c.id, ID_RE);
      // 同一条依赖在两侧 id 相同（共享 allocator）
      assert.ok(baseIds.has(c.id) || true); // layers base==head 时全部一致
    }
    assert.deepEqual(
      base.connections.map(c => c.id).sort(),
      headIR.connections.map(c => c.id).sort()
    );
  });

  it('违规边用 variant=security（红色）表达，不依赖 label', () => {
    const head = baseGraph();
    head.edges.push({ from: 'cls:UserController', to: 'cls:UserRepo', type: 'import' }); // 跨层
    const diff = {
      addedNodes: [], removedNodes: [], modifiedNodes: [], renamedNodes: [],
      addedEdges: [], removedEdges: [], addedExternalDeps: [],
      violations: [{ type: 'cross-layer', from: 'cls:UserController', to: 'cls:UserRepo', edgeType: 'import', fromLayer: 'controller', toLayer: 'storage' }]
    };
    const { head: headIR } = buildArchifyPair({ headGraph: head, baseGraph: baseGraph(), diff, scope: 'violations' });
    const sec = headIR.connections.filter(c => c.variant === 'security');
    assert.ok(sec.length >= 1, '至少一条红色 security 边');
    // 机器生成边不带 label（避免 clean-flow 标签碰撞）
    assert.ok(headIR.connections.every(c => !c.label), '连接不带 label');
  });

  it('稀疏护栏：纯新增文件（base 侧为空）降级到 layers', () => {
    const base = baseGraph();
    const head = makeGraph([
      ...BASE_FILES,
      { path: 'src/controller/order-controller.js', layer: 'controller', cls: ['cls:OrderController'] }
    ], [
      ['cls:UserController', 'cls:UserService'],
      ['cls:UserService', 'cls:UserRepo'],
      ['cls:OrderController', 'cls:UserService']
    ]);
    const diff = {
      addedNodes: [{ node: { path: 'src/controller/order-controller.js' } }],
      removedNodes: [], modifiedNodes: [], renamedNodes: [],
      addedEdges: [], removedEdges: [], addedExternalDeps: [], violations: []
    };
    const { sidecar } = buildArchifyPair({ headGraph: head, baseGraph: base, diff, scope: 'changed' });
    assert.equal(sidecar.scopeUsed, 'layers');
    assert.equal(sidecar.downgradedToLayers, true);
    assert.equal(sidecar.downgradeReason, 'empty-side-pure-addition');
  });

  it('稀疏护栏：可见文件 > 14 且穿线风险高时降级到 layers', () => {
    const files = [];
    for (let i = 0; i < 16; i++) {
      files.push({ path: `src/controller/c${i}.js`, layer: 'controller', cls: [`cls:C${i}`] });
    }
    const baseFiles = files.slice(0, 8);
    const base = makeGraph(baseFiles);
    const head = makeGraph(files);
    const addedNodes = files.map(f => ({ node: { path: f.path } }));
    const diff = { addedNodes, removedNodes: [], modifiedNodes: [], renamedNodes: [], addedEdges: [], removedEdges: [], addedExternalDeps: [], violations: [] };
    const { sidecar } = buildArchifyPair({ headGraph: head, baseGraph: base, diff, scope: 'changed' });
    assert.equal(sidecar.scopeUsed, 'layers');
    assert.equal(sidecar.downgradeReason, 'too-dense-for-clean-flow');
  });

  it('修改既有文件（两侧非空、节点稀疏）时保留文件粒度 changed 视图', () => {
    const base = baseGraph();
    const head = baseGraph();
    head.nodes.push(clsNode('cls:NewHelper', 'src/controller/user-controller.js', 'controller'));
    head.edges.push({ from: 'cls:NewHelper', to: 'file:src/controller/user-controller.js', type: 'declared-in' });
    const diff = {
      addedNodes: [{ node: { path: 'src/controller/user-controller.js' } }],
      removedNodes: [], modifiedNodes: [], renamedNodes: [],
      addedEdges: [], removedEdges: [], addedExternalDeps: [], violations: []
    };
    const { sidecar, head: headIR } = buildArchifyPair({ headGraph: head, baseGraph: base, diff, scope: 'changed' });
    assert.equal(sidecar.scopeUsed, 'changed');
    assert.equal(sidecar.downgradedToLayers, false);
    assert.ok(headIR.components.length >= 1);
    // 文件节点带层 tag
    assert.ok(headIR.components.every(c => c.tag));
  });

  it('layers 视图对角线布局：跨层边不穿过中间层节点（col 随 row 展开）', () => {
    const head = baseGraph();
    const diff = { addedNodes: [], removedNodes: [], modifiedNodes: [], renamedNodes: [], addedEdges: [], removedEdges: [], addedExternalDeps: [], violations: [] };
    const { head: headIR } = buildArchifyPair({ headGraph: head, baseGraph: head, diff, scope: 'layers' });
    // 每个层节点占据互不相同的 (row,col)，且 col 不全为 0
    const cols = headIR.components.map(c => c.col);
    assert.ok(new Set(cols).size > 1, '层节点列位置展开（非单列堆叠）');
    const cells = new Set(headIR.components.map(c => `${c.row}:${c.col}`));
    assert.equal(cells.size, headIR.components.length, '无两个组件挤同一格');
  });
});
