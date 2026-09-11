'use strict';

/**
 * 安全 Git clone 模块 — 浅克隆公开/私有仓库到临时目录。
 *
 * 安全策略：
 * - 仅允许 github.com / gitee.com / gitlab.com / bitbucket.org / codeup.aliyun.com 的 HTTPS URL
 * - --depth 1 浅克隆，减少数据量
 * - 60 秒超时
 * - 50MB 大小限制（克隆后校验）
 * - 临时目录隔离，用后即删
 *
 * 凭据（Pro 私有仓 PAT）处理：
 * - Token 不拼进 URL，而是通过 `git -c http.extraHeader=Authorization: Basic <b64>` 传入：
 *   不进进程命令行里的 URL、不会被写入克隆目录的 .git/config、git 也不会把 header 打进 stderr
 * - 各平台 Basic Auth 用户名约定不同（见 GIT_AUTH_USER）
 * - 所有对外错误消息一律经过 redactSecrets() 脱敏，双保险
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
 * 各平台 HTTPS Basic Auth 的用户名字段约定（Token 作密码）：
 * - GitHub: x-access-token
 * - Gitee:  oauth2（PAT 当密码，用户名必须是 oauth2）
 * - GitLab: oauth2（PAT/OAuth token 均接受）
 * - Bitbucket Cloud: x-token-auth（HTTP access token；app password 需真实用户名，不在此列）
 * - 阿里云效 codeup: oauth2
 */
const GIT_AUTH_USER = {
  'github.com': 'x-access-token',
  'gitee.com': 'oauth2',
  'gitlab.com': 'oauth2',
  'bitbucket.org': 'x-token-auth',
  'codeup.aliyun.com': 'oauth2'
};

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
  // 禁止 URL 自带用户信息（凭据只允许走 Token 参数，避免泄露在日志/配置里）
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URL 不应包含凭据信息，请把 Token 放在专门的 Token 字段' };
  }
  return { valid: true };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function gitUserIdForHost(host) {
  for (const [h, user] of Object.entries(GIT_AUTH_USER)) {
    if (host === h || host.endsWith('.' + h)) return user;
  }
  return 'x-access-token';
}

/**
 * 构造带凭据的 HTTPS URL（保留导出以兼容；clone 主路径已改用 extraHeader，
 * 不再把 Token 拼进 URL，避免 Token 写入 .git/config 或出现在 git 的报错文本里）。
 * @param {string} httpsUrl
 * @param {string} [token]
 * @returns {string}
 */
function authCloneUrl(httpsUrl, token) {
  if (!token) return httpsUrl;
  const u = new URL(httpsUrl);
  u.username = gitUserIdForHost(u.hostname.toLowerCase());
  u.password = String(token);
  return u.toString();
}

function basicAuthHeader(host, token) {
  const raw = gitUserIdForHost(host) + ':' + String(token);
  return 'Authorization: Basic ' + Buffer.from(raw, 'utf8').toString('base64');
}

/**
 * 分支名白名单校验：防止 `--branch` 的值被 git 当成选项解析（如 --upload-pack=...）。
 * 允许常规分支字符：字母数字开头，可含 . _ / -，可带 refs/heads/ 前缀。
 */
function isValidBranch(branch) {
  if (typeof branch !== 'string') return false;
  const b = branch.trim();
  if (b.length === 0 || b.length > 200) return false;
  if (b.startsWith('-')) return false;
  // git ref 非法字符
  if (/[\s\x00-\x1f]|(\.\.)|[~^:?*\[\\]/.test(b)) return false;
  return /^(refs\/heads\/)?[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(b);
}

/**
 * 组装 git clone 参数（导出便于单测）。Token 通过 http.extraHeader 传递。
 * @param {string} url 已通过 validateUrl 的 HTTPS URL
 * @param {{token?: string, branch?: string}} [opts]
 * @param {string} tmpDir 克隆目标目录
 * @returns {string[]}
 */
function buildCloneArgs(url, opts, tmpDir) {
  const options = opts || {};
  if (options.branch && !isValidBranch(options.branch)) {
    const err = new Error('分支名不合法：' + String(options.branch).slice(0, 60));
    err.status = 400;
    throw err;
  }
  const args = ['-c', 'credential.helper='];
  if (options.token) {
    args.push('-c', 'http.extraHeader=' + basicAuthHeader(hostOf(url), options.token));
  }
  args.push('clone', '--depth', '1', '--single-branch');
  if (options.branch) {
    args.push('--branch', String(options.branch).trim());
  }
  args.push(url, tmpDir);
  return args;
}

/**
 * 脱敏：从任意文本（主要是 git stderr）中移除凭据。
 * - 抹掉 URL 内嵌的 user:pass@
 * - 抹掉 token 原文及其 base64（extraHeader 形态）
 * @param {string} text
 * @param {string} [token]
 * @returns {string}
 */
function redactSecrets(text, token) {
  let out = String(text == null ? '' : text);
  out = out.replace(/([a-zA-Z][a-zA-Z0-9+.-]*):\/\/[^/\s@"'`]+@/g, '$1://***@');
  if (token) {
    const t = String(token);
    if (t.length >= 4) {
      out = out.split(t).join('***');
      try {
        const b64 = Buffer.from(t, 'utf8').toString('base64');
        if (b64.length >= 8) out = out.split(b64).join('***');
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

/**
 * 根据 git stderr 分类错误，给出用户可操作的消息与 HTTP 状态码。
 * @param {string} stderr
 * @param {boolean} hadToken
 * @returns {{status: number, message: string}}
 */
function classifyGitError(stderr, hadToken) {
  const s = String(stderr || '');
  if (/authentication failed|incorrect username or password|invalid username|could not read (username|password)|terminal prompts disabled|401|403|forbidden|access token/i.test(s)) {
    return {
      status: 401,
      message: hadToken
        ? '仓库访问被拒绝：Token 无效、已过期或权限不足（私有仓需授予 repo/projects 读取权限）'
        : '仓库不可访问：该仓库可能是私有的，请在 Pro 控制台配置有读取权限的 Token'
    };
  }
  if (/repository .* not found|not found|does not exist|不存在/i.test(s)) {
    return {
      status: hadToken ? 401 : 400,
      message: hadToken
        ? '仓库不可访问：仓库不存在，或 Token 对该仓库没有读取权限'
        : '仓库不存在或为私有仓库（公开仓库请检查 URL，私有仓请在 Pro 配置 Token）'
    };
  }
  return { status: 502, message: 'git clone 失败: ' + s.slice(0, 200).trim() };
}

/**
 * 浅克隆仓库到临时目录。
 * @param {string} url — HTTPS Git URL（不得内嵌凭据）
 * @param {{token?: string, branch?: string}} [opts]
 * @returns {Promise<string>} — 克隆后的临时目录路径
 */
function safeClone(url, opts) {
  const options = opts || {};
  const check = validateUrl(url);
  if (!check.valid) {
    const err = new Error(check.error);
    err.status = 400;
    return Promise.reject(err);
  }
  const token = options.token ? String(options.token).trim() : '';

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-clone-'));
  let args;
  try {
    args = buildCloneArgs(url, { token, branch: options.branch }, tmp);
  } catch (e) {
    cleanup(tmp);
    return Promise.reject(e);
  }

  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
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
        const safeStderr = redactSecrets(stderr, token);
        const classified = classifyGitError(safeStderr, !!token);
        const err = new Error(classified.message);
        err.status = classified.status;
        err.detail = safeStderr.slice(0, 500).trim();
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
 * 递归计算目录大小（字节），跳过 .git。
 */
function getDirSize(dir) {
  let total = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
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

const SHA_RE = /^[0-9a-f]{7,40}$/i;

function isValidSha(sha) {
  return typeof sha === 'string' && SHA_RE.test(sha.trim());
}

function gitAuthPrefix(url, token) {
  const args = ['-c', 'credential.helper='];
  if (token) args.push('-c', 'http.extraHeader=' + basicAuthHeader(hostOf(url), token));
  return args;
}

/**
 * Fetch a commit SHA into an existing shallow clone so `git archive <sha>` works.
 * @param {string} cloneDir
 * @param {string} sha
 * @param {{ token?: string, url?: string }} [opts]
 * @returns {Promise<void>}
 */
function fetchSha(cloneDir, sha, opts) {
  const options = opts || {};
  if (!isValidSha(sha)) {
    const err = new Error('提交 SHA 不合法');
    err.status = 400;
    return Promise.reject(err);
  }
  const originUrl = options.url || '';
  const token = options.token ? String(options.token).trim() : '';
  const args = gitAuthPrefix(originUrl || 'https://github.com/x/y.git', token);
  args.push('-C', cloneDir, 'fetch', '--depth', '1', 'origin', String(sha).trim());

  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const err = new Error('git fetch 超时（>60s）');
      err.status = 504;
      reject(err);
    }, TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const classified = classifyGitError(redactSecrets(stderr, token), !!token);
      const err = new Error(classified.message);
      err.status = classified.status;
      reject(err);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

module.exports = {
  safeClone,
  cleanup,
  validateUrl,
  authCloneUrl,
  buildCloneArgs,
  isValidBranch,
  isValidSha,
  fetchSha,
  redactSecrets,
  classifyGitError,
  basicAuthHeader,
  gitUserIdForHost,
  MAX_SIZE,
  TIMEOUT_MS
};
