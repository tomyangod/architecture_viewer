'use strict';

const assert = require('node:assert');
const { describe, it } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { evaluateContracts, moduleMatches, relToPythonModule } = require('../lib/analyzers/contract-rules');
const { analyze } = require('../lib/analyzers/builtin');

function tmpRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-contract-rules-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

function fileNode(rel) {
  return { id: `file:${rel}`, name: path.basename(rel), kind: 'file', path: rel };
}

function importEdge(from, to) {
  return { from: `file:${from}`, to: `file:${to}`, type: 'import', file: from, line: 1 };
}

function pyGraph(edges) {
  const files = new Set();
  for (const [from, to] of edges) {
    files.add(from);
    files.add(to);
  }
  return {
    nodes: [...files].map(fileNode),
    edges: edges.map(([from, to]) => importEdge(from, to))
  };
}

const LAYERS = {
  'app/controllers': 'controller',
  'app/services': 'service',
  'app/repo': 'storage'
};

describe('contract-rules helpers', () => {
  it('relToPythonModule strips src/ when src is not a package', () => {
    const dir = tmpRepo({});
    try {
      assert.equal(relToPythonModule('src/app/controllers/api.py', dir), 'app.controllers.api');
      assert.equal(relToPythonModule('app/repo/order.py', dir), 'app.repo.order');
      assert.equal(relToPythonModule('app/repo/__init__.py', dir), 'app.repo');
      assert.equal(relToPythonModule('lib/cli.js', dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('moduleMatches treats listed name as package unless as_packages is false', () => {
    assert.equal(moduleMatches('app.controllers.api', 'app.controllers', true), true);
    assert.equal(moduleMatches('app.controllers.api', 'app.controllers', false), false);
    assert.equal(moduleMatches('app.controllers', 'app.controllers', false), true);
    assert.equal(moduleMatches('app.controllers.api', 'app.control*', true), true);
  });
});

describe('evaluateContracts: forbidden', () => {
  it('direct controller → storage maps to layer-skip', () => {
    const dir = tmpRepo({
      '.importlinter': `[importlinter]
root_package = app

[importlinter:contract:av-no-controller-to-storage]
name = No skip
type = forbidden
source_modules =
    app.controllers
forbidden_modules =
    app.repo
allow_indirect_imports = True
`
    });
    try {
      const graph = pyGraph([['app/controllers/api.py', 'app/repo/order.py']]);
      const { findings } = evaluateContracts(graph, dir, { layers: LAYERS });
      assert.equal(findings.length, 1);
      assert.equal(findings[0].rule, 'layer-skip');
      assert.equal(findings[0].fromLayer, 'controller');
      assert.equal(findings[0].toLayer, 'storage');
      assert.deepEqual(findings[0].importChain, ['app.controllers.api', 'app.repo.order']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('service → storage is forbid-cross-layer, not layer-skip', () => {
    const dir = tmpRepo({
      '.importlinter': `[importlinter:contract:ban]
name = Service storage ban
type = forbidden
source_modules = app.services
forbidden_modules = app.repo
allow_indirect_imports = True
`
    });
    try {
      const graph = pyGraph([['app/services/todo.py', 'app/repo/order.py']]);
      const { findings } = evaluateContracts(graph, dir, { layers: LAYERS });
      assert.equal(findings.length, 1);
      assert.equal(findings[0].rule, 'forbid-cross-layer');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('allow_indirect_imports=True ignores controller → service → storage', () => {
    const dir = tmpRepo({
      '.importlinter': `[importlinter:contract:av-no-controller-to-storage]
name = Direct only
type = forbidden
source_modules = app.controllers
forbidden_modules = app.repo
allow_indirect_imports = True
`
    });
    try {
      const graph = pyGraph([
        ['app/controllers/api.py', 'app/services/todo.py'],
        ['app/services/todo.py', 'app/repo/order.py']
      ]);
      const { findings } = evaluateContracts(graph, dir, { layers: LAYERS });
      assert.equal(findings.length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('allow_indirect_imports unset reports the indirect chain', () => {
    const dir = tmpRepo({
      '.importlinter': `[importlinter:contract:ban]
name = No hop
type = forbidden
source_modules = app.controllers
forbidden_modules = app.repo
`
    });
    try {
      const graph = pyGraph([
        ['app/controllers/api.py', 'app/services/todo.py'],
        ['app/services/todo.py', 'app/repo/order.py']
      ]);
      const { findings } = evaluateContracts(graph, dir, { layers: LAYERS });
      assert.equal(findings.length, 1);
      assert.match(findings[0].detail, /导入链:/);
      assert.deepEqual(findings[0].importChain, [
        'app.controllers.api', 'app.services.todo', 'app.repo.order'
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('as_packages=False does not match submodules', () => {
    const dir = tmpRepo({
      '.importlinter': `[importlinter:contract:ban]
name = Exact only
type = forbidden
as_packages = False
source_modules = app.controllers
forbidden_modules = app.repo
allow_indirect_imports = True
`
    });
    try {
      const graph = pyGraph([['app/controllers/api.py', 'app/repo/order.py']]);
      const { findings } = evaluateContracts(graph, dir, { layers: LAYERS });
      assert.equal(findings.length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignore_imports skips the listed edge', () => {
    const dir = tmpRepo({
      '.importlinter': `[importlinter:contract:ban]
name = With ignore
type = forbidden
source_modules = app.controllers
forbidden_modules = app.repo
allow_indirect_imports = True
ignore_imports =
    app.controllers.api -> app.repo.order
`
    });
    try {
      const graph = pyGraph([['app/controllers/api.py', 'app/repo/order.py']]);
      const { findings } = evaluateContracts(graph, dir, { layers: LAYERS });
      assert.equal(findings.length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('evaluateContracts: layers', () => {
  it('lower layer importing higher layer is cross-layer-violation', () => {
    const dir = tmpRepo({
      '.importlinter': `[importlinter:contract:layers]
name = Layered architecture
type = layers
layers =
    app.controllers
    app.services
    app.repo
`
    });
    try {
      const graph = pyGraph([['app/repo/order.py', 'app/controllers/api.py']]);
      const { findings } = evaluateContracts(graph, dir, { layers: LAYERS });
      assert.equal(findings.length, 1);
      assert.equal(findings[0].rule, 'cross-layer-violation');
      assert.equal(findings[0].importLinterType, 'layers');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('higher layer importing lower layer is allowed', () => {
    const dir = tmpRepo({
      '.importlinter': `[importlinter:contract:layers]
name = Layered architecture
type = layers
layers =
    app.controllers
    app.services
    app.repo
`
    });
    try {
      const graph = pyGraph([['app/controllers/api.py', 'app/services/todo.py']]);
      const { findings } = evaluateContracts(graph, dir, { layers: LAYERS });
      assert.equal(findings.length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('containers prefix layer names', () => {
    const dir = tmpRepo({
      '.importlinter': `[importlinter:contract:layers]
name = Shop layers
type = layers
layers =
    controllers
    repo
containers =
    app
`
    });
    try {
      const graph = pyGraph([['app/repo/order.py', 'app/controllers/api.py']]);
      const { findings } = evaluateContracts(graph, dir, { layers: LAYERS });
      assert.equal(findings.length, 1);
      assert.equal(findings[0].rule, 'cross-layer-violation');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('evaluateContracts: independence', () => {
  it('reports a path between independent modules', () => {
    const dir = tmpRepo({
      '.importlinter': `[importlinter:contract:indep]
name = Module independence
type = independence
modules =
    app.payments
    app.shipping
`
    });
    try {
      const graph = pyGraph([['app/payments/charge.py', 'app/shipping/label.py']]);
      const { findings } = evaluateContracts(graph, dir, { layers: {} });
      assert.equal(findings.length, 1);
      assert.equal(findings[0].rule, 'independence-violation');
      assert.equal(findings[0].importLinterContract, 'Module independence');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('evaluateContracts: incremental + builtin hook', () => {
  it('filters findings that do not touch the session diff', () => {
    const dir = tmpRepo({
      '.importlinter': `[importlinter:contract:ban]
name = No skip
type = forbidden
source_modules = app.controllers
forbidden_modules = app.repo
allow_indirect_imports = True
`
    });
    try {
      const graph = pyGraph([['app/controllers/api.py', 'app/repo/order.py']]);
      const { findings } = evaluateContracts(graph, dir, {
        layers: LAYERS,
        diff: { addedNodes: [{ path: 'README.md' }], addedEdges: [] }
      });
      assert.equal(findings.length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps findings when the session touched the source file', () => {
    const dir = tmpRepo({
      '.importlinter': `[importlinter:contract:ban]
name = No skip
type = forbidden
source_modules = app.controllers
forbidden_modules = app.repo
allow_indirect_imports = True
`
    });
    try {
      const graph = pyGraph([['app/controllers/api.py', 'app/repo/order.py']]);
      const { findings } = evaluateContracts(graph, dir, {
        layers: LAYERS,
        diff: { addedEdges: [importEdge('app/controllers/api.py', 'app/repo/order.py')] }
      });
      assert.equal(findings.length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty when no Import Linter config exists', () => {
    const dir = tmpRepo({});
    try {
      const { findings, evidence } = evaluateContracts(pyGraph([]), dir);
      assert.equal(findings.length, 0);
      assert.equal(evidence.configPath, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builtin.analyze attaches contract findings on the current graph', () => {
    const dir = tmpRepo({
      '.importlinter': `[importlinter:contract:ban]
name = No skip
type = forbidden
source_modules = app.controllers
forbidden_modules = app.repo
allow_indirect_imports = True
`
    });
    try {
      const current = pyGraph([['app/controllers/api.py', 'app/repo/order.py']]);
      const emptyBase = { nodes: [], edges: [] };
      const result = analyze(dir, {
        current,
        baseline: emptyBase,
        diff: { addedEdges: [], addedNodes: [], addedTypes: [], violations: [], removedTypes: [], addedExternalDeps: [] },
        rules: null
      });
      // empty session diff → incremental filter drops the historical edge
      assert.equal(result.violations.filter((v) => v.importLinterContract).length, 0);
      assert.equal(result.evidence.contracts.configPath.endsWith('.importlinter'), true);

      const withTouch = analyze(dir, {
        current,
        baseline: emptyBase,
        diff: {
          addedEdges: [importEdge('app/controllers/api.py', 'app/repo/order.py')],
          addedNodes: [],
          addedTypes: [],
          violations: [],
          removedTypes: [],
          addedExternalDeps: []
        },
        rules: null
      });
      const contractHits = withTouch.violations.filter((v) => v.rule === 'layer-skip' || v.rule === 'forbid-cross-layer');
      assert.ok(contractHits.length >= 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('loadLayerDefinitions shared loader', () => {
  it('loads string and object layers.json; missing/broken stay soft', () => {
    const { loadLayerDefinitions } = require('../lib/layer-infer');
    const dir = tmpRepo({
      '.av/layers.json': JSON.stringify({ 'app/controllers': 'controller', 'app/repo': 'storage' })
    });
    try {
      const ok = loadLayerDefinitions(dir);
      assert.equal(ok.error, null);
      assert.equal(ok.layers['app/controllers'], 'controller');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const objDir = tmpRepo({
      '.av/layers.json': JSON.stringify({ 'app/controllers': { layer: 'controller' } })
    });
    try {
      const ok = loadLayerDefinitions(objDir);
      assert.equal(ok.layers['app/controllers'], 'controller');
    } finally {
      fs.rmSync(objDir, { recursive: true, force: true });
    }
    const missing = tmpRepo({});
    try {
      const empty = loadLayerDefinitions(missing);
      assert.deepEqual(empty.layers, {});
      assert.equal(empty.error, null);
    } finally {
      fs.rmSync(missing, { recursive: true, force: true });
    }
    const bad = tmpRepo({ '.av/layers.json': '{not-json' });
    try {
      const broken = loadLayerDefinitions(bad);
      assert.ok(broken.error);
    } finally {
      fs.rmSync(bad, { recursive: true, force: true });
    }
  });
});
