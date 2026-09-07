'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { walkSourceFiles, CODE_EXTS, LANG_BY_EXT } = require('./extract/shared');
const javaExtractor = require('./extract/java');
const jstsExtractor = require('./extract/jsts');
const vueExtractor = require('./extract/vue');
const svelteExtractor = require('./extract/svelte');
const pyExtractor = require('./extract/python');
const goExtractor = require('./extract/go');
const {
  resolveLayer,
  inferLayerByStructure,
  matchUserLayer,
  aggregateDirectorySignals
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

/* ------------------------------- Java helpers ------------------------------ */

function isJdkImport(fqn) {
  return javaExtractor.isJdkImport(fqn);
}

function resolveJavaType(shortName, pkg, imports, localFqns) {
  if (localFqns.has(shortName)) return shortName;
  for (const imp of imports) {
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
  return spec.startsWith('.') || spec.startsWith('/');
}

function isBuiltinModule(spec) {
  const base = spec.startsWith('node:') ? spec.slice(5) : spec;
  return jstsExtractor.NODE_BUILTINS.has(base) || jstsExtractor.NODE_BUILTINS.has(spec);
}

/** External package name from a bare specifier (handle scoped packages). */
function packageName(spec) {
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

/** Resolve a Python type name to a local entity id. */
function resolvePyType(name, fe, pyNameToIds, pyModuleToFile) {
  // 1. Same file entity
  const sameFile = fe.entities.find((en) => en.name === name);
  if (sameFile) return sameFile.id;

  // 2. Imported name: from module import Name
  for (const imp of fe.imports) {
    if (imp.names && imp.names.includes(name)) {
      // If `name` is a submodule (from pkg import mod), it is not a type binding
      const asSub = resolvePyModule(imp.specifier, fe, pyModuleToFile, name);
      if (asSub && asSub.kind === 'submodule') continue;
      const resolved = resolvePyModule(imp.specifier, fe, pyModuleToFile);
      if (resolved) {
        return resolved.module + '#' + name;
      }
    }
  }

  // 3. Repo-wide unique simple name
  const candidates = pyNameToIds.get(name);
  if (candidates && candidates.length === 1) return candidates[0];
  return null;
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

function buildGraph(rootDir) {
  const filesByLang = walkSourceFiles(rootDir);

  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const externalPackages = new Set();

  // Read project-level layer overrides (.av/layers.json)
  // Format: { "database": "storage", "schemas": "dto", ... }
  let userLayers = null;
  try {
    const layersPath = path.join(rootDir, '.av', 'layers.json');
    if (fs.existsSync(layersPath)) {
      userLayers = JSON.parse(fs.readFileSync(layersPath, 'utf8'));
    }
  } catch { /* ignore malformed config */ }

  // Per-language extraction results.
  const allFiles = [];          // normalized FileExtract[]
  let filesParsed = 0;
  let parseErrors = 0;

  for (const [lang, files] of filesByLang) {
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
        if (!jsNameToIds.has(e.name)) jsNameToIds.set(e.name, []);
        jsNameToIds.get(e.name).push(e.id);
      }
    }
  }

  function addNode(node) {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  }

  function addEdge(edge) {
    edges.push(edge);
  }

  /* ---- File nodes + entities + declared-in edges ---- */
  for (const fe of allFiles) {
    const fileId = 'file:' + fe.file;
    // Multi-signal layer resolution:
    // user config > import(high) > dir-name > import(medium); structure fallback later
    const resolved = resolveLayer({
      filePath: fe.file,
      imports: fe.imports,
      userLayers,
      dirLayer: guessLayerBuiltin(fe.file)
    });
    fe._layer = resolved ? resolved.layer : null;
    fe._layerConfidence = resolved ? resolved.confidence : undefined;
    fe._layerSignal = resolved ? resolved.signal : undefined;
    fe._layerConflict = resolved && resolved.conflict ? resolved.conflict : undefined;

    let lineCount = 0;
    if (!fe.error) {
      try {
        const absPath = path.join(rootDir, fe.file);
        const buf = fs.readFileSync(absPath, 'utf8');
        lineCount = buf.split('\n').length;
      } catch { /* ignore */ }
    }

    addNode({
      id: fileId,
      kind: 'file',
      name: path.basename(fe.file),
      path: fe.file,
      layer: fe._layer,
      layerConfidence: fe._layerConfidence,
      layerSignal: fe._layerSignal,
      lang: fe.lang,
      lineCount
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
        propTypes: e.propTypes && e.propTypes.length > 0 ? e.propTypes : undefined
      });
      addEdge({ from: e.id, to: fileId, type: 'declared-in', file: fe.file, line: e.line });
    }
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
          addEdge({ from: fileId, to: imp.specifier, type: 'import', file: fe.file, line: imp.line });
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
        const modSpec = imp.specifier;
        const targetFiles = new Set();
        let resolvedAny = false;

        // from pkg import a, b — each name may be a submodule file
        if (imp.names && imp.names.length > 0 && !imp.isModuleImport) {
          let needPackage = false;
          for (const name of imp.names) {
            const asSub = resolvePyModule(modSpec, fe, pyModuleToFile, name);
            if (asSub && asSub.kind === 'submodule') {
              targetFiles.add(asSub.file);
              resolvedAny = true;
            } else {
              needPackage = true;
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
            addEdge({ from: fileId, to: 'file:' + file, type: 'import', file: fe.file, line: imp.line });
          }
        } else {
          // External or stdlib
          const topPkg = modSpec.split('.')[0].replace(/^\.+/, '') || modSpec;
          const isStdlib = isPyStdlib(modSpec.replace(/^\.+/, '') || modSpec);
          const extId = 'ext:' + topPkg;
          if (!nodeIds.has(extId)) {
            addNode({ id: extId, kind: 'external', name: topPkg, external: true, builtin: isStdlib });
          }
          externalPackages.add(topPkg);
          addEdge({ from: fileId, to: extId, type: 'uses-external', file: fe.file, line: imp.line, builtin: isStdlib });
        }
      }
    } else if (fe.lang === 'go') {
      for (const imp of fe.imports) {
        const resolved = resolveGoPackage(imp.specifier, goModuleName, goPkgToDir);
        if (resolved) {
          addEdge({ from: fileId, to: 'file:' + resolved.file, type: 'import', file: fe.file, line: imp.line });
        } else {
          // External or stdlib
          const pkgPath = imp.specifier;
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
        const spec = imp.specifier;
        if (isRelativeSpecifier(spec)) {
          const resolved = resolveJsModule(spec, fe.file, jsModuleToFile);
          if (resolved) {
            addEdge({ from: fileId, to: 'file:' + resolved.file, type: 'import', file: fe.file, line: imp.line, isType: !!imp.isType });
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
      } else if (fe.lang === 'python') {
        // Python: extends (superclasses) + method types + field types
        for (const sup of e.extends) {
          const target = resolvePyType(sup, fe, pyNameToIds, pyModuleToFile);
          if (target) addEdge({ from: e.id, to: target, type: 'extends', file: fe.file, line: e.line });
          else addEdge({ from: e.id, to: 'ext:' + sup, type: 'references-external', file: fe.file, line: e.line, hint: sup });
        }
        if (e.methodTypes && e.methodTypes.length > 0) {
          const seen = new Set();
          for (const mt of e.methodTypes) {
            const { method, paramTypes, returnTypes, line } = mt;
            for (const tname of paramTypes) {
              const key = 'param:' + tname + ':' + method;
              if (seen.has(key)) continue;
              seen.add(key);
              const target = resolvePyType(tname, fe, pyNameToIds, pyModuleToFile);
              if (target) addEdge({ from: e.id, to: target, type: 'method-param', method, typeName: tname, file: fe.file, line });
              else addEdge({ from: e.id, to: 'ext:' + tname, type: 'references-external', method, typeName: tname, file: fe.file, line, hint: tname });
            }
            for (const tname of returnTypes) {
              const key = 'return:' + tname + ':' + method;
              if (seen.has(key)) continue;
              seen.add(key);
              const target = resolvePyType(tname, fe, pyNameToIds, pyModuleToFile);
              if (target) addEdge({ from: e.id, to: target, type: 'method-return', method, typeName: tname, file: fe.file, line });
              else addEdge({ from: e.id, to: 'ext:' + tname, type: 'references-external', method, typeName: tname, file: fe.file, line, hint: tname });
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
              const target = resolvePyType(tname, fe, pyNameToIds, pyModuleToFile);
              if (target) addEdge({ from: e.id, to: target, type: 'field-type', field: ft.field, typeName: tname, file: fe.file, line: ft.line });
              else addEdge({ from: e.id, to: 'ext:' + tname, type: 'references-external', field: ft.field, typeName: tname, file: fe.file, line: ft.line, hint: tname });
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
        // JS/TS: resolve by imported names or same-repo simple names
        for (const sup of e.extends) {
          const target = resolveJsType(sup, fe, jsNameToIds, jsModuleToFile);
          if (target) addEdge({ from: e.id, to: target, type: 'extends', file: fe.file, line: e.line });
          else addEdge({ from: e.id, to: 'ext:' + sup, type: 'references-external', file: fe.file, line: e.line, hint: sup });
        }
        for (const impl of e.implements) {
          const target = resolveJsType(impl, fe, jsNameToIds, jsModuleToFile);
          if (target) addEdge({ from: e.id, to: target, type: 'implements', file: fe.file, line: e.line });
          else addEdge({ from: e.id, to: 'ext:' + impl, type: 'references-external', file: fe.file, line: e.line, hint: impl });
        }
        // Method parameter / return type references
        if (e.methodTypes && e.methodTypes.length > 0) {
          const seen = new Set();
          for (const mt of e.methodTypes) {
            const { method, paramTypes, returnTypes, line } = mt;
            for (const tname of paramTypes) {
              const target = resolveJsType(tname, fe, jsNameToIds, jsModuleToFile);
              const key = 'param:' + tname + ':' + method;
              if (seen.has(key)) continue;
              seen.add(key);
              if (target) {
                addEdge({ from: e.id, to: target, type: 'method-param', method, typeName: tname, file: fe.file, line });
              } else {
                addEdge({ from: e.id, to: 'ext:' + tname, type: 'references-external', method, typeName: tname, file: fe.file, line, hint: tname });
              }
            }
            for (const tname of returnTypes) {
              const target = resolveJsType(tname, fe, jsNameToIds, jsModuleToFile);
              const key = 'return:' + tname + ':' + method;
              if (seen.has(key)) continue;
              seen.add(key);
              if (target) {
                addEdge({ from: e.id, to: target, type: 'method-return', method, typeName: tname, file: fe.file, line });
              } else {
                addEdge({ from: e.id, to: 'ext:' + tname, type: 'references-external', method, typeName: tname, file: fe.file, line, hint: tname });
              }
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
              const target = resolveJsType(tname, fe, jsNameToIds, jsModuleToFile);
              if (target) {
                addEdge({ from: e.id, to: target, type: 'field-type', field: ft.field, typeName: tname, file: fe.file, line: ft.line });
              } else {
                addEdge({ from: e.id, to: 'ext:' + tname, type: 'references-external', field: ft.field, typeName: tname, file: fe.file, line: ft.line, hint: tname });
              }
            }
          }
        }
        // React component props
        if (e.kind === 'component' && e.propTypes && e.propTypes.length > 0) {
          const seen = new Set();
          for (const tname of e.propTypes) {
            if (seen.has(tname)) continue;
            seen.add(tname);
            const target = resolveJsType(tname, fe, jsNameToIds, jsModuleToFile);
            if (target) {
              addEdge({ from: e.id, to: target, type: 'component-props', typeName: tname, file: fe.file, line: e.line });
            } else {
              addEdge({ from: e.id, to: 'ext:' + tname, type: 'references-external', typeName: tname, file: fe.file, line: e.line, hint: tname });
            }
          }
        }
      }
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

  const typeCount = nodes.filter((n) => ['class', 'interface', 'enum', 'record', 'annotation', 'function', 'type_alias', 'component'].includes(n.kind)).length;

  return {
    version: 1,
    root: path.basename(rootDir),
    generatedAt: new Date().toISOString(),
    fingerprint,
    languages: Array.from(filesByLang.keys()),
    stats: {
      files: allFiles.length,
      filesParsed,
      parseErrors,
      types: typeCount,
      nodes: nodes.length,
      edges: edges.length,
      externalPackages: externalPackages.size
    },
    nodes,
    edges,
    layerSignals
  };
}

/**
 * Resolve a JS/TS type name (from extends/implements) to a local entity id.
 * Order: same-file -> imported binding from a relative module -> repo-wide unique name.
 */
function resolveJsType(name, fe, jsNameToIds, jsModuleToFile) {
  // 1. Same file entity
  const sameFile = fe.entities.find((en) => en.name === name);
  if (sameFile) return sameFile.id;

  // 2. Imported binding from a relative module: <modulePath>#<name>
  for (const imp of fe.imports) {
    if (imp.names && imp.names.includes(name) && isRelativeSpecifier(imp.specifier)) {
      const resolved = resolveJsModule(imp.specifier, fe.file, jsModuleToFile);
      if (resolved) {
        return resolved.module + '#' + name;
      }
    }
  }

  // 3. Repo-wide unique simple name
  const candidates = jsNameToIds.get(name);
  if (candidates && candidates.length === 1) return candidates[0];
  return null;
}

function guessLayerBuiltin(filePath) {
  const normalized = filePath.toLowerCase();
  const segs = normalized.split('/');
  const segHas = (re) => segs.some((s) => re.test(s));

  // Built-in patterns
  if (/\/?(components?|ui|widgets?|screens?|containers?|layouts?)\//.test(normalized) ||
      /\.(component|page|view|screen|layout)\.(tsx|jsx|ts|js)$/.test(normalized) ||
      segHas(/^(dashboard|admin|frontend)$/)) return 'component';
  if (/\/?(controller|controllers|resource|resources|api|web|routes?|handler|handlers|page|pages|view|views)\//.test(normalized) ||
      /\.(controller|routes?)\.(java|js|ts|jsx|tsx|py|go)$/.test(normalized)) return 'controller';
  if (/\/?(service|services|usecase|usecases|facade|facades|business|hooks?|store|stores|composables?)\//.test(normalized) ||
      /\.(service|usecase|facade|store|hook)\.(java|js|ts|tsx|vue|svelte|py|go)$/.test(normalized) ||
      // Business-processing roots: crawlers/spiders/workers/consumers/data collection
      segHas(/(collect|crawl|spider|scraper|worker|consumer|batch[-_]?job)/)) return 'service';
  if (/\/?(domain|model|models|entity|entities|core|aggregate|aggregates)\//.test(normalized) ||
      /\.(model|entity|domain|aggregate)\.(java|js|ts|py|go)$/.test(normalized)) return 'domain';
  if (/\/?(repository|repositories|dao|daos|mapper|mappers|persistence|storage|db|database|databases|cache)\//.test(normalized) ||
      /\.(repository|dao|mapper)\.(java|js|ts|py|go)$/.test(normalized)) return 'storage';
  if (/\/?(dto|dtos|vo|vos|pojo|pojos|request|response|payload|payloads|schema|schemas|types?|interfaces?|props?)\//.test(normalized)) return 'dto';
  if (/\/?(config|configs|configuration|conf|settings|properties)\//.test(normalized) ||
      /\.(config|configuration|settings|properties)\.(java|js|ts|py|go)$/.test(normalized)) return 'config';
  if (/\/?(util|utils|helper|helpers|common|shared|lib|libs|tools?)\//.test(normalized) ||
      segHas(/^(prox?y|proxies)$/)) return 'util';
  return null;
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
    fs.writeFileSync(outPath, JSON.stringify(graph, null, 2));
  }
  return graph;
}

module.exports = { buildGraph, extractGraphTo, guessLayer, resolvePyModule };
