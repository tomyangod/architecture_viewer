'use strict';

/**
 * 产品精修路由：客户只看见「骨架 / 精修」。
 * 内部按仓库形态选管线，不把引擎编号暴露到 CLI/Web。
 *
 *   web + 真实前端  → agent（读仓画图 + 路径闸门 + 扫尾）
 *   bridge / proxy / notify-bus / api-svc → orch（形态编排；低置信时内部再降级）
 *   已知形态歧义（api-svc↔notify-bus、notify-bus↔web）→ orch
 *   其余 / 低置信 → orch（再失败由调用方降级骨架）
 */

const path = require('path');

const ORCH_KINDS = new Set(['bridge', 'proxy', 'notify-bus', 'api-svc']);

function inspectShape(repoRoot) {
  const { scan } = require('./scan');
  const { buildTree, importanceForensics } = require('./orch/lib');
  const root = path.resolve(repoRoot);
  const tree = buildTree(root);
  const inv = scan(root, { write: false });
  return importanceForensics(root, tree, inv.entrypoints || []);
}

function top2Kinds(imp) {
  const cands = (imp && imp.shapeCandidates) || [];
  return cands.slice(0, 2).map((c) => c.kind).sort().join(',');
}

function hasRealFrontend(imp) {
  const fe = (imp && imp.feRoots) || [];
  if (fe.length > 0) return true;
  const web = ((imp && imp.shapeCandidates) || []).find((c) => c.kind === 'web');
  return !!(web && web.score >= 10);
}

function isKnownAmbiguous(imp) {
  const k = top2Kinds(imp);
  return k === 'api-svc,notify-bus' || k === 'notify-bus,web';
}

/**
 * @returns {{ pipeline: 'agent'|'orch', reason: string, shape: string, confidence: string }}
 */
function chooseRefinePipeline(imp) {
  const kind = (imp && imp.shape && imp.shape.kind) || 'web';
  const conf = (imp && imp.shapeConfidence) || 'low';
  const base = { shape: kind, confidence: conf };

  if (isKnownAmbiguous(imp)) {
    return Object.assign(base, { pipeline: 'orch', reason: 'ambiguous-shape' });
  }
  if (kind === 'web' && hasRealFrontend(imp)) {
    return Object.assign(base, { pipeline: 'agent', reason: 'web-app' });
  }
  if (ORCH_KINDS.has(kind)) {
    return Object.assign(base, { pipeline: 'orch', reason: 'shape-' + kind });
  }
  if (conf === 'low') {
    return Object.assign(base, { pipeline: 'orch', reason: 'low-confidence' });
  }
  return Object.assign(base, { pipeline: 'orch', reason: 'default' });
}

/**
 * 评测/内部：形态取证 → 冠军族（不要当作用户可见名字）。
 * 与 chooseRefinePipeline 同口径：web 无前端 / 歧义组合同样返回 'orch'，
 * 避免评测标签与实际路由不一致（championOf('web') 恒为 agent 的旧 bug）。
 */
function championOf(imp) {
  return chooseRefinePipeline(imp).pipeline;
}

module.exports = {
  inspectShape,
  chooseRefinePipeline,
  championOf,
  hasRealFrontend,
  isKnownAmbiguous
};
