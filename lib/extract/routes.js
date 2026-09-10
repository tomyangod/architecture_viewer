'use strict';

/**
 * Static HTTP route surface (Flask / FastAPI / Express-style).
 * Only literal method + path; dynamic path expressions are skipped.
 */

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']);
const PY_ROUTER_CTORS = new Set(['Blueprint', 'APIRouter', 'Flask', 'FastAPI']);
const PY_ROUTE_ATTRS = new Set(['route', 'api_route', ...HTTP_METHODS]);

function unquote(text) {
  let s = String(text || '').trim();
  s = s.replace(/^[fFrRuUbB]+/, '');
  if ((s.startsWith("'''") && s.endsWith("'''")) || (s.startsWith('"""') && s.endsWith('"""'))) {
    s = s.slice(3, -3);
  } else if ((s.startsWith("'") && s.endsWith("'")) ||
             (s.startsWith('"') && s.endsWith('"')) ||
             (s.startsWith('`') && s.endsWith('`'))) {
    s = s.slice(1, -1);
  }
  s = s.trim();
  if (!s && s !== '') return null;
  if (/\$\{|\{[^}]*\}/.test(s) && !/^\/.*<.*>/.test(s)) {
    // JS template interpolation — skip. Flask `<int:id>` is fine.
    if (s.includes('${')) return null;
  }
  return s;
}

function staticString(node) {
  if (!node) return null;
  if (node.type === 'string' || node.type === 'string_fragment') {
    return node.type === 'string_fragment' ? node.text : unquote(node.text);
  }
  if (node.type === 'template_string' || node.type === 'template_literal') {
    if (/\$\{/.test(node.text)) return null;
    return node.text.replace(/^`|`$/g, '');
  }
  if (node.type === 'concatenated_string' || node.type === 'parenthesized_expression') {
    if (node.namedChildCount === 1) return staticString(node.namedChild(0));
  }
  return null;
}

function normalizePath(prefix, sub) {
  const a = String(prefix || '').trim();
  let b = String(sub == null ? '' : sub).trim();
  if (b === '') b = '';
  let p;
  if (!a && !b) p = '/';
  else if (!b) p = a || '/';
  else if (!a) p = b.startsWith('/') ? b : '/' + b;
  else p = a.replace(/\/$/, '') + (b.startsWith('/') ? b : '/' + b);
  if (!p.startsWith('/')) p = '/' + p;
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function routeEntity(file, method, routePath, line, extra) {
  const methodU = String(method || 'GET').toUpperCase();
  const pathN = normalizePath('', routePath);
  const name = methodU + ' ' + pathN;
  return {
    kind: 'route',
    name,
    id: 'route:' + file + ':' + name,
    line,
    method: methodU,
    routePath: pathN,
    exported: true,
    members: [],
    extends: [],
    implements: [],
    modifiers: [],
    fieldTypes: [],
    methodTypes: [],
    ...extra
  };
}

function firstPositionalString(argsNode) {
  if (!argsNode) return null;
  for (let i = 0; i < argsNode.namedChildCount; i++) {
    const c = argsNode.namedChild(i);
    if (c.type === 'keyword_argument') continue;
    const s = staticString(c);
    if (s != null) return s;
  }
  return null;
}

function keywordListStrings(argsNode, key) {
  if (!argsNode) return [];
  for (let i = 0; i < argsNode.namedChildCount; i++) {
    const c = argsNode.namedChild(i);
    if (c.type !== 'keyword_argument') continue;
    const name = c.childForFieldName('name');
    if (!name || name.text !== key) continue;
    const val = c.childForFieldName('value');
    if (!val) return [];
    const out = [];
    const list = val.type === 'list' ? val : null;
    if (list) {
      for (let j = 0; j < list.namedChildCount; j++) {
        const s = staticString(list.namedChild(j));
        if (s) out.push(s.toLowerCase());
      }
    }
    return out;
  }
  return [];
}

function keywordString(argsNode, key) {
  if (!argsNode) return null;
  for (let i = 0; i < argsNode.namedChildCount; i++) {
    const c = argsNode.namedChild(i);
    if (c.type !== 'keyword_argument') continue;
    const name = c.childForFieldName('name');
    if (!name || name.text !== key) continue;
    return staticString(c.childForFieldName('value'));
  }
  return null;
}

function pyCallName(call) {
  const fn = call.childForFieldName('function');
  if (!fn) return { object: null, attr: null };
  if (fn.type === 'identifier') return { object: null, attr: fn.text };
  if (fn.type === 'attribute') {
    const obj = fn.childForFieldName('object');
    const attr = fn.childForFieldName('attribute');
    return { object: obj ? obj.text : null, attr: attr ? attr.text : null };
  }
  return { object: null, attr: fn.text };
}

function collectPyPrefixes(ast) {
  const prefixes = new Map();
  const assigns = [];
  (function walk(node) {
    if (node.type === 'assignment' || node.type === 'augmented_assignment') assigns.push(node);
    for (let i = 0; i < node.childCount; i++) walk(node.child(i));
  })(ast);
  for (const a of assigns) {
    const left = a.childForFieldName('left');
    const right = a.childForFieldName('right');
    if (!left || !right || left.type !== 'identifier' || right.type !== 'call') continue;
    const { attr } = pyCallName(right);
    if (!PY_ROUTER_CTORS.has(attr)) continue;
    const args = right.childForFieldName('arguments');
    const prefix = keywordString(args, 'url_prefix') || keywordString(args, 'prefix') || '';
    prefixes.set(left.text, { prefix: prefix || '', framework: attr === 'APIRouter' || attr === 'FastAPI' ? 'fastapi' : 'flask' });
  }
  return prefixes;
}

function extractPythonRoutes(ast, file, modulePath, entities) {
  const routes = [];
  if (!ast) return routes;
  const prefixes = collectPyPrefixes(ast);
  const entityByName = new Map();
  for (const e of entities || []) {
    if (e.kind === 'function') entityByName.set(e.name, e.id);
  }

  const decorated = [];
  (function walk(node) {
    if (node.type === 'decorated_definition') decorated.push(node);
    for (let i = 0; i < node.childCount; i++) walk(node.child(i));
  })(ast);

  for (const dec of decorated) {
    let fnNode = null;
    for (let i = 0; i < dec.childCount; i++) {
      const c = dec.child(i);
      if (c.type === 'function_definition') { fnNode = c; break; }
    }
    if (!fnNode) continue;
    // Only module-level handlers (skip methods for P0)
    let p = fnNode.parent;
    let nested = false;
    while (p && p.type !== 'module') {
      if (p.type === 'class_definition') { nested = true; break; }
      p = p.parent;
    }
    if (nested) continue;
    const fnName = fnNode.childForFieldName('name');
    const handlerName = fnName ? fnName.text : null;
    const handlerId = handlerName && entityByName.has(handlerName) ? entityByName.get(handlerName) : (modulePath + '#' + handlerName);

    for (let i = 0; i < dec.childCount; i++) {
      const d = dec.child(i);
      if (d.type !== 'decorator') continue;
      let call = null;
      for (let j = 0; j < d.childCount; j++) {
        if (d.child(j).type === 'call') { call = d.child(j); break; }
      }
      if (!call) continue;
      const { object, attr } = pyCallName(call);
      if (!attr || !PY_ROUTE_ATTRS.has(attr.toLowerCase())) continue;
      const args = call.childForFieldName('arguments');
      const rawPath = firstPositionalString(args);
      if (rawPath == null) continue;
      const prefix = object && prefixes.has(object) ? prefixes.get(object).prefix : '';
      const framework = object && prefixes.has(object) ? prefixes.get(object).framework : (attr === 'api_route' ? 'fastapi' : 'flask');
      const fullPath = normalizePath(prefix, rawPath);
      let methods;
      if (attr.toLowerCase() === 'route' || attr.toLowerCase() === 'api_route') {
        const listed = keywordListStrings(args, 'methods');
        methods = listed.length ? listed : ['get'];
      } else {
        methods = [attr.toLowerCase()];
      }
      const line = d.startPosition.row + 1;
      for (const m of methods) {
        if (m !== 'all' && !HTTP_METHODS.has(m)) continue;
        routes.push(routeEntity(file, m === 'all' ? 'ALL' : m, fullPath, line, {
          handlerName,
          handlerId,
          framework
        }));
      }
    }
  }
  return routes;
}

function jsCallee(call) {
  const fn = call.childForFieldName('function');
  if (!fn) return { object: null, attr: null };
  if (fn.type === 'identifier') return { object: null, attr: fn.text };
  if (fn.type === 'member_expression' || fn.type === 'member_access_expression') {
    const obj = fn.childForFieldName('object');
    const prop = fn.childForFieldName('property') || fn.childForFieldName('name');
    return { object: obj ? obj.text : null, attr: prop ? prop.text : null };
  }
  return { object: null, attr: fn.text && fn.text.includes('.') ? fn.text.split('.').pop() : fn.text };
}

function lastIdentifierArg(argsNode) {
  if (!argsNode) return null;
  let last = null;
  for (let i = 0; i < argsNode.namedChildCount; i++) {
    const c = argsNode.namedChild(i);
    if (c.type === 'identifier') last = c.text;
  }
  return last;
}

function isLikelyJsRouter(objectText, file) {
  const o = String(objectText || '');
  if (/\b(app|router|server|express)\b/i.test(o)) return true;
  return /(^|\/)(routes?|routers?|controllers?|api)\//i.test(String(file || '').replace(/\\/g, '/'));
}

function extractJsRoutes(ast, file, modulePath, entities) {
  const routes = [];
  if (!ast) return routes;
  const entityByName = new Map();
  for (const e of entities || []) {
    if (e.kind === 'function' || e.kind === 'component') entityByName.set(e.name, e.id);
  }
  const calls = [];
  (function walk(node) {
    if (node.type === 'call_expression') calls.push(node);
    for (let i = 0; i < node.childCount; i++) walk(node.child(i));
  })(ast);

  for (const call of calls) {
    const { object, attr } = jsCallee(call);
    if (!attr || !HTTP_METHODS.has(attr.toLowerCase())) continue;
    if (!isLikelyJsRouter(object, file)) continue;
    const args = call.childForFieldName('arguments');
    const rawPath = firstPositionalString(args);
    if (rawPath == null || rawPath === '') continue;
    if (!rawPath.startsWith('/') && rawPath !== '*') continue;
    const handlerName = lastIdentifierArg(args);
    const handlerId = handlerName && entityByName.has(handlerName)
      ? entityByName.get(handlerName)
      : (handlerName ? modulePath + '#' + handlerName : null);
    routes.push(routeEntity(file, attr, rawPath, call.startPosition.row + 1, {
      handlerName,
      handlerId,
      framework: 'express'
    }));
  }
  return routes;
}

function extractRoutes(ast, lang, file, modulePath, entities) {
  if (lang === 'python') return extractPythonRoutes(ast, file, modulePath, entities);
  if (lang === 'javascript' || lang === 'typescript') {
    return extractJsRoutes(ast, file, modulePath, entities);
  }
  return [];
}

module.exports = {
  extractRoutes,
  extractPythonRoutes,
  extractJsRoutes,
  normalizePath,
  HTTP_METHODS
};
