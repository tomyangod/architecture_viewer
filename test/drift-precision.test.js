'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan, checkDrift, driftTerms } = require('../lib/scan');
const { mentionedIds } = require('../lib/validate');

function mkDir(p) { fs.mkdirSync(p, { recursive: true }); }
function wr(p, c) { fs.writeFileSync(p, c); }

describe('W10-01 mentionedIds CamelCase 分词', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-drift-'));
    mkDir(dir);
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('CamelCase AuthService 产出 auth, service, auth_service 三个 token', () => {
    wr(path.join(dir, 'c4-context.md'), 'graph TB\n  A[AuthService] --> B[Database]');
    const ids = mentionedIds(dir);
    assert.ok(ids.has('auth'), 'auth token present');
    assert.ok(ids.has('service'), 'service token present');
    assert.ok(ids.has('auth_service'), 'snake_case form present');
  });

  it('PascalCase OrderController 产出 order, controller, order_controller', () => {
    wr(path.join(dir, 'c4-component.md'), 'class OrderController {\n  +createOrder()\n}');
    const ids = mentionedIds(dir);
    assert.ok(ids.has('order_controller'), 'snake_case form for PascalCase');
  });

  it('混合 CamelCase 和 snake_case 在同一图中都匹配', () => {
    wr(path.join(dir, 'c4-context.md'), 'A[BillingService] --> B[auth_service]');
    const ids = mentionedIds(dir);
    assert.ok(ids.has('billing_service'), 'billing_service from CamelCase');
    assert.ok(ids.has('auth_service'), 'auth_service from snake_case');
  });
});

describe('W10-01 checkDrift CamelCase haystack 归一化', () => {
  it('diagram 用 CamelCase 名称时 variantHit 能匹配 snake_case drift term', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'av-drift-'));
    try {
      mkDir(path.join(tmp, 'src', 'auth'));
      wr(path.join(tmp, 'package.json'), JSON.stringify({ name: 'demo' }));
      wr(path.join(tmp, 'src', 'auth', 'AuthService.js'),
        'class AuthService {\n  login(u) { return u; }\n}\nmodule.exports = { AuthService };');
      const inv = scan(tmp);
      // 模拟一个完整 diagram：提及 src、auth（以 AuthService CamelCase 形式）
      const mentioned = new Set();  // 空 token set，强制走 variantHit
      const hay = 'graph TB\n  src[AuthService] --> DB[Database]\n  subgraph src/auth\n  end';
      const drift = checkDrift(inv, mentioned, hay);
      // src 在 haystack 里；src_auth 的 alias auth 出现在 AuthService（CamelCase 拆分后）
      assert.ok(drift.ok, 'drift should pass when CamelCase is in haystack: missing=' +
        drift.missing.map((m) => m.term).join(', '));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('W10-01 collectClasses Go/Vue/React', () => {
  it('Go type X struct 被提取为 class', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'av-go-'));
    try {
      mkDir(path.join(tmp, 'internal', 'checkout'));
      wr(path.join(tmp, 'go.mod'), 'module example.com/order\n\ngo 1.21\n');
      wr(path.join(tmp, 'internal', 'checkout', 'service.go'),
        'package checkout\n\ntype Service struct {\n  db DB\n}\n\nfunc (s *Service) Process() {}\n');
      const inv = scan(tmp);
      const names = inv.classes.map((c) => c.name);
      assert.ok(names.includes('Service'), 'Go type X struct extracted: ' + names.join(', '));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('Vue SFC 组件名从文件名提取', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'av-vue-'));
    try {
      mkDir(path.join(tmp, 'src', 'catalog'));
      wr(path.join(tmp, 'package.json'), JSON.stringify({ name: 'demo' }));
      wr(path.join(tmp, 'src', 'catalog', 'CatalogPage.vue'),
        '<template><div>Products</div></template>\n<script>export default {}</script>');
      const inv = scan(tmp);
      const names = inv.classes.map((c) => c.name);
      assert.ok(names.includes('CatalogPage'), 'Vue component name extracted: ' + names.join(', '));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('React tsx function component 被提取', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'av-react-'));
    try {
      mkDir(path.join(tmp, 'src', 'checkout'));
      wr(path.join(tmp, 'package.json'), JSON.stringify({ name: 'demo' }));
      wr(path.join(tmp, 'src', 'checkout', 'CheckoutPage.tsx'),
        'export function CheckoutPage() {\n  return <div>Checkout</div>;\n}\n');
      const inv = scan(tmp);
      const names = inv.classes.map((c) => c.name);
      assert.ok(names.includes('CheckoutPage'), 'React function component extracted: ' + names.join(', '));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('Java class + interface 都被提取', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'av-java-'));
    try {
      mkDir(path.join(tmp, 'src', 'service'));
      wr(path.join(tmp, 'pom.xml'), '<project></project>');
      wr(path.join(tmp, 'src', 'service', 'OrderService.java'),
        'package com.example;\n\npublic class OrderService {\n  void create() {}\n}\n');
      wr(path.join(tmp, 'src', 'service', 'OrderRepository.java'),
        'package com.example;\n\npublic interface OrderRepository {\n  Order findById(Long id);\n}\n');
      const inv = scan(tmp);
      const names = inv.classes.map((c) => c.name);
      assert.ok(names.includes('OrderService'), 'Java class extracted: ' + names.join(', '));
      assert.ok(names.includes('OrderRepository'), 'Java interface extracted: ' + names.join(', '));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('W10-01 Java 夹具 eval 零漂移', () => {
  it('java-order 夹具 generate + check drift 全过', () => {
    const fixturePath = path.join(__dirname, '..', 'eval', 'fixtures', 'java-order');
    if (!fs.existsSync(fixturePath)) return;
    const inv = scan(fixturePath);
    assert.ok(inv.languages.includes('java'), 'java detected: ' + inv.languages.join(','));
    // 模拟 diagram 文本包含所有 drift term 的内容
    const kitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-java-kit-'));
    try {
      const { generateToDir } = require('../lib/index');
      const r = generateToDir(fixturePath, kitDir);
      assert.equal(r.drift.ok, true, 'drift should pass for java-order: ' +
        (r.drift.missing || []).map((m) => m.label).join(', '));
    } finally {
      fs.rmSync(kitDir, { recursive: true, force: true });
    }
  });
});
