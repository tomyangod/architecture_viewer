'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build',
  '.cursor', '.vscode', 'data', 'cache', 'logs', 'backups', 'browser_data',
  'test-results', 'playwright-report', '.agents', '.claude', 'tmp', 'temp',
  'architecture_viewer'
]);

function readSafe(p, max) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > (max || 256000)) return '';
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function snake(s) {
  return String(s || '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'item';
}

function listDir(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
}

function parseComposeServices(text) {
  const names = [];
  const lines = text.split(/\r?\n/);
  let inServices = false;
  for (const line of lines) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (inServices && /^[a-zA-Z]/.test(line) && !/^\s/.test(line)) {
      if (!/^services:/.test(line)) break;
    }
    if (inServices) {
      const m = line.match(/^  ([A-Za-z0-9._-]+):\s*$/);
      if (m) names.push(m[1]);
    }
  }
  return names;
}

function collectClasses(root, budget) {
  const classes = [];
  const stack = [root];
  let files = 0;
  while (stack.length && classes.length < 24 && files < budget) {
    const dir = stack.pop();
    const base = path.basename(dir);
    if (SKIP_DIRS.has(base)) continue;
    for (const ent of listDir(dir)) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) stack.push(p);
        continue;
      }
      if (!/\.(py|ts|js|java|go)$/.test(ent.name)) continue;
      if (/test|spec|min\.js/.test(ent.name)) continue;
      files += 1;
      const text = readSafe(p, 80000);
      const re = /(?:^|\n)class\s+([A-Za-z_][\w]*)/g;
      let m;
      while ((m = re.exec(text)) && classes.length < 24) {
        classes.push({ name: m[1], file: path.relative(root, p) });
      }
    }
  }
  return classes;
}

function scan(root) {
  const abs = path.resolve(root);
  const nameFromDir = path.basename(abs);
  let title = nameFromDir;
  const readme = ['README.md', 'readme.md', 'quickstart.md'].map((f) => path.join(abs, f)).find(fs.existsSync);
  if (readme) {
    // Strip fenced code blocks so shell comments (# ...) aren't mistaken for Markdown headings
    const text = readSafe(readme, 8000).replace(/```[\s\S]*?```/g, '');
    const head = text.split(/\n/).find((l) => /^#\s+/.test(l));
    if (head) title = head.replace(/^#\s+/, '').replace(/[`*_]/g, '').trim().slice(0, 80);
  }
  // Fallback: go.mod module name (e.g. "module github.com/knadh/listmonk" → "listmonk")
  if (title === nameFromDir) {
    const goMod = path.join(abs, 'go.mod');
    if (fs.existsSync(goMod)) {
      const modLine = readSafe(goMod, 8192).split(/\n/).find((l) => /^module\s+/.test(l));
      if (modLine) {
        const modName = modLine.replace(/^module\s+/, '').trim().split('/').pop();
        if (modName) title = modName;
      }
    }
  }
  // Fallback: pyproject.toml [project] name
  if (title === nameFromDir) {
    const pp = path.join(abs, 'pyproject.toml');
    if (fs.existsSync(pp)) {
      const m = readSafe(pp, 4000).match(/^name\s*=\s*"([^"]+)"/m);
      if (m && m[1]) title = m[1];
    }
  }

  const languages = new Set();
  const packages = [];
  const pkgJson = path.join(abs, 'package.json');
  if (fs.existsSync(pkgJson)) {
    languages.add('javascript');
    try {
      const pkg = JSON.parse(readSafe(pkgJson, 200000) || '{}');
      if (pkg.name) packages.push({ name: pkg.name, kind: 'npm' });
      const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
      Object.keys(deps).slice(0, 12).forEach((d) => packages.push({ name: d, kind: 'npm-dep' }));
    } catch { /* ignore */ }
  }
  for (const req of ['requirements.txt', 'requirements-valuation.txt', 'pyproject.toml']) {
    if (fs.existsSync(path.join(abs, req))) {
      languages.add('python');
      packages.push({ name: req, kind: 'python' });
    }
  }
  if (fs.existsSync(path.join(abs, 'go.mod'))) languages.add('go');
  if (fs.existsSync(path.join(abs, 'pom.xml')) || fs.existsSync(path.join(abs, 'build.gradle'))) {
    languages.add('java');
  }

  const services = [];
  for (const rel of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml']) {
    const p = path.join(abs, rel);
    if (!fs.existsSync(p)) continue;
    parseComposeServices(readSafe(p)).forEach((s) => services.push({ id: snake(s), label: s, source: rel }));
  }
  function walkCompose(dir, depth) {
    if (depth > 3) return;
    for (const ent of listDir(dir)) {
      if (!ent.isDirectory() || SKIP_DIRS.has(ent.name)) continue;
      const nest = path.join(dir, ent.name);
      for (const f of ['docker-compose.yml', 'docker-compose.yaml']) {
        const p = path.join(nest, f);
        if (fs.existsSync(p)) {
          parseComposeServices(readSafe(p)).forEach((s) => {
            services.push({ id: snake(s), label: s, source: path.relative(abs, p) });
          });
        }
      }
      walkCompose(nest, depth + 1);
    }
  }
  walkCompose(abs, 0);

  const topDirs = listDir(abs)
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
    .map((e) => e.name);

  const CODEISH = /^(src|app|backend|frontend|server|api|web|js|css|model|models|domain|entity|services?|worker|workers|scripts?|lib|libs|core|base|config|deploy|database|data_collection|proxy|runtime|portfolio|research|utils|cmd_arg|blackbox|scheduler|crawl|scraper|monitor|alert|collector|ingestion)$/i;

  function moduleLayer(d) {
    if (/front|css|js|web|dashboard|ui|client|pages?/i.test(d)) return 'frontend';
    if (/deploy|k8s|infra|docker|ops|ci/i.test(d)) return 'ops';
    if (/schedul|cron|orchestr|pipeline|workflow/i.test(d)) return 'schedule';
    if (/worker|crawl|scraper|spider|collect|fetch|ingest|etl|job/i.test(d)) return 'worker';
    if (/db|database|postgres|mysql|mongo|sqlite|redis|storage|store|data_collection|kafka|mq/i.test(d)) return 'storage';
    if (/monitor|alert|alarm|metric|observ|notify/i.test(d)) return 'monitor';
    if (/api|backend|server|gateway|bff/i.test(d)) return 'api';
    return 'api';
  }

  const modules = topDirs.filter((d) => CODEISH.test(d)).map((d) => {
    const layer = moduleLayer(d);
    return {
      id: snake(d),
      label: d,
      kind: layer === 'frontend' ? 'frontend' : layer === 'ops' ? 'ops' : 'backend',
      layer
    };
  });

  const entrypoints = [];
  for (const f of ['main.py', 'app.py', 'index.html', 'dashboard.html', 'valuation_monitor.py', 'server.js', 'main.go', 'manage.py', 'scheduler.py', 'worker.py']) {
    if (fs.existsSync(path.join(abs, f))) entrypoints.push(f);
  }

  // Shallow artifact harvest: key scripts under top code dirs (for layered block diagram)
  const artifacts = [];
  const ARTIFACT_RE = /\.(py|js|ts|go|java|html|yml|yaml)$/i;
  const INTEREST = /schedul|worker|crawl|api|server|main|app|monitor|alert|dashboard|index|docker|compose|redis|db|queue/i;
  for (const d of topDirs.slice(0, 20)) {
    const dir = path.join(abs, d);
    for (const ent of listDir(dir)) {
      if (!ent.isFile() || !ARTIFACT_RE.test(ent.name)) continue;
      if (!INTEREST.test(ent.name) && !INTEREST.test(d)) continue;
      const rel = path.join(d, ent.name);
      artifacts.push({
        id: snake(ent.name.replace(/\.[^.]+$/, '') + '_' + d),
        label: ent.name,
        path: rel,
        layer: moduleLayer(d + '/' + ent.name)
      });
      if (artifacts.length >= 24) break;
    }
    if (artifacts.length >= 24) break;
  }

  const deploy = [];
  if (fs.existsSync(path.join(abs, 'Dockerfile'))) deploy.push('Dockerfile');
  if (fs.existsSync(path.join(abs, '.github'))) deploy.push('github-actions');
  if (topDirs.includes('deploy')) deploy.push('deploy/');
  if (topDirs.includes('k8s')) deploy.push('k8s/');

  const classRoots = ['model', 'models', 'domain', 'entity', 'backend', 'src', 'lib', 'core']
    .map((d) => path.join(abs, d))
    .filter(fs.existsSync);
  const classes = [];
  for (const cr of classRoots) {
    collectClasses(cr, 80).forEach((c) => classes.push(c));
    if (classes.length >= 24) break;
  }

  // Enrich compose services with layer hints
  services.forEach((s) => {
    s.layer = moduleLayer(s.label);
  });

  const inventory = {
    root: abs,
    title,
    folder: nameFromDir,
    languages: [...languages],
    packages: packages.slice(0, 20),
    services: uniqueBy(services, (s) => s.id),
    modules,
    artifacts: uniqueBy(artifacts, (a) => a.id),
    topDirs,
    entrypoints,
    deploy,
    classes: uniqueBy(classes, (c) => c.name).slice(0, 18)
  };
  inventory.fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      title: inventory.title,
      languages: inventory.languages,
      services: inventory.services.map((s) => s.id),
      modules: inventory.modules.map((m) => m.id),
      entrypoints: inventory.entrypoints,
      deploy: inventory.deploy
    }))
    .digest('hex')
    .slice(0, 16);
  return inventory;
}

function uniqueBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function driftTerms(inventory) {
  const terms = [];
  inventory.services.forEach((s) => terms.push({ term: s.id, label: s.label, kind: 'service' }));
  inventory.modules.forEach((m) => terms.push({ term: m.id, label: m.label, kind: 'module' }));
  inventory.entrypoints.forEach((e) => terms.push({ term: snake(e.replace(/\.[^.]+$/, '')), label: e, kind: 'entry' }));
  return uniqueBy(terms, (t) => t.term);
}

function checkDrift(inventory, mentioned, haystack) {
  const hay = String(haystack || '').toLowerCase();
  const missing = [];
  for (const t of driftTerms(inventory)) {
    const label = String(t.label || '').toLowerCase();
    const hit = mentioned.has(t.term) ||
      (t.term.length >= 2 && hay.includes(t.term)) ||
      (label.length >= 2 && hay.includes(label));
    if (!hit) missing.push(t);
  }
  return {
    ok: missing.length === 0,
    missing,
    checked: driftTerms(inventory).length
  };
}

module.exports = { scan, snake, driftTerms, checkDrift, SKIP_DIRS };
