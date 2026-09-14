'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { version: packageVersion } = require('../package.json');

// Explicit package-source allowlist: never hash the scanned repository or git state.
const ANALYZER_SOURCE_FILES = Object.freeze([
  'lib/analysis-completeness.js',
  'lib/analyzers/analyzer.js',
  'lib/analyzers/builtin.js',
  'lib/analyzers/contract-config.js',
  'lib/analyzers/contract-rules.js',
  'lib/analyzers/index.js',
  'lib/analyzers/merge.js',
  'lib/analyzers/paths.js',
  'lib/cache.js',
  'lib/diff-graph.js',
  'lib/extract-graph.js',
  'lib/extract/behavior-fingerprint.js',
  'lib/extract/call-graph.js',
  'lib/extract/go.js',
  'lib/extract/java.js',
  'lib/extract/jsts-di.js',
  'lib/extract/jsts.js',
  'lib/extract/python.js',
  'lib/extract/routes.js',
  'lib/extract/shared.js',
  'lib/extract/signature.js',
  'lib/extract/svelte.js',
  'lib/extract/test-index.js',
  'lib/extract/vue.js',
  'lib/impact.js',
  'lib/impl-surface.js',
  'lib/layer-infer.js',
  'lib/report-contract.js',
  'lib/risk-rules.js',
  'lib/rules.js',
  'lib/runtime-identity.js',
  'lib/scan-ignore.js',
  'lib/session-baseline.js',
  'lib/session-intent.js',
  'lib/session-report.js',
  'lib/session-verdict.js',
  'lib/source-content.js',
  'mcp/server.js'
]);

const packageRoot = fs.realpathSync(path.join(__dirname, '..'));
const sourceDigestCapturedAt = new Date().toISOString();
const hash = crypto.createHash('sha256');
hash.update('arch-viewer-analyzer-source-v1\0');
for (const file of ANALYZER_SOURCE_FILES) {
  hash.update(file).update('\0').update(fs.readFileSync(path.join(packageRoot, file))).update('\0');
}
// Capture once at module load: a long-lived MCP must not claim code installed later.
const identity = Object.freeze({
  packageVersion,
  packageRoot,
  analyzerSourceDigest: hash.digest('hex'),
  digestAlgorithm: 'sha256',
  sourceDigestCapturedAt
});

function getRuntimeIdentity() {
  return { ...identity, scannedAt: new Date().toISOString() };
}

module.exports = { getRuntimeIdentity, ANALYZER_SOURCE_FILES };
