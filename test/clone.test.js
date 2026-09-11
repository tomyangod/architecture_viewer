'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateUrl,
  authCloneUrl,
  buildCloneArgs,
  isValidBranch,
  isValidSha,
  redactSecrets,
  classifyGitError,
  basicAuthHeader,
  gitUserIdForHost,
  safeClone
} = require('../web/lib/clone');

describe('clone.validateUrl', () => {
  it('accepts https URLs from allowed hosts (incl. codeup)', () => {
    for (const u of [
      'https://gitee.com/heyangyan/architecture_viewer.git',
      'https://github.com/octocat/Hello-World',
      'https://gitlab.com/group/sub/repo.git',
      'https://bitbucket.org/team/repo',
      'https://codeup.aliyun.com/61xxxx/team/repo.git'
    ]) {
      assert.equal(validateUrl(u).valid, true, u);
    }
  });

  it('rejects non-https / ssh / garbage / urls carrying credentials', () => {
    assert.equal(validateUrl('git@gitee.com:o/r.git').valid, false);
    assert.equal(validateUrl('http://gitee.com/o/r').valid, false);
    assert.equal(validateUrl('https://evil.com/o/r').valid, false);
    assert.equal(validateUrl('not a url').valid, false);
    assert.equal(validateUrl('').valid, false);
    assert.equal(validateUrl(null).valid, false);
    // 凭据只能走 Token 字段
    assert.equal(validateUrl('https://oauth2:tok@gitee.com/o/r.git').valid, false);
    assert.equal(validateUrl('https://user%40x.com:tok@github.com/o/r').valid, false);
  });
});

describe('clone platform auth userid mapping', () => {
  it('maps each host to its Basic-Auth username convention', () => {
    assert.equal(gitUserIdForHost('gitee.com'), 'oauth2');
    assert.equal(gitUserIdForHost('gitlab.com'), 'oauth2');
    assert.equal(gitUserIdForHost('codeup.aliyun.com'), 'oauth2');
    assert.equal(gitUserIdForHost('github.com'), 'x-access-token');
    assert.equal(gitUserIdForHost('bitbucket.org'), 'x-token-auth');
  });

  it('authCloneUrl embeds token as password with the platform userid', () => {
    const u = new URL(authCloneUrl('https://gitee.com/o/r.git', 'TOK123'));
    assert.equal(u.username, 'oauth2');
    assert.equal(u.password, 'TOK123');
    const gh = new URL(authCloneUrl('https://github.com/o/r', 'gh_tok'));
    assert.equal(gh.username, 'x-access-token');
    assert.equal(authCloneUrl('https://gitee.com/o/r', ''), 'https://gitee.com/o/r');
  });

  it('basicAuthHeader decodes back to userid:token', () => {
    const header = basicAuthHeader('gitee.com', 'SECRET9');
    assert.match(header, /^Authorization: Basic /);
    const b64 = header.split(' ').pop();
    assert.equal(Buffer.from(b64, 'base64').toString('utf8'), 'oauth2:SECRET9');
  });
});

describe('clone.buildCloneArgs (token via http.extraHeader, never in URL)', () => {
  it('passes token through extraHeader and keeps the clone URL credential-free', () => {
    const args = buildCloneArgs('https://gitee.com/o/r.git', { token: 'TOK123' }, '/tmp/x');
    const headerArg = args.find((a) => a.startsWith('http.extraHeader='));
    assert.ok(headerArg, 'extraHeader arg present');
    const b64 = headerArg.split('Basic ').pop();
    assert.equal(Buffer.from(b64, 'base64').toString('utf8'), 'oauth2:TOK123');
    // URL 参数不得含凭据
    const urlArg = args.find((a) => a.startsWith('https://'));
    assert.equal(urlArg, 'https://gitee.com/o/r.git');
    assert.ok(!args.some((a) => a.includes('TOK123@')), 'token must not be embedded in URL');
    // 关闭宿主 credential helper，避免 osxkeychain/manager 注入旧凭据
    assert.ok(args.includes('credential.helper='));
  });

  it('omits extraHeader when no token', () => {
    const args = buildCloneArgs('https://github.com/o/r', {}, '/tmp/x');
    assert.ok(!args.some((a) => a.startsWith('http.extraHeader=')));
    assert.ok(args.includes('clone'));
    assert.ok(args.includes('--depth'));
    assert.ok(args.includes('1'));
    assert.ok(args.includes('--single-branch'));
    assert.deepEqual(args.slice(-2), ['https://github.com/o/r', '/tmp/x']);
  });

  it('passes a valid branch via --branch', () => {
    const args = buildCloneArgs('https://gitee.com/o/r', { branch: 'feat/drift-x' }, '/tmp/x');
    const i = args.indexOf('--branch');
    assert.ok(i >= 0);
    assert.equal(args[i + 1], 'feat/drift-x');
  });

  it('rejects option-injection / malformed branch names', () => {
    for (const bad of [
      '--upload-pack=evil',
      '-x',
      'feat; rm -rf /',
      'a b',
      'a..b',
      'a~1',
      'a^',
      'a:b',
      'refs/heads/a*b',
      ' '
    ]) {
      assert.throws(
        () => buildCloneArgs('https://gitee.com/o/r', { branch: bad }, '/tmp/x'),
        (e) => e.status === 400,
        'branch ' + JSON.stringify(bad)
      );
    }
  });

  it('accepts normal branch shapes', () => {
    for (const good of ['main', 'feat/drift-check', 'release-0.3.0', 'refs/heads/dev', 'a.b_c', 'v1.2.x']) {
      assert.equal(isValidBranch(good), true, good);
    }
  });
});

describe('clone.isValidSha', () => {
  it('accepts hex SHAs and rejects flags', () => {
    assert.equal(isValidSha('abc1234'), true);
    assert.equal(isValidSha('0123456789abcdef0123456789abcdef01234567'), true);
    assert.equal(isValidSha('--upload-pack=evil'), false);
    assert.equal(isValidSha('HEAD'), false);
    assert.equal(isValidSha(''), false);
  });
});

describe('clone.redactSecrets', () => {
  it('strips credentials embedded in URLs (git stderr style)', () => {
    const out = redactSecrets(
      "fatal: Authentication failed for 'https://oauth2:SECRETabc@gitee.com/o/r.git/'",
      'SECRETabc'
    );
    assert.ok(!out.includes('SECRETabc'));
    assert.ok(out.includes('https://***@gitee.com'));
  });

  it('strips raw token and its base64 even if not in URL form', () => {
    const token = 'ghp_0123456789abcdefXYZ';
    const b64 = Buffer.from('x-access-token:' + token).toString('base64');
    const out = redactSecrets('header was Authorization: Basic ' + b64, token);
    assert.ok(!out.includes(token));
    assert.ok(!out.includes(b64));
  });

  it('leaves non-secret output intact', () => {
    const msg = "Cloning into '/tmp/arch-clone-abc'...\nremote: Counting objects: 12";
    assert.equal(redactSecrets(msg, 'TOK'), msg);
  });
});

describe('clone.classifyGitError', () => {
  it('maps auth failures to 401 with token-aware guidance', () => {
    const withToken = classifyGitError("fatal: Authentication failed for 'https://gitee.com/o/r.git/'", true);
    assert.equal(withToken.status, 401);
    assert.match(withToken.message, /Token 无效/);

    const noToken = classifyGitError("fatal: could not read Username for 'https://github.com': terminal prompts disabled", false);
    assert.equal(noToken.status, 401);
    assert.match(noToken.message, /私有/);
  });

  it('maps gitee incorrect-password and 403 to 401', () => {
    assert.equal(classifyGitError('remote: Incorrect username or password (access token)', true).status, 401);
    assert.equal(classifyGitError('The requested URL returned error: 403', true).status, 401);
  });

  it('maps not-found to 401 with token (private repo masked as 404) and 400 without', () => {
    assert.equal(classifyGitError('fatal: repository not found', true).status, 401);
    assert.equal(classifyGitError('fatal: repository not found', false).status, 400);
  });

  it('falls back to 502 for other failures', () => {
    assert.equal(classifyGitError('error: RPC failed; HTTP 502', true).status, 502);
  });
});

describe('clone.safeClone pre-flight rejections (no network)', () => {
  it('rejects invalid URL with 400', async () => {
    await assert.rejects(() => safeClone('git@gitee.com:o/r.git'), (e) => e.status === 400);
    await assert.rejects(() => safeClone('https://evil.com/o/r'), (e) => e.status === 400);
  });

  it('rejects malicious branch with 400 before spawning git', async () => {
    await assert.rejects(
      () => safeClone('https://gitee.com/o/r.git', { branch: '--upload-pack=touch /tmp/pwn' }),
      (e) => e.status === 400
    );
  });
});
