'use strict';

/**
 * Setup helpers shared by user-level MCP install (`setup.js`) and
 * project-level gate install (`setup-project.js`). Kept in a third module so
 * those two never import each other (circular-import).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/** npm 包名：`npm i -g arch-viewer` 后提供 arch-viewer / arch-viewer-mcp 两个 bin */
const NPM_PACKAGE = 'arch-viewer';
const MCP_BIN = 'arch-viewer-mcp';

/** MCP server 文件的绝对路径（本包内 mcp/server.js） */
function mcpServerPath() {
  return path.join(__dirname, '..', 'mcp', 'server.js');
}

/**
 * 检测用户是否全局安装了 arch-viewer。
 * @param {(cmd: string, opts: object) => string} [exec]
 */
function isGlobalInstalled(exec = execSync) {
  return globalInstallInfo(exec) !== null;
}

function globalInstallInfo(exec = execSync) {
  let globalRoot;
  try {
    globalRoot = exec('npm root -g', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
  if (!globalRoot) return null;
  const packageDir = path.join(globalRoot, NPM_PACKAGE);
  const packageJson = path.join(packageDir, 'package.json');
  const serverPath = path.join(packageDir, 'mcp', 'server.js');
  if (!fs.existsSync(packageJson) || !fs.existsSync(serverPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
    return { packageDir, serverPath, version: pkg.version || null };
  } catch {
    return null;
  }
}

/**
 * 决定用哪种方式启动 MCP server。
 * @returns {{mode: 'global'|'local', command: string, args: string[], version?: string}}
 */
function resolveLauncher(exec = execSync) {
  const installed = globalInstallInfo(exec);
  if (installed) {
    return {
      mode: 'global',
      command: process.execPath,
      args: [installed.serverPath],
      version: installed.version
    };
  }
  return {
    mode: 'local',
    command: 'node',
    args: [mcpServerPath()]
  };
}

/**
 * 给小白的「固定口令」——贴进 AI 工具的规则里，之后只管说人话。
 * @param {string} [repo] 兼容旧调用；故意不写进正文，避免 worktree / 多窗口沿用历史绝对路径
 */
function magicPrompt(_repo) {
  return [
    '【架构检查规则 · Architecture Viewer】',
    '用当前工作区根作为项目路径，不要沿用历史对话里的绝对路径（worktree / 多窗口会指错仓）。',
    '日常只做一件事：改完代码、宣称完成前，调用 MCP 工具 av_guard（repo=当前工作区绝对路径）。',
    '有 git 时会自动对照 HEAD，一般不必先 av_session_start；无 git 时 av_guard 会自动补快照。',
    '把返回的 verdict（最多 3 行）原样告诉我：绿灯可继续/可提交（commit 即接受当前结构）；红灯先修或解释，可用 av_explain_finding。',
    '不要默认打开 HTML；详情链接可选。不要用 av_check_layering 做日常验收。',
    'av_session_start / av_session_report 仍可用（脚本/高级），但日常优先 av_guard。'
  ].join('\n');
}

module.exports = {
  NPM_PACKAGE,
  MCP_BIN,
  mcpServerPath,
  isGlobalInstalled,
  globalInstallInfo,
  resolveLauncher,
  magicPrompt
};
