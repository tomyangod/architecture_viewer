'use strict';

/**
 * 增量生成缓存（W07-01）。
 *
 * 两层信号：
 *   1. sourceManifest(root) —— 仅 stat（size+mtime），不读内容、不解析，比 scan 快一个数量级。
 *      清单不变且上次已是精修（engine=llm）⇒ 跳过扫描与生成。
 *      骨架缓存（engine=skeleton 或缺字段）不能挡住 --refine。
 *   2. 每张图内容 sha256 —— 扫描后逐图比对，内容相同的图不重写（LLM 精修也只喂变动图，省 token）。
 *
 * 缓存文件落在目标仓套件目录下的 .generate-cache.json（本地构建产物，不随套件模板分发）。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SKIP_DIRS, CODE_EXT } = require('./scan');

// 影响 inventory 的项目描述文件（语言/依赖/编排服务），纳入清单但不属于代码扩展名
const PROJECT_FILES = new Set([
  'package.json', 'requirements.txt', 'pyproject.toml', 'go.mod',
  'pom.xml', 'build.gradle', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml'
]);

function sha(s) {
  return crypto.createHash('sha256').update(String(s == null ? '' : s)).digest('hex');
}

function shortSha(s) {
  return sha(s).slice(0, 16);
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * 递归收集代码文件 + 项目描述文件的 stat 记录（相对路径 + size + mtimeMs）。
 * 只 stat，不读文件内容。
 */
function walkSourceFiles(root) {
  const abs = path.resolve(root);
  const out = [];
  const stack = [abs];
  let guard = 0;
  while (stack.length && guard < 200000) {
    guard += 1;
    const dir = stack.pop();
    for (const ent of listDir(dir)) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
        stack.push(p);
        continue;
      }
      const isCode = CODE_EXT.test(ent.name) && !/test|spec/i.test(ent.name);
      const isProject = PROJECT_FILES.has(ent.name.toLowerCase()) || /^requirements[-.]/.test(ent.name.toLowerCase());
      if (!isCode && !isProject) continue;
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      out.push({
        rel: path.relative(abs, p).split(path.sep).join('/'),
        size: st.size,
        mtime: Math.round(st.mtimeMs)
      });
    }
  }
  return out;
}

/** 源码清单指纹：文件相对路径 + size + mtime 的稳定哈希。 */
function sourceManifest(root) {
  const files = walkSourceFiles(root);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const hash = shortSha(files.map((f) => `${f.rel}:${f.size}:${f.mtime}`).join('\n'));
  return { hash, fileCount: files.length };
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
    const onDisk = fs.existsSync(path.join(kitDir, name));
    if (body != null && prevHashes && prevHashes[name] === shortSha(body) && onDisk) {
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
  if (cache.manifestHash === manifestHash) {
    return { skipped: true, only: null, considerIncremental: false };
  }
  return { skipped: false, only: null, considerIncremental: true };
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
  planRefineFromCache
};
