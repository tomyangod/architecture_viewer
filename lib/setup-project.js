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

module.exports = {
  installProjectGate,
  installCursorHooks,
  installClaudeHooks,
  installRules,
  installProjectMcp,
  gateCommand,
  cliJsPath
};
