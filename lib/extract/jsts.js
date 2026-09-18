'use strict';

const path = require('path');
const { readSafe, findChildByType, collectNodes } = require('./shared');
const { extractModuleDiDependencies, classNameFromDecl } = require('./jsts-di');
const { extractRoutes } = require('./routes');
const { extractImpl } = require('../impl-surface');
const { collectCalls } = require('./call-graph');
const { attachSites } = require('./semantic-sites');

let Parser, JSLang, TSPkg;
try {
  Parser = require('tree-sitter');
  JSLang = require('tree-sitter-javascript');
  TSPkg = require('tree-sitter-typescript');
} catch (e) { /* optional dep */ }

// Node.js built-in modules (common set).
const NODE_BUILTINS = new Set([
  'fs', 'path', 'os', 'http', 'https', 'crypto', 'stream', 'events', 'util',
  'url', 'querystring', 'zlib', 'net', 'tls', 'dns', 'dgram', 'child_process',
  'cluster', 'process', 'buffer', 'assert', 'console', 'constants', 'module',
  'readline', 'repl', 'string_decoder', 'timers', 'tty', 'v8', 'vm', 'worker_threads',
  'perf_hooks', 'async_hooks', 'http2', 'inspector', 'punycode', 'sys'
]);

function getParser(lang, ext) {
  if (!Parser) return null;
  const p = new Parser();
  if (lang === 'typescript') {
    // Use TSX parser for .tsx files (supports JSX syntax), regular TS parser for .ts
    if (ext === '.tsx' || ext === '.mtsx' || ext === '.ctsx') {
      const tsx = (TSPkg && (TSPkg.tsx || (TSPkg.default && TSPkg.default.tsx)));
      p.setLanguage(tsx || TSPkg.typescript);
    } else {
      const ts = (TSPkg && (TSPkg.typescript || (TSPkg.default && TSPkg.default.typescript))) || TSPkg;
      p.setLanguage(ts);
    }
  } else {
    p.setLanguage(JSLang);
  }
  return p;
}

/** Strip surrounding quotes from a string node's source text. */
function unquote(text) {
  if (!text) return text;
  return text.replace(/^['"`]|['"`]$/g, '');
}

/** Extract the module specifier from an import_statement / export_statement source. */
function getImportSpecifier(node) {
  const source = node.childForFieldName('source');
  if (!source) return null;
  // source is a `string` node; string_fragment holds the raw module path.
  const frag = findChildByType(source, 'string_fragment');
  return frag ? frag.text : unquote(source.text);
}

/** Pull named import identifiers out of an import_clause. */
function getImportedBindings(importClause) {
  const bindings = [];
  if (!importClause) return bindings;
  const defaultId = importClause.childForFieldName('name');
  if (defaultId && defaultId.type === 'identifier') {
    bindings.push({ local: defaultId.text, imported: 'default', namespace: false });
  }
  const ns = findChildByType(importClause, 'namespace_import');
  if (ns) {
    const id = findChildByType(ns, 'identifier');
    if (id) bindings.push({ local: id.text, imported: '*', namespace: true });
  }
  const named = findChildByType(importClause, 'named_imports')
    || findChildByType(importClause, 'named_exports')
    || findChildByType(importClause, 'export_clause');
  if (named) {
    for (let i = 0; i < named.childCount; i++) {
      const spec = named.child(i);
      if (spec.type === 'import_specifier' || spec.type === 'export_specifier') {
        const alias = spec.childForFieldName('alias');
        const id = spec.childForFieldName('name');
        if (id) {
          bindings.push({
            local: (alias || id).text,
            imported: id.text,
            namespace: false
          });
        }
      }
    }
  }
  return bindings;
}

function getImportedNames(importClause) {
  return getImportedBindings(importClause).map((b) => b.local);
}

function getReexportNames(exportStmt) {
  const names = getImportedNames(exportStmt);
  if (names.length) return names;
  const specs = collectNodes(exportStmt, 'export_specifier');
  for (const spec of specs) {
    const alias = spec.childForFieldName('alias');
    const id = spec.childForFieldName('name');
    const n = alias || id;
    if (n) names.push(n.text);
  }
  return names;
}

// JS/TS built-in / primitive types that should not be treated as entity references.
const BUILTIN_TYPES = new Set([
  'string', 'number', 'boolean', 'void', 'any', 'unknown', 'never', 'null',
  'undefined', 'bigint', 'symbol', 'object', 'Date', 'Error', 'Array',
  'Map', 'Set', 'Promise', 'Record', 'Partial', 'Pick', 'Omit', 'Readonly',
  'Exclude', 'Extract', 'NonNullable', 'Parameters', 'ReturnType', 'Awaited',
  'InstanceType', 'ConstructorParameters', 'ThisParameterType', 'OmitThisParameter',
  'ThisType', 'Uppercase', 'Lowercase', 'Capitalize', 'Uncapitalize', 'RegExp',
  'Math', 'JSON', 'Number', 'String', 'Boolean', 'BigInt', 'Symbol', 'Object',
  'Function', 'WeakMap', 'WeakSet', 'TypedArray', 'ArrayBuffer', 'DataView',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array',
  'BigUint64Array', 'Iterator', 'AsyncIterator', 'Iterable', 'AsyncIterable',
  'Generator', 'AsyncGenerator', 'Buffer'
]);

/**
 * Extract meaningful type identifiers from a type annotation / type expression node.
 * Recursively unwraps generics, unions, intersections, arrays, parenthesized types.
 * Skips built-in / primitive types. Returns an array of simple type names.
 */
function extractTypeNames(typeNode, out) {
  const result = out || [];
  if (!typeNode) return result;
  switch (typeNode.type) {
    case 'type_annotation':
    case 'type_arguments':
    case 'parenthesized_type':
    case 'non_null_expression':
      for (let i = 0; i < typeNode.childCount; i++) extractTypeNames(typeNode.child(i), result);
      return result;
    case 'union_type':
    case 'intersection_type':
    case 'tuple_type':
    case 'object_type':
    case 'type_parameter':
      for (let i = 0; i < typeNode.childCount; i++) extractTypeNames(typeNode.child(i), result);
      return result;
    case 'generic_type': {
      const nameNode = typeNode.childForFieldName('name');
      if (nameNode && nameNode.type === 'type_identifier' && !BUILTIN_TYPES.has(nameNode.text)) {
        result.push(nameNode.text);
      }
      const targs = typeNode.childForFieldName('type_arguments');
      if (targs) extractTypeNames(targs, result);
      return result;
    }
    case 'type_identifier':
      if (!BUILTIN_TYPES.has(typeNode.text)) result.push(typeNode.text);
      return result;
    case 'array_type':
    case 'readonly_type':
    case 'type_predicate':
    case 'conditional_type':
    case 'infer_type':
    case 'mapped_type':
    case 'template_literal_type':
    case 'rest_type':
    case 'optional_type':
    case 'function_type':
    case 'constructor_type':
      for (let i = 0; i < typeNode.childCount; i++) extractTypeNames(typeNode.child(i), result);
      return result;
    default:
      // Recurse into unknown container nodes (formal_parameters, required_parameter, etc.)
      for (let i = 0; i < typeNode.childCount; i++) extractTypeNames(typeNode.child(i), result);
      return result;
  }
}

/**
 * Extract parameter type names from a formal_parameters node.
 * Returns [{ name, types: string[] }]
 */
function extractParamTypes(paramsNode) {
  const params = [];
  if (!paramsNode) return params;
  for (let i = 0; i < paramsNode.childCount; i++) {
    const p = paramsNode.child(i);
    if (p.type === 'required_parameter' || p.type === 'optional_parameter' || p.type === 'rest_parameter') {
      const pattern = p.childForFieldName('pattern');
      const name = pattern ? pattern.text : '?';
      const typeAnn = p.childForFieldName('type');
      const types = [];
      if (typeAnn) extractTypeNames(typeAnn, types);
      params.push({
        name,
        types,
        optional: p.type === 'optional_parameter' || p.type === 'rest_parameter',
        rest: p.type === 'rest_parameter'
      });
      continue;
    }
    if (p.type === 'identifier') {
      params.push({ name: p.text, types: [], optional: false, rest: false });
    }
  }
  return params;
}

function methodTypeFromParams(methodName, paramsNode, retType, line) {
  const ptypes = extractParamTypes(paramsNode);
  const paramTypes = [];
  for (const p of ptypes) paramTypes.push(...p.types);
  return {
    method: methodName,
    paramCount: ptypes.length,
    paramTypes,
    returnTypes: extractReturnTypes(retType),
    optionalParams: ptypes.filter((p) => p.optional).length,
    line
  };
}

/** Extract return type names from a return type annotation node. */
function extractReturnTypes(returnTypeNode) {
  if (!returnTypeNode) return [];
  const types = [];
  extractTypeNames(returnTypeNode, types);
  return types;
}

function isExported(node) {
  // entity nodes are wrapped in export_statement when exported
  return node.parent && node.parent.type === 'export_statement';
}

/** Extract superclass and interfaces from a class_heritage node. */
function getHeritage(classNode) {
  const heritage = findChildByType(classNode, 'class_heritage');
  const extends_ = [];
  const implements_ = [];
  if (!heritage) return { extends: extends_, implements: implements_ };

  for (let i = 0; i < heritage.childCount; i++) {
    const c = heritage.child(i);
    if (c.type === 'extends_clause') {
      // value field holds the type expression
      const val = c.childForFieldName('value');
      if (val) {
        const name = simpleTypeName(val);
        if (name) extends_.push(name);
      }
    } else if (c.type === 'implements_clause') {
      // iterate type identifiers directly
      for (let j = 0; j < c.childCount; j++) {
        const t = c.child(j);
        if (t.type === 'type_identifier' || t.type === 'type_arguments') {
          if (t.type === 'type_identifier') implements_.push(t.text);
        }
      }
    } else if (c.type === 'identifier' || c.type === 'type_identifier') {
      // Bare `extends Base` (JS): heritage directly contains identifier after `extends` keyword
      extends_.push(c.text);
    }
  }
  return { extends: extends_, implements: implements_ };
}

/** Reduce a type expression node to its base name (strip generics). */
function simpleTypeName(node) {
  if (!node) return null;
  if (node.type === 'identifier' || node.type === 'type_identifier') return node.text;
  if (node.type === 'new_expression' || node.type === 'member_expression') {
    const prop = node.childForFieldName('property');
    if (prop) return prop.text;
    const obj = node.childForFieldName('object');
    return simpleTypeName(obj);
  }
  if (node.type === 'generic_type') {
    const t = node.childForFieldName('type');
    return t ? simpleTypeName(t) : node.text;
  }
  return node.text.split(/[<(]/)[0].trim();
}

function getClassName(classNode) {
  const nameNode = classNode.childForFieldName('name');
  return nameNode ? nameNode.text : '<anonymous>';
}

function extractClass(classNode, entityIdBase, exported) {
  const name = getClassName(classNode);
  const { extends: ext, implements: impl } = getHeritage(classNode);
  const members = [];
  const methodTypes = []; // { method, paramTypes: string[], returnTypes: string[], line }
  const fieldTypes = [];  // { field, types: string[], line }

  const body = classNode.childForFieldName('body') || findChildByType(classNode, 'class_body');
  if (body) {
    for (let i = 0; i < body.childCount; i++) {
      const m = body.child(i);
      if (m.type === 'method_definition') {
        const n = m.childForFieldName('name');
        const params = m.childForFieldName('parameters');
        const retType = m.childForFieldName('return_type');
        const methodName = n ? n.text : '?';
        const mt = methodTypeFromParams(methodName, params, retType, m.startPosition.row + 1);
        members.push({
          kind: 'method',
          name: methodName,
          line: m.startPosition.row + 1,
          params: mt.paramCount,
          impl: extractImpl(m) || undefined
        });
        methodTypes.push(mt);
      } else if (m.type === 'public_field_definition' || m.type === 'field_definition') {
        const n = m.childForFieldName('name');
        const fieldName = n ? n.text : '?';
        const typeAnn = m.childForFieldName('type');
        const fTypes = [];
        if (typeAnn) extractTypeNames(typeAnn, fTypes);
        members.push({ kind: 'field', name: fieldName, line: m.startPosition.row + 1 });
        if (fTypes.length > 0) {
          fieldTypes.push({ field: fieldName, types: fTypes, line: m.startPosition.row + 1 });
        }
      }
    }
  }

  return {
    kind: 'class',
    name,
    id: entityIdBase + '#' + name,
    line: classNode.startPosition.row + 1,
    modifiers: exported ? ['export'] : [],
    extends: ext,
    implements: impl,
    members,
    methodTypes,
    fieldTypes,
    exported
  };
}

function extractInterface(node, entityIdBase, exported) {
  const nameNode = node.childForFieldName('name');
  const name = nameNode ? nameNode.text : '?';
  const members = [];
  const methodTypes = [];
  const fieldTypes = [];
  const body = node.childForFieldName('body') || findChildByType(node, 'interface_body');
  const ext = [];
  const extendsClause = findChildByType(node, 'extends_clause');
  if (extendsClause) {
    for (let i = 0; i < extendsClause.childCount; i++) {
      const t = extendsClause.child(i);
      if (t.type === 'type_identifier') ext.push(t.text);
    }
  }
  if (body) {
    for (let i = 0; i < body.childCount; i++) {
      const m = body.child(i);
      if (m.type === 'method_signature') {
        const n = m.childForFieldName('name');
        const methodName = n ? n.text : '?';
        const params = m.childForFieldName('parameters');
        const retType = m.childForFieldName('return_type');
        const mt = methodTypeFromParams(methodName, params, retType, m.startPosition.row + 1);
        members.push({ kind: 'method', name: methodName, line: m.startPosition.row + 1, params: mt.paramCount });
        methodTypes.push(mt);
      } else if (m.type === 'property_signature') {
        const n = m.childForFieldName('name');
        const fieldName = n ? n.text : '?';
        const typeAnn = m.childForFieldName('type');
        const fTypes = [];
        if (typeAnn) extractTypeNames(typeAnn, fTypes);
        members.push({ kind: 'field', name: fieldName, line: m.startPosition.row + 1 });
        if (fTypes.length > 0) {
          fieldTypes.push({ field: fieldName, types: fTypes, line: m.startPosition.row + 1 });
        }
      }
    }
  }
  return {
    kind: 'interface',
    name,
    id: entityIdBase + '#' + name,
    line: node.startPosition.row + 1,
    modifiers: exported ? ['export'] : [],
    extends: ext,
    implements: [],
    members,
    methodTypes,
    fieldTypes,
    exported
  };
}

function extractFunction(node, entityIdBase, exported) {
  const nameNode = node.childForFieldName('name');
  const name = nameNode ? nameNode.text : '<anonymous>';
  const params = node.childForFieldName('parameters');
  const retType = node.childForFieldName('return_type');
  const mt = methodTypeFromParams(name, params, retType, node.startPosition.row + 1);
  const methodTypes = [mt];
  return {
    kind: 'function',
    name,
    id: entityIdBase + '#' + name,
    line: node.startPosition.row + 1,
    modifiers: exported ? ['export'] : [],
    extends: [],
    implements: [],
    members: [{ kind: 'method', name, params: mt.paramCount, line: node.startPosition.row + 1 }],
    methodTypes,
    impl: extractImpl(node) || undefined,
    exported
  };
}

/* ============================ React detection ============================ */

const JSX_NODE_TYPES = new Set([
  'jsx_element', 'jsx_self_closing_element', 'jsx_fragment', 'jsx_opening_element', 'jsx_closing_element'
]);

function containsJsx(node) {
  if (!node) return false;
  if (JSX_NODE_TYPES.has(node.type)) return true;
  for (let i = 0; i < node.childCount; i++) {
    if (containsJsx(node.child(i))) return true;
  }
  return false;
}

function isUppercaseName(name) {
  return name && /^[A-Z]/.test(name);
}

/** Extract props type names from a function's first parameter type annotation. */
function extractPropsFromParams(paramsNode) {
  if (!paramsNode) return [];
  // First named child that is a parameter
  for (let i = 0; i < paramsNode.childCount; i++) {
    const p = paramsNode.child(i);
    if (p.type !== 'required_parameter' && p.type !== 'optional_parameter') continue;
    const typeAnn = p.childForFieldName('type');
    if (!typeAnn) continue;
    const types = [];
    extractTypeNames(typeAnn, types);
    return types;
  }
  return [];
}

/** Check if a type annotation is React.FC<Props> / FC<Props> and extract the props type. */
function extractFCPropsType(typeAnn) {
  if (!typeAnn) return null;
  // type_annotation -> generic_type
  const generic = findChildByType(typeAnn, 'generic_type');
  if (!generic) return null;
  const nameNode = generic.childForFieldName('name');
  if (!nameNode) return null;
  const nameText = nameNode.text;
  // React.FC, React.FunctionComponent, FC, FunctionComponent, React.SFC, SFC
  if (!/\b(FC|FunctionComponent|SFC|StatelessComponent)$/.test(nameText)) return null;
  const targs = generic.childForFieldName('type_arguments');
  if (!targs) return [];
  const types = [];
  extractTypeNames(targs, types);
  return types;
}

/** Check if a class extends React.Component/PureComponent and extract props from type arguments. */
function detectClassComponent(classNode) {
  const heritage = findChildByType(classNode, 'class_heritage');
  if (!heritage) return null;
  for (let i = 0; i < heritage.childCount; i++) {
    const clause = heritage.child(i);
    if (clause.type !== 'extends_clause') continue;
    const val = clause.childForFieldName('value');
    if (!val) continue;
    const valText = val.text;
    if (!/(React\.)?(Pure)?Component$/.test(valText)) continue;
    // Extract type arguments from the extends clause (React.Component<Props, State>)
    const targs = clause.childForFieldName('type_arguments');
    const propTypes = [];
    if (targs) {
      // First type argument is Props
      for (let j = 0; j < targs.childCount; j++) {
        const t = targs.child(j);
        if (t.type === 'type_identifier' || t.type === 'generic_type' || t.type === 'type_annotation') {
          extractTypeNames(t, propTypes);
          break; // Only first type arg = Props
        }
      }
    }
    return { propTypes, baseClass: valText };
  }
  return null;
}

/**
 * Try to extract a React component from a lexical_declaration (const/let/var).
 * Handles: `const X: React.FC<Props> = ...` and `const X = (props) => <jsx/>`
 */
function extractArrowComponent(lexNode, entityIdBase, exported) {
  const declarator = findChildByType(lexNode, 'variable_declarator');
  if (!declarator) return null;
  const nameNode = declarator.childForFieldName('name');
  const valueNode = declarator.childForFieldName('value');
  const typeAnn = declarator.childForFieldName('type');
  if (!nameNode || nameNode.type !== 'identifier') return null;
  const name = nameNode.text;
  if (!isUppercaseName(name)) return null;

  // Pattern 1: React.FC<Props> type annotation
  const fcProps = extractFCPropsType(typeAnn);
  if (fcProps) {
    return {
      kind: 'component',
      name,
      id: entityIdBase + '#' + name,
      line: lexNode.startPosition.row + 1,
      modifiers: exported ? ['export'] : [],
      extends: [],
      implements: [],
      members: [],
      methodTypes: [],
      fieldTypes: [],
      propTypes: fcProps,
      componentType: 'fc-annotation',
      exported
    };
  }

  // Pattern 2: Arrow function with JSX body
  if (valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression')) {
    const hasJsx = containsJsx(valueNode);
    if (!hasJsx) return null;
    const params = valueNode.childForFieldName('parameters');
    const propTypes = extractPropsFromParams(params);
    return {
      kind: 'component',
      name,
      id: entityIdBase + '#' + name,
      line: lexNode.startPosition.row + 1,
      modifiers: exported ? ['export'] : [],
      extends: [],
      implements: [],
      members: [],
      methodTypes: [],
      fieldTypes: [],
      propTypes,
      componentType: 'arrow-jsx',
      exported
    };
  }

  return null;
}

/** Check if a function declaration is a React component. */
function detectFunctionComponent(funcNode, entityIdBase, exported) {
  const nameNode = funcNode.childForFieldName('name');
  if (!nameNode || !isUppercaseName(nameNode.text)) return null;
  if (!containsJsx(funcNode)) return null;
  const params = funcNode.childForFieldName('parameters');
  const propTypes = extractPropsFromParams(params);
  const name = nameNode.text;
  return {
    kind: 'component',
    name,
    id: entityIdBase + '#' + name,
    line: funcNode.startPosition.row + 1,
    modifiers: exported ? ['export'] : [],
    extends: [],
    implements: [],
    members: [{ kind: 'method', name, params: params ? params.namedChildCount : 0, line: funcNode.startPosition.row + 1 }],
    methodTypes: [],
    fieldTypes: [],
    propTypes,
    componentType: 'function-jsx',
    exported
  };
}

function extractEnum(node, entityIdBase, exported) {
  const nameNode = node.childForFieldName('name');
  const name = nameNode ? nameNode.text : '?';
  const body = node.childForFieldName('body') || findChildByType(node, 'enum_body');
  const values = [];
  if (body) {
    for (let i = 0; i < body.childCount; i++) {
      const v = body.child(i);
      if (v.type === 'property_identifier' || v.type === 'identifier') values.push(v.text);
    }
  }
  return {
    kind: 'enum',
    name,
    id: entityIdBase + '#' + name,
    line: node.startPosition.row + 1,
    modifiers: exported ? ['export'] : [],
    extends: [],
    implements: [],
    members: values.map((v) => ({ kind: 'field', name: v })),
    exported
  };
}

function extractUnionLiterals(node, out) {
  const acc = out || [];
  if (!node) return acc;
  if (node.type === 'union_type') {
    for (let i = 0; i < node.childCount; i++) extractUnionLiterals(node.child(i), acc);
    return acc;
  }
  if (node.type === 'literal_type' || node.type === 'string' || node.type === 'string_fragment') {
    const t = node.text.replace(/^['"`]+|['"`]+$/g, '').trim();
    if (t && t !== '|') acc.push({ kind: 'field', name: t });
    return acc;
  }
  if (node.type === 'identifier' || node.type === 'type_identifier' || node.type === 'property_identifier') {
    acc.push({ kind: 'field', name: node.text });
    return acc;
  }
  for (let i = 0; i < node.childCount; i++) extractUnionLiterals(node.child(i), acc);
  return acc;
}

function extractTypeAlias(node, entityIdBase, exported) {
  const nameNode = node.childForFieldName('name');
  const name = nameNode ? nameNode.text : '?';
  const value = node.childForFieldName('value') || node.childForFieldName('type');
  const members = extractUnionLiterals(value);
  const seen = new Set();
  const uniqMembers = [];
  for (const m of members) {
    if (!m.name || seen.has(m.name)) continue;
    seen.add(m.name);
    uniqMembers.push(m);
  }
  return {
    kind: 'type_alias',
    name,
    id: entityIdBase + '#' + name,
    line: node.startPosition.row + 1,
    modifiers: exported ? ['export'] : [],
    extends: [],
    implements: [],
    members: uniqMembers,
    exported
  };
}

function extractFile(filePath, root) {
  const relPath = path.relative(root, filePath);
  const ext = path.extname(filePath).toLowerCase();
  const isTs = ['.ts', '.tsx', '.mts', '.cts'].includes(ext);
  const lang = isTs ? 'typescript' : 'javascript';

  const source = readSafe(filePath);
  // Entity id base: module path without extension (stable identifier for the file/module).
  const modulePath = relPath.replace(/\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i, '');
  const result = {
    file: relPath,
    lang,
    module: modulePath,
    imports: [],
    entities: [],
    diDependencies: [],
    error: null
  };
  if (source == null) { result.error = 'read failed'; return result; }

  const parser = getParser(lang, ext);
  if (!parser) { result.error = 'tree-sitter not available'; return result; }

  let ast;
  try {
    ast = parser.parse(source).rootNode;
    if (ast.hasError) result.error = 'syntax error or unsupported syntax';
  } catch (e) {
    result.error = e.message;
    return result;
  }

  // Module id base used for entity ids.
  const entityBase = modulePath;

  // Walk top-level + export-wrapped declarations.
  const decls = [];
  for (let i = 0; i < ast.childCount; i++) {
    const child = ast.child(i);
    if (child.type === 'export_statement') {
      const decl = child.childForFieldName('declaration');
      if (decl) decls.push({ node: decl, exported: true });
      // NestJS: @Module sits on export_statement, not on class_declaration
      extractModuleDiDependencies(child, classNameFromDecl(decl), result.diDependencies);
      // re-export: export { x } from './y' -> treat as import edge
      const src = getImportSpecifier(child);
      if (src) {
        const names = getReexportNames(child);
        result.imports.push({
          specifier: src,
          line: child.startPosition.row + 1,
          isType: false,
          isReExport: true,
          names,
          bindings: names.map((n) => ({ local: n, imported: n, namespace: n === '*' }))
        });
      }
    } else if (child.type === 'import_statement') {
      const specifier = getImportSpecifier(child);
      const isType = !!findChildByType(child, 'type'); // `import type ...`
      const clause = findChildByType(child, 'import_clause');
      const bindings = getImportedBindings(clause);
      const names = bindings.map((b) => b.local);
      if (specifier) {
        result.imports.push({ specifier, line: child.startPosition.row + 1, isType, names, bindings });
      }
    } else if (
      child.type === 'class_declaration' ||
      child.type === 'function_declaration' ||
      child.type === 'lexical_declaration' ||
      (isTs && (child.type === 'interface_declaration' || child.type === 'enum_declaration' || child.type === 'type_alias_declaration'))
    ) {
      decls.push({ node: child, exported: false });
      if (child.type === 'class_declaration') {
        extractModuleDiDependencies(child, classNameFromDecl(child), result.diDependencies);
      }
    }
  }

  // require() / import("literal") / import(`static`) — variables & ${} skipped.
  const callExprs = collectNodes(ast, 'call_expression');
  for (const call of callExprs) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;
    const fnText = fn.text;
    const isRequire = fnText === 'require';
    const isImport = fnText === 'import';
    if (!isRequire && !isImport) continue;
    const args = call.childForFieldName('arguments');
    if (!args) continue;
    let spec = null;
    const str = findChildByType(args, ['string', 'string_fragment']);
    if (str) {
      spec = str.type === 'string_fragment' ? str.text : unquote(str.text);
    } else {
      const tmpl = findChildByType(args, 'template_string') || findChildByType(args, 'template_literal');
      if (tmpl && !/\$\{/.test(tmpl.text)) {
        spec = tmpl.text.replace(/^`|`$/g, '');
      }
    }
    if (spec) {
      const names = [];
      const bindings = [];
      let p = call.parent;
      while (p && p.type !== 'program') {
        if (p.type === 'variable_declarator') {
          const id = p.childForFieldName('name');
          if (id && id.type === 'identifier') {
            names.push(id.text);
            bindings.push({ local: id.text, imported: '*', namespace: true });
          }
          break;
        }
        p = p.parent;
      }
      result.imports.push({
        specifier: spec,
        line: call.startPosition.row + 1,
        isType: false,
        isCjs: isRequire,
        dynamic: isImport,
        names,
        bindings
      });
    } else {
      result.imports.push({
        specifier: null,
        line: call.startPosition.row + 1,
        isType: false,
        isCjs: isRequire,
        dynamic: isImport,
        unresolved: true,
        names: []
      });
    }
  }

  for (const { node, exported } of decls) {
    switch (node.type) {
      case 'class_declaration': {
        const classEntity = extractClass(node, entityBase, exported);
        // Check if it's a React class component
        const ccInfo = detectClassComponent(node);
        if (ccInfo) {
          classEntity.kind = 'component';
          classEntity.componentType = 'class';
          classEntity.propTypes = ccInfo.propTypes;
          classEntity.extends.push(ccInfo.baseClass);
        }
        result.entities.push(classEntity);
        break;
      }
      case 'interface_declaration':
        result.entities.push(extractInterface(node, entityBase, exported));
        break;
      case 'function_declaration': {
        const comp = detectFunctionComponent(node, entityBase, exported);
        result.entities.push(comp || extractFunction(node, entityBase, exported));
        break;
      }
      case 'lexical_declaration': {
        const arrowComp = extractArrowComponent(node, entityBase, exported);
        if (arrowComp) result.entities.push(arrowComp);
        break;
      }
      case 'enum_declaration':
        result.entities.push(extractEnum(node, entityBase, exported));
        break;
      case 'type_alias_declaration':
        result.entities.push(extractTypeAlias(node, entityBase, exported));
        break;
      default:
        break;
    }
  }

  for (const route of extractRoutes(ast, lang, relPath, entityBase, result.entities)) {
    result.entities.push(route);
  }

  result.calls = collectCalls(ast, result);
  attachSites(result, ast, lang);
  return result;
}

module.exports = {
  lang: 'jsts',
  exts: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'],
  extractFile,
  NODE_BUILTINS
};
