'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SOURCE_CONTENT_HASH_VERSION, hashSourceContent } = require('./source-content');
const { walkSourceFiles, walkFiles, CODE_EXTS, LANG_BY_EXT } = require('./extract/shared');
const javaExtractor = require('./extract/java');
const jstsExtractor = require('./extract/jsts');
const vueExtractor = require('./extract/vue');
const svelteExtractor = require('./extract/svelte');
const pyExtractor = require('./extract/python');
const goExtractor = require('./extract/go');
const { methodImplsFromMembers } = require('./impl-surface');
const { attachCallEdges, toPersistableGraph } = require('./extract/call-graph');
const { signatureFromEntity } = require('./extract/signature');
const { loadRepoIgnore } = require('./scan-ignore');
const {
  resolveLayer,
  inferLayerByStructure,
  matchUserLayer,
  aggregateDirectorySignals,
  loadLayerDefinitions
} = require('./layer-infer');

const EXTRACTORS = {
  java: javaExtractor,
  javascript: jstsExtractor,
  typescript: jstsExtractor,
  vue: vueExtractor,
  svelte: svelteExtractor,
  python: pyExtractor,
  go: goExtractor
};

const JS_FAMILY_LANGS = new Set(['javascript', 'typescript', 'vue', 'svelte']);

const JS_TS_EXTS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];

/** Unified dependency kind on import edges (M3). */
function importEdgeAttrs(imp = {}) {
  const attrs = {};
  if (imp.scope) attrs.scope = imp.scope;
  if (imp.conditional) attrs.conditional = true;
  if (imp.dynamic) attrs.dynamic = true;
  if (imp.isType) attrs.isType = true;
  if (imp.isCjs) attrs.isCjs = true;
  attrs.dependencyType = imp.dynamic
    ? 'dynamic-import'
    : imp.isCjs
      ? 'require'
      : imp.isType
        ? 'type-import'
        : 'import';
  return attrs;
}

/* ------------------------------- Java helpers ------------------------------ */

function isJdkImport(fqn) {
  return javaExtractor.isJdkImport(fqn);
}

function resolveJavaType(shortName, pkg, imports, localFqns) {
  if (localFqns.has(shortName)) return shortName;
  for (const imp of imports) {
    if (typeof imp.specifier !== 'string' || !imp.specifier) continue;
    if (imp.isWildcard) {
      const candidate = imp.specifier.replace(/\.\*$/, '') + '.' + shortName;
      if (localFqns.has(candidate)) return candidate;
    } else {
      const imported = imp.specifier;
      const simple = imported.split('.').pop();
      if (simple === shortName) return imported;
    }
  }
  if (pkg) {
    const candidate = pkg + '.' + shortName;
    if (localFqns.has(candidate)) return candidate;
  }
  return null;
}

/* ----------------------------- JS/TS resolution ---------------------------- */

function isRelativeSpecifier(spec) {
  return typeof spec === 'string' && (spec.startsWith('.') || spec.startsWith('/'));
}

function isBuiltinModule(spec) {
  if (typeof spec !== 'string') return false;
  const base = spec.startsWith('node:') ? spec.slice(5) : spec;
  return jstsExtractor.NODE_BUILTINS.has(base) || jstsExtractor.NODE_BUILTINS.has(spec);
}

/** External package name from a bare specifier (handle scoped packages). */
function packageName(spec) {
  if (typeof spec !== 'string' || !spec) return 'unknown';
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.slice(0, 2).join('/'); // @scope/name
  }
  return spec.split('/')[0];
}

/**
 * Resolve a relative JS/TS import specifier to a module entry.
 * Returns { module, file } where `module` is the rel path w/o ext (for entity ids)
 * and `file` is the actual rel path w/ ext (for file node edges). Null if not found.
 */
function resolveJsModule(specifier, fromRelPath, moduleToFile) {
  const dir = path.posix.dirname(fromRelPath);
  const base = path.posix.normalize(path.posix.join(dir, specifier));
  // Strip known extensions from the specifier (e.g. './Card.vue' -> './Card')
  const stripped = base.replace(/\.(js|jsx|mjs|cjs|ts|tsx|mts|cts|vue|svelte)$/i, '');
  const candidates = [base, stripped, stripped + '/index', base + '/index'];
  for (const c of candidates) {
    if (moduleToFile.has(c)) {
      return { module: c, file: moduleToFile.get(c) };
    }
  }
  return null;
}

/* ----------------------------- Python resolution --------------------------- */

const PY_STDLIB_MODULES = new Set([
  'os', 'sys', 're', 'json', 'logging', 'typing', 'pathlib', 'datetime', 'time',
  'collections', 'itertools', 'functools', 'abc', 'dataclasses', 'enum', 'io',
  'asyncio', 'concurrent', 'threading', 'multiprocessing', 'subprocess', 'shutil',
  'tempfile', 'glob', 'pickle', 'copy', 'math', 'random', 'string', 'textwrap',
  'unittest', 'pytest', 'argparse', 'configparser', 'csv', 'sqlite3', 'hashlib',
  'hmac', 'base64', 'uuid', 'socket', 'http', 'urllib', 'email', 'xml', 'html',
  'warnings', 'traceback', 'inspect', 'importlib', 'pkgutil', 'contextlib',
  'dataclasses', 'types', 'secrets', 'signal', 'struct', 'codecs', 'locale',
  'platform', 'getpass', 'optparse', 'pprint', 'queue', 'sched', 'selectors',
  'ssl', 'stat', 'tarfile', 'zipfile', 'gzip', 'bz2', 'lzma', 'weakref',
  'array', 'bisect', 'heapq', 'decimal', 'fractions', 'statistics', 'cmath'
]);

function isPyStdlib(modulePath) {
  const top = modulePath.split('.')[0];
  return PY_STDLIB_MODULES.has(top);
}

function isMissingLocalPyModule(specifier, pyModuleToFile) {
  if (specifier.startsWith('.')) return true;
  const top = specifier.split('.')[0];
  return [...pyModuleToFile.keys()].some((mod) => mod === top || mod.startsWith(top + '/'));
}

/**
 * Resolve a Python import to a module path in the repo.
 * from domain.order import Order -> module "domain/order"
 * from .storage import Repository -> resolve relative
 * from services import order_service -> prefer "services/order_service" over package __init__
 *
 * @param {string} [importedName] optional name from `from X import name`;
 *   when it is a submodule file, resolve to that file instead of the package.
 */
function resolvePyModule(specifier, fe, pyModuleToFile, importedName) {
  // Dynamic / unresolved imports may carry specifier: null — never throw.
  if (specifier == null || typeof specifier !== 'string') return null;
  let modulePath;
  if (specifier.startsWith('.')) {
    // Relative import: count leading dots
    const match = specifier.match(/^(\.+)(.*)/);
    const level = match ? match[1].length : 1;
    const rest = match ? match[2] : '';
    // Current package: fe.package (dotted) or fe.module's directory
    let baseParts = fe.package ? fe.package.split('.') : fe.module.split('/').slice(0, -1);
    // For level=1, we stay in current package; level=2 goes up one, etc.
    const up = level - 1;
    if (up > 0) baseParts = baseParts.slice(0, Math.max(0, baseParts.length - up));
    const restParts = rest ? rest.split('.') : [];
    const allParts = [...baseParts, ...restParts];
    modulePath = allParts.filter(Boolean).join('/');
  } else {
    modulePath = specifier.replace(/\./g, '/');
  }

  // from pkg import mod — prefer submodule file when it exists
  if (importedName && /^[A-Za-z_][A-Za-z0-9_]*$/.test(importedName)) {
    const sub = modulePath ? modulePath + '/' + importedName : importedName;
    if (pyModuleToFile.has(sub)) {
      return { module: sub, file: pyModuleToFile.get(sub), kind: 'submodule' };
    }
  }

  // Try direct module match, then __init__ (package)
  const candidates = modulePath
    ? [modulePath, modulePath + '/__init__']
    : [];
  for (const c of candidates) {
    if (pyModuleToFile.has(c)) {
      return { module: c, file: pyModuleToFile.get(c), kind: 'module' };
    }
  }
  return null;
}

/** Local import name → exported symbol (Order as Ord → Order). */
function exportedNameFromImport(imp, localName) {
  if (!imp || !localName) return localName;
  if (imp.aliases && imp.aliases[localName]) return imp.aliases[localName];
  const binding = (imp.bindings || []).find((b) => b.local === localName);
  if (binding && binding.imported && binding.imported !== '*' && binding.imported !== 'default') {
    return binding.imported;
  }
  return localName;
}

/** Resolve only proven bindings; conditional/scoped imports remain dependency evidence. */
function resolvePyType(name, fe, pyModuleToFile, pyFeByFile, line, seen = new Set(), signature = false) {
  if (!fe || !/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(name)) return null;
  const key = fe.file + '#' + name;
  if (seen.has(key)) return null;
  seen.add(key);
  const rootName = name.split('.')[0];
  const imports = (fe.imports || []).filter((imp) => {
    if (imp.dynamic || typeof imp.specifier !== 'string') return false;
    const matches = imp.isModuleImport
      ? name.startsWith((imp.alias || imp.specifier) + '.')
      : (imp.names || []).includes(rootName);
    if (!matches) return false;
    if (signature && imp.scope === 'function' && line === imp.scopeStart) return false;
    return !imp.scope || imp.scope === 'module' ||
      (line != null && line >= imp.scopeStart && line <= imp.scopeEnd);
  });
  // Do not promote a function/class import into a global binding, or guess a
  // branch winner when multiple imports bind the same name.
  if (imports.some((imp) => imp.conditional || (imp.scope && imp.scope !== 'module'))) return null;
  const sameFile = fe.entities.find((en) => en.name === name && en.kind !== 'route');
  if (sameFile && imports.length === 0) return { id: sameFile.id, file: fe.file };
  if (sameFile || imports.length !== 1) return null;
  const imp = imports[0];
  let member;
  let imported;
  if (imp.isModuleImport) {
    const prefix = imp.alias || imp.specifier;
    if (!name.startsWith(prefix + '.')) return null;
    member = name.slice(prefix.length + 1);
  } else {
    imported = exportedNameFromImport(imp, rootName);
    member = imported + name.slice(rootName.length);
  }

  const target = resolvePyModule(imp.specifier, fe, pyModuleToFile);
  if (target) {
    const resolved = resolvePyType(member, pyFeByFile.get(target.file), pyModuleToFile, pyFeByFile, undefined, seen);
    if (resolved) return resolved;
  }
  if (imported && name.includes('.')) {
    const sub = resolvePyModule(imp.specifier, fe, pyModuleToFile, imported);
    if (sub && sub.kind === 'submodule') {
      return resolvePyType(name.slice(rootName.length + 1), pyFeByFile.get(sub.file),
        pyModuleToFile, pyFeByFile, undefined, seen);
    }
  }
  if (target || isMissingLocalPyModule(imp.specifier, pyModuleToFile)) return null;
  const top = imp.specifier.split('.')[0];
  return { external: top, builtin: isPyStdlib(imp.specifier), name: imp.specifier + '.' + member };
}

function moduleKeyFromFile(file) {
  if (/\.pyi?$/i.test(file)) return pyExtractor.filePathToModule(file);
  return file.replace(/\.(js|jsx|mjs|cjs|ts|tsx|mts|cts|vue|svelte)$/i, '');
}

function isBarrelFile(file) {
  return /(^|\/)(__init__\.pyi?|index\.[cm]?[jt]sx?)$/i.test(file);
}

/** Follow barrel → barrel until a non-barrel file (or cycle cap). */
function flattenReexportMap(map) {
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 24) {
    changed = false;
    for (const [key, file] of [...map.entries()]) {
      if (!file || !isBarrelFile(file)) continue;
      const name = key.slice(key.lastIndexOf('#') + 1);
      const next = map.get(moduleKeyFromFile(file) + '#' + name);
      if (next && next !== file) {
        map.set(key, next);
        changed = true;
      }
    }
  }
  return map;
}

function entityNamesFromFile(fe) {
  if (!fe) return [];
  if (fe.__all__ && fe.__all__.length) return fe.__all__.slice();
  return (fe.entities || []).filter((e) => e.exported !== false).map((e) => e.name);
}

/**
 * Map `pkg#ExportedName` → submodule file for `__init__.py` re-exports
 * (including chains and literal `__all__`).
 */
function buildPyReexportMap(allFiles, pyModuleToFile) {
  const map = new Map();
  const feByFile = new Map(allFiles.filter((f) => f.lang === 'python').map((f) => [f.file, f]));
  for (const fe of allFiles) {
    if (fe.lang !== 'python') continue;
    if (!/(^|\/)__init__\.pyi?$/.test(fe.file)) continue;
    const pkg = fe.module;
    for (const imp of fe.imports || []) {
      const spec = imp.specifier || '';
      if (imp.dynamic || imp.conditional || (imp.scope && imp.scope !== 'module')) continue;
      const target = resolvePyModule(spec, fe, pyModuleToFile);
      const names = (imp.names || []).includes('*')
        ? entityNamesFromFile(target && feByFile.get(target.file))
        : (imp.names || []);
      for (const name of names) {
        if (name === '*') continue;
        const resolved = resolvePyType(name, (imp.names || []).includes('*')
          ? target && feByFile.get(target.file) : fe, pyModuleToFile, feByFile);
        if (resolved && resolved.id) map.set(pkg + '#' + name, resolved.file);
      }
    }
    for (const name of fe.__all__ || []) {
      const key = pkg + '#' + name;
      if (map.has(key)) continue;
      const asSub = resolvePyModule('.', fe, pyModuleToFile, name);
      if (asSub && asSub.kind === 'submodule') map.set(key, asSub.file);
    }
  }
  return map;
}

/**
 * JS/TS barrel (`index.js`) `export { X } from './x'` / `export * from './x'`.
 */
function buildJsReexportMap(allFiles, jsModuleToFile) {
  const map = new Map();
  const feByFile = new Map(allFiles.map((f) => [f.file, f]));
  for (const fe of allFiles) {
    if (fe.lang !== 'javascript' && fe.lang !== 'typescript') continue;
    if (!/(^|\/)index\.[cm]?[jt]sx?$/.test(fe.file)) continue;
    for (const imp of fe.imports || []) {
      if (!imp.isReExport || !isRelativeSpecifier(imp.specifier || '')) continue;
      const resolved = resolveJsModule(imp.specifier, fe.file, jsModuleToFile);
      if (!resolved) continue;
      const names = (imp.names && imp.names.length)
        ? imp.names
        : entityNamesFromFile(feByFile.get(resolved.file));
      for (const name of names) {
        if (!name || name === '*') continue;
        map.set(fe.module + '#' + name, resolved.file);
      }
    }
  }
  return flattenReexportMap(map);
}

/* ------------------------------- Go resolution ----------------------------- */

/** Read Go module name from go.mod. */
function readGoModuleName(rootDir) {
  try {
    const goModPath = path.join(rootDir, 'go.mod');
    if (fs.existsSync(goModPath)) {
      const content = fs.readFileSync(goModPath, 'utf8');
      const m = content.match(/^module\s+(\S+)/m);
      if (m) return m[1];
    }
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * Resolve a Go import path to a local package directory.
 * "github.com/user/project/domain/order" with module "github.com/user/project"
 * -> directory "domain/order"
 */
function resolveGoPackage(importPath, goModuleName, goPkgToDir) {
  if (typeof importPath !== 'string' || !importPath) return null;
  // Strip module prefix
  let relDir = null;
  if (goModuleName && importPath.startsWith(goModuleName + '/')) {
    relDir = importPath.slice(goModuleName.length + 1);
  } else if (goModuleName && importPath === goModuleName) {
    relDir = '';
  }
  if (relDir !== null) {
    if (goPkgToDir.has(relDir)) return { dir: relDir, file: goPkgToDir.get(relDir) };
    // Try matching as a file in that directory
    if (goPkgToDir.has(relDir + '/')) return { dir: relDir, file: goPkgToDir.get(relDir + '/') };
  }
  // Fallback: match by package name (last component of import path)
  const pkgName = importPath.split('/').pop();
  const dirCandidates = goPkgToDir.get('__pkg__' + pkgName);
  if (dirCandidates && dirCandidates.length === 1) {
    return { dir: dirCandidates[0], file: goPkgToDir.get(dirCandidates[0]) };
  }
  return null;
}

/**
 * Resolve a Go type reference to a local entity id.
 * Type ref can be:
 *   { pkg: 'order', name: 'Order' } (qualified: order.Order)
 *   { pkg: null, name: 'OrderService' } (local: same package)
 */
function resolveGoType(typeRef, fe, goNameToIds, goPkgToDir, goModuleName) {
  const { pkg, name } = typeRef;
  if (!pkg) {
    // Local type: same package/directory
    const samePkg = fe.entities.find((en) => en.name === name);
    if (samePkg) return samePkg.id;
    // Try same directory (other files in same package)
    const candidates = goNameToIds.get(name);
    if (candidates) {
      // Filter to same module (directory)
      const sameDir = candidates.filter((id) => id.startsWith(fe.module + '#'));
      if (sameDir.length >= 1) return sameDir[0];
      if (candidates.length === 1) return candidates[0];
    }
    return null;
  }

  // Qualified type: pkg.Name — find the import that provides this package
  for (const imp of fe.imports) {
    if (imp.packageName === pkg || imp.alias === pkg) {
      const resolved = resolveGoPackage(imp.specifier, goModuleName, goPkgToDir);
      if (resolved) {
        return resolved.dir + '#' + name;
      }
    }
  }
  return null;
}

/* -------------------------------- Graph build ------------------------------ */

function buildGraph(rootDir, opts) {
  opts = opts || {};
  const filesByLang = walkSourceFiles(rootDir);
  const scanMeta = filesByLang.meta || { truncated: false, kept: 0, cap: 3000, skippedDevDirs: [], unreadableDirs: [] };

  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const externalPackages = new Set();

  // Read project-level layer overrides (.av/layers.json) via the shared loader.
  // Handles both string ({ "dir": "storage" }) and object ({ "dir": { layer: "storage" } })
  // formats, normalizes paths, and reports malformed config instead of silently ignoring it.
  const { layers: userLayers, error: layerConfigError } = loadLayerDefinitions(rootDir);

  // Per-language extraction results.
  const allFiles = [];          // normalized FileExtract[]
  let filesParsed = 0;
  let parseErrors = 0;

  for (const [lang, files] of filesByLang) {
    if (lang === 'meta') continue;
    const extractor = EXTRACTORS[lang];
    if (!extractor) continue;
    for (const f of files) {
      const fe = extractor.extractFile(f, rootDir);
      allFiles.push(fe);
      if (fe.error) parseErrors++;
      else filesParsed++;
    }
  }

  /* ---- Index for resolution ---- */
  // Java: map of FQN -> entity id
  const javaFqns = new Set();
  // JS/TS: map of module path (rel path w/o ext) -> actual file rel path (w/ ext)
  const jsModuleToFile = new Map();
  // JS/TS: map of entity simple-name -> entity id (for same-repo resolution)
  const jsNameToIds = new Map();
  // Python: module path -> file path
  const pyModuleToFile = new Map();
  // Python: entity simple name -> entity ids
  const pyNameToIds = new Map();
  // Go: directory -> first file in dir, and package name -> directories
  const goPkgToDir = new Map();
  // Go: entity simple name -> entity ids
  const goNameToIds = new Map();

  // Read Go module name from go.mod
  const goModuleName = readGoModuleName(rootDir);

  for (const fe of allFiles) {
    if (fe.lang === 'java') {
      for (const e of fe.entities) javaFqns.add(e.id);
    } else if (fe.lang === 'python') {
      pyModuleToFile.set(fe.module, fe.file);
      for (const e of fe.entities) {
        if (e.kind === 'route') continue;
        if (!pyNameToIds.has(e.name)) pyNameToIds.set(e.name, []);
        pyNameToIds.get(e.name).push(e.id);
      }
    } else if (fe.lang === 'go') {
      // Map directory to a representative file
      if (!goPkgToDir.has(fe.module)) goPkgToDir.set(fe.module, fe.file);
      // Map package name to directory (for fallback resolution)
      if (fe.package) {
        const pkgKey = '__pkg__' + fe.package;
        if (!goPkgToDir.has(pkgKey)) goPkgToDir.set(pkgKey, []);
        const dirs = goPkgToDir.get(pkgKey);
        if (!dirs.includes(fe.module)) dirs.push(fe.module);
      }
      for (const e of fe.entities) {
        if (!goNameToIds.has(e.name)) goNameToIds.set(e.name, []);
        goNameToIds.get(e.name).push(e.id);
      }
    } else {
      jsModuleToFile.set(fe.module, fe.file);
      for (const e of fe.entities) {
        if (e.kind === 'route') continue;
        if (!jsNameToIds.has(e.name)) jsNameToIds.set(e.name, []);
        jsNameToIds.get(e.name).push(e.id);
      }
    }
  }

  const pyReexport = buildPyReexportMap(allFiles, pyModuleToFile);
  const jsReexport = buildJsReexportMap(allFiles, jsModuleToFile);
  const pyFeByFile = new Map(allFiles.filter((f) => f.lang === 'python').map((f) => [f.file, f]));
  const contentHashes = [];

  function addNode(node) {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  }

  function addEdge(edge) {
    edges.push(edge);
  }

  function addUnresolvedDynamic(fromId, srcFe, imp) {
    const id = 'dyn:unresolved';
    if (!nodeIds.has(id)) {
      addNode({ id, kind: 'unresolved', name: 'unresolved-dynamic-import' });
    }

    addEdge({
      from: fromId,
      to: id,
      type: 'unresolved-dynamic-import',
      file: srcFe.file,
      line: imp.line,
      dynamic: true
    });
  }

  function addResolvedTypeEdge(fe, entity, name, type, attrs, resolved) {
    const edge = { from: entity.id, file: fe.file, typeName: name, ...attrs };
    if (resolved && resolved.id && nodeIds.has(resolved.id)) {
      addEdge({ ...edge, to: resolved.id, type });
    } else if (resolved && resolved.external) {
      const id = 'ext:' + resolved.external;
      addNode({ id, kind: 'external', name: resolved.external, external: true, builtin: resolved.builtin });
      externalPackages.add(resolved.external);
      addEdge({ ...edge, to: id, type: 'references-external', hint: name,
        resolvedType: resolved.name, builtin: resolved.builtin });
    } else {
      const id = 'unresolved:' + fe.lang + ':' + fe.file + '#' + name;
      addNode({ id, kind: 'unresolved', name, lang: fe.lang });
      addEdge({ ...edge, to: id, type: 'references-unresolved', hint: name, referenceType: type });
    }
  }

  function addPyTypeEdge(fe, entity, name, type, attrs) {
    const resolved = resolvePyType(name, fe, pyModuleToFile, pyFeByFile, attrs.line,
      new Set(), type === 'method-param' || type === 'method-return');
    addResolvedTypeEdge(fe, entity, name, type, attrs, resolved);
  }

  function addJsTypeEdge(fe, entity, name, type, attrs) {
    const id = resolveJsType(name, fe, jsNameToIds, jsModuleToFile);
    let resolved = id ? { id } : null;
    if (!id || !nodeIds.has(id)) {
      const binding = name.split('.')[0];
      const imp = fe.imports.find(imp => !imp.unresolved && !imp.isReExport &&
        (imp.names || []).includes(binding) && !isRelativeSpecifier(imp.specifier));
      if (imp) resolved = {
        external: packageName(imp.specifier),
        builtin: isBuiltinModule(imp.specifier),
        name: exportedNameFromImport(imp, binding) + name.slice(binding.length)
      };
    }
    addResolvedTypeEdge(fe, entity, name, type, attrs, resolved);
  }

  /* ---- File nodes + entities + declared-in edges ---- */
  for (const fe of allFiles) {
    const fileId = 'file:' + fe.file;
    // Multi-signal layer resolution:
    // user config > import(high) > dir-name > import(medium); structure fallback later
    let lineCount = 0;
    let sourceText = '';
    let contentHash;
    if (!fe.error) {
      try {
        const absPath = path.join(rootDir, fe.file);
        sourceText = fs.readFileSync(absPath, 'utf8');
        lineCount = sourceText.split('\n').length;
        contentHash = hashSourceContent(sourceText);
        contentHashes.push(fe.file + '\0' + contentHash);
      } catch {
        contentHashes.push(fe.file + '\0');
      }
    } else {
      contentHashes.push(fe.file + '\0');
    }

    const resolved = resolveLayer({
      filePath: fe.file,
      imports: fe.imports,
      userLayers,
      dirLayer: guessLayerFromPathAndSource(fe.file, sourceText)
    });
    fe._layer = resolved ? resolved.layer : null;
    fe._layerConfidence = resolved ? resolved.confidence : undefined;
    fe._layerSignal = resolved ? resolved.signal : undefined;
    fe._layerConflict = resolved && resolved.conflict ? resolved.conflict : undefined;

    addNode({
      id: fileId,
      kind: 'file',
      name: path.basename(fe.file),
      path: fe.file,
      layer: fe._layer,
      layerConfidence: fe._layerConfidence,
      layerSignal: fe._layerSignal,
      lang: fe.lang,
      lineCount,
      contentHash,
      contentHashVersion: SOURCE_CONTENT_HASH_VERSION
    });

    for (const e of fe.entities) {
      addNode({
        id: e.id,
        kind: e.kind,
        name: e.name,
        path: fe.file,
        line: e.line,
        layer: fe._layer,
        layerConfidence: fe._layerConfidence,
        layerSignal: fe._layerSignal,
        lang: fe.lang,
        modifiers: e.modifiers,
        exported: e.exported,
        fqn: fe.lang === 'java' ? e.id : undefined,
        module: fe.lang === 'java' ? fe.module : fe.module,
        methods: e.members ? e.members.filter((m) => m.kind === 'method').map((m) => m.name).sort() : undefined,
        componentType: e.componentType || undefined,
        propTypes: e.propTypes && e.propTypes.length > 0 ? e.propTypes : undefined,
        method: e.method,
        routePath: e.routePath,
        handlerName: e.handlerName,
        framework: e.framework,
        impl: e.impl || undefined,
        methodImpls: methodImplsFromMembers(e),
        methodTypes: e.methodTypes && e.methodTypes.length ? e.methodTypes : undefined,
        signature: signatureFromEntity(e),
        behavior: (e.impl && e.impl.behavior) || undefined
      });
      addEdge({ from: e.id, to: fileId, type: 'declared-in', file: fe.file, line: e.line });
      if (e.kind === 'route') {
        const handlerId = e.handlerId && nodeIds.has(e.handlerId) ? e.handlerId : fileId;
        addEdge({
          from: handlerId,
          to: e.id,
          type: 'handles',
          file: fe.file,
          line: e.line
        });
      }
    }
  }

  /* ---- Schema / migration files (no AST; contract surface only) ---- */
  const schemaFiles = walkFiles(rootDir, ['.sql', '.prisma'], 400);
  if (schemaFiles.meta.truncated) scanMeta.truncated = true;
  scanMeta.unreadableDirs = [...new Set([
    ...(scanMeta.unreadableDirs || []), ...schemaFiles.meta.unreadableDirs
  ])];
  for (const abs of schemaFiles) {
    const rel = path.relative(rootDir, abs).replace(/\\/g, '/');
    if (!/(^|\/)(migrations?|alembic)(\/|$)|(^|\/)schema\.prisma$|\.sql$/i.test(rel)) continue;
    const fileId = 'file:' + rel;
    if (nodeIds.has(fileId)) continue;
    let lineCount = 0;
    let contentHash;
    try {
      const sourceText = fs.readFileSync(abs, 'utf8');
      lineCount = sourceText.split('\n').length;
      contentHash = hashSourceContent(sourceText);
      contentHashes.push(rel + '\0' + contentHash);
    } catch (error) {
      if (!['EACCES', 'EPERM', 'ENOENT'].includes(error.code)) throw error;
      (scanMeta.unreadableFiles ||= []).push(rel);
      contentHashes.push(rel + '\0');
    }
    addNode({
      id: fileId,
      kind: 'file',
      name: path.basename(rel),
      path: rel,
      lang: path.extname(rel) === '.prisma' ? 'prisma' : 'sql',
      lineCount,
      contentHash,
      contentHashVersion: SOURCE_CONTENT_HASH_VERSION
    });
  }

  /* ---- Import / dependency edges ---- */
  for (const fe of allFiles) {
    const fileId = 'file:' + fe.file;

    if (fe.lang === 'java') {
      // Package-level file node for imports
      const imports = fe.imports;
      for (const imp of imports) {
        if (isJdkImport(imp.specifier) || imp.isWildcard) {
          if (isJdkImport(imp.specifier)) externalPackages.add(imp.specifier.split('.').slice(0, 3).join('.'));
          continue;
        }
        // Internal class?
        if (javaFqns.has(imp.specifier)) {
          addEdge({ from: fileId, to: imp.specifier, type: 'import', file: fe.file, line: imp.line, dependencyType: 'import' });
        } else {
          // external library class -> package node
          const pkgParts = imp.specifier.split('.');
          const extPkg = pkgParts.slice(0, Math.min(3, pkgParts.length - 1)).join('.');
          if (!nodeIds.has('ext:' + extPkg)) {
            addNode({ id: 'ext:' + extPkg, kind: 'external', name: extPkg, external: true });
          }
          externalPackages.add(extPkg);
          addEdge({ from: fileId, to: 'ext:' + extPkg, type: 'uses-external', file: fe.file, line: imp.line });
        }
      }
    } else if (fe.lang === 'python') {
      for (const imp of fe.imports) {
        if (imp.unresolved) {
          addUnresolvedDynamic(fileId, fe, imp);
          continue;
        }
        const modSpec = imp.specifier;
        const targetFiles = new Set();
        let resolvedAny = false;

        // from pkg import a, b — each name may be a submodule file
        if (imp.names && imp.names.length > 0 && !imp.isModuleImport) {
          let needPackage = false;
          const names = imp.names.includes('*')
            ? expandPyStarNames(modSpec, fe, pyModuleToFile, pyFeByFile, pyReexport)
            : imp.names;
          for (const name of names) {
            if (name === '*') { needPackage = true; continue; }
            const exported = exportedNameFromImport(imp, name);
            const asSub = resolvePyModule(modSpec, fe, pyModuleToFile, exported);
            if (asSub && asSub.kind === 'submodule') {
              targetFiles.add(asSub.file);
              resolvedAny = true;
            } else {
              const pkgKey = resolvePyReexportKey(modSpec, fe, pyModuleToFile);
              const reFile = pkgKey ? pyReexport.get(pkgKey + '#' + exported) : null;
              if (reFile) {
                targetFiles.add(reFile);
                resolvedAny = true;
              } else {
                needPackage = true;
              }
            }
          }
          if (needPackage) {
            const resolved = resolvePyModule(modSpec, fe, pyModuleToFile);
            if (resolved) {
              targetFiles.add(resolved.file);
              resolvedAny = true;
            }
          }
        } else {
          const resolved = resolvePyModule(modSpec, fe, pyModuleToFile);
          if (resolved) {
            targetFiles.add(resolved.file);
            resolvedAny = true;
          }
        }

        if (resolvedAny) {
          for (const file of targetFiles) {
            addEdge({ from: fileId, to: 'file:' + file, type: 'import', file: fe.file, line: imp.line, ...importEdgeAttrs(imp) });
          }
        } else if (typeof modSpec === 'string' && isMissingLocalPyModule(modSpec, pyModuleToFile)) {
          const id = 'unresolved:python-import:' + fe.file + '#' + modSpec;
          addNode({ id, kind: 'unresolved', name: modSpec, lang: 'python' });
          addEdge({ from: fileId, to: id, type: 'unresolved-import', file: fe.file,
            line: imp.line, ...importEdgeAttrs(imp) });
        } else {
          // External or stdlib
          const topPkg = (modSpec || '').split('.')[0].replace(/^\.+/, '') || modSpec || 'unknown';
          const isStdlib = isPyStdlib((modSpec || '').replace(/^\.+/, '') || modSpec || '');
          const extId = 'ext:' + topPkg;
          if (!nodeIds.has(extId)) {
            addNode({ id: extId, kind: 'external', name: topPkg, external: true, builtin: isStdlib });
          }
          externalPackages.add(topPkg);
          addEdge({ from: fileId, to: extId, type: 'uses-external', file: fe.file, line: imp.line, builtin: isStdlib, ...importEdgeAttrs(imp) });
        }
      }
    } else if (fe.lang === 'go') {
      for (const imp of fe.imports) {
        const resolved = resolveGoPackage(imp.specifier, goModuleName, goPkgToDir);
        if (resolved) {
          addEdge({ from: fileId, to: 'file:' + resolved.file, type: 'import', file: fe.file, line: imp.line, dependencyType: 'import' });
        } else {
          // External or stdlib
          const pkgPath = typeof imp.specifier === 'string' ? imp.specifier : '';
          if (!pkgPath) continue;
          const isStdlib = imp.isStdlib || (!pkgPath.includes('.') && !pkgPath.startsWith('/'));
          const extId = 'ext:' + pkgPath;
          if (!nodeIds.has(extId)) {
            addNode({ id: extId, kind: 'external', name: pkgPath, external: true, builtin: isStdlib });
          }
          externalPackages.add(pkgPath);
          addEdge({ from: fileId, to: extId, type: 'uses-external', file: fe.file, line: imp.line, builtin: isStdlib });
        }
      }
    } else {
      // JS/TS module resolution
      for (const imp of fe.imports) {
        if (imp.unresolved) {
          addUnresolvedDynamic(fileId, fe, imp);
          continue;
        }
        const spec = imp.specifier;
        if (isRelativeSpecifier(spec)) {
          const resolved = resolveJsModule(spec, fe.file, jsModuleToFile);
          if (resolved) {
            const names = imp.names || [];
            const targets = new Set();
            let usedReexport = false;
            let missingNamed = false;
            for (const name of names) {
              const reFile = jsReexport.get(resolved.module + '#' + name);
              if (reFile) {
                targets.add(reFile);
                usedReexport = true;
              } else {
                missingNamed = true;
              }
            }
            if (usedReexport) {
              for (const file of targets) {
                addEdge({ from: fileId, to: 'file:' + file, type: 'import', file: fe.file, line: imp.line, ...importEdgeAttrs(imp) });
              }
              if (missingNamed) {
                addEdge({ from: fileId, to: 'file:' + resolved.file, type: 'import', file: fe.file, line: imp.line, ...importEdgeAttrs(imp) });
              }
            } else {
              addEdge({ from: fileId, to: 'file:' + resolved.file, type: 'import', file: fe.file, line: imp.line, ...importEdgeAttrs(imp) });
            }
          }
        } else {
          // bare specifier = external package
          const pkg = packageName(spec);
          const builtin = isBuiltinModule(spec);
          const extId = 'ext:' + pkg;
          if (!nodeIds.has(extId)) {
            addNode({ id: extId, kind: 'external', name: pkg, external: true, builtin });
          }
          externalPackages.add(pkg);
          addEdge({ from: fileId, to: extId, type: 'uses-external', file: fe.file, line: imp.line, builtin });
        }
      }
    }
  }

  /* ---- Extends / implements edges ---- */
  for (const fe of allFiles) {
    for (const e of fe.entities) {
      if (fe.lang === 'java') {
        for (const sup of e.extends) {
          const target = resolveJavaType(sup, fe.module, fe.imports, javaFqns);
          if (target) addEdge({ from: e.id, to: target, type: 'extends', file: fe.file, line: e.line });
          else addEdge({ from: e.id, to: 'ext:' + sup, type: 'references-external', file: fe.file, line: e.line, hint: sup });
        }
        for (const impl of e.implements) {
          const target = resolveJavaType(impl, fe.module, fe.imports, javaFqns);
          if (target) addEdge({ from: e.id, to: target, type: 'implements', file: fe.file, line: e.line });
          else addEdge({ from: e.id, to: 'ext:' + impl, type: 'references-external', file: fe.file, line: e.line, hint: impl });
        }
        // Field / ctor / method types already live on members; only local types become wiring.
        const seenJava = new Set();
        for (const m of e.members || []) {
          if (m.kind === 'field' && m.type) {
            const target = resolveJavaType(m.type, fe.module, fe.imports, javaFqns);
            if (!target) continue;
            const key = 'field:' + target + ':' + m.name;
            if (seenJava.has(key)) continue;
            seenJava.add(key);
            addEdge({ from: e.id, to: target, type: 'field-type', field: m.name, typeName: m.type, file: fe.file, line: m.line || e.line });
          } else if (m.kind === 'method') {
            for (const tname of m.paramTypes || []) {
              const target = resolveJavaType(tname, fe.module, fe.imports, javaFqns);
              if (!target) continue;
              const key = 'param:' + target + ':' + m.name;
              if (seenJava.has(key)) continue;
              seenJava.add(key);
              addEdge({ from: e.id, to: target, type: 'method-param', method: m.name, typeName: tname, file: fe.file, line: m.line || e.line });
            }
            if (m.returnType && m.returnType !== 'void') {
              const target = resolveJavaType(m.returnType, fe.module, fe.imports, javaFqns);
              if (!target) continue;
              const key = 'return:' + target + ':' + m.name;
              if (seenJava.has(key)) continue;
              seenJava.add(key);
              addEdge({ from: e.id, to: target, type: 'method-return', method: m.name, typeName: m.returnType, file: fe.file, line: m.line || e.line });
            }
          }
        }
      } else if (fe.lang === 'python') {
        // Python: extends (superclasses) + method types + field types
        for (const sup of e.extends) {
          addPyTypeEdge(fe, e, sup, 'extends', { line: e.line });
        }
        if (e.methodTypes && e.methodTypes.length > 0) {
          const seen = new Set();
          for (const mt of e.methodTypes) {
            const { method, paramTypes, returnTypes, line } = mt;
            for (const tname of paramTypes) {
              const key = 'param:' + tname + ':' + method;
              if (seen.has(key)) continue;
              seen.add(key);
              addPyTypeEdge(fe, e, tname, 'method-param', { method, line });
            }
            for (const tname of returnTypes) {
              const key = 'return:' + tname + ':' + method;
              if (seen.has(key)) continue;
              seen.add(key);
              addPyTypeEdge(fe, e, tname, 'method-return', { method, line });
            }
          }
        }
        if (e.fieldTypes && e.fieldTypes.length > 0) {
          const seen = new Set();
          for (const ft of e.fieldTypes) {
            for (const tname of ft.types) {
              const key = 'field:' + tname + ':' + ft.field;
              if (seen.has(key)) continue;
              seen.add(key);
              addPyTypeEdge(fe, e, tname, 'field-type', { field: ft.field, line: ft.line });
            }
          }
        }
      } else if (fe.lang === 'go') {
        // Go: struct field types, interface method types, function/method param/return types
        // Go uses structural typing — no explicit extends/implements.
        // Struct embedding is captured as field-type (embedded field type).
        // Use typeRefs (which contain {pkg, name}) when available for qualified type resolution.
        if (e.methodTypes && e.methodTypes.length > 0) {
          const seen = new Set();
          for (const mt of e.methodTypes) {
            const { method, line } = mt;
            const paramRefs = mt.paramRefs || (mt.paramTypes || []).map((n) => ({ pkg: null, name: n }));
            const returnRefs = mt.returnRefs || (mt.returnTypes || []).map((n) => ({ pkg: null, name: n }));
            for (const tref of paramRefs) {
              const key = 'param:' + (tref.pkg || '') + '.' + tref.name + ':' + method;
              if (seen.has(key)) continue;
              seen.add(key);
              const target = resolveGoType(tref, fe, goNameToIds, goPkgToDir, goModuleName);
              if (target) addEdge({ from: e.id, to: target, type: 'method-param', method, typeName: tref.name, file: fe.file, line });
              else addEdge({ from: e.id, to: 'ext:' + tref.name, type: 'references-external', method, typeName: tref.name, file: fe.file, line, hint: tref.name });
            }
            for (const tref of returnRefs) {
              const key = 'return:' + (tref.pkg || '') + '.' + tref.name + ':' + method;
              if (seen.has(key)) continue;
              seen.add(key);
              const target = resolveGoType(tref, fe, goNameToIds, goPkgToDir, goModuleName);
              if (target) addEdge({ from: e.id, to: target, type: 'method-return', method, typeName: tref.name, file: fe.file, line });
              else addEdge({ from: e.id, to: 'ext:' + tref.name, type: 'references-external', method, typeName: tref.name, file: fe.file, line, hint: tref.name });
            }
          }
        }
        if (e.fieldTypes && e.fieldTypes.length > 0) {
          const seen = new Set();
          for (const ft of e.fieldTypes) {
            const refs = ft.typeRefs || (ft.types || []).map((n) => ({ pkg: null, name: n }));
            for (const tref of refs) {
              const key = 'field:' + (tref.pkg || '') + '.' + tref.name + ':' + ft.field;
              if (seen.has(key)) continue;
              seen.add(key);
              const target = resolveGoType(tref, fe, goNameToIds, goPkgToDir, goModuleName);
              if (target) addEdge({ from: e.id, to: target, type: 'field-type', field: ft.field, typeName: tref.name, file: fe.file, line: ft.line });
              else addEdge({ from: e.id, to: 'ext:' + tref.name, type: 'references-external', field: ft.field, typeName: tref.name, file: fe.file, line: ft.line, hint: tref.name });
            }
          }
        }
      } else {
        // JS/TS: unresolved or missing local types are not external packages.
        for (const sup of e.extends) {
          addJsTypeEdge(fe, e, sup, 'extends', { line: e.line });
        }
        for (const impl of e.implements) {
          addJsTypeEdge(fe, e, impl, 'implements', { line: e.line });
        }
        // Method parameter / return type references
        if (e.methodTypes && e.methodTypes.length > 0) {
          const seen = new Set();
          for (const mt of e.methodTypes) {
            const { method, paramTypes, returnTypes, line } = mt;
            for (const tname of paramTypes) {
              const key = 'param:' + tname + ':' + method;
              if (seen.has(key)) continue;
              seen.add(key);
              addJsTypeEdge(fe, e, tname, 'method-param', { method, line });
            }
            for (const tname of returnTypes) {
              const key = 'return:' + tname + ':' + method;
              if (seen.has(key)) continue;
              seen.add(key);
              addJsTypeEdge(fe, e, tname, 'method-return', { method, line });
            }
          }
        }
        // Field type references
        if (e.fieldTypes && e.fieldTypes.length > 0) {
          const seen = new Set();
          for (const ft of e.fieldTypes) {
            for (const tname of ft.types) {
              const key = 'field:' + tname + ':' + ft.field;
              if (seen.has(key)) continue;
              seen.add(key);
              addJsTypeEdge(fe, e, tname, 'field-type', { field: ft.field, line: ft.line });
            }
          }
        }
        // React component props
        if (e.kind === 'component' && e.propTypes && e.propTypes.length > 0) {
          const seen = new Set();
          for (const tname of e.propTypes) {
            if (seen.has(tname)) continue;
            seen.add(tname);
            addJsTypeEdge(fe, e, tname, 'component-props', { line: e.line });
          }
        }
      }
    }
  }

  /* ---- NestJS @Module di-registered edges ---- */
  for (const fe of allFiles) {
    if (!fe.diDependencies || fe.diDependencies.length === 0) continue;
    for (const di of fe.diDependencies) {
      const owner = fe.entities.find((en) => en.name === di.ownerName);
      if (!owner) continue;
      const target = resolveJsType(di.refName, fe, jsNameToIds, jsModuleToFile);
      if (!target) continue;
      addEdge({
        from: owner.id,
        to: target,
        type: 'di-registered',
        file: fe.file,
        line: di.line,
        decorator: di.decorator,
        role: di.role
      });
    }
  }

  /* ---- Signal 4: structural position fallback for unlayered files ---- */
  const fanIn = new Map();
  const fanOut = new Map();
  for (const edge of edges) {
    if (edge.type !== 'import') continue;
    if (!edge.from.startsWith('file:') || !edge.to.startsWith('file:')) continue;
    fanOut.set(edge.from, (fanOut.get(edge.from) || 0) + 1);
    fanIn.set(edge.to, (fanIn.get(edge.to) || 0) + 1);
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const fileSignals = [];
  for (const fe of allFiles) {
    const fileId = 'file:' + fe.file;
    const node = nodeById.get(fileId);
    if (!node) continue;
    if (!node.layer) {
      if (!inToolsDir(fe.file)) {
        const struc = inferLayerByStructure(fanIn.get(fileId) || 0, fanOut.get(fileId) || 0);
        if (struc) {
          node.layer = struc.layer;
          node.layerConfidence = struc.confidence;
          node.layerSignal = struc.signal;
          for (const e of fe.entities) {
            const en = nodeById.get(e.id);
            if (en && !en.layer) {
              en.layer = struc.layer;
              en.layerConfidence = struc.confidence;
              en.layerSignal = struc.signal;
            }
          }
        }
      }
    }
    fileSignals.push({
      file: fe.file,
      layer: node.layer || null,
      confidence: node.layerConfidence,
      signal: node.layerSignal,
      conflict: fe._layerConflict
    });
  }
  const layerSignals = aggregateDirectorySignals(fileSignals);

  /* ---- Fingerprint + stats ---- */
  const nodeSummary = nodes
    .filter((n) => n.kind !== 'file' && n.kind !== 'external')
    .map((n) => n.id)
    .sort();
  const edgeSummary = edges
    .filter((e) => e.type !== 'declared-in')
    .map((e) => `${e.from}|${e.type}|${e.to}`)
    .sort();
  const fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify({ n: nodeSummary, e: edgeSummary }))
    .digest('hex')
    .slice(0, 16);

  contentHashes.sort();
  const contentFingerprint = crypto
    .createHash('sha256')
    .update(contentHashes.join('\n'))
    .digest('hex')
    .slice(0, 16);

  const typeCount = nodes.filter((n) => ['class', 'interface', 'enum', 'record', 'annotation', 'function', 'type_alias', 'component'].includes(n.kind)).length;

  // Stamp the effective exclusion scope so a later diff can explain
  // "entities disappeared because .arch-viewer-ignore changed",
  // rather than presenting it as real code deletion/improvement.
  const repoIgnore = loadRepoIgnore(rootDir);
  const scope = {
    ignorePatterns: [
      ...Array.from(repoIgnore.basenames).map((p) => p),
      ...Array.from(repoIgnore.prefixes).map((p) => p + '/')
    ].sort()
  };
  // The call resolver has no lexical scope model. Give it only module bindings;
  // calls shadowed by scoped imports cannot safely use those global bindings.
  const callFiles = allFiles.map((fe) => {
    if (fe.lang !== 'python') return fe;
    const scopedImports = fe.imports.filter((imp) =>
      imp.conditional || (imp.scope && imp.scope !== 'module'));
    return {
      ...fe,
      imports: fe.imports.filter((imp) => !scopedImports.includes(imp)),
      calls: (fe.calls || []).map((site) => {
        const name = site.object || site.callee;
        const shadowed = scopedImports.some((imp) => {
          if (typeof name !== 'string') return false;
          if (imp.scope !== 'module' && (site.line < imp.scopeStart || site.line > imp.scopeEnd)) return false;
          return imp.isModuleImport
            ? name === (imp.alias || imp.specifier) || name.startsWith((imp.alias || imp.specifier) + '.')
            : (imp.names || []).includes(name);
        });
        return shadowed ? { ...site, dynamic: true } : site;
      })
    };
  });

  const graph = {
    version: 1,
    root: path.basename(rootDir),
    generatedAt: new Date().toISOString(),
    fingerprint,
    contentFingerprint,
    sourceContentHashVersion: SOURCE_CONTENT_HASH_VERSION,
    scope,
    languages: Array.from(filesByLang.keys()),
    stats: {
      files: allFiles.length,
      filesParsed,
      parseErrors,
      types: typeCount,
      nodes: nodes.length,
      edges: edges.length,
      externalPackages: externalPackages.size,
      scanTruncated: !!scanMeta.truncated,
      scanCap: scanMeta.cap,
      skippedDevDirs: scanMeta.skippedDevDirs || [],
      unreadableDirs: scanMeta.unreadableDirs || [],
      unreadableFiles: scanMeta.unreadableFiles || [],
      ...(layerConfigError ? { layerConfigError } : {})
    },
    nodes,
    edges,
    layerSignals,
    _callCtx: {
      allFiles: callFiles,
      feByFile: new Map(callFiles.map((f) => [f.file, f])),
      jsModuleToFile,
      jsNameToIds,
      pyModuleToFile,
      // A repo-wide name fallback would reintroduce the excluded local imports.
      pyNameToIds: new Map(),
      javaFqns,
      goPkgToDir,
      goNameToIds,
      resolveJsModule: (spec, from) => resolveJsModule(spec, from, jsModuleToFile),
      resolvePyModule: (spec, fe, importedName) => resolvePyModule(spec, fe, pyModuleToFile, importedName),
      resolveGoPackage: (spec) => resolveGoPackage(spec, goModuleName, goPkgToDir)
    }
  };
  if (opts.calls) {
    attachCallEdges(graph, opts.calls === true ? {} : opts.calls);
  }
  return graph;
}

/**
 * Resolve a JS/TS type name (from extends/implements) to a local entity id.
 * Order: same-file -> imported binding from a relative module.
 * No repo-wide unique-name guessing (avoids same-name misbinding across packages).
 */
function resolveJsType(name, fe, jsNameToIds, jsModuleToFile) {
  // 1. Same file entity
  const sameFile = fe.entities.find((en) => en.name === name);
  if (sameFile) return sameFile.id;

  // 2. Imported binding from a relative module: <modulePath>#<name>
  for (const imp of fe.imports) {
    if (!imp.isReExport && !imp.unresolved && imp.names && imp.names.includes(name) && isRelativeSpecifier(imp.specifier)) {
      const resolved = resolveJsModule(imp.specifier, fe.file, jsModuleToFile);
      if (resolved) {
        return resolved.module + '#' + exportedNameFromImport(imp, name);
      }
    }
  }

  void jsNameToIds;
  return null;
}

function guessLayerBuiltin(filePath) {
  const normalized = filePath.toLowerCase().replace(/\\/g, '/');
  const segs = normalized.split('/');
  const segHas = (re) => segs.some((s) => re.test(s));
  const fileName = segs[segs.length - 1] || '';
  const inTools = segs.includes('tools') || segs.includes('tool');
  // tools/ 下的运维/诊断/CLI 目录：先于 crawl/worker→service，避免误报 util→service
  const TOOLS_ENTRY_DIR = /^(bin|cli|cmd|scripts?|diagnostics?|monitoring|alerts?|ops|opscripts?|restore|recover|repair|migrate|migrations?|collect|crawl|spider|scraper|worker|consumer)$/;

  // Built-in patterns
  if (/\/?(components?|ui|widgets?|screens?|containers?|layouts?)\//.test(normalized) ||
      /\.(component|page|view|screen|layout)\.(tsx|jsx|ts|js)$/.test(normalized) ||
      segHas(/^(dashboard|admin|frontend)$/)) return 'component';
  if (/\/?(controller|controllers|resource|resources|api|web|routes?|handler|handlers|page|pages|view|views)\//.test(normalized) ||
      /\.(controller|routes?)\.(java|js|ts|jsx|tsx|py|go)$/.test(normalized)) return 'controller';
  // tools/**/diagnostics|monitoring|alert|ops|… → entrypoint（与 controller 同级，允许 → service）
  if (inTools && segs.some((s) => TOOLS_ENTRY_DIR.test(s))) return 'entrypoint';
  if (/\/?(service|services|usecase|usecases|facade|facades|business|hooks?|store|stores|composables?)\//.test(normalized) ||
      /\.(service|usecase|facade|store|hook)\.(java|js|ts|tsx|vue|svelte|py|go)$/.test(normalized) ||
      // Business-processing roots: crawlers/spiders/workers/consumers/data collection
      // （不含 tools/ 下同名目录：上面已判 entrypoint）
      (!inTools && segHas(/(collect|crawl|spider|scraper|worker|consumer|batch[-_]?job)/))) return 'service';
  if (/\/?(domain|model|models|entity|entities|core|aggregate|aggregates)\//.test(normalized) ||
      /\.(model|entity|domain|aggregate)\.(java|js|ts|py|go)$/.test(normalized)) return 'domain';
  if (/\/?(repository|repositories|dao|daos|mapper|mappers|persistence|storage|db|database|databases|cache)\//.test(normalized) ||
      /\.(repository|dao|mapper)\.(java|js|ts|py|go)$/.test(normalized)) return 'storage';
  if (/\/?(dto|dtos|vo|vos|pojo|pojos|request|response|payload|payloads|schema|schemas|types?|interfaces?|props?)\//.test(normalized)) return 'dto';
  if (/\/?(config|configs|configuration|conf|settings|properties)\//.test(normalized) ||
      /\.(config|configuration|settings|properties)\.(java|js|ts|py|go)$/.test(normalized)) return 'config';
  // util = 通用库。不再把整个 tools/ 一刀切成底层。
  if (/\/?(util|utils|helper|helpers|common|shared|lib|libs)\//.test(normalized) ||
      segHas(/^(prox?y|proxies)$/)) return 'util';
  if (inTools && /(helper|util|utils|common|shared|lib)s?/.test(fileName)) return 'util';
  // entrypoint = CLI / bin / scripts；与 controller 同级，允许调用 service。
  if (segHas(/^(bin|cli|cmd|scripts?)$/)) return 'entrypoint';
  if (/^(main|__main__|cli|cmd)(\.[^.]+)?$/.test(fileName)) return 'entrypoint';
  if (inTools && /(^|[._-])(cli|cmd|main)(\.|$)/.test(fileName)) return 'entrypoint';
  if (inTools && /(restore|recover|diagnos|repair|migrate)/.test(fileName)) return 'entrypoint';
  return null;
}

function inToolsDir(filePath) {
  const segs = filePath.toLowerCase().replace(/\\/g, '/').split('/');
  return segs.includes('tools') || segs.includes('tool');
}

function looksLikeCliEntrypoint(source) {
  if (!source) return false;
  if (/\bif\s+__name__\s*==\s*['"']__main__['"']/.test(source)) return true;
  if (/\bargparse\b/.test(source) && /\.parse_args\s*\(/.test(source)) return true;
  if (/\b(click|typer)\b/.test(source) && /(@click\.|typer\.)/.test(source)) return true;
  if (/\b(commander|yargs|cac)\b/.test(source)) return true;
  if (/\bdef\s+main\s*\(/.test(source)) return true;
  return false;
}

function guessLayerFromPathAndSource(filePath, source) {
  const built = guessLayerBuiltin(filePath);
  if (built) return built;
  if (inToolsDir(filePath) && looksLikeCliEntrypoint(source)) return 'entrypoint';
  return null;
}

function resolvePyReexportKey(modSpec, fe, pyModuleToFile) {
  const resolved = resolvePyModule(modSpec || '', fe, pyModuleToFile);
  if (resolved) return pyExtractor.filePathToModule(resolved.file);
  return (modSpec || '').replace(/^\.+/, '').replace(/\./g, '/');
}

function expandPyStarNames(modSpec, fe, pyModuleToFile, pyFeByFile, pyReexport) {
  const resolved = resolvePyModule(modSpec, fe, pyModuleToFile);
  const names = new Set();
  if (resolved) {
    const target = pyFeByFile.get(resolved.file);
    for (const n of entityNamesFromFile(target)) names.add(n);
    const pkgKey = pyExtractor.filePathToModule(resolved.file);
    for (const key of pyReexport.keys()) {
      if (key.startsWith(pkgKey + '#')) names.add(key.slice(pkgKey.length + 1));
    }
  }
  return names.size ? [...names] : ['*'];
}

function guessLayer(filePath, lang, userLayers) {
  // Project-level overrides take precedence over built-in patterns
  const user = matchUserLayer(filePath, userLayers);
  if (user) return user.layer;
  return guessLayerBuiltin(filePath);
}

function extractGraphTo(repoPath, outPath) {
  const graph = buildGraph(repoPath);
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(toPersistableGraph(graph), null, 2));
  }
  return graph;
}

function isGraphPayload(value) {
  return !!(value && typeof value === 'object' && Array.isArray(value.nodes) && Array.isArray(value.edges));
}

/**
 * Load a repo directory or a previously extracted graph JSON.
 * Throws with `.exitCode` so CLI can map 2/3/4 without guessing.
 */
function loadGraphInput(target) {
  const { codedError, EXIT } = require('./exit-codes');
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) {
    throw codedError(`No such path (exit 4): ${abs}`, EXIT.NO_BASELINE);
  }
  const st = fs.statSync(abs);
  if (st.isFile()) {
    if (!/\.json$/i.test(abs)) {
      throw codedError(`Cannot scan (exit 3): not a directory or graph JSON: ${abs}`, EXIT.SCAN_FAILED);
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (e) {
      throw codedError(`Graph/baseline file is corrupted (exit 4): ${abs}\n  ${e.message}`, EXIT.NO_BASELINE);
    }
    if (!isGraphPayload(parsed)) {
      throw codedError(`Not a graph JSON (exit 4): ${abs} (need { nodes, edges })`, EXIT.NO_BASELINE);
    }
    return parsed;
  }
  if (!st.isDirectory()) {
    throw codedError(`Cannot scan (exit 3): not a directory: ${abs}`, EXIT.SCAN_FAILED);
  }
  try {
    return buildGraph(abs);
  } catch (e) {
    throw codedError(`Scan failed (exit 3): ${e.message}`, EXIT.SCAN_FAILED);
  }
}

module.exports = {
  buildGraph,
  extractGraphTo,
  guessLayer,
  resolvePyModule,
  loadGraphInput,
  attachCallEdges,
  toPersistableGraph
};
