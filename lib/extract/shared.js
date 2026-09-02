'use strict';

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build',
  'target', '.idea', '.settings', '.gradle', 'out', 'bin', 'architecture_viewer',
  '.av', 'coverage', '.next', '.nuxt', 'vendor', 'test-results', 'playwright-report'
]);

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
  const stack = [{ dir: root, isRoot: true }];
  let scanned = 0;
  const cap = max || 3000;
  while (stack.length) {
    const { dir, isRoot } = stack.pop();
    const base = path.basename(dir);
    // The seed root is always scanned; only nested dirs are subject to skip rules.
    if (!isRoot && SKIP_DIRS.has(base)) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      scanned++;
      if (scanned > 80000) return byLang;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name) && !ent.name.startsWith('.')) stack.push({ dir: p, isRoot: false });
        continue;
      }
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
  const stack = [root];
  let scanned = 0;
  const extSet = new Set(exts);
  while (stack.length && out.length < (max || 2000)) {
    const dir = stack.pop();
    if (SKIP_DIRS.has(path.basename(dir))) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      scanned++;
      if (scanned > 50000) return out;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name) && !ent.name.startsWith('.')) stack.push(p);
        continue;
      }
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
  LANG_BY_EXT,
  CODE_EXTS,
  readSafe,
  walkSourceFiles,
  walkFiles,
  findChildByType,
  collectNodes
};
