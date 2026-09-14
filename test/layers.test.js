'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyKind,
  buildLayerNodes,
  groupByLayer,
  renderLayeredFlowchart,
  blockDiagramMarkdown
} = require('../lib/layers');
const { generateFiles } = require('../lib/generate');

describe('layers classify', () => {
  it('maps names to semantic layers', () => {
    assert.equal(classifyKind('scheduler.py'), 'schedule');
    assert.equal(classifyKind('weibo_worker'), 'worker');
    assert.equal(classifyKind('redis'), 'storage');
    assert.equal(classifyKind('dashboard.html'), 'frontend');
    assert.equal(classifyKind('alert_daemon'), 'monitor');
    assert.equal(classifyKind('k8s-deployment'), 'ops');
    assert.equal(classifyKind('flask_api'), 'api');
  });
});

describe('layers render', () => {
  const inv = {
    root: '/tmp/demo',
    title: 'Demo Monitor',
    folder: 'demo_monitor',
    languages: ['python'],
    modules: [
      { id: 'frontend', label: 'frontend', kind: 'frontend', layer: 'frontend' },
      { id: 'api', label: 'api', kind: 'backend', layer: 'api' },
      { id: 'worker', label: 'worker', kind: 'backend', layer: 'worker' }
    ],
    services: [
      { id: 'redis', label: 'redis', source: 'docker-compose.yml', layer: 'storage' }
    ],
    entrypoints: ['scheduler.py', 'dashboard.html'],
    deploy: ['Dockerfile'],
    artifacts: [
      { id: 'monitor_py', label: 'monitor.py', path: 'scripts/monitor.py', layer: 'monitor' }
    ],
    packages: [],
    classes: []
  };

  it('only emits non-empty colored subgraphs', () => {
    const md = renderLayeredFlowchart(inv);
    assert.match(md, /subgraph L_frontend/);
    assert.match(md, /subgraph L_api/);
    assert.match(md, /subgraph L_worker/);
    assert.match(md, /subgraph L_storage/);
    assert.match(md, /subgraph L_schedule/); // scheduler.py entrypoint
    assert.match(md, /subgraph L_monitor/);
    assert.match(md, /classDef frontend/);
    assert.match(md, /style L_storage/);
    assert.doesNotMatch(md, /subgraph L_ops[\s\S]*subgraph/); // ops may exist via Dockerfile
  });

  it('groups empty layers away', () => {
    const nodes = buildLayerNodes({
      title: 'x',
      folder: 'x',
      modules: [{ id: 'api', label: 'api', layer: 'api' }],
      services: [],
      entrypoints: [],
      deploy: [],
      artifacts: []
    });
    const groups = groupByLayer(nodes, null);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].def.id, 'api');
  });

  it('honors architecture.layers.json-style override titles', () => {
    const md = renderLayeredFlowchart(inv, {
      override: {
        titles: { worker: '采集层' },
        order: ['frontend', 'api', 'worker', 'storage']
      }
    });
    assert.match(md, /采集层/);
    assert.doesNotMatch(md, /subgraph L_schedule/);
  });

  it('generateFiles block-diagram uses layered template', () => {
    const files = generateFiles(inv);
    assert.match(files['block-diagram.md'], /通解生成/);
    assert.match(files['block-diagram.md'], /flowchart TB/);
    assert.match(files['block-diagram.md'], /subgraph L_/);
  });

  it('generateFiles deployment-ops reuses Block flowchart visual grammar', () => {
    const files = generateFiles(inv);
    const md = files['deployment-ops.md'];
    assert.match(md, /flowchart TB/);
    assert.match(md, /subgraph L_ops/);
    assert.match(md, /subgraph L_schedule/);
    assert.match(md, /classDef ops/);
    assert.match(md, /classDef schedule/);
    assert.match(md, /<small>/);
    assert.doesNotMatch(md, /dev\(\["👤 开发者|进入运行时|-->|-\.->/);
    assert.match(md, /static draft/);
    assert.doesNotMatch(md, /健康检查/);
    assert.match(md, /Dockerfile/);
  });

  it('retains evidenced imports without inventory-order or actor links', () => {
    const md = renderLayeredFlowchart({
      ...inv, relationships: [{ from: 'api', to: 'worker', type: 'import', file: 'api/main.py', line: 2 }]
    });
    assert.match(md, /api -->\|"import · api\/main.py:2"\| worker/);
    assert.doesNotMatch(md, /user|frontend -->|worker -->|redis -->/);
  });

  it('preserves explicit user edges, including actor links, instead of deriving chains', () => {
    const md = renderLayeredFlowchart(inv, {
      override: { edges: [{ from: 'user', to: 'frontend', label: '访问' }, 'frontend --> api'] }
    });
    assert.match(md, /user -->\|"访问"\| frontend/);
    assert.match(md, /frontend --> api/);
    assert.doesNotMatch(md, /api --> worker|worker --> redis/);
  });
});
