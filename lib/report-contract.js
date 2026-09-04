'use strict';

/**
 * Delivery contract for session-report payloads (Archify-inspired fail-closed).
 * HTML/JSON deliverables must carry schemaVersion + required sections or we refuse.
 */

const REPORT_SCHEMA_VERSION = 1;

const REQUIRED_TOP = [
  'schemaVersion', 'repo', 'generatedAt', 'baseFingerprint', 'headFingerprint',
  'summary', 'risk', 'entities', 'edges', 'modified', 'moved', 'renamed', 'rerouted',
  'extAdded', 'extRemoved', 'layers'
];

const REQUIRED_SUMMARY = [
  'addedNodes', 'removedNodes', 'modifiedNodes', 'movedNodes', 'renamedNodes',
  'addedEdges', 'removedEdges', 'reroutedEdges', 'violations', 'totalChanges'
];

function assertReportContract(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('REPORT_CONTRACT: payload missing');
  }
  if (data.schemaVersion !== REPORT_SCHEMA_VERSION) {
    throw new Error(`REPORT_CONTRACT: schemaVersion must be ${REPORT_SCHEMA_VERSION}, got ${data.schemaVersion}`);
  }
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
  if (!Array.isArray(data.entities) || !Array.isArray(data.edges)) {
    throw new Error('REPORT_CONTRACT: entities/edges must be arrays');
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
  return clone;
}

module.exports = {
  REPORT_SCHEMA_VERSION,
  assertReportContract,
  normalizeReportForGolden
};
