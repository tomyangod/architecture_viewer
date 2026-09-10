'use strict';

/**
 * Contract configuration parser — extracts contract/rule definitions from
 * real config files (Import Linter INI/TOML, dependency-cruiser CJS/JSON)
 * so builtin analysis can evaluate them without running external CLIs.
 *
 * Import Linter fields kept for builtin evaluation (not just type tagging):
 *   forbidden: source_modules, forbidden_modules, allow_indirect_imports, as_packages
 *   layers:    layers, containers
 *   independence: modules
 *   common:    ignore_imports, id
 */

const fs = require('fs');
const path = require('path');

const LIST_KEYS = new Set([
  'source_modules',
  'forbidden_modules',
  'layers',
  'containers',
  'modules',
  'ignore_imports'
]);
const BOOL_KEYS = new Set(['allow_indirect_imports', 'as_packages']);
const SCALAR_KEYS = new Set(['name', 'type', 'id']);

/* ── Import Linter config ── */

function findImportLinterConfig(repo) {
  repo = path.resolve(repo || process.cwd());
  const iniPath = path.join(repo, '.importlinter');
  if (fs.existsSync(iniPath)) return iniPath;
  for (const [name, section] of [
    ['pyproject.toml', /^\s*\[tool\.importlinter\]\s*(?:#.*)?$/m],
    ['setup.cfg', /^\s*\[importlinter\]\s*$/m]
  ]) {
    const file = path.join(repo, name);
    if (fs.existsSync(file) && section.test(fs.readFileSync(file, 'utf8'))) return file;
  }
  return null;
}

function isAvContract(sectionId) {
  return /^av-no-/i.test(sectionId || '');
}

function parseBool(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'true' || v === 'yes' || v === '1') return true;
  if (v === 'false' || v === 'no' || v === '0') return false;
  return null;
}

function emptyContract(sectionId) {
  return {
    sectionId: sectionId || null,
    name: null,
    type: null,
    id: null,
    source_modules: [],
    forbidden_modules: [],
    layers: [],
    containers: [],
    modules: [],
    ignore_imports: [],
    allow_indirect_imports: null,
    as_packages: null
  };
}

function commitContract(map, current) {
  if (!current || !current.name) return;
  const sectionId = current.sectionId || current.id || null;
  map.set(current.name, {
    name: current.name,
    type: current.type || 'unknown',
    sectionId,
    avGenerated: isAvContract(sectionId),
    id: current.id || null,
    source_modules: [...(current.source_modules || [])],
    forbidden_modules: [...(current.forbidden_modules || [])],
    layers: [...(current.layers || [])],
    containers: [...(current.containers || [])],
    modules: [...(current.modules || [])],
    ignore_imports: [...(current.ignore_imports || [])],
    allow_indirect_imports: current.allow_indirect_imports,
    as_packages: current.as_packages
  });
}

function parseIniContracts(text, map) {
  let current = null;
  let listKey = null;
  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();
    const section = /^\[importlinter:contract:([^\]]+)\]\s*$/.exec(trimmed);
    if (section) {
      commitContract(map, current);
      current = emptyContract(section[1].trim());
      listKey = null;
      continue;
    }
    if (/^\[/.test(trimmed)) {
      commitContract(map, current);
      current = null;
      listKey = null;
      continue;
    }
    if (!current) continue;

    // Continuation line for a multi-line list (indented or bare module name).
    const kv = /^([\w-]+)\s*=\s*(.*)$/.exec(trimmed);
    if (!kv) {
      if (listKey && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith(';')) {
        current[listKey].push(trimmed);
      }
      continue;
    }

    const key = kv[1];
    const value = kv[2].trim();
    listKey = null;

    if (SCALAR_KEYS.has(key)) {
      current[key] = value;
      continue;
    }
    if (BOOL_KEYS.has(key)) {
      current[key] = parseBool(value);
      continue;
    }
    if (LIST_KEYS.has(key)) {
      current[key] = [];
      listKey = key;
      if (value) current[key].push(value);
      continue;
    }
  }
  commitContract(map, current);
}

function unquoteToml(raw) {
  const text = String(raw || '').replace(/\s+#.*$/, '').trim();
  const quoted = /^"(?:[^"\\]|\\.)*"|^'[^']*'/.exec(text);
  if (quoted) return quoted[0].slice(1, -1);
  return text;
}

function parseTomlArrayBody(body) {
  const items = [];
  const re = /"(?:[^"\\]|\\.)*"|'[^']*'/g;
  let match;
  while ((match = re.exec(body))) {
    items.push(match[0].slice(1, -1));
  }
  return items;
}

function parsePyprojectContracts(text, map) {
  let current = null;
  let arrayKey = null;
  let arrayBuf = '';
  const flush = () => {
    if (arrayKey && current) {
      current[arrayKey] = parseTomlArrayBody(arrayBuf);
      arrayKey = null;
      arrayBuf = '';
    }
    commitContract(map, current);
    current = null;
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (/^\[\[tool\.importlinter\.contracts\]\]\s*(?:#.*)?$/.test(line)) {
      flush();
      current = emptyContract(null);
      continue;
    }
    if (/^\[/.test(line)) {
      flush();
      continue;
    }
    if (!current) continue;

    if (arrayKey) {
      arrayBuf += ` ${line}`;
      if (line.includes(']')) {
        current[arrayKey] = parseTomlArrayBody(arrayBuf);
        arrayKey = null;
        arrayBuf = '';
      }
      continue;
    }

    const kv = /^([\w-]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const raw = kv[2].trim();

    if (LIST_KEYS.has(key) && raw.startsWith('[')) {
      if (raw.includes(']')) {
        current[key] = parseTomlArrayBody(raw);
      } else {
        arrayKey = key;
        arrayBuf = raw;
      }
      continue;
    }
    if (SCALAR_KEYS.has(key)) {
      const value = unquoteToml(raw);
      if (key === 'id') {
        current.id = value;
        if (!current.sectionId) current.sectionId = value;
      } else {
        current[key] = value;
      }
      continue;
    }
    if (BOOL_KEYS.has(key)) {
      current[key] = parseBool(unquoteToml(raw));
      continue;
    }
    if (LIST_KEYS.has(key)) {
      // Bare string assigned to a list key (unusual but tolerate).
      current[key] = [unquoteToml(raw)].filter(Boolean);
    }
  }
  flush();
}

/**
 * Parse contract definitions from an Import Linter config file.
 * Returns Map<contractName, {
 *   type, sectionId, avGenerated, id,
 *   source_modules, forbidden_modules, layers, containers, modules, ignore_imports,
 *   allow_indirect_imports, as_packages
 * }>.
 */
function parseContractConfig(configPath) {
  const map = new Map();
  if (!configPath) return map;
  let text;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch {
    return map;
  }
  if (configPath.endsWith('pyproject.toml')) parsePyprojectContracts(text, map);
  else parseIniContracts(text, map);
  return map;
}

/* ── dependency-cruiser config ── */

const DEPCRUISE_CONFIG_NAMES = [
  '.dependency-cruiser.js',
  '.dependency-cruiser.cjs',
  '.dependency-cruiser.mjs',
  '.dependency-cruiser.json',
  '.dependency-cruiser.config.js',
  '.dependency-cruiser.config.cjs',
  '.dependency-cruiser.config.mjs'
];

function findDepcruiseConfig(repo) {
  repo = path.resolve(repo || process.cwd());
  for (const name of DEPCRUISE_CONFIG_NAMES) {
    const p = path.join(repo, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Read a dependency-cruiser config file and extract the `forbidden` rules array.
 * Supports .json (JSON.parse), .cjs/.js (require), .mjs (regex fallback).
 * Returns { rules: [], configPath, error: null } or { rules: [], configPath, error }.
 */
function parseDepcruiseConfig(configPath) {
  if (!configPath) return { rules: [], configPath: null, error: 'no config path' };
  const ext = path.extname(configPath);
  try {
    if (ext === '.json') {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { rules: cfg.forbidden || [], configPath, error: null };
    }
    if (ext === '.cjs' || ext === '.js') {
      delete require.cache[require.resolve(configPath)];
      const cfg = require(configPath);
      const obj = cfg.default || cfg;
      return { rules: obj.forbidden || [], configPath, error: null };
    }
    if (ext === '.mjs') {
      const text = fs.readFileSync(configPath, 'utf8');
      const match = text.match(/forbidden\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
      if (!match) return { rules: [], configPath, error: 'could not extract forbidden array from mjs' };
      const parsed = new Function(`return ${match[1]}`)();
      return { rules: Array.isArray(parsed) ? parsed : [], configPath, error: null };
    }
    return { rules: [], configPath, error: `unsupported config extension: ${ext}` };
  } catch (err) {
    return { rules: [], configPath, error: err.message };
  }
}

module.exports = {
  findImportLinterConfig,
  parseContractConfig,
  parseIniContracts,
  parsePyprojectContracts,
  isAvContract,
  DEPCRUISE_CONFIG_NAMES,
  findDepcruiseConfig,
  parseDepcruiseConfig
};
