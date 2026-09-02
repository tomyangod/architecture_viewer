'use strict';

const path = require('path');
const { readSafe, findChildByType, collectNodes } = require('./shared');

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
  let p = relPath.replace(/\.pyi?$/i, '');
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
        if (child.type === 'identifier') {
          // The generic base name (Optional, List, etc.) - skip if builtin
          // but don't add it as a reference; only inner types matter
          continue;
        }
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
      // e.g. typing.Optional — take the last component if not builtin
      // For qualified names like models.Order, extract "Order"
      {
        const attr = node.childForFieldName('attribute');
        if (attr && attr.type === 'identifier' && !PY_BUILTIN_TYPES.has(attr.text)) {
          result.push(attr.text);
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
    params.push({ name, types });
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
        // e.g. typing.Protocol
        const attr = arg.childForFieldName('attribute');
        if (attr) supers.push(attr.text);
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
    methods.push({ kind: 'method', name: methodName, line: fn.startPosition.row + 1 });
    if (paramTypes.length > 0 || returnTypes.length > 0) {
      methodTypes.push({ method: methodName, paramTypes, returnTypes, line: fn.startPosition.row + 1 });
    }
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
    return { source, ast: tree.rootNode, error: null };
  } catch (e) {
    return { source, ast: null, error: e.message };
  }
}

function extractFile(filePath, root) {
  const relPath = path.relative(root, filePath);
  const { ast, error } = parseFile(filePath);
  const modulePath = filePathToModule(relPath);

  const result = {
    file: relPath,
    lang: 'python',
    module: modulePath,
    package: modulePath.includes('/') ? modulePath.split('/').slice(0, -1).join('.') : '',
    imports: [],
    entities: [],
    error
  };

  if (!ast) return result;

  const entityBase = modulePath;

  for (let i = 0; i < ast.childCount; i++) {
    const child = ast.child(i);

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
      // name fields are dotted_name nodes
      for (let j = 0; j < child.childCount; j++) {
        const c = child.child(j);
        if (c.type === 'dotted_name' || c.type === 'identifier') {
          // Skip the module_name node
          if (c === moduleNode) continue;
          const nameText = c.text.trim();
          if (nameText && nameText !== modulePath2) names.push(nameText);
        }
      }
      // Check relative import (leading dots)
      const isRelative = /^\.+/.test(child.text);
      const relativeLevel = (child.text.match(/^(\.+)/) || [''])[0].length;
      result.imports.push({
        specifier: modulePath2,
        line: child.startPosition.row + 1,
        names,
        isRelative,
        relativeLevel
      });
    }

    // import module
    if (child.type === 'import_statement') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) {
        result.imports.push({
          specifier: nameNode.text.replace(/\s+/g, ''),
          line: child.startPosition.row + 1,
          names: [],
          isModuleImport: true
        });
      }
    }

    // class definition
    if (defNode.type === 'class_definition') {
      const nameNode = defNode.childForFieldName('name');
      const name = nameNode ? nameNode.text : '?';
      const supers = extractSuperclasses(defNode);
      const { methods, methodTypes } = extractPyMethods(defNode, entityBase);
      const fieldTypes = extractClassFields(defNode);
      result.entities.push({
        kind: 'class',
        name,
        id: entityBase + '#' + name,
        line: defNode.startPosition.row + 1,
        modifiers: [],
        extends: supers,
        implements: [],
        members: methods,
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
      const methodTypes = [];
      if (paramTypes.length > 0 || returnTypes.length > 0) {
        methodTypes.push({ method: name, paramTypes, returnTypes, line: defNode.startPosition.row + 1 });
      }
      result.entities.push({
        kind: 'function',
        name,
        id: entityBase + '#' + name,
        line: defNode.startPosition.row + 1,
        modifiers: [],
        extends: [],
        implements: [],
        members: [{ kind: 'method', name, line: child.startPosition.row + 1 }],
        methodTypes,
        fieldTypes: [],
        exported: true
      });
    }
  }

  return result;
}

module.exports = {
  lang: 'python',
  exts: ['.py', '.pyi'],
  extractFile,
  filePathToModule,
  dottedToPath,
  extractPyTypeNames
};
