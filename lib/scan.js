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

function ext2(name) {
  const m = name.match(/\.(py|ts|tsx|js|jsx|java|go|vue)$/i);
  return m ? m[1].toLowerCase() : null;
}

function extractTypeNames(ext, text, relPath, classes) {
  const push = (name) => {
    if (classes.length < 24 && name && name.length >= 3) {
      classes.push({ name, file: relPath });
    }
  };
  if (ext === 'go') {
    const re = /(?:^|\n)\s*type\s+([A-Za-z_][\w]*)\s+(?:struct|interface)/g;
    let m;
    while ((m = re.exec(text))) push(m[1]);
  } else if (ext === 'vue') {
    const named = text.match(/name\s*:\s*['"]([A-Za-z_][\w-]*)['"]/);
    if (named) push(named[1]);
    else {
      const base = path.basename(relPath, '.vue');
      if (base && base !== 'index' && /^[A-Z]/.test(base)) push(base);
    }
    const scriptRe = /(?:^|\n)\s*(?:export\s+default\s+)?(?:class|interface)\s+([A-Za-z_][\w]*)/g;
    let m;
    while ((m = scriptRe.exec(text))) push(m[1]);
  } else if (ext === 'tsx' || ext === 'jsx') {
    const fnRe = /(?:^|\n)\s*(?:export\s+(?:default\s+)?)?function\s+([A-Z][\w]*)\s*\(/g;
    const arrowRe = /(?:^|\n)\s*(?:export\s+(?:default\s+)?)?const\s+([A-Z][\w]*)\s*=\s*(?:\([^)]*\)|[\w]+)\s*=>/g;
    let m;
    while ((m = fnRe.exec(text))) push(m[1]);
    while ((m = arrowRe.exec(text))) push(m[1]);
    const clsRe = /(?:^|\n)\s*(?:export\s+)?class\s+([A-Za-z_][\w]*)/g;
    while ((m = clsRe.exec(text))) push(m[1]);
  } else {
    const re = /(?:^|\n)\s*(?:(?:public|private|protected|abstract|final|static|export|sealed|partial)\s+)*class\s+([A-Za-z_][\w]*)/g;
    let m;
    while ((m = re.exec(text))) push(m[1]);
    const ifaceRe = /(?:^|\n)\s*(?:(?:public|private|protected|abstract|export)\s+)*interface\s+([A-Za-z_][\w]*)/g;
    while ((m = ifaceRe.exec(text)) && classes.length < 24) push(m[1]);
  }
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
      const ext = ext2(ent.name);
      if (!ext) continue;
      if (/test|spec|min\.js/.test(ent.name)) continue;
      files += 1;
      const text = readSafe(p, 80000);
      extractTypeNames(ext, text, path.relative(root, p), classes);
    }
  }
  return classes;
}

const CODE_EXT = /\.(py|ts|js|java|go|rb|rs|php|cs|kt|swift|c|cpp|h)$/i;

/** Recursively check if a directory contains source code files (depth-limited). */
function hasCodeFiles(dir, depth) {
  if (depth > 2) return false;
  for (const ent of listDir(dir)) {
    if (ent.isFile() && CODE_EXT.test(ent.name) && !/test|spec/i.test(ent.name)) return true;
    if (ent.isDirectory() && !SKIP_DIRS.has(ent.name) && !ent.name.startsWith('.')) {
      if (hasCodeFiles(path.join(dir, ent.name), depth + 1)) return true;
    }
  }
  return false;
}

// Map source file extension → inventory language tag.
// Used as a fallback when a repo has no dependency manifest.
const EXT_TO_LANG = {
  py: 'python', pyx: 'python',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  go: 'go',
  java: 'java', kt: 'kotlin', kts: 'kotlin',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  cs: 'csharp',
  swift: 'swift',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  vue: 'javascript',
  dart: 'dart',
  scala: 'scala',
  r: 'r', rmd: 'r'
};

/**
 * Detect languages from actual source files (top-level + one level down).
 * Mutates the provided `languages` Set. Bounded by MAX_FILES to stay cheap.
 */
function detectLanguagesFromSource(root, languages) {
  const MAX_FILES = 400;
  let scanned = 0;
  function walk(dir, depth) {
    if (scanned >= MAX_FILES) return;
    if (depth > 2) return;
    for (const ent of listDir(dir)) {
      if (scanned >= MAX_FILES) return;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
        walk(path.join(dir, ent.name), depth + 1);
        continue;
      }
      if (!ent.isFile()) continue;
      scanned++;
      const ext = ent.name.split('.').pop().toLowerCase();
      const lang = EXT_TO_LANG[ext];
      if (lang) languages.add(lang);
    }
  }
  walk(root, 0);
}

// Common Python stdlib / builtin top-level modules to exclude when harvesting
// third-party packages from import statements. Kept small on purpose.
const PY_STDLIB = new Set([
  'abc', 'argparse', 'array', 'ast', 'asyncio', 'base64', 'binascii', 'bisect',
  'builtins', 'bz2', 'calendar', 'cmath', 'cmd', 'code', 'codecs', 'collections',
  'colorsys', 'compileall', 'concurrent', 'configparser', 'contextlib', 'contextvars',
  'copy', 'copyreg', 'cProfile', 'csv', 'ctypes', 'curses', 'dataclasses', 'datetime',
  'dbm', 'decimal', 'difflib', 'dis', 'distutils', 'doctest', 'email', 'encodings',
  'enum', 'errno', 'faulthandler', 'fcntl', 'filecmp', 'fileinput', 'fnmatch',
  'fractions', 'ftplib', 'functools', 'gc', 'getopt', 'getpass', 'gettext', 'glob',
  'gzip', 'hashlib', 'heapq', 'hmac', 'html', 'http', 'imaplib', 'imghdr', 'imp',
  'importlib', 'inspect', 'io', 'ipaddress', 'itertools', 'json', 'keyword',
  'lib2to3', 'linecache', 'locale', 'logging', 'lzma', 'mailbox', 'mailcap',
  'marshal', 'math', 'mimetypes', 'mmap', 'modulefinder', 'multiprocessing', 'netrc',
  'nis', 'numbers', 'operator', 'optparse', 'os', 'ossaudiodev', 'pathlib', 'pdb',
  'pickle', 'pickletools', 'pipes', 'pkgutil', 'platform', 'plistlib', 'poplib',
  'posix', 'posixpath', 'pprint', 'profile', 'pstats', 'pty', 'pwd', 'py_compile',
  'pyclbr', 'pydoc', 'pydoc_data', 'pyexpat', 'queue', 'quopri', 'random', 're',
  'reprlib', 'resource', 'rlcompleter', 'runpy', 'sched', 'secrets', 'select',
  'selectors', 'shelve', 'shlex', 'shutil', 'signal', 'site', 'smtpd', 'smtplib',
  'sndhdr', 'socket', 'socketserver', 'spwd', 'sqlite3', 'sre_compile', 'sre_constants',
  'sre_parse', 'ssl', 'stat', 'statistics', 'string', 'stringprep', 'struct',
  'subprocess', 'sunau', 'symtable', 'sys', 'sysconfig', 'syslog', 'tabnanny',
  'tarfile', 'telnetlib', 'tempfile', 'termios', 'test', 'textwrap', 'threading',
  'time', 'timeit', 'tkinter', 'token', 'tokenize', 'trace', 'traceback',
  'tracemalloc', 'tty', 'turtle', 'turtledemo', 'types', 'typing', 'unicodedata',
  'unittest', 'urllib', 'uu', 'uuid', 'venv', 'warnings', 'wave', 'weakref',
  'webbrowser', 'winreg', 'winsound', 'wsgiref', 'xdrlib', 'xml', 'xmlrpc',
  'zipapp', 'zipfile', 'zipimport', 'zlib', 'zoneinfo',
  'typing_extensions', 'dataclasses_json'
]);

/**
 * Harvest third-party-looking Python packages from `import X` / `from X.Y import`.
 * Appends to the `packages` array as `{ name, kind: 'python-import' }`.
 * Bounded by MAX_FILES and MAX_PACKAGES; stdlib excluded.
 */
function collectPythonImports(root, packages) {
  const MAX_FILES = 80;
  const MAX_PACKAGES = 15;
  const seen = new Set();
  let scanned = 0;

  // Local top-level Python packages (dirs containing __init__.py) are not
  // third-party dependencies — exclude them from the import harvest.
  const localPkgs = new Set();
  for (const ent of listDir(root)) {
    if (!ent.isDirectory() || SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
    if (fs.existsSync(path.join(root, ent.name, '__init__.py'))) {
      localPkgs.add(ent.name.toLowerCase());
    }
  }

  function walk(dir, depth) {
    if (scanned >= MAX_FILES) return;
    if (depth > 3) return;
    for (const ent of listDir(dir)) {
      if (scanned >= MAX_FILES) return;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
        walk(path.join(dir, ent.name), depth + 1);
        continue;
      }
      if (!ent.isFile() || !ent.name.endsWith('.py')) continue;
      scanned++;
      const text = readSafe(path.join(dir, ent.name), 20000);
      if (!text) continue;
      for (const line of text.split(/\r?\n/)) {
        let m = line.match(/^\s*import\s+([a-zA-Z_][\w]*)/);
        if (m) addPkg(m[1]);
        m = line.match(/^\s*from\s+([a-zA-Z_][\w]*)/);
        if (m) addPkg(m[1]);
        if (packages.length >= MAX_PACKAGES) return;
      }
    }
  }

  function addPkg(name) {
    const n = name.toLowerCase();
    if (PY_STDLIB.has(n) || localPkgs.has(n) || seen.has(n)) return;
    seen.add(n);
    packages.push({ name, kind: 'python-import' });
  }

  walk(root, 0);
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        // Strip Go major-version suffix: ".../open-im-server/v3" → "open-im-server"
        const modName = modLine.replace(/^module\s+/, '').trim().replace(/\/v\d+$/, '').split('/').pop();
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
  // Python manifests: requirements / pyproject / setup / Pipfile / conda env
  const pyManifests = [
    'requirements.txt', 'requirements-valuation.txt', 'pyproject.toml',
    'setup.py', 'setup.cfg', 'Pipfile', 'environment.yml', 'environment.yaml'
  ];
  for (const req of pyManifests) {
    if (fs.existsSync(path.join(abs, req))) {
      languages.add('python');
      packages.push({ name: req, kind: 'python' });
    }
  }
  if (fs.existsSync(path.join(abs, 'go.mod'))) languages.add('go');
  if (fs.existsSync(path.join(abs, 'pom.xml')) || fs.existsSync(path.join(abs, 'build.gradle'))) {
    languages.add('java');
  }
  if (fs.existsSync(path.join(abs, 'Cargo.toml'))) languages.add('rust');
  if (fs.existsSync(path.join(abs, 'composer.json'))) languages.add('php');

  // Fallback: detect languages from actual source file extensions.
  // Many small repos (e.g. a Flask app) have no manifest file, so without
  // this the inventory ships `languages: []` and the C4 diagrams go generic.
  detectLanguagesFromSource(abs, languages);

  // Python imports as package fallback when no requirements manifest exists.
  // Lets the C4 diagrams name real frameworks (Flask, SQLAlchemy, …) instead
  // of staying generic. Bounded; stdlib filtered out.
  if (languages.has('python') && !pyManifests.some((m) => fs.existsSync(path.join(abs, m)))) {
    collectPythonImports(abs, packages);
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

  // Module discovery: top-level (CODEISH or contains code) + nested packages
  // Noise dirs: test harnesses, docs, examples, benchmarks, infra — not architecture units
  const MODULE_NOISE = new Set([
    'test', 'tests', '__tests__', 'e2e', 'spec', 'specs',
    'docs', 'doc', 'website', 'site', 'examples', 'example',
    'bench', 'benchmark', 'benchmarks', 'fixtures', 'mock', 'mocks',
    'scripts', 'config', 'tools', 'assets', 'deploy', 'deployments',
    'changelog', 'document', 'vendor', 'third_party', 'thirdparty',
    'i18n', 'locale', 'locales', 'translations'
  ]);
  function isModuleDir(name) {
    return !MODULE_NOISE.has(name.toLowerCase());
  }
  // Go convention: pkg/ holds shared utility libraries, not architecture modules.
  // Also filter compound utility names (openim-cmdutils, internal/tools, etc.)
  const UTILITY_LEAF = new Set([
    'util', 'utils', 'common', 'helpers', 'helper', 'misc',
    'consts', 'constants', 'types', 'errors', 'log', 'logger',
    'version', 'interceptor', 'options', 'cmdutils'
  ]);
  const UTILITY_SUBSTR = /(?:^|[-_])(?:utils?|commons?|helpers?|misc|cmdutils?)(?:$|[-_])/i;
  function isUtilityLeaf(name) {
    const n = name.toLowerCase();
    return UTILITY_LEAF.has(n) || UTILITY_SUBSTR.test(n);
  }
  const moduleSet = new Set();
  const modules = [];
  function addModule(id, label, dirName) {
    if (moduleSet.has(id) || modules.length >= 30) return;
    moduleSet.add(id);
    const layer = moduleLayer(dirName);
    modules.push({
      id,
      label,
      kind: layer === 'frontend' ? 'frontend' : layer === 'ops' ? 'ops' : 'backend',
      layer
    });
  }
  // 1) Top-level dirs: CODEISH match OR contains code files (skip test/docs/examples)
  for (const d of topDirs) {
    if (!isModuleDir(d)) continue;
    if (CODEISH.test(d) || hasCodeFiles(path.join(abs, d), 0)) {
      addModule(snake(d), d, d);
    }
  }
  // 2) Nested packages: one level into code-bearing top-level dirs
  for (const d of topDirs) {
    if (modules.length >= 30) break;
    if (!isModuleDir(d)) continue;
    const topPath = path.join(abs, d);
    if (!CODEISH.test(d) && !hasCodeFiles(topPath, 0)) continue;
    // Go convention: pkg/ subdirs are shared utility libraries, not architecture units
    const isGoPkg = d === 'pkg' && languages.has('go');
    for (const ent of listDir(topPath)) {
      if (!ent.isDirectory() || SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
      if (!isModuleDir(ent.name)) continue;
      if (isGoPkg || isUtilityLeaf(ent.name)) continue;
      const subPath = path.join(topPath, ent.name);
      if (hasCodeFiles(subPath, 0)) {
        addModule(snake(d + '_' + ent.name), d + '/' + ent.name, ent.name);
      }
      if (modules.length >= 30) break;
    }
  }

  const entrypoints = [];
  const ENTRY_FILES = [
    'main.py', 'app.py', 'manage.py', 'wsgi.py', 'asgi.py',
    'index.html', 'dashboard.html',
    'server.js', 'index.js', 'app.js', 'cli.js',
    'main.go', 'main.rs', 'Cargo.toml',
    'pom.xml', 'build.gradle',
    'src/main.rs', 'src/lib.rs', 'src/main/java'
  ];
  for (const f of ENTRY_FILES) {
    if (fs.existsSync(path.join(abs, f))) entrypoints.push(f);
  }
  // Also look one level into common code dirs (app/main.py, src/index.js, …).
  // Small apps often tuck the entry under app/ or src/ and have no root manifest.
  const ENTRY_SUBDIRS = ['app', 'src', 'backend', 'server', 'api', 'web', 'cmd', 'bin'];
  for (const d of ENTRY_SUBDIRS) {
    const sub = path.join(abs, d);
    if (!fs.existsSync(sub)) continue;
    for (const f of ['main.py', 'app.py', '__main__.py', 'index.js', 'server.js', 'app.js', 'main.go', 'main.rs']) {
      const rel = path.join(d, f);
      if (fs.existsSync(path.join(abs, rel)) && !entrypoints.includes(rel)) {
        entrypoints.push(rel);
      }
    }
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

  const classRoots = ['model', 'models', 'domain', 'entity', 'backend', 'src', 'lib', 'core', 'app', 'internal', 'cmd', 'frontend', 'web']
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

// Leaf dir names too generic to trust as standalone mentions: matching these
// would mask real drift (e.g. pkg/common matched by any "common" label).
const GENERIC_LEAF = new Set([
  'api', 'apis', 'app', 'apps', 'application', 'server', 'servers', 'svc',
  'client', 'clients', 'web', 'ui', 'frontend', 'backend', 'config', 'configs',
  'common', 'commons', 'util', 'utils', 'helper', 'helpers', 'core', 'base',
  'lib', 'libs', 'pkg', 'internal', 'cmd', 'src', 'test', 'tests', 'testing',
  'service', 'services', 'main', 'index', 'router', 'routes', 'route',
  'handler', 'handlers', 'model', 'models', 'store', 'stores', 'db', 'database',
  'middleware', 'scripts', 'tools', 'tool', 'types', 'typescript', 'dist'
]);

/**
 * Leaf segment of a nested module label (tools/model_loaders → model_loaders).
 * LLM-curated diagrams often reference a module by its short dir name as a
 * C4/flowchart node id. Only trust specific leaves: generic names (api/config/
 * common…) would match unrelated nodes and hide genuine drift.
 */
function leafTerm(label) {
  const leaf = String(label || '').toLowerCase().split('/').pop();
  if (!leaf || leaf.length < 6 || !/[a-z]/.test(leaf)) return null;
  if (GENERIC_LEAF.has(leaf)) return null;
  return leaf;
}

function driftTerms(inventory) {
  const terms = [];
  const push = (term, label, kind, aliases) =>
    terms.push({ term, label, kind, aliases: aliases || [] });
  // Module internal/rpc is the implementation of deployment unit openim-rpc:
  // C4/block diagrams name the deployment unit ("openim-rpc" Container, sourced
  // from compose services OR the cmd/openim-rpc entrypoint dir) rather than the
  // repo path. Accept the product-prefixed unit name as an alias for short
  // module leaves (rpc/push/...). The product prefix keeps it specific — generic
  // leaves (api/common/tools) are excluded via GENERIC_LEAF.
  const unitTokens = new Set();
  (inventory.services || []).forEach((s) => unitTokens.add(String(s.label || '').toLowerCase()));
  (inventory.modules || []).forEach((m) => {
    const longLeaf = String(m.label || '').toLowerCase().split('/').pop();
    if (longLeaf && /[-_]/.test(longLeaf)) unitTokens.add(longLeaf);
  });
  const serviceAliasesFor = (moduleLabel) => {
    const leaf = String(moduleLabel || '').toLowerCase().split('/').pop();
    if (!leaf || leaf.length < 3 || GENERIC_LEAF.has(leaf)) return [];
    const out = new Set();
    for (const unit of unitTokens) {
      if (new RegExp('[-_]' + escapeRegex(leaf) + '$').test(unit)) out.add(unit);
    }
    return [...out];
  };
  const pushAll = (x, kind) => {
    // Leaf dir name is a mention alias (LLM often names the node after it):
    // tools/model_loaders → node "model_loaders" satisfies the module.
    const leaf = leafTerm(x.label);
    const aliases = leaf ? [leaf] : [];
    if (kind === 'module') aliases.push(...serviceAliasesFor(x.label));
    push(x.id, x.label, kind, [...new Set(aliases)]);
  };
  inventory.services.forEach((s) => pushAll(s, 'service'));
  inventory.modules.forEach((m) => pushAll(m, 'module'));
  // Manifests are project signals, not runtime architecture units: package.json/
  // Cargo.toml never appear as diagram nodes, and their derived terms
  // ("package"/"cargo") are generic enough to either false-fire (Python repo
  // with a stray root package.json) or mask real drift. Keep them out of terms.
  const MANIFEST_FILES = new Set(['package.json', 'Cargo.toml', 'pom.xml', 'build.gradle']);
  inventory.entrypoints
    .filter((e) => !MANIFEST_FILES.has(e))
    .forEach((e) => {
      const noExt = e.replace(/\.[^.]+$/, '');
      const term = snake(noExt);
      // Nested entries (src/main.rs): the id-style term "src_main" cannot match
      // path text "src/main.rs" in a diagram's <small> tag (slash is not in the
      // [-_\s] separator class). Add the basename ("main") as an alias so a
      // diagram that cites the file path satisfies the entry.
      const base = path.basename(noExt);
      const aliases = base !== noExt && base.length >= 3 ? [snake(base)] : [];
      push(term, e, 'entry', aliases);
    });
  return uniqueBy(terms, (t) => t.term);
}

function checkDrift(inventory, mentioned, haystack) {
  // 保留两份 haystack：
  // 1) 原始小写（保护缩写 OpenIM → openim 不被拆散）
  // 2) CamelCase 拆分后小写（让 AuthService → auth service 匹配 snake_case term）
  const raw = String(haystack || '');
  const hayRaw = raw.toLowerCase();
  const haySplit = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  const missing = [];
  const termRe = (s) =>
    new RegExp('\\b' + escapeRegex(s).replace(/[-_]/g, '[-_\\s]') + '\\b');
  const variantHit = (v) => {
    if (v.length < 3) return hayRaw.includes(v) || haySplit.includes(v);
    return termRe(v).test(hayRaw) || termRe(v).test(haySplit);
  };
  for (const t of driftTerms(inventory)) {
    const label = String(t.label || '').toLowerCase();
    // Module is covered if ANY of: node id declared, full id/label mentioned,
    // or a specific leaf-name alias appears (e.g. model_loaders).
    const aliases = t.aliases || [];
    const hit =
      mentioned.has(t.term) ||
      aliases.some((a) => mentioned.has(a)) ||
      [t.term, label, ...aliases].some((v) => v && variantHit(String(v)));
    if (!hit) missing.push(t);
  }
  return {
    ok: missing.length === 0,
    missing,
    checked: driftTerms(inventory).length
  };
}

module.exports = { scan, snake, driftTerms, checkDrift, hasCodeFiles, escapeRegex, SKIP_DIRS, CODE_EXT };
