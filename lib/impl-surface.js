'use strict';

/**
 * Function-body implementation surface.
 *
 * Structure fingerprint still ignores bodies. This layer hashes a comment-stripped
 * body and records cheap signals (literals / calls / control-flow) so session
 * report can list *which* functions changed and *how* — without claiming the
 * new logic is correct.
 */

const crypto = require('crypto');
const { fingerprintFromImpl } = require('./extract/behavior-fingerprint');

const LIST_CAP = 32;
const REPORT_CAP = 40;

const COMMENT_TYPES = new Set([
  'comment', 'line_comment', 'block_comment', 'html_comment'
]);

const STRING_TYPES = new Set([
  'string', 'string_literal', 'string_fragment', 'template_string',
  'interpreted_string_literal', 'raw_string_literal', 'rune_literal',
  'character_literal', 'char_literal', 'concatenated_string'
]);

const NUMBER_TYPES = new Set([
  'number', 'integer', 'float', 'decimal_integer_literal', 'hex_integer_literal',
  'octal_integer_literal', 'binary_integer_literal', 'integer_literal',
  'float_literal', 'imaginary_literal', 'decimal_floating_point_literal'
]);

const CALL_TYPES = new Set([
  'call_expression', 'call', 'method_invocation'
]);

const IF_TYPES = new Set(['if_statement', 'elif_clause']);
const LOOP_TYPES = new Set([
  'for_statement', 'while_statement', 'for_in_statement',
  'enhanced_for_statement', 'for_range_clause'
]);
const RETURN_TYPES = new Set(['return_statement']);
const THROW_TYPES = new Set(['throw_statement', 'raise_statement']);
const TRY_TYPES = new Set(['try_statement']);
const AWAIT_TYPES = new Set(['await_expression', 'await']);

const IMPL_KIND_LABEL = {
  literals: '文案/常量',
  calls: '调用',
  'control-flow': '控制流',
  mixed: '混合',
  body: '函数体'
};

function emptyControl() {
  return { if: 0, loop: 0, return: 0, throw: 0, try: 0, await: 0 };
}

function bodyNode(fnNode) {
  if (!fnNode) return null;
  return fnNode.childForFieldName('body') || null;
}

function isComment(node) {
  return !!(node && COMMENT_TYPES.has(node.type));
}

function normalizeLiteral(text) {
  if (!text) return '';
  return String(text).replace(/^['"`]+|['"`]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function calleeName(callNode) {
  const fn = callNode.childForFieldName('function') || callNode.childForFieldName('name');
  if (!fn) return null;
  if (fn.type === 'identifier' || fn.type === 'property_identifier') return fn.text;
  const prop = fn.childForFieldName('property')
    || fn.childForFieldName('attribute')
    || fn.childForFieldName('name');
  if (prop && prop.text) return prop.text;
  const m = String(fn.text || '').match(/([A-Za-z_][\w]*)$/);
  return m ? m[1] : null;
}

function throwName(throwNode) {
  if (!throwNode) return null;
  // throw new FooError(...) / raise FooError(...) / raise FooError
  for (let i = 0; i < throwNode.childCount; i++) {
    const c = throwNode.child(i);
    if (CALL_TYPES.has(c.type)) {
      const n = calleeName(c);
      if (n) return n;
    }
    if (c.type === 'identifier' || c.type === 'type_identifier' || c.type === 'property_identifier') {
      if (!/^(throw|raise|new)$/i.test(c.text)) return c.text;
    }
    if (c.type === 'new_expression' || c.type === 'object_creation_expression') {
      const t = c.childForFieldName('type') || c.childForFieldName('constructor');
      if (t) {
        const m = String(t.text || '').match(/([A-Za-z_][\w]*)$/);
        if (m) return m[1];
      }
      const n = calleeName(c);
      if (n) return n;
    }
  }
  return null;
}

function awaitCallee(awaitNode) {
  if (!awaitNode) return null;
  for (let i = 0; i < awaitNode.childCount; i++) {
    const c = awaitNode.child(i);
    if (CALL_TYPES.has(c.type)) return calleeName(c);
    if (c.type === 'identifier') return c.text;
  }
  return null;
}

function walkSignals(node, acc) {
  if (!node || isComment(node)) return;
  if (STRING_TYPES.has(node.type) || NUMBER_TYPES.has(node.type)) {
    const lit = normalizeLiteral(node.text);
    if (lit) acc.literals.push(lit);
    return;
  }
  if (CALL_TYPES.has(node.type)) {
    const name = calleeName(node);
    if (name) acc.calls.push(name);
  }
  if (IF_TYPES.has(node.type)) acc.control.if++;
  else if (LOOP_TYPES.has(node.type)) acc.control.loop++;
  else if (RETURN_TYPES.has(node.type)) acc.control.return++;
  else if (THROW_TYPES.has(node.type)) {
    acc.control.throw++;
    const tn = throwName(node);
    if (tn) acc.throws.push(tn);
  } else if (TRY_TYPES.has(node.type)) acc.control.try++;
  else if (AWAIT_TYPES.has(node.type)) {
    acc.control.await++;
    const an = awaitCallee(node);
    if (an) acc.awaits.push(an);
  }

  if (node.childCount === 0) {
    const t = String(node.text || '').replace(/\s+/g, ' ').trim();
    if (t) acc.tokens.push(t);
    return;
  }
  for (let i = 0; i < node.childCount; i++) walkSignals(node.child(i), acc);
}

function uniqueCap(list, cap) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= cap) break;
  }
  out.sort();
  return out;
}

/**
 * Fingerprint a function/method AST node. Returns null when there is no body
 * (interface / abstract) so callers can skip.
 */
function extractImpl(fnNode) {
  const body = bodyNode(fnNode) || fnNode;
  if (!body) return null;
  const acc = { tokens: [], literals: [], calls: [], throws: [], awaits: [], control: emptyControl() };
  walkSignals(body, acc);
  if (!acc.tokens.length && !acc.literals.length) return null;
  const literals = uniqueCap(acc.literals, LIST_CAP);
  const calls = uniqueCap(acc.calls, LIST_CAP);
  const throws = uniqueCap(acc.throws, LIST_CAP);
  const awaits = uniqueCap(acc.awaits, LIST_CAP);
  const hash = crypto.createHash('sha256')
    .update(acc.tokens.join(' ') + '\0lit:' + literals.join('\0'))
    .digest('hex')
    .slice(0, 16);
  return finalizeImpl({
    hash,
    literals,
    calls,
    throws,
    awaits,
    control: acc.control
  });
}

function finalizeImpl(impl) {
  if (!impl) return null;
  impl.behavior = fingerprintFromImpl(impl);
  return impl;
}

function sameArr(a, b) {
  const x = (a || []).slice().sort();
  const y = (b || []).slice().sort();
  if (x.length !== y.length) return false;
  return x.every((v, i) => v === y[i]);
}

function sameControl(a, b) {
  const x = a || emptyControl();
  const y = b || emptyControl();
  return x.if === y.if && x.loop === y.loop && x.return === y.return
    && x.throw === y.throw && x.try === y.try && x.await === y.await;
}

function arrDelta(from, to) {
  const f = new Set(from || []);
  const t = new Set(to || []);
  return {
    added: [...t].filter((v) => !f.has(v)).sort(),
    removed: [...f].filter((v) => !t.has(v)).sort()
  };
}

function classifyImplChange(before, after) {
  const lit = !sameArr(before.literals, after.literals);
  const calls = !sameArr(before.calls, after.calls);
  const ctrl = !sameControl(before.control, after.control);
  if (lit && !calls && !ctrl) return 'literals';
  if (ctrl && !lit && !calls) return 'control-flow';
  if (calls && !lit && !ctrl) return 'calls';
  if (lit || calls || ctrl) return 'mixed';
  return 'body';
}

function collectImplMap(graph) {
  const map = new Map();
  for (const n of (graph && graph.nodes) || []) {
    if (n.impl && n.impl.hash) {
      map.set(n.id, {
        id: n.id,
        name: n.name,
        kind: n.kind,
        path: n.path,
        line: n.line,
        owner: null,
        method: n.name,
        hash: n.impl.hash,
        literals: n.impl.literals || [],
        calls: n.impl.calls || [],
        throws: n.impl.throws || [],
        awaits: n.impl.awaits || [],
        control: n.impl.control || emptyControl()
      });
    }
    const methods = n.methodImpls || {};
    for (const [key, impl] of Object.entries(methods)) {
      if (!impl || !impl.hash) continue;
      map.set(n.id + '::' + key, {
        id: n.id,
        name: n.name,
        kind: n.kind,
        path: n.path,
        line: impl.line || n.line,
        owner: n.name,
        method: key,
        hash: impl.hash,
        literals: impl.literals || [],
        calls: impl.calls || [],
        throws: impl.throws || [],
        awaits: impl.awaits || [],
        control: impl.control || emptyControl()
      });
    }
  }
  return map;
}

function diffImpls(baseGraph, headGraph) {
  const base = collectImplMap(baseGraph);
  const head = collectImplMap(headGraph);
  const changes = [];
  for (const [key, h] of head) {
    const b = base.get(key);
    if (!b || b.hash === h.hash) continue;
    const change = classifyImplChange(b, h);
    const lit = arrDelta(b.literals, h.literals);
    const calls = arrDelta(b.calls, h.calls);
    changes.push({
      id: h.id,
      name: h.name,
      kind: h.kind,
      path: h.path || null,
      line: h.line || null,
      owner: h.owner,
      method: h.method,
      change,
      addedLiterals: lit.added.slice(0, 8),
      removedLiterals: lit.removed.slice(0, 8),
      addedCalls: calls.added.slice(0, 8),
      removedCalls: calls.removed.slice(0, 8)
    });
  }
  changes.sort((a, b) => String(a.path || '').localeCompare(String(b.path || ''))
    || String(a.method || '').localeCompare(String(b.method || '')));
  return changes;
}

function implKindCounts(changes) {
  const kinds = {};
  for (const c of changes || []) kinds[c.change] = (kinds[c.change] || 0) + 1;
  return kinds;
}

function formatImplSymbol(c) {
  return c.owner ? `${c.owner}.${c.method}` : (c.method || c.name || c.id);
}

function applyImplChanged(findings, diff) {
  const changes = (diff && diff.implChanges) || [];
  if (!changes.length) return;
  const kinds = implKindCounts(changes);
  const kindBits = Object.entries(kinds)
    .map(([k, n]) => `${IMPL_KIND_LABEL[k] || k} ${n}`)
    .join('、');
  const shown = changes.slice(0, 12);
  const detail = shown.map((c) => `${formatImplSymbol(c)} (${IMPL_KIND_LABEL[c.change] || c.change})`).join(' · ')
    + (changes.length > shown.length ? ` …共 ${changes.length} 个` : '');
  findings.push({
    rule: 'impl-changed',
    severity: 'info',
    title: '业务实现有变化',
    message: `${changes.length} 个函数/方法的函数体变了（${kindBits}）。架构结构可以没变。未判定对错，请用测试覆盖这些符号。`,
    detail,
    suggestion: '对列出的函数补单元测试 / 集成测试，并做代码审查。本工具只标出函数体变了，不验证业务是否算对。',
    file: changes[0].path || null,
    line: changes[0].line || null
  });
}

function formatImplDiffText(changes) {
  if (!changes || !changes.length) return '';
  const lines = ['--- 实现差异（函数体，不进结构指纹） ---'];
  for (const c of changes.slice(0, REPORT_CAP)) {
    const bits = [];
    if (c.addedLiterals && c.addedLiterals.length) bits.push('+' + c.addedLiterals.map((s) => JSON.stringify(s)).join(', '));
    if (c.removedLiterals && c.removedLiterals.length) bits.push('-' + c.removedLiterals.map((s) => JSON.stringify(s)).join(', '));
    if (c.addedCalls && c.addedCalls.length) bits.push('+call ' + c.addedCalls.join(', '));
    if (c.removedCalls && c.removedCalls.length) bits.push('-call ' + c.removedCalls.join(', '));
    const extra = bits.length ? '  ' + bits.join(' · ') : '';
    lines.push(`  ~ ${formatImplSymbol(c)} [${IMPL_KIND_LABEL[c.change] || c.change}] ${c.path || ''}${extra}`);
  }
  if (changes.length > REPORT_CAP) lines.push(`  …另有 ${changes.length - REPORT_CAP} 个`);
  lines.push('  （未判定业务对错：请配合单元测试、集成测试和代码审查）');
  lines.push('');
  return lines.join('\n');
}

function methodImplsFromMembers(entity) {
  if (entity.methodImpls) return entity.methodImpls;
  const members = (entity.members || []).filter((m) => m.kind === 'method' && m.impl && m.impl.hash);
  if (!members.length) return undefined;
  const out = {};
  const seen = {};
  for (const m of members) {
    seen[m.name] = (seen[m.name] || 0) + 1;
    const key = seen[m.name] === 1 ? m.name : m.name + '#' + seen[m.name];
    out[key] = Object.assign({ line: m.line || null }, m.impl);
  }
  return out;
}

module.exports = {
  extractImpl,
  finalizeImpl,
  classifyImplChange,
  collectImplMap,
  diffImpls,
  applyImplChanged,
  formatImplDiffText,
  formatImplSymbol,
  methodImplsFromMembers,
  implKindCounts,
  IMPL_KIND_LABEL,
  REPORT_CAP
};
