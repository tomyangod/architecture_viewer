'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildAwareness,
  formatAwarenessLine,
  attachAwarenessEvidence,
  markAwarenessSeen,
  muteAwarenessRule,
  unmuteAwarenessRule,
  readCursor,
  DAILY_L2_CAP
} = require('../lib/awareness');
const { formatSessionVerdict } = require('../lib/session-verdict');
const { generateReport, buildSessionReportJson } = require('../lib/session-report');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-aw-'));
  fs.mkdirSync(path.join(dir, '.av'), { recursive: true });
  return dir;
}

describe('awareness layer P0', () => {
  it('defaults to silent when no whitelist hits', () => {
    const aw = buildAwareness({
      findings: [{ rule: 'broad-impact', severity: 'high', title: '波及面大', message: 'x' }],
      ignoreLastCards: true
    });
    assert.equal(aw.silent, true);
    assert.equal(aw.level, 'L1');
    assert.equal(aw.cards.length, 0);
    assert.equal(formatAwarenessLine(aw), null);
  });

  it('emits L3 for schema-touched and signature-break', () => {
    const aw = buildAwareness({
      findings: [
        { rule: 'schema-touched', severity: 'high', file: 'schema.sql', line: 1, title: 'schema', message: 'm' },
        { rule: 'signature-break', severity: 'high', file: 'api.js', line: 10, title: 'sig', message: 'm' }
      ],
      ignoreLastCards: true
    });
    assert.equal(aw.silent, false);
    assert.equal(aw.level, 'L3');
    assert.ok(aw.cards.some((c) => c.rule === 'schema-touched' && c.level === 'L3'));
    assert.ok(aw.cards.some((c) => c.rule === 'signature-break' && c.level === 'L3'));
  });

  it('does not escalate unconfirmed layer-skip to awareness', () => {
    const aw = buildAwareness({
      findings: [
        {
          rule: 'layer-skip',
          severity: 'high',
          file: 'c.py',
          line: 2,
          fromLayer: 'controller',
          toLayer: 'storage',
          layerConfirmation: 'inferred',
          reportOnly: true,
          title: '跳层',
          message: 'inferred'
        }
      ],
      ignoreLastCards: true
    });
    assert.equal(aw.silent, true);
    assert.equal(aw.cards.length, 0);
  });

  it('escalates configured layer-skip to L3', () => {
    const aw = buildAwareness({
      findings: [
        {
          rule: 'layer-skip',
          severity: 'high',
          file: 'c.py',
          line: 2,
          fromLayer: 'controller',
          toLayer: 'storage',
          layerConfirmation: 'configured',
          title: '跳层',
          message: 'configured'
        }
      ],
      ignoreLastCards: true
    });
    assert.equal(aw.silent, false);
    assert.equal(aw.level, 'L3');
    assert.equal(aw.cards[0].rule, 'layer-skip');
  });

  it('emits L2 for new-external-dep and sensitive sinks', () => {
    const aw = buildAwareness({
      findings: [
        { rule: 'new-external-dep', severity: 'medium', message: 'added lodash', detail: 'package.json' }
      ],
      diff: {
        behaviorChanges: [
          {
            path: 'svc.js',
            owner: 'OrderService',
            method: 'pay',
            addedSinks: ['storage:save', 'http:fetch']
          }
        ]
      },
      ignoreLastCards: true
    });
    assert.equal(aw.silent, false);
    assert.equal(aw.level, 'L2');
    assert.ok(aw.cards.some((c) => c.rule === 'new-external-dep'));
    assert.ok(aw.cards.some((c) => c.rule === 'sensitive-sink' && c.sinkKind === 'storage'));
    assert.ok(aw.cards.some((c) => c.rule === 'sensitive-sink' && c.sinkKind === 'http'));
  });

  it('suppresses identical cards after markAwarenessSeen', () => {
    const repo = tmpRepo();
    const findings = [
      { rule: 'schema-touched', severity: 'high', file: 'schema.sql', line: 1, title: 'schema', message: 'm' }
    ];
    const first = buildAwareness({ findings, repo, ignoreLastCards: false });
    assert.equal(first.silent, false);
    markAwarenessSeen(repo, { awareness: first, headFingerprint: 'fp1' });
    const second = buildAwareness({ findings, repo });
    assert.equal(second.silent, true);
    assert.equal(second.stats.repeats, 1);
    const cursor = readCursor(repo);
    assert.equal(cursor.lastSeenFingerprint, 'fp1');
    assert.ok(cursor.lastCardKeys.length >= 1);
  });

  it('respects mutedRules', () => {
    const repo = tmpRepo();
    muteAwarenessRule(repo, 'schema-touched');
    const aw = buildAwareness({
      repo,
      findings: [
        { rule: 'schema-touched', severity: 'high', file: 'schema.sql', line: 1, title: 'schema', message: 'm' }
      ]
    });
    assert.equal(aw.silent, true);
  });

  it('verdict line2 prefers awareness over top finding', () => {
    const aw = buildAwareness({
      findings: [
        { rule: 'schema-touched', severity: 'high', file: 'schema.sql', line: 1, title: 'schema', message: 'm' },
        { rule: 'broad-impact', severity: 'high', title: '波及面大', message: 'x', file: 'a.js' }
      ],
      ignoreLastCards: true
    });
    const v = formatSessionVerdict({
      riskSummary: { level: 'high', counts: { high: 2 } },
      findings: aw.cards.length
        ? [
            { rule: 'schema-touched', severity: 'high', file: 'schema.sql', line: 1, title: 'schema', message: 'm' },
            { rule: 'broad-impact', severity: 'high', title: '波及面大', message: 'x', file: 'a.js' }
          ]
        : [],
      summary: { totalChanges: 1 },
      awareness: aw
    });
    assert.match(v.lines[1], /^感知 · /);
    assert.doesNotMatch(v.lines[1], /最严重：/);
    assert.equal(v.awarenessLine != null, true);
  });

  it('does not affect gate — awareness is render-only', () => {
    const aw = buildAwareness({
      findings: [
        { rule: 'schema-touched', severity: 'high', file: 'schema.sql', line: 1, title: 'schema', message: 'm' }
      ],
      ignoreLastCards: true
    });
    const v = formatSessionVerdict({
      riskSummary: { level: 'none', counts: {} },
      findings: [],
      summary: { totalChanges: 0 },
      awareness: aw
    });
    assert.equal(v.level, 'none');
    assert.match(v.lines[1], /^感知 · /);
  });

  it('HTML and JSON carry awareness section when cards exist', () => {
    const { diffGraphs } = require('../lib/diff-graph');
    const awareness = buildAwareness({
      findings: [
        { rule: 'schema-touched', severity: 'high', file: 'schema.sql', line: 1, title: 'schema', message: 'm' }
      ],
      ignoreLastCards: true
    });
    const g = {
      root: '/tmp/r', fingerprint: 'b',
      stats: { files: 0, types: 0, edges: 0 },
      nodes: [], edges: [],
      sessionStartedAt: '2026-01-01T00:00:00.000Z'
    };
    const base = g;
    const head = { ...g, fingerprint: 'h' };
    const diff = diffGraphs(base, head);
    const html = generateReport({
      baseGraph: base, headGraph: head, diff, findings: [], impact: null,
      repoName: 'r', awareness
    });
    assert.match(html, /id="awareness-section"/);
    assert.match(html, /感知 · 敏感面/);
    assert.match(html, /数据契约变了/);
    assert.match(html, /awareness-mute/);
    assert.match(html, /session awareness mute /);
    assert.match(html, /archify-export --confirm/);

    const json = buildSessionReportJson({
      diff, findings: [], riskSummary: { level: 'none', counts: {} },
      baseGraph: base, headGraph: head, repoName: 'r', awareness
    });
    assert.ok(json.awareness);
    assert.equal(json.awareness.silent, false);
    assert.equal(json.awareness.cards[0].rule, 'schema-touched');
  });

  it('attaches walk step evidence to matching cards', () => {
    const aw = buildAwareness({
      findings: [{
        rule: 'layer-skip',
        severity: 'high',
        file: 'controller/c.py',
        line: 8,
        fromLayer: 'controller',
        toLayer: 'storage',
        layerConfirmation: 'configured',
        title: '跳层',
        message: 'configured'
      }],
      ignoreLastCards: true
    });
    attachAwarenessEvidence(aw, {
      steps: [
        { order: 1, path: 'service/s.py', name: 'S.do', layerSkip: false, sinks: [] },
        { order: 2, path: 'controller/c.py', name: 'C.pay', line: 8, layerSkip: true, sinks: [] }
      ]
    });
    assert.equal(aw.cards[0].walkOrder, 2);
    assert.equal(aw.cards[0].walkAnchor, 'walk-step-2');
    assert.equal(aw.cards[0].walkName, 'C.pay');
    assert.equal(aw.cards[0].where, 'controller/c.py:8');
    const line = formatAwarenessLine(aw);
    assert.match(line, /走查第 2 步/);
  });

  it('matches sensitive-sink cards to walk steps by sink kind', () => {
    const aw = buildAwareness({
      diff: {
        behaviorChanges: [{
          path: 'svc.js',
          owner: 'OrderService',
          method: 'pay',
          addedSinks: ['storage:save']
        }]
      },
      ignoreLastCards: true
    });
    attachAwarenessEvidence(aw, {
      steps: [{
        order: 4,
        path: 'svc.js',
        name: 'OrderService.pay',
        sinks: [{ kind: 'storage', name: 'save' }]
      }]
    });
    assert.equal(aw.cards[0].walkOrder, 4);
    assert.equal(aw.cards[0].walkAnchor, 'walk-step-4');
  });

  it('daily L2 cap drops extra L2 but keeps L3', () => {
    const day = new Date().toISOString().slice(0, 10);
    const cursor = {
      version: 1,
      lastSeenFingerprint: null,
      lastSeenAt: null,
      mutedRules: [],
      lastCardKeys: [],
      l2ShownOn: day,
      l2ShownCount: DAILY_L2_CAP
    };
    const aw = buildAwareness({
      findings: [
        { rule: 'schema-touched', severity: 'high', file: 'schema.sql', line: 1, title: 'schema', message: 'm' },
        { rule: 'new-external-dep', severity: 'medium', message: 'added lodash', detail: 'package.json' }
      ],
      cursor,
      ignoreLastCards: true
    });
    assert.equal(aw.silent, false);
    assert.equal(aw.level, 'L3');
    assert.ok(aw.cards.every((c) => c.level !== 'L2'));
    assert.ok(aw.cards.some((c) => c.rule === 'schema-touched'));
  });

  it('unmute restores a muted rule', () => {
    const repo = tmpRepo();
    muteAwarenessRule(repo, 'schema-touched');
    unmuteAwarenessRule(repo, 'schema-touched');
    const aw = buildAwareness({
      repo,
      findings: [
        { rule: 'schema-touched', severity: 'high', file: 'schema.sql', line: 1, title: 'schema', message: 'm' }
      ]
    });
    assert.equal(aw.silent, false);
  });

  it('P2 portrait lists entries, external deps, sink counts without inventing modules', () => {
    const { buildSparsePortrait } = require('../lib/awareness');
    const headGraph = {
      nodes: [
        { id: 'cls:OrderController', kind: 'class', name: 'OrderController', layer: 'controller', path: 'c/order.py' },
        { id: 'cls:PaySvc', kind: 'class', name: 'PaySvc', layer: 'service', path: 's/pay.py' },
        { id: 'cls:Repo', kind: 'class', name: 'Repo', layer: 'storage', path: 'r/repo.py' }
      ],
      edges: []
    };
    const diff = {
      addedNodes: [
        { id: 'cls:OrderController', node: headGraph.nodes[0] },
        { id: 'cls:PaySvc', node: headGraph.nodes[1] }
      ],
      removedNodes: [],
      modifiedNodes: [{ id: 'cls:Repo' }],
      movedNodes: [],
      renamedNodes: [],
      addedExternalDeps: [{ name: 'stripe', id: 'ext:stripe' }],
      removedExternalDeps: [{ name: 'left-pad', id: 'ext:left-pad' }],
      behaviorChanges: [{
        path: 's/pay.py',
        owner: 'PaySvc',
        method: 'charge',
        addedSinks: ['http:fetch', 'storage:save']
      }]
    };
    const portrait = buildSparsePortrait({ diff, headGraph });
    assert.equal(portrait.empty, false);
    assert.ok(portrait.entries.some((e) => e.name === 'OrderController' && e.layer === 'controller'));
    assert.ok(!portrait.entries.some((e) => /支付|模块/.test(e.name)));
    assert.deepEqual(portrait.external.added, ['stripe']);
    assert.deepEqual(portrait.external.removed, ['left-pad']);
    assert.equal(portrait.sinks.http, 1);
    assert.equal(portrait.sinks.storage, 1);
    assert.match(portrait.summaryLine, /入口/);
    assert.match(portrait.summaryLine, /外依/);
    assert.match(portrait.summaryLine, /写库|HTTP/);

    const aw = buildAwareness({
      findings: [],
      diff,
      headGraph,
      mutedRules: ['sensitive-sink', 'new-external-dep'],
      ignoreLastCards: true
    });
    assert.equal(aw.silent, true);
    assert.ok(aw.portrait && !aw.portrait.empty);
    assert.equal(formatAwarenessLine(aw), null);

    const { diffGraphs } = require('../lib/diff-graph');
    const base = { root: '/t', fingerprint: 'b', stats: { files: 0, types: 0, edges: 0 }, nodes: [], edges: [] };
    const head = { ...base, fingerprint: 'h', nodes: headGraph.nodes, edges: [] };
    // Use real diffGraphs for HTML path; override awareness with our portrait-bearing one
    const emptyDiff = diffGraphs(base, head);
    const html = generateReport({
      baseGraph: base, headGraph: head, diff: emptyDiff, findings: [], impact: null,
      repoName: 't', awareness: aw
    });
    assert.match(html, /感知 · 敏感面/);
    assert.match(html, /awareness-portrait/);
    assert.match(html, /OrderController/);
    assert.match(html, /stripe/);
    assert.doesNotMatch(html, /支付模块/);
  });
});
