'use strict';

const path = require('path');
const { readSafe, findChildByType, collectNodes } = require('./shared');
const { extractImpl } = require('../impl-surface');
const { collectCalls } = require('./call-graph');

let Parser, GoLang;
try {
  Parser = require('tree-sitter');
  GoLang = require('tree-sitter-go');
} catch (e) { /* optional dep */ }

// Go built-in types and standard library packages.
const GO_BUILTIN_TYPES = new Set([
  'string', 'int', 'int8', 'int16', 'int32', 'int64',
  'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr',
  'float32', 'float64', 'complex64', 'complex128',
  'bool', 'byte', 'rune', 'error', 'any', 'comparable',
  'struct', 'interface', 'nil', 'true', 'false', 'iota'
]);

const GO_STDLIB_PACKAGES = new Set([
  'context', 'fmt', 'errors', 'strings', 'strconv', 'sync', 'time', 'os',
  'io', 'net', 'http', 'json', 'log', 'math', 'sort', 'bytes', 'bufio',
  'regexp', 'path', 'filepath', 'reflect', 'runtime', 'testing', 'atomic',
  'unsafe', 'unicode', 'utf8', 'utf16', 'xml', 'csv', 'hex', 'base64',
  'md5', 'sha1', 'sha256', 'rand', 'crypto', 'tls', 'x509', 'pem',
  'url', 'template', 'exec', 'signal', 'user', 'syscall', 'plugin',
  'pprof', 'trace', 'expvar', 'metrics', 'exp', 'debug', 'ast', 'parser',
  'token', 'printer', 'format', 'scanner', 'build', 'types', 'constant',
  'importer', 'packages', 'doc', 'comment', 'gosum', 'modfetch', 'modfile',
  'modload', 'modsearch', 'txtar', 'env', 'cgocall', 'cpu', 'sys'
]);

/**
 * Extract type references from a Go type node.
 * Returns [{ pkg, name }] where pkg is the package qualifier (may be null for local types).
 */
function extractGoTypeNames(node, out) {
  const result = out || [];
  if (!node) return result;
  switch (node.type) {
    case 'type_identifier':
      if (!GO_BUILTIN_TYPES.has(node.text)) {
        result.push({ pkg: null, name: node.text });
      }
      return result;
    case 'qualified_type': {
      // e.g. order.Order, storage.Repository
      const pkgNode = node.childForFieldName('package');
      const nameNode = node.childForFieldName('name');
      const pkg = pkgNode ? pkgNode.text : null;
      const name = nameNode ? nameNode.text : null;
      if (name && !GO_BUILTIN_TYPES.has(name)) {
        result.push({ pkg, name });
      }
      return result;
    }
    case 'pointer_type':
    case 'slice_type':
    case 'array_type':
    case 'variadic_type':
    case 'channel_type':
    case 'receive_channel':
    case 'send_channel':
    case 'parenthesized_type':
    case 'type_assertion_expression':
      for (let i = 0; i < node.childCount; i++) extractGoTypeNames(node.child(i), result);
      return result;
    case 'map_type': {
      const key = node.childForFieldName('key');
      const val = node.childForFieldName('value');
      if (key) extractGoTypeNames(key, result);
      if (val) extractGoTypeNames(val, result);
      return result;
    }
    case 'function_type': {
      const params = node.childForFieldName('parameters');
      const result2 = node.childForFieldName('result');
      if (params) extractGoTypeNames(params, result);
      if (result2) extractGoTypeNames(result2, result);
      return result;
    }
    case 'parameter_list':
    case 'parameter_declaration':
    case 'variadic_parameter_declaration':
      for (let i = 0; i < node.childCount; i++) extractGoTypeNames(node.child(i), result);
      return result;
    case 'interface_type': {
      // Embedded interfaces in interface body
      const methods = collectNodes(node, 'method_elem');
      for (const m of methods) {
        const params = m.childForFieldName('parameters');
        if (params) extractGoTypeNames(params, result);
      }
      // Type elements (embedded interfaces)
      const typeElems = collectNodes(node, 'type_elem');
      for (const te of typeElems) {
        const typeNode = te.childForFieldName('type');
        if (typeNode) extractGoTypeNames(typeNode, result);
      }
      return result;
    }
    case 'struct_type': {
      // Embedded struct fields
      const fields = collectNodes(node, 'field_declaration');
      for (const f of fields) {
        const typeNode = f.childForFieldName('type');
        if (typeNode) extractGoTypeNames(typeNode, result);
      }
      return result;
    }
    default:
      // Recurse to catch unknown container nodes
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c.type === 'type_identifier' || c.type === 'qualified_type' ||
            c.type === 'pointer_type' || c.type === 'map_type' ||
            c.type === 'slice_type' || c.type === 'function_type' ||
            c.type === 'interface_type' || c.type === 'struct_type') {
          extractGoTypeNames(c, result);
        }
      }
      return result;
  }
}

/** Extract imports from an import_declaration node. */
function extractGoImports(importDecl) {
  const imports = [];
  const specList = findChildByType(importDecl, 'import_spec_list');
  const specs = specList
    ? collectNodes(specList, 'import_spec')
    : collectNodes(importDecl, 'import_spec');

  for (const spec of specs) {
    const pathNode = spec.childForFieldName('path');
    if (!pathNode) continue;
    // Extract path string from interpreted_string_literal
    let importPath = pathNode.text.replace(/^["'`]|["'`]$/g, '');
    // Check for alias
    let alias = null;
    for (let i = 0; i < spec.childCount; i++) {
      const c = spec.child(i);
      if (c.type === 'package_identifier' || c.type === 'identifier' || c.type === '.') {
        alias = c.text;
        break;
      }
    }
    // Package name is the last component of the import path (unless aliased)
    const parts = importPath.split('/');
    const pkgName = alias || parts[parts.length - 1];
    const isStdlib = !importPath.includes('.') && GO_STDLIB_PACKAGES.has(pkgName);
    imports.push({
      specifier: importPath,
      packageName: pkgName,
      alias,
      isStdlib,
      line: spec.startPosition.row + 1
    });
  }
  return imports;
}

/** Extract struct fields from a struct_type node. */
function extractGoStructFields(structType) {
  const fields = [];
  const fieldList = findChildByType(structType, 'field_declaration_list');
  if (!fieldList) return fields;
  for (let i = 0; i < fieldList.childCount; i++) {
    const f = fieldList.child(i);
    if (f.type !== 'field_declaration') continue;
    const nameNode = f.childForFieldName('name');
    const typeNode = f.childForFieldName('type');
    // Embedded field (no name, just type)
    const fieldName = nameNode ? nameNode.text : (typeNode ? typeNode.text : '?');
    const types = [];
    if (typeNode) extractGoTypeNames(typeNode, types);
    fields.push({
      field: fieldName,
      types: types.map((t) => t.name),
      typeRefs: types,
      line: f.startPosition.row + 1
    });
  }
  return fields;
}

/** Extract interface methods from an interface_type node. */
function extractGoInterfaceMethods(ifaceType) {
  const methods = [];
  const methodElems = collectNodes(ifaceType, 'method_elem');
  for (const m of methodElems) {
    const nameNode = m.childForFieldName('name');
    const params = m.childForFieldName('parameters');
    const result = m.childForFieldName('result');
    const methodName = nameNode ? nameNode.text : '?';

    const paramTypes = [];
    const paramRefsAll = [];
    if (params) {
      const refs = [];
      extractGoTypeNames(params, refs);
      for (const r of refs) {
        paramTypes.push(r.name);
        paramRefsAll.push(r);
      }
    }
    const returnTypes = [];
    const returnRefsAll = [];
    if (result) {
      const refs = [];
      extractGoTypeNames(result, refs);
      for (const r of refs) {
        returnTypes.push(r.name);
        returnRefsAll.push(r);
      }
    }

    methods.push({
      kind: 'method',
      name: methodName,
      line: m.startPosition.row + 1
    });

    if (paramTypes.length > 0 || returnTypes.length > 0) {
      methods.push({
        _typeInfo: true,
        method: methodName,
        paramTypes,
        returnTypes,
        paramRefs: paramRefsAll,
        returnRefs: returnRefsAll,
        line: m.startPosition.row + 1
      });
    }
  }
  // Separate method info from type info
  const memberMethods = methods.filter((m) => !m._typeInfo);
  const methodTypes = methods.filter((m) => m._typeInfo).map((m) => {
    const { _typeInfo, ...rest } = m;
    return rest;
  });
  return { methods: memberMethods, methodTypes };
}

/** Extract parameter and return type refs from a function/method node. */
function extractGoFuncTypes(node) {
  const params = node.childForFieldName('parameters');
  const result = node.childForFieldName('result');

  const paramRefs = [];
  if (params) extractGoTypeNames(params, paramRefs);
  const returnRefs = [];
  if (result) extractGoTypeNames(result, returnRefs);

  return {
    paramTypes: paramRefs.map((r) => r.name),
    paramRefs,
    returnTypes: returnRefs.map((r) => r.name),
    returnRefs
  };
}

function parseFile(filePath) {
  const source = readSafe(filePath);
  if (source == null) return { source: null, ast: null, error: 'read failed' };
  if (!Parser || !GoLang) return { source, ast: null, error: 'tree-sitter not available' };
  try {
    const parser = new Parser();
    parser.setLanguage(GoLang);
    const tree = parser.parse(source);
    return { source, ast: tree.rootNode, error: null };
  } catch (e) {
    return { source, ast: null, error: e.message };
  }
}

function extractFile(filePath, root) {
  const relPath = path.relative(root, filePath);
  const { ast, error } = parseFile(filePath);

  // Go module path = directory path (all files in same dir are same package)
  const dir = path.posix.dirname(relPath);
  const modulePath = dir === '.' ? '' : dir;

  const result = {
    file: relPath,
    lang: 'go',
    module: modulePath,
    package: null,
    imports: [],
    entities: [],
    error
  };

  if (!ast) return result;

  // Extract package name
  const pkgClause = findChildByType(ast, 'package_clause');
  if (pkgClause) {
    const pkgId = findChildByType(pkgClause, 'package_identifier');
    if (pkgId) result.package = pkgId.text;
  }

  const entityBase = modulePath;

  for (let i = 0; i < ast.childCount; i++) {
    const child = ast.child(i);

    // Imports
    if (child.type === 'import_declaration') {
      const imps = extractGoImports(child);
      for (const imp of imps) {
        result.imports.push({
          specifier: imp.specifier,
          packageName: imp.packageName,
          alias: imp.alias,
          isStdlib: imp.isStdlib,
          line: imp.line,
          names: []
        });
      }
    }

    // Type declarations (struct, interface, type alias)
    if (child.type === 'type_declaration') {
      const typeSpecs = collectNodes(child, 'type_spec');
      for (const spec of typeSpecs) {
        const nameNode = spec.childForFieldName('name');
        const typeNode = spec.childForFieldName('type');
        if (!nameNode || !typeNode) continue;
        const name = nameNode.text;

        if (typeNode.type === 'struct_type') {
          const fields = extractGoStructFields(typeNode);
          const fieldTypes = fields.map((f) => ({
            field: f.field,
            types: f.types,
            typeRefs: f.typeRefs,
            line: f.line
          }));
          result.entities.push({
            kind: 'class',
            name,
            id: entityBase + '#' + name,
            line: spec.startPosition.row + 1,
            modifiers: [],
            extends: [],
            implements: [],
            members: fields.map((f) => ({ kind: 'field', name: f.field, line: f.line })),
            methodTypes: [],
            fieldTypes,
            exported: /^[A-Z]/.test(name)
          });
        } else if (typeNode.type === 'interface_type') {
          const { methods, methodTypes } = extractGoInterfaceMethods(typeNode);
          result.entities.push({
            kind: 'interface',
            name,
            id: entityBase + '#' + name,
            line: spec.startPosition.row + 1,
            modifiers: [],
            extends: [],
            implements: [],
            members: methods,
            methodTypes,
            fieldTypes: [],
            exported: /^[A-Z]/.test(name)
          });
        } else {
          // Type alias / named type: type MyInt int, type OrderID string
          const refs = [];
          extractGoTypeNames(typeNode, refs);
          result.entities.push({
            kind: 'type_alias',
            name,
            id: entityBase + '#' + name,
            line: spec.startPosition.row + 1,
            modifiers: [],
            extends: refs.map((r) => r.name),
            implements: [],
            members: [],
            methodTypes: [],
            fieldTypes: [],
            exported: /^[A-Z]/.test(name)
          });
        }
      }
    }

    // Standalone function (no receiver)
    if (child.type === 'function_declaration') {
      const nameNode = child.childForFieldName('name');
      const name = nameNode ? nameNode.text : '?';
      const { paramTypes, paramRefs, returnTypes, returnRefs } = extractGoFuncTypes(child);
      const methodTypes = [];
      if (paramTypes.length > 0 || returnTypes.length > 0) {
        methodTypes.push({
          method: name,
          paramTypes,
          paramRefs,
          returnTypes,
          returnRefs,
          line: child.startPosition.row + 1
        });
      }
      result.entities.push({
        kind: 'function',
        name,
        id: entityBase + '#' + name,
        line: child.startPosition.row + 1,
        modifiers: [],
        extends: [],
        implements: [],
        members: [{ kind: 'method', name, line: child.startPosition.row + 1 }],
        methodTypes,
        fieldTypes: [],
        impl: extractImpl(child) || undefined,
        exported: /^[A-Z]/.test(name)
      });
    }

    // Method (has receiver) — attach to the receiver type
    if (child.type === 'method_declaration') {
      const nameNode = child.childForFieldName('name');
      const receiver = child.childForFieldName('receiver');
      const methodName = nameNode ? nameNode.text : '?';

      // Find receiver type name
      let receiverType = null;
      if (receiver) {
        const refs = [];
        extractGoTypeNames(receiver, refs);
        if (refs.length > 0) receiverType = refs[0].name;
      }

      const { paramTypes, paramRefs, returnTypes, returnRefs } = extractGoFuncTypes(child);

      // Find the entity in result that matches receiver type
      const targetEntity = result.entities.find((e) => e.name === receiverType && e.kind === 'class');
      if (targetEntity) {
        targetEntity.members.push({
          kind: 'method',
          name: methodName,
          line: child.startPosition.row + 1,
          impl: extractImpl(child) || undefined
        });
        if (paramTypes.length > 0 || returnTypes.length > 0) {
          targetEntity.methodTypes.push({
            method: methodName,
            paramTypes,
            paramRefs,
            returnTypes,
            returnRefs,
            line: child.startPosition.row + 1
          });
        }
      }
    }
  }

  result.calls = collectCalls(ast, result);
  return result;
}

module.exports = {
  lang: 'go',
  exts: ['.go'],
  extractFile,
  extractGoTypeNames,
  GO_BUILTIN_TYPES,
  GO_STDLIB_PACKAGES
};
