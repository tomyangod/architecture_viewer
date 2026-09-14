'use strict';

/**
 * Independent test index (W20-01b).
 *
 * Not part of the architecture layer graph: excluded from fingerprint,
 * external-package stats, and HTML layer diagrams. Links test files to
 * production paths via import hints (high) and naming conventions (low).
 */

const fs = require('fs');
const path = require('path');
const { hashSourceContent, SOURCE_CONTENT_HASH_VERSION, compareSourceContentHashes } = require('../source-content');
const pythonExtractor = require('./python');
const { resolvePyModule } = require('../extract-graph');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build',
  'target', 'coverage', '.next', '.nuxt', 'vendor', '.av', 'architecture_viewer'
]);

const TEST_PATH_RE = /(^|\/)(tests?|specs?|__tests__)(\/|$)|(?:^|\/)test_[^/]+\.[a-z]+$|(?:^|\/|_)tests?\.[a-z]+$|\.(test|spec)\.[cm]?[jt]sx?$/i;
const CODE_EXT_RE = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts|py|go|java)$/i;

const IMPORT_RE = [
  /\b(?:import|export)\s+(?:[^'"\n]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
];

function isTestRel(rel) {
  return TEST_PATH_RE.test(String(rel || '').replace(/\\/g, '/'));
}

function walkTestFiles(rootDir, pythonModules) {
  const out = [];
  const stack = [rootDir];
  let scanned = 0;
  while (stack.length && out.length < 1200) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      scanned++;
      if (scanned > 50000) return out;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name) || (ent.name.startsWith('.') && ent.name !== '.')) continue;
        stack.push(abs);
        continue;
      }
      const rel = path.relative(rootDir, abs).replace(/\\/g, '/');
      if (pythonModules && ent.isFile() && /\.pyi?$/i.test(rel)) {
        pythonModules.set(pythonExtractor.filePathToModule(rel), rel);
      }
      if (isTestRel(rel) && CODE_EXT_RE.test(rel)) out.push(rel);
    }
  }
  return out.sort();
}

function contentHash(abs) {
  try {
    return hashSourceContent(fs.readFileSync(abs));
  } catch {
    return null;
  }
}

function resolveRelative(fromFile, spec, rootDir) {
  if (!spec || !(spec.startsWith('.') || spec.startsWith('/'))) return null;
  const dir = path.posix.dirname(fromFile);
  const base = path.posix.normalize(path.posix.join(dir, spec)).replace(/^\.\//, '');
  const candidates = [
    base,
    base + '.js', base + '.ts', base + '.tsx', base + '.jsx',
    base + '.mjs', base + '.cjs', base + '.py', base + '.go', base + '.java',
    base + '/index.js', base + '/index.ts', base + '/__init__.py'
  ];
  for (const c of candidates) {
    const abs = path.join(rootDir, c);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return c.replace(/\\/g, '/');
    }
  }
  return base.replace(/\.(js|ts|tsx|jsx|mjs|cjs|py)$/i, '') || null;
}

function pythonImportTargets(rel, rootDir, pythonModules) {
  const extracted = pythonExtractor.extractFile(path.join(rootDir, rel), rootDir);
  const links = [];
  for (const imp of extracted.imports || []) {
    if (imp.unresolved || imp.dynamic) continue;
    const names = imp.isModuleImport ? [null] : imp.names;
    for (const name of names || []) {
      const importedName = (imp.aliases && imp.aliases[name]) || name;
      const resolved = resolvePyModule(imp.specifier, extracted, pythonModules, importedName);
      if (resolved && !isTestRel(resolved.file)) {
        links.push({ target: resolved.file, confidence: 'high', via: 'import' });
      }
    }
  }
  return links;
}

function importTargets(rel, source, rootDir, pythonModules) {
  // Use the same syntax tree and module resolver as the architecture graph:
  // comments/strings are not imports, and imported names may be submodules.
  if (/\.py$/i.test(rel)) return pythonImportTargets(rel, rootDir, pythonModules);
  const links = [];
  const seen = new Set();
  for (const re of IMPORT_RE) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source))) {
      const spec = m[1];
      if (!spec || seen.has(spec)) continue;
      seen.add(spec);
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const target = resolveRelative(rel, spec, rootDir);
        if (target && !isTestRel(target)) {
          links.push({ target, confidence: 'high', via: 'import' });
        }
      }
    }
  }
  return links;
}

function namingTargets(rel, rootDir) {
  const links = [];
  const norm = rel.replace(/\\/g, '/');
  const base = path.posix.basename(norm);
  const dir = path.posix.dirname(norm);

  const candidates = [];
  // foo.test.js / foo.spec.ts → foo.js / foo.ts
  let m = base.match(/^(.+)\.(test|spec)\.([cm]?[jt]sx?)$/i);
  if (m) {
    candidates.push(path.posix.join(dir, `${m[1]}.${m[3]}`));
    candidates.push(path.posix.join(dir.replace(/\/__tests__$/, ''), `${m[1]}.${m[3]}`));
    candidates.push(path.posix.join(dir.replace(/\/(tests?|specs?)$/, ''), `${m[1]}.${m[3]}`));
  }
  // test_foo.py → foo.py
  m = base.match(/^test_(.+)\.(py)$/i);
  if (m) {
    candidates.push(path.posix.join(dir, `${m[1]}.${m[2]}`));
    candidates.push(path.posix.join(dir.replace(/\/tests?$/, ''), `${m[1]}.${m[2]}`));
  }
  // foo_test.go → foo.go
  m = base.match(/^(.+)_test\.(go)$/i);
  if (m) {
    candidates.push(path.posix.join(dir, `${m[1]}.${m[2]}`));
  }

  const seen = new Set();
  for (const c of candidates) {
    const target = c.replace(/\\/g, '/').replace(/^\.\//, '');
    if (seen.has(target) || isTestRel(target)) continue;
    seen.add(target);
    const abs = path.join(rootDir, target);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      links.push({ target, confidence: 'low', via: 'naming' });
    }
  }
  return links;
}

/**
 * Build an independent test index for a repo.
 * @returns {{ version: number, generatedAt: string, files: object[], edges: object[] }}
 */
function buildTestIndex(rootDir) {
  const files = [];
  const edges = [];
  const pythonModules = new Map();
  for (const rel of walkTestFiles(rootDir, pythonModules)) {
    const abs = path.join(rootDir, rel);
    let source = '';
    try { source = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const hash = contentHash(abs);
    const links = [];
    const seen = new Set();
    for (const link of [...importTargets(rel, source, rootDir, pythonModules), ...namingTargets(rel, rootDir)]) {
      if (!link.target || seen.has(link.target)) continue;
      seen.add(link.target);
      links.push(link);
      edges.push({
        from: rel,
        to: link.target,
        type: 'tests',
        confidence: link.confidence,
        via: link.via
      });
    }
    files.push({ path: rel, contentHash: hash, contentHashVersion: SOURCE_CONTENT_HASH_VERSION, linkCount: links.length, links });
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    files,
    edges,
    stats: { files: files.length, edges: edges.length }
  };
}

function testFileMap(index) {
  const map = new Map();
  for (const f of (index && index.files) || []) {
    if (f.path) map.set(f.path, f);
  }
  return map;
}

function changedTestFiles(baseIndex, headIndex) {
  if (!baseIndex || !headIndex) return new Set();
  const base = testFileMap(baseIndex);
  const head = testFileMap(headIndex);
  const changed = new Set();
  for (const [p, file] of head) {
    if (!base.has(p) || compareSourceContentHashes(base.get(p), file) === true) changed.add(p);
  }
  for (const p of base.keys()) {
    if (!head.has(p)) changed.add(p);
  }
  return changed;
}

/**
 * Production paths statically associated with tests changed this session.
 * Neither the import nor naming evidence establishes execution or coverage.
 */
function productionTargetsWithTestChanges(baseIndex, headIndex) {
  const changedTests = changedTestFiles(baseIndex, headIndex);
  const targets = new Map(); // prodPath → { confidence, testFiles: [] }
  const edges = (headIndex && headIndex.edges) || [];
  for (const e of edges) {
    if (!changedTests.has(e.from)) continue;
    const cur = targets.get(e.to) || { confidence: e.confidence, testFiles: [] };
    if (!cur.testFiles.includes(e.from)) cur.testFiles.push(e.from);
    // keep highest confidence
    const rank = { high: 3, medium: 2, low: 1 };
    if ((rank[e.confidence] || 0) > (rank[cur.confidence] || 0)) cur.confidence = e.confidence;
    targets.set(e.to, cur);
  }
  return { changedTests, targets };
}

function relatedTestsForPath(index, prodPath) {
  if (!index || !prodPath) return [];
  const norm = String(prodPath).replace(/\\/g, '/');
  const out = [];
  for (const e of index.edges || []) {
    if (e.to === norm || e.to.replace(/\.[^.]+$/, '') === norm.replace(/\.[^.]+$/, '')) {
      out.push(e);
    }
  }
  return out;
}

module.exports = {
  buildTestIndex,
  isTestRel,
  walkTestFiles,
  changedTestFiles,
  productionTargetsWithTestChanges,
  relatedTestsForPath,
  TEST_PATH_RE
};
