'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createEvidence } = require('../lib/analyzers/analyzer');
const { runAnalyzers } = require('../lib/analyzers');

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-analyzer-evidence-'));
  fs.writeFileSync(path.join(repo, 'index.js'), 'export const value = 1;\n');
  return repo;
}

describe('analyzer evidence contract', () => {
  it('always exposes available/configured/error and normalizes successful error to null', () => {
    assert.deepEqual(createEvidence('test', {
      available: true,
      configured: true
    }), {
      sourceAnalyzer: 'test',
      available: true,
      configured: true,
      error: null
    });
  });

  it('rejects evidence that omits availability or configuration state', () => {
    assert.throws(() => createEvidence('test', { configured: true }), /available/);
    assert.throws(() => createEvidence('test', { available: true }), /configured/);
  });

  it('runAnalyzers reports only the builtin source', () => {
    const repo = makeRepo();
    try {
      const { sources, merged } = runAnalyzers(repo);
      assert.equal(sources.length, 1);
      assert.equal(sources[0].id, 'builtin');
      assert.equal(sources[0].available, true);
      assert.equal(sources[0].configured, true);
      assert.equal(sources[0].error, null);
      assert.equal(merged.violations.some((finding) => finding.rule === 'analyzer-error'), false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
