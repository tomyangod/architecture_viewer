'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classifyAnalyzerError, severityForErrorType, ERROR_TYPES } = require('../lib/analyzers/analyzer');
const { builtinAnalyzer } = require('../lib/analyzers');

describe('analyzer error classification', () => {
  it('maps missing tool / config / timeout / parse / exec', () => {
    assert.equal(classifyAnalyzerError({ available: false, error: 'depcruise not installed' }), ERROR_TYPES.MISSING_TOOL);
    assert.equal(classifyAnalyzerError({ available: true, configured: false, error: 'no config found' }), ERROR_TYPES.CONFIG_ERROR);
    assert.equal(classifyAnalyzerError({ error: 'JSON parse failed: Unexpected token' }), ERROR_TYPES.PARSE_ERROR);
    assert.equal(classifyAnalyzerError({ error: 'timed out after 30000ms', timeout: true }), ERROR_TYPES.TIMEOUT);
    assert.equal(classifyAnalyzerError({ available: true, configured: true, error: 'exited 2' }), ERROR_TYPES.EXEC_ERROR);
  });

  it('uses info/medium/high by error type', () => {
    assert.equal(severityForErrorType('missing_tool'), 'info');
    assert.equal(severityForErrorType('config_error'), 'medium');
    assert.equal(severityForErrorType('timeout'), 'medium');
    assert.equal(severityForErrorType('parse_error'), 'high');
    assert.equal(severityForErrorType('exec_error'), 'high');
  });

  it('builtin implements generateConfigSuggestion as a no-op', () => {
    assert.equal(typeof builtinAnalyzer.generateConfigSuggestion, 'function');
    assert.equal(builtinAnalyzer.generateConfigSuggestion('/tmp'), null);
  });
});
