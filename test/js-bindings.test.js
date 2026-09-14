'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildGraph } = require('../lib/extract-graph');

function graphFor(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'av-js-bindings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(root, file), text);
  const graph = buildGraph(root);
  assert.equal(graph.stats.parseErrors, 0);
  const ids = new Set(graph.nodes.map(node => node.id));
  for (const edge of graph.edges) {
    assert.ok(ids.has(edge.from), JSON.stringify(edge));
    assert.ok(ids.has(edge.to), JSON.stringify(edge));
  }
  return graph;
}

it('unbound browser globals do not become dangling packages or same-name local classes', t => {
  const graph = graphFor(t, {
    'processor.js': 'class StreamingWorkletProcessor extends AudioWorkletProcessor {}\n',
    'unrelated.js': 'export class AudioWorkletProcessor {}\n'
  });
  const reference = graph.edges.find(edge => edge.from === 'processor#StreamingWorkletProcessor' &&
    edge.typeName === 'AudioWorkletProcessor');
  assert.equal(reference.type, 'references-unresolved');
  assert.equal(reference.referenceType, 'extends');
  assert.ok(!graph.nodes.some(node => node.id === 'ext:AudioWorkletProcessor'));
  assert.ok(!graph.edges.some(edge => edge.from === 'processor#StreamingWorkletProcessor' &&
    edge.to === 'unrelated#AudioWorkletProcessor'));
});

it('explicit local aliases and external aliases retain their real binding targets', t => {
  const graph = graphFor(t, {
    'model.ts': 'export class Order {}\n',
    'app.ts': [
      "import { Order as Purchase } from './model';",
      "import { Handler as Remote } from 'sdk';",
      'export class Adapter extends Remote {',
      '  item: Purchase;',
      '  run(value: Purchase): Purchase { return value; }',
      '}'
    ].join('\n')
  });
  for (const type of ['field-type', 'method-param', 'method-return']) {
    assert.ok(graph.edges.some(edge => edge.from === 'app#Adapter' && edge.to === 'model#Order' && edge.type === type), type);
  }
  assert.ok(graph.edges.some(edge => edge.from === 'app#Adapter' && edge.to === 'ext:sdk' &&
    edge.type === 'references-external' && edge.resolvedType === 'Handler'));
  assert.ok(!graph.nodes.some(node => node.id === 'ext:Remote'));
});

it('missing local exports and unknown annotations remain explicit unresolved references', t => {
  const graph = graphFor(t, {
    'model.ts': 'export class Order {}\n',
    'app.ts': [
      "import { Missing as Absent } from './model';",
      'export class Adapter implements Absent {',
      '  item: Unknown;',
      '  run(value: Absent): Unknown { throw new Error(); }',
      '}'
    ].join('\n')
  });

  for (const name of ['Absent', 'Unknown']) {
    const refs = graph.edges.filter(edge => edge.typeName === name);
    assert.ok(refs.length > 0, name);
    assert.ok(refs.every(edge => edge.type === 'references-unresolved'), name);
  }
  assert.ok(!graph.edges.some(edge => edge.to === 'model#Missing'));
});

it('re-export declarations do not introduce local type bindings', t => {
  const graph = graphFor(t, {
    'model.ts': 'export class Order {}\n',
    'app.ts': [
      "export { Event } from 'sdk';",
      "export { Order } from './model';",
      'export class CustomEvent extends Event {}',
      'export class CustomOrder extends Order {}'
    ].join('\n')
  });
  for (const name of ['Event', 'Order']) {
    const edge = graph.edges.find(edge => edge.from === 'app#Custom' + name && edge.typeName === name);
    assert.equal(edge.type, 'references-unresolved', name);
  }
});
