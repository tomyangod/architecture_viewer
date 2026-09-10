'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INTENT_BASENAME = 'session-intent.json';

const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build',
  'target', 'coverage', '.next', '.nuxt', 'vendor', '.av', 'architecture_viewer'
]);

const TEST_PATH_RE = /(^|\/)(tests?|specs?|__tests__)(\/|$)|(?:^|\/)test_[^/]+\.[a-z]+$|(?:^|\/|_)tests?\.[a-z]+$|\.(test|spec)\.[cm]?[jt]sx?$/i;

const NEGATION_RE = /不(?:要)?(?:改|动|碰|变|新增)|勿(?:改|动)|别(?:改|动|碰)|don'?t\s+(?:change|touch|modify|add)|do\s+not\s+(?:change|touch|modify|add)/i;

const STOP = new Set([
  '只修', '分层', '结构', '架构', '代码', '这次', '本次', '不要', '不改', '不要动',
  '文件', '逻辑', '检查', '请', '把', '的', '了', '和', '与', '或', '在', '是',
  'only', 'just', 'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into',
  'session', 'report', 'start', 'fix', 'layer', 'layers', 'code', 'please'
]);

function intentPath(repo) {
  return path.join(repo, '.av', INTENT_BASENAME);
}

function isTestRel(rel) {
  return TEST_PATH_RE.test(String(rel || '').replace(/\\/g, '/'));
}

function walkTestFiles(rootDir) {
  const out = [];
  const stack = [rootDir];
  let scanned = 0;
  while (stack.length && out.length < 800) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      scanned++;
      if (scanned > 40000) return out;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name) || (ent.name.startsWith('.') && ent.name !== '.')) continue;
        stack.push(abs);
        continue;
      }
      const rel = path.relative(rootDir, abs).replace(/\\/g, '/');
      if (isTestRel(rel)) out.push(rel);
    }
  }
  return out.sort();
}

function hashTestSurface(rootDir) {
  const files = walkTestFiles(rootDir);
  if (!files.length) return { fingerprint: null, files: [] };
  const h = crypto.createHash('sha256');
  for (const rel of files) {
    let hex = '';
    try {
      hex = crypto.createHash('sha256').update(fs.readFileSync(path.join(rootDir, rel))).digest('hex').slice(0, 16);
    } catch { hex = ''; }
    h.update(rel + '\0' + hex + '\n');
  }
  return { fingerprint: h.digest('hex').slice(0, 16), files };
}

function writeSessionIntent(repo, text, extra) {
  fs.mkdirSync(path.join(repo, '.av'), { recursive: true });
  const tests = hashTestSurface(repo);
  const rec = {
    text: String(text || '').trim() || null,
    createdAt: new Date().toISOString(),
    testFingerprint: tests.fingerprint,
    testFileCount: tests.files.length,
    ...(extra && extra.sessionStartedAt ? { sessionStartedAt: extra.sessionStartedAt } : {})
  };
  fs.writeFileSync(intentPath(repo), JSON.stringify(rec, null, 2));
  return rec;
}

function loadSessionIntent(repo) {
  const p = intentPath(repo);
  if (!fs.existsSync(p)) return null;
  try {
    const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!rec || typeof rec !== 'object') return null;
    return rec;
  } catch {
    return null;
  }
}

function extractTokens(text) {
  const raw = String(text || '');
  const tokens = [];
  const add = (t) => {
    const s = String(t || '').trim();
    if (!s || s.length < 2) return;
    if (STOP.has(s.toLowerCase()) || STOP.has(s)) return;
    if (!tokens.includes(s)) tokens.push(s);
  };
  for (const m of raw.matchAll(/[「『"'`]([^「『"'`\n]{1,80})[」』"'`]/g)) add(m[1]);
  for (const m of raw.matchAll(/\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ALL)\s+\/[A-Za-z0-9_\-./{}:<]*/gi)) {
    add(m[0].replace(/\s+/g, ' ').trim());
  }
  for (const m of raw.matchAll(/\/[A-Za-z0-9_\-./{}:<]+/g)) add(m[0]);
  for (const m of raw.matchAll(/\b[A-Za-z][\w.-]+(?:\/[\w.-]+)+\b/g)) add(m[0]);
  for (const m of raw.matchAll(/[A-Za-z][A-Za-z0-9_-]{3,}/g)) add(m[0]);
  for (const m of raw.matchAll(/[\u4e00-\u9fff]{2,12}/g)) add(m[0]);
  return tokens;
}

function collectSurfaces(diff, headGraph) {
  const routes = [];
  const files = new Set();
  function take(entry) {
    const node = entry && (entry.node || entry);
    if (!node) return;
    if (node.kind === 'route' && node.name) routes.push(node.name);
    if (node.path) files.add(String(node.path).replace(/\\/g, '/'));
    if (node.kind === 'file' && node.id) files.add(String(node.id).replace(/^file:/, ''));
  }
  for (const e of diff.addedNodes || []) take(e);
  for (const e of diff.removedNodes || []) take(e);
  for (const e of diff.modifiedNodes || []) {
    take(e.to || e.from || e);
    if (e.path) files.add(String(e.path).replace(/\\/g, '/'));
  }
  for (const f of diff.fileLocChanges || []) {
    if (f.path && f.delta) files.add(String(f.path).replace(/\\/g, '/'));
  }
  return { routes, files: [...files] };
}

function tokenHits(token, surfaces) {
  const t = String(token).toLowerCase().replace(/\\/g, '/');
  const pathish = t.replace(/^(get|post|put|patch|delete|head|options|all)\s+/, '');
  if (surfaces.routes.some((r) => {
    const rl = String(r).toLowerCase();
    return rl === t || rl.includes(t) || rl.includes(pathish) || t.includes(rl);
  })) return { kind: 'route', value: token };
  if (surfaces.files.some((f) => {
    const fl = String(f).toLowerCase();
    return fl === t || fl.includes(t) || t.includes(fl);
  })) return { kind: 'file', value: token };
  return null;
}

function applyIntentAlignment(findings, diff, headGraph, baseGraph, opts) {
  const repo = opts && opts.repo;
  const meta = (opts && opts.intentMeta) || (repo ? loadSessionIntent(repo) : null);
  if (!meta) return;

  const surfaces = collectSurfaces(diff, headGraph);
  const hasSurface = surfaces.routes.length > 0 || surfaces.files.length > 0;
  const text = meta.text && String(meta.text).trim();

  if (text && hasSurface) {
    const negated = NEGATION_RE.test(text);
    const tokens = extractTokens(text);
    const hits = tokens.map((t) => ({ token: t, hit: tokenHits(t, surfaces) })).filter((x) => x.hit);
    if (negated) {
      for (const h of hits) {
        findings.push({
          rule: 'intent-mismatch',
          severity: 'low',
          family: 'contract',
          title: '意图不对齐',
          message: `声明「不改 ${h.token}」，但本轮改到了${h.hit.kind === 'route' ? '路由' : '文件'}面`,
          detail: text,
          intent: text,
          suggestion: '对照 session start 时写下的意图：若本应改这里，更新意图；若不应改，撤回该表面变更。不对齐不等于业务算错。'
        });
        break;
      }
    } else if (tokens.length && hits.length === 0 && surfaces.routes.length + surfaces.files.length > 0) {
      findings.push({
        rule: 'intent-mismatch',
        severity: 'info',
        family: 'contract',
        title: '意图不对齐',
        message: '改动面与声明意图中的关键词对不上',
        detail: text,
        intent: text,
        suggestion: '意图里点名的模块/路由未出现在本轮 diff 中。确认是不是改错了目录；不对齐不等于业务算错。'
      });
    }
  }

  const addedOrRemovedRoutes = [...(diff.addedNodes || []), ...(diff.removedNodes || [])]
    .map((e) => e.node || e)
    .filter((n) => n && n.kind === 'route');
  if (addedOrRemovedRoutes.length && meta.testFingerprint && repo) {
    const now = hashTestSurface(repo);
    if (now.fingerprint && now.fingerprint === meta.testFingerprint) {
      findings.push({
        rule: 'behavior-untested',
        severity: 'low',
        family: 'contract',
        title: '行为面变更但测试未动',
        message: `对外路由有增减（${addedOrRemovedRoutes.map((n) => n.name).slice(0, 3).join(', ')}），测试目录指纹未变`,
        detail: addedOrRemovedRoutes.map((n) => n.name).join(', '),
        suggestion: '为变更的路由补测试或更新现有用例。未跑测试，也不证明业务正确。'
      });
    }
  }
}

module.exports = {
  INTENT_BASENAME,
  intentPath,
  writeSessionIntent,
  loadSessionIntent,
  hashTestSurface,
  extractTokens,
  collectSurfaces,
  applyIntentAlignment,
  NEGATION_RE
};
