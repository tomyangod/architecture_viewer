'use strict';

// CLI 账号客户端：邮箱验证码登录 → token 持久化 → whoami / logout。
//
// 两种传输模式：
//   - 本地模式（默认）：直接复用 web/lib/pro 服务端逻辑（同一套 auth/store），
//     数据默认落 ~/.config/arch-viewer/pro-data（ARCH_PRO_DATA 可覆盖）。
//   - 远程模式：设置 ARCH_API_BASE（如 https://arch.example.com），
//     走 HTTP API（/api/pro/auth/*），Bearer token 认证。
//
// token 持久化：~/.config/arch-viewer/auth.json
//   （ARCH_CONFIG_DIR 或 XDG_CONFIG_HOME 可覆盖），权限 0600。

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const CONFIG_DIR =
  process.env.ARCH_CONFIG_DIR ||
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'arch-viewer');
const AUTH_PATH = path.join(CONFIG_DIR, 'auth.json');

function configDir() {
  return CONFIG_DIR;
}

function authPath() {
  return AUTH_PATH;
}

function loadAuth() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveAuth(data) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = AUTH_PATH + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, AUTH_PATH);
  try {
    fs.chmodSync(AUTH_PATH, 0o600);
  } catch {
    /* Windows 等平台不支持 POSIX 权限时忽略 */
  }
}

function clearAuth() {
  try {
    fs.unlinkSync(AUTH_PATH);
  } catch {
    /* 不存在即忽略 */
  }
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

// ---- 传输层 ----

function localTransport() {
  // 本地模式下把服务端数据目录固定到用户配置目录，保证跨 cwd / 重启会话有效
  process.env.ARCH_PRO_DATA =
    process.env.ARCH_PRO_DATA || path.join(CONFIG_DIR, 'pro-data');
  const auth = require('./auth');
  const { publicUser } = require('./entitlement');
  return {
    mode: 'local',
    async requestCode(email) {
      return auth.requestLoginCode(email, '127.0.0.1');
    },
    async verify(email, code) {
      const out = auth.verifyLoginCode(email, code);
      return { token: out.token, user: out.user };
    },
    async me(token) {
      const user = auth.sessionByToken(token);
      return user ? publicUser(user) : null;
    },
    async logout(token) {
      auth.logoutToken(token);
    }
  };
}

function httpTransport(base) {
  const api = String(base).replace(/\/+$/, '');
  async function call(method, urlPath, body, token) {
    const res = await fetch(api + urlPath, {
      method,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        token ? { Authorization: 'Bearer ' + token } : {}
      ),
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(new Error(data.error || 'HTTP ' + res.status), {
        status: res.status
      });
    }
    return data;
  }
  return {
    mode: 'remote',
    async requestCode(email) {
      return call('POST', '/api/pro/auth/request-code', { email });
    },
    async verify(email, code) {
      const d = await call('POST', '/api/pro/auth/verify-code', { email, code });
      return { token: d.token, user: d.user };
    },
    async me(token) {
      const d = await call('GET', '/api/pro/auth/me', null, token);
      return d.user;
    },
    async logout(token) {
      await call('POST', '/api/pro/auth/logout', {}, token);
    }
  };
}

function transport() {
  const base = process.env.ARCH_API_BASE;
  return base ? httpTransport(base) : localTransport();
}

// ---- 高层流程 ----

async function loginFlow(opts) {
  opts = opts || {};
  const t = transport();
  const email = opts.email || (await ask('邮箱: '));
  if (!email) throw new Error('邮箱不能为空');

  const req = await t.requestCode(email);
  if (req.devCode) {
    console.log('验证码已生成（stub 模式，未发邮件）: ' + req.devCode);
    console.log('（该码同时打印在服务端日志；生产环境将发送至邮箱）');
  } else {
    console.log('验证码已发送至 ' + email + '，' + Math.round((req.expiresInSec || 600) / 60) + ' 分钟内有效。');
  }

  const code = opts.code || (await ask('请输入 6 位验证码: '));
  const out = await t.verify(email, code);
  saveAuth({
    token: out.token,
    email: out.user.email,
    savedAt: new Date().toISOString(),
    mode: t.mode
  });
  return out.user;
}

async function whoamiAsync() {
  const saved = loadAuth();
  if (!saved || !saved.token) return null;
  const t = transport();
  let user = null;
  try {
    user = await t.me(saved.token);
  } catch {
    user = null;
  }
  if (!user) {
    clearAuth(); // 会话失效，清掉本地凭据
    return null;
  }
  return Object.assign({ savedAt: saved.savedAt, mode: t.mode }, user);
}

async function logoutFlow() {
  const saved = loadAuth();
  if (saved && saved.token) {
    const t = transport();
    try {
      await t.logout(saved.token);
    } catch {
      /* 网络失败也要清本地凭据 */
    }
  }
  clearAuth();
}

/**
 * 仅检查登录态。Community 命令不要调用本函数。
 * 用法：const user = await requireUser();
 */
async function requireUser() {
  const saved = loadAuth();
  if (!saved || !saved.token) {
    throw Object.assign(
      new Error('该功能需要登录：请先运行 arch-viewer auth login'),
      { code: 'AUTH_REQUIRED' }
    );
  }
  const t = transport();
  let user = null;
  try {
    user = await t.me(saved.token);
  } catch {
    user = null;
  }
  if (!user) {
    clearAuth();
    throw Object.assign(
      new Error('登录已失效，请重新运行 arch-viewer auth login'),
      { code: 'AUTH_REQUIRED' }
    );
  }
  return user;
}

/**
 * Pro 特性门禁：未登录 / 过期抛 UPGRADE_REQUIRED（含定价页链接）。
 * 特性被服务端关闭时抛 FEATURE_DISABLED。
 */
async function requirePro(opts) {
  const o = opts || {};
  const features = require('./features');
  if (o.feature && !features.isFeatureEnabled(o.feature)) {
    throw Object.assign(
      new Error(
        'Pro 特性「' + features.featureTitle(o.feature) + '」已由服务端关闭（ARCH_PRO_FEATURES）。'
      ),
      { code: 'FEATURE_DISABLED', status: 403, feature: o.feature }
    );
  }
  let user;
  try {
    user = await requireUser();
  } catch {
    throw Object.assign(new Error(features.upgradeMessage({ reason: 'anonymous', feature: o.feature })), {
      code: 'UPGRADE_REQUIRED',
      status: 401,
      pricingUrl: features.pricingUrl(),
      feature: o.feature || null
    });
  }
  if (!user.active) {
    throw Object.assign(new Error(features.upgradeMessage({ reason: 'expired', feature: o.feature })), {
      code: 'UPGRADE_REQUIRED',
      status: 402,
      pricingUrl: features.pricingUrl(),
      feature: o.feature || null
    });
  }
  return user;
}

module.exports = {
  configDir,
  authPath,
  loadAuth,
  saveAuth,
  clearAuth,
  transport,
  loginFlow,
  whoamiAsync,
  logoutFlow,
  requireUser,
  requirePro
};
