'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildGraph } = require('../lib/extract-graph');
const { extractFile, filePathToModule } = require('../lib/extract/python');
const { assessAnalysisCompleteness } = require('../lib/analysis-completeness');

function fixture(t, files, opts) {
  const root = fs.mkdtempSync(path.join(process.cwd(), '.python-bindings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, source] of Object.entries(files)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
  }
  const graph = buildGraph(root, opts);
  assert.equal(graph.stats.parseErrors, 0);
  const ids = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    assert.ok(ids.has(edge.from), 'missing source: ' + JSON.stringify(edge));
    assert.ok(ids.has(edge.to), 'missing target: ' + JSON.stringify(edge));
  }
  return { root, graph };
}

function reference(graph, from, name, type) {
  const edge = graph.edges.find((edge) =>
    edge.from === from && edge.typeName === name && (!type || edge.type === type));
  assert.ok(edge, `missing ${type || 'reference'}: ${from} -> ${name}`);
  return edge;
}

describe('Python explicit type bindings', () => {
  it('reports syntax errors as incomplete while retaining recoverable Python entities', (t) => {
    const { root, graph: valid } = fixture(t, {
      'models.py': 'class Order:\n    pass\n',
      'app.py': 'from models import Order\nclass App:\n    item: Order\n'
    });
    assert.equal(assessAnalysisCompleteness(valid).status, 'ok');
    fs.appendFileSync(path.join(root, 'app.py'), '\ndef broken(:\n    pass\n');
    const extracted = extractFile(path.join(root, 'app.py'), root);
    assert.match(extracted.error, /syntax error/i);
    assert.ok(extracted.entities.some((entity) => entity.name === 'App'));
    assert.ok(extracted.imports.some((imp) => imp.specifier === 'models'));
    const graph = buildGraph(root);
    assert.equal(graph.stats.files, 2);
    assert.equal(graph.stats.filesParsed, 1);
    assert.equal(graph.stats.parseErrors, 1);
    assert.equal(reference(graph, 'app#App', 'Order', 'field-type').to, 'models#Order');
    const analysis = assessAnalysisCompleteness(graph);
    assert.equal(analysis.status, 'incomplete');
    assert.equal(analysis.allowGreen, false);
  });

  it('preserves qualified stdlib names and aliases without capturing local same-name classes', (t) => {
    const { graph, root } = fixture(t, {
      'other.py': 'class Signal:\n    pass\n',
      'app.py': [
        'import threading',
        'import threading as threads',
        'from threading import Event as Signal',
        'class Event:',
        '    pass',
        'class App:',
        '    event: threading.Event',
        '    def run(self, a: threads.Event, b: Signal) -> "threading.Event":',
        '        pass',
        ''
      ].join('\n')
    });
    const extracted = extractFile(path.join(root, 'app.py'), root);
    assert.deepEqual(extracted.entities.find((entity) => entity.name === 'App').fieldTypes[0].types,
      ['threading.Event']);
    for (const name of ['threading.Event', 'threads.Event', 'Signal']) {
      const edge = reference(graph, 'app#App', name, 'references-external');
      assert.equal(edge.to, 'ext:threading');
      assert.equal(edge.resolvedType, 'threading.Event');
      assert.equal(edge.builtin, true);
    }
    assert.ok(!graph.edges.some((edge) => edge.from === 'app#App' &&
      ['app#Event', 'other#Signal'].includes(edge.to)));
  });

  it('resolves explicit local aliases, module aliases, qualified bases and generic types', (t) => {
    const { graph } = fixture(t, {
      'models/__init__.py': '',
      'models/order.py': 'class Order:\n    pass\nclass Box:\n    pass\n',
      'app.py': [
        'from models.order import Order as Purchase, Box',
        'from models import order as model',
        'import models.order as orders',
        'import models.order',
        'class App(orders.Order):',
        '    field: model.Order',
        '    boxed: Box[Purchase]',
        '    def run(self, item: Purchase) -> models.order.Order:',
        '        pass',
        ''
      ].join('\n')
    });
    for (const [name, type] of [
      ['orders.Order', 'extends'], ['model.Order', 'field-type'],
      ['Purchase', 'method-param'], ['models.order.Order', 'method-return'],
      ['Purchase', 'field-type']
    ]) {
      assert.equal(reference(graph, 'app#App', name, type).to, 'models/order#Order');
    }
    assert.equal(reference(graph, 'app#App', 'Box', 'field-type').to, 'models/order#Box');
    assert.ok(graph.edges.some((edge) =>
      edge.from === 'file:app.py' && edge.to === 'file:models/order.py' && edge.type === 'import'));
  });

  it('leaves unimported and missing local names unresolved, not fabricated packages', (t) => {
    const { graph } = fixture(t, {
      'models.py': 'class Order:\n    pass\n',
      'app.py': [
        'from models import Missing',
        'class App:',
        '    order: Order',
        '    missing: Missing',
        '    qualified: models.Order',
        ''
      ].join('\n')
    });
    for (const name of ['Order', 'Missing', 'models.Order']) {
      const edge = reference(graph, 'app#App', name, 'references-unresolved');
      assert.equal(graph.nodes.find((node) => node.id === edge.to).kind, 'unresolved');
      assert.equal(edge.referenceType, 'field-type');
    }
    assert.equal(graph.stats.externalPackages, 0);
    assert.ok(!graph.nodes.some((node) => node.kind === 'external'));
    assert.ok(!graph.edges.some((edge) => edge.from === 'app#App' && edge.to === 'models#Order'));
  });

  it('distinguishes qualified sibling module imports without binding unimported siblings', (t) => {
    const { graph } = fixture(t, {
      'pkg/__init__.py': '',
      'pkg/a.py': 'class Order:\n    pass\n',
      'pkg/b.py': 'class User:\n    pass\n',
      'pkg/c.py': 'class Order:\n    pass\n',
      'app.py': 'import pkg.a\nimport pkg.b\nclass App:\n    order: pkg.a.Order\n    user: pkg.b.User\n    missing: pkg.c.Order\n'
    });
    assert.equal(reference(graph, 'app#App', 'pkg.a.Order', 'field-type').to, 'pkg/a#Order');
    assert.equal(reference(graph, 'app#App', 'pkg.b.User', 'field-type').to, 'pkg/b#User');
    reference(graph, 'app#App', 'pkg.c.Order', 'references-unresolved');
  });

  it('records optional/conditional/function imports without promoting uncertain type bindings', (t) => {
    const { root, graph } = fixture(t, {
      'models.py': 'class Order:\n    pass\n',
      'app.py': [
        'try:',
        '    from models import Order as OptionalOrder',
        '    import optional_vendor',
        'except ImportError:',
        '    pass',
        'if enabled:',
        '    from models import Order as ConditionalOrder',
        'def load():',
        '    from models import Order as HiddenOrder',
        '    return HiddenOrder()',
        'class App:',
        '    optional: OptionalOrder',
        '    conditional: ConditionalOrder',
        '    hidden: HiddenOrder',
        ''
      ].join('\n')
    });
    const imports = extractFile(path.join(root, 'app.py'), root).imports;
    assert.equal(imports.length, 4);
    assert.equal(imports.find((imp) => imp.names.includes('OptionalOrder')).conditional, true);
    assert.equal(imports.find((imp) => imp.names.includes('HiddenOrder')).scope, 'function');
    assert.ok(graph.edges.some((edge) => edge.from === 'file:app.py' &&
      edge.to === 'file:models.py' && edge.conditional && edge.type === 'import'));
    assert.ok(graph.edges.some((edge) => edge.from === 'file:app.py' &&
      edge.to === 'ext:optional_vendor' && edge.conditional));
    for (const name of ['OptionalOrder', 'ConditionalOrder', 'HiddenOrder']) {
      reference(graph, 'app#App', name, 'references-unresolved');
    }
  });

  it('does not classify missing relative or local-package imports as third-party dependencies', (t) => {
    const { graph } = fixture(t, {
      'pkg/__init__.py': '',
      'pkg/app.py': [
        'from .missing import Relative',
        'from pkg.absent import Absolute',
        'class App:',
        '    relative: Relative',
        '    absolute: Absolute',
        ''
      ].join('\n')
    });
    for (const name of ['Relative', 'Absolute']) {
      reference(graph, 'pkg/app#App', name, 'references-unresolved');
    }
    assert.equal(graph.edges.filter((edge) => edge.type === 'unresolved-import').length, 2);
    assert.equal(graph.stats.externalPackages, 0);
  });

  it('keeps nested imports out of global call resolution while retaining ordinary imported calls', (t) => {
    const { graph } = fixture(t, {
      'models.py': 'class Order:\n    pass\n',
      'scoped.py': [
        'def load():',
        '    from models import Order',
        '    return Order()',
        'def outside():',
        '    return Order()',
        ''
      ].join('\n'),
      'explicit.py': [
        'from models import Order',
        'def unrelated():',
        '    from models import Order as LocalOrder',
        '    return LocalOrder()',
        'def run():',
        '    return Order()',
        'def outside_alias():',
        '    return LocalOrder()',
        'def shadowed():',
        '    from threading import Event as Order',
        '    return Order()',
        ''
      ].join('\n')
    }, { calls: true });
    assert.ok(graph.edges.some((edge) =>
      edge.from === 'explicit#run' && edge.to === 'models#Order' && edge.type === 'call'));
    assert.ok(!graph.edges.some((edge) => edge.file === 'scoped.py' &&
      edge.to === 'models#Order' && edge.type === 'call'));
    for (const from of ['explicit#outside_alias', 'explicit#shadowed']) {
      assert.ok(!graph.edges.some((edge) => edge.from === from &&
        edge.to === 'models#Order' && edge.type === 'call'));
    }
  });

  it('resolves signatures in the enclosing scope without leaking class/body import bindings', (t) => {
    const { graph } = fixture(t, {
      'models.py': 'class Order:\n    pass\n',
      'app.py': [
        'from models import Order',
        'class App:',
        '    from models import Order as ClassOrder',
        '    plain: Order',
        '    scoped: ClassOrder',
        '    def run(self, item: Order) -> Order:',
        '        from threading import Event as Order',
        '        pass',
        'class Outside:',
        '    plain: Order',
        '    scoped: ClassOrder',
        'def run(item: Order) -> Order:',
        '    from threading import Event as Order',
        '    return item',
        'class Body:',
        '    def __init__(self, item: Order):',
        '        from threading import Event as Order',
        '        self.item: Order',
        ''
      ].join('\n')
    });
    for (const entity of ['app#App', 'app#Outside']) {
      assert.equal(reference(graph, entity, 'Order', 'field-type').to, 'models#Order');
      reference(graph, entity, 'ClassOrder', 'references-unresolved');
    }
    for (const entity of ['app#App', 'app#run']) {
      assert.equal(reference(graph, entity, 'Order', 'method-param').to, 'models#Order');
      assert.equal(reference(graph, entity, 'Order', 'method-return').to, 'models#Order');
    }
    assert.equal(reference(graph, 'app#Body', 'Order', 'method-param').to, 'models#Order');
    reference(graph, 'app#Body', 'Order', 'references-unresolved');
  });

  it('follows relative and absolute re-export aliases to real definitions', (t) => {
    const { graph } = fixture(t, {
      'pkg/__init__.py': 'from pkg.inner import Public as Facade\n',
      'pkg/inner/__init__.py': 'from .entities import Original as Public\n',
      'pkg/inner/entities.py': 'class Original:\n    pass\n',
      'app.py': [
        'from pkg import Facade as Used',
        'import pkg as api',
        'class App(Used):',
        '    item: api.Facade',
        '    def run(self, item: Used) -> Used:',
        '        pass',
        ''
      ].join('\n')
    });
    for (const [name, type] of [
      ['Used', 'extends'], ['Used', 'method-param'], ['Used', 'method-return'],
      ['api.Facade', 'field-type']
    ]) {
      assert.equal(reference(graph, 'app#App', name, type).to, 'pkg/inner/entities#Original');
    }
    assert.ok(graph.edges.some((edge) => edge.from === 'file:app.py' &&
      edge.to === 'file:pkg/inner/entities.py' && edge.type === 'import'));
    assert.ok(!graph.edges.some((edge) => /#(Facade|Public|Used)$/.test(edge.to)));
  });

  it('terminates cyclic re-exports while resolving independent exports and rejecting absent definitions', (t) => {
    const { graph } = fixture(t, {
      'a/__init__.py': 'from b import Loop as Cycle\nfrom .entities import Real\nfrom .entities import Missing\n',
      'a/entities.py': 'class Real:\n    pass\n',
      'b/__init__.py': 'from a import Cycle as Loop\n',
      'app.py': 'from a import Cycle, Real, Missing\nclass App:\n    cycle: Cycle\n    real: Real\n    missing: Missing\n'
    });
    assert.equal(reference(graph, 'app#App', 'Real', 'field-type').to, 'a/entities#Real');
    for (const name of ['Cycle', 'Missing']) {
      reference(graph, 'app#App', name, 'references-unresolved');
    }
    assert.equal(graph.stats.externalPackages, 0);
  });

  it('does not treat a conditional package re-export as a proven type definition', (t) => {
    const { graph } = fixture(t, {
      'pkg/__init__.py': 'try:\n    from .model import Order\nexcept ImportError:\n    pass\n',
      'pkg/model.py': 'class Order:\n    pass\n',
      'app.py': 'from pkg import Order\nclass App:\n    order: Order\n'
    });
    reference(graph, 'app#App', 'Order', 'references-unresolved');
    assert.ok(graph.edges.some((edge) => edge.from === 'file:pkg/__init__.py' &&
      edge.to === 'file:pkg/model.py' && edge.type === 'import'));
    assert.ok(!graph.edges.some((edge) => edge.from === 'file:app.py' && edge.to === 'file:pkg/model.py'));
  });

  it('keeps same-file forward references local and normalizes Windows package paths', (t) => {
    const { graph } = fixture(t, {
      'app.py': 'class App:\n    item: "Order"\nclass Order:\n    pass\n'
    });
    assert.equal(reference(graph, 'app#App', 'Order', 'field-type').to, 'app#Order');
    assert.equal(filePathToModule('pkg\\inner\\__init__.py'), 'pkg/inner');
    assert.equal(filePathToModule('pkg\\inner\\model.pyi'), 'pkg/inner/model');
  });
});
