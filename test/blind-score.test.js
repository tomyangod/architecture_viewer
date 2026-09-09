'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveBlindWinner } = require('../lib/orch/blind-score');

describe('blind winner scoring', () => {
  it('uses weighted totals and names the largest-gap dimension', () => {
    const out = resolveBlindWinner({
      A: { story: 9, layer: 9, edge: 9, paths: 9, naming: 8, density: 8, spec: 8, deliverable: 9 },
      B: { story: 6, layer: 6, edge: 6, paths: 3, naming: 6, density: 6, spec: 6, deliverable: 6 }
    });
    assert.equal(out.winner, 'A');
    assert.equal(out.gapDim, 'paths');
    assert.match(out.decisive, /paths/);
    assert.ok(out.totals.A > out.totals.B);
  });

  it('ties when weighted scores are close', () => {
    const even = {
      story: 7, layer: 7, edge: 7, paths: 7, naming: 7, density: 7, spec: 7, deliverable: 7
    };
    const out = resolveBlindWinner({ A: even, B: { ...even, naming: 7.1 } });
    assert.equal(out.winner, 'tie');
  });
});
