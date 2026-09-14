'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { buildGraph, toPersistableGraph } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { evaluateRisk } = require('../lib/risk-rules');
const { changedFilesFromGraphs } = require('../lib/extract/call-graph');
const { resolveSessionBaseline, headCachePath } = require('../lib/session-baseline');
const {
  SOURCE_CONTENT_HASH_VERSION,
  normalizeSourceContent,
  hashSourceContent,
  compareSourceContentHashes
} = require('../lib/source-content');

function fixture(t, files) {
  const dir = fs.mkdtempSync(path.join(__dirname, '.source-content-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (contents) => {
    for (const [name, source] of Object.entries(contents)) {
      const abs = path.join(dir, name);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, source);
    }
  };
  write(files);
  return { dir, write };
}

const sourceFiles = {
  'src/app.js': 'export function greet(name) {\n  return `Hello ${name}`;\n}\n',
  'src/typed.ts': 'export function typed(name: string): string {\n  return name;\n}\n',
  'src/app.py': 'def greet(name):\n    return "Hello " + name\n',
  'src/App.java': 'class App {\n  String greet(String name) {\n    return "Hello " + name;\n  }\n}\n',
  'src/app.go': 'package app\nfunc Greet(name string) string {\n  return "Hello " + name\n}\n',
  'src/App.vue': '<script setup>\nfunction greet() {\n  return "Hello";\n}\n</script>\n<template><p>Hello</p></template>\n',
  'src/App.svelte': '<script>\nfunction greet() {\n  return "Hello";\n}\n</script>\n<p>Hello</p>\n',
  'migrations/001.sql': 'CREATE TABLE accounts (\n  id INTEGER PRIMARY KEY\n);\n',
  'schema.prisma': 'model Account {\n  id Int @id\n}\n'
};

test('source hashing ignores CRLF only, preserving whitespace and real content', () => {
  assert.equal(normalizeSourceContent(Buffer.from('a\r\nb\rc \t\n')), 'a\nb\rc \t\n');
  const content = 'function f() {\n  return "hello world";\n}\n';
  assert.equal(hashSourceContent(content), hashSourceContent(content.replace(/\n/g, '\r\n')));
  for (const changed of [
    content.replace('  return', '\treturn'),
    content.replace('hello world', 'hello  world'),
    content.replace(';\n', '; \n'),
    content.slice(0, -1),
    content.replace('\n', '\r')
  ]) {
    assert.notEqual(hashSourceContent(content), hashSourceContent(changed));
  }
});

test('LF/CRLF conversion preserves source, schema, signature, body and incremental attribution', (t) => {
  const { dir, write } = fixture(t, sourceFiles);
  const base = toPersistableGraph(buildGraph(dir));
  assert.equal(base.stats.parseErrors, 0);
  assert.equal(base.sourceContentHashVersion, SOURCE_CONTENT_HASH_VERSION);
  for (const file of base.nodes.filter((node) => node.kind === 'file')) {
    assert.equal(file.contentHashVersion, SOURCE_CONTENT_HASH_VERSION);
  }
  write(Object.fromEntries(Object.entries(sourceFiles).map(([name, source]) => [name, source.replace(/\n/g, '\r\n')])));
  const head = buildGraph(dir);
  const diff = diffGraphs(base, head);
  assert.equal(head.stats.parseErrors, 0);
  assert.equal(base.contentFingerprint, head.contentFingerprint);
  assert.equal(diff.summary.sourceChanged, false);
  assert.equal(diff.summary.totalChanges, 0);
  assert.equal(diff.summary.implChangedCount, 0);
  assert.equal(diff.summary.behaviorChangedCount, 0);
  assert.deepEqual([...changedFilesFromGraphs(base, head)], []);
  assert.deepEqual(evaluateRisk(diff, head, base).filter((finding) => finding.rule === 'schema-touched'), []);
  assert.equal(diffGraphs(head, base).summary.sourceChanged, false);
});

test('normalized fingerprints still attribute actual source whitespace and schema changes', (t) => {
  const { dir, write } = fixture(t, sourceFiles);
  const base = buildGraph(dir);
  write({
    'src/app.js': sourceFiles['src/app.js'].replace('  return', '    return'),
    'migrations/001.sql': sourceFiles['migrations/001.sql'].replace('id INTEGER', 'id BIGINT')
  });
  const head = buildGraph(dir);
  const diff = diffGraphs(base, head);
  assert.equal(diff.summary.sourceChanged, true);
  assert.deepEqual([...changedFilesFromGraphs(base, head)].sort(), ['migrations/001.sql', 'src/app.js']);
  assert.equal(evaluateRisk(diff, head, base).filter((finding) => finding.rule === 'schema-touched').length, 1);
  write({ 'src/app.js': sourceFiles['src/app.js'].replace('Hello', 'Goodbye').replace(/\n/g, '\r\n') });
  const bodyDiff = diffGraphs(base, buildGraph(dir));
  assert.equal(bodyDiff.summary.sourceChanged, true);
  assert.equal(bodyDiff.summary.implChangedCount, 1);
});

test('legacy raw snapshots have explicit unknown migration instead of false source/schema changes', (t) => {
  const files = { 'src/app.js': sourceFiles['src/app.js'], 'migrations/001.sql': sourceFiles['migrations/001.sql'] };
  const { dir } = fixture(t, files);
  const head = buildGraph(dir);
  const legacy = JSON.parse(JSON.stringify(toPersistableGraph(head)));
  delete legacy.sourceContentHashVersion;
  const hashes = [];
  for (const node of legacy.nodes.filter((node) => node.kind === 'file')) {
    delete node.contentHashVersion;
    node.contentHash = crypto.createHash('sha256').update(files[node.path].replace(/\n/g, '\r\n')).digest('hex').slice(0, 16);
    hashes.push(node.path + '\0' + node.contentHash);
  }
  legacy.contentFingerprint = crypto.createHash('sha256').update(hashes.sort().join('\n')).digest('hex').slice(0, 16);
  const diff = diffGraphs(legacy, head);
  assert.equal(diff.summary.sourceChanged, null);
  assert.equal(diff.summary.sourceComparison, 'incompatible-hash-version');
  assert.equal(diff.summary.implChangedCount, 0);
  assert.deepEqual(evaluateRisk(diff, head, legacy).filter((finding) => finding.rule === 'schema-touched'), []);
  assert.deepEqual([...changedFilesFromGraphs(legacy, head)].sort(), Object.keys(files).sort());
  assert.equal(diffGraphs(head, legacy).summary.sourceChanged, null);
  assert.equal(diffGraphs(head, JSON.parse(JSON.stringify(head))).summary.sourceChanged, false);
});

test('hash comparison preserves legacy pairs and distinguishes unavailable migration evidence', () => {
  assert.equal(compareSourceContentHashes({ contentHash: 'a' }, { contentHash: 'b' }), true);
  assert.equal(compareSourceContentHashes({ contentHash: 'a' }, {
    contentHash: 'a', contentHashVersion: SOURCE_CONTENT_HASH_VERSION
  }), false);
  assert.equal(compareSourceContentHashes({ contentHash: 'a' }, {
    contentHash: 'b', contentHashVersion: SOURCE_CONTENT_HASH_VERSION
  }), null);
  assert.equal(compareSourceContentHashes({}, {}), null);
});

test('HEAD caches from raw-hash version 2 rebuild into normalized hashes', (t) => {
  const originalBaseline = process.env.AV_BASELINE;
  process.env.AV_BASELINE = '';
  t.after(() => {
    if (originalBaseline === undefined) delete process.env.AV_BASELINE;
    else process.env.AV_BASELINE = originalBaseline;
  });
  const { dir } = fixture(t, { 'src/app.js': sourceFiles['src/app.js'] });
  for (const args of [
    ['init', '-q'],
    ['add', 'src/app.js'],
    ['-c', 'user.name=av-test', '-c', 'user.email=av@test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']
  ]) {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const initial = resolveSessionBaseline(dir);
  assert.equal(initial.ok, true);
  const cachePath = headCachePath(dir);
  const legacyCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  legacyCache.baselineCacheVersion = 2;
  delete legacyCache.sourceContentHashVersion;
  fs.writeFileSync(cachePath, JSON.stringify(legacyCache));
  const refreshed = resolveSessionBaseline(dir);
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.cacheHit, false);
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert.equal(cache.baselineCacheVersion, 3);
  assert.equal(cache.sourceContentHashVersion, SOURCE_CONTENT_HASH_VERSION);
});
