'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { formatPullRequestComment, postPullRequestComment, COMMENT_MARKER } = require('../lib/pr-comment');

function emptyDiff() {
  return {
    summary: {
      addedNodes: 0, removedNodes: 0, modifiedNodes: 0, renamedNodes: 0,
      addedEdges: 0, removedEdges: 0, addedTypes: 0, removedTypes: 0,
      addedPackages: 0, removedPackages: 0, addedExternalDeps: 0, removedExternalDeps: 0,
      violations: 0, totalChanges: 0, changeScale: 'none'
    },
    addedNodes: [], removedNodes: [], modifiedNodes: [], renamedNodes: [],
    addedEdges: [], removedEdges: [], addedTypes: [], removedTypes: [],
    addedPackages: [], removedPackages: [], addedExternalDeps: [], removedExternalDeps: [],
    violations: []
  };
}

describe('T2 PR 架构评论 Markdown 生成', () => {
  test('零变更：一句话结论 + marker，无表格', () => {
    const md = formatPullRequestComment({
      diff: emptyDiff(),
      impact: { changedCount: 0, impactedCount: 0, items: [] },
      findings: [],
      riskSummary: { counts: {}, level: 'none', total: 0 }
    });
    assert.ok(md.startsWith(COMMENT_MARKER), '首行必须是 marker（幂等更新依赖它）');
    assert.match(md, /未检测到架构结构变更/);
    assert.doesNotMatch(md, /\|\s*新增/);
  });

  test('有变更：风险徽章、计数表、外部依赖、findings、影响面全展示', () => {
    const diff = emptyDiff();
    diff.summary = {
      ...diff.summary,
      addedNodes: 1, removedNodes: 1, modifiedNodes: 1, addedEdges: 2, removedEdges: 1,
      addedExternalDeps: 1, totalChanges: 6, changeScale: 'medium'
    };
    diff.addedExternalDeps = [{ id: 'ext:lodash', name: 'lodash', builtin: false }];
    const md = formatPullRequestComment({
      diff,
      impact: {
        changedCount: 3,
        impactedCount: 2,
        items: [{
          id: 'svc#AccountService',
          change: 'modified',
          label: '修改',
          node: { id: 'svc#AccountService', name: 'AccountService' },
          direct: [{ id: 'app#App', name: 'App' }, { id: 'web#Controller', name: 'Controller' }],
          transitive: []
        }]
      },
      findings: [
        { rule: 'new-external-dep', severity: 'medium', title: '新增外部依赖', message: '引入了新的第三方包: lodash', detail: 'ext:lodash' },
        { rule: 'orphan', severity: 'low', title: '孤儿节点', message: '新实体无架构连线', detail: 'x' }
      ],
      riskSummary: { counts: { high: 0, medium: 1, low: 1, info: 0 }, level: 'medium', total: 2 },
      baseRef: 'abc1234deadbeef',
      headRef: 'fedcba98deadbeef'
    });
    assert.ok(md.startsWith(COMMENT_MARKER));
    assert.match(md, /🟠 中风险/);
    assert.match(md, /新增第三方依赖/);
    assert.match(md, /`lodash`/);
    assert.match(md, /AccountService/);
    assert.match(md, /直接下游 2 个/);
    assert.match(md, /1 条低风险发现已折叠/);
    // 页脚含短 sha
    assert.match(md, /abc1234/);
  });

  test('高风险 finding 全量展示，marker 稳定不随内容变化', () => {
    const diff = emptyDiff();
    diff.summary.totalChanges = 1;
    diff.summary.removedNodes = 1;
    diff.removedNodes = [{ id: 'core#User', name: 'User', kind: 'class' }];
    const md = formatPullRequestComment({
      diff,
      impact: { changedCount: 1, impactedCount: 0, items: [] },
      findings: [
        { rule: 'removed-type', severity: 'high', title: '类型删除', message: 'class "User" 被删除', detail: 'core#User', file: 'core/user.js' }
      ],
      riskSummary: { counts: { high: 1, medium: 0, low: 0, info: 0 }, level: 'high', total: 1 }
    });
    assert.match(md, /🔴 高风险/);
    assert.match(md, /类型删除/);
    assert.match(md, /core\/user\.js/);
  });

  test('W14-07：基线文件变更时评论含防洗白提醒 + findings 摘要', () => {
    const { baselineFileChanged, formatBaselineWashWarning } = require('../lib/pr-comment');
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'av-base-'));
    const head = fs.mkdtempSync(path.join(os.tmpdir(), 'av-head-'));
    fs.mkdirSync(path.join(base, '.av'), { recursive: true });
    fs.mkdirSync(path.join(head, '.av'), { recursive: true });
    fs.writeFileSync(path.join(base, '.av', 'graph-baseline.json'), '{"fingerprint":"aaa"}');
    fs.writeFileSync(path.join(head, '.av', 'graph-baseline.json'), '{"fingerprint":"bbb"}');
    assert.equal(baselineFileChanged(base, head), true);
    assert.equal(baselineFileChanged(base, base), false);

    const findings = [
      { rule: 'cross-layer-violation', severity: 'high', title: '跨层违规', message: 'controller→storage', detail: 'x' }
    ];
    const wash = formatBaselineWashWarning({
      findings,
      riskSummary: { level: 'high', total: 1, counts: { high: 1, medium: 0, low: 0, info: 0 } }
    });
    assert.match(wash, /基线刷新需人工确认/);
    assert.match(wash, /防洗白/);
    assert.match(wash, /跨层违规/);

    const diff = emptyDiff();
    diff.summary.totalChanges = 1;
    diff.summary.addedNodes = 1;
    const md = formatPullRequestComment({
      diff,
      impact: { changedCount: 1, impactedCount: 0, items: [] },
      findings,
      riskSummary: { counts: { high: 1, medium: 0, low: 0, info: 0 }, level: 'high', total: 1 },
      baselineChanged: true
    });
    assert.match(md, /基线刷新需人工确认（防洗白）/);
    assert.match(md, /含基线变更（需人工确认）/);
    assert.match(md, /跨层违规/);
  });
});

describe('T2 PR 评论发布（幂等）', () => {
  test('无 GITHUB_EVENT_PATH 时 skipped，不抛异常', async () => {
    const saved = process.env.GITHUB_EVENT_PATH;
    delete process.env.GITHUB_EVENT_PATH;
    try {
      const r = await postPullRequestComment({ body: 'x', token: 't', fetchImpl: async () => { throw new Error('不应发起请求'); } });
      assert.equal(r.action, 'skipped');
    } finally {
      if (saved) process.env.GITHUB_EVENT_PATH = saved;
    }
  });

  test('无历史评论 → POST 创建；有 marker 评论 → PATCH 更新', async () => {
    const eventPath = path.join(os.tmpdir(), `av-fake-event-${process.pid}.json`);
    fs.writeFileSync(eventPath, JSON.stringify({
      pull_request: { number: 7, base: { repo: { full_name: 'acme/demo' } } }
    }));

    const calls = [];
    const fetchNoExisting = async (url, opts = {}) => {
      calls.push(opts.method || 'GET');
      if (!opts.method) return { ok: true, json: async () => [] };
      return { ok: true, json: async () => ({ html_url: 'https://g/c/1' }) };
    };
    const r1 = await postPullRequestComment({ body: COMMENT_MARKER + ' v1', eventPath, token: 't', fetchImpl: fetchNoExisting });
    assert.equal(r1.action, 'created');
    assert.deepEqual(calls, ['GET', 'POST']);

    const calls2 = [];
    const fetchExisting = async (url, opts = {}) => {
      calls2.push(opts.method || 'GET');
      if (!opts.method) return { ok: true, json: async () => [{ id: 99, body: COMMENT_MARKER + ' old' }] };
      return { ok: true, json: async () => ({ html_url: 'https://g/c/99' }) };
    };
    const r2 = await postPullRequestComment({ body: COMMENT_MARKER + ' v2', eventPath, token: 't', fetchImpl: fetchExisting });
    assert.equal(r2.action, 'updated');
    assert.deepEqual(calls2, ['GET', 'PATCH']);

    fs.unlinkSync(eventPath);
  });
});
