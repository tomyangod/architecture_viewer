'use strict';

function parseRepoUrl(url) {
  try {
    const u = new URL(String(url || ''));
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
    if (parts.length < 2) return null;
    let provider = 'github';
    if (host.includes('gitee')) provider = 'gitee';
    else if (host.includes('gitlab')) provider = 'gitlab';
    return { provider, owner: parts[0], repo: parts[1], host, cloneUrl: u.origin + '/' + parts[0] + '/' + parts[1] + '.git' };
  } catch {
    return null;
  }
}

function timingEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length) return false;
  return require('crypto').timingSafeEqual(x, y);
}

function verifyGithub(headers, rawBody, secret) {
  const crypto = require('crypto');
  const sig = String(headers['x-hub-signature-256'] || headers['X-Hub-Signature-256'] || '');
  if (!secret || !sig.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingEqual(sig, expected);
}

function verifyGitee(headers, secret) {
  const token = headers['x-gitee-token'] || headers['X-Gitee-Token'] || '';
  return !!(secret && timingEqual(token, secret));
}

/**
 * Normalize GitHub / Gitee webhook into a PR check job, or { skip: true }.
 */
function parseWebhook(headers, body, rawBody, secret) {
  const h = headers || {};
  const ghEvent = h['x-github-event'] || h['X-GitHub-Event'];
  const giteeEvent = h['x-gitee-event'] || h['X-Gitee-Event'];

  if (ghEvent) {
    if (secret && !verifyGithub(h, rawBody || Buffer.from(''), secret)) {
      const err = new Error('GitHub webhook 签名无效');
      err.status = 401;
      throw err;
    }
    if (ghEvent === 'ping') return { skip: true, reason: 'ping' };
    if (ghEvent !== 'pull_request') return { skip: true, reason: 'not-pr' };
    const action = body && body.action;
    if (!['opened', 'synchronize', 'reopened'].includes(action)) {
      return { skip: true, reason: 'pr-action:' + action };
    }
    const pr = body.pull_request || {};
    const repo = body.repository || {};
    const full = String(repo.full_name || '').split('/');
    return {
      skip: false,
      provider: 'github',
      owner: full[0] || (repo.owner && repo.owner.login),
      repo: full[1] || repo.name,
      pr: pr.number,
      sha: pr.head && pr.head.sha,
      branch: pr.head && pr.head.ref,
      cloneUrl: (pr.head && pr.head.repo && pr.head.repo.clone_url) || repo.clone_url,
      title: pr.title
    };
  }

  if (giteeEvent) {
    if (secret && !verifyGitee(h, secret)) {
      const err = new Error('Gitee webhook Token 无效');
      err.status = 401;
      throw err;
    }
    const ev = String(giteeEvent);
    if (/Push Hook/i.test(ev) && !(body && body.pull_request)) {
      return { skip: true, reason: 'push' };
    }
    if (!/Merge Request/i.test(ev) && !(body && (body.pull_request || body.merge_request))) {
      return { skip: true, reason: 'not-mr' };
    }
    const pr = body.pull_request || body.merge_request || {};
    const action = body.action || (pr && pr.action);
    if (action && !['open', 'opened', 'update', 'synchronize', 'reopen', 'reopened'].includes(String(action))) {
      return { skip: true, reason: 'mr-action:' + action };
    }
    const project = body.project || body.repository || {};
    const pathNs = String(project.path_with_namespace || '').split('/');
    const html = project.html_url || project.url || '';
    const parsed = parseRepoUrl(html.endsWith('.git') ? html : html);
    return {
      skip: false,
      provider: 'gitee',
      owner: pathNs[0] || (parsed && parsed.owner),
      repo: pathNs[1] || (parsed && parsed.repo) || project.name,
      pr: pr.number || pr.iid,
      sha: (pr.head && (pr.head.sha || pr.head_commit)) || pr.merge_commit_sha,
      branch: (pr.head && pr.head.ref) || pr.source_branch,
      cloneUrl: project.clone_url || (parsed && parsed.cloneUrl),
      title: pr.title
    };
  }

  return { skip: true, reason: 'unknown-provider' };
}

async function githubRequest(method, apiPath, token, json) {
  const res = await fetch('https://api.github.com' + apiPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'architecture-viewer-pro',
      'Content-Type': 'application/json'
    },
    body: json ? JSON.stringify(json) : undefined
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error('GitHub API ' + res.status + ': ' + (data.message || text.slice(0, 180)));
    err.status = 502;
    throw err;
  }
  return data;
}

async function giteeRequest(method, apiPath, token, json) {
  const url = new URL('https://gitee.com/api/v5' + apiPath);
  if (method === 'GET') url.searchParams.set('access_token', token);
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'architecture-viewer-pro' },
    body: json ? JSON.stringify(Object.assign({ access_token: token }, json)) : undefined
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error('Gitee API ' + res.status + ': ' + (data.message || text.slice(0, 180)));
    err.status = 502;
    throw err;
  }
  return data;
}

const { MARKER } = require('./comment');

async function upsertPrComment(job, token, markdown, opts) {
  const options = opts || {};
  const post = options.post || defaultPost;
  return post(job, token, markdown);
}

async function defaultPost(job, token, markdown) {
  if (!token) {
    const err = new Error('未配置仓库访问令牌，无法发表 PR 评论');
    err.status = 400;
    throw err;
  }
  if (job.provider === 'gitee') {
    const list = await giteeRequest(
      'GET',
      '/repos/' + job.owner + '/' + job.repo + '/pulls/' + job.pr + '/comments',
      token
    );
    const existing = Array.isArray(list) ? list.find((c) => String(c.body || '').includes(MARKER)) : null;
    if (existing && existing.id) {
      return giteeRequest(
        'PATCH',
        '/repos/' + job.owner + '/' + job.repo + '/pulls/comments/' + existing.id,
        token,
        { body: markdown }
      );
    }
    return giteeRequest(
      'POST',
      '/repos/' + job.owner + '/' + job.repo + '/pulls/' + job.pr + '/comments',
      token,
      { body: markdown }
    );
  }
  const list = await githubRequest(
    'GET',
    '/repos/' + job.owner + '/' + job.repo + '/issues/' + job.pr + '/comments',
    token
  );
  const existing = Array.isArray(list) ? list.find((c) => String(c.body || '').includes(MARKER)) : null;
  if (existing && existing.id) {
    return githubRequest('PATCH', '/repos/' + job.owner + '/' + job.repo + '/issues/comments/' + existing.id, token, {
      body: markdown
    });
  }
  return githubRequest('POST', '/repos/' + job.owner + '/' + job.repo + '/issues/' + job.pr + '/comments', token, {
    body: markdown
  });
}

function matchRepo(dbRepo, job) {
  if (!dbRepo || !job) return false;
  if (String(dbRepo.owner).toLowerCase() === String(job.owner).toLowerCase() &&
      String(dbRepo.repo).toLowerCase() === String(job.repo).toLowerCase()) {
    return true;
  }
  const parsed = parseRepoUrl(dbRepo.url);
  return parsed &&
    String(parsed.owner).toLowerCase() === String(job.owner).toLowerCase() &&
    String(parsed.repo).toLowerCase() === String(job.repo).toLowerCase();
}

module.exports = {
  parseRepoUrl,
  parseWebhook,
  verifyGithub,
  verifyGitee,
  upsertPrComment,
  matchRepo,
  defaultPost
};
