'use strict';

/**
 * 增量生成缓存（W07-01）。
 *
 * 两层信号：
 *   1. sourceManifest(root) hashes source and configuration without parsing.
 *      A hit also requires the same generator, engine and validated output bytes.
 *   2. Diagram hashes avoid rewriting unchanged skeleton output. Source changes
 *      invalidate full refinement; skeleton equality cannot prove semantic equality.
 *
 * 缓存文件落在目标仓套件目录下的 .generate-cache.json（本地构建产物，不随套件模板分发）。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SKIP_DIRS, CODE_EXT } = require('./scan');
const { makeDirSkip, DOT_OPS_ENTRIES } = require('./scan-ignore');
const { DIAGRAM_FILES } = require('./kit');

// 影响 inventory 的项目描述文件（语言/依赖/编排服务），纳入清单但不属于代码扩展名
const PROJECT_FILES = new Set([
  'package.json', 'requirements.txt', 'pyproject.toml', 'go.mod',
  'pom.xml', 'build.gradle', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml',
  'readme.md', 'readme', 'dockerfile'
]);
const CONFIG_FILES = [
  '.gitignore', '.arch-viewer-ignore', 'architecture.layers.json',
  '.av/layers.json', '.av/session.json', 'architecture_viewer/layers.json'
];
const CONTEXT_TEXT_EXT = /\.(?:md|ya?ml|toml|ini|cfg|conf|sh|ps1|bat|json|xml)$/i;
const GENERATOR_FILES = [
  'package.json', 'AGENT.md', 'lib/cache.js', 'lib/index.js', 'lib/generate.js',
  'lib/layers.js', 'lib/scan.js', 'lib/scan-ignore.js', 'lib/extract-graph.js',
  'lib/validate.js', 'lib/kit.js',
  'lib/extract/shared.js', 'lib/extract/python.js', 'lib/extract/jsts.js',
  'lib/extract/java.js', 'lib/extract/go.js', 'lib/extract/vue.js', 'lib/extract/svelte.js',
  'lib/llm-generate.js', 'lib/refine-polish.js', 'lib/refine-route.js',
  'lib/orch/run.js', 'lib/orch/lib.js', 'lib/orch/block-gen.js', 'lib/orch/agent-block.js'
];

function sha(s) {
  return crypto.createHash('sha256').update(String(s == null ? '' : s)).digest('hex');
}

function shortSha(s) {
  return sha(s).slice(0, 16);
}

function listDir(dir) {
  return fs.readdirSync(dir, { withFileTypes: true });
}

/**
 * Collect content hashes without parsing; preserved mtimes must not hide edits.
 */
function walkSourceFiles(root) {
  const abs = path.resolve(root);
  const out = [];
  out.treePaths = [];
  const stack = [abs];
  const skip = makeDirSkip(abs, SKIP_DIRS, { allowDotEntries: DOT_OPS_ENTRIES });
  let guard = 0;
  while (stack.length && guard < 200000) {
    guard += 1;
    const dir = stack.pop();
    for (const ent of listDir(dir)) {
      const p = path.join(dir, ent.name);
      if (ent.name.startsWith('.') && !DOT_OPS_ENTRIES.has(ent.name)) continue;
      if (DIAGRAM_FILES.includes(ent.name) || ent.name === 'architecture_visualized.html') continue;
      const rel = path.relative(abs, p).split(path.sep).join('/');
      if (ent.isDirectory()) {
        if (skip(ent.name, p)) continue;
        out.treePaths.push(rel + '/');
        stack.push(p);
        continue;
      }
      if (!ent.isFile()) continue;
      out.treePaths.push(rel);
      const isCode = CODE_EXT.test(ent.name);
      const isProject = PROJECT_FILES.has(ent.name.toLowerCase()) || /^requirements[-.]/.test(ent.name.toLowerCase());
      if (!isCode && !isProject && !CONTEXT_TEXT_EXT.test(ent.name)) continue;
      out.push({
        rel,
        contentHash: shortSha(fs.readFileSync(p))
      });
    }
  }
  if (stack.length) throw new Error('Generation source manifest exceeded directory limit');
  return out;
}

/** Source and configuration content identity. */
function sourceManifest(root) {
  const files = walkSourceFiles(root);
  for (const rel of CONFIG_FILES) {
    const file = path.join(root, rel);
    try {
      const content = fs.readFileSync(file);
      files.push({ rel, contentHash: shortSha(content) });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const hash = shortSha(files.map((f) => `${f.rel}:${f.contentHash}`).join('\n') +
    '\npaths:\n' + files.treePaths.sort().join('\n'));
  return { hash, fileCount: files.length };
}

let generatorCodeHash;
function generationKey(engine) {
  if (!generatorCodeHash) {
    const root = path.join(__dirname, '..');
    generatorCodeHash = shortSha(GENERATOR_FILES.map(file =>
      file + ':' + shortSha(fs.readFileSync(path.join(root, file)))).join('\n'));
  }
  return shortSha(JSON.stringify({
    code: generatorCodeHash, engine,
    model: engine === 'llm' ? (process.env.DEEPSEEK_MODEL || 'deepseek-chat') : null,
    endpoint: engine === 'llm' ? (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com') : null
  }));
}

function diagramsMatchCache(cache, kitDir, files = DIAGRAM_FILES) {
  if (!cache || !cache.diagrams) return false;
  return files.every(file => {
    try {
      return cache.diagrams[file] === shortSha(fs.readFileSync(path.join(kitDir, file)));
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  });
}

function cachePath(kitDir) {
  return path.join(kitDir, '.generate-cache.json');
}

function loadCache(kitDir) {
  try {
    const raw = fs.readFileSync(cachePath(kitDir), 'utf8');
    const data = JSON.parse(raw);
    if (data && data.version === 1) return data;
    return null;
  } catch {
    return null;
  }
}

function saveCache(kitDir, data) {
  try {
    fs.mkdirSync(kitDir, { recursive: true });
    fs.writeFileSync(cachePath(kitDir), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 6 张图内容 → { 文件名: 短哈希 } */
function diagramContentHashes(files) {
  const out = {};
  for (const [name, body] of Object.entries(files || {})) {
    out[name] = shortSha(body);
  }
  return out;
}

/**
 * 逐图比对：内容哈希与上次相同且磁盘文件仍在 ⇒ 复用（不重写、不重喂 LLM）。
 * 返回 { changed: [...], unchanged: [...] }，顺序按 DIAGRAM_FILES。
 */
function diffDiagrams(prevHashes, nextFiles, kitDir, diagramFiles) {
  const changed = [];
  const unchanged = [];
  for (const name of diagramFiles) {
    const body = nextFiles[name];
    let onDisk;
    try {
      onDisk = shortSha(fs.readFileSync(path.join(kitDir, name)));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (body != null && prevHashes && prevHashes[name] === shortSha(body) && onDisk === shortSha(body)) {
      unchanged.push(name);
    } else if (body != null) {
      changed.push(name);
    }
  }
  return { changed, unchanged };
}

/**
 * --refine 是否应跳过 / 只修部分图。
 * 骨架缓存（engine !== 'llm'，含旧缓存缺字段）一律不跳过：
 * 源码没变也要精修（舆情仓教训：第一次 --refine 被当成源码没变直接复用骨架）。
 */
function planRefineFromCache(cache, manifestHash, opts) {
  const only = (opts && opts.only) || null;
  const diagramsReady = !!(opts && opts.diagramsReady);
  if (only) return { skipped: false, only, considerIncremental: false };
  if (!cache || !diagramsReady) return { skipped: false, only: null, considerIncremental: false };
  if (cache.engine !== 'llm') {
    return { skipped: false, only: null, considerIncremental: false };
  }
  if (cache.generationKey !== (opts && opts.generationKey) || !cache.generationKey ||
      !cache.check || cache.check.protoOk !== true ||
      !DIAGRAM_FILES.every(file => (cache.refinedFiles || []).includes(file))) {
    return { skipped: false, only: null, considerIncremental: false };
  }
  if (cache.manifestHash === manifestHash) {
    return { skipped: true, only: null, considerIncremental: false };
  }
  return { skipped: false, only: null, considerIncremental: false };
}
function refinePayloadScale(allFiles, changedNames) {
  const sum = (names) => names.reduce((acc, n) => acc + (allFiles[n] ? Buffer.byteLength(allFiles[n], 'utf8') : 0), 0);
  const all = Object.keys(allFiles);
  const fullBytes = sum(all);
  const incrBytes = sum(changedNames || all);
  return {
    fullBytes,
    incrementalBytes: incrBytes,
    // 粗估 token：英文/代码约 4 字节/token
    fullTokens: Math.round(fullBytes / 4),
    incrementalTokens: Math.round(incrBytes / 4),
    reductionPct: fullBytes === 0 ? 0 : Math.round((1 - incrBytes / fullBytes) * 100)
  };
}

module.exports = {
  sha,
  shortSha,
  walkSourceFiles,
  sourceManifest,
  cachePath,
  loadCache,
  saveCache,
  diagramContentHashes,
  diffDiagrams,
  refinePayloadScale,
  planRefineFromCache,
  generationKey,
  diagramsMatchCache
};
