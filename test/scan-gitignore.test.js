'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { walkSourceFiles, walkFiles } = require('../lib/extract/shared');

function scan(ignore, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'av-ignore-'));
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), ignore);
    for (const file of files) {
      const full = path.join(root, file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, 'class App:\n    pass\n');
    }
    const relative = (list) => list.map((file) => path.relative(root, file).split(path.sep).join('/')).sort();
    const sources = relative(walkSourceFiles(root).get('python') || []);
    assert.deepEqual(relative(walkFiles(root, ['.py'])), sources, 'both source walkers must agree');
    return sources;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('root gitignore directory semantics', () => {
  const files = ['runtime/root.py', 'tools/runtime/safe_stdio.py', 'app/main.py'];

  it('root-anchored runtime does not exclude tools/runtime', () => {
    assert.deepEqual(scan('/runtime/\n', files), ['app/main.py', 'tools/runtime/safe_stdio.py']);
  });

  it('legacy schema walk records a cap reached inside a single directory', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'av-schema-cap-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'first.sql'), 'CREATE TABLE first (id INTEGER);\n');
    fs.writeFileSync(path.join(root, 'second.sql'), 'CREATE TABLE second (id INTEGER);\n');
    const files = walkFiles(root, ['.sql'], 1);
    assert.equal(files.length, 1);
    assert.equal(files.meta.truncated, true);
    assert.deepEqual(files.meta.unreadableDirs, []);
  });

  it('unanchored runtime excludes matching directories at any depth', () => {
    assert.deepEqual(scan('runtime/\n', files), ['app/main.py']);
  });

  it('a relative path pattern is anchored to the root', () => {
    assert.deepEqual(scan('tools/runtime/\n', [...files, 'pkg/tools/runtime/local.py']),
      ['app/main.py', 'pkg/tools/runtime/local.py', 'runtime/root.py']);
  });

  it('ordered negations can re-include a root directory without re-including nested ones', () => {
    assert.deepEqual(scan('runtime/\n!/runtime/\n', files), ['app/main.py', 'runtime/root.py']);
  });

  it('a later ignore can exclude a previously re-included directory', () => {
    assert.deepEqual(scan('/runtime/\n!/runtime/\n/runtime/\n', files),
      ['app/main.py', 'tools/runtime/safe_stdio.py']);
  });

  it('unsupported negations do not silently prune possibly re-included source', () => {
    assert.deepEqual(scan('runtime/\n!**/runtime/\n', files), files.slice().sort());
  });

  it('a scoped unsupported negation does not reopen unrelated browser caches', () => {
    assert.deepEqual(scan('browser_data/\n!.cursor/rules/**\n', [
      'browser_data/cache.py', 'app/main.py'
    ]), ['app/main.py']);
  });

  it('unsupported negations conservatively reopen their known prefix only', () => {
    assert.deepEqual(scan('runtime/\n!tools/**/runtime/\n', files),
      ['app/main.py', 'tools/runtime/safe_stdio.py']);
  });
});
