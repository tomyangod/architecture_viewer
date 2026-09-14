'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
  initKit, generateToDir, generateToDirAsync, generateFiles, writeGenerated, scan, validateDir
} = require('../lib');
const { DIAGRAM_FILES } = require('../lib/kit');
const llm = require('../lib/llm-generate');

const shipped = name => fs.readFileSync(path.join(__dirname, '..', name));
const manual = '# User architecture\n\n```mermaid\ngraph TB\n A["职责描述"] --> B["Real service"]\n```\n';

function fixture(t, compat = false) {
  const repo = path.join(__dirname, '..', `.av-template-test-${randomUUID()}`);
  fs.mkdirSync(repo);
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', repo]);
  fs.writeFileSync(path.join(repo, 'main.py'), 'class App: pass\n');
  const kit = path.join(repo, 'architecture_viewer');
  if (compat) initKit(repo, 'architecture_viewer', { compatSix: true });
  else fs.mkdirSync(kit);
  return { repo, kit, file: name => path.join(kit, name), run: () => generateToDir(repo, kit) };
}

describe('conservative template cleanup', () => {
  it('removes only byte-identical shipped templates, without requiring a legacy receipt', t => {
    const f = fixture(t, true);
    const result = f.run();
    const unselected = DIAGRAM_FILES.filter(name => name !== 'block-diagram.md');
    assert.deepEqual(result.removedTemplates, unselected);
    assert.deepEqual(result.receipt.removedPlaceholders, unselected);
    for (const name of unselected) assert.equal(fs.existsSync(f.file(name)), false);
    assert.deepEqual(result.receipt.selected, ['block-diagram.md']);
  });

  it('retains manual placeholder text and edited or unknown legacy templates', t => {
    const f = fixture(t);
    const bodies = {
      'c4-container.md': manual,
      'c4-context.md': shipped('c4-context.md').toString() + '\nUser-owned additions.\n',
      'class-diagram.md': '# Legacy template\n*模板文件 · 请替换为你项目的实际内容*\n'
    };
    for (const [name, body] of Object.entries(bodies)) fs.writeFileSync(f.file(name), body);
    // An old delivery receipt is not ownership evidence for arbitrary file contents.
    fs.writeFileSync(f.file('.generate-receipt.json'), JSON.stringify({ written: Object.keys(bodies) }));
    const result = f.run();
    assert.deepEqual(result.removedTemplates, []);
    for (const [name, body] of Object.entries(bodies)) {
      assert.equal(fs.readFileSync(f.file(name), 'utf8'), body);
      assert.ok(result.retainedNotUpdated.includes(name));
    }
  });

  it('retains even a one-byte edit to a shipped template', t => {
    const f = fixture(t, true);
    const name = 'c4-container.md';
    const body = Buffer.concat([shipped(name), Buffer.from(' ')]);
    fs.writeFileSync(f.file(name), body);
    const result = f.run();
    assert.ok(result.retainedNotUpdated.includes(name));
    assert.deepEqual(fs.readFileSync(f.file(name)), body);
  });

  it('retains manual graphs in legacy kits without any receipt', t => {
    const f = fixture(t);
    fs.writeFileSync(f.file('c4-container.md'), manual);
    assert.equal(fs.existsSync(f.file('.generate-receipt.json')), false);
    const result = f.run();
    assert.deepEqual(result.removedTemplates, []);
    assert.equal(fs.readFileSync(f.file('c4-container.md'), 'utf8'), manual);
    assert.deepEqual(result.retainedNotUpdated, ['c4-container.md']);
  });

  it('keeps existing regeneration behavior for explicitly selected user edits', t => {
    const f = fixture(t);
    f.run();
    fs.writeFileSync(f.file('block-diagram.md'), manual);
    const result = generateToDir(f.repo, f.kit, { views: 'block' });
    assert.equal(result.cached, false);
    assert.deepEqual(result.written, ['block-diagram.md']);
    assert.notEqual(fs.readFileSync(f.file('block-diagram.md'), 'utf8'), manual);
    assert.deepEqual(result.removedTemplates, []);
  });

  it('cleans reintroduced exact templates on cache hits but keeps user text over repeated runs', t => {
    const f = fixture(t, true);
    f.run();
    fs.writeFileSync(f.file('c4-context.md'), shipped('c4-context.md'));
    fs.writeFileSync(f.file('c4-container.md'), manual);
    const cached = f.run();
    assert.equal(cached.cached, true);
    assert.deepEqual(cached.removedTemplates, ['c4-context.md']);
    assert.deepEqual(cached.receipt.removedPlaceholders, ['c4-context.md']);
    assert.deepEqual(cached.written, []);
    assert.ok(cached.retainedNotUpdated.includes('c4-container.md'));
    const repeated = f.run();
    assert.equal(repeated.cached, true);
    assert.deepEqual(repeated.removedTemplates, []);
    assert.equal(fs.readFileSync(f.file('c4-container.md'), 'utf8'), manual);
  });

  it('retains symlinks even when they point to exact shipped templates', t => {
    const f = fixture(t);
    const target = path.join(f.repo, 'user-copy.md');
    fs.writeFileSync(target, shipped('c4-context.md'));
    fs.symlinkSync(target, f.file('c4-context.md'));
    const result = f.run();
    assert.ok(result.retainedNotUpdated.includes('c4-context.md'));
    assert.ok(fs.lstatSync(f.file('c4-context.md')).isSymbolicLink());
    assert.deepEqual(fs.readFileSync(target), shipped('c4-context.md'));
  });

  for (const cached of [false, true]) {
    for (const operation of ['readFileSync', 'unlinkSync']) {
      it(`surfaces cleanup ${operation} failure (${cached ? 'cached' : 'fresh'})`, t => {
        const f = fixture(t, true);
        if (cached) f.run();
        const target = f.file('c4-context.md');
        fs.writeFileSync(target, shipped('c4-context.md'));
        const original = fs[operation];
        t.mock.method(fs, operation, function (file, ...args) {
          if (String(file) === target) throw Object.assign(new Error('cleanup denied'), { code: 'EACCES' });
          return original.call(this, file, ...args);
        });
        assert.throws(f.run, /cleanup denied/);
        assert.ok(fs.existsSync(target));
      });
    }

    it(`surfaces receipt write failure and retries (${cached ? 'cached' : 'fresh'})`, t => {
      const f = fixture(t);
      if (cached) {
        f.run();
        fs.unlinkSync(f.file('.generate-receipt.json'));
      }
      fs.mkdirSync(f.file('.generate-receipt.json'), { recursive: true });
      assert.throws(f.run, /EISDIR/);
      fs.rmdirSync(f.file('.generate-receipt.json'));
      const result = f.run();
      assert.equal(result.cached, true);
      assert.deepEqual(JSON.parse(fs.readFileSync(f.file('.generate-receipt.json'), 'utf8')), result.receipt);
    });
  }

  it('applies the same protection and cleanup during refinement and cache reuse', async t => {
    const f = fixture(t, true);
    fs.writeFileSync(f.file('c4-container.md'), manual);
    t.mock.method(llm, 'llmGenerate', async (repo, options) => {
      const inventory = scan(repo);
      const written = writeGenerated(f.kit, generateFiles(inventory, { views: options.only }));
      return { inventory, written, protocol: validateDir(f.kit, { files: options.only, requireFilled: true }) };
    });
    const run = () => generateToDirAsync(f.repo, f.kit, { mode: 'refine', apiKey: 'offline-test' });
    const fresh = await run();
    assert.equal(fresh.cached, false);
    assert.ok(fresh.removedTemplates.includes('c4-context.md'));
    assert.ok(fresh.retainedNotUpdated.includes('c4-container.md'));
    fs.writeFileSync(f.file('c4-context.md'), shipped('c4-context.md'));
    const cached = await run();
    assert.equal(cached.cached, true);
    assert.deepEqual(cached.removedTemplates, ['c4-context.md']);
    assert.equal(fs.readFileSync(f.file('c4-container.md'), 'utf8'), manual);
    fs.unlinkSync(f.file('.generate-receipt.json'));
    fs.mkdirSync(f.file('.generate-receipt.json'));
    await assert.rejects(run, /EISDIR/);
    assert.equal(llm.llmGenerate.mock.callCount(), 1);
  });
});

describe('diagram-preserving kit initialization', () => {
  it('surfaces copy failures rather than reporting successful initialization', t => {
    const f = fixture(t);
    t.mock.method(fs, 'copyFileSync', () => {
      throw Object.assign(new Error('copy denied'), { code: 'EACCES' });
    });
    assert.throws(() => initKit(f.repo), /copy denied/);
  });

  it('preserves existing diagrams while refreshing shipped assets on repeated initialization', t => {
    const f = fixture(t);
    const userFiles = {
      'c4-container.md': manual,
      'block-diagram.md': manual
    };
    const assets = ['architecture_visualized.html', 'vendor/mermaid.min.js', 'AGENT.md', 'architecture.config.js'];
    for (const [name, body] of Object.entries(userFiles)) fs.writeFileSync(f.file(name), body);
    for (const name of assets) {
      fs.mkdirSync(path.dirname(f.file(name)), { recursive: true });
      fs.writeFileSync(f.file(name), 'Old shipped asset\n');
    }
    const first = initKit(f.repo, 'architecture_viewer', { compatSix: true });
    assert.ok(first.copied.includes('c4-context.md'));
    for (const [name, body] of Object.entries(userFiles)) {
      assert.equal(first.copied.includes(name), false);
      assert.equal(fs.readFileSync(f.file(name), 'utf8'), body);
    }
    for (const name of assets) {
      assert.ok(first.copied.includes(name));
      assert.deepEqual(fs.readFileSync(f.file(name)), shipped(name));
      fs.writeFileSync(f.file(name), 'Another old asset\n');
    }
    const repeated = initKit(f.repo, 'architecture_viewer', { compatSix: true });
    assert.equal(repeated.copied.some(name => DIAGRAM_FILES.includes(name)), false);
    for (const name of assets) {
      assert.ok(repeated.copied.includes(name));
      assert.deepEqual(fs.readFileSync(f.file(name)), shipped(name));
    }
    for (const [name, body] of Object.entries(userFiles)) {
      assert.equal(fs.readFileSync(f.file(name), 'utf8'), body);
    }
    f.run();
    assert.equal(fs.readFileSync(f.file('c4-container.md'), 'utf8'), manual);
  });
});
