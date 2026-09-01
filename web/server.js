'use strict';

/**
 * Architecture Viewer — Web product server (Community MVP)
 *
 * Dual surface with the Cursor extension:
 *   Extension = authoring beside the code
 *   Web       = share / review / no-IDE generation
 *
 * Reuses lib/ for scan → generate → validate.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { generateToDirAsync, scan, checkKit } = require('../lib');
const { writeProject, readProject, listProjects, DIAGRAM_FILES } = require('./lib/projects');
const { safeClone, cleanup } = require('./lib/clone');
let handlePro = null;
try { handlePro = require('./lib/pro/routes').handlePro; } catch { handlePro = null; }

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(__dirname, 'public');
const VIEWER_HTML = path.join(ROOT, 'architecture_visualized.html');
const VIEWER_CONFIG = path.join(ROOT, 'architecture.config.js');
const PORT = Number(process.env.PORT || 3847);
const HOST = process.env.HOST || '127.0.0.1';

let VERSION = '0.2.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (pkg && typeof pkg.version === 'string') VERSION = pkg.version;
} catch { /* ignore */ }

// --- Security / feature switches (defaults are safe for public hosting) ---
// ARCH_WEB_PATH_MODE=1          → allow POST /api/generate { path: <server-local path> }
// ARCH_WEB_PROJECTS_LIST=1      → allow GET /api/projects (list recent 30 generated)
// ARCH_WEB_SAMPLES=1            → enable sample repositories in /api/samples and via POST sample
const PATH_MODE = process.env.ARCH_WEB_PATH_MODE === '1' || process.env.NODE_ENV === 'test';
const PROJECTS_LIST = process.env.ARCH_WEB_PROJECTS_LIST === '1' || process.env.NODE_ENV === 'test';
const SAMPLES_ENABLED = process.env.ARCH_WEB_SAMPLES === '1' || process.env.NODE_ENV === 'test';

const SAMPLES = SAMPLES_ENABLED ? {
  berkshire: path.join(ROOT, '..', 'ai-berkshire-valuation-monitor'),
  publicopinion: path.join(ROOT, '..', 'publicopinionmonitor_v2'),
  v18: path.join(ROOT, '..', 'v18')
} : {};

function send(res, status, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) {
    const json = JSON.stringify(body);
    h['Content-Type'] = 'application/json; charset=utf-8';
    res.writeHead(status, h);
    res.end(json);
    return;
  }
  res.writeHead(status, h);
  res.end(body);
}

function readBody(req, limit) {
  const max = limit || 2 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.md': 'text/markdown; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png'
    }[ext] || 'application/octet-stream'
  );
}

function safeResolveUnder(root, rel) {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(path.resolve(root) + path.sep) && abs !== path.resolve(root)) {
    return null;
  }
  return abs;
}

function buildViewerPage(diagrams, title) {
  let html = fs.readFileSync(VIEWER_HTML, 'utf8');
  const configJs = fs.readFileSync(VIEWER_CONFIG, 'utf8');
  const sources = {};
  for (const name of DIAGRAM_FILES) {
    if (diagrams[name]) sources[name] = diagrams[name];
  }
  const inject =
    `<script>window.__ARCH_INLINE_SOURCES__=${JSON.stringify(sources)};` +
    `document.title=${JSON.stringify(title || 'Architecture Viewer')};</script>`;
  html = html.replace(
    '<script src="architecture.config.js"></script>',
    `<script>${configJs}</script>\n    ${inject}`
  );
  html = html.replace('src="vendor/mermaid.min.js"', 'src="/vendor/mermaid.min.js"');
  return html;
}

function pickApiKey(body) {
  if (!body || typeof body.apiKey !== 'string') return undefined;
  const key = body.apiKey.trim();
  if (!key) return undefined;
  if (key.length > 256) {
    const err = new Error('apiKey too long');
    err.status = 400;
    throw err;
  }
  return key;
}

/**
 * Product field is `quality` (fast | refine). `mode` is a compatibility alias.
 * Same resolver as CLI: refine → generateToDirAsync({ mode: 'llm' }).
 * Explicit quality=refine without a key is strict (401), matching --refine.
 */
function generateOptsFromBody(body) {
  const apiKey = pickApiKey(body);
  const quality = body && typeof body.quality === 'string' ? body.quality.trim().toLowerCase() : '';
  const mode = body && typeof body.mode === 'string' ? body.mode.trim().toLowerCase() : '';

  if (quality === 'fast' || quality === 'skeleton') {
    return { mode: 'skeleton', apiKey, strict: false, quality: 'fast' };
  }
  if (quality === 'refine') {
    return { mode: 'llm', apiKey, strict: true, quality: 'refine' };
  }
  if (quality) {
    const err = new Error('quality must be "fast" or "refine"');
    err.status = 400;
    throw err;
  }
  if (mode === 'skeleton') {
    return { mode: 'skeleton', apiKey, strict: false, quality: 'fast' };
  }
  if (mode === 'llm' || mode === 'refine') {
    // legacy mode=llm: fall back to skeleton when no key (not strict)
    return { mode: 'llm', apiKey, strict: false, quality: 'refine' };
  }
  return { mode: 'skeleton', apiKey, strict: false, quality: 'fast' };
}

async function generateFromPath(repoPath, sourceLabel, opts) {
  const abs = path.resolve(repoPath);
  if (!fs.existsSync(abs)) {
    const err = new Error('path not found: ' + abs);
    err.status = 404;
    throw err;
  }
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'arch-web-'));
  const kitDir = path.join(tmp, 'kit');
  fs.mkdirSync(kitDir, { recursive: true });
  const result = await generateToDirAsync(abs, kitDir, opts || { mode: 'skeleton' });
  const diagrams = {};
  for (const name of DIAGRAM_FILES) {
    const p = path.join(kitDir, name);
    if (fs.existsSync(p)) diagrams[name] = fs.readFileSync(p, 'utf8');
  }
  const meta = writeProject(
    {
      title: result.inventory.title,
      source: sourceLabel || abs,
      fingerprint: result.inventory.fingerprint,
      protocolOk: result.protocol.ok,
      driftOk: result.drift.ok,
      errors: result.protocol.errors,
      warnings: result.protocol.warnings,
      driftMissing: (result.drift.missing || []).map((m) => m.label),
      engine: result.engine,
      fallback: result.fallback,
      generateReason: result.reason
    },
    diagrams
  );
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  return {
    meta,
    diagrams,
    inventory: result.inventory,
    engine: result.engine,
    fallback: result.fallback,
    reason: result.reason
  };
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, {
      ok: true,
      product: 'architecture-viewer-web',
      version: VERSION,
      features: {
        pathMode: PATH_MODE,
        projectsList: PROJECTS_LIST,
        samples: SAMPLES_ENABLED
      },
      llmAvailable: !!process.env.DEEPSEEK_API_KEY,
      pro: true,
      stripe: !!(process.env.ARCH_STRIPE_SECRET_KEY && process.env.ARCH_STRIPE_PRICE_ID)
    });
  }

  if (url.pathname.startsWith('/api/pro')) {
    if (!handlePro) return send(res, 503, { error: 'pro routes not mounted; need web/lib/pro/ + env ARCH_PRO_SECRET' });
    const raw = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : await readBody(req);
    const handled = await handlePro(req, res, url, raw);
    if (handled === null) return send(res, 404, { error: 'not found' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/samples') {
    if (!SAMPLES_ENABLED) return send(res, 200, { samples: [], note: 'samples disabled; set ARCH_WEB_SAMPLES=1' });
    const samples = Object.entries(SAMPLES).map(([id, p]) => ({
      id,
      path: p,
      available: fs.existsSync(p),
      title: fs.existsSync(p) ? scan(p).title : id
    }));
    return send(res, 200, { samples });
  }

  if (req.method === 'GET' && url.pathname === '/api/projects') {
    if (!PROJECTS_LIST) return send(res, 403, { error: 'projects list disabled; set ARCH_WEB_PROJECTS_LIST=1' });
    return send(res, 200, { projects: listProjects(30) });
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/projects/')) {
    const id = url.pathname.slice('/api/projects/'.length).replace(/\/$/, '');
    const project = readProject(id);
    if (!project) return send(res, 404, { error: 'project not found' });
    return send(res, 200, { meta: project.meta, diagrams: project.diagrams });
  }

  if (req.method === 'POST' && url.pathname === '/api/generate') {
    const raw = await readBody(req);
    let body = {};
    try {
      body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    } catch {
      return send(res, 400, { error: 'invalid JSON' });
    }

    let result;
    const genOpts = generateOptsFromBody(body);
    if (body.sample) {
      if (!SAMPLES_ENABLED) return send(res, 403, { error: 'samples disabled; set ARCH_WEB_SAMPLES=1' });
      if (!SAMPLES[body.sample]) return send(res, 400, { error: 'unknown sample id' });
      if (!fs.existsSync(SAMPLES[body.sample])) {
        return send(res, 404, { error: 'sample repo not found on this machine', sample: body.sample });
      }
      result = await generateFromPath(SAMPLES[body.sample], 'sample:' + body.sample, genOpts);
    } else if (body.path) {
      if (!PATH_MODE) return send(res, 403, { error: 'path mode disabled; set ARCH_WEB_PATH_MODE=1' });
      // Local-dev / self-host only: generate from a filesystem path the server can read.
      result = await generateFromPath(body.path, 'path:' + body.path, genOpts);
    } else if (body.url) {
      // Git URL clone → scan → generate（核心入口：用户粘贴仓库 URL）
      let cloned;
      try {
        cloned = await safeClone(body.url);
      } catch (e) {
        return send(res, e.status || 502, { error: e.message || 'git clone failed', url: body.url });
      }
      try {
        result = await generateFromPath(cloned, 'git:' + body.url, genOpts);
      } finally {
        cleanup(cloned);
      }
    } else if (body.inventory && typeof body.inventory === 'object') {
      // Cloud-shaped input: client sends a pre-scanned inventory (no raw code upload).
      const { generateFiles } = require('../lib/generate');
      const { validateDir, mentionedIds } = require('../lib/validate');
      const { checkDrift } = require('../lib/scan');
      const os = require('os');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-inv-'));
      const files = generateFiles(body.inventory);
      for (const [name, text] of Object.entries(files)) {
        fs.writeFileSync(path.join(tmp, name), text);
      }
      const protocol = validateDir(tmp, { requireFilled: true });
      const hay = Object.values(files).join('\n');
      const drift = checkDrift(body.inventory, mentionedIds(tmp), hay);
      const meta = writeProject(
        {
          title: body.inventory.title || 'Inventory project',
          source: 'inventory',
          fingerprint: body.inventory.fingerprint || null,
          protocolOk: protocol.ok,
          driftOk: drift.ok,
          errors: protocol.errors,
          warnings: protocol.warnings,
          driftMissing: (drift.missing || []).map((m) => m.label)
        },
        files
      );
      fs.rmSync(tmp, { recursive: true, force: true });
      result = { meta, diagrams: files, inventory: body.inventory, engine: 'skeleton', fallback: false, reason: 'inventory' };
    } else {
      return send(res, 400, {
        error: 'provide sample | path | url | inventory',
        hint: '粘贴 Git 仓库 URL（推荐）、使用样例、服务器本地路径、或扫描摘要 JSON'
      });
    }

    const engine = result.engine || (result.meta && result.meta.engine) || 'skeleton';
    return send(res, 200, {
      id: result.meta.id,
      meta: result.meta,
      shareUrl: '/p/' + result.meta.id,
      previewUrl: '/p/' + result.meta.id,
      quality: engine === 'llm' ? 'refine' : 'fast',
      engine,
      fallback: !!(result.fallback || (result.meta && result.meta.fallback)),
      reason: result.reason || (result.meta && result.meta.generateReason) || null,
      diagrams: result.diagrams || {},
      inventory: {
        title: result.inventory.title,
        languages: result.inventory.languages,
        modules: result.inventory.modules,
        services: result.inventory.services,
        fingerprint: result.inventory.fingerprint
      }
    });
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/projects/') && url.pathname.endsWith('/check')) {
    const id = url.pathname.slice('/api/projects/'.length, -'/check'.length);
    const project = readProject(id);
    if (!project) return send(res, 404, { error: 'project not found' });
    const result = checkKit(project.dir, { requireFilled: true, drift: false });
    return send(res, 200, {
      ok: result.ok,
      errors: result.protocol.errors,
      warnings: result.protocol.warnings
    });
  }

  return send(res, 404, { error: 'not found' });
}

async function handler(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }

    if (url.pathname.startsWith('/p/')) {
      const id = url.pathname.slice(3).split('/')[0];
      const project = readProject(id);
      if (!project) {
        return send(res, 404, 'Project not found', { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      const html = buildViewerPage(project.diagrams, project.meta.title);
      return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
    }

    if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.svg') {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0f6e56"/><rect x="6" y="14" width="6" height="12" fill="#fff" rx="1"/><rect x="13" y="10" width="6" height="16" fill="#fff" rx="1"/><rect x="20" y="16" width="6" height="10" fill="#fff" rx="1"/><rect x="5" y="8" width="22" height="3" fill="#80cbc4" rx="1"/></svg>';
      return send(res, 200, svg, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    }

    if (url.pathname.startsWith('/vendor/')) {
      const filePath = safeResolveUnder(path.join(ROOT, 'vendor'), '.' + url.pathname.slice('/vendor'.length));
      if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      return send(res, 200, fs.readFileSync(filePath), { 'Content-Type': contentType(filePath) });
    }

    let rel = url.pathname === '/' ? '/index.html' : url.pathname;
    let filePath = safeResolveUnder(PUBLIC, '.' + rel);
    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      filePath = fs.existsSync(indexPath) ? indexPath : null;
    }
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    return send(res, 200, fs.readFileSync(filePath), { 'Content-Type': contentType(filePath) });
  } catch (err) {
    const status = err.status || 500;
    return send(res, status, { error: err.message || String(err) });
  }
}

function main() {
  const server = http.createServer((req, res) => {
    handler(req, res);
  });
  server.listen(PORT, HOST, () => {
    console.log(`Architecture Viewer Web  http://${HOST}:${PORT}`);
    console.log('  Landing   /');
    console.log('  API       /api/health  /api/samples  /api/generate  /api/projects');
    console.log('  Account   /account.html');
    console.log('  Pro API   /api/pro/signup  /api/pro/webhook  /api/pro/billing/*');
  });
}

if (require.main === module) {
  main();
}

module.exports = { handler, buildViewerPage, generateFromPath, generateOptsFromBody, PORT };
