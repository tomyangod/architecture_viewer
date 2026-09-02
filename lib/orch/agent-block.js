'use strict';

/**
 * 精修管线「读仓画图」：Agent 写 block-diagram → 路径闸门 → 确定性扫尾。
 * 对外错误与日志不得出现内部引擎编号。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { findKitDir, initKit } = require('../init');
const { buildTree, lintBlockDiagram } = require('./lib');

function findDsh() {
  // 1) 显式指定（主入口）
  if (process.env.DSH_BIN && fs.existsSync(process.env.DSH_BIN)) return process.env.DSH_BIN;
  // 2) PATH 查找（which/where）
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const r = spawnSync(finder, ['dsh'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) {
      const p = (r.stdout || '').split(/\r?\n/)[0].trim();
      if (p && fs.existsSync(p)) return p;
    }
  } catch { /* which 不可用则继续 */ }
  // 3) npx 缓存动态扫描（缓存 hash 随 npx/Node 版本变化，不能硬编码）
  try {
    const npxRoot = path.join(os.homedir(), '.npm/_npx');
    if (fs.existsSync(npxRoot)) {
      for (const hash of fs.readdirSync(npxRoot)) {
        const cand = path.join(npxRoot, hash, 'node_modules/.bin/dsh');
        if (fs.existsSync(cand)) return cand;
      }
    }
  } catch { /* 缓存目录不可读则放弃 */ }
  return null;
}

function agentUnavailable(msg) {
  const e = new Error(msg || '读仓画图不可用，改走编排精修。');
  e.code = 'AGENT_UNAVAILABLE';
  return e;
}

function dshOnce(bin, cwd, task, env, logPath) {
  const r = spawnSync(bin, ['--profile', 'headless', task], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: 180000
  });
  const text = (r.stdout || '') + (r.stderr || '');
  if (logPath) {
    try { fs.writeFileSync(logPath, text); } catch { /* ignore */ }
  }
  return { code: r.status, text };
}

function reviewPrompt(missing, issues) {
  return [
    'A deterministic path-truth gate FAILED on architecture_viewer/block-diagram.md.',
    'These <small> tokens look like paths but DO NOT exist in this repository file tree:',
    ...missing.map((p) => '  - ' + p),
    '',
    'Other lint issues:',
    ...issues.filter((i) => !i.startsWith('路径在文件树中不存在')).slice(0, 8).map((i) => '  - ' + i),
    '',
    'Fix ONLY architecture_viewer/block-diagram.md:',
    '1. Remove or rewrite every failing token. Tech names must have NO slash (e.g. Playwright, PostgreSQL).',
    '2. Every remaining path-like token must exist (verify with test -e or ls).',
    '3. Keep the layered flowchart style, Chinese edge labels, and a second 子图.',
    '4. Do not invent new filenames.',
    '5. Print LAYERS=... NODES=... DONE when finished.'
  ].join('\n');
}

/**
 * @returns {Promise<{ md: string, outdir: string, state: object }>}
 */
async function generateBlockAgent(repoRoot, opts) {
  const bin = findDsh();
  if (!bin) throw agentUnavailable();

  const root = path.resolve(repoRoot);
  let kitDir = findKitDir(root);
  if (!kitDir) kitDir = initKit(root).dest;
  const mdPath = path.join(kitDir, 'block-diagram.md');
  const prompt = fs.readFileSync(path.join(__dirname, 'agent-block-prompt.txt'), 'utf8');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-agent-'));
  const env = Object.assign({}, process.env);
  if (opts && typeof opts.apiKey === 'string' && opts.apiKey.trim()) {
    env.DEEPSEEK_API_KEY = opts.apiKey.trim();
  }
  if (!env.DEEPSEEK_API_KEY) throw agentUnavailable('缺少 API Key，无法精修。');
  env.DSH_HOME = env.DSH_HOME || work;
  env.HOME = env.DSH_HOME;

  // 记录运行前内容：initKit 会拷贝模板 block-diagram.md，若 dsh 崩溃/空跑，
  // 文件仍存在且内容不变——必须判为不可用，不能把模板当 agent 产物返回。
  const mdBefore = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : null;
  const r1 = dshOnce(bin, root, prompt, env, path.join(work, 'run1.log'));
  if (!fs.existsSync(mdPath)) throw agentUnavailable('读仓画图未产出 block-diagram.md。');
  if (mdBefore !== null && fs.readFileSync(mdPath, 'utf8') === mdBefore) {
    throw agentUnavailable('读仓画图运行时未覆写 block-diagram.md（dsh 退出码 ' + (r1.code == null ? '?' : r1.code) + '）。');
  }

  let lint = lintBlockDiagram(fs.readFileSync(mdPath, 'utf8'), buildTree(root));
  for (let i = 2; i <= 3 && lint.missingPaths && lint.missingPaths.length; i++) {
    dshOnce(bin, root, reviewPrompt(lint.missingPaths, lint.issues || []), env, path.join(work, 'run' + i + '.log'));
    lint = lintBlockDiagram(fs.readFileSync(mdPath, 'utf8'), buildTree(root));
  }

  let md = fs.readFileSync(mdPath, 'utf8');
  try {
    const { deterministicSweep } = require('./run');
    const { findAnchorsV2 } = require('./lib');
    const { inspectShape } = require('../refine-route');
    // 与编排管线（runOrchEdge）同口径：真实 anchors 驱动扫尾，不传空数组
    let anchors = [];
    try {
      const imp = inspectShape(root);
      anchors = findAnchorsV2(buildTree(root), imp);
    } catch { /* 形态取证失败退化为空 anchors，仍跑扫尾 */ }
    const swept = deterministicSweep(md, anchors, [path.basename(root)]);
    if (swept && swept.md) md = swept.md;
  } catch { /* sweep 失败保留原稿 */ }

  if (!md.includes('```mermaid')) throw agentUnavailable('读仓画图产物无效。');
  fs.writeFileSync(path.join(work, 'block-diagram.md'), md);
  return { md, outdir: work, state: { lint } };
}

module.exports = { generateBlockAgent, findDsh };
