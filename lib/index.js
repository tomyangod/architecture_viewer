'use strict';

const fs = require('fs');
const path = require('path');
const { DIAGRAM_FILES } = require('./kit');
const { validateDir, mentionedIds } = require('./validate');
const { scan, checkDrift } = require('./scan');
const { generateFiles } = require('./generate');
const { initKit, findKitDir, writeGenerated, agentPrompt, productRoot } = require('./init');

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
  const inventory = scan(repoRoot);
  const files = generateFiles(inventory);
  const written = writeGenerated(kitDir, files);
  const protocol = validateDir(kitDir, { requireFilled: true });
  const drift = checkDrift(inventory, mentionedIds(kitDir), haystack(kitDir));
  return { kitDir, inventory, written, protocol, drift };
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
    const { llmGenerate } = require('./llm-generate');
    const llm = await llmGenerate(repoRoot, {
      kitDir,
      apiKey: options.apiKey,
      only: options.only || null
    });
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
      gateReport: llm.gateReport
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
  const options = Object.assign({ requireFilled: false, drift: false, repo: null }, opts);
  const protocol = validateDir(kitDir, { requireFilled: options.requireFilled });
  let drift = null;
  if (options.drift) {
    const repo = options.repo || path.resolve(kitDir, '..');
    drift = checkDrift(scan(repo), mentionedIds(kitDir), haystack(kitDir));
  }
  const ok = protocol.ok && (!drift || drift.ok);
  return { ok, protocol, drift };
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
  checkKit
};
