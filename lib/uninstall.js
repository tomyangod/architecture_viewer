'use strict';

/**
 * Inverse of setup: remove only Architecture Viewer integration.
 *
 *   arch-viewer uninstall              user-level MCP / dsh
 *   arch-viewer uninstall .            + project hooks / rules
 *   arch-viewer uninstall --npm        also npm uninstall -g
 *   arch-viewer uninstall --purge      also .av session artifacts (not layers.json)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const {
  targets, readJsonSafe, dshRoot, dshProfiles, removeDshPatch,
  SERVER_NAME, NPM_PACKAGE
} = require('./setup');
const { uninstallProjectGate } = require('./setup-project');

function backupIfExists(file) {
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.av-bak');
}

function removeUserMcp(t) {
  if (!t.installed()) {
    return { id: t.id, name: t.name, status: 'not-installed', detail: t.configPath };
  }
  if (!fs.existsSync(t.configPath)) {
    return { id: t.id, name: t.name, status: 'already', detail: t.configPath };
  }
  const { config, existed, corrupt } = readJsonSafe(t.configPath);
  if (corrupt) {
    return { id: t.id, name: t.name, status: 'error', detail: '配置损坏，未改写：' + t.configPath };
  }
  if (!existed || !t.has(config)) {
    return { id: t.id, name: t.name, status: 'already', detail: t.configPath };
  }
  backupIfExists(t.configPath);
  if (config.mcpServers) delete config.mcpServers[SERVER_NAME];
  fs.writeFileSync(t.configPath, JSON.stringify(config, null, 2) + '\n');
  return {
    id: t.id,
    name: t.name,
    status: 'removed',
    detail: t.configPath,
    note: '已备份（.av-bak），其它 MCP 保留'
  };
}

function tryNpmUninstall(exec = execSync) {
  try {
    const out = exec(`npm uninstall -g ${NPM_PACKAGE}`, {
      encoding: 'utf8',
      timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return {
      id: 'npm',
      name: '全局 npm 包',
      status: 'removed',
      detail: `npm uninstall -g ${NPM_PACKAGE}`,
      note: String(out || '').trim().slice(0, 200) || undefined
    };
  } catch (e) {
    return {
      id: 'npm',
      name: '全局 npm 包',
      status: 'error',
      detail: e.message || String(e)
    };
  }
}

/**
 * @param {{ projectDir?: string|null, npm?: boolean, purge?: boolean, exec?: Function }} [opts]
 */
function runUninstall(opts = {}) {
  const results = [];

  for (const t of targets()) {
    try {
      results.push(removeUserMcp(t));
    } catch (e) {
      results.push({ id: t.id, name: t.name, status: 'error', detail: e.message });
    }
  }

  if (fs.existsSync(dshRoot())) {
    for (const p of dshProfiles()) {
      const label = `DeepSeek Harness（${p.label} 模式）`;
      if (!fs.existsSync(p.dir)) {
        results.push({ id: `dsh-${p.profile}`, name: label, status: 'not-installed', detail: p.patchPath });
        continue;
      }
      try {
        const r = removeDshPatch(p.patchPath);
        results.push({
          id: `dsh-${p.profile}`,
          name: label,
          status: r.changed ? 'removed' : 'already',
          detail: p.patchPath,
          note: r.changed ? '已备份（.av-bak）' : undefined
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
    project = uninstallProjectGate(opts.projectDir, { purge: !!opts.purge });
    for (const r of project.results) results.push(r);
  } else if (opts.purge) {
    results.push({
      id: 'purge-av',
      name: '.av 会话产物',
      status: 'skipped',
      detail: '未指定项目目录；请：arch-viewer uninstall . --purge'
    });
  }

  if (opts.npm) {
    results.push(tryNpmUninstall(opts.exec));
  }

  return { results, project };
}

module.exports = { runUninstall, tryNpmUninstall, removeUserMcp };
