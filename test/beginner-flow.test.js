'use strict';

// W15-07: 零文档新手完成拍照-改码-验收全流程
//
// 验收标准：零文档新手用 MCP 完成一次完整 session 循环，关键路径不迷路。
// 本测试模拟一个不看文档的 AI/用户，只靠工具返回的 message/error/nextStep 引导，
// 走完：误调 report → start 拍照 → 改代码（引入红灯）→ changes 检查 → report 看红灯
//       → 修代码 → report 复查绿灯 → start 刷新基线。
//
// 每个关键节点断言：返回里有明确的下一步引导（提到该调的下一个工具名）。

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  toolSessionStart,
  toolSessionReport,
  toolSessionChanges,
  stopWatcher
} = require('../mcp/server');

// 等 fs.watch 事件触发（watcher 在文件变更后的下一个事件循环才递增 pendingFiles）
const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-w1507-'));
  fs.mkdirSync(path.join(dir, 'controllers'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'models'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'controllers', 'api.js'),
    'function handle(req) { return req; }\nmodule.exports = { handle };\n');
  fs.writeFileSync(path.join(dir, 'models', 'db.js'),
    'class DB { save(x) { return x; } }\nmodule.exports = { DB };\n');
  return dir;
}

describe('W15-07: 零文档新手全流程不迷路', () => {
  let dir;

  after(() => {
    stopWatcher(dir);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('完整 session 循环：误调→拍照→改码(红灯)→检查→报告→修复→复查→刷新基线', async () => {
    dir = makeRepo();

    // ── 步骤 0: 新手不知道要先 start，直接调 report ──
    const earlyReport = toolSessionReport({ repo: dir });
    assert.equal(earlyReport.error, 'NO_BASELINE', '没基线时应返回 NO_BASELINE');
    // 关键：错误信息必须引导新手去调 av_session_start
    assert.ok(earlyReport.message.includes('av_session_start'),
      `NO_BASELINE 错误必须引导调 av_session_start，实际: ${earlyReport.message}`);

    // ── 步骤 1: 新手按引导调 start 拍照 ──
    const start = toolSessionStart({ repo: dir });
    assert.ok(!start.error, 'start 不应报错');
    assert.ok(start.message.includes('改代码'), 'start message 应告诉用户去改代码');
    // 关键：start message 必须告诉新手改完干什么
    assert.ok(start.message.includes('av_session_report') || start.message.includes('av_session_changes'),
      `start message 必须引导改完后调 changes/report，实际: ${start.message}`);
    assert.ok(start.message.includes('av_session_start'),
      'start message 应提到最后再调 start 刷新基线');

    // ── 步骤 2: 新手改代码（引入跨层违规：models → controllers）──
    fs.writeFileSync(path.join(dir, 'models', 'db.js'),
      'const { handle } = require("../controllers/api");\n' +
      'class DB { save(x) { handle(x); return x; } }\n' +
      'module.exports = { DB };\n');
    await tick();

    // ── 步骤 3: 新手调 changes 轻量检查 ──
    const changes = toolSessionChanges({ repo: dir });
    // changes 应检测到变更（watcher 可能 idle，但无 watcher 时会实时生成）
    if (changes.status === 'ready') {
      assert.equal(changes.hasChanges, true, '应检测到架构变更');
      // 关键：有变更时必须引导调 av_session_report
      assert.ok(changes.message.includes('av_session_report'),
        `changes 有变更时必须引导调 report，实际: ${changes.message}`);
    } else if (changes.status === 'idle') {
      // watcher 还在防抖：message 应告诉新手可以直接调 report
      assert.ok(changes.message.includes('av_session_report'),
        `idle 状态应提示可直接调 report，实际: ${changes.message}`);
    }

    // ── 步骤 4: 新手调 report 看完整报告 ──
    const report1 = toolSessionReport({ repo: dir });
    assert.ok(!report1.error, 'report 不应报错');
    assert.equal(report1.riskLevel, 'high', '跨层违规应为 high 风险');
    assert.ok(report1.findingsCount >= 1, '应有至少 1 条 finding');
    // 关键：红灯时 nextStep 必须引导修复 + 复查 + 刷新基线
    assert.ok(report1.nextStep, 'report 必须返回 nextStep 引导');
    assert.ok(report1.nextStep.includes('av_explain_finding') || report1.nextStep.includes('修'),
      `红灯 nextStep 应引导修复，实际: ${report1.nextStep}`);
    assert.ok(report1.nextStep.includes('av_session_report'),
      '红灯 nextStep 应引导修完再调 report 复查');
    assert.ok(report1.nextStep.includes('av_session_start'),
      '红灯 nextStep 应引导全绿后调 start 刷新基线');

    // ── 步骤 5: 新手修复代码（去掉跨层违规）──
    fs.writeFileSync(path.join(dir, 'models', 'db.js'),
      'class DB { save(x) { return x; } }\nmodule.exports = { DB };\n');
    await tick();

    // ── 步骤 6: 新手再调 report 复查 ──
    const report2 = toolSessionReport({ repo: dir });
    assert.ok(!report2.error, '复查 report 不应报错');
    assert.notEqual(report2.riskLevel, 'high', '修复后不应再是 high');
    // 关键：绿灯/非红灯时 nextStep 必须引导调 start 刷新基线
    assert.ok(report2.nextStep, '复查 report 必须返回 nextStep');
    assert.ok(report2.nextStep.includes('av_session_start'),
      `绿灯 nextStep 应引导调 start 刷新基线，实际: ${report2.nextStep}`);

    // ── 步骤 7: 新手调 start 刷新基线，进入下一轮 ──
    const start2 = toolSessionStart({ repo: dir });
    assert.ok(!start2.error, '二次 start 不应报错');
    // 旧报告应被清除
    assert.ok(start2.clearedReports, 'start 应返回 clearedReports');
    // 刷新基线后，report 应为绿灯（无变更）
    const report3 = toolSessionReport({ repo: dir });
    assert.ok(!report3.error, '刷新后 report 不应报错');
    assert.equal(report3.hasChanges, false, '刷新基线后应无架构变更');
  });

  it('每步返回的工具名引导形成闭环（start→changes/report→start）', async () => {
    const tmp = makeRepo();
    try {
      const start = toolSessionStart({ repo: tmp });
      // start 引导里必须同时出现"改完调 report"和"最后调 start"
      const msg = start.message;
      assert.ok(/av_session_report|av_session_changes/.test(msg), 'start 必须引导改完调 report/changes');
      assert.ok(/av_session_start/.test(msg), 'start 必须引导最后调 start 刷新');

      // report（无变更绿灯）的 nextStep 必须引导回 start
      await tick();
      const report = toolSessionReport({ repo: tmp });
      assert.ok(report.nextStep && report.nextStep.includes('av_session_start'),
        '绿灯 nextStep 必须引导回 start');
    } finally {
      stopWatcher(tmp);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('nextStep 字段在所有工具返回中一致出现（盲测一致性）', async () => {
    const tmp = makeRepo();
    try {
      // 1. NO_BASELINE: report 和 changes 必须都有 nextStep
      const noBaseReport = toolSessionReport({ repo: tmp });
      assert.equal(noBaseReport.error, 'NO_BASELINE');
      assert.ok(noBaseReport.nextStep, 'report NO_BASELINE 必须有 nextStep');
      assert.ok(noBaseReport.nextStep.includes('av_session_start'),
        `report NO_BASELINE nextStep 必须引导 start，实际: ${noBaseReport.nextStep}`);

      const noBaseChanges = toolSessionChanges({ repo: tmp });
      assert.equal(noBaseChanges.error, 'NO_BASELINE');
      assert.ok(noBaseChanges.nextStep, 'changes NO_BASELINE 必须有 nextStep');
      assert.ok(noBaseChanges.nextStep.includes('av_session_start'),
        `changes NO_BASELINE nextStep 必须引导 start，实际: ${noBaseChanges.nextStep}`);

      // 2. start 必须有 nextStep
      const start = toolSessionStart({ repo: tmp });
      assert.ok(start.nextStep, 'start 必须有 nextStep');
      assert.ok(/av_session_changes|av_session_report/.test(start.nextStep),
        `start nextStep 必须引导 changes/report，实际: ${start.nextStep}`);

      // 3. changes（无变更）必须有 nextStep
      await tick();
      const changes = toolSessionChanges({ repo: tmp });
      assert.ok(changes.nextStep, `changes ${changes.status} 状态必须有 nextStep`);
      assert.ok(/av_session/.test(changes.nextStep),
        `changes nextStep 必须引导下一步，实际: ${changes.nextStep}`);

      // 4. report（无变更绿灯）必须有 nextStep
      const report = toolSessionReport({ repo: tmp });
      assert.ok(report.nextStep, 'report 绿灯必须有 nextStep');
      assert.ok(report.nextStep.includes('av_session_start'),
        `绿灯 nextStep 必须引导 start，实际: ${report.nextStep}`);

      // 5. 改坏代码后，changes 和 report 都必须有 nextStep
      fs.writeFileSync(path.join(tmp, 'models', 'db.js'),
        'const { handle } = require("../controllers/api");\n' +
        'class DB { save(x) { handle(x); return x; } }\n' +
        'module.exports = { DB };\n');
      await tick(25000); // 等 watcher 防抖

      const changes2 = toolSessionChanges({ repo: tmp });
      assert.ok(changes2.nextStep, `changes 有变更时必须有 nextStep，实际: ${JSON.stringify(changes2)}`);

      const report2 = toolSessionReport({ repo: tmp });
      assert.ok(report2.nextStep, 'report 红灯必须有 nextStep');
      assert.ok(report2.nextStep.includes('av_explain_finding') || report2.nextStep.includes('修'),
        `红灯 nextStep 必须引导修复，实际: ${report2.nextStep}`);
    } finally {
      stopWatcher(tmp);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
