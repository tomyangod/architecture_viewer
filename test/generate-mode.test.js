'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { resolveGenerateMode, hasLlmKey } = require('../lib');

const orig = process.env.DEEPSEEK_API_KEY;

afterEach(() => {
  if (orig === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = orig;
});

describe('resolveGenerateMode', () => {
  it('explicit skeleton never falls back', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    const r = resolveGenerateMode('skeleton');
    assert.equal(r.engine, 'skeleton');
    assert.equal(r.fallback, false);
    assert.equal(r.reason, 'explicit');
  });

  it('llm without key falls back to skeleton', () => {
    delete process.env.DEEPSEEK_API_KEY;
    const r = resolveGenerateMode('llm');
    assert.equal(r.engine, 'skeleton');
    assert.equal(r.fallback, true);
    assert.equal(r.reason, 'no-key');
    assert.equal(hasLlmKey(), false);
  });

  it('llm with env key uses llm', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    const r = resolveGenerateMode('llm');
    assert.equal(r.engine, 'llm');
    assert.equal(r.fallback, false);
    assert.equal(r.reason, 'explicit');
  });

  it('per-request key works without env', () => {
    delete process.env.DEEPSEEK_API_KEY;
    const r = resolveGenerateMode('llm', ' sk-user ');
    assert.equal(r.engine, 'llm');
    assert.equal(hasLlmKey(' sk-user '), true);
  });

  it('default (no requested mode) uses llm when key present', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    const r = resolveGenerateMode(undefined);
    assert.equal(r.engine, 'llm');
    assert.equal(r.reason, 'default-key');
  });

  it('refine alias matches llm', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    const r = resolveGenerateMode('refine');
    assert.equal(r.engine, 'llm');
    assert.equal(r.reason, 'explicit');
  });

  it('strict refine without key throws Chinese product message', () => {
    delete process.env.DEEPSEEK_API_KEY;
    assert.throws(() => resolveGenerateMode('refine', undefined, { strict: true }), (err) => {
      assert.equal(err.code, 'LLM_KEY_MISSING');
      assert.match(err.message, /精修|DEEPSEEK_API_KEY/);
      return true;
    });
  });
});
