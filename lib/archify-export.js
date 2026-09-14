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
const { resolveSessionBaseline } = require('./session-baseline');

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

  const resolved = resolveSessionBaseline(repo);
  if (!resolved.ok) {
    return {
      error: resolved.error || 'NO_BASELINE',
      message: resolved.message || 'No baseline found. Run `arch-viewer session start` first, or use a git repo with HEAD.'
    };
  }

  const baseGraph = resolved.graph;
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
        status: 'not_validated',
        message: 'Archify CLI not found (set --archify <path> or ARCHIFY_CLI). IR files written anyway; use the builtin renderer.',
        note: '未执行校验（无 Archify CLI）。IR 已写出，但不是校验通过的成品。'
      };
    } else {
      result.validation = {
        available: true,
        cli,
        base: runArchifyValidate(cli, baseFile),
        head: runArchifyValidate(cli, headFile)
      };
      result.validation.ok = result.validation.base.ok && result.validation.head.ok;
      result.validation.status = result.validation.ok ? 'validated' : 'validate_failed';
      if (!result.validation.ok) {
        result.validation.note = 'Archify 校验未通过；IR 仍保留，请用内置报告或人工核对，不要当已验证成品。';
      }
    }
  } else {
    result.validation = {
      available: false,
      status: 'not_requested',
      note: '未请求校验（未传 --validate / validate≠true）。IR 已写出，但不是校验通过的成品。导出确认不等于关系已被程序证明。'
    };
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
 * renderer: builtin (default) | auto | archify
 * `auto`/`archify` still fall back to builtin on any failure — report never blocks.
 * Default is builtin: Archify is a confirmed storytelling export, not automatic delivery.
 */
function tryRenderArchify(opts = {}) {
  const renderer = opts.renderer || process.env.AV_RENDERER || require('./view-policy').DEFAULT_SESSION_RENDERER;
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
 * Archify 成片没有 Before/Delta/After 配色；在页顶加入口，避免打开主报告看不到变更高亮。
 */
function injectDeltaBanner(html) {
  const banner =
    '<div id="av-delta-banner" style="position:sticky;top:0;z-index:9999;padding:10px 16px;' +
    'font:13px/1.5 ui-sans-serif,system-ui;background:#1e1b4b;color:#e0e7ff;border-bottom:1px solid #6366f1;">' +
    '这是 Archify 成片（好看，但<strong>不标变化颜色</strong>）。要绿/黄/红高亮定位改了什么：' +
    '<a href="session-report.builtin.html" style="color:#a5b4fc;font-weight:700;">打开 Before / Delta / After</a>' +
    '</div>';
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body[^>]*>/i, (m) => m + banner);
  return banner + html;
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
    const raw = fs.readFileSync(attempt.htmlPath, 'utf8');
    fs.writeFileSync(htmlPath, injectDeltaBanner(raw));
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
  injectDeltaBanner,
  SCOPES
};
