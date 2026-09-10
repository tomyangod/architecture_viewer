'use strict';

/**
 * Risk rules engine for architecture session reports.
 * Evaluates a diff result against a set of architectural rules
 * and produces findings with severity levels.
 */

const { applyIntentAlignment } = require('./session-intent');
const { applyImplChanged } = require('./impl-surface');
const { CALL_EDGE, UNRESOLVED_EDGE } = require('./extract/call-graph');
const { argsCompatible, methodSigByName } = require('./extract/signature');
const { productionTargetsWithTestChanges, relatedTestsForPath } = require('./extract/test-index');
const { formatBehaviorSymbol } = require('./extract/behavior-fingerprint');

const SEVERITY = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low', INFO: 'info' };

// Architectural wiring edges (must match session-report ARCH_EDGE_TYPES).
// Containment edges (declared-in/defined-in) link an entity to its file and
// must not count as "being wired into the architecture".
const WIRING_EDGE_TYPES = ['import', 'extends', 'implements', 'field-type', 'method-param', 'method-return', 'component-props', 'di-registered'];

// Kinds whose architecture wiring is captured by extractors. Bare functions
// now have call edges (W19), but orphan detection on functions is still
// noisy (many entrypoints look unwired).
const ORPHAN_CHECK_KINDS = ['class', 'interface', 'enum', 'record', 'annotation', 'type_alias', 'component'];

// B4 影响面驱动的风险分级阈值：被改实体波及的下游数量达到阈值时升级严重度。
// broad-impact 规则：≥10 直接+间接下游 → MEDIUM，≥20 → HIGH。
const BROAD_IMPACT_THRESHOLD = 10;
const BROAD_IMPACT_HIGH = 20;
// 降级阈值：波动 <3 且无其他高风险 finding 时，removed-type 可从 MEDIUM 降为 LOW。
const LOW_IMPACT_REMOVED_THRESHOLD = 3;

// W14-04 循环依赖：单次报告最多报几个环，避免刷屏。
const CYCLE_FINDING_CAP = 5;

// entrypoint ranks with controller so CLI/scripts → service is allowed.
const LAYER_RANK = { domain: 0, util: 0, dto: 1, storage: 1, config: 2, service: 3, controller: 4, entrypoint: 4, component: 5 };
const LAYER_LABEL = {
  component: '组件', controller: '控制器', entrypoint: '入口', service: '服务',
  domain: '领域', storage: '存储', dto: 'DTO', config: '配置', util: '工具'
};

/**
 * Apply team architecture-rules.yaml `forbid_cross_layer` to **code graph**
 * edges (session gate). C4 naming / Rel whitelist stay in lib/rules.js (check).
 * Incremental only: inspects this-session added wiring edges.
 * @param {Array} findings
 * @param {object} diff
 * @param {Map} headNodes
 * @param {object} rules - normalized rules from loadRules()
 */
function applyTeamForbidCrossLayer(findings, diff, headNodes, rules) {
  const forbids = (rules && rules.forbid_cross_layer) || [];
  if (!forbids.length) return;
  const archEdges = (diff.addedEdges || []).filter((e) => WIRING_EDGE_TYPES.includes(e.type));
  for (const edge of archEdges) {
    const from = headNodes.get(edge.from);
    const to = headNodes.get(edge.to);
    if (!from || !to || !from.layer || !to.layer) continue;
    for (const rule of forbids) {
      if (from.layer !== rule.from || to.layer !== rule.to) continue;
      const detail = `${from.name || from.id} → ${to.name || to.id} (${edge.type})`;
      const exists = findings.some(
        (f) => f.rule === (rule.id || 'forbid-cross-layer') && f.detail === detail
      );
      if (exists) continue;
      findings.push({
        rule: rule.id || 'forbid-cross-layer',
        severity: SEVERITY.HIGH,
        title: '团队分层禁令',
        message: rule.message || `${layerLabel(rule.from)} 不得依赖 ${layerLabel(rule.to)}`,
        detail,
        file: edge.file || from.path || null,
        line: edge.line,
        from: edge.from,
        to: edge.to,
        edgeType: edge.type,
        fromLayer: from.layer,
        toLayer: to.layer,
        source: 'architecture-rules.yaml'
      });
    }
  }
}

/**
 * Resolve + load architecture-rules.yaml for session report.
 * Explicit path missing → throw; auto-discover miss → null.
 * @param {string} repo
 * @param {string|false|undefined} rulesArg - CLI --rules path, or false to disable
 */
function loadSessionRules(repo, rulesArg) {
  const { resolveRulesPath, loadRules } = require('./rules');
  const pathMod = require('path');
  if (rulesArg === false) return null;
  if (typeof rulesArg === 'string' && rulesArg) {
    return loadRules(pathMod.resolve(rulesArg));
  }
  const kitDir = pathMod.join(repo, 'architecture_viewer');
  const resolved = resolveRulesPath({ repo, kitDir });
  if (!resolved) return null;
  return loadRules(resolved);
}

/** BFS path within a node subset (for cycle chain display). */
function findPathInSubgraph(adj, start, target, allowed) {
  if (start === target) return [start];
  const seen = new Set([start]);
  const queue = [start];
  const parent = new Map();
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adj.get(cur) || []) {
      if (!allowed.has(next) || seen.has(next)) continue;
      seen.add(next);
      parent.set(next, cur);
      if (next === target) {
        const path = [target];
        while (path[path.length - 1] !== start) path.push(parent.get(path[path.length - 1]));
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

/** Tarjan SCC — returns components with ≥2 nodes (actual cycles). */
function tarjanScc(adj, nodeIds) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowlink = new Map();
  const sccs = [];

  function strongConnect(v) {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) || []) {
      if (!nodeIds.has(w)) continue;
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length >= 2) sccs.push(scc);
    }
  }

  for (const v of nodeIds) {
    if (!indices.has(v)) strongConnect(v);
  }
  return sccs;
}

/**
 * Rule (W14-04): file-level circular imports on the code graph.
 * Incremental: only rings containing at least one edge added this session
 * are reported — pre-existing historical cycles stay silent.
 * 2-node mutual import (A→B→A) = HIGH; longer rings = MEDIUM.
 * Capped at CYCLE_FINDING_CAP findings per report.
 * @param {Array} findings
 * @param {object} headGraph - "after" graph (nodes + edges)
 * @param {object} baseGraph - "before" graph
 * @param {Array} addedEdges - diff.addedEdges (for file/line attribution)
 */
function detectCircularImports(findings, headGraph, baseGraph, addedEdges, cap) {
  const cycleCap = typeof cap === 'number' ? cap : CYCLE_FINDING_CAP;
  const headFiles = new Set(headGraph.nodes.filter((n) => n.kind === 'file').map((n) => n.id));
  const nodeOf = (id) => headGraph.nodes.find((n) => n.id === id);
  const label = (id) => {
    const n = nodeOf(id);
    return (n && (n.name || n.path)) || id.replace(/^file:/, '');
  };

  const adj = new Map();
  for (const e of headGraph.edges || []) {
    if (e.type !== 'import') continue;
    if (!headFiles.has(e.from) || !headFiles.has(e.to)) continue;
    if (e.from === e.to) continue;
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    adj.get(e.from).add(e.to);
  }

  const baseFiles = new Set((baseGraph.nodes || []).filter((n) => n.kind === 'file').map((n) => n.id));
  const baseEdgeKeys = new Set();
  for (const e of baseGraph.edges || []) {
    if (e.type !== 'import') continue;
    if (!baseFiles.has(e.from) || !baseFiles.has(e.to)) continue;
    baseEdgeKeys.add(e.from + '|' + e.to);
  }

  const newEdgeMeta = new Map();
  for (const e of addedEdges || []) {
    if (e.type === 'import') newEdgeMeta.set(e.from + '|' + e.to, e);
  }

  const reported = new Set();
  let count = 0;
  for (const scc of tarjanScc(adj, headFiles)) {
    if (count >= cycleCap) return;
    const sccSet = new Set(scc);

    const newEdges = [];
    for (const u of scc) {
      for (const v of adj.get(u) || []) {
        if (!sccSet.has(v)) continue;
        if (!baseEdgeKeys.has(u + '|' + v)) newEdges.push([u, v]);
      }
    }
    if (newEdges.length === 0) continue;

    const ringKey = scc.slice().sort().join('|');
    if (reported.has(ringKey)) continue;
    reported.add(ringKey);
    count++;

    newEdges.sort((a, b) => a[0].localeCompare(b[0]));
    const [u, v] = newEdges[0];
    const pathTail = findPathInSubgraph(adj, v, u, sccSet);
    const cycleNodes = pathTail ? [u, ...pathTail.slice(0, -1)] : [u, v];

    const len = cycleNodes.length;
    const meta = newEdgeMeta.get(u + '|' + v) || {};
    const chain = cycleNodes.map(label).join(' → ') + ' → ' + label(u);
    const cycleMembers = cycleNodes
      .map((nid) => nodeOf(nid)?.path || nid.replace(/^file:/, ''))
      .filter(Boolean);
    findings.push({
      rule: 'circular-import',
      severity: len === 2 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
      title: len === 2 ? '循环依赖（双向 import）' : '循环依赖',
      message:
        len === 2
          ? `${label(u)} 与 ${label(v)} 互相 import`
          : `${len} 个文件形成 import 环`,
      detail: chain,
      file: meta.file || nodeOf(u)?.path || null,
      line: meta.line,
      cycleMembers
    });
  }
}

/** Rule 13: corrupt .av/layers.json must not silently fall back to directory inference. */
function applyLayerConfigError(findings, headGraph, baseGraph) {
  const headErr = headGraph.stats && headGraph.stats.layerConfigError;
  if (!headErr) return;
  const baseErr = baseGraph.stats && baseGraph.stats.layerConfigError;
  const persisted = baseErr === headErr;
  findings.push({
    rule: 'layer-config-error',
    severity: SEVERITY.MEDIUM,
    title: persisted ? '分层配置仍无法读取' : '分层配置无法读取',
    message: persisted
      ? '无法读取 .av/layers.json，分层仍降级为目录推断'
      : '无法读取 .av/layers.json，分层已降级为目录推断',
    detail: headErr,
    file: '.av/layers.json',
    suggestion: '请修复 .av/layers.json 的 JSON 语法，或删除损坏文件后重新生成分层配置。'
  });
}

/**
 * Evaluate all risk rules against a diff.
 * @param {object} diff - result of diffGraphs()
 * @param {object} headGraph - the "after" graph
 * @param {object} baseGraph - the "before" graph
 * @param {object} [impact] - optional pre-computed impact result from computeImpact()
 * @param {object} [opts] - { rules } normalized team rules (architecture-rules.yaml)
 * @returns {Array<Finding>} findings sorted by severity
 */
function resolveRiskPolicy(rules) {
  const { normalizeRisk } = require('./rules');
  return normalizeRisk(rules && rules.risk);
}

function findingExcluded(finding, policy) {
  if (!finding) return false;
  if ((policy.disable || []).includes(finding.rule)) return true;
  const file = finding.file || '';
  const { pathMatchesGlob } = require('./rules');
  for (const ex of policy.exclude || []) {
    if (ex.rule !== '*' && ex.rule !== finding.rule) continue;
    if (pathMatchesGlob(file, ex.path)) return true;
  }
  return false;
}

function evaluateRisk(diff, headGraph, baseGraph, impact, opts) {
  const findings = [];
  const policy = resolveRiskPolicy(opts && opts.rules);
  const T = policy.thresholds;
  const headNodes = new Map(headGraph.nodes.map((n) => [n.id, n]));
  const baseNodes = new Map(baseGraph.nodes.map((n) => [n.id, n]));

  // B4 影响面辅助：被改实体 → 下游总数映射
  const impactMap = new Map(); // id → { total, label }
  if (impact && impact.items) {
    for (const it of impact.items) {
      impactMap.set(it.id, { total: it.direct.length + it.transitive.length, direct: it.direct.length, transitive: it.transitive.length });
    }
  }

  // Rule 1: Cross-layer violations (from diff engine)
  for (const v of diff.violations) {
    const fromNode = headNodes.get(v.from);
    const toNode = headNodes.get(v.to);
    const finding = {
      rule: 'cross-layer-violation',
      severity: SEVERITY.HIGH,
      title: '跨层依赖违规',
      message: `${layerLabel(v.fromLayer)} 层直接依赖 ${layerLabel(v.toLayer)} 层`,
      detail: `${fromNode?.name || v.from} → ${toNode?.name || v.to} (${v.edgeType})`,
      file: v.file,
      line: v.line,
      from: v.from,
      to: v.to,
      edgeType: v.edgeType,
      fromLayer: v.fromLayer,
      toLayer: v.toLayer
    };
    finding.suggestion = suggestForFinding(finding);
    findings.push(finding);
  }

  // Rule 2: Layer skip — controller/component reaching storage directly
  const archEdges = diff.addedEdges
    .filter((e) => ['import', 'field-type', 'method-param', 'method-return'].includes(e.type));
  for (const edge of archEdges) {
    const from = headNodes.get(edge.from);
    const to = headNodes.get(edge.to);
    if (!from || !to) continue;
    if (!from.layer || !to.layer) continue;
    // controller/component -> storage without going through service
    if ((from.layer === 'controller' || from.layer === 'component') && to.layer === 'storage') {
      const exists = findings.some(
        (f) => f.rule === 'layer-skip' && f.detail && f.detail.includes(from.name) && f.detail.includes(to.name)
      );
      if (!exists) {
        const finding = {
          rule: 'layer-skip',
          severity: SEVERITY.HIGH,
          title: '层级穿透',
          message: `${layerLabel(from.layer)} 直接访问 ${layerLabel(to.layer)}，跳过了服务层`,
          detail: `${from.name} → ${to.name} (${edge.type})`,
          file: edge.file,
          line: edge.line,
          from: edge.from,
          to: edge.to,
          edgeType: edge.type,
          fromLayer: from.layer,
          toLayer: to.layer
        };
        finding.suggestion = suggestForFinding(finding);
        findings.push(finding);
      }
    }
  }

  // Rule 3: Removed types (potential breaking changes) — B4 影响面降级
  for (const t of diff.removedTypes) {
    const info = impactMap.get(t.node.id);
    const downstream = info ? info.total : 0;
    // 删除的实体如果下游很少（<3）且非跨层关键路径，降为 LOW
    let sev = SEVERITY.MEDIUM;
    if (downstream > 0 && downstream < T.removed_type_low) {
      sev = SEVERITY.LOW;
    } else if (downstream >= T.broad_impact) {
      sev = SEVERITY.HIGH;
    }
    findings.push({
      rule: 'removed-type',
      severity: sev,
      title: '类型删除',
      message: `${t.node.kind} "${t.node.name}" 被删除${downstream > 0 ? `，波及 ${downstream} 个下游` : ''}`,
      detail: t.node.id,
      file: t.node.path,
      impactDownstream: downstream
    });
  }

  // Rule 4: New external dependencies
  for (const d of diff.addedExternalDeps) {
    const isBuiltin = d.builtin;
    findings.push({
      rule: 'new-external-dep',
      severity: isBuiltin ? SEVERITY.INFO : SEVERITY.MEDIUM,
      title: isBuiltin ? '新增标准库依赖' : '新增外部依赖',
      message: `引入了新的${isBuiltin ? '标准库' : '第三方'}包: ${d.name || d.id}`,
      detail: d.id
    });
  }

  // Rule 5: High fan-out — entity gaining many new edges
  const fanoutCount = new Map();
  for (const edge of diff.addedEdges) {
    if (!['import', 'field-type', 'method-param', 'method-return', 'extends'].includes(edge.type)) continue;
    fanoutCount.set(edge.from, (fanoutCount.get(edge.from) || 0) + 1);
  }
  for (const [id, count] of fanoutCount) {
    if (count >= T.high_fanout) {
      const node = headNodes.get(id);
      findings.push({
        rule: 'high-fanout',
        severity: count >= T.high_fanout_medium ? SEVERITY.MEDIUM : SEVERITY.LOW,
        title: '高扇出变更',
        message: `"${node?.name || id}" 新增了 ${count} 条依赖关系，职责可能膨胀`,
        detail: `+${count} edges`
      });
    }
  }

  // Rule 6: New entity with zero architectural wiring edges (orphan).
  // Containment edges (declared-in) are ignored — every entity has one.
  // Only type-level entities are checked; functions are connected via
  // call edges we do not extract, so they would always look orphaned.
  for (const t of diff.addedTypes) {
    const node = t.node;
    if (!ORPHAN_CHECK_KINDS.includes(node.kind)) continue;
    const hasEdge = diff.addedEdges.some(
      (edge) => WIRING_EDGE_TYPES.includes(edge.type) && (edge.from === node.id || edge.to === node.id)
    );
    if (!hasEdge) {
      findings.push({
        rule: 'orphan-entity',
        severity: SEVERITY.LOW,
        title: '孤立实体',
        message: `新增的 ${node.kind} "${node.name}" 没有任何架构关系，可能未接入`,
        detail: node.id,
        file: node.path
      });
    }
  }

  // Rule 7: B4 广泛影响 — 被改实体波及下游数量 ≥10 时新增一条 finding，
  // 帮助评审者聚焦「改了一个东西，但十个以上文件受影响」的变更。
  if (impactMap.size > 0) {
    for (const [id, info] of impactMap) {
      if (info.total < T.broad_impact) continue;
      const node = headNodes.get(id) || baseNodes.get(id);
      const sev = info.total >= T.broad_impact_high ? SEVERITY.HIGH : SEVERITY.MEDIUM;
      findings.push({
        rule: 'broad-impact',
        severity: sev,
        title: '广泛影响',
        message: `"${node?.name || id}" 变更波及 ${info.total} 个下游（直接 ${info.direct} + 间接 ${info.transitive}）`,
        detail: id,
        impactDownstream: info.total
      });
    }
  }

  // Rule 8: God file — 本轮新成为神文件（>800 行），或新增文件直接 >800 行。
  // Rule 9: Large file — 本轮新成为偏大文件（>400 行但 ≤800），或新增文件 400~800 行。
  // Rule 10: File growth — 已有文件行数暴涨（绝对增量 / 相对增量双阈值）。
  // 设计原则：只报"本轮新出现"的问题，不拉全仓历史欠债；
  //           和 cross-layer / orphan-entity 一样走增量口径。
  const GOD_FILE_THRESHOLD = T.god_file;
  const LARGE_FILE_THRESHOLD = T.large_file;
  const GROWTH_ABS_LOW = T.growth_abs_low;
  const GROWTH_REL_LOW = T.growth_rel_low;
  const GROWTH_ABS_MED = T.growth_abs_med;
  const GROWTH_REL_MED = T.growth_rel_med;
  const GROWTH_REL_MIN_BASE = T.growth_rel_min_base;

  if (diff.fileLocChanges && diff.fileLocChanges.length) {
    for (const f of diff.fileLocChanges) {
      const { path: fp, baseLoc, headLoc, delta, deltaPercent, existedInBase } = f;
      if (headLoc <= 0) continue; // 文件被删了，不在 risk 口径

      const isNewFile = !existedInBase;
      const hasBaselineData = existedInBase && baseLoc > 0;

      // Rule 8: god-file (MEDIUM) — 本轮新成为神文件，或新增文件直接 >800 行
      // 旧基线无 lineCount 数据时不报（避免历史欠债一次性冒出来）
      if (headLoc > GOD_FILE_THRESHOLD) {
        const newlyBecame = hasBaselineData && baseLoc <= GOD_FILE_THRESHOLD;
        const newBigFile = isNewFile;
        if (newlyBecame || newBigFile) {
          findings.push({
            rule: 'god-file',
            severity: SEVERITY.MEDIUM,
            title: '神文件',
            message: isNewFile
              ? `新增文件 "${fp}" 共 ${headLoc} 行，已达神文件量级`
              : `"${fp}" 从 ${baseLoc} 行涨到 ${headLoc} 行，突破 800 行`,
            detail: fp,
            file: fp,
            baseLoc,
            headLoc,
            delta
          });
          continue; // 已经是 MEDIUM god-file，不再重复报 LOW large-file
        }
      }

      // Rule 9: large-file (LOW) — 本轮新成为偏大文件（且未到神文件级）
      if (headLoc > LARGE_FILE_THRESHOLD && headLoc <= GOD_FILE_THRESHOLD) {
        const newlyBecame = hasBaselineData && baseLoc <= LARGE_FILE_THRESHOLD;
        const newBigFile = isNewFile;
        if (newlyBecame || newBigFile) {
          findings.push({
            rule: 'large-file',
            severity: SEVERITY.LOW,
            title: '文件偏大',
            message: isNewFile
              ? `新增文件 "${fp}" 共 ${headLoc} 行，建议拆分`
              : `"${fp}" 从 ${baseLoc} 行涨到 ${headLoc} 行，超过 400 行`,
            detail: fp,
            file: fp,
            baseLoc,
            headLoc,
            delta
          });
        }
      }

      // Rule 10: file-growth — 已有文件且基线有行数数据时才报
      // 新增文件不归为 growth（本来就是从 0 开始），归 large-file / god-file
      if (hasBaselineData && delta > 0) {
        const relApplies = baseLoc >= GROWTH_REL_MIN_BASE;
        const isMedGrowth = delta >= GROWTH_ABS_MED || (relApplies && deltaPercent >= GROWTH_REL_MED);
        const isLowGrowth = delta >= GROWTH_ABS_LOW || (relApplies && deltaPercent >= GROWTH_REL_LOW);
        if (isMedGrowth) {
          findings.push({
            rule: 'file-growth',
            severity: SEVERITY.MEDIUM,
            title: '文件行数暴涨',
            message: `"${fp}" 新增 ${delta} 行（+${deltaPercent.toFixed(0)}%），${baseLoc} → ${headLoc} 行`,
            detail: fp,
            file: fp,
            baseLoc,
            headLoc,
            delta,
            deltaPercent
          });
        } else if (isLowGrowth) {
          findings.push({
            rule: 'file-growth',
            severity: SEVERITY.LOW,
            title: '文件行数增长较快',
            message: `"${fp}" 新增 ${delta} 行（+${deltaPercent.toFixed(0)}%），${baseLoc} → ${headLoc} 行`,
            detail: fp,
            file: fp,
            baseLoc,
            headLoc,
            delta,
            deltaPercent
          });
        }
      }
    }
  }

  // Rule 11 (W14-04): file-level circular imports formed by new edges
  detectCircularImports(findings, headGraph, baseGraph, diff.addedEdges, T.cycle_cap);

  // Team rules: architecture-rules.yaml forbid_cross_layer → code import graph
  if (opts && opts.rules) {
    applyTeamForbidCrossLayer(findings, diff, headNodes, opts.rules);
    applyInvariants(findings, diff, headGraph, baseGraph, opts.rules);
  }

  // Rule 12: 变量 / 插值动态导入无法静态解析 — 不得静默漏报
  for (const edge of diff.addedEdges || []) {
    if (edge.type !== 'unresolved-dynamic-import') continue;
    findings.push({
      rule: 'unresolved-dynamic-import',
      severity: SEVERITY.LOW,
      title: '动态导入无法静态解析',
      message: `"${edge.file || edge.from}" 存在变量或插值形式的动态导入，静态分析无法确定目标模块`,
      detail: (edge.file || '') + (edge.line ? ':' + edge.line : ''),
      file: edge.file || null,
      line: edge.line,
      from: edge.from,
      to: edge.to,
      edgeType: edge.type
    });
  }

  // Rule 13: layer config load failure — explicit MEDIUM, no silent fallback
  applyLayerConfigError(findings, headGraph, baseGraph);

  applySignatureBreak(findings, diff, headGraph, baseGraph);
  applyUnresolvedCallCluster(findings, diff, headGraph, baseGraph);

  // Contract surface (not architecture): public HTTP routes + schema files.
  applyContractSurface(findings, diff, headGraph, baseGraph);

  applyIntentAlignment(findings, diff, headGraph, baseGraph, opts || {});
  applyImplChanged(findings, diff);
  // W20-01a: behavior fingerprint diff is risk-rules input; R16/R17 land in W20-01b.
  ensureBehaviorFingerprintInput(diff);
  applyBehaviorTestCoupling(findings, diff, impactMap, opts || {});

  const kept = findings.filter((f) => !findingExcluded(f, policy));

  // Sort by severity
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  kept.sort((a, b) => order[a.severity] - order[b.severity]);
  return kept;
}

function layerLabel(layer) {
  return LAYER_LABEL[layer] || layer;
}

const SCHEMA_FILE_RE = /(^|\/)(migrations?|alembic)(\/|$)|(^|\/)schema\.prisma$|\.(sql)$/i;

function fileNode(graph, filePath) {
  if (!graph || !filePath) return null;
  return (graph.nodes || []).find((n) => n.kind === 'file' && n.path === filePath) || null;
}

/** True when this session actually edited the file (not just a new extractor adding children). */
function fileContentChanged(baseGraph, headGraph, filePath) {
  const b = fileNode(baseGraph, filePath);
  const h = fileNode(headGraph, filePath);
  if (!b && h) return true;
  if (b && !h) return true;
  if (!b || !h) return false;
  if (b.contentHash && h.contentHash) return b.contentHash !== h.contentHash;
  if (typeof b.lineCount === 'number' && typeof h.lineCount === 'number') {
    return b.lineCount !== h.lineCount;
  }
  return false;
}

function applyContractSurface(findings, diff, headGraph, baseGraph) {
  const seen = new Set();
  function push(finding) {
    const key = finding.rule + '|' + finding.detail;
    if (seen.has(key)) return;
    seen.add(key);
    finding.family = 'contract';
    finding.suggestion = suggestForFinding(finding);
    findings.push(finding);
  }

  for (const entry of diff.addedNodes || []) {
    const node = entry.node || entry;
    if (node.kind !== 'route') continue;
    if (!fileContentChanged(baseGraph, headGraph, node.path)) continue;
    push({
      rule: 'public-surface-changed',
      severity: SEVERITY.MEDIUM,
      title: '对外表面变更',
      message: `新增路由 ${node.name}`,
      detail: node.id,
      file: node.path,
      line: node.line,
      change: 'added'
    });
  }
  for (const entry of diff.removedNodes || []) {
    const node = entry.node || entry;
    if (node.kind !== 'route') continue;
    if (!fileContentChanged(baseGraph, headGraph, node.path)) continue;
    push({
      rule: 'public-surface-changed',
      severity: SEVERITY.MEDIUM,
      title: '对外表面变更',
      message: `删除路由 ${node.name}`,
      detail: node.id,
      file: node.path,
      line: node.line,
      change: 'removed'
    });
  }

  const schemaPaths = new Set();
  for (const entry of [...(diff.addedNodes || []), ...(diff.removedNodes || [])]) {
    const node = entry.node || entry;
    const fp = node.path || (node.kind === 'file' ? String(node.id || '').replace(/^file:/, '') : '');
    if (fp && SCHEMA_FILE_RE.test(fp.replace(/\\/g, '/'))) {
      if (fileContentChanged(baseGraph, headGraph, fp) || !fileNode(baseGraph, fp) || !fileNode(headGraph, fp)) {
        schemaPaths.add(fp);
      }
    }
  }
  for (const f of diff.fileLocChanges || []) {
    const fp = f.path;
    if (!fp || !SCHEMA_FILE_RE.test(fp.replace(/\\/g, '/'))) continue;
    if (fileContentChanged(baseGraph, headGraph, fp) || (f.delta && f.delta !== 0)) schemaPaths.add(fp);
  }
  for (const fp of schemaPaths) {
    push({
      rule: 'schema-touched',
      severity: SEVERITY.MEDIUM,
      title: '数据契约被改动',
      message: `本轮改动了数据契约文件 "${fp}"`,
      detail: fp,
      file: fp
    });
  }
}

function matchRoutePattern(pattern, routeName) {
  if (pattern == null || pattern === '' || pattern === '*') return true;
  const esc = String(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp('^' + esc + '$', 'i').test(String(routeName || ''));
}

function invariantSeverity(raw) {
  const s = String(raw || 'high').toLowerCase();
  if (s === 'medium' || s === 'low' || s === 'info' || s === 'high') return s;
  return SEVERITY.HIGH;
}

/** Files / handler ids touched by newly added routes matching pattern. */
function routeScope(diff, baseGraph, headGraph, pattern) {
  const paths = new Set();
  const handlerIds = new Set();
  const routes = [];
  for (const entry of diff.addedNodes || []) {
    const node = entry.node || entry;
    if (node.kind !== 'route') continue;
    if (!matchRoutePattern(pattern, node.name)) continue;
    if (!fileContentChanged(baseGraph, headGraph, node.path)) continue;
    routes.push(node);
    if (node.path) paths.add(node.path);
  }
  if (!routes.length) return { paths, handlerIds, routes };
  for (const e of headGraph.edges || []) {
    if (e.type !== 'handles') continue;
    if (!routes.some((r) => r.id === e.to)) continue;
    handlerIds.add(e.from);
    const from = (headGraph.nodes || []).find((n) => n.id === e.from);
    if (from && from.path) paths.add(from.path);
  }
  return { paths, handlerIds, routes };
}

function nodeInScope(node, scope) {
  if (!node) return false;
  if (scope.handlerIds.has(node.id)) return true;
  if (node.path && scope.paths.has(node.path)) return true;
  if (node.kind === 'file') {
    const p = node.path || String(node.id || '').replace(/^file:/, '');
    return scope.paths.has(p);
  }
  return false;
}

function fileImportsLayer(headGraph, filePath, layer) {
  const fileId = 'file:' + filePath;
  for (const e of headGraph.edges || []) {
    if (e.type !== 'import') continue;
    const from = (headGraph.nodes || []).find((n) => n.id === e.from);
    const to = (headGraph.nodes || []).find((n) => n.id === e.to);
    if (!from || !to) continue;
    const fromPath = from.kind === 'file'
      ? (from.path || from.id.replace(/^file:/, ''))
      : from.path;
    if (fromPath !== filePath && from.id !== fileId) continue;
    if (to.layer === layer) return true;
  }
  return false;
}

/**
 * architecture-rules.yaml `invariants` — session-only contract assertions.
 * Incremental: only fires when this session adds matching routes / edges.
 */
function applyInvariants(findings, diff, headGraph, baseGraph, rules) {
  const list = (rules && rules.invariants) || [];
  if (!list.length) return;
  const headNodes = new Map((headGraph.nodes || []).map((n) => [n.id, n]));
  const seen = new Set();

  function push(finding) {
    const key = finding.rule + '|' + finding.detail;
    if (seen.has(key)) return;
    seen.add(key);
    finding.family = 'contract';
    finding.source = 'architecture-rules.yaml';
    finding.suggestion = suggestForFinding(finding);
    findings.push(finding);
  }

  for (const inv of list) {
    const routePat = inv.when && inv.when.route;
    const scoped = routePat != null;
    const scope = scoped ? routeScope(diff, baseGraph, headGraph, routePat) : null;
    if (scoped && (!scope.routes || !scope.routes.length)) continue;

    if (inv.forbid) {
      const edgeTypes = inv.forbid.edge_type
        ? [inv.forbid.edge_type]
        : WIRING_EDGE_TYPES;
      for (const edge of diff.addedEdges || []) {
        if (!edgeTypes.includes(edge.type)) continue;
        const from = headNodes.get(edge.from);
        const to = headNodes.get(edge.to);
        if (!from || !to) continue;
        if (scoped && !nodeInScope(from, scope)) continue;
        if (inv.forbid.from_layer && from.layer !== inv.forbid.from_layer) continue;
        if (inv.forbid.to_layer && to.layer !== inv.forbid.to_layer) continue;
        if (!scoped && !inv.forbid.from_layer && !inv.forbid.to_layer) continue;
        const detail = `${from.name || from.id} → ${to.name || to.id} (${edge.type}) [${inv.id}]`;
        push({
          rule: 'invariant-broken',
          severity: invariantSeverity(inv.severity),
          title: '团队不变量',
          message: inv.message || `违反不变量 ${inv.id}`,
          detail,
          file: edge.file || from.path || null,
          line: edge.line,
          from: edge.from,
          to: edge.to,
          edgeType: edge.type,
          fromLayer: from.layer,
          toLayer: to.layer,
          invariantId: inv.id
        });
      }
    }

    if (inv.require && inv.require.import_layer) {
      const layer = inv.require.import_layer;
      const paths = scoped
        ? [...scope.paths]
        : [...new Set(
            (diff.addedNodes || [])
              .map((e) => (e.node || e))
              .filter((n) => n.kind === 'route' && fileContentChanged(baseGraph, headGraph, n.path))
              .map((n) => n.path)
              .filter(Boolean)
          )];
      for (const fp of paths) {
        if (fileImportsLayer(headGraph, fp, layer)) continue;
        push({
          rule: 'invariant-broken',
          severity: invariantSeverity(inv.severity),
          title: '团队不变量',
          message: inv.message || `新增路由所在文件必须依赖 ${layerLabel(layer)} 层`,
          detail: `${fp} missing import→${layer} [${inv.id}]`,
          file: fp,
          invariantId: inv.id,
          requireLayer: layer
        });
      }
    }
  }
}

/**
 * Direction-aware fix suggestion for a finding.
 * Avoids one-size-fits-all「加中间人」when the edge is reverse (storage→controller).
 */
const SIGNATURE_CHANGE_FIELDS = new Set(['params', 'paramTypes', 'returnTypes', 'optionalParams', 'signature']);
const UNRESOLVED_CLUSTER_MIN = 3;

function signatureChangeOf(mod) {
  return (mod.changes || []).filter((c) => SIGNATURE_CHANGE_FIELDS.has(c.field));
}

function applySignatureBreak(findings, diff, headGraph, baseGraph) {
  const headNodes = new Map((headGraph.nodes || []).map((n) => [n.id, n]));
  const callEdges = (headGraph.edges || []).filter((e) => e.type === CALL_EDGE);
  for (const mod of diff.modifiedNodes || []) {
    const sigChanges = signatureChangeOf(mod);
    if (!sigChanges.length) continue;
    const node = headNodes.get(mod.id) || (mod.to && mod.to.id ? headNodes.get(mod.to.id) : null);
    if (!node) continue;
    if (node.exported === false) continue;
    if (!['function', 'class', 'component', 'interface'].includes(node.kind)) continue;

    const callers = callEdges.filter((e) => e.to === node.id);
    const broken = [];
    for (const edge of callers) {
      const methodName = edge.method || edge.callee || null;
      const sig = methodSigByName(node.signature, methodName);
      if (!argsCompatible(edge.argCount, sig)) {
        broken.push({
          file: edge.file,
          line: edge.line,
          from: edge.from,
          argCount: edge.argCount,
          paramCount: sig ? sig.paramCount : null,
          callee: edge.callee || node.name
        });
      }
    }

    const paramChange = sigChanges.find((c) => c.field === 'params');
    const retChange = sigChanges.find((c) => c.field === 'returnTypes');
    const detailBits = [];
    if (paramChange) detailBits.push(`params: ${paramChange.from}→${paramChange.to}`);
    if (retChange) {
      const fmt = (v) => Array.isArray(v) ? (v.join('|') || '∅') : String(v);
      detailBits.push(`returnTypes: ${fmt(retChange.from)}→${fmt(retChange.to)}`);
    }
    for (const site of broken) {
      detailBits.push(`${site.file}:${site.line} 实参 ${site.argCount} ≠ 形参 ${site.paramCount}`);
    }

    const finding = {
      rule: 'signature-break',
      severity: broken.length ? SEVERITY.HIGH : SEVERITY.INFO,
      title: broken.length ? '导出签名变更且调用点不匹配' : '导出签名变更（调用点仍匹配）',
      message: broken.length
        ? `"${node.name}" 签名变了，${broken.length} 个调用点实参个数/类型不匹配`
        : `"${node.name}" 签名变了，沿 call 边检查到的调用点仍兼容`,
      detail: detailBits.join(' · ') || node.id,
      file: node.path || null,
      line: node.line || null,
      evidence: broken,
      family: 'contract'
    };
    finding.suggestion = suggestForFinding(finding);
    findings.push(finding);
  }
}

function applyUnresolvedCallCluster(findings, diff, headGraph, baseGraph) {
  const changed = new Set();
  for (const loc of diff.fileLocChanges || []) {
    if (loc.path) changed.add(loc.path);
  }
  for (const list of [diff.addedNodes, diff.removedNodes, diff.modifiedNodes]) {
    for (const entry of list || []) {
      const n = entry.node || entry.to || entry.from || entry;
      if (n && n.path) changed.add(n.path);
    }
  }
  for (const n of headGraph.nodes || []) {
    if (n.kind === 'file' && n.path && fileContentChanged(baseGraph, headGraph, n.path)) {
      changed.add(n.path);
    }
  }
  if (!changed.size) return;

  const byFile = new Map();
  for (const e of headGraph.edges || []) {
    if (e.type !== UNRESOLVED_EDGE) continue;
    if (!e.file || !changed.has(e.file)) continue;
    byFile.set(e.file, (byFile.get(e.file) || 0) + 1);
  }
  for (const [file, count] of byFile) {
    if (count < UNRESOLVED_CLUSTER_MIN) continue;
    const finding = {
      rule: 'unresolved-call-cluster',
      severity: SEVERITY.LOW,
      title: '未解析调用聚集',
      message: `"${file}" 本轮有 ${count} 处动态/未解析调用，静态分析无法绑定目标`,
      detail: file + ' unresolved-call × ' + count,
      file,
      line: null,
      family: 'contract'
    };
    finding.suggestion = suggestForFinding(finding);
    findings.push(finding);
  }
}

function ensureBehaviorFingerprintInput(diff) {
  if (!diff || typeof diff !== 'object') return [];
  if (!Array.isArray(diff.behaviorChanges)) diff.behaviorChanges = [];
  return diff.behaviorChanges;
}

/**
 * R16/R17 — behavior fingerprint × test coupling.
 * report-only observation window: never elevates exit gate by itself beyond
 * declared severities; R17 HIGH is intentional for the broad-impact×untested combo.
 */
function applyBehaviorTestCoupling(findings, diff, impactMap, opts) {
  const changes = ensureBehaviorFingerprintInput(diff);
  if (!changes.length) return;

  const baseIdx = opts.testIndexBase || null;
  const headIdx = opts.testIndexHead || null;
  // Without a test index, skip quietly (offline / old baseline).
  if (!headIdx && !baseIdx) return;

  const { targets: testedProd } = productionTargetsWithTestChanges(baseIdx || { files: [], edges: [] }, headIdx || { files: [], edges: [] });
  const seen = new Set();

  for (const c of changes) {
    if (c.exported === false) continue;
    const prodPath = c.path;
    if (!prodPath) continue;
    const key = c.id + '|' + (c.method || '');
    if (seen.has(key)) continue;
    seen.add(key);

    const cover = testedProd.get(prodPath)
      || testedProd.get(prodPath.replace(/\.[^.]+$/, ''))
      || null;
    const related = relatedTestsForPath(headIdx || baseIdx, prodPath);
    const nearestTest = (cover && cover.testFiles[0])
      || (related[0] && related[0].from)
      || null;
    const linkConfidence = (cover && cover.confidence)
      || (related[0] && related[0].confidence)
      || null;
    const hasTestChange = !!cover;

    const impact = impactMap.get(c.id) || impactMap.get('file:' + prodPath) || null;
    const downstream = impact ? impact.total : 0;
    const who = formatBehaviorSymbol(c);

    if (hasTestChange) {
      // Fingerprint changed but related tests also moved → downgrade to INFO.
      if (downstream >= BROAD_IMPACT_THRESHOLD) {
        findings.push({
          rule: 'behavior-changed-broad-impact',
          severity: SEVERITY.INFO,
          title: '高影响行为变更（已有测试跟进）',
          message: `"${who}" 行为指纹变了且下游 ${downstream}，但关联测试已改动`,
          detail: nearestTest ? `测试: ${nearestTest}` : prodPath,
          file: prodPath,
          line: c.line || null,
          suggestion: '关联测试已跟进。请确认测试覆盖了新增/删除的调用与 sink。未判定业务对错。',
          family: 'contract',
          reportOnly: true,
          confidence: linkConfidence || 'medium'
        });
      }
      continue;
    }

    // No related test change
    if (downstream >= BROAD_IMPACT_THRESHOLD) {
      findings.push({
        rule: 'behavior-changed-broad-impact',
        severity: SEVERITY.HIGH,
        title: '高影响行为变更且无测试跟进',
        message: `"${who}" 行为指纹变了，波及 ${downstream} 个下游，且关联测试未改`,
        detail: nearestTest
          ? `建议查看测试: ${nearestTest}`
          : `未找到关联测试（${prodPath}）`,
        file: prodPath,
        line: c.line || null,
        suggestion: nearestTest
          ? `请更新 ${nearestTest} 覆盖本次行为变化，或确认该高影响改动不需要测试。未判定业务对错。`
          : '未找到关联测试文件。请为该导出符号补测试后再合入。未判定业务对错。',
        family: 'contract',
        reportOnly: true,
        confidence: linkConfidence || 'medium',
        impactDownstream: downstream
      });
      continue;
    }

    let severity = SEVERITY.MEDIUM;
    if (linkConfidence === 'low') severity = SEVERITY.LOW;
    // No known related test at all → still MEDIUM but note it
    findings.push({
      rule: 'behavior-changed-no-test',
      severity,
      title: '行为变更无测试跟进',
      message: `"${who}" 行为指纹变了，关联测试文件本轮未改动`,
      detail: nearestTest
        ? `最近测试: ${nearestTest}`
        : `未找到关联测试（${prodPath}）`,
      file: prodPath,
      line: c.line || null,
      suggestion: nearestTest
        ? `请检查或更新 ${nearestTest}。指纹只标「干的事变了」，不验证算对了没有。`
        : '未找到关联测试。请按命名约定（*.test.js / test_*.py）补测。未判定业务对错。',
      family: 'contract',
      reportOnly: true,
      confidence: linkConfidence || (nearestTest ? 'medium' : 'low')
    });
  }
}

function suggestForFinding(finding) {
  if (!finding || typeof finding !== 'object') return '请根据具体问题内容判断。';
  const rule = finding.rule;
  const from = finding.fromLayer;
  const to = finding.toLayer;
  const isTeamForbid = finding.title === '团队分层禁令';

  if (rule === 'layer-skip' || (rule === 'cross-layer-violation' && from && to)) {
    const upper = new Set(['controller', 'entrypoint', 'component']);
    const lower = new Set(['storage', 'domain', 'dto']);
    // Forward skip: UI/API → persistence
    if ((from === 'controller' || from === 'component' || from === 'entrypoint') && to === 'storage') {
      return `${layerLabel(from)} 直接访问 ${layerLabel(to)}，跳过了服务层——请经 service 中转，不要让前台/入口直接跑去仓库拿东西。`;
    }
    if (from === 'component' && (to === 'storage' || to === 'domain')) {
      return `UI 组件直接访问持久层/领域层——请经 controller → service 取数，评估是否要把数据访问下沉到后端。`;
    }
    // Reverse: lower → upper
    if (from && to && (LAYER_RANK[from] ?? 99) < (LAYER_RANK[to] ?? -1)) {
      if (lower.has(from) && upper.has(to)) {
        return `${layerLabel(from)} 反向依赖 ${layerLabel(to)}——底层不应依赖上层。请把接口上提（依赖倒置），或把被引用的逻辑下沉到更低层，而不是「加一层中间人」去维持反向边。`;
      }
      if (from === 'util' && (to === 'service' || upper.has(to))) {
        return `工具层依赖了 ${layerLabel(to)}——工具层承担了入口/业务职责，或分层标错了。请把业务逻辑移出 util，或重新核对 .av/layers.json 分类。`;
      }
      return `${layerLabel(from)} → ${layerLabel(to)} 是反向依赖（下层指向上层）。请反转依赖方向或上移抽象，不要用「加中间人」去粉饰反向边。`;
    }
    if (rule === 'layer-skip') {
      return `${layerLabel(from) || '上层'} 直达 ${layerLabel(to) || '下层'} 跳过了中间层——请补上 service 等中转，或调整分层。`;
    }
    return `${layerLabel(from)} 不应直接依赖 ${layerLabel(to)}——按架构分层改走合法路径，或重新审阅分层标签。`;
  }

  if (isTeamForbid) {
    return '这是团队 architecture-rules.yaml 禁止的依赖方向，请改走允许的层，或更新规则文件并评审。';
  }
  if (rule === 'removed-type') {
    return '检查有没有其他代码用到被删掉的东西，必要的话保留或给个替代方案。';
  }
  if (rule === 'new-external-dep') {
    return '确认这个新引入的外购零件是不是真的需要，检查许可证和安全。';
  }
  if (rule === 'circular-import') {
    return '打断 import 环：抽出共享类型/接口到更低层，或让一侧改为依赖抽象。';
  }
  if (rule === 'layer-config-error') {
    return '请修复或重新生成 .av/layers.json（JSON 语法 / schema）。修复前分层结果来自目录推断，可能不准确。';
  }
  if (rule === 'public-surface-changed') {
    return '这是对外 HTTP 表面变化，不是分层违规。请确认接口变更是否符合本次意图，并用测试覆盖该路由。绿灯仍不表示业务逻辑正确。';
  }
  if (rule === 'schema-touched') {
    return '数据契约文件被改了（migration / SQL / Prisma 等）。请确认表结构变更有对应迁移与回滚，并用测试验证读写。这不证明业务算对了。';
  }
  if (rule === 'invariant-broken' || (finding.source === 'architecture-rules.yaml' && finding.family === 'contract')) {
    return finding.suggestion
      || '这是团队在 architecture-rules.yaml 声明的业务/契约不变量。请按规则改依赖方向，或评审后更新 invariants。不变量过了仍不等于业务逻辑正确。';
  }
  if (rule === 'intent-mismatch') {
    return finding.suggestion || '对照 session start --intent：改动面和声明意图不一致。不对齐不等于业务算错。';
  }
  if (rule === 'behavior-untested') {
    return finding.suggestion || '对外路由变了但测试目录没一起动。请补测；未跑测试也不证明业务正确。';
  }
  if (rule === 'impl-changed') {
    return finding.suggestion || '函数体变了但架构结构可以没变。请对列出的符号补测试并做代码审查；本工具不验证业务是否算对。';
  }
  if (rule === 'signature-break') {
    return finding.suggestion
      || '导出函数/方法签名变了。请按证据里的调用点补实参或改回签名；有断裂为红灯，全匹配仅为知情。未判定业务对错。';
  }
  if (rule === 'unresolved-call-cluster') {
    return finding.suggestion
      || '变更文件里动态调用过多，静态分析绑不住目标。请改成可解析的具名调用，或接受这条 LOW 提示。';
  }
  if (rule === 'behavior-changed-no-test' || rule === 'behavior-changed-broad-impact') {
    return finding.suggestion
      || '行为指纹变了。请确认关联测试是否覆盖；本规则观察期 report-only，不单独作为业务正确性证明。';
  }
  return finding.suggestion || '请根据具体问题内容判断。';
}

/**
 * Compute a summary of risk findings.
 */
function summarizeFindings(findings) {
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  const gateCounts = { high: 0, medium: 0, low: 0, info: 0 };
  let reportOnlyCount = 0;
  for (const f of findings) {
    counts[f.severity]++;
    if (f.reportOnly) reportOnlyCount++;
    else gateCounts[f.severity]++;
  }
  function levelOf(c) {
    if (c.high > 0) return 'high';
    if (c.medium > 0) return 'medium';
    if (c.low > 0) return 'low';
    return 'none';
  }
  return {
    counts,
    level: levelOf(counts),
    gateLevel: levelOf(gateCounts),
    total: findings.length,
    reportOnlyCount
  };
}

module.exports = {
  evaluateRisk,
  summarizeFindings,
  loadSessionRules,
  resolveRiskPolicy,
  applyTeamForbidCrossLayer,
  detectCircularImports,
  applyContractSurface,
  applyInvariants,
  applyIntentAlignment,
  applySignatureBreak,
  applyUnresolvedCallCluster,
  ensureBehaviorFingerprintInput,
  applyBehaviorTestCoupling,
  fileContentChanged,
  suggestForFinding,
  SEVERITY,
  LAYER_RANK,
  LAYER_LABEL,
  layerLabel
};
