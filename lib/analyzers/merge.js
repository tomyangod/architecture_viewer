'use strict';

/**
 * Merge multiple analyzer results (UIF partials) into a single result.
 *
 * Dedup strategy:
 *   - Nodes: dedup by id (first wins; external analyzers supplement, not replace)
 *   - Edges: dedup by from+to+type (first wins)
 *   - Violations: dedup by from+to+rule (first wins, but keep sourceAnalyzer
 *     of the highest-confidence analyzer that reported it)
 *
 * Confidence ranking: high > medium > low. When the same violation is
 * reported by both builtin (medium) and dep-cruiser (high), the merged
 * result keeps the dep-cruiser evidence but preserves the builtin as a
 * secondary source.
 */

const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 };
const { normalizeFilePath } = require('./paths');
const SHARED_RULES = new Set(['layer-skip', 'circular-import', 'cross-layer-violation', 'forbid-cross-layer']);

function violationIdentity(v, result, repo, sequence) {
  const source = v.sourceAnalyzer || result.sourceAnalyzer;
  const rule = v.ruleIdentity || (SHARED_RULES.has(v.rule) ? v.rule : `${source}:${v.rule}`);

  // Circular imports are identified by the SET of files in the cycle,
  // not by the directed edge that triggered the report. Two analyzers
  // may report the same ring from different starting edges (a→b vs b→a);
  // sorted, deduplicated cycle members produce a canonical identity.
  if (rule === 'circular-import' && Array.isArray(v.cycleMembers) && v.cycleMembers.length > 0) {
    const { normalizeFilePath } = require('./paths');
    const members = [...new Set(
      v.cycleMembers
        .map((m) => normalizeFilePath(m, repo))
        .filter(Boolean)
    )].sort();
    if (members.length > 0) {
      return JSON.stringify(['cycle', ...members]);
    }
  }

  const from = normalizeFilePath(v.from || v.file, repo);
  const to = normalizeFilePath(v.to, repo);
  // Missing locations do not establish equivalence between contract failures.
  if (!from) return JSON.stringify(['unlocated', sequence]);
  // For shared rules, only rule + endpoints + edge type determine identity.
  // importLinterContract/importChain/depcruiseType are supplementary metadata
  // preserved on the merged result but must NOT split the dedup key — otherwise
  // the same cross-layer-violation reported by builtin (no contract metadata)
  // and Import Linter (with contract name + chain) becomes two findings.
  if (SHARED_RULES.has(rule)) {
    return JSON.stringify([rule, from, to, v.edgeType || 'import']);
  }
  return JSON.stringify([
    rule, from, to, v.edgeType || 'import', to ? null : (v.line ?? null),
    v.importLinterContract || null, v.importChain || null,
    v.depcruiseType || null
  ]);
}

/**
 * @param {AnalyzerResult[]} results - array of UIF partials
 * @param {{repo?: string}} [options] - repo enables absolute/relative file identity normalization
 * @returns {AnalyzerResult} merged result
 */
function mergeResults(results, options = {}) {
  if (!results || results.length === 0) {
    return { sourceAnalyzer: 'merged', confidence: 'low', nodes: [], edges: [], violations: [], evidence: { sources: [] } };
  }

  const normalized = normalizeResults(results, options.repo);

  if (results.length === 1) {
    const r = results[0];
    const order = { high: 0, medium: 1, low: 2, info: 3 };
    const violations = (r.violations || []).slice()
      .sort((a, b) => (order[a.severity] ?? 4) - (order[b.severity] ?? 4));
    return { ...r, violations, sourceAnalyzer: r.sourceAnalyzer };
  }

  const nodeMap = new Map();
  const edgeMap = new Map();
  const violationMap = new Map();
  const sources = [];
  let sequence = 0;

  for (const [resultIndex, r] of results.entries()) {
    const comparable = normalized[resultIndex];
    if (r.evidence) sources.push(r.evidence);

    for (const [nodeIndex, n] of (r.nodes || []).entries()) {
      const key = comparable.nodes[nodeIndex].id;
      if (!nodeMap.has(key)) nodeMap.set(key, n);
    }

    for (const [edgeIndex, e] of (r.edges || []).entries()) {
      const comparison = comparable.edges[edgeIndex];
      const key = `${comparison.from}→${comparison.to}(${comparison.type})`;
      if (!edgeMap.has(key)) {
        const edge = { ...e };
        if (e.from !== undefined) edge.from = nodeMap.get(comparison.from)?.id || e.from;
        if (e.to !== undefined) edge.to = nodeMap.get(comparison.to)?.id || e.to;
        edgeMap.set(key, edge);
      }
    }

    for (const [violationIndex, v] of (r.violations || []).entries()) {
      const key = violationIdentity(comparable.violations[violationIndex], r, options.repo, sequence++);
      const existing = violationMap.get(key);
      if (!existing) {
        violationMap.set(key, { ...v });
      } else {
        // Keep the one with higher confidence
        const existingRank = CONFIDENCE_RANK[existing.confidence] ?? 3;
        const newRank = CONFIDENCE_RANK[v.confidence] ?? 3;
        if (newRank < existingRank) {
          const secondarySources = [...new Set([...(existing.secondarySources || []), existing.sourceAnalyzer, ...(v.secondarySources || [])])]
            .filter((source) => source && source !== v.sourceAnalyzer);
          violationMap.set(key, {
            ...v,
            ...(secondarySources.length ? { secondarySource: secondarySources[0], secondarySources } : {})
          });
        } else {
          existing.secondarySources = [...new Set([...(existing.secondarySources || []), ...(v.secondarySources || []), v.sourceAnalyzer])]
            .filter((source) => source && source !== existing.sourceAnalyzer);
          if (existing.secondarySources.length) existing.secondarySource = existing.secondarySources[0];
        }
      }
    }
  }

  // Sort violations by severity (high first)
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  const violations = Array.from(violationMap.values())
    .sort((a, b) => (order[a.severity] ?? 4) - (order[b.severity] ?? 4));

  // Determine overall confidence: if any analyzer was 'high', merged is 'high'
  const allConfidences = normalized.map((r) => r.confidence).filter(Boolean);
  const mergedConfidence = allConfidences.includes('high') ? 'high'
    : allConfidences.includes('medium') ? 'medium'
    : 'low';

  return {
    sourceAnalyzer: 'merged',
    confidence: mergedConfidence,
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
    violations,
    evidence: { sources }
  };
}

function normalizeResults(results, repo) {
  if (!repo) return results;
  const root = require('path').resolve(repo);
  const path = require('path');
  const aliases = new Map();

  function portable(value) {
    return value.replace(/\\/g, '/');
  }

  function normalizeFileValue(value) {
    if (typeof value !== 'string' || !value) return value;
    const hasFilePrefix = value.startsWith('file:');
    let raw = portable(hasFilePrefix ? value.slice(5) : value);
    const looksLikePath = hasFilePrefix || path.isAbsolute(raw) || /[\\/]/.test(raw);
    if (!looksLikePath) return value;
    if (path.isAbsolute(raw)) {
      const relative = path.relative(root, path.resolve(raw));
      raw = relative && !relative.startsWith('..') && !path.isAbsolute(relative)
        ? relative
        : path.resolve(raw);
    }
    raw = portable(path.normalize(raw)).replace(/^\.\//, '');
    return hasFilePrefix ? `file:${raw}` : raw;
  }

  function registerAlias(alias, canonical) {
    if (typeof alias !== 'string' || !alias) return;
    aliases.set(alias, canonical);
    aliases.set(normalizeFileValue(alias), canonical);
  }

  const normalizedNodes = results.map((result) => ({
    ...result,
    nodes: (result.nodes || []).map((node) => {
      const normalizedPath = normalizeFileValue(node.path);
      const normalizedId = normalizeFileValue(node.id);
      const canonicalId = normalizedId || node.id;
      registerAlias(node.id, canonicalId);
      if (normalizedPath && (node.kind === 'file' || node.id?.startsWith('file:'))) {
        registerAlias(node.path, canonicalId);
        registerAlias(normalizedPath, canonicalId);
        registerAlias(path.resolve(root, normalizedPath), canonicalId);
        registerAlias(`file:${normalizedPath}`, canonicalId);
      }
      return {
        ...node,
        ...(canonicalId !== undefined ? { id: canonicalId } : {}),
        ...(normalizedPath !== undefined ? { path: normalizedPath } : {})
      };
    })
  }));

  function endpoint(value) {
    if (typeof value !== 'string' || !value) return value;
    return aliases.get(value) || aliases.get(normalizeFileValue(value)) || normalizeFileValue(value);
  }

  function normalizeLocation(item) {
    const normalized = { ...item };
    if (item.from !== undefined) normalized.from = endpoint(item.from);
    if (item.to !== undefined) normalized.to = endpoint(item.to);
    if (item.file !== undefined) normalized.file = normalizeFileValue(item.file);
    if (Array.isArray(item.cycleMembers)) {
      normalized.cycleMembers = item.cycleMembers
        .map((m) => typeof m === 'string' ? normalizeFileValue(m) : m)
        .filter(Boolean);
    }
    return normalized;
  }

  return normalizedNodes.map((result) => ({
    ...result,
    edges: (result.edges || []).map(normalizeLocation),
    violations: (result.violations || []).map(normalizeLocation)
  }));
}

module.exports = { mergeResults, normalizeResults, CONFIDENCE_RANK };
