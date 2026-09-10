'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildGraph } = require('../lib/extract-graph');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-dyn-imp-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe('动态 import 字面量（第一刀）', () => {
  it('Python importlib.import_module / __import__ 落到真实文件，不只记 importlib', () => {
    const dir = makeRepo({
      'storage/repo.py': 'class Repo:\n    pass\n',
      'controller/api.py': [
        'import importlib',
        'def load():',
        '    importlib.import_module("storage.repo")',
        '    __import__("storage.repo")',
        ''
      ].join('\n')
    });
    try {
      const g = buildGraph(dir);
      const imports = g.edges.filter((e) => e.type === 'import' && e.from === 'file:controller/api.py');
      assert.ok(
        imports.some((e) => e.to === 'file:storage/repo.py' && e.dynamic),
        '应有到 storage/repo.py 的动态 import 边: ' + imports.map((e) => e.to).join(',')
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('变量模块路径记 unresolved-dynamic-import，不静默漏报', () => {
    const dir = makeRepo({
      'storage/repo.py': 'class Repo:\n    pass\n',
      'controller/api.py': [
        'import importlib',
        'name = "storage.repo"',
        'def load():',
        '    importlib.import_module(name)',
        ''
      ].join('\n')
    });
    try {
      const g = buildGraph(dir);
      const imports = g.edges.filter((e) => e.type === 'import' && e.from === 'file:controller/api.py');
      assert.ok(!imports.some((e) => e.to === 'file:storage/repo.py'));
      const unresolved = g.edges.filter((e) => e.type === 'unresolved-dynamic-import' && e.from === 'file:controller/api.py');
      assert.equal(unresolved.length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('JS import("literal") 落到相对模块', () => {
    const dir = makeRepo({
      'src/storage.js': 'export class Repo {}\n',
      'src/controller.js': [
        'export async function load() {',
        '  const m = await import("./storage.js");',
        '  return m;',
        '}',
        ''
      ].join('\n')
    });
    try {
      const g = buildGraph(dir);
      const imports = g.edges.filter((e) => e.type === 'import' && e.from === 'file:src/controller.js');
      assert.ok(
        imports.some((e) => e.to === 'file:src/storage.js' && e.dynamic),
        '应有到 storage.js 的动态 import: ' + imports.map((e) => e.to).join(',')
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('JS import(`static`) 静态模板字符串也能解析', () => {
    const dir = makeRepo({
      'src/storage.js': 'export class Repo {}\n',
      'src/controller.js': [
        'export async function load() {',
        '  const m = await import(`./storage.js`);',
        '  return m;',
        '}',
        ''
      ].join('\n')
    });
    try {
      const g = buildGraph(dir);
      const imports = g.edges.filter((e) => e.type === 'import' && e.from === 'file:src/controller.js');
      assert.ok(
        imports.some((e) => e.to === 'file:src/storage.js'),
        '静态模板应解析: ' + imports.map((e) => e.to).join(',')
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Python "a" + ".b" 字面量拼接可解析；含变量仍跳过', () => {
    const dir = makeRepo({
      'storage/repo.py': 'class Repo:\n    pass\n',
      'controller/api.py': [
        'import importlib',
        'def load_ok():',
        '    importlib.import_module("storage" + ".repo")',
        'def load_skip(suffix):',
        '    importlib.import_module("storage" + suffix)',
        ''
      ].join('\n')
    });
    try {
      const g = buildGraph(dir);
      const imports = g.edges.filter((e) => e.type === 'import' && e.from === 'file:controller/api.py');
      assert.ok(
        imports.some((e) => e.to === 'file:storage/repo.py'),
        '字面量拼接应解析: ' + imports.map((e) => e.to).join(',')
      );
      assert.equal(imports.filter((e) => e.to === 'file:storage/repo.py').length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('JS import(`${name}`) 记 unresolved-dynamic-import', () => {
    const dir = makeRepo({
      'src/storage.js': 'export class Repo {}\n',
      'src/controller.js': 'export async function load(name) { return import(`./${name}.js`); }\n'
    });
    try {
      const g = buildGraph(dir);
      const imports = g.edges.filter((e) => e.type === 'import' && e.from === 'file:src/controller.js');
      assert.ok(!imports.some((e) => e.to === 'file:src/storage.js'));
      const unresolved = g.edges.filter((e) => e.type === 'unresolved-dynamic-import' && e.from === 'file:src/controller.js');
      assert.ok(unresolved.length >= 1, '应有 unresolved 边: ' + JSON.stringify(g.edges.filter((e) => e.from === 'file:src/controller.js')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('本轮新增 unresolved 动态导入 → LOW finding', () => {
    const { diffGraphs } = require('../lib/diff-graph');
    const { evaluateRisk } = require('../lib/risk-rules');
    const empty = { nodes: [], edges: [], fingerprint: '0', root: 'x', stats: {} };
    const dir = makeRepo({
      'app.py': 'import importlib\nname = "x"\nimportlib.import_module(name)\n'
    });
    try {
      const head = buildGraph(dir);
      const diff = diffGraphs(empty, head);
      const findings = evaluateRisk(diff, head, empty);
      assert.ok(
        findings.some((f) => f.rule === 'unresolved-dynamic-import'),
        '应有 unresolved-dynamic-import finding: ' + findings.map((f) => f.rule).join(',')
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
