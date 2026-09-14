'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { isolatedEnv, htmlPayload, assertPackedContents, acceptanceOptions } = require('../scripts/verify-packed-delivery');

test('offline package acceptance requires explicit cache and records selected mode', () => {
  const cache = path.resolve('preloaded-cache');
  assert.deepEqual(acceptanceOptions(['--offline', '--npm-cache', cache]), { offline: true, npmCache: cache });
  assert.deepEqual(acceptanceOptions([]), {});
  assert.throws(() => acceptanceOptions(['--offline']), /preloaded/);
  assert.throws(() => acceptanceOptions(['--npm-cache', 'relative']), /absolute/);
  assert.throws(() => acceptanceOptions(['--npm-cache']), /absolute/);
  assert.throws(() => acceptanceOptions(['--unknown']), /Unknown/);
});

test('packed acceptance forwards only runtime environment, never provider credentials or hooks', () => {
  const owned = path.resolve('owned-acceptance');
  const env = isolatedEnv(owned, {
    PATH: '/node/bin', SystemRoot: 'C:\\Windows', OPENAI_API_KEY: 'secret',
    DEEPSEEK_API_KEY: 'secret', CUSTOM_API_TOKEN: 'secret',
    NODE_OPTIONS: '--require malicious.js', AV_ARCHIFY_CLI: 'external',
    npm_config_registry: 'https://private.invalid', HOME: '/user'
  });
  assert.equal(env.PATH, '/node/bin');
  assert.equal(env.SystemRoot, 'C:\\Windows');
  assert.equal(env.HOME, owned);
  assert.equal(env.TMPDIR, owned);
  assert.equal(env.AV_BASELINE, 'snapshot');
  for (const key of ['OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'CUSTOM_API_TOKEN',
    'NODE_OPTIONS', 'AV_ARCHIFY_CLI', 'npm_config_registry']) {
    assert.equal(env[key], undefined);
  }
});

test('packed acceptance reads completeness from embedded HTML JSON without executing it', () => {
  const data = { analysis: { status: 'incomplete', allowGreen: false }, risk: { level: 'medium' } };
  assert.deepEqual(htmlPayload(`<script>const REPORT_DATA = ${JSON.stringify(data)};\n</script>`), data);
  assert.throws(() => htmlPayload('<html>No report data</html>'), /Missing embedded/);
});

test('packed acceptance rejects remote and relative external script dependencies', () => {
  for (const src of ['https://cdn.invalid/a.js', '//cdn.invalid/a.js', './local.js']) {
    assert.throws(() => htmlPayload(`<SCRIPT SRC="${src}"></SCRIPT>`), /inline scripts only/);
  }
});

test('packed acceptance requires delivery scope and excludes source-session artifacts', () => {
  const docs = [{ path: 'docs/delivery-scope.md' }];
  assert.doesNotThrow(() => assertPackedContents(docs));
  assert.throws(() => assertPackedContents([]), /delivery-scope/);
  assert.throws(() => assertPackedContents([...docs, { path: '.av/graph-baseline.json' }]), /Source-session/);
});
