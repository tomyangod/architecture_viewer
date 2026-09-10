'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { planRefineFromCache } = require('../lib/cache');

const HASH = 'abc123';
const ready = { diagramsReady: true };

describe('planRefineFromCache（--refine 不得被骨架缓存短路）', () => {
  it('无缓存：不跳过', () => {
    const p = planRefineFromCache(null, HASH, ready);
    assert.equal(p.skipped, false);
  });

  it('骨架缓存且源码未变：仍不跳过（第一次 --refine 必须打 LLM）', () => {
    const p = planRefineFromCache(
      { engine: 'skeleton', manifestHash: HASH },
      HASH,
      ready
    );
    assert.equal(p.skipped, false);
    assert.equal(p.considerIncremental, false);
  });

  it('旧缓存缺 engine 字段：当骨架，不跳过', () => {
    const p = planRefineFromCache({ manifestHash: HASH }, HASH, ready);
    assert.equal(p.skipped, false);
  });

  it('上次已是精修且源码未变：跳过', () => {
    const p = planRefineFromCache(
      { engine: 'llm', manifestHash: HASH },
      HASH,
      ready
    );
    assert.equal(p.skipped, true);
  });

  it('上次已是精修但源码变了：不跳过，走增量判定', () => {
    const p = planRefineFromCache(
      { engine: 'llm', manifestHash: 'old' },
      HASH,
      ready
    );
    assert.equal(p.skipped, false);
    assert.equal(p.considerIncremental, true);
  });

  it('显式 only：不跳过、不改 only', () => {
    const p = planRefineFromCache(
      { engine: 'llm', manifestHash: HASH },
      HASH,
      { only: ['block-diagram.md'], diagramsReady: true }
    );
    assert.equal(p.skipped, false);
    assert.deepEqual(p.only, ['block-diagram.md']);
  });
});
