'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  viewsForKind,
  locateInSource,
  buildFixPrompt,
  enrichDriftItems,
  buildVariants
} = require('../lib/drift-locate');

function tmpRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'av-loc-'));
  fs.mkdirSync(path.join(root, 'internal', 'checkout'), { recursive: true });
  fs.writeFileSync(path.join(root, 'go.mod'), 'module example.com/order\n\ngo 1.21\n');
  fs.writeFileSync(
    path.join(root, 'internal', 'checkout', 'service.go'),
    'package checkout\n\ntype Service struct {\n  db DB\n}\n\nfunc (s *Service) Process() {}\n'
  );
  fs.mkdirSync(path.join(root, 'src', 'billing'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'billing', 'BillingService.js'),
    'class BillingService {\n  charge(a) { return a; }\n}\nmodule.exports = { BillingService };\n'
  );
  return root;
}

describe('W10-02 drift-locate 视图映射', () => {
  it('service → c4-container 优先', () => {
    const views = viewsForKind('service', 'postgres');
    assert.equal(views[0], 'c4-container.md');
  });
  it('entry → deployment 优先', () => {
    const views = viewsForKind('entry', 'main.go');
    assert.equal(views[0], 'deployment-ops.md');
  });
  it('前端 module → c4-component', () => {
    const views = viewsForKind('module', 'web/dashboard');
    assert.ok(views.includes('c4-component.md'));
  });
});

describe('W10-02 locateInSource 源码行号定位', () => {
  it('定位 Go 模块目录', () => {
    const root = tmpRepo();
    try {
      const loc = locateInSource(root, 'internal_checkout', 'internal/checkout');
      assert.ok(loc, 'should locate checkout module');
      assert.ok(/checkout/.test(loc.file), 'file mentions checkout: ' + loc.file);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('定位 JS 类定义行号', () => {
    const root = tmpRepo();
    try {
      const loc = locateInSource(root, 'billing_service', 'src/billing');
      assert.ok(loc, 'should locate BillingService');
      assert.equal(loc.line, 1, 'class on line 1: ' + JSON.stringify(loc));
      assert.ok(/class BillingService/.test(loc.snippet), 'snippet has class def');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('找不到时返回 null 不崩溃', () => {
    const root = tmpRepo();
    try {
      const loc = locateInSource(root, 'nonexistent_xyz_module', 'no/such');
      assert.equal(loc, null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('W10-02 buildFixPrompt 修复 prompt', () => {
  it('prompt 含视图名、源码位置、复检命令', () => {
    const item = {
      kind: 'module',
      label: 'internal/checkout',
      term: 'internal_checkout',
      view: 'c4-component.md',
      source: { file: 'internal/checkout/service.go', line: 3, snippet: 'type Service struct' }
    };
    const p = buildFixPrompt(item, '/repo');
    assert.ok(p.includes('c4-component.md'), 'names view file');
    assert.ok(p.includes('internal/checkout/service.go:3'), 'cites source location');
    assert.ok(p.includes('arch-viewer check'), 'includes recheck command');
    assert.ok(p.includes('snake_case'), 'mentions naming convention');
  });

  it('无源码位置时给出人工确认提示', () => {
    const item = { kind: 'service', label: 'redis', term: 'redis', view: 'c4-container.md', source: null };
    const p = buildFixPrompt(item, '/repo');
    assert.ok(p.includes('人工确认') || p.includes('未能自动定位'), 'graceful fallback');
  });
});

describe('W10-02 enrichDriftItems 批量增强', () => {
  it('每项都补 view/prompt，有 repo 时补 source', () => {
    const root = tmpRepo();
    try {
      const missing = [
        { kind: 'module', label: 'internal/checkout', term: 'internal_checkout', aliases: [] }
      ];
      const enriched = enrichDriftItems(missing, root, null);
      assert.equal(enriched.length, 1);
      assert.ok(enriched[0].view, 'has view');
      assert.ok(enriched[0].prompt, 'has prompt');
      assert.ok(enriched[0].source, 'has source location');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
