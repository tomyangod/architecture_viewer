'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'lib', 'cli.js');
const { installProjectGate, gateCommand } = require('../lib/setup-project');
const { magicPrompt } = require('../lib/setup');
const {
  adaptCursorStop,
  adaptClaudeStop,
  adaptGeneric,
  followupFromGate
} = require('../lib/session-gate');
const { ensureSessionBaseline } = require('../lib/session-baseline');
const { handleToolCall, TOOLS, toolSessionGuard, stopWatcher } = require('../mcp/server');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('setup-project: multi-host gate install', () => {
  let repo;
  afterEach(() => {
    if (repo) fs.rmSync(repo, { recursive: true, force: true });
  });

  it('写入 Cursor stop hooks + Claude Stop + AGENTS/CLAUDE 规则', () => {
    repo = tmpDir('av-hooks-');
    const { results } = installProjectGate(repo, { mcp: true });
    assert.ok(results.every((r) => r.status === 'configured'));
    assert.ok(results.find((r) => r.id === 'cursor-hooks'));

    const hooks = JSON.parse(fs.readFileSync(path.join(repo, '.cursor', 'hooks.json'), 'utf8'));
    assert.equal(hooks.version, 1);
    assert.ok(Array.isArray(hooks.hooks.stop));
    assert.equal(hooks.hooks.stop[0].loop_limit, 1);
    assert.ok(hooks.hooks.stop[0].command.includes('session guard'));
    assert.ok(hooks.hooks.stop[0].command.includes('--adapter cursor'));
    assert.ok(!hooks.hooks.sessionStart, 'sessionStart 故意不写（W23-02）');

    const claude = JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8'));
    assert.ok(claude.hooks.Stop[0].hooks[0].command.includes('--adapter claude'));

    const agents = fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
    assert.ok(agents.includes('av_guard'));
    assert.ok(agents.includes('arch-viewer-gate'));
    assert.ok(!agents.includes('拍照片'));

    const rule = fs.readFileSync(path.join(repo, '.cursor', 'rules', 'architecture-session.mdc'), 'utf8');
    assert.ok(rule.includes('av_guard'));

    const mcp = JSON.parse(fs.readFileSync(path.join(repo, '.cursor', 'mcp.json'), 'utf8'));
    assert.ok(mcp.mcpServers['arch-viewer']);
  });

  it('gateCommand 使用绝对 node + cli 路径', () => {
    const cmd = gateCommand('generic');
    assert.ok(cmd.includes(process.execPath));
    assert.ok(cmd.includes('session guard'));
    assert.ok(cmd.includes('--adapter generic'));
  });

  it('arch-viewer setup --project 写入本仓 hooks', () => {
    repo = tmpDir('av-setup-proj-');
    const home = tmpDir('av-setup-home-');
    try {
      fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
      fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: {} }));
      const out = execFileSync('node', [CLI, 'setup', repo, '--project', '--no-open'], {
        env: { ...process.env, HOME: home },
        encoding: 'utf8'
      });
      assert.ok(out.includes('av_guard') || out.includes('session guard'));
      assert.ok(fs.existsSync(path.join(repo, '.cursor', 'hooks.json')));
      assert.ok(fs.existsSync(path.join(repo, 'AGENTS.md')));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('session-gate adapters', () => {
  const redGate = {
    ok: true,
    high: true,
    timedOut: false,
    exitCode: 1,
    verdictText: '🔴 结构验收未通过\nRisk: HIGH ×1\n详情（可选）'
  };
  const greenGate = {
    ok: true,
    high: false,
    timedOut: false,
    exitCode: 0,
    verdictText: '🟢 结构验收通过'
  };

  it('Cursor：绿灯 stdout={}', () => {
    const r = adaptCursorStop(greenGate, { status: 'completed', loop_count: 0 });
    assert.equal(r.exitCode, 0);
    assert.deepEqual(JSON.parse(r.stdout.trim()), {});
  });

  it('Cursor：红灯仅 loop_count=0 时 followup', () => {
    const first = adaptCursorStop(redGate, { status: 'completed', loop_count: 0 });
    assert.ok(JSON.parse(first.stdout).followup_message.includes('🔴'));
    const second = adaptCursorStop(redGate, { status: 'completed', loop_count: 1 });
    assert.deepEqual(JSON.parse(second.stdout.trim()), {});
  });

  it('Claude：红灯 exit 2 + decision.block；stop_hook_active 时放行', () => {
    const block = adaptClaudeStop(redGate, {});
    assert.equal(block.exitCode, 2);
    assert.equal(JSON.parse(block.stdout).decision, 'block');
    const pass = adaptClaudeStop(redGate, { stop_hook_active: true });
    assert.equal(pass.exitCode, 0);
  });

  it('generic：HIGH → exit 1', () => {
    assert.equal(adaptGeneric(redGate).exitCode, 1);
    assert.equal(adaptGeneric(greenGate).exitCode, 0);
  });

  it('followupFromGate：NO_BASELINE 不骚扰', () => {
    assert.equal(followupFromGate({ ok: false, exitCode: 4, high: false, timedOut: false }), null);
  });
});

describe('magicPrompt: av_guard 叙事', () => {
  it('要求调 av_guard，不再背 start→开 HTML', () => {
    const text = magicPrompt('/tmp/any');
    assert.ok(text.includes('av_guard'));
    assert.ok(!text.includes('拍照片'));
    assert.ok(text.includes('不要默认打开 HTML'));
  });
});

describe('av_guard MCP', () => {
  let repo;
  afterEach(() => {
    if (repo) {
      try { stopWatcher(repo); } catch { /* ignore */ }
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('TOOLS 含 av_guard 且共 8 个', () => {
    assert.equal(TOOLS.length, 8);
    assert.ok(TOOLS.some((t) => t.name === 'av_guard'));
    assert.ok(TOOLS.some((t) => t.name === 'av_session_start'));
    assert.ok(TOOLS.some((t) => t.name === 'av_session_report'));
  });

  it('无基线时自动 ensure，返回 verdict', () => {
    repo = tmpDir('av-guard-');
    fs.writeFileSync(path.join(repo, 'app.py'), 'print("hi")\n');
    const out = toolSessionGuard({ repo });
    assert.ok(!out.error, out.message || JSON.stringify(out));
    assert.equal(out.ensured, true);
    assert.ok(out.verdict && out.verdict.text);
    assert.equal(out.message, out.verdict.text);
    assert.ok(fs.existsSync(path.join(repo, '.av', 'graph-baseline.json')));
  });

  it('handleToolCall(av_guard) 可用', () => {
    repo = tmpDir('av-guard-htc-');
    fs.writeFileSync(path.join(repo, 'main.js'), 'module.exports = 1;\n');
    const out = handleToolCall({ name: 'av_guard', arguments: { repo } });
    assert.ok(out.verdict);
  });
});

describe('ensureSessionBaseline', () => {
  it('无 git 仓写入 snapshot', () => {
    const dir = tmpDir('av-ensure-');
    try {
      fs.writeFileSync(path.join(dir, 'x.js'), 'exports.x=1\n');
      const r = ensureSessionBaseline(dir);
      assert.equal(r.ok, true);
      assert.equal(r.ensured, true);
      assert.equal(r.kind, 'snapshot');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('CLI session guard --adapter cursor', () => {
  it('绿灯输出 {}', () => {
    const dir = tmpDir('av-cli-guard-');
    try {
      fs.writeFileSync(path.join(dir, 'a.js'), 'module.exports = {}\n');
      // establish baseline then guard (= no structural change)
      ensureSessionBaseline(dir);
      const r = spawnSync(
        process.execPath,
        [CLI, 'session', 'guard', dir, '--adapter', 'cursor'],
        {
          input: JSON.stringify({ status: 'completed', loop_count: 0 }),
          encoding: 'utf8',
          timeout: 120000
        }
      );
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(JSON.parse((r.stdout || '').trim()), {});
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
