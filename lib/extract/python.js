'use strict';

const path = require('path');
const { readSafe, findChildByType, collectNodes } = require('./shared');
const { extractImpl } = require('../impl-surface');
const { extractRoutes } = require('./routes');
const { collectCalls } = require('./call-graph');
const { attachSites } = require('./semantic-sites');

let Parser, PyLang;
try {
  Parser = require('tree-sitter');
  PyLang = require('tree-sitter-python');
} catch (e) { /* optional dep */ }

// Python built-in / typing module types that should not be treated as entity references.
const PY_BUILTIN_TYPES = new Set([
  'str', 'int', 'float', 'bool', 'bytes', 'complex', 'list', 'dict', 'set', 'tuple',
  'frozenset', 'None', 'NoneType', 'Any', 'Optional', 'Union', 'List', 'Dict', 'Set',
  'Tuple', 'FrozenSet', 'Type', 'Callable', 'Iterable', 'Iterator', 'Sequence',
  'Mapping', 'MutableMapping', 'MutableSequence', 'MutableSet', 'Generator',
  'Coroutine', 'AsyncGenerator', 'AsyncIterator', 'AsyncIterable', 'Awaitable',
  'Reversible', 'Collection', 'Sized', 'Hashable', 'TypeVar', 'Generic', 'Protocol',
  'runtime_checkable', 'ClassVar', 'Final', 'Literal', 'TypedDict', 'NamedTuple',
  'dataclass', 'overload', 'abstractmethod', 'property', 'staticmethod', 'classmethod',
  'object', 'type', 'Exception', 'ValueError', 'TypeError', 'KeyError', 'RuntimeError',
  'NotImplementedError', 'self', 'cls', 'NoReturn', 'Never', 'Self', 'Unknown',
  'Text', 'Pattern', 'Match', 'Deque', 'DefaultDict', 'OrderedDict', 'Counter',
  'ChainMap', 'AbstractSet', 'ByteString', 'Container', 'ItemsView', 'KeysView',
  'ValuesView', 'ContextManager', 'AsyncContextManager', 'SupportsInt', 'SupportsFloat'
]);

/**
 * Convert a file path to a Python module path.
 * domain/order.py -> domain/order
 * domain/__init__.py -> domain
 */
function filePathToModule(relPath) {
  let p = relPath.replace(/\\/g, '/').replace(/\.pyi?$/i, '');
  if (p.endsWith('/__init__') || p === '__init__') {
    p = p.replace(/\/?__init__$/, '');
  }
  return p;
}

/**
 * Convert a Python dotted module name to a relative file path.
 * domain.order -> domain/order
 */
function dottedToPath(dotted) {
  return dotted.replace(/\./g, '/');
}

/**
 * Extract type identifiers from a Python type annotation node.
 * Recursively unwraps generic types (Optional[Order], dict[K, V]), unions, etc.
 */
function extractPyTypeNames(node, out) {
  const result = out || [];
  if (!node) return result;
  switch (node.type) {
    case 'type':
    case 'type_parameter':
    case 'parenthesized_type':
    case 'list_type':
    case 'set_type':
    case 'tuple_type':
    case 'dictionary_type':
      for (let i = 0; i < node.childCount; i++) extractPyTypeNames(node.child(i), result);
      return result;
    case 'generic_type': {
      // generic_type: identifier + type_parameter
      // e.g. Optional[Order], List[Order], dict[OrderId, Order]
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        extractPyTypeNames(child, result);
      }
      return result;
    }
    case 'union_type':
    case 'intersection':
      for (let i = 0; i < node.childCount; i++) extractPyTypeNames(node.child(i), result);
      return result;
    case 'identifier':
      if (!PY_BUILTIN_TYPES.has(node.text)) result.push(node.text);
      return result;
    case 'attribute':
      {
        const name = node.text.replace(/\s+/g, '');
        if (!/^typing\./.test(name) || !PY_BUILTIN_TYPES.has(name.slice(7))) {
          result.push(name);
        }
      }
      return result;
    case 'none':
    case 'ellipsis':
      return result;
    case 'string':
      // Forward reference as string: "Order"
      {
        const inner = node.text.replace(/^['"]|['"]$/g, '');
        if (inner && !PY_BUILTIN_TYPES.has(inner)) result.push(inner);
      }
      return result;
    default:
      // Recurse into unknown nodes
      for (let i = 0; i < node.childCount; i++) extractPyTypeNames(node.child(i), result);
      return result;
  }
}

/** Extract parameter type hints from a parameters node. */
function extractPyParams(paramsNode) {
  const params = [];
  if (!paramsNode) return params;
  for (let i = 0; i < paramsNode.childCount; i++) {
    const p = paramsNode.child(i);
    if (p.type !== 'typed_parameter' && p.type !== 'typed_default_parameter' &&
        p.type !== 'default_parameter' && p.type !== 'identifier') continue;
    let name = null;
    let typeNode = null;
    if (p.type === 'identifier') {
      name = p.text;
    } else {
      const nameNode = p.childForFieldName('name');
      name = nameNode ? nameNode.text : '?';
      typeNode = p.childForFieldName('type');
    }
    // Skip self/cls
    if (name === 'self' || name === 'cls') continue;
    const types = [];
    if (typeNode) extractPyTypeNames(typeNode, types);
    const optional = p.type === 'default_parameter' || p.type === 'typed_default_parameter';
    params.push({ name, types, optional });
  }
  return params;
}

/** Extract return type names. */
function extractPyReturnType(returnTypeNode) {
  if (!returnTypeNode) return [];
  const types = [];
  extractPyTypeNames(returnTypeNode, types);
  return types;
}

/** Extract superclass names from a class definition. */
function extractSuperclasses(classNode) {
  const supers = [];
  // Superclasses are in argument_list after the class name
  const argList = findChildByType(classNode, 'argument_list');
  if (argList) {
    for (let i = 0; i < argList.childCount; i++) {
      const arg = argList.child(i);
      if (arg.type === 'identifier') {
        supers.push(arg.text);
      } else if (arg.type === 'attribute') {
        supers.push(arg.text.replace(/\s+/g, ''));
      } else if (arg.type === 'keyword_argument') {
        // e.g. metaclass=ABCMeta
        const val = arg.childForFieldName('value');
        if (val && val.type === 'identifier') supers.push(val.text);
      }
    }
  }
  return supers;
}

/** Extract class field type annotations from class body and __init__. */
function extractClassFields(classNode) {
  const fields = [];
  const body = classNode.childForFieldName('body');
  if (!body) return fields;
  const assignments = collectNodes(body, 'assignment');
  for (const a of assignments) {
    const typeNode = a.childForFieldName('type');
    if (!typeNode) continue;
    const left = a.childForFieldName('left');
    if (!left) continue;

    // Determine context: is this assignment inside a method?
    let parent = a.parent;
    let enclosingMethod = null;
    while (parent && parent.type !== 'class_definition') {
      if (parent.type === 'function_definition') {
        const nameNode = parent.childForFieldName('name');
        enclosingMethod = nameNode ? nameNode.text : null;
        break;
      }
      parent = parent.parent;
    }

    let fieldName = null;
    if (left.type === 'attribute') {
      // self.repo: Repository — only valid inside __init__
      if (enclosingMethod !== '__init__') continue;
      const obj = left.childForFieldName('object');
      if (!obj || obj.text !== 'self') continue;
      const attr = left.childForFieldName('attribute');
      if (attr) fieldName = attr.text;
    } else if (left.type === 'identifier') {
      // Class-level annotation: x: int = 0 — only if NOT inside a method
      if (enclosingMethod) continue;
      fieldName = left.text;
    }
    if (!fieldName) continue;
    const types = [];
    extractPyTypeNames(typeNode, types);
    if (types.length > 0) {
      fields.push({ field: fieldName, types, line: a.startPosition.row + 1 });
    }
  }
  return fields;
}

/** Extract methods from a class body. */
function extractPyMethods(classNode, entityIdBase) {
  const methods = [];
  const methodTypes = [];
  const body = classNode.childForFieldName('body');
  if (!body) return { methods, methodTypes };
  const funcDefs = collectNodes(body, 'function_definition');
  for (const fn of funcDefs) {
    // Only direct children of the class body (not nested functions)
    // Walk up through block and decorated_definition wrappers to check we land on class_definition
    let p = fn.parent;
    while (p && (p.type === 'block' || p.type === 'decorated_definition')) p = p.parent;
    if (!p || p.type !== 'class_definition') continue;
    const nameNode = fn.childForFieldName('name');
    const methodName = nameNode ? nameNode.text : '?';
    const params = fn.childForFieldName('parameters');
    const retType = fn.childForFieldName('return_type');
    const ptypes = extractPyParams(params);
    const paramTypes = [];
    for (const p of ptypes) paramTypes.push(...p.types);
    const returnTypes = extractPyReturnType(retType);
    methods.push({
      kind: 'method',
      name: methodName,
      line: fn.startPosition.row + 1,
      params: ptypes.length,
      impl: extractImpl(fn) || undefined
    });
    methodTypes.push({
      method: methodName,
      paramCount: ptypes.length,
      paramTypes,
      returnTypes,
      optionalParams: ptypes.filter((p) => p.optional).length,
      line: fn.startPosition.row + 1
    });
  }
  return { methods, methodTypes };
}

function parseFile(filePath) {
  const source = readSafe(filePath);
  if (source == null) return { source: null, ast: null, error: 'read failed' };
  if (!Parser || !PyLang) return { source, ast: null, error: 'tree-sitter not available' };
  try {
    const parser = new Parser();
    parser.setLanguage(PyLang);
    const tree = parser.parse(source);
    return {
      source,
      ast: tree.rootNode,
      error: tree.rootNode.hasError ? 'Python syntax error (partial AST retained)' : null
    };
  } catch (e) {
    return { source, ast: null, error: e.message };
  }
}

function extractFile(filePath, root) {
  const relPath = path.relative(root, filePath).replace(/\\/g, '/');
  const { ast, error } = parseFile(filePath);
  const modulePath = filePathToModule(relPath);
  const isInit = /(?:^|\/)__init__\.pyi?$/i.test(relPath);

  const result = {
    file: relPath,
    lang: 'python',
    module: modulePath,
    // __init__.py 的 module 已是包路径；相对导入 from .x 必须以本包为 base
    package: isInit
      ? modulePath.replace(/\//g, '.')
      : (modulePath.includes('/') ? modulePath.split('/').slice(0, -1).join('.') : ''),
    imports: [],
    entities: [],
    error
  };

  if (!ast) return result;

  const entityBase = modulePath;

  const importNodes = [
    ...collectNodes(ast, 'import_from_statement'),
    ...collectNodes(ast, 'import_statement')
  ].sort((a, b) => a.startIndex - b.startIndex);
  const topLevel = ast.namedChildren.filter((node) =>
    node.type !== 'import_from_statement' && node.type !== 'import_statement');
  for (const child of [...importNodes, ...topLevel]) {

    // Unwrap @decorator: decorated_definition wraps class_definition / function_definition
    let defNode = child;
    if (child.type === 'decorated_definition') {
      for (let j = 0; j < child.childCount; j++) {
        const inner = child.child(j);
        if (inner.type === 'class_definition' || inner.type === 'function_definition') {
          defNode = inner;
          break;
        }
      }
    }

    // from module import names
    if (child.type === 'import_from_statement') {
      const moduleNode = child.childForFieldName('module_name');
      const modulePath2 = moduleNode ? moduleNode.text.replace(/\s+/g, '') : '';
      const names = [];
      const aliases = {};
      const bindings = [];
      // name fields are dotted_name nodes
      for (let j = 0; j < child.childCount; j++) {
        const c = child.child(j);
        if (c.type === 'wildcard_import' || c.text === '*') {
          if (!names.includes('*')) names.push('*');
          continue;
        }
        if (c.type === 'aliased_import') {
          const orig = c.childForFieldName('name');
          const alias = c.childForFieldName('alias');
          const imported = orig ? orig.text.trim() : '';
          const local = alias ? alias.text.trim() : imported;
          if (local) {
            names.push(local);
            if (imported) bindings.push({ local, imported, namespace: false });
          }
          if (imported && local && imported !== local) aliases[local] = imported;
          continue;
        }
        if (c.type === 'dotted_name' || c.type === 'identifier') {
          // Skip the module_name node
          if (moduleNode && c.id === moduleNode.id) continue;
          const nameText = c.text.trim();
          if (nameText && nameText !== modulePath2) {
            names.push(nameText);
            bindings.push({ local: nameText, imported: nameText, namespace: false });
          }
        }
      }
      // Check relative import (leading dots)
      const isRelative = /^\.+/.test(modulePath2);
      const relativeLevel = (modulePath2.match(/^(\.+)/) || [''])[0].length;
      result.imports.push({
        ...pyImportContext(child),
        specifier: modulePath2,
        line: child.startPosition.row + 1,
        names,
        aliases: Object.keys(aliases).length ? aliases : undefined,
        bindings: bindings.length ? bindings : undefined,
        isRelative,
        relativeLevel
      });
    }

    // import module  /  import a as b  /  import a, b as c
    if (child.type === 'import_statement') {
      for (let j = 0; j < child.childCount; j++) {
        const c = child.child(j);
        if (c.type === 'aliased_import') {
          const orig = c.childForFieldName('name');
          const alias = c.childForFieldName('alias');
          const moduleName = orig ? orig.text.replace(/\s+/g, '') : '';
          if (!moduleName) continue;
          result.imports.push({
            ...pyImportContext(child),
            specifier: moduleName,
            alias: alias ? alias.text.trim() : null,
            line: child.startPosition.row + 1,
            names: [],
            isModuleImport: true
          });
          continue;
        }
        if (c.type === 'dotted_name' || c.type === 'identifier') {
          const moduleName = c.text.replace(/\s+/g, '');
          if (!moduleName) continue;
          result.imports.push({
            ...pyImportContext(child),
            specifier: moduleName,
            line: child.startPosition.row + 1,
            names: [],
            isModuleImport: true
          });
        }
      }
    }

    // class definition
    if (defNode.type === 'class_definition') {
      const nameNode = defNode.childForFieldName('name');
      const name = nameNode ? nameNode.text : '?';
      const supers = extractSuperclasses(defNode);
      const { methods, methodTypes } = extractPyMethods(defNode, entityBase);
      const fieldTypes = extractClassFields(defNode);
      const isEnum = supers.some((s) => /^(Enum|IntEnum|StrEnum|Flag|IntFlag)$/.test(s));
      const enumMembers = isEnum ? extractPyEnumMembers(defNode) : [];
      result.entities.push({
        kind: isEnum ? 'enum' : 'class',
        name,
        id: entityBase + '#' + name,
        line: defNode.startPosition.row + 1,
        modifiers: [],
        extends: supers,
        implements: [],
        members: isEnum ? enumMembers.concat(methods) : methods,
        methodTypes,
        fieldTypes,
        exported: true
      });
    }

    // top-level function definition
    if (defNode.type === 'function_definition') {
      const nameNode = defNode.childForFieldName('name');
      const name = nameNode ? nameNode.text : '?';
      const params = defNode.childForFieldName('parameters');
      const retType = defNode.childForFieldName('return_type');
      const ptypes = extractPyParams(params);
      const paramTypes = [];
      for (const p of ptypes) paramTypes.push(...p.types);
      const returnTypes = extractPyReturnType(retType);
      const methodTypes = [{
        method: name,
        paramCount: ptypes.length,
        paramTypes,
        returnTypes,
        optionalParams: ptypes.filter((p) => p.optional).length,
        line: defNode.startPosition.row + 1
      }];
      result.entities.push({
        kind: 'function',
        name,
        id: entityBase + '#' + name,
        line: defNode.startPosition.row + 1,
        modifiers: [],
        extends: [],
        implements: [],
        members: [{ kind: 'method', name, params: ptypes.length, line: child.startPosition.row + 1 }],
        methodTypes,
        fieldTypes: [],
        impl: extractImpl(defNode) || undefined,
        exported: true
      });
    }
  }

  extractDynamicPyImports(ast, result.imports);
  result.__all__ = extractPyAll(ast);
  for (const route of extractRoutes(ast, 'python', relPath, modulePath, result.entities)) {
    result.entities.push(route);
  }

  result.calls = collectCalls(ast, result);
  attachSites(result, ast, 'python');
  return result;
}

function extractPyEnumMembers(classNode) {
  const out = [];
  const body = classNode.childForFieldName('body');
  if (!body) return out;
  const assignments = collectNodes(body, 'assignment');
  for (const a of assignments) {
    let p = a.parent;
    let inFn = false;
    while (p && p !== classNode) {
      if (p.type === 'function_definition') { inFn = true; break; }
      p = p.parent;
    }
    if (inFn) continue;
    const left = a.childForFieldName('left');
    if (left && left.type === 'identifier' && left.text !== '__all__') {
      out.push({ kind: 'field', name: left.text, line: a.startPosition.row + 1 });
    }
  }
  return out;
}

function isPyModuleLevel(node) {
  let p = node.parent;
  while (p) {
    if (p.type === 'class_definition' || p.type === 'function_definition') return false;
    if (p.type === 'module') return true;
    p = p.parent;
  }
  return false;
}

function pyImportContext(node) {
  let conditional = false;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'function_definition' || parent.type === 'class_definition') {
      return {
        scope: parent.type === 'function_definition' ? 'function' : 'class',
        scopeStart: parent.startPosition.row + 1,
        scopeEnd: parent.endPosition.row + 1,
        conditional
      };
    }
    if (parent.type === 'module') break;
    if (parent.type !== 'block' && parent.type !== 'decorated_definition') conditional = true;
  }
  return { scope: 'module', conditional };
}

/** Literal `__all__ = ["Alert", "Foo"]` at module level. */
function extractPyAll(ast) {
  const names = [];
  const assigns = collectNodes(ast, 'assignment');
  for (const a of assigns) {
    if (!isPyModuleLevel(a)) continue;
    const left = a.childForFieldName('left');
    if (!left || left.text !== '__all__') continue;
    const right = a.childForFieldName('right');
    if (!right) continue;
    const list = right.type === 'list' ? right : findChildByType(right, 'list');
    if (!list) continue;
    for (let i = 0; i < list.namedChildCount; i++) {
      const el = list.namedChild(i);
      if (el.type === 'string') {
        const s = unquotePyString(el.text);
        if (s) names.push(s);
      }
    }
  }
  return names;
}

function unquotePyString(text) {
  let s = String(text || '').trim();
  s = s.replace(/^[fFrRuUbB]+/, '');
  if ((s.startsWith("'''") && s.endsWith("'''")) || (s.startsWith('"""') && s.endsWith('"""'))) {
    s = s.slice(3, -3);
  } else if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    s = s.slice(1, -1);
  }
  s = s.trim();
  if (!s || /[{}]/.test(s)) return null;
  return s;
}

function isPyModulePath(s) {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(s);
}

function firstCallStringArg(call) {
  const args = call.childForFieldName('arguments');
  const walk = args || call;
  for (let i = 0; i < walk.namedChildCount; i++) {
    const c = walk.namedChild(i);
    const s = staticPyStringExpr(c);
    if (s && isPyModulePath(s)) return s;
  }
  for (let i = 0; i < walk.childCount; i++) {
    const c = walk.child(i);
    if (c.type === 'string' || c.type === 'binary_operator' || c.type === 'concatenated_string') {
      const s = staticPyStringExpr(c);
      if (s && isPyModulePath(s)) return s;
    }
  }
  return null;
}

/** Fold `"a" + ".b"` / concatenated string literals into one static module path. */
function staticPyStringExpr(node) {
  if (!node) return null;
  if (node.type === 'string') return unquotePyString(node.text);
  if (node.type === 'parenthesized_expression' && node.namedChildCount === 1) {
    return staticPyStringExpr(node.namedChild(0));
  }
  if (node.type === 'binary_operator') {
    let op = node.childForFieldName('operator');
    if (!op) {
      for (let i = 0; i < node.childCount; i++) {
        if (node.child(i).text === '+') { op = node.child(i); break; }
      }
    }
    if (!op || op.text !== '+') return null;
    const left = staticPyStringExpr(node.childForFieldName('left') || node.namedChild(0));
    const right = staticPyStringExpr(node.childForFieldName('right') || node.namedChild(1));
    if (left == null || right == null) return null;
    return left + right;
  }
  if (node.type === 'concatenated_string') {
    let out = '';
    for (let i = 0; i < node.namedChildCount; i++) {
      const part = staticPyStringExpr(node.namedChild(i));
      if (part == null) return null;
      out += part;
    }
    return out;
  }
  return null;
}

/** Static-only: importlib.import_module("x") / __import__("a"+".b"). Variables skipped. */
function extractDynamicPyImports(ast, imports) {
  const calls = collectNodes(ast, 'call');
  const seen = new Set();
  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;
    const fnText = fn.text;
    if (fnText !== '__import__' && !/(^|\.)import_module$/.test(fnText)) continue;
    const spec = firstCallStringArg(call);
    const line = call.startPosition.row + 1;
    if (!spec) {
      const key = 'unresolved@' + line;
      if (seen.has(key)) continue;
      seen.add(key);
      imports.push({
        ...pyImportContext(call),
        specifier: null,
        line,
        names: [],
        isModuleImport: true,
        dynamic: true,
        unresolved: true
      });
      continue;
    }
    const key = spec + '@' + line;
    if (seen.has(key)) continue;
    seen.add(key);
    imports.push({
      ...pyImportContext(call),
      specifier: spec,
      line,
      names: [],
      isModuleImport: true,
      dynamic: true
    });
  }
}

module.exports = {
  lang: 'python',
  exts: ['.py', '.pyi'],
  extractFile,
  filePathToModule,
  dottedToPath,
  extractPyTypeNames
};
