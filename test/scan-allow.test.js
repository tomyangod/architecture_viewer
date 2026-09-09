'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { walkSourceFiles, SECRET_FILE_RE } = require('../lib/extract/shared');

describe('scan allowlist and secret skip', () => {
  it('recognizes secret filenames', () => {
    assert.ok(SECRET_FILE_RE.test('.env'));
    assert.ok(SECRET_FILE_RE.test('.env.local'));
    assert.ok(SECRET_FILE_RE.test('id_rsa'));
    assert.ok(SECRET_FILE_RE.test('server.pem'));
    assert.ok(!SECRET_FILE_RE.test('app.js'));
  });

  it('AV_SCAN_ALLOW limits top-level directories', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-scan-allow-'));
    fs.mkdirSync(path.join(repo, 'src'));
    fs.mkdirSync(path.join(repo, 'secretpkg'));
    fs.writeFileSync(path.join(repo, 'src', 'ok.js'), 'module.exports = 1;\n');
    fs.writeFileSync(path.join(repo, 'secretpkg', 'leak.js'), 'module.exports = 2;\n');
    const prev = process.env.AV_SCAN_ALLOW;
    process.env.AV_SCAN_ALLOW = 'src';
    try {
      const byLang = walkSourceFiles(repo);
      const js = byLang.get('javascript') || [];
      assert.ok(js.some((p) => p.endsWith('ok.js')));
      assert.ok(!js.some((p) => p.endsWith('leak.js')));
    } finally {
      if (prev === undefined) delete process.env.AV_SCAN_ALLOW;
      else process.env.AV_SCAN_ALLOW = prev;
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
