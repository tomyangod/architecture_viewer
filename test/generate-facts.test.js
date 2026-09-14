'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { scan } = require('../lib/scan');
const { generateFiles } = require('../lib/generate');
const { checkFile } = require('../lib/validate');
const { renderLayeredFlowchart } = require('../lib/layers');

it('source filenames and modules named user cannot invent or overwrite an actor', () => {
  for (const from of ['backend', 'user']) {
    const inv = {
      modules: [
        { id: from, label: from, layer: 'api' },
        { id: 'storage', label: 'storage', layer: 'storage' }
      ],
      relationships: [{ from, to: 'storage', type: 'import', file: 'backend/user.py', line: 1 }]
    };
    const diagram = renderLayeredFlowchart(inv, { override: {} });
    assert.match(diagram, /import/);
    assert.doesNotMatch(diagram, /使用者|class user actor/);
    const configured = renderLayeredFlowchart(inv, {
      override: { edges: [{ from: 'user', to: 'storage' }] }
    });
    if (from === 'user') assert.doesNotMatch(configured, /使用者|class user actor/);
    else assert.match(configured, /user\(\["👤 使用者"\]\)/);
  }
});

describe('source-factual skeleton', () => {
  let root;
  beforeEach(() => {
    root = path.join(__dirname, `.generate-facts-${process.pid}`);
    fs.mkdirSync(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  function write(file, text) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  function fixture() {
    write('backend/base.py', 'class Base:\n    pass\n');
    write('backend/service.py', 'from .base import Base\nclass Service(Base):\n    pass\n');
    write('frontend/base.js', 'export class Widget {}\n');
    write('frontend/app.js', "import { Widget } from './base.js';\nexport class Panel extends Widget {}\n");
    write('isolated/lonely.py', 'class Lonely:\n    pass\n');
    write('tools/scheduler/jobs.py', 'from backend.service import Service\n');
    write('tools/monitoring/probe.py', 'from backend.base import Base\n');
    write('tools/alert.py', 'from backend.base import Base\n');
    write('tools/general/helper.py', 'def helper():\n    pass\n');
  }
  it('keeps real imports/inheritance, per-node languages and specific operational modules', () => {
    fixture();
    const inv = scan(root);
    for (const [label, language, layer] of [
      ['backend', 'python', 'api'], ['frontend', 'javascript', 'frontend'],
      ['tools/scheduler', 'python', 'schedule'], ['tools/monitoring', 'python', 'monitor'],
      ['tools/alert.py', 'python', 'monitor']
    ]) {
      const node = inv.modules.find((m) => m.label === label);
      assert.ok(node, label);
      assert.deepEqual(node.languages, [language], label);
      assert.equal(node.layer, layer, label);
    }
    assert.ok(!inv.modules.some((m) => ['tools', 'tools/general'].includes(m.label)));
    assert.ok(inv.relationships.some((e) => e.from === 'tools_scheduler' && e.to === 'backend' && e.type === 'import'));
    assert.ok(inv.classRelationships.some((e) => e.type === 'extends' && e.file === 'backend/service.py'));
    assert.ok(inv.classRelationships.some((e) => e.type === 'extends' && e.file === 'frontend/app.js'));
    assert.ok(!inv.relationships.some((e) => e.from === 'isolated' || e.to === 'isolated'));
    const files = generateFiles(inv);
    assert.equal(Object.keys(files).length, 6);
    for (const [name, md] of Object.entries(files)) {
      assert.deepEqual(checkFile(name, md, { requireFilled: true }).errors, [], name);
      assert.match(md, /static draft/);
      assert.doesNotMatch(md, /协作|: uses|外部依赖|shared_lib|cls_core|boundary_api|Person\(|Entrypoint -->|\+run\(|\+from /);
    }
    assert.match(files['c4-container.md'], /"backend", "python"/);
    assert.match(files['c4-container.md'], /"frontend", "javascript"/);
    assert.match(files['c4-container.md'], /Rel\([^,]+, [^,]+, "import", "tools\/scheduler\/jobs.py:1"\)/);
    assert.match(files['class-diagram.md'], /<\|-- .* : extends/);
    assert.equal((files['class-diagram.md'].match(/<\|--/g) || []).length, 2);
    assert.match(files['deployment-ops.md'], /tools\/scheduler|tools\/monitoring/);
    assert.match(files['deployment-ops.md'], /tools\/alert.py/);
  });

  it('leaves disconnected inventories and empty repositories honest and valid', () => {
    for (const populated of [false, true]) {
      if (populated) {
        write('backend/a.py', 'class Alpha:\n    pass\n');
        write('frontend/b.js', 'export class Bravo {}\n');
      }
      const files = generateFiles(scan(root));
      for (const [name, md] of Object.entries(files)) {
        assert.deepEqual(checkFile(name, md, {}).errors, [], name);
        assert.doesNotMatch(md, /Rel\(|-->|-\.->|<\|--|app_core|local-run|\+run\(|\+domain/);
      }
    }
  });

  it('loads explicit architecture.layers.json edges without inventing any other links', () => {
    fixture();
    write('architecture.layers.json', JSON.stringify({
      nodes: [{ id: 'reviewer', title: 'Reviewer', layer: 'frontend' }],
      edges: [{ from: 'reviewer', to: 'backend', label: 'approved relationship' }, 'backend --> frontend']
    }));
    const md = generateFiles(scan(root))['block-diagram.md'];
    assert.match(md, /reviewer -->\|"approved relationship"\| backend/);
    assert.match(md, /backend --> frontend/);
    assert.doesNotMatch(md, /user|tools_scheduler -->/);
  });

  it('does not treat a GitHub metadata directory as a workflow', () => {
    write('.github/CODEOWNERS', '* @owner\n');
    assert.ok(!scan(root).deploy.some((d) => /github/.test(d)));
    write('.github/workflows/ci.yml', 'name: CI\non: push\njobs: {}\n');
    assert.ok(scan(root).deploy.includes('.github/workflows'));
  });

  it('retains explicit entrypoint imports but never infers user access or external calls', () => {
    write('main.py', 'from backend.service import Service\n');
    write('backend/service.py', 'class Service:\n    pass\n');
    write('docker-compose.yml', 'services:\n  redis:\n    image: redis:7\n');
    const inv = scan(root);
    assert.ok(inv.relationships.some((e) => e.from === 'main' && e.to === 'backend' && e.type === 'import'));
    const md = generateFiles(inv)['c4-container.md'];
    assert.match(md, /Rel\(main, backend, "import", "main.py:1"\)/);
    assert.match(md, /Container\(redis,/);
    assert.doesNotMatch(md, /Person\(|Rel\([^,]+, redis|Rel\(redis,/);
  });

  it('respects excluded operational tools instead of bypassing scan ignores', () => {
    fixture();
    write('.arch-viewer-ignore', 'tools\n');
    const inv = scan(root);
    assert.ok(!inv.modules.some((m) => m.label.startsWith('tools')));
    assert.ok(!inv.relationships.some((e) => e.file.startsWith('tools')));
  });

  it('preserves explicit util classification while retaining operational source inventory', () => {
    fixture();
    const config = JSON.stringify({ 'tools/scheduler': { layer: 'util' } });
    write('.av/layers.json', config);
    const inv = scan(root);
    const scheduler = inv.modules.find((m) => m.label === 'tools/scheduler');
    assert.equal(scheduler.layer, 'util');
    assert.equal(scheduler.operational, true);
    const files = generateFiles(inv);
    for (const name of ['block-diagram.md', 'deployment-ops.md']) {
      assert.match(files[name], /subgraph L_util/);
      assert.match(files[name], /tools\/scheduler/);
      assert.doesNotMatch(files[name], /subgraph L_schedule/);
    }
    assert.equal(fs.readFileSync(path.join(root, '.av/layers.json'), 'utf8'), config);
  });
});
