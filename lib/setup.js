'use strict';

/**
 * 一键接入：自动把 Architecture Viewer 的 MCP 检查工具
 * 写入已安装的 AI 编程工具（Cursor / Claude Code / Claude Desktop / Windsurf）。
 *
 * 设计原则（面向小白）：
 *  - 零编辑：用户不需要打开任何 JSON 文件
 *  - 零破坏：写入前先备份；已有的其他 MCP 工具配置原样保留
 *  - 零猜测：只给「确实装了」的工具写配置；没装的跳过并说明
 *  - 可重复：重复运行安全，已配置过的工具会跳过
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  NPM_PACKAGE, MCP_BIN, mcpServerPath, isGlobalInstalled, globalInstallInfo,
  resolveLauncher, magicPrompt
} = require('./setup-shared');

const SERVER_NAME = 'arch-viewer';
const DSH_ENTRY_ID = 'mcp-arch-viewer';
const DSH_PLUGIN = '@deepseek-ai/dsh-mcp-client';

/** 写进各 AI 工具配置里的 MCP server 描述 */
function serverConfig(launcher = resolveLauncher()) {
  return {
    command: launcher.command,
    args: launcher.args
  };
}

function home(...segments) {
  return path.join(os.homedir(), ...segments);
}

/**
 * 支持自动接入的 AI 工具清单。
 * 每个目标描述：配置文件在哪、怎么判断「装了」、怎么合并、怎么判断「已配过」。
 */
function targets() {
  const desktop = process.platform === 'darwin'
    ? home('Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    : process.platform === 'win32'
      ? path.join(process.env.APPDATA || home('AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
      : home('.config', 'Claude', 'claude_desktop_config.json');

  return [
    {
      id: 'cursor',
      name: 'Cursor',
      configPath: home('.cursor', 'mcp.json'),
      // 装了 Cursor 的标志：~/.cursor 目录存在
      installed: () => fs.existsSync(home('.cursor')),
      merge: (cfg, server) => {
        cfg.mcpServers = cfg.mcpServers || {};
        cfg.mcpServers[SERVER_NAME] = server;
        return cfg;
      },
      has: (cfg) => !!(cfg.mcpServers && cfg.mcpServers[SERVER_NAME])
    },
    {
      id: 'claude-code',
      name: 'Claude Code（命令行）',
      configPath: home('.claude.json'),
      installed: () => fs.existsSync(home('.claude.json')) || fs.existsSync(home('.claude')),
      merge: (cfg, server) => {
        cfg.mcpServers = cfg.mcpServers || {};
        cfg.mcpServers[SERVER_NAME] = server;
        return cfg;
      },
      has: (cfg) => !!(cfg.mcpServers && cfg.mcpServers[SERVER_NAME])
    },
    {
      id: 'claude-desktop',
      name: 'Claude Desktop（桌面版）',
      configPath: desktop,
      installed: () => fs.existsSync(path.dirname(desktop)),
      merge: (cfg, server) => {
        cfg.mcpServers = cfg.mcpServers || {};
        cfg.mcpServers[SERVER_NAME] = server;
        return cfg;
      },
      has: (cfg) => !!(cfg.mcpServers && cfg.mcpServers[SERVER_NAME])
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      configPath: home('.codeium', 'windsurf', 'mcp_config.json'),
      installed: () => fs.existsSync(home('.codeium', 'windsurf')),
      merge: (cfg, server) => {
        cfg.mcpServers = cfg.mcpServers || {};
        cfg.mcpServers[SERVER_NAME] = server;
        return cfg;
      },
      has: (cfg) => !!(cfg.mcpServers && cfg.mcpServers[SERVER_NAME])
    }
  ];
}

/** 读取 JSON 配置；文件不存在或损坏时返回空对象（损坏文件会先备份） */
function readJsonSafe(file) {
  if (!fs.existsSync(file)) return { config: {}, existed: false, corrupt: false };
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return { config: JSON.parse(raw), existed: true, corrupt: false };
  } catch {
    // 配置文件坏了——不要覆盖它，备份后从空配置开始
    fs.writeFileSync(file + '.corrupt-' + Date.now() + '.bak', raw);
    return { config: {}, existed: true, corrupt: true };
  }
}

/**
 * DeepSeek Harness（dsh）接入。
 * dsh 用 cordis patch（YAML）而不是 JSON：每个 profile 有自己的
 *   ~/.dsh/profiles/<profile>/cordis.patch.yml
 * 里面是一个顶层数组，用 `- insert:` 挂插件。web = 网页交互版，headless = 命令行一次性任务。
 */
function dshRoot() {
  return path.join(os.homedir(), '.dsh');
}

function dshProfiles() {
  return ['web', 'headless'].map((profile) => ({
    profile,
    label: profile === 'web' ? '网页版' : '命令行',
    dir: path.join(dshRoot(), 'profiles', profile),
    patchPath: path.join(dshRoot(), 'profiles', profile, 'cordis.patch.yml')
  }));
}

/** 生成 cordis patch 片段：把 arch-viewer MCP server 作为一个 stdio 插件挂进 dsh */
function dshPatchBlock(launcher) {
  const argsLines = launcher.args.map((a) => `          - "${a}"`).join('\n');
  return [
    '- insert:',
    `    - id: ${DSH_ENTRY_ID}`,
    `      name: '${DSH_PLUGIN}'`,
    '      config:',
    `        serverName: ${SERVER_NAME}`,
    '        transport: stdio',
    `        command: ${launcher.command}`,
    '        args:',
    argsLines,
    ''
  ].join('\n');
}

/**
 * 把 arch-viewer 写入某个 dsh profile 的 cordis.patch.yml。
 * 幂等：已存在则跳过；空占位（注释 + `[]`）则替换占位、保留注释；
 * 已有其他插件则追加为新的数组项。写入前备份原文件。
 * @param {string} patchPath patch 文件路径
 * @param {{mode: string, command: string, args: string[]}} launcher 启动方式
 * @returns {{changed: boolean, reason: string}}
 */
function writeDshPatch(patchPath, launcher) {
  const raw = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, 'utf8') : '';

  if (raw.includes(DSH_ENTRY_ID)) return { changed: false, reason: 'already' };

  if (raw.trim()) fs.copyFileSync(patchPath, patchPath + '.av-bak');

  // 判断是否为空占位：去掉注释和空行后只剩一个 "[]"
  const codeLines = raw.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const isEmpty = codeLines.length === 0 || (codeLines.length === 1 && codeLines[0] === '[]');

  const block = dshPatchBlock(launcher);
  let out;
  if (isEmpty) {
    // 保留原有说明注释，去掉空的 "[]" 占位
    const header = raw.split('\n')
      .filter((l) => l.trim() === '' || l.trim().startsWith('#'))
      .join('\n')
      .replace(/\s+$/, '');
    out = (header ? header + '\n\n' : '') + block;
  } else {
    // 已有其他插件：作为新的顶层数组项追加
    out = raw.replace(/\s*$/, '\n\n') + block;
  }

  fs.mkdirSync(path.dirname(patchPath), { recursive: true });
  fs.writeFileSync(patchPath, out.endsWith('\n') ? out : out + '\n');
  return { changed: true, reason: raw.trim() ? (isEmpty ? 'replaced-empty' : 'appended') : 'created' };
}

/**
 * 执行一键接入。
 * @returns {{results: Array, serverPath: string, launchMode: 'global'|'local'}}
 *   results: [{ id, name, status, detail }]
 *   status: 'configured' | 'already' | 'not-installed' | 'error'
 *   launchMode: 'global' = 直接使用全局安装里的 server.js；'local' = 用仓库内 server.js
 */
function runSetup(opts = {}) {
  const launcher = resolveLauncher();
  const serverPath = launcher.mode === 'global' ? launcher.args[0] : mcpServerPath();
  // local 模式必须能找到仓库内的 server.js；global 模式使用已安装包内路径
  if (launcher.mode === 'local' && !fs.existsSync(serverPath)) {
    throw new Error(`找不到 MCP 工具文件：${serverPath}（安装可能不完整）`);
  }
  const server = serverConfig(launcher);
  const results = [];

  for (const t of targets()) {
    try {
      if (!t.installed()) {
        results.push({ id: t.id, name: t.name, status: 'not-installed', detail: t.configPath });
        continue;
      }

      const { config, existed, corrupt } = readJsonSafe(t.configPath);

      if (existed && !corrupt && t.has(config)) {
        results.push({ id: t.id, name: t.name, status: 'already', detail: t.configPath });
        continue;
      }

      // 写入前备份原文件（只在文件存在且可读时）
      if (existed && !corrupt && fs.existsSync(t.configPath)) {
        fs.copyFileSync(t.configPath, t.configPath + '.av-bak');
      }

      const merged = t.merge(config, server);
      fs.mkdirSync(path.dirname(t.configPath), { recursive: true });
      fs.writeFileSync(t.configPath, JSON.stringify(merged, null, 2) + '\n');

      results.push({
        id: t.id,
        name: t.name,
        status: corrupt ? 'configured' : 'configured',
        detail: t.configPath,
        note: corrupt ? '原配置文件格式损坏，已备份后重建' : (existed ? '已自动备份原配置（.av-bak）' : '已创建新配置文件')
      });
    } catch (e) {
      results.push({ id: t.id, name: t.name, status: 'error', detail: e.message });
    }
  }

  // DeepSeek Harness（dsh）：cordis patch（YAML），web / headless 两个 profile 各写一份
  if (fs.existsSync(dshRoot())) {
    for (const p of dshProfiles()) {
      const label = `DeepSeek Harness（${p.label} 模式）`;
      if (!fs.existsSync(p.dir)) {
        results.push({ id: `dsh-${p.profile}`, name: label, status: 'not-installed', detail: p.patchPath });
        continue;
      }
      try {
        const r = writeDshPatch(p.patchPath, launcher);
        results.push({
          id: `dsh-${p.profile}`,
          name: label,
          status: r.changed ? 'configured' : 'already',
          detail: p.patchPath,
          note: r.changed
            ? (r.reason === 'created' ? '已创建 patch 配置' : '已自动备份原配置（.av-bak）')
            : undefined
        });
      } catch (e) {
        results.push({ id: `dsh-${p.profile}`, name: label, status: 'error', detail: e.message });
      }
    }
  } else {
    results.push({ id: 'dsh', name: 'DeepSeek Harness（dsh）', status: 'not-installed', detail: dshRoot() });
  }

  let project = null;
  if (opts.projectDir) {
    const { installProjectGate } = require('./setup-project');
    project = installProjectGate(opts.projectDir, { mcp: opts.projectMcp !== false });
    for (const r of project.results) results.push(r);
  }

  return { results, serverPath, launchMode: launcher.mode, project };
}

module.exports = {
  runSetup, magicPrompt, mcpServerPath, serverConfig, targets,
  dshRoot, dshProfiles, dshPatchBlock, writeDshPatch,
  isGlobalInstalled, globalInstallInfo, resolveLauncher, NPM_PACKAGE, MCP_BIN
};
