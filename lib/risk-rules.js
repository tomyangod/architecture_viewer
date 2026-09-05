'use strict';

/**
 * Risk rules engine for architecture session reports.
 * Evaluates a diff result against a set of architectural rules
 * and produces findings with severity levels.
 */

const SEVERITY = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low', INFO: 'info' };

// Architectural wiring edges (must match session-report ARCH_EDGE_TYPES).
// Containment edges (declared-in/defined-in) link an entity to its file and
// must not count as "being wired into the architecture".
const WIRING_EDGE_TYPES = ['import', 'extends', 'implements', 'field-type', 'method-param', 'method-return', 'component-props'];

// Kinds whose architecture wiring is captured by extractors. Bare functions
// are connected via call edges we do not extract (file-level imports cover
// their module), so orphan detection on functions is pure noise.
const ORPHAN_CHECK_KINDS = ['class', 'interface', 'enum', 'record', 'annotation', 'type_alias', 'component'];

// B4 影响面驱动的风险分级阈值：被改实体波及的下游数量达到阈值时升级严重度。
// broad-impact 规则：≥10 直接+间接下游 → MEDIUM，≥20 → HIGH。
const BROAD_IMPACT_THRESHOLD = 10;
const BROAD_IMPACT_HIGH = 20;
// 降级阈值：波动 <3 且无其他高风险 finding 时，removed-type 可从 MEDIUM 降为 LOW。
const LOW_IMPACT_REMOVED_THRESHOLD = 3;

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
 * @param {object} [impact] - optional pre-computed impact result from computeImpact()
 * @returns {Array<Finding>} findings sorted by severity
 */
function evaluateRisk(diff, headGraph, baseGraph, impact) {
  const findings = [];
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

  // Rule 3: Removed types (potential breaking changes) — B4 影响面降级
  for (const t of diff.removedTypes) {
    const info = impactMap.get(t.node.id);
    const downstream = info ? info.total : 0;
    // 删除的实体如果下游很少（<3）且非跨层关键路径，降为 LOW
    let sev = SEVERITY.MEDIUM;
    if (downstream > 0 && downstream < LOW_IMPACT_REMOVED_THRESHOLD) {
      sev = SEVERITY.LOW;
    } else if (downstream >= BROAD_IMPACT_THRESHOLD) {
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
      if (info.total < BROAD_IMPACT_THRESHOLD) continue;
      const node = headNodes.get(id) || baseNodes.get(id);
      const sev = info.total >= BROAD_IMPACT_HIGH ? SEVERITY.HIGH : SEVERITY.MEDIUM;
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
  const GOD_FILE_THRESHOLD = 800;
  const LARGE_FILE_THRESHOLD = 400;
  const GROWTH_ABS_LOW = 150;
  const GROWTH_REL_LOW = 40;   // percent
  const GROWTH_ABS_MED = 300;
  const GROWTH_REL_MED = 100;  // percent

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
        const isMedGrowth = delta >= GROWTH_ABS_MED || deltaPercent >= GROWTH_REL_MED;
        const isLowGrowth = delta >= GROWTH_ABS_LOW || deltaPercent >= GROWTH_REL_LOW;
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
