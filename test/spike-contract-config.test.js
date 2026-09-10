'use strict';

/**
 * M1 spike: verify contract-config.js works standalone,
 * independent of the importlinter/depcruise adapter files.
 */

const assert = require('node:assert');
const { describe, it, before, after } = require('node:test');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  findImportLinterConfig,
  parseContractConfig,
  parseIniContracts,
  parsePyprojectContracts,
  isAvContract,
  findDepcruiseConfig,
  parseDepcruiseConfig,
  DEPCRUISE_CONFIG_NAMES
} = require('../lib/analyzers/contract-config');

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-spike-'));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/* ── Import Linter: INI parsing ── */

describe('M1 spike: contract-config — Import Linter INI', () => {
  it('parseContractConfig reads .importlinter INI with name + type + av-no section', () => {
    const cfgPath = path.join(tmpDir, '.importlinter');
    fs.writeFileSync(cfgPath, [
      '[importlinter]',
      'root_package = myapp',
      '',
      '[importlinter:contract:av-no-controller-to-storage]',
      'name = Architecture Viewer: controller must not directly import storage',
      'type = forbidden',
      'as_packages = False',
      'source_modules =',
      '    myapp.controllers',
      '    myapp.api',
      'forbidden_modules =',
      '    myapp.repo',
      'allow_indirect_imports = True',
      '',
      '[importlinter:contract:layer-policy]',
      'name = Layer Policy',
      'type = layers',
      'layers =',
      '    myapp.controllers',
      '    myapp.services',
      '    myapp.repo',
      '',
      '[importlinter:contract:independence]',
      'name = Module independence',
      'type = independence',
      'modules =',
      '    myapp.payments',
      '    myapp.shipping',
      ''
    ].join('\n'));

    const map = parseContractConfig(cfgPath);
    assert.strictEqual(map.size, 3);

    const av = map.get('Architecture Viewer: controller must not directly import storage');
    assert.ok(av, 'av contract found by name');
    assert.strictEqual(av.type, 'forbidden');
    assert.strictEqual(av.sectionId, 'av-no-controller-to-storage');
    assert.strictEqual(av.avGenerated, true);
    assert.deepStrictEqual(av.source_modules, ['myapp.controllers', 'myapp.api']);
    assert.deepStrictEqual(av.forbidden_modules, ['myapp.repo']);
    assert.strictEqual(av.allow_indirect_imports, true);
    assert.strictEqual(av.as_packages, false);

    const lp = map.get('Layer Policy');
    assert.ok(lp, 'layer policy found by name');
    assert.strictEqual(lp.type, 'layers');
    assert.strictEqual(lp.avGenerated, false);
    assert.deepStrictEqual(lp.layers, ['myapp.controllers', 'myapp.services', 'myapp.repo']);

    const ind = map.get('Module independence');
    assert.ok(ind);
    assert.strictEqual(ind.type, 'independence');
    assert.deepStrictEqual(ind.modules, ['myapp.payments', 'myapp.shipping']);
  });

  it('parseContractConfig reads same-line list values in INI', () => {
    const cfgPath = path.join(tmpDir, 'same-line.importlinter');
    fs.writeFileSync(cfgPath, [
      '[importlinter:contract:team-ban]',
      'name = No storage hop',
      'type = forbidden',
      'source_modules = pkg.controllers',
      'forbidden_modules = pkg.storage',
      ''
    ].join('\n'));
    const map = parseContractConfig(cfgPath);
    const c = map.get('No storage hop');
    assert.deepStrictEqual(c.source_modules, ['pkg.controllers']);
    assert.deepStrictEqual(c.forbidden_modules, ['pkg.storage']);
  });

  it('isAvContract only matches av-no-* section ids, not av-* or display names', () => {
    assert.strictEqual(isAvContract('av-no-controller-to-storage'), true);
    assert.strictEqual(isAvContract('av-policy'), false);
    assert.strictEqual(isAvContract(null), false);
    assert.strictEqual(isAvContract(''), false);
  });

  it('findImportLinterConfig finds .importlinter, setup.cfg, pyproject.toml', () => {
    // .importlinter
    const dir1 = path.join(tmpDir, 'ini1');
    fs.mkdirSync(dir1, { recursive: true });
    fs.writeFileSync(path.join(dir1, '.importlinter'), '[importlinter]\nroot_package=x\n');
    assert.strictEqual(path.basename(findImportLinterConfig(dir1)), '.importlinter');

    // setup.cfg
    const dir2 = path.join(tmpDir, 'ini2');
    fs.mkdirSync(dir2, { recursive: true });
    fs.writeFileSync(path.join(dir2, 'setup.cfg'), '[importlinter]\nroot_package = x\n');
    assert.strictEqual(path.basename(findImportLinterConfig(dir2)), 'setup.cfg');

    // none
    const dir3 = path.join(tmpDir, 'ini3');
    fs.mkdirSync(dir3, { recursive: true });
    assert.strictEqual(findImportLinterConfig(dir3), null);
  });
});

/* ── Import Linter: TOML parsing ── */

describe('M1 spike: contract-config — Import Linter TOML', () => {
  it('parseContractConfig reads pyproject.toml [[tool.importlinter.contracts]] with inline comments', () => {
    const cfgPath = path.join(tmpDir, 'pyproject.toml');
    fs.writeFileSync(cfgPath, [
      '[tool.importlinter]',
      'root_package = "myapp"',
      '',
      '[[tool.importlinter.contracts]]',
      'name = "Layer Policy"',
      'type = "layers" # this is a comment',
      'layers = [',
      '  "myapp.controllers",',
      '  "myapp.services",',
      '  "myapp.repo",',
      ']',
      '',
      '[[tool.importlinter.contracts]]',
      'id = "av-no-controller-to-storage"',
      'name = "No Storage"',
      'type = "forbidden"',
      'source_modules = ["myapp.controllers"]',
      'forbidden_modules = ["myapp.repo"]',
      'allow_indirect_imports = true',
      'as_packages = false',
      ''
    ].join('\n'));

    const map = parseContractConfig(cfgPath);
    assert.strictEqual(map.size, 2);
    const layers = map.get('Layer Policy');
    assert.strictEqual(layers.type, 'layers');
    assert.deepStrictEqual(layers.layers, ['myapp.controllers', 'myapp.services', 'myapp.repo']);

    const forbidden = map.get('No Storage');
    assert.strictEqual(forbidden.type, 'forbidden');
    assert.strictEqual(forbidden.sectionId, 'av-no-controller-to-storage');
    assert.strictEqual(forbidden.avGenerated, true);
    assert.deepStrictEqual(forbidden.source_modules, ['myapp.controllers']);
    assert.deepStrictEqual(forbidden.forbidden_modules, ['myapp.repo']);
    assert.strictEqual(forbidden.allow_indirect_imports, true);
    assert.strictEqual(forbidden.as_packages, false);
  });

  it('parseContractConfig returns empty Map for null/missing path', () => {
    assert.strictEqual(parseContractConfig(null).size, 0);
    assert.strictEqual(parseContractConfig('/nonexistent/path').size, 0);
  });
});

/* ── dependency-cruiser: JSON config parsing ── */

describe('M1 spike: contract-config — depcruise JSON', () => {
  it('parseDepcruiseConfig reads .dependency-cruiser.json and extracts forbidden array', () => {
    const cfgPath = path.join(tmpDir, '.dependency-cruiser.json');
    fs.writeFileSync(cfgPath, JSON.stringify({
      forbidden: [
        { name: 'no-circular', severity: 'warn', from: {}, to: { circular: true } },
        { name: 'av-no-controller-to-storage', severity: 'error', from: { path: 'src/controllers' }, to: { path: 'src/storage' } }
      ]
    }));

    const { rules, configPath, error } = parseDepcruiseConfig(cfgPath);
    assert.strictEqual(error, null);
    assert.strictEqual(rules.length, 2);
    assert.strictEqual(rules[0].name, 'no-circular');
    assert.strictEqual(rules[1].severity, 'error');
  });
});

/* ── dependency-cruiser: CJS config parsing ── */

describe('M1 spike: contract-config — depcruise CJS', () => {
  it('parseDepcruiseConfig reads .dependency-cruiser.cjs via require()', () => {
    const cfgPath = path.join(tmpDir, '.dependency-cruiser.cjs');
    fs.writeFileSync(cfgPath, [
      'module.exports = {',
      '  forbidden: [',
      '    { name: "no-circular", severity: "warn", from: {}, to: { circular: true } },',
      '    { name: "av-no-skip", severity: "error", from: { path: "a" }, to: { path: "b" } }',
      '  ]',
      '};'
    ].join('\n'));

    const { rules, error } = parseDepcruiseConfig(cfgPath);
    assert.strictEqual(error, null);
    assert.strictEqual(rules.length, 2);
    assert.strictEqual(rules[1].name, 'av-no-skip');
  });
});

/* ── dependency-cruiser: config file finding ── */

describe('M1 spike: contract-config — depcruise config discovery', () => {
  it('findDepcruiseConfig finds .dependency-cruiser.cjs', () => {
    const dir = path.join(tmpDir, 'depdir');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.dependency-cruiser.cjs'), 'module.exports = {};');
    const found = findDepcruiseConfig(dir);
    assert.ok(found);
    assert.strictEqual(path.basename(found), '.dependency-cruiser.cjs');
  });

  it('DEPCRUISE_CONFIG_NAMES covers 7 known extensions', () => {
    assert.ok(DEPCRUISE_CONFIG_NAMES.length >= 7);
    assert.ok(DEPCRUISE_CONFIG_NAMES.includes('.dependency-cruiser.cjs'));
    assert.ok(DEPCRUISE_CONFIG_NAMES.includes('.dependency-cruiser.json'));
    assert.ok(DEPCRUISE_CONFIG_NAMES.includes('.dependency-cruiser.mjs'));
  });

  it('parseDepcruiseConfig handles missing path gracefully', () => {
    const { rules, error } = parseDepcruiseConfig(null);
    assert.strictEqual(rules.length, 0);
    assert.ok(error);
  });
});

/* ── Config discovery still works without adapters ── */

describe('M1 spike: config discovery without CLI adapters', () => {
  it('contract-config exports find/parse helpers', () => {
    assert.strictEqual(typeof findImportLinterConfig, 'function');
    assert.strictEqual(typeof parseContractConfig, 'function');
    assert.strictEqual(typeof findDepcruiseConfig, 'function');
    assert.strictEqual(typeof parseDepcruiseConfig, 'function');
  });
});
