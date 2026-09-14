'use strict';

const fs = require('fs');
const path = require('path');
const { DIAGRAM_FILES } = require('./kit');
const { validateDir, mentionedIds, PLACEHOLDER } = require('./validate');
const { scan, checkDrift } = require('./scan');
const { generateFiles } = require('./generate');
const { initKit, findKitDir, writeGenerated, agentPrompt, productRoot } = require('./init');
const { resolveViews, DEFAULT_DIAGRAM_FILES } = require('./view-policy');
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

function removeUnselectedTemplates(kitDir, selected) {
  const removed = [];
  for (const name of DIAGRAM_FILES) {
    if (selected.includes(name)) continue;
    const p = path.join(kitDir, name);
    if (!fs.existsSync(p)) continue;
    let text = '';
    try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    if (!PLACEHOLDER.test(text)) continue;
    fs.unlinkSync(p);
    removed.push(name);
  }
  return removed;
}

/** Diagram files still on disk but not selected for this generate round. */
function listRetainedDiagrams(kitDir, selected) {
  const retained = [];
  const selectedSet = new Set(selected || []);
  for (const name of DIAGRAM_FILES) {
    if (selectedSet.has(name)) continue;
    if (fs.existsSync(path.join(kitDir, name))) retained.push(name);
  }
  return retained;
}

/**
 * Write a receipt so upgrades can tell "written this round" from "old file still on disk".
 * Does not delete user-edited diagrams.
 */
function writeGenerateReceipt(kitDir, payload) {
  const receipt = {
    version: 1,
    generatedAt: new Date().toISOString(),
    policy: payload.policy || null,
    selected: payload.selected || [],
    written: payload.written || [],
    reused: payload.reused || [],
    skipped: (payload.skipped || []).map((s) => ({
      file: s.file,
      reason: s.reason
    })),
    retainedNotUpdated: payload.retainedNotUpdated || [],
    removedPlaceholders: payload.removedPlaceholders || [],
    note: 'retainedNotUpdated 是磁盘上仍存在、但本轮未重写的图；不要当成刚刚生成。用户手改图不会被删除。'
  };
  try {
    fs.writeFileSync(path.join(kitDir, '.generate-receipt.json'), JSON.stringify(receipt, null, 2));
  } catch {
    /* ignore */
  }
  return receipt;
}

function generateToDir(repoRoot, kitDir, opts) {
  const options = opts || {};
  const t0 = Date.now();
  const manifest = sourceManifest(repoRoot);
  const cache = loadCache(kitDir);
  const previewInv = cache && cache.inventory
    ? Object.assign({}, cache.inventory, { root: path.resolve(repoRoot) })
    : null;
  const decision = resolveViews(Object.assign({}, options, {
    repoRoot,
    inventory: previewInv || options.inventory
  }));
  const selected = decision.selected;
  const key = generationKey('skeleton', { views: selected });

  // Only reuse checks for the same engine, inputs, view set and verified on-disk content.
  if (cache && cache.engine === 'skeleton' && cache.generationKey === key &&
      cache.manifestHash === manifest.hash && cache.inventory &&
      cache.check && cache.check.protocol && cache.check.protocol.ok &&
      cache.check.drift && diagramsMatchCache(cache, kitDir, selected)) {
    const inventory = Object.assign({}, cache.inventory, { root: path.resolve(repoRoot) });
    const protocol = Object.assign({}, cache.check.protocol, { cached: true });
    const drift = Object.assign({}, cache.check.drift, { cached: true });
    const retainedNotUpdated = listRetainedDiagrams(kitDir, selected);
    const receipt = writeGenerateReceipt(kitDir, {
      policy: decision.policy,
      selected,
      written: [],
      reused: selected.slice(),
      skipped: decision.skipped,
      retainedNotUpdated,
      removedPlaceholders: []
    });
    return {
      kitDir,
      inventory,
      written: [],
      protocol,
      drift,
      semantics: { status: 'unverified', basis: 'static-inventory' },
      cached: true,
      changedDiagrams: [],
      unchangedDiagrams: selected.slice(),
      skippedViews: decision.skipped,
      viewPolicy: decision.policy,
      retainedNotUpdated,
      receipt,
      manifestHash: manifest.hash,
      payloadScale: refinePayloadScale({}, []),
      timing: { ms: Date.now() - t0, cached: true }
    };
  }

  const inventory = scan(repoRoot);
  const resolved = resolveViews(Object.assign({}, options, { repoRoot, inventory }));
  const views = resolved.selected;
  const files = generateFiles(inventory, { views, focusFiles: resolved.focusFiles });
  const prevHashes = (cache && cache.diagrams) || {};
  const { changed, unchanged } = diffDiagrams(prevHashes, files, kitDir, views);
  const changedFiles = {};
  for (const name of changed) changedFiles[name] = files[name];
  const written = writeGenerated(kitDir, changedFiles);
  const removedTemplates = removeUnselectedTemplates(kitDir, views);
  const retainedNotUpdated = listRetainedDiagrams(kitDir, views);

  const protocol = validateDir(kitDir, { requireFilled: true, files: views });
  const drift = checkDrift(inventory, mentionedIds(kitDir), haystack(kitDir));
  saveCache(kitDir, {
    version: 1,
    manifestHash: manifest.hash,
    diagrams: diagramContentHashes(files),
    inventory: stripInventory(inventory),
    sourceFileCount: manifest.fileCount,
    check: { protoOk: protocol.ok, driftOk: drift.ok, protocol, drift },
    engine: 'skeleton',
    generationKey: generationKey('skeleton', { views }),
    views,
    savedAt: new Date().toISOString()
  });
  const receipt = writeGenerateReceipt(kitDir, {
    policy: resolved.policy,
    selected: views,
    written,
    reused: unchanged,
    skipped: resolved.skipped,
    retainedNotUpdated,
    removedPlaceholders: removedTemplates
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
    skippedViews: resolved.skipped,
    viewPolicy: resolved.policy,
    removedTemplates,
    retainedNotUpdated,
    receipt,
    manifestHash: manifest.hash,
    payloadScale: refinePayloadScale(files, changed),
    timing: { ms: Date.now() - t0, cached: false }
  };
}

function generateForRepo(repoRoot, destRel, opts) {
  const options = opts || {};
  const root = path.resolve(repoRoot);
  let kitDir = findKitDir(root);
  if (!kitDir) {
    const inited = initKit(root, destRel || 'architecture_viewer', { compatSix: !!options.compatSix });
    kitDir = inited.dest;
  }
  return generateToDir(root, kitDir, options);
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
  const modeResolved = resolveGenerateMode(options.mode, options.apiKey, {
    strict: !!options.strict
  });
  if (modeResolved.engine === 'llm') {
    const t0 = Date.now();
    const inventoryForViews = scan(repoRoot);
    const viewDecision = resolveViews(Object.assign({}, options, {
      repoRoot,
      inventory: inventoryForViews
    }));
    const requestedOnly = Array.isArray(options.only) ? options.only : (options.only ? [options.only] : []);
    const only = requestedOnly.length ? requestedOnly : viewDecision.selected.slice();
    const manifest = sourceManifest(repoRoot);
    const cache = loadCache(kitDir);
    const key = generationKey('llm', { views: only });
    const cacheReady = diagramsMatchCache(cache, kitDir, only);
    const plan = planRefineFromCache(cache, manifest.hash, {
      only: requestedOnly.length ? only : null,
      files: only,
      diagramsReady: cacheReady,
      generationKey: key
    });

    if (plan.skipped) {
      const inventory = cache && cache.inventory
        ? Object.assign({}, cache.inventory, { root: path.resolve(repoRoot) })
        : inventoryForViews;
      const protocol = validateDir(kitDir, { requireFilled: true, files: only });
      const drift = checkDrift(inventory, mentionedIds(kitDir), haystack(kitDir));
      const retainedNotUpdated = listRetainedDiagrams(kitDir, only);
      const receipt = writeGenerateReceipt(kitDir, {
        policy: viewDecision.policy,
        selected: only,
        written: [],
        reused: only.slice(),
        skipped: viewDecision.skipped,
        retainedNotUpdated,
        removedPlaceholders: []
      });
      return {
        kitDir, inventory, written: [], protocol, drift,
        semantics: { status: 'unverified', basis: 'model-refinement' },
        engine: 'llm', fallback: false, reason: modeResolved.reason,
        cached: true, changedDiagrams: [], unchangedDiagrams: only.slice(),
        skippedViews: viewDecision.skipped,
        viewPolicy: viewDecision.policy,
        retainedNotUpdated,
        receipt,
        timing: { ms: Date.now() - t0, cached: true }
      };
    }

    const { llmGenerate } = require('./llm-generate');
    const llm = await llmGenerate(repoRoot, {
      kitDir,
      apiKey: options.apiKey,
      only
    });
    const removedTemplates = removeUnselectedTemplates(kitDir, only);
    const drift = checkDrift(llm.inventory, mentionedIds(kitDir), haystack(kitDir));
    const onDisk = {};
    for (const f of only) {
      const p = path.join(kitDir, f);
      if (fs.existsSync(p)) onDisk[f] = fs.readFileSync(p, 'utf8');
    }
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
      refinedFiles: [...new Set([...previousRefined, ...only])],
      views: only,
      check: { protoOk: llm.protocol.ok, driftOk: drift.ok, protocol: llm.protocol, drift },
      savedAt: new Date().toISOString()
    });
    const retainedNotUpdated = listRetainedDiagrams(kitDir, only);
    const receipt = writeGenerateReceipt(kitDir, {
      policy: viewDecision.policy,
      selected: only,
      written: llm.written,
      reused: [],
      skipped: viewDecision.skipped,
      retainedNotUpdated,
      removedPlaceholders: removedTemplates
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
      reason: modeResolved.reason,
      model: llm.model,
      gateReport: llm.gateReport,
      refineRoute: llm.refineRoute || null,
      cached: false,
      changedDiagrams: only.slice(),
      skippedViews: viewDecision.skipped,
      viewPolicy: viewDecision.policy,
      removedTemplates,
      retainedNotUpdated,
      receipt,
      timing: { ms: Date.now() - t0, cached: false }
    };
  }
  const result = generateToDir(repoRoot, kitDir, options);
  return Object.assign(result, {
    engine: 'skeleton',
    fallback: modeResolved.fallback,
    reason: modeResolved.reason
  });
}

async function generateForRepoAsync(repoRoot, destRel, opts) {
  const options = opts || {};
  resolveGenerateMode(options.mode, options.apiKey, { strict: !!options.strict });
  const root = path.resolve(repoRoot);
  let kitDir = findKitDir(root);
  if (!kitDir) {
    const inited = initKit(root, destRel || 'architecture_viewer', { compatSix: !!options.compatSix });
    kitDir = inited.dest;
  }
  return generateToDirAsync(root, kitDir, options);
}

function checkKit(kitDir, opts) {
  const options = Object.assign({ requireFilled: false, drift: false, repo: null, rules: undefined }, opts);
  const missingKit = DEFAULT_DIAGRAM_FILES.every((f) => !fs.existsSync(path.join(kitDir, f))) &&
    DIAGRAM_FILES.every((f) => !fs.existsSync(path.join(kitDir, f)));
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
  chooseRefinePipeline: (...a) => require('./refine-route').chooseRefinePipeline(...a),
  resolveViews: (...a) => require('./view-policy').resolveViews(...a)
};
