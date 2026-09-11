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
      if (ch === '\\' && q === '"') { i++; continue; }
      if (ch === q) {
        if (q === "'" && line[i + 1] === "'") i++;
        else q = null;
      }
      continue;
    }
    if ((ch === '"' || ch === "'") && (i === 0 || /[\s[:,]/.test(line[i - 1]))) {
      q = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function rulesError(message) {
  const error = new Error('Invalid architecture rules: ' + message);
  error.code = 'RULES_CONFIG_ERROR';
  return error;
}

function parseInlineArray(s) {
  const inner = s.slice(1, -1);
  const items = [];
  let cur = '';
  let q = null;
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (q) {
      cur += ch;
      if (ch === '\\' && q === '"' && i + 1 < inner.length) {
        cur += inner[++i];
      } else if (ch === q) {
        if (q === "'" && inner[i + 1] === "'") cur += inner[++i];
        else q = null;
      }
      continue;
    }
    if ((ch === '"' || ch === "'") && !cur.trim()) {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === '[') depth++;
    if (ch === ']' && --depth < 0) throw rulesError('unexpected ] in inline array');
    if (ch === ',' && depth === 0) {
      if (!cur.trim()) throw rulesError('empty inline array item');
      items.push(parseScalar(cur));
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (q || depth) throw rulesError('unclosed quote or array');
  if (cur.trim() !== '') items.push(parseScalar(cur));
  return items;
}

function parseScalar(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) throw rulesError('unclosed inline array');
    return parseInlineArray(s);
  }
  if (/^[\]{}|>]/.test(s)) throw rulesError('unsupported YAML scalar: ' + s);
  if (/^["']/.test(s)) {
    const q = s[0];
    let value = '';
    for (let i = 1; i < s.length; i++) {
      const ch = s[i];
      if (ch === q) {
        if (q === "'" && s[i + 1] === "'") { value += q; i++; continue; }
        if (i !== s.length - 1) throw rulesError('unexpected text after quoted scalar');
        return value;
      }
      if (q === '"' && ch === '\\' && i + 1 < s.length) {
        const next = s[++i];
        value += ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' })[next] ?? '\\' + next;
      } else {
        value += ch;
      }
    }
    throw rulesError('unclosed quoted scalar');
  }
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

function parseYaml(text) {
  const rows = [];
  for (const [index, raw] of String(text || '').split(/\r?\n/).entries()) {
    const cut = stripComment(raw);
    if (!cut.trim()) continue;
    if (/^ *\t/.test(cut)) throw rulesError(`line ${index + 1}: tab indentation is unsupported`);
    const indent = cut.match(/^ */)[0].length;
    rows.push({ indent, text: cut.trim(), line: index + 1 });
  }
  let i = 0;
  const isList = (row) => /^-(?:\s|$)/.test(row.text);
  function fail(message, row = rows[i]) {
    throw rulesError(`line ${row ? row.line : 'EOF'}: ${message}`);
  }
  function set(obj, key, value, row) {
    if (!key || /[{}[\]"']/.test(key)) fail('unsupported mapping key', row);
    if (Object.hasOwn(obj, key)) fail('duplicate key: ' + key, row);
    Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
  }
  function readEntry(obj, text, indent, row) {
    const m = text.match(/^([^:]+):(.*)$/);
    if (!m) fail('expected key: value', row);
    const rest = m[2].trim();
    let value;
    try {
      value = rest ? parseScalar(rest)
        : (i < rows.length && rows[i].indent > indent ? parseBlock(rows[i].indent) : null);
    } catch (e) {
      if (!e.message.includes('line ')) fail(e.message, row);
      throw e;
    }
    set(obj, m[1].trim(), value, row);
  }
  function parseBlock(minIndent) {
    if (i >= rows.length || rows[i].indent < minIndent) return null;
    const list = isList(rows[i]);
    return list ? parseList(minIndent) : parseMap(minIndent);
  }
  function parseMap(minIndent) {
    const obj = {};
    while (i < rows.length && rows[i].indent >= minIndent) {
      const row = rows[i];
      if (row.indent !== minIndent || isList(row)) fail('unexpected indentation or list item', row);
      i += 1;
      readEntry(obj, row.text, row.indent, row);
    }
    return obj;
  }
  function parseList(minIndent) {
    const arr = [];
    while (i < rows.length && rows[i].indent === minIndent && isList(rows[i])) {
      const row = rows[i];
      const contentOffset = row.text.match(/^-\s*/)[0].length;
      const body = row.text.slice(contentOffset);
      const indent = rows[i].indent;
      i += 1;
      if (!body) {
        arr.push(i < rows.length && rows[i].indent > indent ? parseBlock(rows[i].indent) : null);
        continue;
      }
      const km = body.match(/^([^:]+):(?:\s|$)/);
      if (km && !body.startsWith('[') && !/^['"]/.test(body)) {
        const item = {};
        const itemIndent = indent + contentOffset;
        readEntry(item, body, itemIndent, row);
        if (i < rows.length && rows[i].indent > indent) {
          if (rows[i].indent !== itemIndent || isList(rows[i])) fail('unexpected list mapping indentation');
          const nested = parseMap(itemIndent);
          for (const [key, value] of Object.entries(nested)) set(item, key, value, row);
        }
        arr.push(item);
      } else {
        arr.push(parseScalar(body));
      }
    }
    return arr;
  }
  const result = parseBlock(0) || {};
  if (i !== rows.length) fail('unexpected trailing content or indentation');
  return result;
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
  validateRules(raw);
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
    // Session-only: declarative business/contract assertions (not C4 check).
    invariants: asList(src.invariants).filter(isInvariantRule).map(normalizeInvariant),
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

function validateRules(raw) {
  const object = (value, at) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw rulesError(at + ' must be a mapping');
  };
  const keys = (value, allowed, at) => {
    object(value, at);
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) throw rulesError(at + ': unknown field ' + key);
    }
  };
  const string = (value, at) => {
    if (typeof value !== 'string' || !value.trim()) throw rulesError(at + ' must be a non-empty string');
  };
  const strings = (value, at) => {
    if (value == null) throw rulesError(at + ' must be a string or list');
    for (const item of asList(value)) string(item, at);
  };
  const optionalStrings = (value, fields, at) => {
    for (const field of fields) if (Object.hasOwn(value, field)) string(value[field], at + '.' + field);
  };
  const rules = (field, fields, validate) => {
    if (!Object.hasOwn(raw, field)) return;
    if (raw[field] == null) throw rulesError(field + ' must be a rule mapping or list (use [] for no rules)');
    asList(raw[field]).forEach((rule, index) => {
      const at = `${field}[${index}]`;
      keys(rule, ['id', 'message', ...fields], at);
      optionalStrings(rule, ['id', 'message'], at);
      validate(rule, at);
    });
  };
  keys(raw, ['version', 'name', 'naming', 'layers', 'forbid_cross_layer', 'rel_whitelist', 'invariants', 'risk'], 'rules');
  if (Object.hasOwn(raw, 'version') && String(raw.version) !== '1') throw rulesError('unsupported rules version');
  if (Object.hasOwn(raw, 'name')) string(raw.name, 'name');
  rules('naming', ['pattern', 'on'], (rule, at) => {
    string(rule.pattern, at + '.pattern');
    optionalStrings(rule, ['on'], at);
    try { compilePattern(rule.pattern); } catch (e) { throw rulesError(at + '.pattern: ' + e.message); }
  });
  if (Object.hasOwn(raw, 'layers')) {
    object(raw.layers, 'layers');
    for (const [name, spec] of Object.entries(raw.layers)) {
      const at = 'layers.' + name;
      if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
        keys(spec, ['match'], at);
        strings(spec.match, at + '.match');
      } else {
        strings(spec, at);
      }
    }
  }
  rules('forbid_cross_layer', ['from', 'to'], (rule, at) => {
    string(rule.from, at + '.from');
    string(rule.to, at + '.to');
  });
  rules('rel_whitelist', ['labels', 'via', 'allow_empty', 'from_kind', 'to_kind'], (rule, at) => {
    if (!Object.hasOwn(rule, 'labels') && !Object.hasOwn(rule, 'via')) throw rulesError(at + ' requires labels or via');
    for (const field of ['labels', 'via']) if (Object.hasOwn(rule, field)) strings(rule[field], at + '.' + field);
    optionalStrings(rule, ['from_kind', 'to_kind'], at);
    if (Object.hasOwn(rule, 'allow_empty') && typeof rule.allow_empty !== 'boolean') throw rulesError(at + '.allow_empty must be boolean');
  });
  rules('invariants', ['when', 'forbid', 'require', 'severity'], (rule, at) => {
    if (!isInvariantRule(rule)) throw rulesError(at + ' requires a non-empty forbid or require constraint');
    const nested = {
      when: ['route'],
      forbid: ['from_layer', 'to_layer', 'edge_type'],
      require: ['import_layer', 'calls_through_layer']
    };
    for (const [field, fields] of Object.entries(nested)) {
      if (!Object.hasOwn(rule, field)) continue;
      keys(rule[field], fields, at + '.' + field);
      optionalStrings(rule[field], fields, at + '.' + field);
      if (field !== 'when' && !Object.keys(rule[field]).length) throw rulesError(at + '.' + field + ' cannot be empty');
    }
    if (Object.hasOwn(rule, 'severity') && !['high', 'medium', 'low'].includes(String(rule.severity).toLowerCase())) {
      throw rulesError(at + '.severity must be high, medium or low');
    }
  });
  if (Object.hasOwn(raw, 'risk')) {
    keys(raw.risk, ['thresholds', 'disable', 'exclude'], 'risk');
    if (Object.hasOwn(raw.risk, 'disable')) strings(raw.risk.disable, 'risk.disable');
    if (Object.hasOwn(raw.risk, 'thresholds')) {
      const names = Object.keys(DEFAULT_RISK_THRESHOLDS);
      keys(raw.risk.thresholds, names.concat(names.map((key) => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()))), 'risk.thresholds');
      for (const [key, value] of Object.entries(raw.risk.thresholds)) {
        if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
          throw rulesError('risk.thresholds.' + key + ' must be a non-negative number');
        }
      }
    }
    if (Object.hasOwn(raw.risk, 'exclude')) {
      if (raw.risk.exclude == null) throw rulesError('risk.exclude must be a mapping or list');
      for (const item of asList(raw.risk.exclude)) {
        keys(item, ['rule', 'path'], 'risk.exclude');
        string(item.path, 'risk.exclude.path');
        optionalStrings(item, ['rule'], 'risk.exclude');
      }
    }
  }
}

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

function isInvariantRule(r) {
  if (!r || typeof r !== 'object') return false;
  const forbid = r.forbid && typeof r.forbid === 'object' ? r.forbid : null;
  const require = r.require && typeof r.require === 'object' ? r.require : null;
  const hasForbid = !!(forbid && (forbid.from_layer || forbid.to_layer || forbid.edge_type));
  const hasRequire = !!(require && (require.import_layer || require.calls_through_layer));
  return hasForbid || hasRequire;
}

function normalizeInvariant(r) {
  const forbid = r.forbid && typeof r.forbid === 'object' ? r.forbid : null;
  const requireRaw = r.require && typeof r.require === 'object' ? r.require : null;
  const when = r.when && typeof r.when === 'object' ? r.when : {};
  const require = requireRaw
    ? {
        import_layer: requireRaw.import_layer || requireRaw.calls_through_layer || null
      }
    : null;
  return {
    id: r.id || 'invariant',
    message: r.message || null,
    severity: String(r.severity || 'high').toLowerCase(),
    when: {
      route: when.route != null ? String(when.route) : null
    },
    forbid: forbid
      ? {
          from_layer: forbid.from_layer || null,
          to_layer: forbid.to_layer || null,
          edge_type: forbid.edge_type || null
        }
      : null,
    require
  };
}

function rulesPathExists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false;
    throw e;
  }
}

function loadRules(filePath) {
  const abs = path.resolve(filePath);
  if (!rulesPathExists(abs)) {
    const err = new Error('Rules file not found: ' + abs);
    err.code = 'RULES_NOT_FOUND';
    throw err;
  }
  try {
    const raw = parseYaml(fs.readFileSync(abs, 'utf8'));
    return normalizeRules(raw, abs);
  } catch (e) {
    e.message = abs + ': ' + e.message;
    throw e;
  }
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
    if (p && rulesPathExists(p)) return p;
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
