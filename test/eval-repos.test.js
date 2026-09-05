'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { generateToDir, checkKit, validateDir } = require('../lib/index');

const ROOT = path.join(__dirname, '..');
const REPOS = path.join(ROOT, 'eval', 'repos.json');

describe('W03-02 five-repo eval coverage', () => {
  it('repos.json has 6 entries including frontend, go, and java', () => {
    const spec = JSON.parse(fs.readFileSync(REPOS, 'utf8'));
    assert.equal(spec.repos.length, 6);
    const kinds = spec.repos.map((r) => r.kind);
    assert.ok(kinds.includes('frontend'), kinds.join(','));
    assert.ok(kinds.includes('go'), kinds.join(','));
    assert.ok(kinds.includes('java'), kinds.join(','));
    const frontend = spec.repos.find((r) => r.kind === 'frontend');
    const go = spec.repos.find((r) => r.kind === 'go');
    const java = spec.repos.find((r) => r.kind === 'java');
    assert.ok(fs.existsSync(path.resolve(path.dirname(REPOS), frontend.path)));
    assert.ok(fs.existsSync(path.resolve(path.dirname(REPOS), go.path)));
    assert.ok(fs.existsSync(path.resolve(path.dirname(REPOS), java.path)));
  });

  it('shop-frontend generate is green', () => {
    const repo = path.join(ROOT, 'eval', 'fixtures', 'shop-frontend');
    const kit = path.join(ROOT, 'eval', 'out', '_test-shop-frontend');
    fs.mkdirSync(kit, { recursive: true });
    const result = generateToDir(repo, kit);
    assert.equal(result.protocol.ok, true, result.protocol.errors.join('\n'));
    assert.equal(result.drift.ok, true, JSON.stringify(result.drift.missing));
    assert.ok(result.inventory.languages.includes('javascript'));
    assert.ok(result.inventory.modules.some((m) => /catalog|checkout|src/i.test(m.label)));
  });

  it('order-go generate is green', () => {
    const repo = path.join(ROOT, 'eval', 'fixtures', 'order-go');
    const kit = path.join(ROOT, 'eval', 'out', '_test-order-go');
    fs.mkdirSync(kit, { recursive: true });
    const result = generateToDir(repo, kit);
    assert.equal(result.protocol.ok, true, result.protocol.errors.join('\n'));
    assert.equal(result.drift.ok, true, JSON.stringify(result.drift.missing));
    assert.ok(result.inventory.languages.includes('go'));
    assert.ok(result.inventory.modules.some((m) => /catalog|checkout|ordersvc/i.test(m.label)));
  });

  it('demo-drift fixture fails protocol and filled check', () => {
    const dir = path.join(ROOT, 'eval', 'demo-drift');
    const protocol = validateDir(dir, { requireFilled: true });
    assert.equal(protocol.ok, false);
    assert.ok(protocol.errors.some((e) => /NOT DECLARED/.test(e)));
    const checked = checkKit(dir, { requireFilled: true });
    assert.equal(checked.ok, false);
  });
});
