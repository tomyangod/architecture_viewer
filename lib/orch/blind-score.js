'use strict';

/**
 * Deterministic blind-review scoring.
 * LLM still fills per-dimension integers; winner / decisive are computed here
 * so the rule is explicit and weights are configurable.
 *
 * Env BLIND_DIM_WEIGHTS: JSON object overriding default weights.
 */

const DIMS = ['story', 'layer', 'edge', 'paths', 'naming', 'density', 'spec', 'deliverable'];

const DEFAULT_WEIGHTS = {
  story: 1.2,
  layer: 1.2,
  edge: 1.2,
  paths: 1.5,
  naming: 1,
  density: 0.8,
  spec: 0.8,
  deliverable: 1.5
};

function loadWeights(override) {
  let extra = {};
  if (override && typeof override === 'object') extra = override;
  else if (process.env.BLIND_DIM_WEIGHTS) {
    try { extra = JSON.parse(process.env.BLIND_DIM_WEIGHTS); } catch { extra = {}; }
  }
  const out = { ...DEFAULT_WEIGHTS };
  for (const k of DIMS) {
    const n = Number(extra[k]);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

function dimScore(side, dim) {
  const n = Number(side && side[dim]);
  return Number.isFinite(n) ? n : 0;
}

function weightedTotal(side, weights) {
  let sum = 0;
  let wsum = 0;
  for (const dim of DIMS) {
    const w = weights[dim];
    sum += dimScore(side, dim) * w;
    wsum += w;
  }
  return wsum ? sum / wsum : 0;
}

function maxGapDim(a, b) {
  let best = 'deliverable';
  let gap = -1;
  for (const dim of DIMS) {
    const g = Math.abs(dimScore(a, dim) - dimScore(b, dim));
    if (g > gap) {
      gap = g;
      best = dim;
    }
  }
  return { dim: best, gap };
}

/**
 * @param {object} scored - { A: dims, B: dims, winner?, decisive? }
 * @param {object} [opts] - { weights, tieMargin }
 * @returns {{ winner: 'A'|'B'|'tie', decisive: string, totals: {A:number,B:number}, gapDim: string }}
 */
function resolveBlindWinner(scored, opts) {
  const weights = loadWeights(opts && opts.weights);
  const tieMargin = (opts && opts.tieMargin != null) ? Number(opts.tieMargin) : 0.25;
  const a = scored && scored.A ? scored.A : {};
  const b = scored && scored.B ? scored.B : {};
  const totals = { A: weightedTotal(a, weights), B: weightedTotal(b, weights) };
  const { dim, gap } = maxGapDim(a, b);
  let winner = 'tie';
  if (totals.A - totals.B > tieMargin) winner = 'A';
  else if (totals.B - totals.A > tieMargin) winner = 'B';
  const decisive = `${dim} 分差最大（${gap.toFixed(1)}）：A ${dimScore(a, dim)} / B ${dimScore(b, dim)}；加权总分 A ${totals.A.toFixed(2)} / B ${totals.B.toFixed(2)}`;
  return { winner, decisive, totals, gapDim: dim, weights };
}

module.exports = { DIMS, DEFAULT_WEIGHTS, loadWeights, resolveBlindWinner, weightedTotal };
