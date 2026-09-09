'use strict';

/**
 * architecture-rules.yaml — 团队制图规范。
 * 对照 C4 图源的节点 id / Rel，做命名、分层归属、跨层禁止、Rel 白名单。
 * YAML 子集解析器（无第三方依赖）：映射、列表、行内数组、引号标量、# 注释。
 */

const fs = require('fs');
const path = require('path');
const { DIAGRAM_FILES } = require('./kit');
const { extractBlocks } = require('./validate');

const RULES_BASENAME = 'architecture-rules.yaml';

const C4_NODE = /(Person_Ext|Person|SystemDb_Ext|SystemQueue_Ext|SystemDb|SystemQueue|System_Ext|System|ContainerDb_Ext|ContainerQueue_Ext|Container_Ext|ContainerDb|ContainerQueue|Container|Component_Ext|Component|Enterprise_Boundary|System_Boundary|Container_Boundary)\s*\(\s*([A-Za-z_][\w]*)/g;
const C4_REL = /Rel(?:_[A-Za-z]+)?\s*\(\s*([A-Za-z_][\w]*)\s*,\s*([A-Za-z_][\w]*)(?:\s*,\s*(?:"([^"]*)"|'([^']*)'|([^,)\s][^,)]*)))?(?:\s*,\s*(?:"([^"]*)"|'([^']*)'|([^,)]+)))?/g;

function kindOf(rawKind) {
  if (/^Person/.test(rawKind)) return 'person';
  if (/Boundary$/.test(rawKind)) return 'boundary';
  if (/^System/.test(rawKind)) return 'system';
  if (/^Container/.test(rawKind)) return 'container';
  if (/^Component/.test(rawKind)) return 'component';
  return rawKind.toLowerCase();
}

function extractDiagramModel(content, file) {
  const { blocks } = extractBlocks(content);
  const nodes = [];
  const seen = new Set();
  const rels = [];
  blocks.forEach((block, i) => {
    const sub = i + 1;
    C4_NODE.lastIndex = 0;
    let m;
    while ((m = C4_NODE.exec(block.code))) {
      const id = m[2];
      const key = id + '@' + sub;
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push({ id, kind: kindOf(m[1]), rawKind: m[1], sub, file });
    }
    C4_REL.lastIndex = 0;
    while ((m = C4_REL.exec(block.code))) {
      const label = (m[3] || m[4] || (m[5] && m[5].trim()) || '').trim();
      const tech = (m[6] || m[7] || (m[8] && m[8].trim()) || '').trim();
      rels.push({ from: m[1], to: m[2], label, tech, sub, file });
    }
  });
  return { file, nodes, rels };
}

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === q && line[i - 1] !== '\\') q = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseInlineArray(s) {
  const inner = s.slice(1, -1);
  const items = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (q) {
      if (ch === q) q = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      continue;
    }
    if (ch === ',') {
      items.push(parseScalar(cur));
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '' || items.length) items.push(parseScalar(cur));
  return items.filter((x) => x !== undefined);
}

function parseScalar(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s.startsWith('[') && s.endsWith(']')) return parseInlineArray(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

function parseYaml(text) {
  const rows = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const cut = stripComment(raw);
    if (!cut.trim()) continue;
    const indent = cut.match(/^ */)[0].length;
    rows.push({ indent, text: cut.trim() });
  }
  let i = 0;
  function parseBlock(minIndent) {
    if (i >= rows.length || rows[i].indent < minIndent) return null;
    const list = i < rows.length && rows[i].text.startsWith('- ');
    return list ? parseList(minIndent) : parseMap(minIndent);
  }
  function parseMap(minIndent) {
    const obj = {};
    while (i < rows.length && rows[i].indent >= minIndent && !rows[i].text.startsWith('- ')) {
      const row = rows[i];
      if (row.indent !== minIndent && Object.keys(obj).length) break;
      const m = row.text.match(/^([^:]+):(.*)$/);
      if (!m) {
        i += 1;
        continue;
      }
      const key = m[1].trim();
      const rest = m[2].trim();
      i += 1;
      if (rest !== '') {
        obj[key] = parseScalar(rest);
      } else if (i < rows.length && rows[i].indent > row.indent) {
        obj[key] = parseBlock(rows[i].indent);
      } else {
        obj[key] = null;
      }
    }
    return obj;
  }
  function parseList(minIndent) {
    const arr = [];
    while (i < rows.length && rows[i].indent === minIndent && rows[i].text.startsWith('- ')) {
      const body = rows[i].text.slice(2).trim();
      const indent = rows[i].indent;
      i += 1;
      if (!body) {
        arr.push(i < rows.length && rows[i].indent > indent ? parseBlock(rows[i].indent) : null);
        continue;
      }
      const km = body.match(/^([^:]+):(.*)$/);
      if (km && !body.startsWith('[') && !/^['"]/.test(body)) {
        const item = {};
        const rest = km[2].trim();
        item[km[1].trim()] = rest === '' ? null : parseScalar(rest);
        if (i < rows.length && rows[i].indent > indent) {
          const nested = parseBlock(rows[i].indent);
          if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
            Object.assign(item, nested);
          } else if (item[km[1].trim()] == null) {
            item[km[1].trim()] = nested;
          }
        }
        arr.push(item);
      } else {
        arr.push(parseScalar(body));
      }
    }
    return arr;
  }
  return parseBlock(0) || {};
}

function globToRegExp(glob) {
  const src = String(glob)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp('^' + src + '$');
}

function asList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function normalizeRules(raw, filePath) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const layers = {};
  const layerSrc = src.layers && typeof src.layers === 'object' ? src.layers : {};
  for (const [name, spec] of Object.entries(layerSrc)) {
    const match = spec && typeof spec === 'object' && !Array.isArray(spec)
      ? asList(spec.match)
      : asList(spec);
    layers[name] = match.map(String).filter(Boolean);
  }
  return {
    version: src.version || 1,
    name: src.name || null,
    naming: asList(src.naming).filter((r) => r && r.pattern),
    layers,
    forbid_cross_layer: asList(src.forbid_cross_layer).filter((r) => r && r.from && r.to),
    rel_whitelist: asList(src.rel_whitelist).filter((r) => r && (r.labels || r.via)),
    risk: normalizeRisk(src.risk),
    _file: filePath || null
  };
}

const DEFAULT_RISK_THRESHOLDS = {
  broad_impact: 10,
  broad_impact_high: 20,
  removed_type_low: 3,
  high_fanout: 5,
  high_fanout_medium: 8,
  god_file: 800,
  large_file: 400,
  growth_abs_low: 150,
  growth_rel_low: 40,
  growth_abs_med: 300,
  growth_rel_med: 100,
  growth_rel_min_base: 100,
  cycle_cap: 5
};

function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function normalizeRisk(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const t = src.thresholds && typeof src.thresholds === 'object' ? src.thresholds : {};
  const thresholds = {};
  for (const [key, def] of Object.entries(DEFAULT_RISK_THRESHOLDS)) {
    thresholds[key] = numOr(t[key] ?? t[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())], def);
  }
  const disable = asList(src.disable).map(String).filter(Boolean);
  const exclude = asList(src.exclude).filter((e) => e && e.path).map((e) => ({
    rule: e.rule ? String(e.rule) : '*',
    path: String(e.path)
  }));
  return { thresholds, disable, exclude };
}

/** Path glob: `*` = one segment, `**` = any depth. */
function pathGlobToRegExp(glob) {
  const src = String(glob)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GS}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GS\}\}/g, '.*');
  return new RegExp('^' + src + '$');
}

function pathMatchesGlob(filePath, glob) {
  if (!filePath || !glob) return false;
  const norm = String(filePath).split(path.sep).join('/');
  return pathGlobToRegExp(glob).test(norm);
}


function loadRules(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    const err = new Error('Rules file not found: ' + abs);
    err.code = 'RULES_NOT_FOUND';
    throw err;
  }
  const raw = parseYaml(fs.readFileSync(abs, 'utf8'));
  return normalizeRules(raw, abs);
}

function resolveRulesPath(opts) {
  const options = opts || {};
  if (options.rules === false) return null;
  if (typeof options.rules === 'string' && options.rules) {
    return path.resolve(options.rules);
  }
  const candidates = [];
  if (options.kitDir) candidates.push(path.join(options.kitDir, RULES_BASENAME));
  if (options.repo) candidates.push(path.join(options.repo, RULES_BASENAME));
  if (options.kitDir) candidates.push(path.join(options.kitDir, '..', RULES_BASENAME));
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function assignLayer(id, layers) {
  for (const [layer, globs] of Object.entries(layers || {})) {
    for (const g of globs) {
      if (globToRegExp(g).test(id)) return layer;
    }
  }
  return null;
}

function compilePattern(pattern) {
  const src = String(pattern);
  if (src.startsWith('/') && src.lastIndexOf('/') > 0) {
    const last = src.lastIndexOf('/');
    return new RegExp(src.slice(1, last), src.slice(last + 1));
  }
  return new RegExp(src);
}

function checkNaming(rules, model, violations) {
  for (const rule of rules.naming) {
    let re;
    try {
      re = compilePattern(rule.pattern);
    } catch (e) {
      violations.push({
        rule: rule.id || 'naming',
        kind: 'naming',
        file: model.file,
        message: '命名正则无效: ' + e.message,
        detail: String(rule.pattern)
      });
      continue;
    }
    const on = String(rule.on || 'id').toLowerCase();
    for (const node of model.nodes) {
      if (on !== 'id' && node.kind !== on) continue;
      if (re.test(node.id)) continue;
      violations.push({
        rule: rule.id || 'naming',
        kind: 'naming',
        file: model.file,
        message: rule.message || ('节点 id 不符合命名规则 ' + (rule.id || rule.pattern)),
        detail: node.id + ' (' + node.rawKind + ' sub-' + node.sub + ')'
      });
    }
  }
}

function checkCrossLayer(rules, model, violations) {
  if (!rules.forbid_cross_layer.length) return;
  const layerOf = new Map();
  for (const node of model.nodes) {
    if (!layerOf.has(node.id)) layerOf.set(node.id, assignLayer(node.id, rules.layers));
  }
  for (const rule of rules.forbid_cross_layer) {
    for (const rel of model.rels) {
      const fromL = layerOf.get(rel.from);
      const toL = layerOf.get(rel.to);
      if (fromL !== rule.from || toL !== rule.to) continue;
      violations.push({
        rule: rule.id || ('forbid-' + rule.from + '-to-' + rule.to),
        kind: 'cross_layer',
        file: model.file,
        message: rule.message || (rule.from + ' 层不得直接依赖 ' + rule.to + ' 层'),
        detail: rel.from + ' → ' + rel.to + (rel.label ? ' [' + rel.label + ']' : '') + ' (sub-' + rel.sub + ')'
      });
    }
  }
}

function checkRelWhitelist(rules, model, violations) {
  if (!rules.rel_whitelist.length) return;
  for (const rel of model.rels) {
    if (!rel.label) {
      const denyEmpty = rules.rel_whitelist.some((w) => w.allow_empty === false);
      if (!denyEmpty) continue;
    }
    const ok = rules.rel_whitelist.some((w) => relMatchesWhitelist(rel, w, model));
    if (ok) continue;
    const ids = rules.rel_whitelist.map((w) => w.id).filter(Boolean).join('|') || 'rel_whitelist';
    violations.push({
      rule: ids,
      kind: 'rel_whitelist',
      file: model.file,
      message: 'Rel 标签不在白名单',
      detail: 'Rel(' + rel.from + ', ' + rel.to + ', "' + rel.label + '") (sub-' + rel.sub + ')'
    });
  }
}

function relMatchesWhitelist(rel, rule, model) {
  if (rule.from_kind || rule.to_kind) {
    const fromNode = model.nodes.find((n) => n.id === rel.from);
    const toNode = model.nodes.find((n) => n.id === rel.to);
    if (rule.from_kind && (!fromNode || fromNode.kind !== String(rule.from_kind).toLowerCase())) return false;
    if (rule.to_kind && (!toNode || toNode.kind !== String(rule.to_kind).toLowerCase())) return false;
  }
  const labels = asList(rule.labels || rule.via).map((x) => String(x).toLowerCase());
  if (!labels.length) return true;
  if (!rel.label) return rule.allow_empty !== false;
  return labels.includes(rel.label.toLowerCase());
}

function evaluateRules(rules, kitDir) {
  if (!rules) return { ok: true, violations: [], name: null, file: null };
  const violations = [];
  for (const f of DIAGRAM_FILES) {
    const p = path.join(kitDir, f);
    if (!fs.existsSync(p)) continue;
    const model = extractDiagramModel(fs.readFileSync(p, 'utf8'), f);
    checkNaming(rules, model, violations);
    checkCrossLayer(rules, model, violations);
    checkRelWhitelist(rules, model, violations);
  }
  return {
    ok: violations.length === 0,
    violations,
    name: rules.name || null,
    file: rules._file || null
  };
}

function evaluateKitRules(kitDir, opts) {
  const options = opts || {};
  const resolved = resolveRulesPath({
    rules: options.rules,
    kitDir,
    repo: options.repo
  });
  if (!resolved) return null;
  const rules = loadRules(resolved);
  return evaluateRules(rules, kitDir);
}

function formatRuleViolations(result) {
  if (!result || !result.violations || !result.violations.length) return [];
  return result.violations.map((v) => {
    const where = v.file ? v.file + ': ' : '';
    const detail = v.detail ? ' — ' + v.detail : '';
    return '[' + v.rule + '] ' + where + v.message + detail;
  });
}

module.exports = {
  RULES_BASENAME,
  parseYaml,
  normalizeRules,
  loadRules,
  resolveRulesPath,
  extractDiagramModel,
  assignLayer,
  evaluateRules,
  evaluateKitRules,
  formatRuleViolations,
  DEFAULT_RISK_THRESHOLDS,
  normalizeRisk,
  pathGlobToRegExp,
  pathMatchesGlob
};
