'use strict';

/**
 * Delivery contract for session-report payloads (Archify-inspired fail-closed).
 * HTML/JSON deliverables must carry schemaVersion + required sections or we refuse.
 */

const REPORT_SCHEMA_VERSION = 2;

const REQUIRED_TOP = [
  'schemaVersion', 'repo', 'generatedAt', 'baseFingerprint', 'headFingerprint',
  'summary', 'risk', 'entities', 'edges', 'modified', 'moved', 'renamed', 'rerouted',
  'extAdded', 'extRemoved', 'layers', 'structure'
];

const REQUIRED_SUMMARY = [
  'addedNodes', 'removedNodes', 'modifiedNodes', 'movedNodes', 'renamedNodes',
  'addedEdges', 'removedEdges', 'reroutedEdges',
  'addedArchitecturalEdges', 'removedArchitecturalEdges',
  'violations', 'totalChanges'
];

/**
 * Upgrade a stored report toward schemaVersion 2 (idempotent).
 * v1 used summary.riskLevel; v2 splits risk.level vs summary.changeScale.
 */
function migrateReport(data) {
  if (!data || typeof data !== 'object') return data;
  const version = Number(data.schemaVersion) || 0;
  if (version >= REPORT_SCHEMA_VERSION) return data;
  const out = { ...data };
  const summary = { ...(out.summary || {}) };
  const risk = { ...(out.risk || {}) };
  if (summary.riskLevel && !risk.level) risk.level = String(summary.riskLevel);
  if (!Array.isArray(risk.findings)) {
    risk.findings = Array.isArray(out.findings) ? out.findings : [];
  }
  if (typeof risk.level !== 'string') {
    risk.level = risk.findings.length ? String(risk.findings[0].severity || 'none') : 'none';
  }
  delete summary.riskLevel;
  if (typeof summary.totalChanges !== 'number') summary.totalChanges = 0;
  for (const key of REQUIRED_SUMMARY) {
    if (typeof summary[key] !== 'number') summary[key] = 0;
  }
  if (typeof summary.changeScale !== 'string') {
    const n = Number(summary.totalChanges) || 0;
    summary.changeScale = n >= 20 ? 'large' : n >= 5 ? 'medium' : n > 0 ? 'small' : 'none';
  }
  if (!out.structure || !Array.isArray(out.structure.files) || !Array.isArray(out.structure.deps)) {
    out.structure = {
      files: (out.structure && out.structure.files) || [],
      deps: (out.structure && out.structure.deps) || []
    };
  }
  for (const key of REQUIRED_TOP) {
    if (key === 'schemaVersion' || key === 'summary' || key === 'risk' || key === 'structure') continue;
    if (!(key in out)) out[key] = Array.isArray(out[key]) ? out[key] : (key === 'layers' ? {} : []);
  }
  if (out.layers == null || typeof out.layers !== 'object') out.layers = {};
  out.summary = summary;
  out.risk = risk;
  if (!Array.isArray(out.findings)) out.findings = risk.findings;
  out.schemaVersion = REPORT_SCHEMA_VERSION;
  return out;
}

function assertReportContract(data, opts) {
  const payload = opts && opts.migrate ? migrateReport(data) : data;
  if (!payload || typeof payload !== 'object') {
    throw new Error('REPORT_CONTRACT: payload missing');
  }
  if (payload.schemaVersion !== REPORT_SCHEMA_VERSION) {
    throw new Error(`REPORT_CONTRACT: schemaVersion must be ${REPORT_SCHEMA_VERSION}, got ${payload.schemaVersion}`);
  }
  data = payload;
  for (const key of REQUIRED_TOP) {
    if (!(key in data)) throw new Error(`REPORT_CONTRACT: missing field "${key}"`);
  }
  if (!data.summary || typeof data.summary !== 'object') {
    throw new Error('REPORT_CONTRACT: summary must be an object');
  }
  for (const key of REQUIRED_SUMMARY) {
    if (typeof data.summary[key] !== 'number') {
      throw new Error(`REPORT_CONTRACT: summary.${key} must be a number`);
    }
  }
  if (!data.risk || !Array.isArray(data.risk.findings)) {
    throw new Error('REPORT_CONTRACT: risk.findings must be an array');
  }
  if (typeof data.risk.level !== 'string') {
    throw new Error('REPORT_CONTRACT: risk.level must be a string (authoritative findings severity)');
  }
  if (typeof data.summary.changeScale !== 'string') {
    throw new Error('REPORT_CONTRACT: summary.changeScale must be a string (volume heuristic, not risk)');
  }
  if ('riskLevel' in data.summary) {
    throw new Error('REPORT_CONTRACT: summary.riskLevel was removed in schemaVersion 2; use risk.level and summary.changeScale');
  }
  if (!Array.isArray(data.entities) || !Array.isArray(data.edges)) {
    throw new Error('REPORT_CONTRACT: entities/edges must be arrays');
  }
  if (!data.structure || !Array.isArray(data.structure.files) || !Array.isArray(data.structure.deps)) {
    throw new Error('REPORT_CONTRACT: structure.files/structure.deps must be arrays');
  }
  // Accessibility / machine-readable markers expected in rendered HTML are
  // checked separately via golden structure tests (graph-before/delta/after ids).
  return true;
}

/** Normalize volatile fields so golden fixtures compare stably. */
function normalizeReportForGolden(data) {
  const clone = JSON.parse(JSON.stringify(data));
  clone.generatedAt = '<timestamp>';
  if (clone.sessionStart) clone.sessionStart = '<session>';
  clone.baseFingerprint = '<fp-base>';
  clone.headFingerprint = '<fp-head>';
  // Sort arrays for stable order
  const sortById = (a, b) => String(a.id || '').localeCompare(String(b.id || ''));
  clone.entities = (clone.entities || []).slice().sort(sortById);
  clone.edges = (clone.edges || []).slice().sort((a, b) =>
    `${a.from}|${a.type}|${a.to}`.localeCompare(`${b.from}|${b.type}|${b.to}`));
  clone.modified = (clone.modified || []).slice().sort(sortById);
  clone.moved = (clone.moved || []).slice().sort(sortById);
  clone.renamed = (clone.renamed || []).slice().sort((a, b) =>
    String(a.oldName).localeCompare(String(b.oldName)));
  clone.rerouted = (clone.rerouted || []).slice().sort((a, b) =>
    `${a.from}|${a.to}`.localeCompare(`${b.from}|${b.to}`));
  if (clone.structure) {
    clone.structure.files = (clone.structure.files || []).slice().sort((a, b) =>
      String(a.path).localeCompare(String(b.path)));
    clone.structure.deps = (clone.structure.deps || []).slice().sort((a, b) =>
      String(a.name).localeCompare(String(b.name)));
  }
  if (clone.implementation && Array.isArray(clone.implementation.changes)) {
    clone.implementation.changes = clone.implementation.changes.slice().sort((a, b) =>
      `${a.path || ''}|${a.method || ''}`.localeCompare(`${b.path || ''}|${b.method || ''}`));
  }
  if (clone.reviewWalk) {
    const rw = clone.reviewWalk;
    if (Array.isArray(rw.steps)) {
      rw.steps = rw.steps.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    }
    if (Array.isArray(rw.skips)) {
      rw.skips = rw.skips.slice().sort((a, b) =>
        `${a.from || ''}|${a.to || ''}|${a.rule || ''}`.localeCompare(`${b.from || ''}|${b.to || ''}|${b.rule || ''}`));
    }
  }
  if (Array.isArray(clone.callEdges)) {
    clone.callEdges = clone.callEdges.slice().sort((a, b) =>
      `${a.from}|${a.to}|${a.line || ''}`.localeCompare(`${b.from}|${b.to}|${b.line || ''}`));
  }
  if (clone.awareness && Array.isArray(clone.awareness.cards)) {
    clone.awareness.cards = clone.awareness.cards.slice().sort((a, b) =>
      `${a.level || ''}|${a.rule || ''}|${a.file || ''}|${a.line || ''}`.localeCompare(
        `${b.level || ''}|${b.rule || ''}|${b.file || ''}|${b.line || ''}`));
  }
  if (clone.awareness && clone.awareness.portrait) {
    const p = clone.awareness.portrait;
    if (Array.isArray(p.entries)) {
      p.entries = p.entries.slice().sort((a, b) =>
        `${a.layer || ''}|${a.name || ''}`.localeCompare(`${b.layer || ''}|${b.name || ''}`));
    }
    if (Array.isArray(p.layersTouched)) {
      p.layersTouched = p.layersTouched.slice().sort((a, b) =>
        String(a.layer || '').localeCompare(String(b.layer || '')));
    }
    if (p.external) {
      p.external.added = (p.external.added || []).slice().sort();
      p.external.removed = (p.external.removed || []).slice().sort();
    }
  }
  return clone;
}

module.exports = {
  REPORT_SCHEMA_VERSION,
  assertReportContract,
  migrateReport,
  normalizeReportForGolden
};
