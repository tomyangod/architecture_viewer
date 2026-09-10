'use strict';

/**
 * Analyzers entry point.
 *
 * Built-in always runs (graph extract + risk rules + Import Linter contract
 * evaluation on the builtin graph). External CLI adapters were removed;
 * put team rules in architecture-rules.yaml / .importlinter (read by builtin).
 */

const builtin = require('./builtin');
const { mergeResults } = require('./merge');
const { ANALYZER_IDS, CONFIDENCE, classifyAnalyzerError, severityForErrorType } = require('./analyzer');
const path = require('path');

/**
 * Run the built-in analyzer.
 *
 * @param {string} repo
 * @param {Object} [ctx] - { baseline, diff, impact, rules, current, ... }
 * @returns {{merged: AnalyzerResult, sources: Object[]}}
 */
function runAnalyzers(repo, ctx = {}) {
  repo = path.resolve(repo);
  const builtinResult = builtin.analyze(repo, ctx);
  const sources = [{
    id: builtin.id,
    available: true,
    configured: true,
    violations: builtinResult.violations.length,
    error: null,
    reason: null,
    evidence: builtinResult.evidence
  }];

  const merged = mergeResults([builtinResult], { repo });
  return { merged, sources };
}

module.exports = {
  builtinAnalyzer: builtin,
  mergeResults,
  runAnalyzers,
  ANALYZER_IDS,
  CONFIDENCE,
  classifyAnalyzerError,
  severityForErrorType
};
