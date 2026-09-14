'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveViews,
  hasDeploymentEvidence,
  filterClassesForFocus,
  parseViewList,
  DEFAULT_DIAGRAM_FILES
} = require('../lib/view-policy');
const { generateToDir, generateFiles } = require('../lib/index');
const { DIAGRAM_FILES } = require('../lib/kit');

function tmpRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-views-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

describe('view-policy', () => {
  it('parseViewList accepts aliases and rejects unknown names', () => {
    assert.deepEqual(parseViewList('block,class'), ['block-diagram.md', 'class-diagram.md']);
    assert.throws(() => parseViewList('sequence'), /Unknown view/);
  });

  it('default selected set is Block, not six views', () => {
    const r = resolveViews({ inventory: { modules: [{ id: 'api', layer: 'api' }] } });
    assert.deepEqual(r.selected, DEFAULT_DIAGRAM_FILES);
    assert.equal(r.policy, 'default');
    assert.ok(r.skipped.some((s) => s.file === 'c4-container.md'));
    assert.ok(r.skipped.some((s) => s.file === 'c4-component.md'));
    assert.ok(r.skipped.some((s) => s.file === 'c4-context.md'));
  });

  it('deployment joins default only with launch evidence', () => {
    assert.equal(hasDeploymentEvidence({ modules: [{ id: 'api', layer: 'api' }] }), false);
    assert.equal(hasDeploymentEvidence({ deploy: ['Dockerfile'] }), true);
    assert.equal(hasDeploymentEvidence({ services: [{ id: 'api' }] }), true);
    const withDocker = resolveViews({ inventory: { deploy: ['Dockerfile'] } });
    assert.ok(withDocker.selected.includes('deployment-ops.md'));
    const without = resolveViews({ inventory: { deploy: ['.github/workflows'] } });
    assert.ok(!without.selected.includes('deployment-ops.md'));
  });

  it('--confirm-context adds C4 Context; compat writes all six', () => {
    const confirmed = resolveViews({ confirmContext: true, inventory: {} });
    assert.ok(confirmed.selected.includes('c4-context.md'));
    const compat = resolveViews({ compatSix: true, inventory: {} });
    assert.deepEqual(compat.selected, DIAGRAM_FILES);
    assert.equal(compat.policy, 'compat-six');
  });

  it('explicit --views deployment without evidence is skipped', () => {
    const r = resolveViews({ views: 'deployment', inventory: { modules: [] } });
    assert.deepEqual(r.selected, []);
    assert.ok(r.skipped.some((s) => s.file === 'deployment-ops.md'));
  });

  it('filterClassesForFocus keeps the changed type and inheritance neighbors', () => {
    const inv = {
      classes: [
        { id: 'a', name: 'A', file: 'src/a.py' },
        { id: 'b', name: 'B', file: 'src/b.py' },
        { id: 'c', name: 'C', file: 'src/c.py' }
      ],
      classRelationships: [
        { from: 'b', to: 'a', type: 'extends', file: 'src/b.py' }
      ]
    };
    const local = filterClassesForFocus(inv, ['src/b.py']);
    assert.deepEqual(local.classes.map((x) => x.id).sort(), ['a', 'b']);
    assert.equal(local.classes.some((x) => x.id === 'c'), false);
  });
});

describe('generateToDir default delivery', () => {
  it('writes Block only for a plain source tree', () => {
    const repo = tmpRepo({
      'src/app.py': 'class App:\n    pass\n'
    });
    const kit = path.join(repo, 'kit');
    try {
      const r = generateToDir(repo, kit);
      assert.equal(r.viewPolicy, 'default');
      assert.ok(fs.existsSync(path.join(kit, 'block-diagram.md')));
      assert.ok(!fs.existsSync(path.join(kit, 'c4-container.md')));
      assert.ok(!fs.existsSync(path.join(kit, 'c4-component.md')));
      assert.ok(!fs.existsSync(path.join(kit, 'c4-context.md')));
      assert.ok(r.protocol.ok, r.protocol.errors.join('\n'));
      assert.ok(r.written.includes('block-diagram.md'));
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('--compat-six-views still writes all generators', () => {
    const repo = tmpRepo({
      'src/app.py': 'class App:\n    pass\n'
    });
    const kit = path.join(repo, 'kit');
    try {
      const r = generateToDir(repo, kit, { compatSix: true });
      assert.equal(r.viewPolicy, 'compat-six');
      assert.equal(r.written.length, 6);
      for (const f of DIAGRAM_FILES) {
        assert.ok(fs.existsSync(path.join(kit, f)), f);
      }
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('class --focus writes a local class diagram', () => {
    const repo = tmpRepo({
      'src/base.py': 'class Base:\n    pass\n',
      'src/svc.py': 'from base import Base\nclass Svc(Base):\n    pass\n'
    });
    const kit = path.join(repo, 'kit');
    try {
      const r = generateToDir(repo, kit, { views: 'class', focusFiles: ['src/svc.py'] });
      assert.ok(fs.existsSync(path.join(kit, 'class-diagram.md')));
      const md = fs.readFileSync(path.join(kit, 'class-diagram.md'), 'utf8');
      assert.match(md, /Svc|Base|classDiagram|static draft/);
      assert.ok(!fs.existsSync(path.join(kit, 'c4-container.md')));
      assert.equal(r.viewPolicy, 'explicit');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('removes leftover placeholder compat diagrams after default generate', () => {
    const repo = tmpRepo({
      'src/app.py': 'class App:\n    pass\n'
    });
    const kit = path.join(repo, 'kit');
    fs.mkdirSync(kit, { recursive: true });
    fs.writeFileSync(path.join(kit, 'c4-context.md'), '# x\n\n*模板文件 · 请替换为你项目的实际内容*\n');
    try {
      generateToDir(repo, kit);
      assert.ok(!fs.existsSync(path.join(kit, 'c4-context.md')));
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('keeps user-edited diagrams and records retainedNotUpdated in receipt', () => {
    const repo = tmpRepo({
      'src/app.py': 'class App:\n    pass\n'
    });
    const kit = path.join(repo, 'kit');
    fs.mkdirSync(kit, { recursive: true });
    fs.writeFileSync(path.join(kit, 'c4-container.md'), '# User edited container\n\n```mermaid\ngraph TB\n  A-->B\n```\n');
    try {
      const r = generateToDir(repo, kit);
      assert.ok(fs.existsSync(path.join(kit, 'c4-container.md')));
      assert.ok(r.retainedNotUpdated.includes('c4-container.md'));
      const receiptPath = path.join(kit, '.generate-receipt.json');
      assert.ok(fs.existsSync(receiptPath));
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      assert.ok(receipt.selected.includes('block-diagram.md'));
      assert.ok(receipt.retainedNotUpdated.includes('c4-container.md'));
      assert.match(fs.readFileSync(path.join(kit, 'c4-container.md'), 'utf8'), /User edited container/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('generateFiles still exposes compat generators', () => {
  it('without views still returns six in-memory drafts', () => {
    const files = generateFiles({
      title: 'Demo',
      folder: 'demo',
      languages: ['python'],
      modules: [{ id: 'api', label: 'api', layer: 'api', path: 'api' }],
      classes: [],
      relationships: [],
      classRelationships: []
    });
    assert.equal(Object.keys(files).length, 6);
  });
});
