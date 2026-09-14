'use strict';

const fs = require('fs');
const path = require('path');
const { loadRepoIgnore, dirIsIgnored, readGitignoreRules, isGitignoredDir } = require('../scan-ignore');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build',
  'target', '.idea', '.settings', '.gradle', 'out', 'architecture_viewer',
  '.av', 'coverage', '.next', '.nuxt', 'vendor', 'test-results', 'playwright-report',
  // 注：'bin' 不跳过——Node 项目 bin/ 是 CLI 入口源码（.NET/Java 构建产物 bin/
  // 中只有 .dll/.class 等非源码文件，按扩展名过滤即可）。
  // Vendored / generated third-party assets
  'fixtures', '__tests__', 'mocks', 'mock', 'specs', 'e2e',
  'benchmark', 'benchmarks', 'generated',
  // Archify 参考副本 / 渲染层 vendor 快照（第三方代码，不参与本仓架构分析）
  'archify-main'
]);

/**
 * Development-asset directories: part of the repo but not product runtime
 * architecture. Excluded by default to keep architecture diffs focused;
 * a future --include-dev flag can opt back in.
 *
 * IMPORTANT: do NOT include singular `example` — Java packages commonly use
 * `com/example/...` and skipping that directory name at any depth silently
 * drops production code (empty scan / false green).
 */
const DEV_SKIP_DIRS = new Set([
  'test', 'tests', 'spec', 'eval', 'evals',
  'examples', 'docs', 'doc', 'documentation'
]);

/** Dev dirs that must only match top-level repo folders (not nested package segments). */
const TOP_LEVEL_ONLY_DEV_SKIPS = new Set(['examples', 'docs', 'doc', 'documentation', 'eval', 'evals']);

/** Minified / bundled files carry no architecture signal. */
const SKIP_FILE_RE = /\.(min|bundle)\.[a-z]+$/i;

/** Secret material — never feed into the architecture graph or MCP extract. */
const SECRET_FILE_RE = /^(\.env(\..+)?|.+\.(pem|p12|pfx|key)|id_rsa|id_dsa|id_ed25519|credentials\.json)$/i;

function loadScanAllow(root) {
  const fromEnv = process.env.AV_SCAN_ALLOW;
  if (fromEnv && String(fromEnv).trim()) {
    return new Set(String(fromEnv).split(',').map((s) => s.trim()).filter(Boolean));
  }
  try {
    const cfg = path.join(root, '.av', 'session.json');
    if (!fs.existsSync(cfg)) return null;
    const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    if (Array.isArray(j.scanAllow) && j.scanAllow.length) {
      return new Set(j.scanAllow.map(String));
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Read literal directory rules from the root .gitignore, preserving anchoring
 * and order, shared with the inventory/drift scanner.
 */
function readGitignoreSkips(rootDir) {
  return readGitignoreRules(rootDir);
}

const LANG_BY_EXT = {
  '.java': 'java',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.py': 'python', '.pyi': 'python',
  '.go': 'go'
};

const CODE_EXTS = new Set(Object.keys(LANG_BY_EXT));

function readSafe(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > 512000) return null;
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function shouldSkipDir(name, isRootParent) {
  if (!name || name.startsWith('.')) return true;
  if (SKIP_DIRS.has(name)) return true;
  if (TOP_LEVEL_ONLY_DEV_SKIPS.has(name)) return !!isRootParent;
  if (DEV_SKIP_DIRS.has(name)) return true;
  return false;
}

/**
 * Recursively collect source files, grouped by language.
 * Returns Map<lang, absolutePath[]> with optional `.meta` describing caps / skips.
 */
function walkSourceFiles(root, max) {
  const byLang = new Map();
  const extraSkips = readGitignoreSkips(root);
  const repoIgnore = loadRepoIgnore(root);
  const allow = loadScanAllow(root);
  const stack = [{ dir: root, isRoot: true }];
  let scanned = 0;
  let kept = 0;
  let truncated = false;
  const skippedDevDirs = new Set();
  const unreadableDirs = [];
  const cap = max || 3000;
  const recordUnreadable = (dirPath, isRootDir) => {
    const rel = isRootDir ? '.' : (path.relative(root, dirPath).replace(/\\/g, '/') || path.basename(dirPath));
    if (!unreadableDirs.includes(rel)) unreadableDirs.push(rel);
  };
  while (stack.length) {
    const { dir, isRoot } = stack.pop();
    const base = path.basename(dir);
    // The seed root is always scanned; only nested dirs are subject to skip rules.
    if (!isRoot) {
      if (dirIsIgnored(root, dir, repoIgnore)) continue;
      if (isGitignoredDir(path.relative(root, dir), extraSkips) || shouldSkipDir(base, false)) continue;
    }
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch {
      recordUnreadable(dir, isRoot);
      continue;
    }
    for (const ent of entries) {
      scanned++;
      if (scanned > 80000) {
        truncated = true;
        byLang.meta = { truncated, kept, cap, skippedDevDirs: [...skippedDevDirs], unreadableDirs };
        return byLang;
      }
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (dirIsIgnored(root, p, repoIgnore)) continue;
        if (ent.name.startsWith('.')) continue;
        if (isGitignoredDir(path.relative(root, p), extraSkips)) continue;
        if (shouldSkipDir(ent.name, isRoot)) {
          if (DEV_SKIP_DIRS.has(ent.name) || TOP_LEVEL_ONLY_DEV_SKIPS.has(ent.name)) {
            skippedDevDirs.add(ent.name);
          }
          continue;
        }
        if (isRoot && allow && !allow.has(ent.name)) continue;
        stack.push({ dir: p, isRoot: false });
        continue;
      }
      if (SKIP_FILE_RE.test(ent.name) || SECRET_FILE_RE.test(ent.name)) continue;
      const ext = path.extname(ent.name).toLowerCase();
      const lang = LANG_BY_EXT[ext];
      if (!lang) continue;
      if (!byLang.has(lang)) byLang.set(lang, []);
      const list = byLang.get(lang);
      if (list.length < cap) {
        list.push(p);
        kept++;
      } else {
        truncated = true;
      }
    }
  }
  byLang.meta = { truncated, kept, cap, skippedDevDirs: [...skippedDevDirs], unreadableDirs };
  return byLang;
}

/** Walk helper returning files of a single extension set (kept for backward compat). */
function walkFiles(root, exts, max) {
  const out = [];
  out.meta = { unreadableDirs: [], truncated: false };
  const extraSkips = readGitignoreSkips(root);
  const repoIgnore = loadRepoIgnore(root);
  const stack = [{ dir: root, isRoot: true }];
  let scanned = 0;
  const extSet = new Set(exts);
  while (stack.length && out.length < (max || 2000)) {
    const { dir, isRoot } = stack.pop();
    if (!isRoot) {
      if (dirIsIgnored(root, dir, repoIgnore)) continue;
      const base = path.basename(dir);
      if (isGitignoredDir(path.relative(root, dir), extraSkips) || shouldSkipDir(base, false)) continue;
    }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if (!['EACCES', 'EPERM', 'ENOENT'].includes(error.code)) throw error;
      out.meta.unreadableDirs.push(path.relative(root, dir).split(path.sep).join('/') || '.');
      continue;
    }
    for (const ent of entries) {
      scanned++;
      if (scanned > 50000) {
        out.meta.truncated = true;
        return out;
      }
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (dirIsIgnored(root, p, repoIgnore)) continue;
        if (ent.name.startsWith('.') || isGitignoredDir(path.relative(root, p), extraSkips)) continue;
        if (shouldSkipDir(ent.name, isRoot)) continue;
        stack.push({ dir: p, isRoot: false });
        continue;
      }
      if (SKIP_FILE_RE.test(ent.name) || SECRET_FILE_RE.test(ent.name)) continue;
      if (extSet.has(path.extname(ent.name).toLowerCase())) {
        if (out.length >= (max || 2000)) {
          out.meta.truncated = true;
          return out;
        }
        out.push(p);
      }
    }
  }
  if (stack.length) out.meta.truncated = true;
  return out;
}

/** Find first child node whose type is in the list. */
function findChildByType(node, types) {
  const arr = Array.isArray(types) ? types : [types];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (arr.includes(c.type)) return c;
  }
  return null;
}

/** Recursively collect all descendant nodes matching any of the given types. */
function collectNodes(node, types, out) {
  const arr = Array.isArray(types) ? types : [types];
  const result = out || [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (arr.includes(c.type)) result.push(c);
    collectNodes(c, types, result);
  }
  return result;
}

module.exports = {
  SKIP_DIRS,
  DEV_SKIP_DIRS,
  TOP_LEVEL_ONLY_DEV_SKIPS,
  SKIP_FILE_RE,
  SECRET_FILE_RE,
  loadScanAllow,
  readGitignoreSkips,
  LANG_BY_EXT,
  CODE_EXTS,
  readSafe,
  shouldSkipDir,
  walkSourceFiles,
  walkFiles,
  findChildByType,
  collectNodes
};
