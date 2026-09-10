'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  EXIT,
  normalizeFailOn,
  shouldGate,
  exitCodeForRisk,
  exitCodeForCheck,
  exitCodeFromError,
  codedError
} = require('../lib/exit-codes');

describe('exit-codes: contract constants', () => {
  it('0/1/2/3/4 语义固定', () => {
    assert.equal(EXIT.OK, 0);
    assert.equal(EXIT.GATE_FAILED, 1);
    assert.equal(EXIT.USAGE_ERROR, 2);
    assert.equal(EXIT.SCAN_FAILED, 3);
    assert.equal(EXIT.NO_BASELINE, 4);
  });
});

describe('exit-codes: shouldGate / --fail-on', () => {
  it('默认 high：仅 high 阻断', () => {
    assert.equal(exitCodeForRisk('high'), EXIT.GATE_FAILED);
    assert.equal(exitCodeForRisk('medium'), EXIT.OK);
    assert.equal(exitCodeForRisk('low'), EXIT.OK);
    assert.equal(exitCodeForRisk('none'), EXIT.OK);
  });

  it('--fail-on medium：medium 及以上阻断', () => {
    assert.equal(exitCodeForRisk('high', 'medium'), 1);
    assert.equal(exitCodeForRisk('medium', 'medium'), 1);
    assert.equal(exitCodeForRisk('low', 'medium'), 0);
  });

  it('--fail-on low：任何 finding 阻断', () => {
    assert.equal(exitCodeForRisk('low', 'low'), 1);
    assert.equal(exitCodeForRisk('none', 'low'), 0);
  });

  it('--fail-on none 不被当成 high（0 是合法阈值）', () => {
    assert.equal(shouldGate('high', 'none'), false);
    assert.equal(exitCodeForRisk('high', 'none'), 0);
  });

  it('拒绝未知 --fail-on 阈值', () => {
    assert.throws(() => normalizeFailOn('warning'), /must be one of/);
    assert.throws(() => shouldGate('high', 'warning'), /must be one of/);
  });
});

describe('exit-codes: check 分级', () => {
  it('配置错 / 扫描失败 / 无套件 优先于 ok=false', () => {
    assert.equal(exitCodeForCheck({ ok: false, configError: 'bad yaml' }), EXIT.USAGE_ERROR);
    assert.equal(exitCodeForCheck({ ok: false, scanError: 'boom' }), EXIT.SCAN_FAILED);
    assert.equal(exitCodeForCheck({ ok: false, missingKit: true }), EXIT.NO_BASELINE);
    assert.equal(exitCodeForCheck({ ok: false, missingRepo: true }), EXIT.NO_BASELINE);
    assert.equal(exitCodeForCheck({ ok: false }), EXIT.GATE_FAILED);
    assert.equal(exitCodeForCheck({ ok: true }), EXIT.OK);
  });

  it('exitCodeFromError 认 .exitCode 与常见 code', () => {
    assert.equal(exitCodeFromError(codedError('x', 4)), 4);
    assert.equal(exitCodeFromError(Object.assign(new Error('nf'), { code: 'RULES_NOT_FOUND' })), 2);
    assert.equal(exitCodeFromError(Object.assign(new Error('gone'), { code: 'ENOENT' })), 4);
    assert.equal(exitCodeFromError(new Error('parse')), 3);
  });
});
