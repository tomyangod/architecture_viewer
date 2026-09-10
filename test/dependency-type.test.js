'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildGraph } = require('../lib/extract-graph');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-dep-type-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe('M3: dependencyType on import edges', () => {
  it('JS static import → import', () => {
    const dir = makeRepo({
      'src/a.js': 'export const x = 1;\n',
      'src/b.js': 'import { x } from "./a.js";\n'
    });
    try {
      const g = buildGraph(dir);
      const e = g.edges.find((x) => x.type === 'import' && x.from === 'file:src/b.js');
      assert.equal(e.dependencyType, 'import');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('JS dynamic import → dynamic-import', () => {
    const dir = makeRepo({
      'src/a.js': 'export const x = 1;\n',
      'src/b.js': 'export async function load() { return import("./a.js"); }\n'
    });
    try {
      const g = buildGraph(dir);
      const e = g.edges.find((x) => x.type === 'import' && x.from === 'file:src/b.js');
      assert.equal(e.dependencyType, 'dynamic-import');
      assert.equal(e.dynamic, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('JS require → require', () => {
    const dir = makeRepo({
      'src/a.js': 'module.exports = { x: 1 };\n',
      'src/b.js': 'const a = require("./a.js");\n'
    });
    try {
      const g = buildGraph(dir);
      const e = g.edges.find((x) => x.type === 'import' && x.from === 'file:src/b.js');
      assert.equal(e.dependencyType, 'require');
      assert.equal(e.isCjs, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('TS import type → type-import', () => {
    const dir = makeRepo({
      'src/types.ts': 'export type T = { x: number };\n',
      'src/use.ts': 'import type { T } from "./types.ts";\nexport function f(t: T) { return t; }\n'
    });
    try {
      const g = buildGraph(dir);
      const e = g.edges.find((x) => x.type === 'import' && x.from === 'file:src/use.ts');
      assert.equal(e.dependencyType, 'type-import');
      assert.equal(e.isType, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Python importlib → dynamic-import', () => {
    const dir = makeRepo({
      'pkg/mod.py': 'class Mod: pass\n',
      'app/main.py': 'import importlib\nimportlib.import_module("pkg.mod")\n'
    });
    try {
      const g = buildGraph(dir);
      const e = g.edges.find((x) => x.type === 'import' && x.from === 'file:app/main.py');
      assert.equal(e.dependencyType, 'dynamic-import');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
