'use strict';

const path = require('path');
const { readSafe, findChildByType, collectNodes } = require('./shared');

let Parser, JSLang, TSPkg;
try {
  Parser = require('tree-sitter');
  JSLang = require('tree-sitter-javascript');
  TSPkg = require('tree-sitter-typescript');
} catch (e) { /* optional dep */ }

/** Extract the <script> block content from a .vue SFC file. */
function extractScriptBlock(source) {
  if (!source) return { content: '', lang: 'js' };
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/i;
  const m = source.match(scriptRegex);
  if (!m) return { content: '', lang: 'js' };
  const attrs = m[1] || '';
  const content = m[2] || '';
  const isTs = /lang\s*=\s*["'](?:ts|typescript)["']/i.test(attrs);
  return { content, lang: isTs ? 'ts' : 'js' };
}

function getParser(scriptLang) {
  if (!Parser) return null;
  const p = new Parser();
  if (scriptLang === 'ts') {
    const ts = (TSPkg && (TSPkg.typescript || (TSPkg.default && TSPkg.default.typescript))) || TSPkg;
    p.setLanguage(ts);
  } else {
    p.setLanguage(JSLang);
  }
  return p;
}

function fileNameToComponentName(fileName) {
  const base = fileName.replace(/\.vue$/i, '');
  if (/[A-Z]/.test(base) && base.indexOf('-') === -1) return base;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

function extractTypeNames(node, out) {
  const result = out || [];
  if (!node) return result;
  const BUILTIN = new Set([
    'string', 'number', 'boolean', 'void', 'any', 'unknown', 'never', 'null',
    'undefined', 'bigint', 'symbol', 'object', 'Date', 'Error', 'Array',
    'Map', 'Set', 'Promise', 'Record', 'Partial', 'Pick', 'Omit', 'Readonly',
    'Exclude', 'Extract', 'NonNullable', 'Function', 'WeakMap', 'WeakSet',
    'RegExp', 'Math', 'JSON', 'Number', 'String', 'Boolean', 'BigInt', 'Symbol', 'Object'
  ]);
  switch (node.type) {
    case 'type_annotation':
    case 'type_arguments':
    case 'parenthesized_type':
    case 'union_type':
    case 'intersection_type':
    case 'tuple_type':
    case 'object_type':
    case 'type_parameter':
    case 'function_type':
    case 'constructor_type':
    case 'array_type':
    case 'readonly_type':
    case 'type_predicate':
    case 'conditional_type':
    case 'infer_type':
    case 'mapped_type':
    case 'template_literal_type':
    case 'rest_type':
    case 'optional_type':
      for (let i = 0; i < node.childCount; i++) extractTypeNames(node.child(i), result);
      return result;
    case 'generic_type': {
      const nameNode = node.childForFieldName('name');
      if (nameNode && nameNode.type === 'type_identifier' && !BUILTIN.has(nameNode.text)) {
        result.push(nameNode.text);
      }
      const targs = node.childForFieldName('type_arguments');
      if (targs) extractTypeNames(targs, result);
      return result;
    }
    case 'type_identifier':
      if (!BUILTIN.has(node.text)) result.push(node.text);
      return result;
    default:
      for (let i = 0; i < node.childCount; i++) extractTypeNames(node.child(i), result);
      return result;
  }
}

function findDefinePropsType(ast) {
  const calls = collectNodes(ast, 'call_expression');
  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;
    const fnText = fn.text;
    if (/^(defineProps|defineEmits|withDefaults)$/.test(fnText)) {
      const targs = call.childForFieldName('type_arguments');
      if (targs) {
        const types = [];
        for (let i = 0; i < targs.childCount; i++) {
          const t = targs.child(i);
          if (t.type === 'type_identifier' || t.type === 'generic_type' ||
              t.type === 'object_type' || t.type === 'type_annotation') {
            extractTypeNames(t, types);
            break;
          }
        }
        return { types, macro: fnText };
      }
    }
  }
  return null;
}

function findDefineComponentType(ast) {
  const calls = collectNodes(ast, 'call_expression');
  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;
    if (fn.text === 'defineComponent' || fn.text === 'Vue.extend') {
      const targs = call.childForFieldName('type_arguments');
      if (targs) {
        const types = [];
        for (let i = 0; i < targs.childCount; i++) {
          const t = targs.child(i);
          if (t.type === 'type_identifier' || t.type === 'generic_type' || t.type === 'type_annotation') {
            extractTypeNames(t, types);
            break;
          }
        }
        return { types, macro: 'defineComponent' };
      }
    }
  }
  return null;
}

function findClassComponentExtendsVue(ast) {
  const classes = collectNodes(ast, 'class_declaration');
  for (const cls of classes) {
    const heritage = findChildByType(cls, 'class_heritage');
    if (!heritage) continue;
    for (let i = 0; i < heritage.childCount; i++) {
      const clause = heritage.child(i);
      if (clause.type !== 'extends_clause') continue;
      const val = clause.childForFieldName('value');
      if (val && /Vue(\.extend)?$/.test(val.text)) {
        const targs = clause.childForFieldName('type_arguments');
        const types = [];
        if (targs) {
          for (let j = 0; j < targs.childCount; j++) {
            const t = targs.child(j);
            if (t.type === 'type_identifier' || t.type === 'generic_type') {
              extractTypeNames(t, types);
              break;
            }
          }
        }
        const nameNode = cls.childForFieldName('name');
        return { name: nameNode ? nameNode.text : null, types, baseClass: val.text };
      }
    }
  }
  return null;
}

function extractFile(filePath, root) {
  const relPath = path.relative(root, filePath);
  const source = readSafe(filePath);
  const modulePath = relPath.replace(/\.vue$/i, '');
  const componentName = fileNameToComponentName(path.basename(filePath));

  const result = {
    file: relPath,
    lang: 'vue',
    module: modulePath,
    imports: [],
    entities: [],
    error: null
  };
  if (source == null) { result.error = 'read failed'; return result; }

  const { content: scriptContent, lang: scriptLang } = extractScriptBlock(source);
  if (!scriptContent.trim()) {
    result.entities.push({
      kind: 'component',
      name: componentName,
      id: modulePath + '#' + componentName,
      line: 1,
      modifiers: ['export'],
      extends: [],
      implements: [],
      members: [],
      methodTypes: [],
      fieldTypes: [],
      propTypes: [],
      componentType: 'vue-sfc',
      exported: true
    });
    return result;
  }

  const parser = getParser(scriptLang);
  if (!parser) { result.error = 'tree-sitter not available'; return result; }

  let ast;
  try {
    ast = parser.parse(scriptContent).rootNode;
  } catch (e) {
    result.error = e.message;
    return result;
  }

  for (let i = 0; i < ast.childCount; i++) {
    const child = ast.child(i);
    if (child.type === 'import_statement') {
      const sourceNode = child.childForFieldName('source');
      if (sourceNode) {
        const frag = findChildByType(sourceNode, 'string_fragment');
        const spec = frag ? frag.text : sourceNode.text.replace(/^['"`]|['"`]$/g, '');
        result.imports.push({ specifier: spec, line: child.startPosition.row + 1, isType: false, names: [] });
      }
    }
  }

  let propTypes = [];
  let componentSubtype = 'vue-sfc';

  const dpInfo = findDefinePropsType(ast);
  if (dpInfo) {
    propTypes = dpInfo.types;
    componentSubtype = 'vue-setup';
  }

  if (propTypes.length === 0) {
    const dcInfo = findDefineComponentType(ast);
    if (dcInfo) {
      propTypes = dcInfo.types;
      componentSubtype = 'vue-options';
    }
  }

  if (propTypes.length === 0) {
    const ccInfo = findClassComponentExtendsVue(ast);
    if (ccInfo) {
      propTypes = ccInfo.types;
      componentSubtype = 'vue-class';
    }
  }

  // Extract interface/type declarations from script block
  const decls = [];
  for (let i = 0; i < ast.childCount; i++) {
    const child = ast.child(i);
    let target = child;
    if (child.type === 'export_statement') {
      target = child.childForFieldName('declaration') || child;
    }
    if (target.type === 'interface_declaration' || target.type === 'type_alias_declaration') {
      const nameNode = target.childForFieldName('name');
      if (nameNode) {
        decls.push({
          kind: target.type === 'interface_declaration' ? 'interface' : 'type_alias',
          name: nameNode.text,
          id: modulePath + '#' + nameNode.text,
          line: target.startPosition.row + 1
        });
      }
    }
  }

  const callExprs = collectNodes(ast, 'call_expression');
  for (const call of callExprs) {
    const fn = call.childForFieldName('function');
    if (fn && (fn.text === 'require' || fn.text === 'import')) {
      const args = call.childForFieldName('arguments');
      const str = args && findChildByType(args, ['string', 'string_fragment']);
      if (str) {
        const spec = str.type === 'string_fragment' ? str.text : str.text.replace(/^['"`]|['"`]$/g, '');
        result.imports.push({
          specifier: spec,
          line: call.startPosition.row + 1,
          isType: false,
          isCjs: fn.text === 'require',
          dynamic: fn.text === 'import',
          names: []
        });
      }
    }
  }

  result.entities.push({
    kind: 'component',
    name: componentName,
    id: modulePath + '#' + componentName,
    line: 1,
    modifiers: ['export'],
    extends: [],
    implements: [],
    members: [],
    methodTypes: [],
    fieldTypes: [],
    propTypes,
    componentType: componentSubtype,
    exported: true
  });

  for (const d of decls) {
    result.entities.push({
      kind: d.kind,
      name: d.name,
      id: d.id,
      line: d.line,
      modifiers: [],
      extends: [],
      implements: [],
      members: [],
      methodTypes: [],
      fieldTypes: [],
      exported: true
    });
  }

  return result;
}

module.exports = {
  lang: 'vue',
  exts: ['.vue'],
  extractFile,
  extractScriptBlock,
  fileNameToComponentName
};
