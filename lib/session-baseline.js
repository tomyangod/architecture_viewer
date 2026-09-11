'use strict';

/**
 * Session baseline resolution.
 *
 * Default for a git repo: structure of git HEAD, cached at .av/graph-head.json
 * and invalidated by commit hash. Commit = accept.
 *
 * No git (or no HEAD yet): fall back to .av/graph-baseline.json (session start).
 *
 * Opt-in snapshot pin: AV_BASELINE=snapshot or .av/session.json { "baseline": "snapshot" }.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { findGitRoot } = require('./session-paths');
const { buildGraph, toPersistableGraph } = require('./extract-graph');
const { buildTestIndex } = require('./extract/test-index');

const HEAD_CACHE = 'graph-head.json';
const HEAD_CACHE_VERSION = 2;
const SNAPSHOT = 'graph-baseline.json';
const LAYER_CONFIG = path.join('.av', 'layers.json');
const OVERLAY_FILES = [
  LAYER_CONFIG,
  'architecture-rules.yaml',
  'architecture-rules.yml'
];

function avDir(repo) {
  return path.join(repo, '.av');
}

function snapshotPath(repo) {
  return path.join(avDir(repo), SNAPSHOT);
}

function headCachePath(repo) {
  return path.join(avDir(repo), HEAD_CACHE);
}

function runGit(cwd, args, opts = {}) {
  return spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    timeout: opts.timeout || 30000,
    maxBuffer: opts.maxBuffer || 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function gitHeadSha(repo) {
  const r = runGit(repo, ['rev-parse', 'HEAD']);
  if (r.status !== 0) return null;
  const sha = String(r.stdout || '').trim();
  return /^[0-9a-f]{4,40}$/i.test(sha) ? sha : null;
}

function gitHasUncommitted(repo) {
  const r = runGit(repo, ['status', '--porcelain', '-uall']);
  if (r.status !== 0) return false;
  const lines = String(r.stdout || '').split('\n').map((l) => l.trimEnd()).filter(Boolean);
  return lines.some((line) => {
    // XY<space>path  or  R  old -> new
    let file = line.slice(3).trim();
    const arrow = file.lastIndexOf(' -> ');
    if (arrow >= 0) file = file.slice(arrow + 4).trim();
    file = file.replace(/^"+|"+$/g, '').replace(/\\/g, '/');
    if (file === '.av' || file.startsWith('.av/')) return false;
    return true;
  });
}

function preferSnapshot(repo) {
  if (String(process.env.AV_BASELINE || '').trim().toLowerCase() === 'snapshot') return true;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(avDir(repo), 'session.json'), 'utf8'));
    return cfg && cfg.baseline === 'snapshot';
  } catch {
    return false;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readSnapshot(repo) {
  const file = snapshotPath(repo);
  if (!fs.existsSync(file)) return null;
  const graph = readJson(file);
  if (!graph || !graph.fingerprint) return null;
  return graph;
}

function overlayWorkingConfig(repo, extractDir) {
  for (const rel of OVERLAY_FILES) {
    const src = path.join(repo, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    const dest = path.join(extractDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (rel !== LAYER_CONFIG) {
      fs.copyFileSync(src, dest);
      continue;
    }
    const working = JSON.parse(fs.readFileSync(src, 'utf8'));
    const archived = fs.existsSync(dest) ? JSON.parse(fs.readFileSync(dest, 'utf8')) : {};
    for (const config of [working, archived]) {
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error(`${LAYER_CONFIG} must contain a JSON object`);
      }
    }
    // Share layer mappings, but compare each revision's own scan exclusions.
    for (const key of ['externalDirs', 'external_dirs']) {
      delete working[key];
      if (Object.prototype.hasOwnProperty.call(archived, key)) working[key] = archived[key];
    }
    fs.writeFileSync(dest, JSON.stringify(working));
  }
}

function archiveTreeish(repo, ref) {
  const gitRoot = findGitRoot(repo);
  if (!gitRoot) return null;
  const spec = String(ref || 'HEAD').trim();
  if (!spec || spec.startsWith('-')) return null;
  const rel = path.relative(gitRoot, path.resolve(repo));
  if (!rel || rel.startsWith('..')) {
    return { cwd: gitRoot, treeish: spec };
  }
  const posix = rel.split(path.sep).join('/');
  return { cwd: gitRoot, treeish: posix ? `${spec}:${posix}` : spec };
}

function scanGitHeadTree(repo) {
  return scanGitTreeish(repo, 'HEAD', { overlay: true });
}

/**
 * Extract an architecture graph from a git tree-ish (commit SHA or HEAD).
 * overlay=true applies working layer/rules config, preserving archived exclusions.
 */
function scanGitTreeish(repo, ref, opts = {}) {
  const spec = archiveTreeish(repo, ref);
  if (!spec) {
    return { error: 'SCAN_FAILED', message: '找不到 Git 根，无法导出该提交的树。' };
  }
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'av-tree-'));
  const extractDir = path.join(tmpRoot, 'tree');
  const tarPath = path.join(tmpRoot, 'head.tar');
  try {
    fs.mkdirSync(extractDir, { recursive: true });
    const arch = runGit(spec.cwd, ['archive', '--format=tar', '-o', tarPath, spec.treeish], {
      timeout: 120000
    });
    if (arch.status !== 0 || !fs.existsSync(tarPath)) {
      const err = String(arch.stderr || arch.stdout || 'git archive failed').trim();
      return { error: 'SCAN_FAILED', message: `导出 git ${spec.treeish} 失败：${err}` };
    }
    const tar = spawnSync('tar', ['-xf', tarPath, '-C', extractDir], {
      encoding: 'utf8',
      timeout: 120000
    });
    if (tar.status !== 0) {
      const err = String(tar.stderr || tar.stdout || tar.error || 'tar failed').trim();
      return { error: 'SCAN_FAILED', message: `解压 git 树失败：${err}` };
    }
    if (opts.overlay) overlayWorkingConfig(repo, extractDir);
    const raw = buildGraph(extractDir);
    const graph = toPersistableGraph(raw);
    graph.testIndex = buildTestIndex(extractDir);
    return { graph };
  } catch (e) {
    return { error: 'SCAN_FAILED', message: `扫描 git 树失败：${e.message}` };
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function writeHeadCache(repo, graph, sha) {
  fs.mkdirSync(avDir(repo), { recursive: true });
  const payload = {
    ...graph,
    baselineCacheVersion: HEAD_CACHE_VERSION,
    gitHead: sha,
    cachedAt: new Date().toISOString(),
    baselineKind: 'git-head'
  };
  fs.writeFileSync(headCachePath(repo), JSON.stringify(payload));
  return payload;
}

function readHeadCache(repo, sha) {
  const file = headCachePath(repo);
  if (!fs.existsSync(file)) return null;
  const cached = readJson(file);
  if (!cached || cached.baselineCacheVersion !== HEAD_CACHE_VERSION ||
      cached.gitHead !== sha || !cached.fingerprint) return null;
  return cached;
}

function fromSnapshot(repo, extra = {}) {
  const graph = readSnapshot(repo);
  if (!graph) {
    return {
      ok: false,
      error: 'NO_BASELINE',
      message: extra.noGit
        ? '还没有结构基线。请先运行 arch-viewer session start（或 av_session_start）。'
        : 'Git 尚无 HEAD，且没有 .av/graph-baseline.json。请先提交一次，或运行 session start。',
      nextStep: '调 av_session_start 拍快照，或先 git commit。'
    };
  }
  return {
    ok: true,
    kind: 'snapshot',
    graph,
    gitHead: extra.gitHead || null,
    hasUncommitted: extra.hasUncommitted === true,
    cacheHit: false,
    snapshotPath: snapshotPath(repo)
  };
}

/**
 * @param {string} repo
 * @returns {{ ok: true, kind: 'git-head'|'snapshot', graph: object, gitHead: string|null, hasUncommitted: boolean, cacheHit: boolean } | { ok: false, error: string, message: string, nextStep?: string }}
 */
function resolveSessionBaseline(repo) {
  const abs = path.resolve(repo);
  const gitRoot = findGitRoot(abs);
  const sha = gitRoot ? gitHeadSha(abs) : null;
  const dirty = gitRoot ? gitHasUncommitted(abs) : false;

  if (preferSnapshot(abs)) {
    const pinned = fromSnapshot(abs, { gitHead: sha, hasUncommitted: dirty, noGit: !gitRoot });
    if (pinned.ok) return pinned;
    // 显式要求 snapshot 但没有文件时，有 git HEAD 仍可继续
  }

  if (sha) {
    const hit = readHeadCache(abs, sha);
    if (hit) {
      return {
        ok: true,
        kind: 'git-head',
        graph: hit,
        gitHead: sha,
        hasUncommitted: dirty,
        cacheHit: true,
        cachePath: headCachePath(abs)
      };
    }
    const scanned = scanGitHeadTree(abs);
    if (scanned.error) {
      const fallback = fromSnapshot(abs, { gitHead: sha, hasUncommitted: dirty });
      if (fallback.ok) return fallback;
      return {
        ok: false,
        error: scanned.error,
        message: scanned.message,
        nextStep: '检查 git archive / tar 是否可用，或改用 session start 快照基线。'
      };
    }
    const stored = writeHeadCache(abs, scanned.graph, sha);
    return {
      ok: true,
      kind: 'git-head',
      graph: stored,
      gitHead: sha,
      hasUncommitted: dirty,
      cacheHit: false,
      cachePath: headCachePath(abs)
    };
  }

  return fromSnapshot(abs, { gitHead: null, hasUncommitted: dirty, noGit: !gitRoot });
}

function noBaselinePayload() {
  return {
    error: 'NO_BASELINE',
    message: '还没有结构基线。有 git 的仓库会自动对照 HEAD；否则请调 av_guard（会自动补快照）或 av_session_start。',
    nextStep: '日常调 av_guard；无 git 时也会自动 ensure。高级场景可显式 av_session_start。'
  };
}

function hasResolvableBaseline(repo) {
  if (readSnapshot(repo)) return true;
  return !!gitHeadSha(path.resolve(repo));
}

/**
 * Ensure a resolvable baseline for av_guard / session guard.
 * Git HEAD repos resolve without writing. No-git (or empty) repos get a
 * one-shot .av/graph-baseline.json of the current tree (first guard → green).
 *
 * @param {string} repo
 * @returns {{ ensured: boolean, ok: true, kind: string, graph: object, gitHead: string|null, hasUncommitted: boolean } | { ensured: boolean, ok: false, error: string, message: string, nextStep?: string }}
 */
function ensureSessionBaseline(repo) {
  const abs = path.resolve(repo);
  const resolved = resolveSessionBaseline(abs);
  if (resolved.ok) return { ensured: false, ...resolved };
  if (resolved.error && resolved.error !== 'NO_BASELINE') {
    return { ensured: false, ...resolved };
  }

  fs.mkdirSync(avDir(abs), { recursive: true });
  const graph = buildGraph(abs);
  const snapshot = {
    ...toPersistableGraph(graph),
    sessionStartedAt: new Date().toISOString(),
    testIndex: buildTestIndex(abs),
    ensuredBy: 'av_guard'
  };
  fs.writeFileSync(snapshotPath(abs), JSON.stringify(snapshot, null, 2));

  const again = resolveSessionBaseline(abs);
  if (!again.ok) return { ensured: true, ...again };
  return { ensured: true, ...again };
}

module.exports = {
  resolveSessionBaseline,
  ensureSessionBaseline,
  snapshotPath,
  headCachePath,
  gitHeadSha,
  gitHasUncommitted,
  preferSnapshot,
  noBaselinePayload,
  hasResolvableBaseline,
  scanGitTreeish,
  HEAD_CACHE,
  SNAPSHOT
};
