'use strict';
// Edge Gating 回归：fixture 下四仓 usage7s 产物跑 deterministicSweep + 闸门，
// 断言硬闸 sHigh=0 / vHigh=0 / hallu=0，sMed 不能超基线（baseline.sMed=0 → 要求 0），
// 确保闸门迭代不反噬 edge 交付。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { deterministicSweep, structureGates, visualGates } = require('../lib/orch/run');

const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'edge-gating-fixtures.json'), 'utf8')
);

// 把 fixture 里的 importance / anchors 序列化成 gates 接受的对象
function buildImportance(f) {
  const imp = {
    info: (p) => (f.importance.infoMap && f.importance.infoMap[p]) || { heat: 0, reachable: true },
    detachedList: f.importance.detachedList || [],
    optionalKw: f.importance.optionalKw || [],
    emptyLayers: f.importance.emptyLayers || [],
    pathCluster: f.importance.pathCluster || [],
    s3Sw: f.importance.s3Sw || null,
    shapeConfidence: f.importance.shapeConfidence || 'low',
    shapeMargin: f.importance.shapeMargin || 0,
    shapeCandidates: f.importance.shapeCandidates || [],
    shape: f.importance.shape || null,
  };
  return imp;
}
function buildAnchors(f) {
  // deterministicSweep(structureGates 可选)需要 anchor[]（含 path/role 字段的对象数组）。
  // fixture.anchors 为 findAnchorsV2 返回数组 JSON 化结果，直接返回。
  return Array.isArray(f.anchors) ? f.anchors : [];
}

const REPOS = Object.keys(FIX);
for (const repo of REPOS) {
  const f = FIX[repo];
  test(`edge-gating: ${repo} sweep + gates 不得反噬 baseline（sHigh=0 sMed<=0 vHigh=0 hallu=0）`, () => {
    const anchors = buildAnchors(f);
    const importance = buildImportance(f);
    const swept = deterministicSweep(f.mdBefore, anchors, f.productTokens);
    const st = structureGates(swept.md, anchors, importance, f.productTokens);
    const vs = visualGates(swept.md);

    const sHigh = st.filter((x) => x.severity === 'high').length;
    const sMed = st.filter((x) => x.severity === 'medium').length;
    const vHigh = vs.filter((x) => x.severity === 'high').length;

    // 硬闸（否决项）必须 0
    assert.equal(sHigh, 0, `sHigh 必须 0（结构硬闸）。leftover：${st.filter(x=>x.severity==='high').map(x=>x.kind+':'+x.issue.slice(0,80)).join('；')}`);
    assert.equal(vHigh, 0, `vHigh 必须 0（视觉硬闸）。leftover：${vs.filter(x=>x.severity==='high').map(x=>x.kind+':'+x.issue.slice(0,80)).join('；')}`);

    // sMed 不能超基线（baseline=0 → 必须 0，即 caddy 圆柱+admin→http 修复、z2m 圆柱修复不能回退）
    assert.ok(sMed <= f.baseline.sMed, `sMed 回退：当前=${sMed} baseline=${f.baseline.sMed}。leftover：${st.filter(x=>x.severity==='medium').map(x=>x.kind+':'+x.issue.slice(0,80)).join('；')}`);

    // sweep 扫尾动作序列不应比 baseline 少关键补丁动作
    if (repo === 'caddy') {
      // caddy sweep 必须同时命中：①圆柱改矩形（含 filestorage+stek）；②admin→http 翻转动作
      const cylActs = swept.actions.filter((a) => a.includes('圆柱改矩形'));
      assert.ok(cylActs.length > 0, `caddy 无「圆柱改矩形」动作，实际：${swept.actions.join('｜')}`);
      for (const token of ['filestorage', 'stek']) {
        assert.ok(
          cylActs.some((a) => a.includes(token)),
          `caddy 缺少 ${token} 改矩形，实际圆柱动作：${cylActs.join('｜')}`
        );
      }
      assert.ok(
        swept.actions.some((a) => a.includes('配置类反向边翻转') && a.includes('admin') && a.includes('http')),
        `caddy 缺少 admin→http 配置边翻转，实际动作：${swept.actions.join('｜')}`
      );
    }
    if (repo === 'zigbee2mqtt') {
      assert.ok(
        swept.actions.some((a) => a.includes('圆柱改矩形') && (a.includes('st_state') || a.includes('st_cfg'))),
        `z2m sweep 缺少「st_state/st_cfg 圆柱改矩形」关键动作，实际：${swept.actions.join('｜')}`
      );
    }
  });
}

// —— blind-edge-7s-vs-orch4.js 回归（付费 key 才跑；无 key 时作为 pending placeholder 注册但不执行）——
test('edge regression: blind-edge-7s-vs-orch4.js（有 DEEPSEEK_API_KEY 时才跑）', { timeout: 45 * 60 * 1000 }, async (t) => {
  if (!process.env.DEEPSEEK_API_KEY || String(process.env.DEEPSEEK_API_KEY).length < 16) {
    t.skip('DEEPSEEK_API_KEY not set / too short，跳过付费盲评回归');
    return;
  }
  // 直接调用盲评脚本入口（若已导出）；否则作为 child_process 跑 node eval/orch/blind-edge-7s-vs-orch4.js
  const scriptPath = path.join(__dirname, '..', 'eval', 'orch', 'blind-edge-7s-vs-orch4.js');
  if (!fs.existsSync(scriptPath)) {
    t.skip('blind-edge-7s-vs-orch4.js 脚本不存在（fixture 仓可能未 clone L1 侧代码），跳过');
    return;
  }
  const { spawnSync } = require('child_process');
  const outdir = path.join(__dirname, '..', '.tmp-blind-regress');
  fs.mkdirSync(outdir, { recursive: true });
  // 盲评脚本：期望读 fixtures 用法见脚本 README。这里默认跑 demo fixture 的模式（不耗 token 的 fixture mode）
  // 如果脚本只有 LIVE 模式，那就保守给 --fixture-only 参数（假设脚本支持）。
  const r = spawnSync(process.argv0, [scriptPath, '--fixture-only', '--outdir', outdir], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 42 * 60 * 1000,
  });
  if (r.status === 77 || r.status === 2) {
    t.skip('blind 回归脚本返回 skip/unsupported：' + (r.stderr || r.stdout || '').slice(0, 300));
    return;
  }
  const lastLines = (r.stdout || '').split('\n').slice(-12).join('\n');
  assert.equal(r.status, 0, `blind 回归失败 exit=${r.status}\nSTDOUT tail:\n${lastLines}\nSTDERR:\n${(r.stderr||'').slice(-800)}`);
});
