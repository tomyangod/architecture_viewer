'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { suggestForFinding } = require('../lib/risk-rules');

describe('suggestForFinding 按违规方向给建议', () => {
  it('controller → storage：经 service 中转', () => {
    const s = suggestForFinding({
      rule: 'layer-skip',
      fromLayer: 'controller',
      toLayer: 'storage'
    });
    assert.match(s, /service|中转/);
    assert.ok(!/反向/.test(s));
  });

  it('storage → controller：反向依赖，不要套「加中间人」', () => {
    const s = suggestForFinding({
      rule: 'cross-layer-violation',
      fromLayer: 'storage',
      toLayer: 'controller'
    });
    assert.match(s, /反向/);
    assert.ok(!/加一层"中间人"|加一层「中间人」/.test(s));
    assert.match(s, /依赖倒置|反转|下沉/);
  });

  it('util → service：工具层职责或分层标错', () => {
    const s = suggestForFinding({
      rule: 'cross-layer-violation',
      fromLayer: 'util',
      toLayer: 'service'
    });
    assert.match(s, /工具层|分层/);
  });

  it('component → storage：UI 直访持久层', () => {
    const s = suggestForFinding({
      rule: 'layer-skip',
      fromLayer: 'component',
      toLayer: 'storage'
    });
    assert.match(s, /service|中转|仓库/);
  });
});
