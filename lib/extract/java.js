'use strict';

const path = require('path');
const { readSafe, findChildByType } = require('./shared');
const { extractImpl } = require('../impl-surface');
const { collectCalls } = require('./call-graph');

let Parser, JavaLang;
try {
  Parser = require('tree-sitter');
  JavaLang = require('tree-sitter-java');
} catch (e) { /* optional dep */ }

const JDK_PREFIXES = [
  'java.', 'javax.', 'sun.', 'com.sun.', 'org.w3c.', 'org.xml.', 'org.ietf.', 'jdk.'
];

function isJdkImport(fqn) {
  return JDK_PREFIXES.some((p) => fqn.startsWith(p));
}

const TYPE_NODE_TYPES = ['type_identifier', 'scoped_type_identifier', 'generic_type', 'annotated_type'];

function getParser() {
  if (!Parser || !JavaLang) return null;
  const p = new Parser();
  p.setLanguage(JavaLang);
  return p;
}

function extractTypeName(node) {
  if (!node) return null;
  if (node.type === 'type_identifier' || node.type === 'identifier') return node.text;
  if (node.type === 'scoped_type_identifier') return node.text.replace(/\s+/g, '.');
  if (node.type === 'generic_type') {
    const t = node.childForFieldName('type');
    return t ? extractTypeName(t) : node.text;
  }
  if (node.type === 'annotated_type') return extractTypeName(node.childForFieldName('element'));
  return node.text;
}

function extractTypeList(node) {
  if (!node) return [];
  const out = [];
  let target = node;
  const typeList = findChildByType(node, 'type_list');
  if (typeList) target = typeList;
  for (let i = 0; i < target.childCount; i++) {
    const c = target.child(i);
    if (TYPE_NODE_TYPES.includes(c.type)) {
      const name = extractTypeName(c);
      if (name) out.push(name);
    }
  }
  return out;
}

function getModifiers(node) {
  const mods = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type === 'modifiers') {
      for (let j = 0; j < child.childCount; j++) {
        const m = child.child(j);
        if (['public', 'private', 'protected', 'static', 'final', 'abstract'].includes(m.type)) {
          mods.push(m.type);
        }
      }
    }
  }
  return mods;
}

function extractFile(filePath, root) {
  const relPath = path.relative(root, filePath);
  const source = readSafe(filePath);
  const result = {
    file: relPath,
    lang: 'java',
    module: null,
    imports: [],
    entities: [],
    error: null
  };
  if (source == null) { result.error = 'read failed'; return result; }

  const parser = getParser();
  if (!parser) { result.error = 'tree-sitter not available'; return result; }

  let ast;
  try {
    ast = parser.parse(source).rootNode;
  } catch (e) {
    result.error = e.message;
    return result;
  }

  let pkg = null;
  for (let i = 0; i < ast.childCount; i++) {
    const child = ast.child(i);
    if (child.type === 'package_declaration') {
      const scope = findChildByType(child, ['scoped_identifier', 'identifier']);
      if (scope) pkg = scope.text.replace(/\s+/g, '.');
    }
    if (child.type === 'import_declaration') {
      const scope = findChildByType(child, ['scoped_identifier', 'identifier']);
      if (scope) {
        let importPath = scope.text.replace(/\s+/g, '.');
        const isWildcard = child.children.some((c) => c.type === '*');
        if (isWildcard) importPath += '.*';
        result.imports.push({
          specifier: importPath,
          line: child.startPosition.row + 1,
          isType: child.children.some((c) => c.type === 'static'),
          isWildcard
        });
      }
    }
  }
  result.module = pkg;

  function collectTypes(node, ownerFqn) {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      const kind = child.type;
      const isTypeDecl = ['class_declaration', 'interface_declaration', 'enum_declaration',
        'record_declaration', 'annotation_type_declaration'].includes(kind);
      if (!isTypeDecl) continue;

      const nameNode = child.childForFieldName('name');
      const name = nameNode ? nameNode.text : '<anonymous>';
      const fqn = ownerFqn ? ownerFqn + '.' + name : (pkg ? pkg + '.' + name : name);
      const line = child.startPosition.row + 1;

      const entity = {
        kind: kind.replace('_declaration', '').replace('annotation_type', 'annotation'),
        name,
        id: fqn,
        line,
        modifiers: getModifiers(child),
        extends: [],
        implements: [],
        members: []
      };

      const superclass = child.childForFieldName('superclass');
      if (superclass) {
        const st = findChildByType(superclass, TYPE_NODE_TYPES);
        const ext = extractTypeName(st);
        if (ext) entity.extends.push(ext);
      }
      const interfaces = child.childForFieldName('interfaces');
      if (interfaces) entity.implements.push(...extractTypeList(interfaces));

      for (let j = 0; j < child.childCount; j++) {
        const body = child.child(j);
        if (!['class_body', 'interface_body', 'enum_body', 'record_body'].includes(body.type)) continue;
        for (let k = 0; k < body.childCount; k++) {
          const member = body.child(k);
          if (member.type === 'field_declaration') {
            const tn = member.childForFieldName('type');
            const typeName = tn ? extractTypeName(tn) : null;
            const declarator = member.childForFieldName('declarator');
            let fieldName = '';
            if (declarator) {
              const vn = declarator.childForFieldName('name');
              fieldName = vn ? vn.text : declarator.text;
            }
            if (typeName) entity.members.push({ kind: 'field', name: fieldName, type: typeName, line: member.startPosition.row + 1 });
          }
          if (member.type === 'method_declaration' || member.type === 'constructor_declaration') {
            const rn = member.childForFieldName('type');
            const retType = rn ? extractTypeName(rn) : 'void';
            const nn = member.childForFieldName('name');
            const methodName = nn ? nn.text : '<init>';
            const params = [];
            const pn = member.childForFieldName('parameters');
            if (pn) {
              for (let pi = 0; pi < pn.childCount; pi++) {
                const param = pn.child(pi);
                if (param.type === 'formal_parameter') {
                  const pt = param.childForFieldName('type');
                  if (pt) {
                    const ptn = extractTypeName(pt);
                    if (ptn) params.push(ptn);
                  }
                }
              }
            }
            entity.members.push({
              kind: 'method',
              name: methodName,
              returnType: retType,
              paramTypes: params,
              line: member.startPosition.row + 1,
              impl: extractImpl(member) || undefined
            });
          }
          if (['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration'].includes(member.type)) {
            collectTypes(member, fqn);
          }
        }
      }

      result.entities.push(entity);
    }
  }

  collectTypes(ast, null);
  result.calls = collectCalls(ast, result);
  return result;
}

module.exports = {
  lang: 'java',
  exts: ['.java'],
  extractFile,
  isJdkImport
};
