'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const START = path.join(ROOT, 'templates', 'cursor-hooks', 'av-session-start.js');
const STOP = path.join(ROOT, 'templates', 'cursor-hooks', 'av-stop.js');
const EXAMPLE = path.join(ROOT, 'templates', 'cursor-hooks.example.json');
const SPIKE_DOC = path.join(ROOT, 'docs', 'plans', 'cursor-hooks-spike.md');

function runHook(script, stdinObj, env = {}) {
  const r = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    input: JSON.stringify(stdinObj),
    env: { ...process.env, ...env },
    timeout: 15000
  });
  assert.equal(r.status, 0, r.stderr || r.error);
  const line = (r.stdout || '').trim().split(/\n/).filter(Boolean).pop() || '{}';
  return JSON.parse(line);
}

describe('W23-02 Cursor hooks spike artifacts', () => {
  it('spike 文档与 example hooks.json 存在', () => {
    assert.ok(fs.existsSync(SPIKE_DOC));
    assert.ok(fs.existsSync(EXAMPLE));
    const cfg = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
    assert.equal(cfg.version, 1);
    assert.ok(cfg.hooks.sessionStart);
    assert.ok(cfg.hooks.stop);
    assert.equal(cfg.hooks.stop[0].loop_limit, 1);
  });

  it('spike 文档写明：主强制=stop，不依赖 sessionStart.additional_context', () => {
    const md = fs.readFileSync(SPIKE_DOC, 'utf8');
    assert.match(md, /主强制该挂哪[\s\S]*\*\*`stop`\*\*/);
    assert.match(md, /不依赖.*additional_context|不要依赖 additional_context/);
    assert.match(md, /followup_message/);
    assert.match(md, /loop_limit:\s*1|loop_limit.*1/);
  });
});

describe('av-session-start.js stdout 契约', () => {
  it('返回 env；默认不强制依赖 additional_context', () => {
    const out = runHook(START, {
      session_id: 'sess-1',
      is_background_agent: false,
      composer_mode: 'agent'
    });
    assert.ok(out.env);
    assert.equal(out.env.AV_HOOK_SESSION_ID, 'sess-1');
    assert.equal(out.env.AV_HOOK_COMPOSER_MODE, 'agent');
    assert.equal(out.additional_context, undefined);
  });

  it('AV_HOOK_EMIT_CONTEXT=1 时才带 additional_context（软提示）', () => {
    const out = runHook(START, { session_id: 's2', is_background_agent: false }, {
      AV_HOOK_EMIT_CONTEXT: '1'
    });
    assert.match(out.additional_context || '', /stop hook|Architecture Viewer/);
  });
});

describe('av-stop.js 限速与 followup 契约', () => {
  function withFixture(level) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-hook-fix-'));
    const file = path.join(dir, 'report.json');
    fs.writeFileSync(file, JSON.stringify({
      riskLevel: level,
      risk: { level, findings: level === 'high' ? [{ rule: 'layer-skip' }] : [] },
      verdict: level === 'high'
        ? {
          text: '🔴 结构验收未通过 · 1 项风险（HIGH 1） · 2 项结构变更\n最严重：跨层串门（layer-skip） · src/a.js\n详情（可选）：.av/session-report.html'
        }
        : { text: '🟢 结构验收通过 · 0 项风险 · 0 项结构变更' }
    }));
    return { dir, file };
  }

  it('绿灯 fixture → {}', () => {
    const { dir, file } = withFixture('none');
    try {
      const out = runHook(STOP, { status: 'completed', loop_count: 0 }, {
        AV_HOOK_FIXTURE_REPORT: file
      });
      assert.deepEqual(out, {});
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('HIGH + loop_count=0 + completed → followup_message 含 verdict', () => {
    const { dir, file } = withFixture('high');
    try {
      const out = runHook(STOP, { status: 'completed', loop_count: 0 }, {
        AV_HOOK_FIXTURE_REPORT: file
      });
      assert.ok(out.followup_message);
      assert.match(out.followup_message, /结构验收未通过|🔴/);
      assert.match(out.followup_message, /layer-skip|跨层|红灯/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('HIGH + loop_count=1 → {}（防死循环）', () => {
    const { dir, file } = withFixture('high');
    try {
      const out = runHook(STOP, { status: 'completed', loop_count: 1 }, {
        AV_HOOK_FIXTURE_REPORT: file
      });
      assert.deepEqual(out, {});
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('status=aborted → {}', () => {
    const { dir, file } = withFixture('high');
    try {
      const out = runHook(STOP, { status: 'aborted', loop_count: 0 }, {
        AV_HOOK_FIXTURE_REPORT: file
      });
      assert.deepEqual(out, {});
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('无基线真实仓 → {}（不强制追问拍照）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-hook-nobase-'));
    try {
      const out = runHook(STOP, {
        status: 'completed',
        loop_count: 0,
        workspace_roots: [dir]
      });
      assert.deepEqual(out, {});
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
