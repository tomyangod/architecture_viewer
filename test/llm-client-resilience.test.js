'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { modelFor, backoffMs, isRetryableError, endpointList, chat } = require('../lib/llm-client');

describe('llm client resilience', () => {
  const saved = {};
  beforeEach(() => {
    for (const k of [
      'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_FALLBACK_BASE_URL',
      'DEEPSEEK_MODEL', 'DEEPSEEK_MODEL_BLIND', 'DEEPSEEK_MODEL_GENERATE', 'DEEPSEEK_TIMEOUT_MS'
    ]) {
      saved[k] = process.env[k];
    }
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    process.env.DEEPSEEK_BASE_URL = 'https://primary.example';
    delete process.env.DEEPSEEK_FALLBACK_BASE_URL;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('picks per-scene models and exponential backoff', () => {
    process.env.DEEPSEEK_MODEL = 'deepseek-chat';
    process.env.DEEPSEEK_MODEL_BLIND = 'deepseek-reasoner';
    process.env.DEEPSEEK_MODEL_GENERATE = 'deepseek-fast';
    assert.equal(modelFor('blind'), 'deepseek-reasoner');
    assert.equal(modelFor('generate'), 'deepseek-fast');
    assert.equal(modelFor('explain'), 'deepseek-chat');
    assert.equal(backoffMs(0), 400);
    assert.equal(backoffMs(1), 800);
    assert.equal(backoffMs(4), 6400);
    assert.ok(isRetryableError(new Error('ETIMEDOUT')));
    assert.ok(!isRetryableError(Object.assign(new Error('fatal'), { fatal: true })));
  });

  it('lists fallback endpoint after primary', () => {
    process.env.DEEPSEEK_FALLBACK_BASE_URL = 'https://backup.example';
    assert.deepEqual(endpointList(), ['https://primary.example', 'https://backup.example']);
  });

  it('retries then uses fallback base URL', async () => {
    process.env.DEEPSEEK_FALLBACK_BASE_URL = 'https://backup.example';
    const hits = [];
    const orig = global.fetch;
    global.fetch = async (url) => {
      hits.push(String(url));
      if (String(url).includes('primary.example')) {
        return { ok: false, status: 503, text: async () => 'busy' };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{ message: { content: 'ok-from-fallback' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 }
        })
      };
    };
    try {
      const content = await chat([{ role: 'user', content: 'hi' }], { maxRetries: 0, timeoutMs: 2000 });
      assert.equal(content, 'ok-from-fallback');
      assert.ok(hits.some((u) => u.includes('backup.example')));
    } finally {
      global.fetch = orig;
    }
  });

  it('aborts after timeout budget', async () => {
    const orig = global.fetch;
    global.fetch = (_url, opts) => new Promise((_, reject) => {
      if (opts && opts.signal) {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('This operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
    });
    try {
      await assert.rejects(
        () => chat([{ role: 'user', content: 'hi' }], { maxRetries: 0, timeoutMs: 30 }),
        /AbortError|aborted/i
      );
    } finally {
      global.fetch = orig;
    }
  });
});
