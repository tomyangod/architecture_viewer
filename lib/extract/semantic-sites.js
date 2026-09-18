'use strict';

/**
 * Switch / match / if-chain sites and catch/except sites.
 * Used by W21 R18 (enum exhaustiveness) and R19 (exception contract drift).
 * Heuristic, offline, tree-sitter only.
 */

const SWITCH_TYPES = new Set([
  'switch_statement', 'switch_expression', 'match_statement',
  'expression_switch_statement', 'type_switch_statement'
]);

const CATCH_TYPES = new Set([
  'catch_clause', 'except_clause', 'except_group_clause', 'catch'
]);

const STRING_TYPES = new Set([
  'string', 'string_literal', 'string_fragment', 'interpreted_string_literal',
  'raw_string_literal', 'character_literal', 'char_literal'
]);

function uniq(list) {
  return [...new Set((list || []).filter(Boolean).map(String))];
}

function unquote(text) {
  return String(text || '').replace(/^['"`]+|['"`]+$/g, '').trim();
}

function leafNames(node, acc) {
  if (!node) return acc;
  if (STRING_TYPES.has(node.type)) {
    const t = unquote(node.text);
    if (t) acc.push(t);
    return acc;
  }
  if (node.type === 'identifier' || node.type === 'property_identifier'
    || node.type === 'type_identifier' || node.type === 'field_identifier') {
    if (!/^(case|default|switch|match|if|else|when)$/i.test(node.text)) acc.push(node.text);
    return acc;
  }
  if (node.childCount === 0) return acc;
  for (let i = 0; i < node.childCount; i++) leafNames(node.child(i), acc);
  return acc;
}

function isDefaultLabel(node) {
  if (!node) return false;
  const t = node.type || '';
  if (t === 'switch_default' || t === 'default_case' || t === 'default') return true;
  if (t === 'wildcard_pattern') return true;
  const text = String(node.text || '').trim();
  if (text === 'default' || text === '_' || text.startsWith('default:') || text === 'case _:' || text === 'case _') return true;
  if (t === 'case_clause' && /(^|\s)_(\s|:|$)/.test(text)) return true;
  return false;
}

function collectCaseLabels(body) {
  const cases = [];
  let hasDefault = false;
  if (!body) return { cases, hasDefault };
  const stack = [body];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (isDefaultLabel(n)) hasDefault = true;
    const t = n.type;
    if (t === 'switch_case' || t === 'expression_case' || t === 'type_case'
      || t === 'case_clause' || t === 'switch_label') {
      let val = n.childForFieldName('value') || n.childForFieldName('pattern');
      if (!val) {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c.type === 'case_pattern' || c.type === 'expression_list' || c.type === 'pattern') {
            val = c;
            break;
          }
        }
      }
      if (val) leafNames(val, cases);
      else {
        // fall back: only the first line / label, not the case body
        const label = String(n.text || '').split('\n')[0];
        const m = label.match(/case\s+(.+?):?\s*$/);
        if (m) leafNames({ type: 'identifier', text: m[1].trim(), childCount: 0 }, cases);
      }
      if (isDefaultLabel(n) || isDefaultLabel(val)) hasDefault = true;
      continue;
    }
    if (t === 'switch_block_statement_group') {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c.type === 'switch_label' || c.type === 'switch_rule') {
          if (isDefaultLabel(c) || /\bdefault\b/.test(c.text)) hasDefault = true;
          leafNames(c, cases);
        }
      }
      continue;
    }
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i));
  }
  return { cases: uniq(cases).filter((c) => !/^(case|default|break|switch)$/i.test(c)), hasDefault };
}

function discriminantOf(node) {
  const v = node.childForFieldName('value')
    || node.childForFieldName('condition')
    || node.childForFieldName('subject');
  if (v) return String(v.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return '';
}

function collectIfChain(node) {
  const cases = [];
  let hasDefault = false;
  let disc = '';
  function walkIf(n, isElse) {
    if (!n) return;
    if (n.type !== 'if_statement' && n.type !== 'if_expression') {
      if (isElse) hasDefault = true;
      return;
    }
    const cond = n.childForFieldName('condition') || n.childForFieldName('consequence');
    if (!disc && n.childForFieldName('condition')) {
      disc = String(n.childForFieldName('condition').text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    }
    leafNames(n.childForFieldName('condition'), cases);
    const alt = n.childForFieldName('alternative');
    if (!alt) return;
    if (alt.type === 'if_statement' || alt.type === 'if_expression' || alt.type === 'elif_clause') {
      walkIf(alt, false);
      return;
    }
    // else { if (...) } wrapper
    if (alt.namedChildCount === 1 && (alt.namedChild(0).type === 'if_statement' || alt.namedChild(0).type === 'if_expression')) {
      walkIf(alt.namedChild(0), false);
      return;
    }
    hasDefault = true;
  }
  walkIf(node, false);
  return {
    kind: 'if-chain',
    discriminant: disc,
    cases: uniq(cases).filter((c) => !/^(if|else|===|==|=)$/i.test(c)),
    hasDefault,
    line: node.startPosition.row + 1
  };
}

function looksLikeEnumIf(chain) {
  if (!chain || (chain.cases || []).length < 2) return false;
  return true;
}

function isFnLike(node, lang) {
  if (!node) return false;
  const t = node.type;
  if (lang === 'python') return t === 'function_definition';
  if (lang === 'java') return t === 'method_declaration' || t === 'constructor_declaration';
  if (lang === 'go') return t === 'function_declaration' || t === 'method_declaration';
  return t === 'function_declaration' || t === 'generator_function_declaration'
    || t === 'method_definition' || t === 'arrow_function'
    || t === 'function_expression' || t === 'function';
}

function fnLikeName(node, lang) {
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

/** Nearest enclosing function/method name; null = module / file top-level. */
function enclosingFnOwner(catchNode, lang) {
  let p = catchNode && catchNode.parent;
  while (p) {
    if (isFnLike(p, lang)) return fnLikeName(p, lang) || null;
    p = p.parent;
  }
  return null;
}

function enclosingTry(catchNode) {
  let p = catchNode && catchNode.parent;
  while (p) {
    const t = p.type || '';
    if (t === 'try_statement' || t === 'try_expression' || t === 'try') return p;
    p = p.parent;
  }
  return null;
}

/**
 * Module-level optional-load / require / import fallbacks (e.g. web/server.js
 * try { require('./pro') } catch {}). These should not count as catching
 * business exceptions for file entrypoints.
 */
function looksLikeLoadGuard(tryNode) {
  if (!tryNode) return false;
  const body = tryNode.childForFieldName('body') || tryNode;
  const text = String(body.text || '');
  const nonempty = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length;
  if (nonempty > 12) return false;
  return /\brequire\s*\(|\bimport\s*\(|\bimport\s+[\w*{]|from\s+[\w.]+\s+import\b|__import__\s*\(|import_module\s*\(|readFileSync\s*\([^)]*package\.json/i.test(text);
}

function collectCatch(node, lang) {
  const names = [];
  leafNames(node, names);
  const filtered = uniq(names).filter((n) => !/^(catch|except|as|e|err|error|ex|Exception)$/i.test(n) || /Error$|Exception$/.test(n));
  const tryNode = enclosingTry(node);
  const owner = enclosingFnOwner(node, lang);
  return {
    types: filtered,
    line: node.startPosition.row + 1,
    hasCatchAll: filtered.length === 0 || names.includes('_') || /\bexcept\s*:/.test(node.text),
    owner,
    tryStart: tryNode ? tryNode.startPosition.row + 1 : node.startPosition.row + 1,
    tryEnd: tryNode ? tryNode.endPosition.row + 1 : node.endPosition.row + 1,
    loadGuard: owner == null && looksLikeLoadGuard(tryNode)
  };
}

function collectSemanticSites(root, lang) {
  const switchSites = [];
  const catchSites = [];
  if (!root) return { switchSites, catchSites };

  function walk(node, inIfChain) {
    if (!node) return;
    if (SWITCH_TYPES.has(node.type)) {
      const body = node.childForFieldName('body') || node;
      const { cases, hasDefault } = collectCaseLabels(body);
      switchSites.push({
        kind: node.type === 'match_statement' ? 'match' : 'switch',
        lang: lang || null,
        discriminant: discriminantOf(node),
        cases,
        hasDefault,
        line: node.startPosition.row + 1
      });
    } else if ((node.type === 'if_statement' || node.type === 'if_expression') && !inIfChain) {
      const chain = collectIfChain(node);
      if (looksLikeEnumIf(chain)) switchSites.push(chain);
      const alt = node.childForFieldName('alternative');
      const cons = node.childForFieldName('consequence');
      walk(cons, false);
      if (alt && (alt.type === 'if_statement' || alt.type === 'if_expression' || alt.type === 'elif_clause')) {
        walk(alt, true);
      } else {
        walk(alt, false);
      }
      return;
    } else if (CATCH_TYPES.has(node.type)) {
      catchSites.push(collectCatch(node, lang));
    }
    for (let i = 0; i < node.childCount; i++) walk(node.child(i), inIfChain);
  }
  walk(root, false);
  return { switchSites, catchSites };
}

function attachSites(result, ast, lang) {
  if (!result || !ast) return result;
  const sites = collectSemanticSites(ast, lang || result.lang);
  result.switchSites = sites.switchSites;
  result.catchSites = sites.catchSites;
  return result;
}

function enumValuesFromEntity(e) {
  if (!e) return undefined;
  const raw = [];
  if (Array.isArray(e.enumValues)) raw.push(...e.enumValues);
  for (const m of e.members || []) {
    if (!m || !m.name) continue;
    if (m.kind === 'method' || m.kind === 'constructor') continue;
    raw.push(m.name);
  }
  const values = uniq(raw).sort();
  if (!values.length) return undefined;
  if (e.kind === 'enum' || e.kind === 'type_alias' || e.enumLike) return values;
  return undefined;
}

function siteCoversValue(site, value) {
  if (!site || !value) return false;
  const needle = String(value);
  for (const c of site.cases || []) {
    if (c === needle) return true;
    if (c.endsWith('.' + needle) || c.endsWith('::' + needle)) return true;
  }
  return false;
}

function siteTouchesEnum(site, enumName, values) {
  if (!site) return false;
  const disc = String(site.discriminant || '');
  if (enumName && disc.includes(enumName)) return true;
  const known = new Set(values || []);
  if (enumName) known.add(enumName);
  for (const c of site.cases || []) {
    if (known.has(c)) return true;
    for (const v of values || []) {
      if (c.endsWith('.' + v) || c.endsWith('::' + v)) return true;
    }
    if (enumName && (c === enumName || c.startsWith(enumName + '.') || c.startsWith(enumName + '::'))) return true;
  }
  return false;
}

module.exports = {
  collectSemanticSites,
  attachSites,
  enumValuesFromEntity,
  siteCoversValue,
  siteTouchesEnum
};
