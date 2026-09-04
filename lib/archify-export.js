'use strict';

/**
 * Archify export orchestration — the I/O layer around the pure IR adapter
 * (lib/export-archify.js). Shared by the CLI (`arch-viewer archify-export`)
 * and the MCP tool (`av_archify_export`).
 *
 * Responsibilities:
 *  - load the .av baseline + build the head graph + diff
 *  - emit the sparse Archify IR pair (base/head) + sidecar into .av/
 *  - optionally run `archify validate --quality standard` when an Archify CLI
 *    is discoverable. Validation failure is NEVER fatal: the caller (session
 *    report / MCP client) is expected to fall back to the builtin renderer.
 *
 * tryRenderArchify / finalizeSessionHtml optionally spawn `archify compare`
 * (short-lived). Validation or compare failure is never fatal.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { buildGraph } = require('./extract-graph');
const { diffGraphs } = require('./diff-graph');
const { buildArchifyPair } = require('./export-archify');

const SCOPES = ['changed', 'violations', 'layers'];

function baselinePath(repo) {
  return path.join(repo, '.av', 'graph-baseline.json');
}

/**
 * Locate an Archify CLI. Discovery order:
 *  1. explicit `archifyCli` option (--archify flag / tool arg)
 *  2. ARCHIFY_CLI env var
 *  3. `archify` on PATH
 *  4. vendored reference copy at <repo>/archify-main/archify/bin/archify.mjs
 * Returns an absolute path/command string, or null when nothing is available.
 */
function findArchifyCli({ explicit, repo } = {}) {
  if (explicit) {
    const p = path.resolve(explicit);
    if (fs.existsSync(p)) return p;
    return null;
  }
  if (process.env.ARCHIFY_CLI) {
    const p = path.resolve(process.env.ARCHIFY_CLI);
    if (fs.existsSync(p)) return p;
  }
  const onPath = spawnSync('archify', ['--version'], { encoding: 'utf8' });
  if (!onPath.error && onPath.status === 0) return 'archify';
  if (repo) {
    const vendored = path.join(repo, 'archify-main', 'archify', 'bin', 'archify.mjs');
    if (fs.existsSync(vendored)) return vendored;
  }
  return null;
}

/**
 * Run `archify validate architecture <file> --quality standard --json`.
 * Never throws: returns { ok, code, summary }.
 */
function runArchifyValidate(cliPath, file) {
  const args = cliPath.endsWith('.mjs') || cliPath.endsWith('.js')
    ? [cliPath, 'validate', 'architecture', file, '--quality', 'standard', '--json']
    : ['validate', 'architecture', file, '--quality', 'standard', '--json'];
  const cmd = (cliPath.endsWith('.mjs') || cliPath.endsWith('.js')) ? 'node' : cliPath;
  let res;
  try {
    res = spawnSync(cmd, args, { encoding: 'utf8' });
  } catch (e) {
    return { ok: false, summary: `failed to launch archify: ${e.message}` };
  }
  const raw = (res.stdout || '') + (res.stderr || '');
  let parsed = null;
  try { parsed = JSON.parse(res.stdout || '{}'); } catch { /* non-json output */ }
  if (res.status === 0 && parsed && parsed.ok !== false) {
    return { ok: true, summary: parsed.summary || 'validate passed' };
  }
  // Extract the first few diagnostic codes for a compact, actionable summary.
  const codes = [...raw.matchAll(/"code":\s*"([^"]+)"/g)].map((m) => m[1]);
  const uniq = [...new Set(codes)].slice(0, 4);
  const msg = parsed && parsed.error
    ? String(parsed.error).split('\n').slice(0, 3).join(' | ')
    : raw.slice(0, 300);
  return { ok: false, codes: uniq, summary: msg };
}

/**
 * Export the Archify IR pair for a repo.
 *
 * @param {object} opts
 * @param {string} opts.repo       repository root
 * @param {string} [opts.scope]    changed | violations | layers (default changed)
 * @param {string} [opts.outDir]   output directory (default <repo>/.av)
 * @param {boolean} [opts.validate] run archify validate when a CLI is available
 * @param {string} [opts.archifyCli] explicit path to archify CLI
 * @returns {object} { error? , files, sidecar, validation? }
 */
function exportArchify(opts = {}) {
  const repo = path.resolve(opts.repo || process.cwd());
  const scope = SCOPES.includes(opts.scope) ? opts.scope : 'changed';
  const outDir = opts.outDir ? path.resolve(opts.outDir) : path.join(repo, '.av');

  const bp = baselinePath(repo);
  if (!fs.existsSync(bp)) {
    return { error: 'NO_BASELINE', message: 'No baseline found. Run `arch-viewer session start` first.' };
  }

  const baseGraph = JSON.parse(fs.readFileSync(bp, 'utf8'));
  const headGraph = buildGraph(repo);
  const diff = diffGraphs(baseGraph, headGraph);

  const { base, head, sidecar } = buildArchifyPair({
    headGraph,
    baseGraph,
    diff,
    scope,
    title: path.basename(repo)
  });

  fs.mkdirSync(outDir, { recursive: true });
  const baseFile = path.join(outDir, `archify-${scope}.base.json`);
  const headFile = path.join(outDir, `archify-${scope}.head.json`);
  const sidecarFile = path.join(outDir, `archify-${scope}.sidecar.json`);
  fs.writeFileSync(baseFile, JSON.stringify(base, null, 2));
  fs.writeFileSync(headFile, JSON.stringify(head, null, 2));
  fs.writeFileSync(sidecarFile, JSON.stringify(sidecar, null, 2));

  const result = {
    scope,
    files: { base: baseFile, head: headFile, sidecar: sidecarFile },
    sidecar: {
      scopeRequested: sidecar.scopeRequested,
      scopeUsed: sidecar.scopeUsed,
      downgradedToLayers: sidecar.downgradedToLayers,
      downgradeReason: sidecar.downgradeReason,
      componentCount: sidecar.componentCount,
      connectionCount: sidecar.connectionCount,
      droppedSameLayerEdges: sidecar.droppedSameLayerEdges
    }
  };

  if (opts.validate) {
    const cli = findArchifyCli({ explicit: opts.archifyCli, repo });
    if (!cli) {
      result.validation = {
        available: false,
        message: 'Archify CLI not found (set --archify <path> or ARCHIFY_CLI). IR files written anyway; use the builtin renderer.'
      };
    } else {
      result.validation = {
        available: true,
        cli,
        base: runArchifyValidate(cli, baseFile),
        head: runArchifyValidate(cli, headFile)
      };
      result.validation.ok = result.validation.base.ok && result.validation.head.ok;
    }
  }

  return result;
}

/**
 * Run `archify compare architecture <base> <head> <out.html> --quality standard --json`.
 * Never throws.
 */
function runArchifyCompare(cliPath, baseFile, headFile, outHtml) {
  const args = cliPath.endsWith('.mjs') || cliPath.endsWith('.js')
    ? [cliPath, 'compare', 'architecture', baseFile, headFile, outHtml, '--quality', 'standard', '--json']
    : ['compare', 'architecture', baseFile, headFile, outHtml, '--quality', 'standard', '--json'];
  const cmd = (cliPath.endsWith('.mjs') || cliPath.endsWith('.js')) ? 'node' : cliPath;
  let res;
  try {
    res = spawnSync(cmd, args, { encoding: 'utf8' });
  } catch (e) {
    return { ok: false, summary: `failed to launch archify compare: ${e.message}` };
  }
  let parsed = null;
  try { parsed = JSON.parse(res.stdout || '{}'); } catch { /* non-json */ }
  const exists = fs.existsSync(outHtml) && fs.statSync(outHtml).size > 0;
  if (res.status === 0 && exists && parsed && parsed.ok !== false) {
    return { ok: true, summary: parsed.summary || 'compare passed', htmlPath: outHtml };
  }
  const msg = parsed && parsed.error
    ? String(parsed.error).split('\n').slice(0, 3).join(' | ')
    : ((res.stderr || res.stdout || '').slice(0, 300) || `compare exit ${res.status}`);
  return { ok: false, summary: msg };
}

/**
 * Try Archify HTML after export + validate + compare. Never throws.
 * renderer: auto (default) | archify | builtin
 * `archify` still falls back to builtin on any failure — report never blocks.
 */
function tryRenderArchify(opts = {}) {
  const renderer = opts.renderer || process.env.AV_RENDERER || 'auto';
  if (renderer === 'builtin') {
    return { used: 'builtin', reason: 'renderer=builtin' };
  }
  const exported = exportArchify({
    repo: opts.repo,
    scope: opts.scope || 'changed',
    outDir: opts.outDir,
    validate: true,
    archifyCli: opts.archifyCli
  });
  if (exported.error) {
    return { used: 'builtin', reason: exported.message || exported.error };
  }
  const v = exported.validation;
  if (!v || !v.available) {
    return {
      used: 'builtin',
      reason: 'archify-cli-missing',
      files: exported.files,
      sidecar: exported.sidecar,
      validation: v
    };
  }
  if (!v.ok) {
    return {
      used: 'builtin',
      reason: 'validate-failed',
      files: exported.files,
      sidecar: exported.sidecar,
      validation: v
    };
  }
  const outDir = opts.outDir ? path.resolve(opts.outDir) : path.join(path.resolve(opts.repo), '.av');
  const archifyHtml = path.join(outDir, 'session-report.archify.html');
  const cmp = runArchifyCompare(v.cli, exported.files.base, exported.files.head, archifyHtml);
  if (!cmp.ok) {
    return {
      used: 'builtin',
      reason: 'compare-failed',
      files: exported.files,
      sidecar: exported.sidecar,
      validation: v,
      compare: cmp
    };
  }
  return {
    used: 'archify',
    reason: 'ok',
    htmlPath: archifyHtml,
    files: exported.files,
    sidecar: exported.sidecar,
    validation: v,
    compare: cmp
  };
}

/**
 * Always write builtin HTML; promote Archify to session-report.html when compare succeeds.
 */
function finalizeSessionHtml({ repo, builtinHtml, renderer, archifyCli, scope }) {
  const avDir = path.join(path.resolve(repo), '.av');
  fs.mkdirSync(avDir, { recursive: true });
  const htmlPath = path.join(avDir, 'session-report.html');
  const builtinPath = path.join(avDir, 'session-report.builtin.html');
  fs.writeFileSync(builtinPath, builtinHtml);

  const attempt = tryRenderArchify({ repo, scope, renderer, archifyCli, outDir: avDir });
  if (attempt.used === 'archify' && attempt.htmlPath && fs.existsSync(attempt.htmlPath)) {
    fs.copyFileSync(attempt.htmlPath, htmlPath);
  } else {
    fs.writeFileSync(htmlPath, builtinHtml);
  }
  return { htmlPath, builtinPath, renderer: attempt };
}

module.exports = {
  exportArchify,
  findArchifyCli,
  runArchifyValidate,
  runArchifyCompare,
  tryRenderArchify,
  finalizeSessionHtml,
  SCOPES
};
