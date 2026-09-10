'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildGraph } = require('../lib/extract-graph');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-java-ty-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe('Java members → type wiring edges', () => {
  it('字段类型和构造参数落到本地类，不造 ext:String', () => {
    const dir = makeRepo({
      'src/main/java/app/PaymentGateway.java': [
        'package app;',
        'public class PaymentGateway {}',
        ''
      ].join('\n'),
      'src/main/java/app/OrderService.java': [
        'package app;',
        'public class OrderService {',
        '  private PaymentGateway gateway;',
        '  public OrderService(PaymentGateway gateway) { this.gateway = gateway; }',
        '  public PaymentGateway getGateway() { return gateway; }',
        '  public String name() { return "x"; }',
        '}',
        ''
      ].join('\n')
    });
    try {
      const g = buildGraph(dir);
      const from = g.edges.filter((e) => e.from === 'app.OrderService');
      assert.ok(
        from.some((e) => e.type === 'field-type' && e.to === 'app.PaymentGateway'),
        '应有 field-type: ' + from.map((e) => e.type + '→' + e.to).join(',')
      );
      assert.ok(
        from.some((e) => e.type === 'method-param' && e.to === 'app.PaymentGateway'),
        '应有 method-param'
      );
      assert.ok(
        from.some((e) => e.type === 'method-return' && e.to === 'app.PaymentGateway'),
        '应有 method-return'
      );
      assert.ok(
        !from.some((e) => String(e.to).includes('String')),
        'JDK String 不应落边'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
