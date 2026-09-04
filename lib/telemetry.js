'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

let pkg = {};
try { pkg = require('../package.json'); } catch { pkg = {}; }
const version = pkg.version || '0';

function envFlag(name) {
  const v = process.env[name];
  return v === '1' || v === 'true' || v === 'TRUE';
}

function pkgEnabled() {
  return !!(pkg.telemetry && pkg.telemetry.enabled === true);
}

function isEnabled() {
  if (envFlag('DO_NOT_TRACK')) return false;
  if (envFlag('ARCH_TELEMETRY_OFF')) return false;
  return envFlag('ARCH_TELEMETRY') || envFlag('ARCH_TELEMETRY_ENABLED') || pkgEnabled();
}

function configDir() {
  return process.env.ARCH_CONFIG_DIR
    || (process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, 'arch-viewer')
      : path.join(os.homedir(), '.config', 'arch-viewer'));
}

function logPath() {
  return path.join(configDir(), 'telemetry.log');
}

function safePlatform() {
  return process.platform;
}

const SENSITIVE_KEYS = new Set([
  'path', 'filepath', 'file', 'filepath', 'file_path',
  'code', 'source', 'snippet', 'content', 'body',
  'repo', 'repourl', 'repository', 'url',
  'cwd', 'homedir', 'dir', 'directory', 'outdir',
  'secret', 'token', 'password', 'apikey', 'auth'
]);

function isSensitive(key) {
  return SENSITIVE_KEYS.has(String(key).toLowerCase());
}

function track(event, props) {
  if (!isEnabled() || !event) return;
  const entry = {
    ts: new Date().toISOString(),
    event: String(event),
    version,
    platform: safePlatform()
  };
  if (props && typeof props === 'object') {
    for (const k of Object.keys(props)) {
      if (k === 'ts' || k === 'event' || k === 'version' || k === 'platform') continue;
      if (isSensitive(k)) continue;
      const val = props[k];
      if (val === undefined || val === null) continue;
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        entry[k] = val;
      }
    }
  }
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.appendFileSync(logPath(), JSON.stringify(entry) + '\n');
  } catch { /* never throw on telemetry */ }

  const endpoint = process.env.ARCH_TELEMETRY_ENDPOINT;
  if (endpoint) {
    try {
      const { request } = require('https');
      const url = new URL(endpoint);
      const req = request({
        method: 'POST',
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        headers: { 'Content-Type': 'application/json' },
        timeout: 3000
      });
      req.on('error', () => {});
      req.end(JSON.stringify(entry));
    } catch { /* fire and forget */ }
  }
}

async function wrap(command, fn) {
  const start = Date.now();
  let exitCode = 0;
  try {
    exitCode = await fn();
    return exitCode;
  } catch (err) {
    exitCode = 1;
    throw err;
  } finally {
    track('cli_command', {
      command,
      duration_ms: Date.now() - start,
      exit_code: exitCode
    });
  }
}

module.exports = { isEnabled, track, wrap, logPath, configDir };
