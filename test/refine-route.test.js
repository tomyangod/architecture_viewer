'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chooseRefinePipeline, championOf, inspectShape } = require('../lib/refine-route');
const { generateBlockAgent } = require('../lib/orch/agent-block');
const { refineBlockWithFallback } = require('../lib/llm-generate');

function imp(kind, extras) {
  return Object.assign({
    shape: { kind },
    shapeConfidence: 'high',
    shapeMargin: 5,
    shapeCandidates: [{ kind, score: 8 }, { kind: 'web', score: 1 }],
    feRoots: []
  }, extras || {});
}

describe('chooseRefinePipeline（客户精修分流）', () => {
  it('web + 真实前端 → agent', () => {
    const r = chooseRefinePipeline(imp('web', {
      feRoots: ['frontend'],
      shapeCandidates: [{ kind: 'web', score: 10 }, { kind: 'api-svc', score: 1 }]
    }));
    assert.equal(r.pipeline, 'agent');
    assert.equal(r.reason, 'web-app');
  });

  it('proxy / bridge / notify-bus / api-svc → orch', () => {
    for (const k of ['proxy', 'bridge', 'notify-bus', 'api-svc']) {
      assert.equal(chooseRefinePipeline(imp(k)).pipeline, 'orch', k);
    }
  });

  it('notify-bus↔web 歧义（ntfy）→ orch，即使 web 分高', () => {
    const r = chooseRefinePipeline({
      shape: { kind: 'web' },
      shapeConfidence: 'medium',
      feRoots: ['web'],
      shapeCandidates: [{ kind: 'web', score: 10 }, { kind: 'notify-bus', score: 8 }]
    });
    assert.equal(r.pipeline, 'orch');
    assert.equal(r.reason, 'ambiguous-shape');
  });

  it('api-svc↔notify-bus 歧义（openim）→ orch', () => {
    const r = chooseRefinePipeline({
      shape: { kind: 'notify-bus' },
      shapeConfidence: 'medium',
      feRoots: [],
      shapeCandidates: [{ kind: 'notify-bus', score: 9 }, { kind: 'api-svc', score: 7 }]
    });
    assert.equal(r.pipeline, 'orch');
    assert.equal(r.reason, 'ambiguous-shape');
  });

  it('web 无前端 → orch', () => {
    const r = chooseRefinePipeline(imp('web', {
      feRoots: [],
      shapeCandidates: [{ kind: 'web', score: 1 }, { kind: 'api-svc', score: 0 }],
      shapeConfidence: 'low'
    }));
    assert.equal(r.pipeline, 'orch');
  });

  it('championOf 与路由同口径：web+前端→agent，web 无前端/bridge→orch', () => {
    assert.equal(championOf(imp('web', {
      feRoots: ['frontend'],
      shapeCandidates: [{ kind: 'web', score: 10 }, { kind: 'api-svc', score: 1 }]
    })), 'agent');
    assert.equal(championOf(imp('bridge')), 'orch');
    assert.equal(championOf(imp('proxy')), 'orch');
    // 旧 bug：championOf('web') 恒为 agent；web 无前端时实际路由是 orch
    assert.equal(championOf(imp('web', {
      feRoots: [],
      shapeConfidence: 'low',
      shapeCandidates: [{ kind: 'web', score: 1 }, { kind: 'api-svc', score: 0 }]
    })), 'orch');
  });
});

describe('inspectShape', () => {
  it('纯 Rust 无前端 → api-svc / orch', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-route-rs-'));
    const put = (rel, content) => {
      fs.mkdirSync(path.join(repo, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(repo, rel), content);
    };
    put('Cargo.toml', '[package]\nname="vw"\nversion="0.1.0"\n');
    put('src/main.rs', 'fn main() {}\n');
    put('src/api.rs', 'pub fn api() {}\n');
    const r = chooseRefinePipeline(inspectShape(repo));
    assert.equal(r.shape, 'api-svc');
    assert.equal(r.pipeline, 'orch');
    fs.rmSync(repo, { recursive: true, force: true });
  });
});

describe('agent 管线降级契约', () => {
  it('dsh 空跑（未覆写模板）→ AGENT_UNAVAILABLE，不能把模板当 agent 产物', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-agent-'));
    const prev = process.env.DSH_BIN;
    // /bin/echo 存在且退出码 0，但不会写 block-diagram.md —— 模拟 agent 运行时空跑
    process.env.DSH_BIN = '/bin/echo';
    try {
      await assert.rejects(
        () => generateBlockAgent(repo, { apiKey: 'sk-test-fake' }),
        (e) => e.code === 'AGENT_UNAVAILABLE'
      );
    } finally {
      if (prev === undefined) delete process.env.DSH_BIN; else process.env.DSH_BIN = prev;
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('dsh 崩溃（非零退出）→ AGENT_UNAVAILABLE', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-agent-'));
    const prev = process.env.DSH_BIN;
    process.env.DSH_BIN = '/bin/false';  // 退出码 1
    try {
      await assert.rejects(
        () => generateBlockAgent(repo, { apiKey: 'sk-test-fake' }),
        (e) => e.code === 'AGENT_UNAVAILABLE'
      );
    } finally {
      if (prev === undefined) delete process.env.DSH_BIN; else process.env.DSH_BIN = prev;
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('refineBlockWithFallback（agent→orch 降级）', () => {
  const agentUnavail = () => {
    const e = new Error('读仓画图不可用，改走编排精修。');
    e.code = 'AGENT_UNAVAILABLE';
    return e;
  };

  it('agent 抛 AGENT_UNAVAILABLE → 降级 orch，via=orch', async () => {
    let orchCalled = false;
    const r = await refineBlockWithFallback('/repo', { apiKey: 'k' },
      { pipeline: 'agent', reason: 'web-app' },
      {
        agent: async () => { throw agentUnavail(); },
        orch: async () => { orchCalled = true; return { md: '```mermaid\norch\n```' }; }
      });
    assert.equal(orchCalled, true);
    assert.equal(r.via, 'orch');
    assert.ok(r.md.includes('orch'));
  });

  it('agent 成功 → 不走 orch，via=agent', async () => {
    let orchCalled = false;
    const r = await refineBlockWithFallback('/repo', { apiKey: 'k' },
      { pipeline: 'agent', reason: 'web-app' },
      {
        agent: async () => ({ md: '```mermaid\nagent\n```' }),
        orch: async () => { orchCalled = true; return { md: 'x' }; }
      });
    assert.equal(orchCalled, false);
    assert.equal(r.via, 'agent');
    assert.ok(r.md.includes('agent'));
  });

  it('agent 抛非降级类错误（bug）→ 向上抛，不静默吞、不走 orch', async () => {
    let orchCalled = false;
    await assert.rejects(
      () => refineBlockWithFallback('/repo', { apiKey: 'k' },
        { pipeline: 'agent', reason: 'web-app' },
        {
          agent: async () => { throw new Error('boom-internal'); },
          orch: async () => { orchCalled = true; return { md: 'y' }; }
        }),
      /boom-internal/
    );
    assert.equal(orchCalled, false);
  });

  it('route=orch → 直接编排，不调 agent', async () => {
    let agentCalled = false;
    const r = await refineBlockWithFallback('/repo', { apiKey: 'k' },
      { pipeline: 'orch', reason: 'shape-bridge' },
      {
        agent: async () => { agentCalled = true; return { md: 'a' }; },
        orch: async () => ({ md: '```mermaid\no\n```' })
      });
    assert.equal(agentCalled, false);
    assert.equal(r.via, 'orch');
  });
});
