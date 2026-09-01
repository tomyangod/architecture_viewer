'use strict';

/**
 * 安全 Git clone 模块 — 从公开 HTTPS Git URL 浅克隆到临时目录。
 *
 * 安全策略：
 * - 仅允许 github.com / gitee.com / gitlab.com / bitbucket.org 的 HTTPS URL
 * - --depth 1 浅克隆，减少数据量
 * - 30 秒超时
 * - 50MB 大小限制
 * - 临时目录隔离，用后即删
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
const TIMEOUT_MS = 60_000;

const ALLOWED_HOSTS = [
  'github.com',
  'gitee.com',
  'gitlab.com',
  'bitbucket.org',
  'codeup.aliyun.com'
];

/**
 * 验证 Git URL 是否合法且来自允许的托管平台。
 * @param {string} url
 * @returns {{valid: boolean, error?: string}}
 */
function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL 不能为空' };
  }
  if (!url.startsWith('https://')) {
    return { valid: false, error: '仅支持 HTTPS Git URL（以 https:// 开头）' };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'URL 格式无效' };
  }
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
    return { valid: false, error: '仅支持 ' + ALLOWED_HOSTS.join(' / ') };
  }
  // 禁止 URL 带用户信息（防止 git@host: 形式）
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URL 不应包含凭据信息' };
  }
  return { valid: true };
}

/**
 * 浅克隆仓库到临时目录。
 * @param {string} url — HTTPS Git URL
 * @returns {Promise<string>} — 克隆后的临时目录路径
 */
function safeClone(url) {
  const check = validateUrl(url);
  if (!check.valid) {
    const err = new Error(check.error);
    err.status = 400;
    return Promise.reject(err);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-clone-'));

  return new Promise((resolve, reject) => {
    const child = spawn('git', [
      'clone',
      '--depth', '1',
      '--single-branch',
      url,
      tmp
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });

    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      cleanup(tmp);
      const err = new Error('git clone 超时（>60s）');
      err.status = 504;
      reject(err);
    }, TIMEOUT_MS);

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        // 检查克隆大小
        try {
          const size = getDirSize(tmp);
          if (size > MAX_SIZE) {
            cleanup(tmp);
            const err = new Error(
              '仓库过大（' + Math.round(size / 1024 / 1024) + 'MB > ' + MAX_SIZE / 1024 / 1024 + 'MB 限制）'
            );
            err.status = 413;
            reject(err);
            return;
          }
        } catch {
          // 大小检查失败不阻塞
        }
        resolve(tmp);
      } else {
        cleanup(tmp);
        const err = new Error('git clone 失败: ' + stderr.slice(0, 200).trim());
        err.status = 502;
        reject(err);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      cleanup(tmp);
      const e = new Error('git clone 执行错误: ' + err.message);
      e.status = 500;
      reject(e);
    });
  });
}

/**
 * 递归计算目录大小（字节）。
 */
function getDirSize(dir) {
  let total = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    // 跳过 .git 目录
    if (entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += getDirSize(full);
    } else {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

/**
 * 清理临时目录。
 */
function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

module.exports = { safeClone, cleanup, validateUrl, MAX_SIZE, TIMEOUT_MS };
