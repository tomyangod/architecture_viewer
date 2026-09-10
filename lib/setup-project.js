'use strict';

/**
 * Install project-level architecture gate adapters for multiple AI hosts.
 *
 * Universal core: MCP `av_guard` + CLI `session guard`
 * Host adapters only translate gate results:
 *   Cursor stop  → followup_message
 *   Claude Stop  → exit 2 + decision.block
 *   DeepSeek / Windsurf / others → AGENTS.md / rules tell Agent to call av_guard
 *   All → git pre-commit (templates/pre-commit)
 */

const fs = require('fs');
const path = require('path');
const { magicPrompt, resolveLauncher, mcpServerPath } = require('./setup-shared');

const PKG_ROOT = path.join(__dirname, '..');

function cliJsPath() {
  // Prefer the package that is running setup (global or clone)
  return path.join(PKG_ROOT, 'lib', 'cli.js');
}

function gateCommand(adapter) {
  const node = process.execPath;
  const cli = cliJsPath();
  return `${JSON.stringify(node)} ${JSON.stringify(cli)} session guard --adapter ${adapter}`;
}

function writeJsonMerge(file, mutator) {
  let cfg = {};
  if (fs.existsSync(file)) {
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.copyFileSync(file, file + '.av-bak');
    } catch {
      fs.copyFileSync(file, file + '.corrupt-' + Date.now() + '.bak');
      cfg = {};
    }
  }
  const next = mutator(cfg) || cfg;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return file;
}

function installCursorHooks(repo) {
  const hooksJson = path.join(repo, '.cursor', 'hooks.json');
  writeJsonMerge(hooksJson, (cfg) => {
    cfg.version = 1;
    cfg.hooks = cfg.hooks || {};
    cfg.hooks.stop = [{
      command: gateCommand('cursor'),
      timeout: 120,
      loop_limit: 1
    }];
    // sessionStart intentionally omitted: fire-and-forget + additional_context bugs (W23-02)
    return cfg;
  });
  return hooksJson;
}

function installClaudeHooks(repo) {
  const settings = path.join(repo, '.claude', 'settings.json');
  writeJsonMerge(settings, (cfg) => {
    cfg.hooks = cfg.hooks || {};
    cfg.hooks.Stop = [
      {
        hooks: [
          { type: 'command', command: gateCommand('claude'), timeout: 120 }
        ]
      }
    ];
    return cfg;
  });
  return settings;
}

function installRules(repo) {
  const written = [];
  const prompt = magicPrompt();
  const block = (title) => `\n\n<!-- arch-viewer-gate -->\n## ${title}\n\n${prompt}\n<!-- /arch-viewer-gate -->\n`;

  function upsertMarkdown(file, title) {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      if (raw.includes('arch-viewer-gate')) return false;
      fs.copyFileSync(file, file + '.av-bak');
      fs.writeFileSync(file, raw.replace(/\s*$/, '') + block(title));
    } else {
      fs.writeFileSync(file, `# ${title}\n${block(title)}`);
    }
    written.push(file);
    return true;
  }

  upsertMarkdown(path.join(repo, 'AGENTS.md'), 'Architecture Viewer');
  upsertMarkdown(path.join(repo, 'CLAUDE.md'), 'Architecture Viewer');

  const cursorRule = path.join(repo, '.cursor', 'rules', 'architecture-session.mdc');
  fs.mkdirSync(path.dirname(cursorRule), { recursive: true });
  fs.writeFileSync(cursorRule, [
    '---',
    'description: Architecture Viewer 会话结构验收（MCP av_guard，跨 Cursor/Claude/DeepSeek）',
    'globs: "**/*.{js,ts,jsx,tsx,py,go,java,vue,svelte}"',
    'alwaysApply: true',
    '---',
    '',
    prompt,
    ''
  ].join('\n'));
  written.push(cursorRule);

  // DeepSeek Harness / generic: also drop a short skill-like note
  const avNote = path.join(repo, '.av', 'AGENT-GATE.md');
  fs.mkdirSync(path.dirname(avNote), { recursive: true });
  fs.writeFileSync(avNote, '# Architecture Viewer gate\n\n' + prompt + '\n');
  written.push(avNote);

  return written;
}

function installProjectMcp(repo) {
  const launcher = resolveLauncher();
  const server = {
    command: launcher.command,
    args: launcher.args && launcher.args.length ? launcher.args : [mcpServerPath()]
  };
  // Local clone setup may use relative "node"; pin absolute when possible
  if (server.command === 'node' && server.args[0] && !path.isAbsolute(server.args[0])) {
    server.args = [path.resolve(server.args[0])];
  }
  if (server.args[0] && !path.isAbsolute(server.args[0]) && fs.existsSync(mcpServerPath())) {
    server.command = process.execPath;
    server.args = [mcpServerPath()];
  }
  const file = path.join(repo, '.cursor', 'mcp.json');
  writeJsonMerge(file, (cfg) => {
    cfg.mcpServers = cfg.mcpServers || {};
    cfg.mcpServers['arch-viewer'] = server;
    return cfg;
  });
  return file;
}

/**
 * @param {string} repo
 * @param {{ mcp?: boolean }} [opts]
 */
function installProjectGate(repo, opts = {}) {
  const abs = path.resolve(repo);
  const results = [];
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return { results: [{ id: 'project', name: '项目仓', status: 'error', detail: '不是目录：' + abs }] };
  }

  try {
    results.push({ id: 'cursor-hooks', name: 'Cursor hooks（stop→session guard）', status: 'configured', detail: installCursorHooks(abs) });
  } catch (e) {
    results.push({ id: 'cursor-hooks', name: 'Cursor hooks', status: 'error', detail: e.message });
  }

  try {
    results.push({ id: 'claude-hooks', name: 'Claude Code hooks（Stop→session guard）', status: 'configured', detail: installClaudeHooks(abs) });
  } catch (e) {
    results.push({ id: 'claude-hooks', name: 'Claude Code hooks', status: 'error', detail: e.message });
  }

  try {
    results.push({
      id: 'agent-rules',
      name: '跨宿主规则（AGENTS.md / CLAUDE.md / Cursor Rules / .av/AGENT-GATE.md）',
      status: 'configured',
      detail: installRules(abs).join(', ')
    });
  } catch (e) {
    results.push({ id: 'agent-rules', name: 'Agent 规则', status: 'error', detail: e.message });
  }

  if (opts.mcp !== false) {
    try {
      results.push({
        id: 'project-mcp',
        name: '项目级 .cursor/mcp.json',
        status: 'configured',
        detail: installProjectMcp(abs)
      });
    } catch (e) {
      results.push({ id: 'project-mcp', name: '项目级 MCP', status: 'error', detail: e.message });
    }
  }

  results.push({
    id: 'universal',
    name: '通用入口',
    status: 'configured',
    detail: 'MCP av_guard · CLI session guard · git pre-commit（templates/pre-commit）'
  });

  return { results };
}

function backupIfExists(file) {
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.av-bak');
}

function isAvHookCommand(cmd) {
  const s = String(cmd || '');
  return /session guard/.test(s)
    || /av-stop\.js/.test(s)
    || /av-stop-cursor/.test(s)
    || /av-stop-claude/.test(s)
    || /av-gate\.js/.test(s);
}

function uninstallCursorHooks(repo) {
  const file = path.join(repo, '.cursor', 'hooks.json');
  if (!fs.existsSync(file)) return { status: 'already', detail: file };
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { status: 'error', detail: '无法解析 ' + file };
  }
  const stop = (cfg.hooks && cfg.hooks.stop) || [];
  const kept = stop.filter((h) => !isAvHookCommand(h && h.command));
  if (kept.length === stop.length && !stop.some((h) => isAvHookCommand(h && h.command))) {
    return { status: 'already', detail: file };
  }
  backupIfExists(file);
  cfg.hooks = cfg.hooks || {};
  if (kept.length) cfg.hooks.stop = kept;
  else delete cfg.hooks.stop;
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return { status: 'removed', detail: file };
}

function uninstallClaudeHooks(repo) {
  const file = path.join(repo, '.claude', 'settings.json');
  if (!fs.existsSync(file)) return { status: 'already', detail: file };
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { status: 'error', detail: '无法解析 ' + file };
  }
  const groups = (cfg.hooks && cfg.hooks.Stop) || [];
  const next = [];
  let changed = false;
  for (const g of groups) {
    const hooks = (g && g.hooks) || [];
    const kept = hooks.filter((h) => !isAvHookCommand(h && h.command));
    if (kept.length !== hooks.length) changed = true;
    if (kept.length) next.push({ ...g, hooks: kept });
  }
  if (!changed) return { status: 'already', detail: file };
  backupIfExists(file);
  cfg.hooks = cfg.hooks || {};
  if (next.length) cfg.hooks.Stop = next;
  else delete cfg.hooks.Stop;
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return { status: 'removed', detail: file };
}

function stripGateMarkdown(file) {
  if (!fs.existsSync(file)) return { status: 'already', detail: file };
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.includes('arch-viewer-gate')) return { status: 'already', detail: file };
  backupIfExists(file);
  const next = raw.replace(/\n*<!-- arch-viewer-gate -->[\s\S]*?<!-- \/arch-viewer-gate -->\n*/g, '\n')
    .replace(/^\s+|\s+$/g, '');
  if (!next || /^# Architecture Viewer\s*$/.test(next)) {
    fs.unlinkSync(file);
    return { status: 'removed', detail: file };
  }
  fs.writeFileSync(file, next + '\n');
  return { status: 'removed', detail: file };
}

function uninstallRules(repo) {
  const details = [];
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const r = stripGateMarkdown(path.join(repo, name));
    details.push(r.detail + (r.status === 'removed' ? '' : '（跳过）'));
  }
  const cursorRule = path.join(repo, '.cursor', 'rules', 'architecture-session.mdc');
  if (fs.existsSync(cursorRule)) {
    backupIfExists(cursorRule);
    fs.unlinkSync(cursorRule);
    details.push(cursorRule);
  }
  const avNote = path.join(repo, '.av', 'AGENT-GATE.md');
  if (fs.existsSync(avNote)) {
    backupIfExists(avNote);
    fs.unlinkSync(avNote);
    details.push(avNote);
  }
  return details;
}

function uninstallProjectMcp(repo) {
  const file = path.join(repo, '.cursor', 'mcp.json');
  if (!fs.existsSync(file)) return { status: 'already', detail: file };
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { status: 'error', detail: '无法解析 ' + file };
  }
  if (!cfg.mcpServers || !cfg.mcpServers['arch-viewer']) {
    return { status: 'already', detail: file };
  }
  backupIfExists(file);
  delete cfg.mcpServers['arch-viewer'];
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return { status: 'removed', detail: file };
}

function uninstallAvPreCommit(repo) {
  const file = path.join(repo, '.git', 'hooks', 'pre-commit');
  if (!fs.existsSync(file)) return { status: 'already', detail: file };
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.includes('Architecture Viewer · pre-commit')) {
    return { status: 'skipped', detail: '未识别为 AV 钩子，未改 ' + file };
  }
  backupIfExists(file);
  fs.unlinkSync(file);
  return { status: 'removed', detail: file };
}

const PURGE_AV_NAMES = [
  'session-report.json',
  'session-report.html',
  'session-report.builtin.html',
  'session-report.archify.html',
  'session-report.archify.receipt.json',
  'graph-head.json',
  'graph-baseline.json',
  'session-history.jsonl',
  'session-intent.json',
  'habit-gate-log.md',
  'workspace.json'
];

function purgeAvArtifacts(repo) {
  const dir = path.join(repo, '.av');
  if (!fs.existsSync(dir)) return { status: 'already', detail: dir };
  const removed = [];
  for (const name of PURGE_AV_NAMES) {
    const f = path.join(dir, name);
    if (fs.existsSync(f)) {
      fs.unlinkSync(f);
      removed.push(name);
    }
  }
  try {
    for (const name of fs.readdirSync(dir)) {
      if (/^archify-/.test(name) || /^session-report\./.test(name)) {
        const f = path.join(dir, name);
        if (fs.existsSync(f) && fs.statSync(f).isFile()) {
          fs.unlinkSync(f);
          removed.push(name);
        }
      }
    }
  } catch { /* ignore */ }
  return {
    status: removed.length ? 'removed' : 'already',
    detail: removed.length ? removed.join(', ') : '无可清会话产物（保留 layers.json 等）'
  };
}

/**
 * Inverse of installProjectGate. Does not touch .av/layers.json unless purge.
 * @param {string} repo
 * @param {{ purge?: boolean }} [opts]
 */
function uninstallProjectGate(repo, opts = {}) {
  const abs = path.resolve(repo);
  const results = [];
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return { results: [{ id: 'project', name: '项目仓', status: 'error', detail: '不是目录：' + abs }] };
  }

  const push = (id, name, r) => {
    results.push({ id, name, status: r.status, detail: r.detail });
  };

  try { push('cursor-hooks', 'Cursor hooks', uninstallCursorHooks(abs)); }
  catch (e) { results.push({ id: 'cursor-hooks', name: 'Cursor hooks', status: 'error', detail: e.message }); }
  try { push('claude-hooks', 'Claude Code hooks', uninstallClaudeHooks(abs)); }
  catch (e) { results.push({ id: 'claude-hooks', name: 'Claude Code hooks', status: 'error', detail: e.message }); }
  try {
    const details = uninstallRules(abs);
    results.push({ id: 'agent-rules', name: '跨宿主规则', status: 'removed', detail: details.join(', ') });
  } catch (e) {
    results.push({ id: 'agent-rules', name: 'Agent 规则', status: 'error', detail: e.message });
  }
  try { push('project-mcp', '项目级 .cursor/mcp.json', uninstallProjectMcp(abs)); }
  catch (e) { results.push({ id: 'project-mcp', name: '项目级 MCP', status: 'error', detail: e.message }); }
  try { push('pre-commit', 'git pre-commit（仅 AV 模板）', uninstallAvPreCommit(abs)); }
  catch (e) { results.push({ id: 'pre-commit', name: 'git pre-commit', status: 'error', detail: e.message }); }

  if (opts.purge) {
    try { push('purge-av', '.av 会话产物（保留 layers.json）', purgeAvArtifacts(abs)); }
    catch (e) { results.push({ id: 'purge-av', name: '.av 会话产物', status: 'error', detail: e.message }); }
  }

  return { results };
}

module.exports = {
  installProjectGate,
  uninstallProjectGate,
  installCursorHooks,
  installClaudeHooks,
  installRules,
  installProjectMcp,
  gateCommand,
  cliJsPath,
  uninstallCursorHooks,
  uninstallClaudeHooks,
  uninstallProjectMcp,
  stripGateMarkdown,
  purgeAvArtifacts
};
