'use strict';

/**
 * Risk rules engine for architecture session reports.
 * Evaluates a diff result against a set of architectural rules
 * and produces findings with severity levels.
 */

const SEVERITY = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low', INFO: 'info' };

const LAYER_RANK = { domain: 0, util: 0, dto: 1, storage: 1, config: 2, service: 3, controller: 4, component: 5 };
const LAYER_LABEL = {
  component: '组件', controller: '控制器', service: '服务',
  domain: '领域', storage: '存储', dto: 'DTO', config: '配置', util: '工具'
};

/**
 * Evaluate all risk rules against a diff.
 * @param {object} diff - result of diffGraphs()
 * @param {object} headGraph - the "after" graph
 * @param {object} baseGraph - the "before" graph
 * @returns {Array<Finding>} findings sorted by severity
 */
function evaluateRisk(diff, headGraph, baseGraph) {
  const findings = [];
  const headNodes = new Map(headGraph.nodes.map((n) => [n.id, n]));
  const baseNodes = new Map(baseGraph.nodes.map((n) => [n.id, n]));

  // Rule 1: Cross-layer violations (from diff engine)
  for (const v of diff.violations) {
    const fromNode = headNodes.get(v.from);
    const toNode = headNodes.get(v.to);
    findings.push({
      rule: 'cross-layer-violation',
      severity: SEVERITY.HIGH,
      title: '跨层依赖违规',
      message: `${layerLabel(v.fromLayer)} 层直接依赖 ${layerLabel(v.toLayer)} 层`,
      detail: `${fromNode?.name || v.from} → ${toNode?.name || v.to} (${v.edgeType})`,
      file: v.file,
      line: v.line,
      fromLayer: v.fromLayer,
      toLayer: v.toLayer
    });
  }

  // Rule 2: Layer skip — controller/component reaching storage directly
  const archEdges = diff.addedEdges
    .map((e) => e.edge)
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
        findings.push({
          rule: 'layer-skip',
          severity: SEVERITY.HIGH,
          title: '层级穿透',
          message: `${layerLabel(from.layer)} 直接访问 ${layerLabel(to.layer)}，跳过了服务层`,
          detail: `${from.name} → ${to.name} (${edge.type})`,
          file: edge.file,
          line: edge.line
        });
      }
    }
  }

  // Rule 3: Removed types (potential breaking changes)
  for (const t of diff.removedTypes) {
    findings.push({
      rule: 'removed-type',
      severity: SEVERITY.MEDIUM,
      title: '类型删除',
      message: `${t.node.kind} "${t.node.name}" 被删除，可能影响引用方`,
      detail: t.node.id,
      file: t.node.path
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
  for (const e of diff.addedEdges) {
    const edge = e.edge;
    if (!['import', 'field-type', 'method-param', 'method-return', 'extends'].includes(edge.type)) continue;
    fanoutCount.set(edge.from, (fanoutCount.get(edge.from) || 0) + 1);
  }
  for (const [id, count] of fanoutCount) {
    if (count >= 5) {
      const node = headNodes.get(id);
      findings.push({
        rule: 'high-fanout',
        severity: count >= 8 ? SEVERITY.MEDIUM : SEVERITY.LOW,
        title: '高扇出变更',
        message: `"${node?.name || id}" 新增了 ${count} 条依赖关系，职责可能膨胀`,
        detail: `+${count} edges`
      });
    }
  }

  // Rule 6: New entity with zero architectural edges (orphan)
  for (const t of diff.addedTypes) {
    const node = t.node;
    const hasEdge = diff.addedEdges.some((e) => {
      const edge = e.edge;
      return edge.from === node.id || edge.to === node.id;
    });
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

  // Sort by severity
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return findings;
}

function layerLabel(layer) {
  return LAYER_LABEL[layer] || layer;
}

/**
 * Compute a summary of risk findings.
 */
function summarizeFindings(findings) {
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  let level = 'none';
  if (counts.high > 0) level = 'high';
  else if (counts.medium > 0) level = 'medium';
  else if (counts.low > 0) level = 'low';
  return { counts, level, total: findings.length };
}

module.exports = { evaluateRisk, summarizeFindings, SEVERITY, LAYER_RANK, LAYER_LABEL, layerLabel };
