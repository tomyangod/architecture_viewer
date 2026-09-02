'use strict';

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build',
  'target', '.idea', '.settings', '.gradle', 'out', 'bin', 'architecture_viewer',
  '.av', 'coverage', '.next', '.nuxt', 'vendor', 'test-results', 'playwright-report',
  // Vendored / generated third-party assets
  'fixtures', '__tests__', 'mocks', 'mock', 'specs', 'e2e',
  'benchmark', 'benchmarks', 'generated'
]);

/**
 * Development-asset directories: part of the repo but not product runtime
 * architecture. Excluded by default to keep architecture diffs focused;
 * a future --include-dev flag can opt back in.
 */
const DEV_SKIP_DIRS = new Set([
  'test', 'tests', 'spec', 'eval', 'evals',
  'example', 'examples', 'docs', 'doc', 'documentation'
]);

/** Minified / bundled files carry no architecture signal. */
const SKIP_FILE_RE = /\.(min|bundle)\.[a-z]+$/i;

/**
 * Parse .gitignore at root and return a set of top-level directory names
 * that should be skipped during source file walking.
 * Only handles simple directory patterns (foo/ or foo) at the repo root level.
 */
function readGitignoreSkips(rootDir) {
  const skips = new Set();
  try {
    const giPath = path.join(rootDir, '.gitignore');
    if (!fs.existsSync(giPath)) return skips;
    const lines = fs.readFileSync(giPath, 'utf8').split('\n');
    for (let raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      // Skip negation patterns (!foo) — we only want to skip, not un-skip
      if (line.startsWith('!')) continue;
      // Strip leading slash (root-anchored) and trailing slash
      let pat = line.replace(/^\/+/, '').replace(/\/+$/, '');
      // Only take simple top-level names (no slashes, no wildcards)
      if (pat.includes('/') || pat.includes('*') || pat.includes('?')) continue;
      // Skip file-extension patterns like *.log
      if (pat.startsWith('.')) continue;
      // Skip common file patterns with dots (package.json, etc.)
      if (pat.includes('.')) continue;
      skips.add(pat);
    }
  } catch { /* ignore */ }
  return skips;
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

/**
 * Recursively collect source files, grouped by language.
 * Returns Map<lang, absolutePath[]>
 */
function walkSourceFiles(root, max) {
  const byLang = new Map();
  const extraSkips = readGitignoreSkips(root);
  const allSkips = new Set([...SKIP_DIRS, ...DEV_SKIP_DIRS, ...extraSkips]);
  const stack = [{ dir: root, isRoot: true }];
  let scanned = 0;
  const cap = max || 3000;
  while (stack.length) {
    const { dir, isRoot } = stack.pop();
    const base = path.basename(dir);
    // The seed root is always scanned; only nested dirs are subject to skip rules.
    if (!isRoot && allSkips.has(base)) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      scanned++;
      if (scanned > 80000) return byLang;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!allSkips.has(ent.name) && !ent.name.startsWith('.')) stack.push({ dir: p, isRoot: false });
        continue;
      }
      if (SKIP_FILE_RE.test(ent.name)) continue;
      const ext = path.extname(ent.name).toLowerCase();
      const lang = LANG_BY_EXT[ext];
      if (!lang) continue;
      // Skip declaration files and test files for architecture purposes? Keep tests but they rarely define arch entities.
      if (!byLang.has(lang)) byLang.set(lang, []);
      const list = byLang.get(lang);
      if (list.length < cap) list.push(p);
    }
  }
  return byLang;
}

/** Walk helper returning files of a single extension set (kept for backward compat). */
function walkFiles(root, exts, max) {
  const out = [];
  const extraSkips = readGitignoreSkips(root);
  const allSkips = new Set([...SKIP_DIRS, ...DEV_SKIP_DIRS, ...extraSkips]);
  const stack = [root];
  let scanned = 0;
  const extSet = new Set(exts);
  while (stack.length && out.length < (max || 2000)) {
    const dir = stack.pop();
    if (allSkips.has(path.basename(dir))) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      scanned++;
      if (scanned > 50000) return out;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!allSkips.has(ent.name) && !ent.name.startsWith('.')) stack.push(p);
        continue;
      }
      if (SKIP_FILE_RE.test(ent.name)) continue;
      if (extSet.has(path.extname(ent.name).toLowerCase())) out.push(p);
    }
  }
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
  SKIP_FILE_RE,
  readGitignoreSkips,
  LANG_BY_EXT,
  CODE_EXTS,
  readSafe,
  walkSourceFiles,
  walkFiles,
  findChildByType,
  collectNodes
};
