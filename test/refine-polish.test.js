'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  FLOWCHART_VISUAL_RULE,
  HUMAN_STYLE_RULE,
  C4_FLOWCHART_RULE,
  C4_HUMAN_RULE,
  parseCritique,
  applyShallowCritique,
  critiqueUserPrompt
} = require('../lib/refine-polish');

const SAMPLE = [
  '## 子图1：运行时',
  '',
  '```mermaid',
  'flowchart TB',
  '  A["Flask"] --> B["todos"]',
  '```',
  ''
].join('\n');

const RICHER = [
  '## 子图1：运行时',
  '',
  '```mermaid',
  'flowchart TB',
  '  subgraph L_api["后端 / API"]',
  '    A["🧩 Flask 入口<br/><small>app/main.py</small>"]',
  '    B["🔌 路由<br/><small>app/routes/todos.py</small>"]',
  '  end',
  '  classDef api fill:#ede7f6',
  '  class A,B api',
  '  A -->|注册蓝图| B',
  '```',
  ''
].join('\n');

describe('parseCritique', () => {
  it('treats missing/empty payload as ok', () => {
    assert.deepEqual(parseCritique(''), { verdict: 'ok', issues: [] });
    assert.deepEqual(parseCritique('not json'), { verdict: 'ok', issues: [] });
    assert.equal(parseCritique('{"verdict":"revise"}').verdict, 'ok');
  });

  it('caps issues at 6 and requires revise+issues', () => {
    const issues = Array.from({ length: 8 }, (_, i) => ({ kind: 'label', issue: 'x' + i, fix: 'y' }));
    const r = parseCritique(JSON.stringify({ verdict: 'revise', issues }));
    assert.equal(r.verdict, 'revise');
    assert.equal(r.issues.length, 6);
  });
});

describe('critique dialect', () => {
  it('all three c4 views get flowchart grammar (not just component)', () => {
    for (const f of ['c4-context.md', 'c4-container.md', 'c4-component.md']) {
      const c4 = critiqueUserPrompt(f, 'x', 'flowchart');
      // C4 三视图精修片统一用 Block flowchart 语法
      assert.match(c4, /classDef/, f);
      assert.match(c4, /stadium/, f);
      assert.match(c4, /机器感红线/, f);
      // 仍在用 C4 原生方言算机器感
      assert.match(c4, /C4Context\/C4Container\/C4Component/, f);
    }
  });

  it('deploy requires stadium closeup; class stays classDiagram', () => {
    const deploy = critiqueUserPrompt('deployment-ops.md', 'x', 'flowchart');
    assert.match(deploy, /classDef/);
    assert.match(deploy, /stadium/);
    assert.match(deploy, /本地启动/);
    assert.match(deploy, /机器感红线/);
    const klass = critiqueUserPrompt('class-diagram.md', 'x', 'classDiagram');
    assert.match(klass, /禁止改成 flowchart/);
    assert.match(klass, /机器感红线/);
  });
});

describe('HUMAN_STYLE_RULE', () => {
  it('targets hand-drawn voice shared with Block', () => {
    assert.match(HUMAN_STYLE_RULE, /人手绘/);
    assert.match(HUMAN_STYLE_RULE, /动宾/);
    assert.match(HUMAN_STYLE_RULE, /双胞胎/);
    assert.match(C4_HUMAN_RULE, /方法签名/);
    assert.match(C4_HUMAN_RULE, /不是文件名|纯英文文件名/);
    assert.match(C4_HUMAN_RULE, /间接依赖清单化/);
  });
});

describe('C4_FLOWCHART_RULE', () => {
  it('ports Block visual grammar to C4 views and bans native C4 dialect', () => {
    assert.match(C4_FLOWCHART_RULE, /flowchart/);
    assert.match(C4_FLOWCHART_RULE, /classDef/);
    assert.match(C4_FLOWCHART_RULE, /stadium/);
    assert.match(C4_FLOWCHART_RULE, /圆柱/);
    assert.match(C4_FLOWCHART_RULE, /subgraph/);
    assert.match(C4_FLOWCHART_RULE, /不要用 C4Context/);
  });

  it('bans nested subgraph (mermaid swallows cross-nested edges)', () => {
    assert.match(C4_FLOWCHART_RULE, /禁止嵌套|禁止 APP 里再套/);
    assert.match(C4_FLOWCHART_RULE, /Syntax error|吞边/);
  });

  it('c4-context skips subgraph (system is one card)', () => {
    assert.match(C4_FLOWCHART_RULE, /c4-context 不需要 subgraph/);
  });
  it('requires stadium closeup on sub2 (no paths) with scene-specific labels', () => {
    assert.match(C4_FLOWCHART_RULE, /stadium 短名/);
    assert.match(C4_FLOWCHART_RULE, /禁止 <small> 路径/);
    assert.match(C4_FLOWCHART_RULE, /HTTP 进出/);
    assert.match(C4_FLOWCHART_RULE, /代码调用/);
  });
});

describe('FLOWCHART_VISUAL_RULE', () => {
  it('is a prompt contract, not an orch copy', () => {
    assert.match(FLOWCHART_VISUAL_RULE, /classDef/);
    assert.match(FLOWCHART_VISUAL_RULE, /subgraph/);
    assert.match(FLOWCHART_VISUAL_RULE, /禁止编造/);
    assert.match(FLOWCHART_VISUAL_RULE, /不要上完整编排状态机/);
  });

  it('requires stadium closeup sub2 with local-startup scene labels', () => {
    assert.match(FLOWCHART_VISUAL_RULE, /stadium/);
    assert.match(FLOWCHART_VISUAL_RULE, /禁止 <small> 路径/);
    assert.match(FLOWCHART_VISUAL_RULE, /本地启动/);
  });
});

describe('applyShallowCritique', () => {
  it('skips revise when critic says ok', async () => {
    const calls = [];
    const r = await applyShallowCritique({
      file: 'deployment-ops.md',
      md: SAMPLE,
      spec: 'flowchart',
      chatFn: async (messages) => {
        calls.push(messages[0].content);
        return JSON.stringify({ verdict: 'ok', issues: [] });
      },
      chatOpts: {},
      sanitize: (s) => s,
      lint: () => ({ issues: [] }),
      log: () => {}
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /浅批判/);
    assert.equal(r.revised, false);
    assert.equal(r.critiqued, true);
    assert.equal(r.md, SAMPLE);
  });

  it('applies one revise when critic says revise', async () => {
    const r = await applyShallowCritique({
      file: 'deployment-ops.md',
      md: SAMPLE,
      spec: 'flowchart',
      chatFn: async (messages) => {
        if (/浅批判/.test(messages[0].content)) {
          return JSON.stringify({
            verdict: 'revise',
            issues: [{ kind: 'visual', issue: '缺 classDef', fix: '按层上色' }]
          });
        }
        return RICHER;
      },
      chatOpts: {},
      sanitize: (s) => s,
      lint: () => ({ issues: [] }),
      log: () => {}
    });
    assert.equal(r.revised, true);
    assert.match(r.md, /classDef/);
  });

  it('keeps original when revise worsens lint', async () => {
    const r = await applyShallowCritique({
      file: 'deployment-ops.md',
      md: SAMPLE,
      spec: 'flowchart',
      chatFn: async (messages) => {
        if (/浅批判/.test(messages[0].content)) {
          return JSON.stringify({
            verdict: 'revise',
            issues: [{ kind: 'visual', issue: '缺分层', fix: '加 subgraph' }]
          });
        }
        return '## x\n\n```mermaid\nflowchart TB\n```\n';
      },
      chatOpts: {},
      sanitize: (s) => s,
      lint: (md) => ({ issues: md.includes('classDef') || md.includes('Flask') ? [] : ['bad'] }),
      log: () => {}
    });
    assert.equal(r.revised, false);
    assert.equal(r.md, SAMPLE);
  });
});
