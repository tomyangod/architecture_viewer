'use strict';

/**
 * Built-in analyzer — wraps existing buildGraph + evaluateRisk.
 *
 * This adapter produces the same nodes/edges/violations that the session
 * report already consumes. It exists so that the pluggable analyzer pipeline
 * has a zero-dependency fallback that always works.
 *
 * Reuses the caller's graph so all analyzers see the same session snapshot.
 */

const { buildGraph } = require('../extract-graph');
const { evaluateRisk, loadSessionRules } = require('../risk-rules');
const { ANALYZER_IDS, CONFIDENCE, createEvidence } = require('./analyzer');
const { evaluateContracts } = require('./contract-rules');

const id = ANALYZER_IDS.BUILTIN;
const languages = ['*'];

function isAvailable(_repo) {
  return true;
}

/**
 * Produce a UIF partial from the built-in graph extractor + risk engine.
 *
 * @param {string} repo - absolute path to workspace root
 * @param {Object} [ctx] - optional context { baseline, diff, impact, rules }
 * @returns {AnalyzerResult}
 */
function analyze(repo, ctx = {}) {
  // Prefer the caller's snapshot. Session report already incremental-diffs
  // against baseline; a second full extract here would double large-repo cost.
  const current = ctx.current || buildGraph(repo, { calls: true });

  let baseline = ctx.baseline || null;
  let diff = ctx.diff || null;

  if (!baseline && ctx.baselinePath) {
    const fs = require('fs');
    if (fs.existsSync(ctx.baselinePath)) {
      baseline = JSON.parse(fs.readFileSync(ctx.baselinePath, 'utf8'));
    }
  }

  if (!diff && baseline) {
    const { diffGraphs } = require('../diff-graph');
    diff = diffGraphs(baseline, current);
  }

  const teamRules = ctx.rules === undefined ? loadSessionRules(repo) : ctx.rules;

  const impact = ctx.impact || null;
  const findings = diff
    ? evaluateRisk(diff, current, baseline || {}, impact, {
      rules: teamRules,
      repo,
      testIndexBase: ctx.testIndexBase || (baseline && baseline.testIndex) || null,
      testIndexHead: ctx.testIndexHead || null
    })
    : [];

  const violations = findings.map((f) => ({
    ...f,
    sourceAnalyzer: id,
    confidence: CONFIDENCE.MEDIUM
  }));

  const contracts = evaluateContracts(current, repo, { diff: diff || undefined });
  for (const finding of contracts.findings) {
    const dup = violations.findIndex((v) =>
      v.rule === finding.rule && v.from === finding.from && v.to === finding.to
    );
    if (dup === -1) violations.push(finding);
    else if (violations[dup].reportOnly && !finding.reportOnly) violations[dup] = finding;
  }

  return {
    sourceAnalyzer: id,
    confidence: CONFIDENCE.MEDIUM,
    nodes: current.nodes || [],
    edges: current.edges || [],
    violations,
    evidence: createEvidence(id, {
      available: true,
      configured: true,
      error: null,
      version: require('../../package.json').version,
      languages: current.languages || [],
      contracts: contracts.evidence
    })
  };
}

function generateConfigSuggestion(_repo) {
  return null;
}

module.exports = { id, languages, isAvailable, analyze, generateConfigSuggestion };
