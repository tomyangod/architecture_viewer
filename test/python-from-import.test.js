'use strict';

/**
 * Python `from pkg import mod` 应落到子模块文件，而不是包的 __init__.py。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildGraph, resolvePyModule } = require('../lib/extract-graph');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-py-from-import-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe('Python from pkg import mod 精确解析', () => {
  it('from services import order_service → services/order_service.py，不是 __init__.py', () => {
    const dir = makeRepo({
      'services/__init__.py': '',
      'services/order_service.py': 'class OrderService:\n    pass\n',
      'routes/orders.py': [
        'from services import order_service',
        'from services.order_service import OrderService',
        'class Orders:',
        '    def __init__(self, s: OrderService):',
        '        self.s = s',
        ''
      ].join('\n')
    });
    try {
      const g = buildGraph(dir);
      const imports = g.edges.filter((e) => e.type === 'import' && e.from === 'file:routes/orders.py');
      const tos = imports.map((e) => e.to).sort();
      assert.ok(tos.includes('file:services/order_service.py'), '应依赖子模块文件: ' + tos.join(','));
      assert.ok(
        !tos.includes('file:services/__init__.py'),
        'from services import order_service 不应落到包 __init__: ' + tos.join(',')
      );
      // dotted 形式仍应指向子模块（可重复，去重后至少一次）
      assert.equal(
        imports.filter((e) => e.to === 'file:services/order_service.py').length >= 1,
        true
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('from pkg import ClassName（类在 __init__）仍落到包文件', () => {
    const dir = makeRepo({
      'pkg/__init__.py': 'class Facade:\n    pass\n',
      'app/main.py': 'from pkg import Facade\nclass App:\n    def run(self, f: Facade):\n        pass\n'
    });
    try {
      const g = buildGraph(dir);
      const imports = g.edges.filter((e) => e.type === 'import' && e.from === 'file:app/main.py');
      assert.ok(imports.some((e) => e.to === 'file:pkg/__init__.py'));
      const param = g.edges.find((e) => e.type === 'method-param' && e.typeName === 'Facade');
      assert.ok(param, '类型边应解析到 Facade');
      assert.equal(param.to, 'pkg#Facade');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('相对导入 from . import sibling 落到同包 sibling.py', () => {
    const dir = makeRepo({
      'services/__init__.py': '',
      'services/a.py': 'class A:\n    pass\n',
      'services/b.py': 'from . import a\nclass B:\n    pass\n'
    });
    try {
      const g = buildGraph(dir);
      const imports = g.edges.filter((e) => e.type === 'import' && e.from === 'file:services/b.py');
      assert.ok(imports.some((e) => e.to === 'file:services/a.py'), JSON.stringify(imports));
      assert.ok(!imports.some((e) => e.to === 'file:services/__init__.py'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolvePyModule 对子模块名返回 kind=submodule', () => {
    const map = new Map([
      ['services', 'services/__init__.py'],
      ['services/order_service', 'services/order_service.py']
    ]);
    const fe = { package: 'routes', module: 'routes/orders' };
    const sub = resolvePyModule('services', fe, map, 'order_service');
    assert.equal(sub.kind, 'submodule');
    assert.equal(sub.file, 'services/order_service.py');
    const pkg = resolvePyModule('services', fe, map);
    assert.equal(pkg.kind, 'module');
    assert.equal(pkg.file, 'services/__init__.py');
  });

  it('sys.path 根：from services.x import fn 落到 backend/services/x.py', () => {
    const dir = makeRepo({
      'backend/services/alerts_service.py': 'def alerts_detail(i):\n    return i\n',
      'backend/routes/alerts.py': 'from services.alerts_service import alerts_detail\ndef handle_alerts_detail(i):\n    return alerts_detail(i)\n'
    });
    try {
      const g = buildGraph(dir, { calls: true });
      const imports = g.edges.filter((e) => e.type === 'import' && e.from === 'file:backend/routes/alerts.py');
      assert.ok(
        imports.some((e) => e.to === 'file:backend/services/alerts_service.py'),
        '应落到 backend/services，不是 ext:services: ' + imports.map((e) => e.to).join(',')
      );
      assert.ok(!imports.some((e) => e.to === 'ext:services'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('suffix 歧义（两处 services/x）不乱绑', () => {
    const map = new Map([
      ['backend/services/alerts_service', 'backend/services/alerts_service.py'],
      ['tools/services/alerts_service', 'tools/services/alerts_service.py']
    ]);
    const fe = { package: 'backend/routes', module: 'backend/routes/alerts' };
    assert.equal(resolvePyModule('services.alerts_service', fe, map), null);
  });

  it('单段 specifier 不做 suffix（避免 json.py 误绑）', () => {
    const map = new Map([['vendor/json', 'vendor/json.py']]);
    const fe = { package: '', module: 'app' };
    assert.equal(resolvePyModule('json', fe, map), null);
  });

  it('resolvePyModule 对 null/非字符串 specifier 返回 null（不抛）', () => {
    const fe = { package: '', module: 'a' };
    assert.equal(resolvePyModule(null, fe, new Map()), null);
    assert.equal(resolvePyModule(undefined, fe, new Map()), null);
    assert.equal(resolvePyModule(12, fe, new Map()), null);
  });

  it('__init__ 再导出：from pkg import Alert → alerts.py，不是 __init__.py', () => {
    const dir = makeRepo({
      'pkg/__init__.py': 'from .alerts import Alert\n',
      'pkg/alerts.py': 'class Alert:\n    pass\n',
      'app/main.py': 'from pkg import Alert\nclass App:\n    def run(self, a: Alert):\n        pass\n'
    });
    try {
      const g = buildGraph(dir);
      const imports = g.edges.filter((e) => e.type === 'import' && e.from === 'file:app/main.py');
      assert.ok(
        imports.some((e) => e.to === 'file:pkg/alerts.py'),
        '再导出应落到 alerts.py: ' + imports.map((e) => e.to).join(',')
      );
      assert.ok(
        !imports.some((e) => e.to === 'file:pkg/__init__.py'),
        '不应只落在 __init__: ' + imports.map((e) => e.to).join(',')
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('多级再导出：pkg → subpkg/__init__ → alerts.py', () => {
    const dir = makeRepo({
      'pkg/__init__.py': 'from .subpkg import Alert\n',
      'pkg/subpkg/__init__.py': 'from .alerts import Alert\n',
      'pkg/subpkg/alerts.py': 'class Alert:\n    pass\n',
      'app/main.py': 'from pkg import Alert\nclass App:\n    def run(self, a: Alert):\n        pass\n'
    });
    try {
      const g = buildGraph(dir);
      const imports = g.edges.filter((e) => e.type === 'import' && e.from === 'file:app/main.py');
      assert.ok(
        imports.some((e) => e.to === 'file:pkg/subpkg/alerts.py'),
        '链式再导出应落到 alerts.py: ' + imports.map((e) => e.to).join(',')
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('__all__ 字面量 + from pkg import * 落到再导出文件', () => {
    const dir = makeRepo({
      'pkg/__init__.py': 'from .alerts import Alert\n__all__ = ["Alert"]\n',
      'pkg/alerts.py': 'class Alert:\n    pass\n',
      'app/main.py': 'from pkg import *\nclass App:\n    def run(self, a: Alert):\n        pass\n'
    });
    try {
      const g = buildGraph(dir);
      const imports = g.edges.filter((e) => e.type === 'import' && e.from === 'file:app/main.py');
      assert.ok(
        imports.some((e) => e.to === 'file:pkg/alerts.py'),
        'star + __all__ 应落到 alerts.py: ' + imports.map((e) => e.to).join(',')
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('JS barrel export { Alert } from 落到源文件', () => {
    const dir = makeRepo({
      'pkg/index.js': "export { Alert } from './alerts.js';\n",
      'pkg/alerts.js': 'export class Alert {}\n',
      'app.js': "import { Alert } from './pkg';\nexport class App { run(a) { return a; } }\n"
    });
    try {
      const g = buildGraph(dir);
      const imports = g.edges.filter((e) => e.type === 'import' && e.from === 'file:app.js');
      assert.ok(
        imports.some((e) => e.to === 'file:pkg/alerts.js'),
        'JS barrel 应落到 alerts.js: ' + imports.map((e) => e.to).join(',')
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
