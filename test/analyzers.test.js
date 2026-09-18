'use strict';

// W16-03a: 分析器接口 + 内置适配器 + 合并器
//
// 验证：
// 1. 内置适配器输出与现有 buildGraph + evaluateRisk 一致
// 2. UIF 结构正确（sourceAnalyzer/confidence/evidence 齐全）
// 3. 合并器按 from+to+rule 去重，高 confidence 覆盖低 confidence
// 4. 现有调用链零行为变化

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { evaluateRisk, loadSessionRules } = require('../lib/risk-rules');
const { builtinAnalyzer, mergeResults, ANALYZER_IDS, CONFIDENCE } = require('../lib/analyzers');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(__dirname, '.av-analyzers-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

const FIXTURE = {
  'controller/orders.py': `
from service.order_svc import OrderService
class OrderController:
    def create(self, data):
        return OrderService().create(data)
`,
  'service/order_svc.py': `
from models.order import Order
from repository.order_repo import save
class OrderService:
    def create(self, data: Order) -> Order:
        return save(data)
`,
  'models/order.py': `
class Order:
    def total(self) -> float:
        return 0.0
`,
  'repository/order_repo.py': `
def save(entity):
    return entity
`
};

describe('W16-03a: Analyzer interface', () => {
  let dir;

  after(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('内置适配器 id/language/isAvailable 正确', () => {
    assert.equal(builtinAnalyzer.id, ANALYZER_IDS.BUILTIN);
    assert.deepEqual(builtinAnalyzer.languages, ['*']);
    assert.equal(builtinAnalyzer.isAvailable('/anywhere'), true);
  });

  it('内置适配器 analyze 输出 UIF 结构完整', () => {
    dir = makeRepo(FIXTURE);
    const result = builtinAnalyzer.analyze(dir);

    assert.equal(result.sourceAnalyzer, 'builtin');
    assert.equal(result.confidence, CONFIDENCE.MEDIUM);
    assert.ok(Array.isArray(result.nodes));
    assert.ok(result.nodes.length > 0);
    assert.ok(Array.isArray(result.edges));
    assert.ok(result.edges.length > 0);
    assert.ok(Array.isArray(result.violations));
    assert.ok(result.evidence);
    assert.equal(result.evidence.sourceAnalyzer, 'builtin');
    assert.ok(result.evidence.version, 'evidence 应有 version');
  });

  it('内置适配器输出 nodes/edges 与 buildGraph 一致', () => {
    // builtin 适配器快照固定带 call 边（buildGraph(repo, { calls: true })），比对需同口径
    const graph = buildGraph(dir, { calls: true });
    const result = builtinAnalyzer.analyze(dir);

    assert.equal(result.nodes.length, graph.nodes.length);
    assert.equal(result.edges.length, graph.edges.length);
    // spot-check: node ids match
    const graphIds = new Set(graph.nodes.map((n) => n.id));
    for (const n of result.nodes) {
      assert.ok(graphIds.has(n.id), `node ${n.id} 应在 buildGraph 输出中`);
    }
  });

  it('内置适配器在无基线时 violations 为空（全量模式无 diff）', () => {
    const result = builtinAnalyzer.analyze(dir);
    assert.equal(result.violations.length, 0, '无 diff 时不应有 violations');
  });

  it('内置适配器传入 baseline+diff 时输出 violations 与 evaluateRisk 一致', () => {
    // 先拍基线
    const baseline = { ...buildGraph(dir), sessionStartedAt: new Date().toISOString() };
    fs.mkdirSync(path.join(dir, '.av'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.av', 'graph-baseline.json'), JSON.stringify(baseline));

    // 改坏：controller 直接 import repository（层级穿透）
    fs.writeFileSync(path.join(dir, 'controller', 'orders.py'),
      'from repository.order_repo import save\n' +
      'class OrderController:\n' +
      '    def create(self, data):\n' +
      '        return save(data)\n');

    const current = buildGraph(dir);
    const diff = diffGraphs(baseline, current);

    // 直接调 evaluateRisk
    const directFindings = evaluateRisk(diff, current, baseline, null, { rules: null });

    // 通过适配器调
    const result = builtinAnalyzer.analyze(dir, { baseline, diff, impact: null });

    assert.equal(result.violations.length, directFindings.length,
      '适配器 violations 数量应与直接调用一致');
    // 每条 violation 应有 sourceAnalyzer 和 confidence
    for (const v of result.violations) {
      assert.equal(v.sourceAnalyzer, 'builtin');
      assert.equal(v.confidence, CONFIDENCE.MEDIUM);
      assert.ok(v.rule, 'violation 应有 rule');
      assert.ok(v.severity, 'violation 应有 severity');
    }
    // rule 集合应一致
    const directRules = new Set(directFindings.map((f) => f.rule));
    const adapterRules = new Set(result.violations.map((v) => v.rule));
    assert.deepEqual(directRules, adapterRules);
  });
});

describe('W16-03a: mergeResults', () => {
  it('does not introduce undefined location fields or secondary sources during normalization', () => {
    const { normalizeResults } = require('../lib/analyzers/merge');
    const repo = path.resolve(__dirname, 'identity-repo');
    const finding = { rule: 'analyzer-error', severity: 'high', message: 'Failed' };
    const input = { sourceAnalyzer: 'test', nodes: [], edges: [], violations: [finding] };
    const normalized = normalizeResults([input], repo);
    assert.deepEqual(normalized[0].violations[0], finding);
    assert.deepEqual(normalized[0].violations, JSON.parse(JSON.stringify(normalized[0].violations)));
    const merged = mergeResults([
      { sourceAnalyzer: 'test', violations: [{ rule: 'layer-skip', from: 'a', to: 'b', confidence: 'low' }] },
      { sourceAnalyzer: 'test', violations: [{ rule: 'layer-skip', from: 'a', to: 'b', confidence: 'high' }, finding] }
    ], { repo });
    assert.deepEqual(merged.violations, JSON.parse(JSON.stringify(merged.violations)));
  });

  it('never executes unconfigured tools during PATH discovery or analysis', () => {
    // External CLI adapters were removed; PATH tools must not be consulted.
    const repo = makeRepo({});
    const originalPath = process.env.PATH;
    try {
      const bin = path.join(repo, 'bin');
      fs.mkdirSync(bin);
      for (const name of ['depcruise', 'lint-imports']) {
        const executable = path.join(bin, name);
        fs.writeFileSync(executable, `#!/bin/sh\nprintf called > '${path.join(repo, 'executed')}'\n`);
        fs.chmodSync(executable, 0o755);
      }
      process.env.PATH = bin;
      const { sources } = require('../lib/analyzers').runAnalyzers(repo);
      assert.equal(sources.length, 1);
      assert.equal(sources[0].id, 'builtin');
      assert.equal(fs.existsSync(path.join(repo, 'executed')), false);
    } finally {
      process.env.PATH = originalPath;
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('retains builtin graph IDs and file paths while comparing normalized graph identities', () => {
    const repo = path.resolve(__dirname, 'identity-repo');
    const from = `file:${repo}/src/a.js`;
    const to = `file:${repo}/src/b.js`;
    const nodes = [
      { id: from, kind: 'file', path: `${repo}/src/a.js` },
      { id: to, kind: 'file', path: `${repo}/src/b.js` }
    ];
    const builtin = { sourceAnalyzer: 'builtin', nodes, edges: [], violations: [] };
    const external = {
      sourceAnalyzer: 'dependency-cruiser',
      nodes: [{ id: 'file:src/a.js', kind: 'file', path: 'src/a.js' }, { id: 'file:src/b.js', kind: 'file', path: 'src/b.js' }],
      edges: [{ from: 'file:src/a.js', to: 'file:src/b.js', type: 'import' }],
      violations: []
    };
    const merged = mergeResults([builtin, external], { repo });
    assert.deepEqual(merged.nodes, nodes);
    assert.equal(merged.edges[0].from, from);
    assert.equal(merged.edges[0].to, to);
    assert.deepEqual(mergeResults([builtin], { repo }).nodes, nodes);
  });
  it('normalizes Windows absolute and relative diff paths using the same repository root', () => {
    const { normalizeFilePath, changedFilesFromDiff } = require('../lib/analyzers/paths');
    assert.equal(normalizeFilePath('C:\\repo\\src\\a.js', 'C:\\repo'), 'src/a.js');
    assert.equal(normalizeFilePath('.\\src\\a.js', 'C:\\repo'), 'src/a.js');
    const changed = changedFilesFromDiff({ addedEdges: [{ from: 'file:C:\\repo\\src\\a.js', to: 'type:Thing' }] }, 'C:\\repo');
    assert.deepEqual([...changed], ['src/a.js']);
  });
  it('normalizes equivalent rule/path identities and retains every evidence source', () => {
    const repo = path.resolve(__dirname, 'identity-repo');
    const result = (sourceAnalyzer, confidence, from, to) => ({
      sourceAnalyzer, confidence, nodes: [], edges: [],
      violations: [{ sourceAnalyzer, confidence, rule: 'layer-skip', severity: 'high', from, to }],
      evidence: { sourceAnalyzer }
    });
    const merged = mergeResults([
      result('builtin', 'medium', 'file:src/a.js', 'file:src/b.js'),
      result('dependency-cruiser', 'high', path.join(repo, 'src/a.js'), path.join(repo, 'src/b.js')),
      result('third', 'low', '.\\src\\a.js', 'src\\b.js')
    ], { repo });
    assert.equal(merged.violations.length, 1);
    assert.deepEqual(merged.violations[0].secondarySources.sort(), ['builtin', 'third']);
  });

  it('does not collapse distinct native contracts, rule identities, edge types or unknown locations', () => {
    const result = (sourceAnalyzer, violations) => ({ sourceAnalyzer, confidence: 'high', nodes: [], edges: [], violations });
    const native = { rule: 'import-linter-contract', from: 'pkg/a.py', to: 'pkg/b.py', severity: 'high' };
    const merged = mergeResults([
      result('import-linter', [
        { ...native, importLinterContract: 'First' },
        { ...native, importLinterContract: 'Second' },
        { ...native, from: null, to: null },
        { ...native, from: null, to: null }
      ]),
      result('builtin', [{ rule: 'layer-skip', from: 'a', to: 'b', edgeType: 'import' }]),
      result('dependency-cruiser', [
        { rule: 'layer-skip', ruleIdentity: 'dependency-cruiser:layer-skip', from: 'a', to: 'b' },
        { rule: 'layer-skip', from: 'a', to: 'b', edgeType: 'field-type' }
      ])
    ]);
    assert.equal(merged.violations.length, 7);
  });

  it('does not collapse distinct type nodes just because they share a source file', () => {
    const repo = path.resolve(__dirname, 'identity-repo');
    const merged = mergeResults([
      {
        sourceAnalyzer: 'builtin', nodes: [
          { id: 'type:A', kind: 'class', path: 'src/a.py' },
          { id: 'type:B', kind: 'class', path: 'src/a.py' }
        ],
        violations: [
          { rule: 'layer-skip', from: 'type:A', to: 'type:C' },
          { rule: 'layer-skip', from: 'type:B', to: 'type:C' }
        ]
      },
      { sourceAnalyzer: 'dependency-cruiser', violations: [{ rule: 'layer-skip', from: 'src/a.py', to: 'src/c.py' }] }
    ], { repo });
    assert.equal(merged.violations.length, 3);
  });
  it('空数组返回低 confidence 空 UIF', () => {
    const merged = mergeResults([]);
    assert.equal(merged.sourceAnalyzer, 'merged');
    assert.equal(merged.confidence, 'low');
    assert.equal(merged.nodes.length, 0);
    assert.equal(merged.violations.length, 0);
  });

  it('单条直接透传', () => {
    const single = {
      sourceAnalyzer: 'builtin',
      confidence: 'medium',
      nodes: [{ id: 'a' }],
      edges: [{ from: 'a', to: 'b', type: 'import' }],
      violations: [{ rule: 'layer-skip', severity: 'high', from: 'a', to: 'b' }],
      evidence: { sourceAnalyzer: 'builtin' }
    };
    const merged = mergeResults([single]);
    assert.equal(merged.nodes.length, 1);
    assert.equal(merged.violations.length, 1);
    assert.equal(merged.confidence, 'medium');
  });

  it('多条合并去重：相同 from+to+rule 只保留一条', () => {
    const builtinResult = {
      sourceAnalyzer: 'builtin',
      confidence: 'medium',
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [{ from: 'a', to: 'b', type: 'import' }],
      violations: [
        { rule: 'layer-skip', severity: 'high', from: 'a', to: 'b', confidence: 'medium', sourceAnalyzer: 'builtin' },
        { rule: 'circular-import', severity: 'medium', from: 'c', to: 'd', confidence: 'medium', sourceAnalyzer: 'builtin' }
      ],
      evidence: { sourceAnalyzer: 'builtin' }
    };
    const depcruiseResult = {
      sourceAnalyzer: 'dependency-cruiser',
      confidence: 'high',
      nodes: [{ id: 'a' }, { id: 'c' }],  // 'a' 重复，'c' 新增
      edges: [{ from: 'a', to: 'b', type: 'import' }],  // 重复
      violations: [
        { rule: 'layer-skip', severity: 'high', from: 'a', to: 'b', confidence: 'high', sourceAnalyzer: 'dependency-cruiser' },
        { rule: 'no-unused', severity: 'low', from: 'e', to: 'f', confidence: 'high', sourceAnalyzer: 'dependency-cruiser' }
      ],
      evidence: { sourceAnalyzer: 'dependency-cruiser' }
    };

    const merged = mergeResults([builtinResult, depcruiseResult]);

    // nodes: a, b, c = 3 (a deduped)
    assert.equal(merged.nodes.length, 3);
    // edges: 1 (deduped)
    assert.equal(merged.edges.length, 1);
    // violations: layer-skip (deduped, high wins) + circular-import + no-unused = 3
    assert.equal(merged.violations.length, 3);
    // merged confidence is 'high' because depcruise was 'high'
    assert.equal(merged.confidence, 'high');
    // evidence has both sources
    assert.equal(merged.evidence.sources.length, 2);

    // layer-skip: high confidence should have won, builtin as secondarySource
    const layerSkip = merged.violations.find((v) => v.rule === 'layer-skip');
    assert.equal(layerSkip.sourceAnalyzer, 'dependency-cruiser');
    assert.equal(layerSkip.secondarySource, 'builtin');
  });

  it('violations 按 severity 降序排列', () => {
    const results = [{
      sourceAnalyzer: 'test',
      confidence: 'low',
      nodes: [],
      edges: [],
      violations: [
        { rule: 'r-low', severity: 'low', from: 'a', to: 'b', confidence: 'low', sourceAnalyzer: 'test' },
        { rule: 'r-high', severity: 'high', from: 'c', to: 'd', confidence: 'low', sourceAnalyzer: 'test' },
        { rule: 'r-med', severity: 'medium', from: 'e', to: 'f', confidence: 'low', sourceAnalyzer: 'test' }
      ],
      evidence: null
    }];
    const merged = mergeResults(results);
    assert.equal(merged.violations[0].rule, 'r-high');
    assert.equal(merged.violations[1].rule, 'r-med');
    assert.equal(merged.violations[2].rule, 'r-low');
  });

  it('W16-03 验收: 同一循环依赖被 builtin 和 depcruise 报告时合并为一条多来源记录', () => {
    // Simulate the exact scenario from the audit: builtin detects a↔b cycle,
    // depcruise detects the same ring from the opposite edge with absolute paths.
    const repo = '/repo';
    const nodes = ['a', 'b'].map((name) => ({
      id: `file:src/${name}.js`, kind: 'file', name, path: `src/${name}.js`
    }));
    const ab = { from: nodes[0].id, to: nodes[1].id, type: 'import', file: 'src/a.js', line: 1 };
    const ba = { from: nodes[1].id, to: nodes[0].id, type: 'import', file: 'src/b.js', line: 1 };

    // Builtin finding (relative paths, medium confidence)
    const builtinViolation = {
      rule: 'circular-import',
      severity: 'high',
      title: '循环依赖（双向 import）',
      file: 'src/b.js',
      line: 1,
      from: undefined,
      to: undefined,
      edgeType: 'import',
      sourceAnalyzer: 'builtin',
      confidence: 'medium',
      cycleMembers: ['src/b.js', 'src/a.js']
    };

    // Depcruise finding (absolute paths, high confidence, opposite edge direction)
    const path = require('path');
    const depcruiseViolation = {
      rule: 'circular-import',
      ruleIdentity: 'circular-import',
      severity: 'high',
      title: '循环依赖',
      file: path.join(repo, 'src/b.js'),
      from: path.join(repo, 'src/b.js'),
      to: path.join(repo, 'src/a.js'),
      edgeType: 'import',
      sourceAnalyzer: 'dependency-cruiser',
      confidence: 'high',
      cycleMembers: ['src/b.js', 'src/a.js', 'src/b.js'] // depcruise repeats first at end
    };

    const merged = mergeResults([
      { sourceAnalyzer: 'builtin', confidence: 'medium', nodes, edges: [ab, ba], violations: [builtinViolation] },
      { sourceAnalyzer: 'dependency-cruiser', confidence: 'high', nodes: [], edges: [], violations: [depcruiseViolation] }
    ], { repo });

    // Core assertion: ONE finding, not two
    assert.equal(merged.violations.length, 1, '同一循环依赖必须合并为一条记录');
    const v = merged.violations[0];
    assert.equal(v.rule, 'circular-import');
    // Higher confidence (depcruise) wins as primary
    assert.equal(v.sourceAnalyzer, 'dependency-cruiser');
    assert.equal(v.confidence, 'high');
    // Builtin preserved as secondary source
    assert.ok(v.secondarySources?.includes('builtin'), 'builtin 应作为副来源保留');
  });

  it('W16-03 验收: 不同循环（不同文件集）不合并', () => {
    const repo = '/repo';
    const cycle1 = {
      rule: 'circular-import', ruleIdentity: 'circular-import', severity: 'high',
      from: '/repo/src/a.js', to: '/repo/src/b.js', edgeType: 'import',
      sourceAnalyzer: 'dependency-cruiser', confidence: 'high',
      cycleMembers: ['src/a.js', 'src/b.js']
    };
    const cycle2 = {
      rule: 'circular-import', ruleIdentity: 'circular-import', severity: 'high',
      from: '/repo/src/c.js', to: '/repo/src/d.js', edgeType: 'import',
      sourceAnalyzer: 'dependency-cruiser', confidence: 'high',
      cycleMembers: ['src/c.js', 'src/d.js']
    };
    const merged = mergeResults([
      { sourceAnalyzer: 'dependency-cruiser', confidence: 'high', nodes: [], edges: [], violations: [cycle1, cycle2] }
    ], { repo });
    assert.equal(merged.violations.length, 2, '不同文件集的循环不应合并');
  });

  it('W16-03 验收: 跳层违规被 builtin 和 depcruise 报告时合并为一条多来源记录', () => {
    // Same scenario as the user-reported red-light snapshot:
    // builtin detects "controller → storage skipping service",
    // depcruise detects the same edge via av-no-controller-to-storage rule.
    // They must merge into 1 HIGH finding with 2 analyzer sources.
    const repo = '/repo';
    const path = require('path');
    const fromId = 'file:src/controller/orders.js';
    const toId = 'file:src/repository/orderRepo.js';

    const builtin = {
      rule: 'layer-skip', severity: 'high', title: '层级穿透',
      message: '控制器直接访问存储，跳过了服务层',
      file: 'src/controller/orders.js', from: fromId, to: toId,
      edgeType: 'import', fromLayer: 'controller', toLayer: 'storage',
      sourceAnalyzer: 'builtin', confidence: 'medium'
    };
    const depcruise = {
      rule: 'layer-skip', ruleIdentity: 'layer-skip', severity: 'high',
      title: '层级穿透', message: 'Controller must not directly import storage',
      file: path.join(repo, 'src/controller/orders.js'),
      from: path.join(repo, 'src/controller/orders.js'),
      to: path.join(repo, 'src/repository/orderRepo.js'),
      fromLayer: 'controller', toLayer: 'storage',
      edgeType: 'import', sourceAnalyzer: 'dependency-cruiser', confidence: 'high',
      depcruiseRuleName: 'av-no-controller-to-storage'
    };

    const merged = mergeResults([
      { sourceAnalyzer: 'builtin', confidence: 'medium', nodes: [], edges: [], violations: [builtin] },
      { sourceAnalyzer: 'dependency-cruiser', confidence: 'high', nodes: [], edges: [], violations: [depcruise] }
    ], { repo });

    assert.equal(merged.violations.length, 1, '同一跳层违规必须合并为一条记录');
    const v = merged.violations[0];
    assert.equal(v.rule, 'layer-skip');
    assert.equal(v.severity, 'high', '风险等级是 HIGH（不是置信度 medium）');
    // depcruise (high confidence) wins as primary
    assert.equal(v.sourceAnalyzer, 'dependency-cruiser');
    assert.equal(v.confidence, 'high');
    // builtin preserved as secondary
    assert.ok(v.secondarySources?.includes('builtin'), 'builtin 应作为副来源保留');
    // Layer labels preserved
    assert.equal(v.fromLayer, 'controller');
    assert.equal(v.toLayer, 'storage');
  });

  it('W16-03 验收: 三分析器（builtin + depcruise + importlinter）报同一跳层合并为一条', () => {
    const repo = '/repo';
    const path = require('path');
    const fromId = 'file:src/controller/orders.ts';
    const toId = 'file:src/repository/orderRepo.ts';

    const builtin = {
      rule: 'layer-skip', severity: 'high', title: '层级穿透',
      file: 'src/controller/orders.ts', from: fromId, to: toId,
      edgeType: 'import', fromLayer: 'controller', toLayer: 'storage',
      sourceAnalyzer: 'builtin', confidence: 'medium'
    };
    const depcruise = {
      rule: 'layer-skip', ruleIdentity: 'layer-skip', severity: 'high',
      file: path.join(repo, 'src/controller/orders.ts'),
      from: path.join(repo, 'src/controller/orders.ts'),
      to: path.join(repo, 'src/repository/orderRepo.ts'),
      fromLayer: 'controller', toLayer: 'storage',
      edgeType: 'import', sourceAnalyzer: 'dependency-cruiser', confidence: 'high',
      depcruiseRuleName: 'av-no-controller-to-storage'
    };
    const importlinter = {
      rule: 'layer-skip', ruleIdentity: 'layer-skip', severity: 'high',
      file: path.join(repo, 'src/controller/orders.ts'),
      from: path.join(repo, 'src/controller/orders.ts'),
      to: path.join(repo, 'src/repository/orderRepo.ts'),
      fromLayer: 'controller', toLayer: 'storage',
      edgeType: 'import', sourceAnalyzer: 'import-linter', confidence: 'high',
      importLinterType: 'forbidden'
    };

    const merged = mergeResults([
      { sourceAnalyzer: 'builtin', confidence: 'medium', nodes: [], edges: [], violations: [builtin] },
      { sourceAnalyzer: 'dependency-cruiser', confidence: 'high', nodes: [], edges: [], violations: [depcruise] },
      { sourceAnalyzer: 'import-linter', confidence: 'high', nodes: [], edges: [], violations: [importlinter] }
    ], { repo });

    assert.equal(merged.violations.length, 1, '三分析器同一跳层必须合并为一条');
    const v = merged.violations[0];
    assert.equal(v.rule, 'layer-skip');
    assert.equal(v.severity, 'high');
    assert.ok(v.secondarySources?.includes('builtin'), 'builtin 应作为副来源');
    assert.ok(v.secondarySources?.includes('import-linter'), 'import-linter 应作为副来源');
  });

  it('W16-03 验收: depcruise 用户自定义规则不映射为 layer-skip', () => {
    // A user-defined depcruise rule (not av-no-*) should NOT merge with builtin layer-skip
    const repo = '/repo';
    const path = require('path');
    const builtin = {
      rule: 'layer-skip', severity: 'high',
      file: 'src/a.js', from: 'file:src/a.js', to: 'file:src/b.js',
      edgeType: 'import', fromLayer: 'controller', toLayer: 'storage',
      sourceAnalyzer: 'builtin', confidence: 'medium'
    };
    const userRule = {
      rule: 'team-boundary', ruleIdentity: 'dependency-cruiser:team-boundary', severity: 'high',
      file: path.join(repo, 'src/a.js'),
      from: path.join(repo, 'src/a.js'), to: path.join(repo, 'src/b.js'),
      edgeType: 'import', sourceAnalyzer: 'dependency-cruiser', confidence: 'high',
      depcruiseRuleName: 'team-boundary'
    };
    const merged = mergeResults([
      { sourceAnalyzer: 'builtin', confidence: 'medium', nodes: [], edges: [], violations: [builtin] },
      { sourceAnalyzer: 'dependency-cruiser', confidence: 'high', nodes: [], edges: [], violations: [userRule] }
    ], { repo });
    assert.equal(merged.violations.length, 2, '用户自定义规则不应与 layer-skip 合并');
  });

  it('W16-03 验收: cross-layer-violation 被 builtin 和 import-linter 报告时合并为一条（元数据不拆分去重键）', () => {
    // Reproduces the user-audited gap: builtin reports cross-layer-violation
    // with node-ID endpoints; import-linter reports the same rule + endpoints
    // but adds importLinterContract and importChain metadata. The extra metadata
    // must NOT split the dedup key — they are supplementary, not identity-defining.
    const repo = '/repo';
    const shared = {
      rule: 'cross-layer-violation', severity: 'high',
      from: 'file:src/a.js', to: 'file:src/b.js', edgeType: 'import'
    };
    const merged = mergeResults([
      { sourceAnalyzer: 'builtin', confidence: 'medium', nodes: [], edges: [],
        violations: [{ ...shared, sourceAnalyzer: 'builtin', confidence: 'medium' }] },
      { sourceAnalyzer: 'import-linter', confidence: 'high', nodes: [], edges: [],
        violations: [{ ...shared, ruleIdentity: 'cross-layer-violation',
          sourceAnalyzer: 'import-linter', confidence: 'high',
          importLinterContract: 'Layered architecture', importChain: ['src.a', 'src.b'] }] }
    ], { repo });

    assert.equal(merged.violations.length, 1, '同规则同端点的 cross-layer-violation 必须合并为一条');
    const v = merged.violations[0];
    assert.equal(v.rule, 'cross-layer-violation');
    assert.equal(v.severity, 'high');
    assert.equal(v.sourceAnalyzer, 'import-linter', '高置信分析器为主来源');
    assert.ok(v.secondarySources?.includes('builtin'), 'builtin 作为副来源');
    assert.equal(v.importLinterContract, 'Layered architecture', 'Import Linter 契约名保留');
    assert.deepEqual(v.importChain, ['src.a', 'src.b'], '导入链保留');
  });
});
