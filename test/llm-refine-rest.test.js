'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  viewSpecFor,
  restSystemPrompt,
  restUserPrompt,
  buildRefineContext,
  buildInventoryDigest,
  takeFileMd,
  refineRestViews
} = require('../lib/llm-generate');
const { scan } = require('../lib/scan');

const REST = [
  'c4-context.md',
  'c4-container.md',
  'c4-component.md',
  'class-diagram.md',
  'deployment-ops.md'
];

const DEMO = path.join(__dirname, '..', 'examples', 'tutorial-demo');

describe('refine rest-view specs', () => {
  it('each of the 5 views has a dedicated mermaid-type contract', () => {
    // c4-* 精修片用 flowchart（Block 视觉语法）表达 C4 语义
    assert.match(viewSpecFor('c4-context.md'), /flowchart/);
    assert.match(viewSpecFor('c4-container.md'), /flowchart/);
    assert.match(viewSpecFor('c4-component.md'), /flowchart/);
    assert.doesNotMatch(viewSpecFor('c4-context.md'), /头必须是 C4Context/);
    assert.match(viewSpecFor('c4-context.md'), /系统上下文|C4 语义边界/);
    assert.match(viewSpecFor('class-diagram.md'), /classDiagram/);
    assert.match(viewSpecFor('deployment-ops.md'), /flowchart/);
    assert.match(viewSpecFor('c4-context.md'), /unknown/);
    assert.match(viewSpecFor('c4-context.md'), /stadium/);
    assert.match(viewSpecFor('deployment-ops.md'), /禁止编造/);
    assert.match(viewSpecFor('deployment-ops.md'), /classDef/);
    assert.match(viewSpecFor('deployment-ops.md'), /<small>/);
    assert.match(viewSpecFor('deployment-ops.md'), /subgraph/);
    assert.match(viewSpecFor('deployment-ops.md'), /不要上完整编排状态机/);
  });

  it('rest prompts are per-file and carry digest + tree + excerpts', () => {
    const inv = {
      title: 'demo',
      folder: 'demo',
      languages: ['python'],
      entrypoints: ['app/main.py'],
      modules: [],
      services: [],
      artifacts: [],
      deploy: [],
      classes: [{ name: 'Todo', file: 'app/models/todo.py' }],
      packages: [{ name: 'flask', kind: 'python-import' }]
    };
    const ctx = {
      treeText: 'app/\napp/main.py',
      excerptText: '### app/main.py\nfrom flask import Flask'
    };
    const sys = restSystemPrompt('c4-context.md', '# AGENT');
    assert.match(sys, /只生成 c4-context\.md/);
    assert.match(sys, /flowchart/);
    const user = restUserPrompt('c4-container.md', inv, ctx);
    assert.match(user, /c4-container\.md/);
    assert.match(user, /flask/);
    assert.match(user, /app\/main\.py/);
    assert.match(user, /from flask import Flask/);
    assert.match(user, /flowchart/);
    assert.doesNotMatch(user, /block-diagram/);
  });
});

describe('buildRefineContext (tutorial-demo)', () => {
  it('includes python/flask/main.py evidence, not an empty digest', () => {
    const inv = scan(DEMO);
    const digest = buildInventoryDigest(inv);
    assert.match(digest, /python/);
    assert.match(digest, /flask/);
    assert.match(digest, /app\/main\.py/);
    const ctx = buildRefineContext(DEMO, inv);
    assert.match(ctx.treeText, /app\/main\.py/);
    const paths = ctx.excerpts.map((e) => e.path).join('\n');
    assert.match(paths, /app\/main\.py/);
    assert.ok(ctx.excerptText.length > 200, 'excerpts should be non-trivial');
  });
});

describe('takeFileMd', () => {
  it('accepts JSON keyed by filename or raw mermaid markdown', () => {
    const md = '## 子图1：x\n\n```mermaid\nC4Context\n```\n';
    assert.equal(takeFileMd(JSON.stringify({ 'c4-context.md': md }), 'c4-context.md'), md);
    assert.match(takeFileMd(md, 'c4-context.md'), /C4Context/);
    assert.equal(takeFileMd('nope', 'c4-context.md'), null);
  });
});

describe('refineRestViews (mocked chat)', () => {
  it('calls chat once per view with that view\'s system prompt', async () => {
    const calls = [];
    const chatFn = async (messages) => {
      calls.push(messages[0].content);
      const file = REST.find((f) => messages[0].content.includes('只生成 ' + f));
      const head = {
        'c4-context.md': 'C4Context',
        'c4-container.md': 'C4Container',
        'c4-component.md': 'C4Component',
        'class-diagram.md': 'classDiagram',
        'deployment-ops.md': 'flowchart TB'
      }[file];
      const body = [
        '## 子图1：测',
        '',
        '```mermaid',
        head,
        '  Person(user, "使用者")',
        '  System(sys, "demo", "Flask")',
        '  Rel(user, sys, "HTTP")',
        '```',
        ''
      ].join('\n');
      return JSON.stringify({ [file]: body });
    };
    const inv = scan(DEMO);
    const ctx = buildRefineContext(DEMO, inv);
    const r = await refineRestViews(REST, {
      inv,
      ctx,
      agentMd: '# AGENT',
      tree: ctx.tree,
      chatOpts: { apiKey: 'test' },
      chatFn
    });
    assert.ok(calls.length >= REST.length);
    for (const f of REST) {
      assert.ok(calls.some((c) => c.includes('只生成 ' + f)), 'missing prompt for ' + f);
      assert.ok(r.files[f], 'missing output for ' + f);
      assert.match(r.files[f], /```mermaid/);
      assert.equal(r.gateReport[f].critiqued, true, 'shallow critique should run for ' + f);
    }
    assert.ok(calls.some((c) => c.includes('浅批判')), 'expected a critique-round system prompt');
  });
});
