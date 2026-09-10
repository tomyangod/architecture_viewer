'use strict';

/**
 * Analyzer interface — pluggable architecture analysis adapters.
 *
 * Design:
 *   - Built-in analyzer wraps buildGraph + evaluateRisk + contract-rules.
 *   - Adapters emit the Unified Intermediate Format (UIF).
 *
 * UIF shape:
 *   {
 *     nodes:       [{ id, name, kind, path, layer, modifiers, methods }],
 *     edges:       [{ from, to, type, file, line }],
 *     violations:  [{ rule, severity, title, message, detail, file, line,
 *                     from, to, fromLayer, toLayer, edgeType, sourceAnalyzer, confidence }],
 *     evidence:    { sourceAnalyzer, available, configured, error, ...details },
 *     sourceAnalyzer: 'builtin',
 *     confidence:     'high' | 'medium' | 'low'
 *   }
 *
 * Lifecycle:
 *   1. isAvailable(repo) — detect tool/config presence (sync, cheap)
 *   2. analyze(repo, { baseline, diff, options }) — produce UIF partial (sync)
 *   3. generateConfigSuggestion(repo) — optional draft config (null when N/A)
 *   4. mergeResults(partials, { repo }) — normalize identities, dedup and merge
 */

const ERROR_TYPES = {
  MISSING_TOOL: 'missing_tool',
  CONFIG_ERROR: 'config_error',
  TIMEOUT: 'timeout',
  PARSE_ERROR: 'parse_error',
  EXEC_ERROR: 'exec_error'
};

const ERROR_SEVERITY = {
  missing_tool: 'info',
  config_error: 'medium',
  timeout: 'medium',
  parse_error: 'high',
  exec_error: 'high'
};

const ANALYZER_IDS = {
  BUILTIN: 'builtin'
};

const CONFIDENCE = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
};

/**
 * @typedef {Object} AnalyzerResult
 * @property {string} sourceAnalyzer
 * @property {'high'|'medium'|'low'} confidence
 * @property {Array} nodes
 * @property {Array} edges
 * @property {Array} violations
 * @property {{sourceAnalyzer: string, available: boolean, configured: boolean,
 *             error: string|null, errorType?: string}} evidence
 */

/**
 * @typedef {Object} Analyzer
 * @property {string} id - one of ANALYZER_IDS
 * @property {string[]} languages - e.g. ['*'] for builtin
 * @property {function(string): boolean} isAvailable - returns true if tool/config detected
 * @property {function(string, Object): AnalyzerResult} analyze - produce UIF partial
 * @property {function(string): (Object|null)} [generateConfigSuggestion] - draft config or null
 */

function severityForErrorType(errorType) {
  return ERROR_SEVERITY[errorType] || ERROR_SEVERITY.exec_error;
}

/**
 * Classify an analyzer failure so callers do not treat "tool missing"
 * the same as "output unparseable".
 * @param {{error?: string|null, reason?: string|null, available?: boolean,
 *          configured?: boolean, timeout?: boolean}} evidence
 * @returns {'missing_tool'|'config_error'|'timeout'|'parse_error'|'exec_error'}
 */
function classifyAnalyzerError(evidence) {
  const ev = evidence || {};
  const text = `${ev.error || ''} ${ev.reason || ''}`;
  if (ev.timeout === true || /ETIMEDOUT|timed out|TIMEOUT/i.test(text)) return ERROR_TYPES.TIMEOUT;
  if (/JSON parse|parse failed|Unrecognized|Invalid .*JSON|无法解析|missing contract summary/i.test(text)) {
    return ERROR_TYPES.PARSE_ERROR;
  }
  if (/config(uration)?|no config|contract configuration|layers\.json/i.test(text)) {
    return ERROR_TYPES.CONFIG_ERROR;
  }
  if (ev.available === false || /not installed|missing.?tool|ENOENT/i.test(text)) {
    return ERROR_TYPES.MISSING_TOOL;
  }
  if (ev.configured === false) return ERROR_TYPES.CONFIG_ERROR;
  return ERROR_TYPES.EXEC_ERROR;
}

function createEvidence(sourceAnalyzer, details = {}) {
  if (typeof details.available !== 'boolean') {
    throw new TypeError(`${sourceAnalyzer} evidence.available must be a boolean`);
  }
  if (typeof details.configured !== 'boolean') {
    throw new TypeError(`${sourceAnalyzer} evidence.configured must be a boolean`);
  }
  return {
    sourceAnalyzer,
    ...details,
    error: details.error == null ? null : String(details.error)
  };
}

module.exports = {
  ANALYZER_IDS,
  CONFIDENCE,
  ERROR_TYPES,
  ERROR_SEVERITY,
  createEvidence,
  classifyAnalyzerError,
  severityForErrorType
};
