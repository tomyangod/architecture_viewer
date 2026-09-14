'use strict';

const fs = require('fs');
const path = require('path');
const { DIAGRAM_FILES } = require('./kit');
const { validateDir, mentionedIds } = require('./validate');
const { scan, checkDrift } = require('./scan');
const { generateFiles } = require('./generate');
const { initKit, findKitDir, writeGenerated, agentPrompt, productRoot } = require('./init');
const {
  sourceManifest,
  loadCache,
  saveCache,
  diagramContentHashes,
  diffDiagrams,
  refinePayloadScale,
  planRefineFromCache,
  generationKey,
  diagramsMatchCache
} = require('./cache');

/** 缓存里的 inventory 去掉机器相关绝对路径，落盘可移植。 */
function stripInventory(inv) {
  const { root, ...rest } = inv;
  return rest;
}

function haystack(kitDir) {
  return DIAGRAM_FILES.map((f) => {
    const p = path.join(kitDir, f);
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return '';
    }
  }).join('\n');
}

function generateToDir(repoRoot, kitDir) {
  const t0 = Date.now();
  const manifest = sourceManifest(repoRoot);
  const cache = loadCache(kitDir);
  const key = generationKey('skeleton');

  // Only reuse checks for the same engine, inputs and verified on-disk content.
  if (cache && cache.engine === 'skeleton' && cache.generationKey === key &&
      cache.manifestHash === manifest.hash && cache.inventory &&
      cache.check && cache.check.protocol && cache.check.protocol.ok &&
      cache.check.drift && diagramsMatchCache(cache, kitDir)) {
    const inventory = Object.assign({}, cache.inventory, { root: path.resolve(repoRoot) });
    const protocol = Object.assign({}, cache.check.protocol, { cached: true });
    const drift = Object.assign({}, cache.check.drift, { cached: true });
    return {
      kitDir,
      inventory,
      written: [],
      protocol,
      drift,
      semantics: { status: 'unverified', basis: 'static-inventory' },
      cached: true,
      changedDiagrams: [],
      unchangedDiagrams: DIAGRAM_FILES.slice(),
      manifestHash: manifest.hash,
      payloadScale: refinePayloadScale({}, []),
      timing: { ms: Date.now() - t0, cached: true }
    };
  }

  // 慢路径：扫描 + 生成，再按内容哈希逐图决定是否重写
  const inventory = scan(repoRoot);
  const files = generateFiles(inventory);
  const prevHashes = (cache && cache.diagrams) || {};
  const { changed, unchanged } = diffDiagrams(prevHashes, files, kitDir, DIAGRAM_FILES);
  const changedFiles = {};
  for (const name of changed) changedFiles[name] = files[name];
  const written = writeGenerated(kitDir, changedFiles);

  const protocol = validateDir(kitDir, { requireFilled: true });
  const drift = checkDrift(inventory, mentionedIds(kitDir), haystack(kitDir));
  saveCache(kitDir, {
    version: 1,
    manifestHash: manifest.hash,
    diagrams: diagramContentHashes(files),
    inventory: stripInventory(inventory),
    sourceFileCount: manifest.fileCount,
    check: { protoOk: protocol.ok, driftOk: drift.ok, protocol, drift },
    engine: 'skeleton',
    generationKey: key,
    savedAt: new Date().toISOString()
  });
  return {
    kitDir,
    inventory,
    written,
    protocol,
    drift,
    semantics: { status: 'unverified', basis: 'static-inventory' },
    cached: false,
    changedDiagrams: changed,
    unchangedDiagrams: unchanged,
    manifestHash: manifest.hash,
    payloadScale: refinePayloadScale(files, changed),
    timing: { ms: Date.now() - t0, cached: false }
  };
}

function generateForRepo(repoRoot, destRel) {
  const root = path.resolve(repoRoot);
  let kitDir = findKitDir(root);
  if (!kitDir) {
    const inited = initKit(root, destRel || 'architecture_viewer');
    kitDir = inited.dest;
  }
  return generateToDir(root, kitDir);
}

function hasLlmKey(apiKey) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  return !!(key || process.env.DEEPSEEK_API_KEY);
}

/**
 * Resolve skeleton vs refine (LLM) engine.
 * Internal engine id remains 'llm'; product flag is --refine / mode=refine|llm.
 * CLI --refine uses { strict: true } so a missing key is an error, not a silent downgrade.
 * Web may pass mode='llm' and fall back to skeleton when no key.
 */
function resolveGenerateMode(requested, apiKey, opts) {
  if (requested === 'skeleton') {
    return { engine: 'skeleton', fallback: false, reason: 'explicit' };
  }
  const wantRefine = requested === 'llm' || requested === 'refine';
  if (requested != null && !wantRefine) {
    return { engine: 'skeleton', fallback: false, reason: 'explicit' };
  }
  if (!hasLlmKey(apiKey)) {
    if (opts && opts.strict) {
      const err = new Error(
        '精修需要 DEEPSEEK_API_KEY（CLI: --refine；Web: quality=refine，可在请求里传 apiKey）。只要骨架图则去掉 --refine，或传 quality=fast。'
      );
      err.status = 401;
      err.code = 'LLM_KEY_MISSING';
      throw err;
    }
    return { engine: 'skeleton', fallback: true, reason: 'no-key' };
  }
  return {
    engine: 'llm',
    fallback: false,
    reason: wantRefine ? 'explicit' : 'default-key'
  };
}

async function generateToDirAsync(repoRoot, kitDir, opts) {
  const options = opts || {};
  const resolved = resolveGenerateMode(options.mode, options.apiKey, {
    strict: !!options.strict
  });
  if (resolved.engine === 'llm') {
    const t0 = Date.now();
    const selected = Array.isArray(options.only) ? options.only : (options.only ? [options.only] : []);
    const only = selected.length ? selected : null;
    const manifest = sourceManifest(repoRoot);
    const cache = loadCache(kitDir);
    const key = generationKey('llm');
    const cacheReady = diagramsMatchCache(cache, kitDir);
    const plan = planRefineFromCache(cache, manifest.hash, {
      only, diagramsReady: cacheReady, generationKey: key
    });

    if (plan.skipped) {
      const inventory = cache && cache.inventory
        ? Object.assign({}, cache.inventory, { root: path.resolve(repoRoot) })
        : scan(repoRoot);
      const protocol = validateDir(kitDir, { requireFilled: true });
      const drift = checkDrift(inventory, mentionedIds(kitDir), haystack(kitDir));
      return {
        kitDir, inventory, written: [], protocol, drift,
        semantics: { status: 'unverified', basis: 'model-refinement' },
        engine: 'llm', fallback: false, reason: resolved.reason,
        cached: true, changedDiagrams: [], unchangedDiagrams: DIAGRAM_FILES.slice(),
        timing: { ms: Date.now() - t0, cached: true }
      };
    }

    const { llmGenerate } = require('./llm-generate');
    const llm = await llmGenerate(repoRoot, {
      kitDir,
      apiKey: options.apiKey,
      only
    });
    const drift = checkDrift(llm.inventory, mentionedIds(kitDir), haystack(kitDir));
    const onDisk = {};
    for (const f of DIAGRAM_FILES) onDisk[f] = fs.readFileSync(path.join(kitDir, f), 'utf8');
    const previousRefined = cacheReady && cache.engine === 'llm' &&
      cache.manifestHash === manifest.hash && cache.generationKey === key
      ? (cache.refinedFiles || []) : [];
    saveCache(kitDir, {
      version: 1,
      manifestHash: manifest.hash,
      diagrams: diagramContentHashes(onDisk),
      inventory: stripInventory(llm.inventory),
      engine: 'llm',
      generationKey: key,
      refinedFiles: [...new Set([...previousRefined, ...(only || DIAGRAM_FILES)])],
      check: { protoOk: llm.protocol.ok, driftOk: drift.ok, protocol: llm.protocol, drift },
      savedAt: new Date().toISOString()
    });
    return {
      kitDir,
      inventory: llm.inventory,
      written: llm.written,
      protocol: llm.protocol,
      drift,
      semantics: { status: 'unverified', basis: 'model-refinement' },
      engine: 'llm',
      fallback: false,
      reason: resolved.reason,
      model: llm.model,
      gateReport: llm.gateReport,
      refineRoute: llm.refineRoute || null,
      cached: false,
      changedDiagrams: Array.isArray(only) ? only : DIAGRAM_FILES.slice(),
      timing: { ms: Date.now() - t0, cached: false }
    };
  }
  const result = generateToDir(repoRoot, kitDir);
  return Object.assign(result, {
    engine: 'skeleton',
    fallback: resolved.fallback,
    reason: resolved.reason
  });
}

async function generateForRepoAsync(repoRoot, destRel, opts) {
  const options = opts || {};
  resolveGenerateMode(options.mode, options.apiKey, { strict: !!options.strict });
  const root = path.resolve(repoRoot);
  let kitDir = findKitDir(root);
  if (!kitDir) {
    const inited = initKit(root, destRel || 'architecture_viewer');
    kitDir = inited.dest;
  }
  return generateToDirAsync(root, kitDir, options);
}

function checkKit(kitDir, opts) {
  const options = Object.assign({ requireFilled: false, drift: false, repo: null, rules: undefined }, opts);
  const missingKit = DIAGRAM_FILES.every((f) => !fs.existsSync(path.join(kitDir, f)));
  const protocol = validateDir(kitDir, { requireFilled: options.requireFilled });
  let drift = null;
  let scanError = null;
  let missingRepo = false;
  if (options.drift) {
    const repo = options.repo || path.resolve(kitDir, '..');
    if (!fs.existsSync(repo)) {
      missingRepo = true;
    } else if (!fs.statSync(repo).isDirectory()) {
      scanError = 'Repo path is not a directory: ' + repo;
    } else {
      try {
        drift = checkDrift(scan(repo), mentionedIds(kitDir), haystack(kitDir));
      } catch (e) {
        scanError = e.message;
      }
    }
  }
  let rules = null;
  let configError = null;
  try {
    rules = require('./rules').evaluateKitRules(kitDir, {
      rules: options.rules,
      repo: options.repo
    });
  } catch (e) {
    configError = e.message;
    rules = {
      ok: false,
      violations: [{ rule: 'rules-file', kind: 'rules-file', file: '', message: e.message, detail: '' }],
      error: e.message
    };
  }
  const ok = !configError && !scanError && !missingKit && !missingRepo
    && protocol.ok && (!drift || drift.ok) && (!rules || rules.ok);
  return { ok, protocol, drift, rules, configError, scanError, missingKit, missingRepo };
}

module.exports = {
  validateDir,
  mentionedIds,
  scan,
  checkDrift,
  generateFiles,
  initKit,
  findKitDir,
  writeGenerated,
  agentPrompt,
  productRoot,
  generateForRepo,
  generateToDir,
  generateToDirAsync,
  generateForRepoAsync,
  resolveGenerateMode,
  hasLlmKey,
  checkKit,
  inspectShape: (...a) => require('./refine-route').inspectShape(...a),
  chooseRefinePipeline: (...a) => require('./refine-route').chooseRefinePipeline(...a)
};
