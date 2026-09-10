'use strict';

/**
 * Function-level call edges.
 *
 * Built after the structural graph (import / type / inheritance). Call edges
 * are a side channel: they do not enter the structure fingerprint, are stripped
 * from graph-baseline.json, and are ignored by diffGraphs.
 *
 * Incremental: session report only resolves calls in the changed-file closure
 * (touched files + reverse importers).
 */

const CALL_EDGE = 'call';
const UNRESOLVED_EDGE = 'unresolved-call';
const UNRESOLVED_ID = 'call:unresolved';
const UNRESOLVED_KIND = 'unresolved-call';

const SELF_RECV = new Set(['this', 'self', 'super', 'cls', 'Me']);

const SKIP_CALLEES = {
  javascript: new Set([
    'require', 'import', 'console', 'JSON', 'Math', 'Object', 'Array', 'Promise',
    'Number', 'String', 'Boolean', 'Date', 'Error', 'Map', 'Set', 'WeakMap',
    'WeakSet', 'Reflect', 'Proxy', 'Symbol', 'Buffer', 'process', 'fetch',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'parseInt',
    'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
    'structuredClone', 'queueMicrotask', 'requestAnimationFrame', 'eval',
    'setImmediate', 'clearImmediate', 'atob', 'btoa', 'undefined', 'log',
    'warn', 'error', 'info', 'debug', 'trace', 'assert'
  ]),
  typescript: null, // alias javascript
  python: new Set([
    'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple',
    'bool', 'type', 'isinstance', 'issubclass', 'getattr', 'setattr', 'hasattr',
    'super', 'property', 'staticmethod', 'classmethod', 'enumerate', 'zip', 'map',
    'filter', 'sorted', 'reversed', 'iter', 'next', 'open', 'abs', 'min', 'max',
    'sum', 'any', 'all', 'hex', 'bin', 'oct', 'format', 'repr', 'vars', 'dir',
    'id', 'hash', 'callable', 'input', 'bytes', 'object', 'Exception', 'ValueError',
    'TypeError', 'KeyError', 'RuntimeError'
  ]),
  java: new Set([
    'System', 'Objects', 'Collections', 'Arrays', 'Math', 'Optional', 'String',
    'Integer', 'Long', 'Boolean', 'List', 'Map', 'Set', 'HashMap', 'ArrayList',
    'HashSet', 'Collectors', 'Objects', 'println', 'print', 'requireNonNull'
  ]),
  go: new Set([
    'fmt', 'len', 'cap', 'make', 'append', 'copy', 'delete', 'close', 'panic',
    'recover', 'new', 'complex', 'real', 'imag', 'min', 'max', 'clear', 'print',
    'println', 'panic', 'append'
  ])
};
SKIP_CALLEES.typescript = SKIP_CALLEES.javascript;
SKIP_CALLEES.vue = SKIP_CALLEES.javascript;
SKIP_CALLEES.svelte = SKIP_CALLEES.javascript;

const SKIP_OBJECTS = {
  javascript: new Set(['console', 'JSON', 'Math', 'Object', 'Array', 'Promise', 'Number', 'String', 'Date', 'Error', 'Reflect', 'process', 'Buffer', 'window', 'document', 'global', 'globalThis']),
  python: new Set(['os', 'sys', 're', 'json', 'logging', 'typing', 'pathlib', 'datetime', 'asyncio', 'collections', 'functools', 'itertools']),
  java: new Set(['System', 'Objects', 'Collections', 'Arrays', 'Math', 'Optional']),
  go: new Set(['fmt', 'log', 'os', 'io', 'strings', 'strconv', 'time', 'context', 'errors', 'sync', 'bytes'])
};
SKIP_OBJECTS.typescript = SKIP_OBJECTS.javascript;
SKIP_OBJECTS.vue = SKIP_OBJECTS.javascript;
SKIP_OBJECTS.svelte = SKIP_OBJECTS.javascript;

function isCallSurfaceNode(n) {
  return !!(n && (n.kind === UNRESOLVED_KIND || n.id === UNRESOLVED_ID));
}

function isCallSurfaceEdge(e) {
  return !!(e && (e.type === CALL_EDGE || e.type === UNRESOLVED_EDGE));
}

function skipSet(map, lang) {
  return map[lang] || map.javascript || new Set();
}

function countArgs(argsNode) {
  if (!argsNode) return 0;
  let n = 0;
  const count = typeof argsNode.namedChildCount === 'number' ? argsNode.namedChildCount : argsNode.childCount;
  for (let i = 0; i < count; i++) {
    const c = argsNode.namedChild ? argsNode.namedChild(i) : argsNode.child(i);
    if (!c) continue;
    if (c.type === ',' || c.type === '(' || c.type === ')' || c.type === '{' || c.type === '}') continue;
    if (c.isNamed === false) continue;
    n++;
  }
  return n;
}

function simpleObjectName(node) {
  if (!node) return null;
  if (node.type === 'identifier' || node.type === 'property_identifier'
    || node.type === 'type_identifier' || node.type === 'package_identifier') {
    return node.text;
  }
  if (node.type === 'this' || node.type === 'super' || node.type === 'this_expression') return 'this';
  const id = node.childForFieldName && (node.childForFieldName('name') || node.childForFieldName('attribute') || node.childForFieldName('property'));
  if (id && id.text && !/[.\[]/.test(id.text)) return id.text;
  const t = String(node.text || '').replace(/\s+/g, '');
  if (/^[A-Za-z_][\w]*$/.test(t)) return t;
  if (/^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)+$/.test(t) && t.length < 80) return t;
  return null;
}

function parseJsCallee(fnNode) {
  if (!fnNode) return null;
  if (fnNode.type === 'identifier') {
    return { object: null, callee: fnNode.text, dynamic: false };
  }
  if (fnNode.type === 'member_expression' || fnNode.type === 'member_access_expression') {
    const obj = fnNode.childForFieldName('object');
    const prop = fnNode.childForFieldName('property');
    if (obj && (obj.type === 'subscript_expression' || /\[/.test(obj.text || ''))) {
      return { object: simpleObjectName(obj), callee: prop ? prop.text : null, dynamic: true };
    }
    return { object: simpleObjectName(obj), callee: prop ? prop.text : null, dynamic: false };
  }
  if (fnNode.type === 'subscript_expression') {
    return { object: simpleObjectName(fnNode.childForFieldName('object')), callee: null, dynamic: true };
  }
  return { object: null, callee: null, dynamic: true };
}

function parsePyCallee(fnNode) {
  if (!fnNode) return null;
  if (fnNode.type === 'identifier') return { object: null, callee: fnNode.text, dynamic: false };
  if (fnNode.type === 'attribute') {
    const obj = fnNode.childForFieldName('object');
    const attr = fnNode.childForFieldName('attribute');
    return { object: simpleObjectName(obj), callee: attr ? attr.text : null, dynamic: false };
  }
  return { object: null, callee: null, dynamic: true };
}

function parseJavaCallee(callNode) {
  if (callNode.type === 'object_creation_expression') {
    const t = callNode.childForFieldName('type');
    let name = null;
    if (t) {
      if (t.type === 'type_identifier' || t.type === 'identifier') name = t.text;
      else if (t.type === 'generic_type') {
        const inner = t.childForFieldName('type');
        name = inner ? inner.text : null;
      } else if (t.type === 'scoped_type_identifier') {
        name = String(t.text || '').split('.').pop();
      }
    }
    return { object: null, callee: name, dynamic: false, construct: true };
  }
  const name = callNode.childForFieldName('name');
  const obj = callNode.childForFieldName('object');
  return {
    object: obj ? simpleObjectName(obj) : null,
    callee: name ? name.text : null,
    dynamic: false
  };
}

function parseGoCallee(fnNode) {
  if (!fnNode) return null;
  if (fnNode.type === 'identifier') return { object: null, callee: fnNode.text, dynamic: false };
  if (fnNode.type === 'selector_expression') {
    const operand = fnNode.childForFieldName('operand');
    const field = fnNode.childForFieldName('field');
    return { object: simpleObjectName(operand), callee: field ? field.text : null, dynamic: false };
  }
  return { object: null, callee: null, dynamic: true };
}

function classNameOf(node, lang) {
  if (!node) return null;
  if (lang === 'java' || lang === 'javascript' || lang === 'typescript' || lang === 'vue' || lang === 'svelte') {
    if (node.type === 'class_declaration' || node.type === 'class_definition') {
      const n = node.childForFieldName('name');
      return n ? n.text : null;
    }
  }
  if (lang === 'python' && node.type === 'class_definition') {
    const n = node.childForFieldName('name');
    return n ? n.text : null;
  }
  if (lang === 'go' && node.type === 'method_declaration') {
    const recv = node.childForFieldName('receiver');
    if (!recv) return null;
    const text = String(recv.text || '');
    const m = text.match(/\*?\s*([A-Za-z_][\w]*)\s*\)/);
    return m ? m[1] : null;
  }
  return null;
}

function fnNameOf(node, lang) {
  if (!node) return null;
  const n = node.childForFieldName && node.childForFieldName('name');
  if (n && n.text) return n.text;
  if (lang === 'javascript' || lang === 'typescript' || lang === 'vue' || lang === 'svelte') {
    if (node.type === 'arrow_function' || node.type === 'function' || node.type === 'function_expression') {
      let p = node.parent;
      while (p) {
        if (p.type === 'variable_declarator' || p.type === 'pair') {
          const id = p.childForFieldName('name') || p.childForFieldName('key');
          if (id && id.text) return id.text;
        }
        p = p.parent;
      }
    }
  }
  return null;
}

function isFnNode(node, lang) {
  if (!node) return false;
  const t = node.type;
  if (lang === 'python') return t === 'function_definition';
  if (lang === 'java') return t === 'method_declaration' || t === 'constructor_declaration';
  if (lang === 'go') return t === 'function_declaration' || t === 'method_declaration';
  return t === 'function_declaration' || t === 'generator_function_declaration'
    || t === 'method_definition' || t === 'arrow_function'
    || t === 'function_expression' || t === 'function';
}

function isClassNode(node, lang) {
  if (!node) return false;
  if (lang === 'python') return node.type === 'class_definition';
  if (lang === 'java') {
    return ['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration'].includes(node.type);
  }
  if (lang === 'go') return false;
  return node.type === 'class_declaration';
}

function enclosingCaller(callNode, fe) {
  const lang = fe.lang;
  let fnName = null;
  let className = null;
  let p = callNode.parent;
  while (p) {
    if (!fnName && isFnNode(p, lang)) {
      fnName = fnNameOf(p, lang);
      if (lang === 'go' && p.type === 'method_declaration') {
        className = classNameOf(p, lang);
      }
    }
    if (!className && isClassNode(p, lang)) className = classNameOf(p, lang);
    p = p.parent;
  }
  if (className) {
    const ent = (fe.entities || []).find((e) => e.name === className && e.kind !== 'route');
    if (ent) return ent.id;
  }
  if (fnName) {
    const ent = (fe.entities || []).find((e) => e.name === fnName && (e.kind === 'function' || e.kind === 'component'));
    if (ent) return ent.id;
  }
  return 'file:' + fe.file;
}

function parseCallSite(callNode, fe) {
  const lang = fe.lang;
  let parsed;
  let args;
  if (lang === 'python') {
    parsed = parsePyCallee(callNode.childForFieldName('function'));
    args = callNode.childForFieldName('arguments');
  } else if (lang === 'java') {
    parsed = parseJavaCallee(callNode);
    args = callNode.childForFieldName('arguments');
  } else if (lang === 'go') {
    parsed = parseGoCallee(callNode.childForFieldName('function'));
    args = callNode.childForFieldName('arguments');
  } else {
    parsed = parseJsCallee(callNode.childForFieldName('function') || callNode.childForFieldName('constructor'));
    args = callNode.childForFieldName('arguments');
  }
  if (!parsed) return null;
  return {
    callerId: enclosingCaller(callNode, fe),
    object: parsed.object || null,
    callee: parsed.callee || null,
    dynamic: !!parsed.dynamic,
    construct: !!parsed.construct,
    line: callNode.startPosition.row + 1,
    argCount: countArgs(args)
  };
}

const CALL_TYPES = {
  javascript: ['call_expression', 'new_expression'],
  typescript: ['call_expression', 'new_expression'],
  vue: ['call_expression', 'new_expression'],
  svelte: ['call_expression', 'new_expression'],
  python: ['call'],
  java: ['method_invocation', 'object_creation_expression'],
  go: ['call_expression']
};

function walkCalls(node, types, fe, out) {
  if (!node) return;
  if (types.has(node.type)) {
    const site = parseCallSite(node, fe);
    if (site) out.push(site);
  }
  for (let i = 0; i < node.childCount; i++) walkCalls(node.child(i), types, fe, out);
}

/**
 * Collect raw call sites from a file AST. Attached to FileExtract.calls.
 */
function collectCalls(ast, fe) {
  const types = new Set(CALL_TYPES[fe.lang] || CALL_TYPES.javascript);
  const out = [];
  walkCalls(ast, types, fe, out);
  return out;
}

function entityInFile(fe, name) {
  if (!fe || !name) return null;
  return (fe.entities || []).find((e) => e.name === name && e.kind !== 'route') || null;
}

function exportedInFile(fe, localName) {
  if (!fe) return null;
  const exported = (fe.entities || []).filter((e) => e.exported !== false && e.kind !== 'route');
  const byName = exported.find((e) => e.name === localName);
  if (byName) return byName;
  if (exported.length === 1) return exported[0];
  return null;
}

function feByModule(ctx, modulePath) {
  if (!modulePath || !ctx.feByFile) return null;
  const file = ctx.jsModuleToFile && ctx.jsModuleToFile.get(modulePath);
  if (file) return ctx.feByFile.get(file);
  const py = ctx.pyModuleToFile && ctx.pyModuleToFile.get(modulePath);
  if (py) return ctx.feByFile.get(py);
  return ctx.feByFile.get(modulePath) || null;
}

function resolveViaJsImport(site, fe, ctx) {
  const bindings = [];
  for (const imp of fe.imports || []) {
    if (imp.bindings && imp.bindings.length) bindings.push(...imp.bindings.map((b) => ({ imp, ...b })));
    else if (imp.names && imp.names.length) {
      for (const n of imp.names) bindings.push({ imp, local: n, imported: n, namespace: n === '*' });
    }
  }

  const key = site.object || site.callee;
  if (!key) return null;

  for (const b of bindings) {
    if (b.local !== key && !(site.object && b.local === site.object) && !( !site.object && b.local === site.callee)) continue;
    const spec = b.imp.specifier;
    if (!spec || !ctx.resolveJsModule) continue;
    const resolved = ctx.resolveJsModule(spec, fe.file);
    if (!resolved) {
      if (site.object === b.local || site.callee === b.local) {
        return { unresolved: true, reason: 'import-missing' };
      }
      continue;
    }
    const targetFe = ctx.feByFile.get(resolved.file);
    if (b.namespace || (site.object && site.object === b.local)) {
      const ent = entityInFile(targetFe, site.callee) || exportedInFile(targetFe, site.callee);
      if (ent) return { id: ent.id, method: site.object ? site.callee : undefined };
      return { unresolved: true, reason: 'ns-missing' };
    }
    if (b.imported === 'default' || (!site.object && b.local === site.callee)) {
      const ent = entityInFile(targetFe, b.imported === 'default' ? site.callee : (b.imported || site.callee))
        || exportedInFile(targetFe, b.local);
      if (ent) return { id: ent.id };
    }
    if (!site.object && b.local === site.callee) {
      const ent = entityInFile(targetFe, b.imported || site.callee) || exportedInFile(targetFe, site.callee);
      if (ent) return { id: ent.id };
    }
  }
  return null;
}

function resolveViaPyImport(site, fe, ctx) {
  if (!ctx.resolvePyModule) return null;
  const name = site.object || site.callee;
  for (const imp of fe.imports || []) {
    // Skip unresolved / non-string specs (importlib.import_module(var) → specifier:null).
    // Otherwise null === site.object(null) looks like a moduleHit and resolvePyModule throws.
    if (imp.unresolved || imp.specifier == null || typeof imp.specifier !== 'string') continue;
    const names = imp.names || [];
    const hitName = names.includes(site.callee) || names.includes(site.object) || names.includes(name);
    const moduleHit = imp.isModuleImport && (
      imp.specifier === site.object
      || (site.object && imp.specifier.split('.').pop() === site.object)
    );
    if (!hitName && !moduleHit) continue;

    const importedName = names.includes(site.callee) ? site.callee : (names.includes(site.object) ? site.object : null);
    const resolved = ctx.resolvePyModule(imp.specifier, fe, importedName);
    if (!resolved) return { unresolved: true, reason: 'import-missing' };
    const targetFe = ctx.feByFile.get(resolved.file);
    const want = site.object && (hitName || moduleHit) ? site.callee : site.callee;
    const ent = entityInFile(targetFe, want) || exportedInFile(targetFe, want);
    if (ent) return { id: ent.id, method: site.object ? site.callee : undefined };
    if (resolved.kind === 'submodule' && site.object) {
      const inner = entityInFile(targetFe, site.callee);
      if (inner) return { id: inner.id };
    }
    return { unresolved: true, reason: 'py-missing' };
  }
  return null;
}

function resolveViaJavaImport(site, fe, ctx) {
  const name = site.callee;
  if (!name || !ctx.javaFqns) return null;
  if (ctx.javaFqns.has(name)) return { id: name };
  for (const imp of fe.imports || []) {
    if (imp.isWildcard) {
      const candidate = imp.specifier.replace(/\.\*$/, '') + '.' + name;
      if (ctx.javaFqns.has(candidate)) return { id: candidate };
    } else {
      const simple = String(imp.specifier || '').split('.').pop();
      if (simple === name && ctx.javaFqns.has(imp.specifier)) return { id: imp.specifier };
      if (simple === site.object) {
        const cand = imp.specifier;
        if (ctx.javaFqns.has(cand)) return { id: cand, method: site.callee };
      }
    }
  }
  if (fe.module) {
    const cand = fe.module + '.' + name;
    if (ctx.javaFqns.has(cand)) return { id: cand };
  }
  return null;
}

function resolveViaGoImport(site, fe, ctx) {
  if (!site.object || !ctx.resolveGoPackage) return null;
  for (const imp of fe.imports || []) {
    if (imp.isStdlib) continue;
    if (imp.packageName !== site.object && imp.alias !== site.object) continue;
    const resolved = ctx.resolveGoPackage(imp.specifier);
    if (!resolved) return { unresolved: true, reason: 'import-missing' };
    const dir = resolved.dir;
    const id = (dir ? dir + '#' + site.callee : site.callee);
    const targetFe = [...ctx.feByFile.values()].find((f) => f.lang === 'go' && f.module === dir && entityInFile(f, site.callee));
    if (targetFe) {
      const ent = entityInFile(targetFe, site.callee);
      if (ent) return { id: ent.id };
    }
    const ids = ctx.goNameToIds && ctx.goNameToIds.get(site.callee);
    if (ids) {
      const inPkg = ids.filter((x) => x.startsWith(dir + '#') || (dir === '' && !x.includes('/')));
      if (inPkg.length === 1) return { id: inPkg[0] };
    }
    return { id, unresolved: !ctx.nodeIds || !ctx.nodeIds.has(id) };
  }
  return null;
}

function resolveCall(site, fe, ctx) {
  const lang = fe.lang;
  if (site.dynamic) return { unresolved: true, reason: 'dynamic' };
  if (!site.callee) return { unresolved: true, reason: 'dynamic' };

  if (SELF_RECV.has(site.object)) return { skip: true };
  if (skipSet(SKIP_CALLEES, lang).has(site.callee)) return { skip: true };
  if (site.object && skipSet(SKIP_OBJECTS, lang).has(site.object.split('.')[0])) return { skip: true };

  if (!site.object) {
    const local = entityInFile(fe, site.callee);
    if (local && local.id !== site.callerId) return { id: local.id };
    if (local && local.id === site.callerId) return { skip: true };
  }

  let via = null;
  if (lang === 'python') via = resolveViaPyImport(site, fe, ctx);
  else if (lang === 'java') via = resolveViaJavaImport(site, fe, ctx);
  else if (lang === 'go') via = resolveViaGoImport(site, fe, ctx);
  else via = resolveViaJsImport(site, fe, ctx);
  if (via) return via;

  if (!site.object) {
    const map = lang === 'python' ? ctx.pyNameToIds
      : lang === 'go' ? ctx.goNameToIds
        : lang === 'java' ? null
          : ctx.jsNameToIds;
    const ids = map && map.get(site.callee);
    if (ids && ids.length === 1 && ids[0] !== site.callerId) return { id: ids[0] };
  }

  return { skip: true };
}

function changedFilesFromGraphs(base, head) {
  const files = new Set();
  if (!base || !head) return files;
  const baseHash = new Map();
  for (const n of base.nodes || []) {
    if (n.kind === 'file' && n.path) baseHash.set(n.path, n.contentHash || '');
  }
  const headPaths = new Set();
  for (const n of head.nodes || []) {
    if (n.kind !== 'file' || !n.path) continue;
    headPaths.add(n.path);
    if (baseHash.get(n.path) !== (n.contentHash || '')) files.add(n.path);
  }
  for (const p of baseHash.keys()) {
    if (!headPaths.has(p)) files.add(p);
  }
  return files;
}

function reverseImporters(files, graph) {
  const out = new Set(files);
  for (const e of graph.edges || []) {
    if (e.type !== 'import') continue;
    const to = e.to && e.to.startsWith('file:') ? e.to.slice(5) : null;
    if (!to || !files.has(to)) continue;
    const from = e.file || (e.from && e.from.startsWith('file:') ? e.from.slice(5) : null);
    if (from) out.add(from);
  }
  return out;
}

function ensureUnresolvedNode(graph) {
  if (graph.nodes.some((n) => n.id === UNRESOLVED_ID)) return;
  graph.nodes.push({
    id: UNRESOLVED_ID,
    kind: UNRESOLVED_KIND,
    name: 'unresolved-call',
    confidence: 'low'
  });
}

/**
 * Resolve FileExtract.calls into graph edges.
 * @param {object} graph
 * @param {object} [opts]
 * @param {Iterable<string>} [opts.files] only these relative paths
 * @param {boolean} [opts.incremental]
 * @param {object} [opts.base] baseline graph (for incremental file set)
 */
function attachCallEdges(graph, opts) {
  opts = opts || {};
  const ctx = graph._callCtx;
  if (!ctx || !ctx.allFiles) return graph;

  let fileSet = null;
  if (opts.files) fileSet = new Set(opts.files);
  else if (opts.incremental && opts.base) {
    fileSet = reverseImporters(changedFilesFromGraphs(opts.base, graph), graph);
    if (fileSet.size === 0) return graph;
  }

  ctx.nodeIds = new Set((graph.nodes || []).map((n) => n.id));
  const seen = new Set();
  for (const e of graph.edges || []) {
    if (isCallSurfaceEdge(e)) seen.add(`${e.from}|${e.type}|${e.to}|${e.file}|${e.line}`);
  }

  let unresolved = 0;
  for (const fe of ctx.allFiles) {
    if (fileSet && !fileSet.has(fe.file)) continue;
    for (const site of fe.calls || []) {
      const resolved = resolveCall(site, fe, ctx);
      if (resolved.skip) continue;
      if (resolved.unresolved || !resolved.id) {
        ensureUnresolvedNode(graph);
        const key = `${site.callerId}|${UNRESOLVED_EDGE}|${UNRESOLVED_ID}|${fe.file}|${site.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        graph.edges.push({
          from: site.callerId,
          to: UNRESOLVED_ID,
          type: UNRESOLVED_EDGE,
          file: fe.file,
          line: site.line,
          callee: site.callee,
          object: site.object,
          argCount: site.argCount,
          confidence: 'low',
          dynamic: true
        });
        unresolved++;
        continue;
      }
      if (resolved.id === site.callerId) continue;
      const key = `${site.callerId}|${CALL_EDGE}|${resolved.id}|${fe.file}|${site.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      graph.edges.push({
        from: site.callerId,
        to: resolved.id,
        type: CALL_EDGE,
        file: fe.file,
        line: site.line,
        callee: site.callee,
        method: resolved.method || (site.object ? site.callee : undefined),
        argCount: site.argCount,
        confidence: 'high'
      });
    }
  }

  graph.stats = graph.stats || {};
  graph.stats.nodes = graph.nodes.length;
  graph.stats.edges = graph.edges.length;
  graph.stats.callEdges = (graph.edges || []).filter((e) => e.type === CALL_EDGE).length;
  graph.stats.unresolvedCalls = unresolved;
  return graph;
}

function toPersistableGraph(graph) {
  if (!graph || typeof graph !== 'object') return graph;
  const nodes = (graph.nodes || []).filter((n) => !isCallSurfaceNode(n));
  const edges = (graph.edges || []).filter((e) => !isCallSurfaceEdge(e));
  const out = Object.assign({}, graph);
  delete out._callCtx;
  delete out.extracts;
  out.nodes = nodes;
  out.edges = edges;
  out.stats = Object.assign({}, graph.stats || {}, {
    nodes: nodes.length,
    edges: edges.length
  });
  delete out.stats.callEdges;
  delete out.stats.unresolvedCalls;
  return out;
}

module.exports = {
  CALL_EDGE,
  UNRESOLVED_EDGE,
  UNRESOLVED_ID,
  UNRESOLVED_KIND,
  isCallSurfaceNode,
  isCallSurfaceEdge,
  collectCalls,
  attachCallEdges,
  toPersistableGraph,
  changedFilesFromGraphs,
  reverseImporters
};
