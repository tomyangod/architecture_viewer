'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planRefineFromCache, sourceManifest } = require('../lib/cache');
const { DIAGRAM_FILES } = require('../lib/kit');
const { generateToDir, generateToDirAsync } = require('../lib');
const { scan } = require('../lib/scan');
const { validateDir } = require('../lib/validate');
const llm = require('../lib/llm-generate');

const HASH = 'abc123';
const ready = { diagramsReady: true, generationKey: 'current-generator' };
const refined = {
  engine: 'llm', manifestHash: HASH, generationKey: ready.generationKey,
  refinedFiles: DIAGRAM_FILES, check: { protoOk: true }
};

describe('planRefineFromCache（--refine 不得被骨架缓存短路）', () => {
  it('无缓存：不跳过', () => {
    const p = planRefineFromCache(null, HASH, ready);
    assert.equal(p.skipped, false);
  });

  function mockRefinement(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'av-refine-cache-'));
    const kit = path.join(root, 'architecture_viewer');
    fs.writeFileSync(path.join(root, 'main.py'), 'class Collector: pass\n');
    generateToDir(root, kit, { compatSix: true });
    const templates = Object.fromEntries(DIAGRAM_FILES.map(file =>
      [file, fs.readFileSync(path.join(kit, file), 'utf8')]));
    const calls = [];
    t.mock.method(llm, 'llmGenerate', async (repo, options) => {
      const files = options.only || DIAGRAM_FILES;
      calls.push([...files]);
      for (const file of files) fs.writeFileSync(path.join(kit, file), templates[file] + '\nRefinement fixture.\n');
      return { inventory: scan(repo), protocol: validateDir(kit, { requireFilled: true }), written: files, model: 'offline-test' };
    });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return {
      root, kit, calls,
      run: options => generateToDirAsync(root, kit, { mode: 'refine', apiKey: 'offline-test', ...options })
    };
  }

  describe('refine cache integration without model calls', () => {
    it('reuses a full verified refinement but repairs overwritten output', async (t) => {
      const fixture = mockRefinement(t);
      assert.equal((await fixture.run({ compatSix: true })).cached, false, 'skeleton cannot satisfy refinement');
      assert.equal((await fixture.run({ compatSix: true })).cached, true);
      assert.equal(fixture.calls.length, 1);
      fs.writeFileSync(path.join(fixture.kit, 'c4-container.md'), '# Init template\n');
      const repaired = await fixture.run({ compatSix: true });
      assert.equal(repaired.cached, false);
      assert.equal(repaired.protocol.ok, true);
      assert.equal(repaired.semantics.status, 'unverified');
      assert.equal(fixture.calls.length, 2);
    });

    it('partial refinement does not claim all six views were refined', async (t) => {
      const fixture = mockRefinement(t);
      await fixture.run({ only: ['block-diagram.md'] });
      assert.deepEqual(fixture.calls[0], ['block-diagram.md']);
      assert.equal((await fixture.run({ compatSix: true })).cached, false);
      assert.deepEqual(fixture.calls[1], DIAGRAM_FILES);
      assert.equal((await fixture.run({ compatSix: true })).cached, true);
    });

    it('changed exclusions invalidate refinement and explicit skeleton changes engine', async (t) => {
      const fixture = mockRefinement(t);
      await fixture.run();
      fs.writeFileSync(path.join(fixture.root, '.arch-viewer-ignore'), 'archived\n');
      assert.equal((await fixture.run()).cached, false);
      const skeleton = await generateToDirAsync(fixture.root, fixture.kit, { mode: 'skeleton', apiKey: 'offline-test' });
      assert.equal(skeleton.cached, false);
      assert.equal(skeleton.engine, 'skeleton');
      assert.equal(fixture.calls.length, 2, 'explicit skeleton does not call the model');
    });

    it('excluded files stay out of both refinement excerpts and cache inputs', async t => {
      const fixture = mockRefinement(t);
      const directory = path.join(fixture.root, 'integration');
      fs.mkdirSync(directory);
      const file = path.join(directory, 'main.py');
      fs.writeFileSync(file, 'excluded_payload = "before"\n');
      fs.writeFileSync(path.join(fixture.root, '.arch-viewer-ignore'), 'integration/\n');
      const context = llm.buildRefineContext(fixture.root, scan(fixture.root));
      assert.ok(!context.tree.files.has('integration/main.py'));
      assert.doesNotMatch(context.excerptText, /excluded_payload/);
      await fixture.run();
      const before = sourceManifest(fixture.root);
      fs.writeFileSync(file, 'excluded_payload = "after"\n');
      assert.equal(sourceManifest(fixture.root).hash, before.hash);
      assert.equal((await fixture.run()).cached, true);
      assert.equal(fixture.calls.length, 1);
      assert.doesNotMatch(llm.buildRefineContext(fixture.root, scan(fixture.root)).excerptText, /excluded_payload/);
    });

    it('tracks CI content and file-tree changes used by refinement', async t => {
      const fixture = mockRefinement(t);
      const ci = path.join(fixture.root, '.github', 'workflows', 'ci.yml');
      fs.mkdirSync(path.dirname(ci), { recursive: true });
      fs.writeFileSync(ci, 'name: before\n');
      assert.ok(llm.buildRefineContext(fixture.root, scan(fixture.root)).tree.files.has('.github/workflows/ci.yml'));
      await fixture.run();
      fs.writeFileSync(ci, 'name: after\n');
      assert.equal((await fixture.run()).cached, false);
      const before = sourceManifest(fixture.root);
      fs.writeFileSync(path.join(fixture.root, 'input.csv'), 'value\n');
      assert.notEqual(sourceManifest(fixture.root).hash, before.hash);
    });
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
      refined,
      HASH,
      ready
    );
    assert.equal(p.skipped, true);
  });

  it('changed source requires refinement even if a skeleton would look unchanged', () => {
    const p = planRefineFromCache(
      { ...refined, manifestHash: 'old' },
      HASH,
      ready
    );
    assert.equal(p.skipped, false);
    assert.equal(p.considerIncremental, false);
  });

  for (const invalid of [
    { generationKey: 'old-generator' }, { refinedFiles: ['block-diagram.md'] },
    { check: undefined }, { check: { protoOk: false } }
  ]) {
    it('cannot reuse partial, obsolete or unvalidated refinement', () => {
      assert.equal(planRefineFromCache({ ...refined, ...invalid }, HASH, ready).skipped, false);
    });
  }

  it('requires matching output content, not just six files existing', () => {
    assert.equal(planRefineFromCache(refined, HASH, { ...ready, diagramsReady: false }).skipped, false);
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
