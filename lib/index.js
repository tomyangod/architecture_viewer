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
  refinePayloadScale
} = require('./cache');

/** 缓存里的 inventory 去掉机器相关绝对路径，落盘可移植。 */
function stripInventory(inv) {
  const { root, ...rest } = inv;
  return rest;
}

function diagramsOnDisk(kitDir) {
  return DIAGRAM_FILES.every((f) => fs.existsSync(path.join(kitDir, f)));
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

  // 快路径：源码清单未变 + 6 张图都在 + 缓存里有 inventory ⇒ 跳过扫描、生成与重复校验
  if (cache && cache.manifestHash === manifest.hash && diagramsOnDisk(kitDir) && cache.inventory) {
    const inventory = Object.assign({}, cache.inventory, { root: path.resolve(repoRoot) });
    // 图未变（写入时已校验），直接复用上次校验结论，避免再读 3 遍图文件
    const check = cache.check || { protoOk: true, driftOk: true };
    const protocol = { ok: !!check.protoOk, errors: [], warnings: [], missing: [], cached: true };
    const drift = { ok: check.driftOk !== false, missing: [], extra: [], cached: true };
    return {
      kitDir,
      inventory,
      written: [],
      protocol,
      drift,
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
    check: { protoOk: protocol.ok, driftOk: drift.ok },
    savedAt: new Date().toISOString()
  });
  return {
    kitDir,
    inventory,
    written,
    protocol,
    drift,
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
    // 增量判定：源码未变则跳过精修；有缓存则只精修骨架输入发生变化的视图（省 token）
    let only = Array.isArray(options.only) ? options.only : (options.only || null);
    let skipped = false;
    try {
      const manifest = sourceManifest(repoRoot);
      const cache = loadCache(kitDir);
      if (!only && cache && cache.manifestHash === manifest.hash && diagramsOnDisk(kitDir)) {
        skipped = true;
      } else if (!only && cache && cache.diagrams) {
        const skeleton = generateFiles(scan(repoRoot));
        const { changed } = diffDiagrams(cache.diagrams, skeleton, kitDir, DIAGRAM_FILES);
        if (changed.length === 0) skipped = true;
        else if (changed.length < DIAGRAM_FILES.length) only = changed;
      }
    } catch { /* 增量判定失败则回退全量精修 */ }

    if (skipped) {
      const cache = loadCache(kitDir);
      const inventory = cache && cache.inventory
        ? Object.assign({}, cache.inventory, { root: path.resolve(repoRoot) })
        : scan(repoRoot);
      const protocol = validateDir(kitDir, { requireFilled: true });
      const drift = checkDrift(inventory, mentionedIds(kitDir), haystack(kitDir));
      return {
        kitDir, inventory, written: [], protocol, drift,
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
    // 精修后刷新缓存（以落盘图内容为准）
    try {
      const onDisk = {};
      for (const f of DIAGRAM_FILES) {
        try { onDisk[f] = fs.readFileSync(path.join(kitDir, f), 'utf8'); } catch { /* ignore */ }
      }
      saveCache(kitDir, {
        version: 1,
        manifestHash: sourceManifest(repoRoot).hash,
        diagrams: diagramContentHashes(onDisk),
        inventory: stripInventory(llm.inventory),
        savedAt: new Date().toISOString()
      });
    } catch { /* 缓存刷新失败不影响结果 */ }
    const drift = checkDrift(llm.inventory, mentionedIds(kitDir), haystack(kitDir));
    return {
      kitDir,
      inventory: llm.inventory,
      written: llm.written,
      protocol: llm.protocol,
      drift,
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
  const protocol = validateDir(kitDir, { requireFilled: options.requireFilled });
  let drift = null;
  if (options.drift) {
    const repo = options.repo || path.resolve(kitDir, '..');
    drift = checkDrift(scan(repo), mentionedIds(kitDir), haystack(kitDir));
  }
  let rules = null;
  try {
    rules = require('./rules').evaluateKitRules(kitDir, {
      rules: options.rules,
      repo: options.repo
    });
  } catch (e) {
    rules = {
      ok: false,
      violations: [{ rule: 'rules-file', kind: 'rules-file', file: '', message: e.message, detail: '' }],
      error: e.message
    };
  }
  const ok = protocol.ok && (!drift || drift.ok) && (!rules || rules.ok);
  return { ok, protocol, drift, rules };
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
