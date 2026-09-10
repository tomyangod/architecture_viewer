'use strict';

const { findChildByType } = require('./shared');

/** NestJS @Module array keys that declare class wiring. */
const MODULE_ARRAY_KEYS = new Set(['imports', 'controllers', 'providers']);

/** Decorator name: @Module → "Module". */
function getDecoratorName(decoratorNode) {
  if (!decoratorNode || decoratorNode.type !== 'decorator') return null;
  const call = findChildByType(decoratorNode, 'call_expression') || decoratorNode.namedChild(0);
  if (!call) return null;
  if (call.type === 'identifier') return call.text;
  if (call.type === 'call_expression') {
    const fn = call.childForFieldName('function');
    if (!fn) return null;
    if (fn.type === 'identifier') return fn.text;
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property');
      return prop ? prop.text : null;
    }
  }
  return null;
}

/** Collect class identifiers from a NestJS @Module array value (idents + useClass). */
function collectModuleArrayRefs(valueNode, out) {
  if (!valueNode) return;
  if (valueNode.type === 'array') {
    for (let i = 0; i < valueNode.namedChildCount; i++) {
      collectModuleArrayRefs(valueNode.namedChild(i), out);
    }
    return;
  }
  if (valueNode.type === 'identifier') {
    out.push(valueNode.text);
    return;
  }
  if (valueNode.type === 'object') {
    for (let i = 0; i < valueNode.namedChildCount; i++) {
      const pair = valueNode.namedChild(i);
      if (!pair || pair.type !== 'pair') continue;
      const key = pair.childForFieldName('key') || pair.namedChild(0);
      const val = pair.childForFieldName('value') || pair.namedChild(1);
      if (!key || !val) continue;
      if (key.text === 'useClass' && val.type === 'identifier') out.push(val.text);
    }
  }
}

/**
 * Extract NestJS @Module({ imports, controllers, providers }) class refs.
 * Decorators sit on export_statement (exported) or class_declaration (local).
 */
function extractModuleDiDependencies(hostNode, ownerName, out) {
  if (!hostNode || !ownerName) return;
  for (let i = 0; i < hostNode.childCount; i++) {
    const child = hostNode.child(i);
    if (child.type !== 'decorator') continue;
    if (getDecoratorName(child) !== 'Module') continue;
    const call = findChildByType(child, 'call_expression');
    if (!call) continue;
    const args = call.childForFieldName('arguments');
    if (!args) continue;
    const obj = findChildByType(args, 'object');
    if (!obj) continue;
    const line = child.startPosition.row + 1;
    for (let j = 0; j < obj.namedChildCount; j++) {
      const pair = obj.namedChild(j);
      if (!pair || pair.type !== 'pair') continue;
      const key = pair.childForFieldName('key') || pair.namedChild(0);
      const val = pair.childForFieldName('value') || pair.namedChild(1);
      if (!key || !val || !MODULE_ARRAY_KEYS.has(key.text)) continue;
      const refs = [];
      collectModuleArrayRefs(val, refs);
      for (const refName of refs) {
        out.push({
          decorator: 'Module',
          ownerName,
          refName,
          role: key.text,
          line
        });
      }
    }
  }
}

function classNameFromDecl(declNode) {
  if (!declNode || declNode.type !== 'class_declaration') return null;
  const nameNode = declNode.childForFieldName('name');
  return nameNode ? nameNode.text : null;
}

module.exports = {
  MODULE_ARRAY_KEYS,
  getDecoratorName,
  extractModuleDiDependencies,
  classNameFromDecl
};
