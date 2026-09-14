'use strict';

/**
 * Repo-level directory exclusion for graph extract, drift scan, and risk.
 *
 * Sources (merged):
 *   1. `.arch-viewer-ignore` at repo root (gitignore-style, comments + blank lines)
 *   2. `externalDirs` on `.av/layers.json`, `architecture.layers.json`,
 *      or `architecture_viewer/layers.json`
 *
 * Pattern rules:
 *   - no slash  → skip any directory with that basename (same as SKIP_DIRS)
 *   - has slash → skip that repo-relative path prefix only
 */

const fs = require('fs');
const path = require('path');

const IGNORE_FILE = '.arch-viewer-ignore';
const DOT_OPS_ENTRIES = new Set([
  '.github', '.circleci', '.gitea', '.gitlab', '.buildkite',
  '.gitlab-ci.yml', '.gitea-workflows', '.travis.yml', '.drone.yml'
]);
const LAYERS_CANDIDATES = [
  path.join('.av', 'layers.json'),
  'architecture.layers.json',
  path.join('architecture_viewer', 'layers.json')
];

function normalizePattern(raw) {
  let pat = String(raw || '').trim();
  if (!pat || pat.startsWith('#') || pat.startsWith('!')) return null;
  pat = pat.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!pat || pat === '.' || pat.includes('..')) return null;
  if (pat.includes('*') || pat.includes('?') || pat.includes('[')) return null;
  return pat;
}

function addPattern(into, raw) {
  const pat = normalizePattern(raw);
  if (!pat) return;
  if (pat.includes('/')) into.prefixes.add(pat);
  else into.basenames.add(pat);
}

function readIgnoreFile(repoRoot) {
  const file = path.join(repoRoot, IGNORE_FILE);
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return [];
    return fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    return [];
  }
}

function readExternalDirs(file) {
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return [];
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const dirs = j && (j.externalDirs || j.external_dirs);
    return Array.isArray(dirs) ? dirs : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} repoRoot
 * @returns {{ basenames: Set<string>, prefixes: Set<string> }}
 */
function loadRepoIgnore(repoRoot) {
  const abs = path.resolve(repoRoot || '.');
  const into = { basenames: new Set(), prefixes: new Set() };
  for (const line of readIgnoreFile(abs)) addPattern(into, line);
  for (const rel of LAYERS_CANDIDATES) {
    for (const d of readExternalDirs(path.join(abs, rel))) addPattern(into, d);
  }
  return into;
}

function toPosixRel(repoRoot, absPath) {
  const rel = path.relative(path.resolve(repoRoot), path.resolve(absPath));
  if (!rel || rel === '.') return '';
  if (rel.startsWith('..')) return null;
  return rel.split(path.sep).join('/');
}

/**
 * True when this directory should be excluded from extract / drift / risk.
 * The scan root itself is never skipped.
 */
function dirIsIgnored(repoRoot, absPath, ignore) {
  const rules = ignore || loadRepoIgnore(repoRoot);
  const posix = toPosixRel(repoRoot, absPath);
  if (posix == null) return false;
  if (posix === '') return false;
  const base = path.basename(absPath);
  if (rules.basenames.has(base)) return true;
  for (const prefix of rules.prefixes) {
    if (posix === prefix || posix.startsWith(prefix + '/')) return true;
  }
  return false;
}

/**
 * Read ordered literal directory rules, preserving root anchoring and negation.
 * Unsupported patterns conservatively allow extra scanning.
 * Inventory and graph extraction share these rules.
 * Does NOT feed scope stamping — gitignore is not AV scope config.
 */
function readGitignoreRules(repoRoot) {
  const rules = [];
  const gi = path.join(path.resolve(repoRoot || '.'), '.gitignore');
  if (!fs.existsSync(gi)) return rules;
  for (const raw of fs.readFileSync(gi, 'utf8').split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    if (negated) line = line.slice(1);
    const pattern = line.replace(/^\//, '').replace(/\/$/, '');
    if (!/^[\w.-]+(?:\/[\w.-]+)*$/.test(pattern)) {
      // Preserve unrelated exclusions when a negation has a known root prefix.
      if (negated) {
        const segments = pattern.split('/');
        const firstUnsupported = segments.findIndex(segment => !/^[\w.-]+$/.test(segment));
        const prefix = segments.slice(0, firstUnsupported).join('/');
        if (prefix) rules.push({ pattern: prefix, anchored: true, negated: true, descendants: true });
        else rules.length = 0;
      }
      continue;
    }
    rules.push({ pattern, anchored: line.startsWith('/') || pattern.includes('/'), negated });
  }
  return rules;
}

function isGitignoredDir(relativePath, rules) {
  const rel = relativePath.split(path.sep).join('/');
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  let ignored = false;
  for (const rule of rules) {
    if ((rule.anchored ? rel : name) === rule.pattern ||
        (rule.descendants && rel.startsWith(rule.pattern + '/'))) ignored = !rule.negated;
  }
  return ignored;
}

function readGitignoreDirNames(repoRoot) {
  const rules = readGitignoreRules(repoRoot);
  return new Set(rules.map(rule => rule.pattern)
    .filter(name => !name.includes('/') && isGitignoredDir(name, rules)));
}

function makeDirSkip(repoRoot, extraNames, options = {}) {
  const abs = path.resolve(repoRoot);
  const ignore = loadRepoIgnore(abs);
  const extras = extraNames instanceof Set ? extraNames : new Set(extraNames || []);
  const gitignored = readGitignoreRules(abs);
  const allowDotEntries = options.allowDotEntries || new Set();
  return function skipped(name, absPath) {
    if (extras.has(name) && !allowDotEntries.has(name)) return true;
    if (isGitignoredDir(absPath ? path.relative(abs, absPath) : name, gitignored)) return true;
    if (name && String(name).startsWith('.') && !allowDotEntries.has(name)) return true;
    if (!absPath) return ignore.basenames.has(name);
    return dirIsIgnored(abs, absPath, ignore);
  };
}

module.exports = {
  IGNORE_FILE,
  DOT_OPS_ENTRIES,
  loadRepoIgnore,
  dirIsIgnored,
  makeDirSkip,
  readGitignoreDirNames,
  readGitignoreRules,
  isGitignoredDir,
  normalizePattern
};
