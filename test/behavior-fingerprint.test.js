'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs, formatDiffText } = require('../lib/diff-graph');
const { evaluateRisk, ensureBehaviorFingerprintInput } = require('../lib/risk-rules');
const {
  fingerprintFromImpl,
  detectSinks,
  diffBehaviorFingerprints,
  sameFingerprint
} = require('../lib/extract/behavior-fingerprint');
const { extractImpl } = require('../lib/impl-surface');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-beh-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe('W20-01a: 行为指纹', () => {
  it('六维指纹：call/throw/await/branches/returns/sink + confidence', () => {
    const Parser = require('tree-sitter');
    const JS = require('tree-sitter-javascript');
    const p = new Parser();
    p.setLanguage(JS);
    const src = `
async function run(repo) {
  if (!repo) throw new Error('missing');
  const row = await repo.findOne(1);
  repo.save(row);
  return row;
}
`;
    const tree = p.parse(src);
    let fn = null;
    for (let i = 0; i < tree.rootNode.childCount; i++) {
      if (tree.rootNode.child(i).type === 'function_declaration') fn = tree.rootNode.child(i);
    }
    const impl = extractImpl(fn);
    assert.ok(impl && impl.behavior, 'impl.behavior attached');
    const fp = impl.behavior;
    assert.ok(fp.callSet.includes('findOne') || fp.callSet.includes('save'));
    assert.ok(fp.throwSet.includes('Error'));
    assert.ok(fp.awaitSet.includes('findOne'));
    assert.ok(fp.branches >= 1);
    assert.ok(fp.returns >= 1);
    assert.ok(fp.sinkSet.some((s) => s.name === 'save' || s.name === 'findOne'));
    assert.ok(fp.sinkSet.every((s) => s.confidence === 'low' || s.confidence === 'medium'));
  });

  it('detectSinks 命名启发式带 confidence', () => {
    const sinks = detectSinks(['save', 'publish', 'fetch', 'helper']);
    assert.ok(sinks.find((s) => s.name === 'save' && s.kind === 'storage'));
    assert.ok(sinks.find((s) => s.name === 'publish' && s.kind === 'messaging'));
    assert.ok(sinks.find((s) => s.name === 'fetch' && s.kind === 'http'));
    assert.ok(!sinks.find((s) => s.name === 'helper'));
  });

  it('格式化不改指纹（token 变但集合不变）', () => {
    const a = fingerprintFromImpl({
      calls: ['save', 'find'],
      throws: ['Error'],
      awaits: [],
      control: { if: 1, loop: 0, return: 1, throw: 1, try: 0, await: 0 }
    });
    const b = fingerprintFromImpl({
      calls: ['find', 'save'], // order noise
      throws: ['Error'],
      awaits: [],
      control: { if: 1, loop: 0, return: 1, throw: 1, try: 0, await: 0 }
    });
    assert.ok(sameFingerprint(a, b));
  });

  it('行为变化进入 diff.behaviorChanges；纯移动不报', () => {
    const dir = makeRepo({
      'src/svc.js': `
export function create(repo, title) {
  return repo.save(title);
}
`
    });
    const base = buildGraph(dir);
    fs.writeFileSync(path.join(dir, 'src/svc.js'), `
export function create(repo, title) {
  if (!title) throw new Error('empty');
  repo.save(title);
  return repo.publish(title);
}
`);
    const head = buildGraph(dir);
    const diff = diffGraphs(base, head);
    assert.ok(Array.isArray(diff.behaviorChanges));
    assert.ok(diff.behaviorChanges.length >= 1, JSON.stringify(diff.behaviorChanges));
    const hit = diff.behaviorChanges.find((c) => String(c.id).includes('create') || c.method === 'create');
    assert.ok(hit);
    assert.ok(
      (hit.addedCalls && hit.addedCalls.includes('publish'))
      || (hit.addedThrows && hit.addedThrows.includes('Error'))
      || (hit.addedSinks && hit.addedSinks.length)
    );
    const text = formatDiffText(diff);
    assert.match(text, /行为指纹/);
  });

  it('文件移动（同名实体换路径）指纹相同不报行为变更', () => {
    const dir = makeRepo({
      'src/a/todo.js': `
export function createTodo(title) {
  return title;
}
`
    });
    const base = buildGraph(dir);
    fs.mkdirSync(path.join(dir, 'src/b'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/b/todo.js'), `
export function createTodo(title) {
  return title;
}
`);
    fs.unlinkSync(path.join(dir, 'src/a/todo.js'));
    const head = buildGraph(dir);
    const diff = diffGraphs(base, head);
    const beh = (diff.behaviorChanges || []).filter((c) => c.method === 'createTodo' || String(c.id).includes('createTodo'));
    assert.equal(beh.length, 0, `move should not flag behavior: ${JSON.stringify(beh)}`);
  });

  it('evaluateRisk 接入 behaviorChanges 输入面', () => {
    const dir = makeRepo({
      'src/svc.js': `export function create(x) { return x; }\n`
    });
    const base = buildGraph(dir);
    fs.writeFileSync(path.join(dir, 'src/svc.js'), `
export function create(repo, x) {
  return repo.save(x);
}
`);
    const head = buildGraph(dir);
    const diff = diffGraphs(base, head);
    assert.ok(diff.behaviorChanges.length >= 1);
    evaluateRisk(diff, head, base, null, {});
    const list = ensureBehaviorFingerprintInput(diff);
    assert.equal(list, diff.behaviorChanges);
    assert.ok(Array.isArray(list));
  });

  it('diffBehaviorFingerprints 直接 API：集合变化才出结果', () => {
    const base = {
      nodes: [{
        id: 'm#f', name: 'f', kind: 'function', path: 'm.js', line: 1, exported: true,
        behavior: fingerprintFromImpl({
          calls: ['a'], throws: [], awaits: [],
          control: { if: 0, loop: 0, return: 1, throw: 0, try: 0, await: 0 }
        })
      }]
    };
    const headSame = {
      nodes: [{
        id: 'm#f', name: 'f', kind: 'function', path: 'm.js', line: 1, exported: true,
        behavior: fingerprintFromImpl({
          calls: ['a'], throws: [], awaits: [],
          control: { if: 0, loop: 0, return: 1, throw: 0, try: 0, await: 0 }
        })
      }]
    };
    const headChanged = {
      nodes: [{
        id: 'm#f', name: 'f', kind: 'function', path: 'm.js', line: 1, exported: true,
        behavior: fingerprintFromImpl({
          calls: ['a', 'save'], throws: ['Error'], awaits: [],
          control: { if: 1, loop: 0, return: 1, throw: 1, try: 0, await: 0 }
        })
      }]
    };
    assert.equal(diffBehaviorFingerprints(base, headSame).length, 0);
    const ch = diffBehaviorFingerprints(base, headChanged);
    assert.equal(ch.length, 1);
    assert.ok(ch[0].addedCalls.includes('save'));
    assert.ok(ch[0].addedThrows.includes('Error'));
  });
});
