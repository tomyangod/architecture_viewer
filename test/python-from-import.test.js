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
});
