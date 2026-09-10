'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeDiagramMd, stillHasPlaceholder, viewSpecFor } = require('../lib/llm-generate');

describe('sanitizeDiagramMd', () => {
  it('strips template footer while keeping mermaid', () => {
    const raw = [
      '## 子图1：系统全景',
      '',
      '```mermaid',
      'C4Context',
      '  Person(user, "用户", "开发者")',
      '  System(sys, "Axios", "HTTP 客户端")',
      '  Rel(user, sys, "使用")',
      '```',
      '',
      '*模板文件 · 请替换为你项目的实际内容*',
      ''
    ].join('\n');
    const clean = sanitizeDiagramMd(raw);
    assert.equal(stillHasPlaceholder(clean), false);
    assert.match(clean, /```mermaid/);
    assert.match(clean, /C4Context/);
    assert.ok(clean.endsWith('\n'));
  });

  it('strips a quote glued onto the footnote line itself', () => {
    const raw = [
      '```mermaid',
      'flowchart TB',
      '  A-->B',
      '```',
      '',
      '*由 Architecture Viewer 编排流水线生成 · 已过事实核查*"'
    ].join('\n');
    const clean = sanitizeDiagramMd(raw);
    assert.match(clean, /已过事实核查/);
    assert.ok(!/"/.test(clean.replace(/```[\s\S]*```/, '')), 'no leftover quote outside mermaid');
  });

  it('strips trailing JSON closing cruft after the last fence (block-diagram regression)', () => {
    // LLM/orch JSON envelope leaked past the closing fence: stray quote + brace.
    // Browser mermaid fails on these; CLI lint could not see them.
    const raw = [
      '# Block Diagram',
      '',
      '```mermaid',
      'flowchart TB',
      '    A["入口"] --> B["路由"]',
      '```',
      '',
      '---',
      '*由 Architecture Viewer 编排流水线生成 · 已过事实核查*',
      '"',
      '}'
    ].join('\n');
    const clean = sanitizeDiagramMd(raw);
    assert.ok(!clean.endsWith('"\n}'), 'JSON cruft must be removed');
    assert.ok(!/"\s*\}\s*$/.test(clean), 'no trailing quote/brace envelope');
    // Legitimate footnote survives
    assert.match(clean, /已过事实核查/);
    // Mermaid body untouched
    assert.match(clean, /flowchart TB/);
    assert.match(clean, /A\["入口"\] --> B\["路由"\]/);
    assert.ok(clean.endsWith('\n'));
  });

  it('keeps footnote lines but drops comma/brace JSON remnants after fence', () => {
    const raw = '```mermaid\nflowchart LR\n  A-->B\n```\n,\n  "files": []\n}\n*正常页脚*\n';
    const clean = sanitizeDiagramMd(raw);
    assert.match(clean, /\*正常页脚\*/);
    assert.ok(!clean.includes('"files"'), 'JSON key line must be dropped');
    assert.ok(!/[{},]\s*$/.test(clean.trim().slice(-3)), 'no JSON punctuation at tail');
  });

  it('never touches mermaid content between fences (multiple subgraphs)', () => {
    const body = [
      '## 子图1',
      '',
      '```mermaid',
      'C4Context',
      '    Person(a, "甲", "角色")',
      '    Rel(a, b, "访问")',
      '```',
      '',
      '## 子图2',
      '',
      '```mermaid',
      'C4Context',
      '    System_Ext(x, "X", "外部")',
      '```'
    ].join('\n');
    const clean = sanitizeDiagramMd(body);
    // Both fences and both bodies intact
    assert.equal((clean.match(/```mermaid/g) || []).length, 2);
    assert.match(clean, /Person\(a/);
    assert.match(clean, /System_Ext\(x/);
    assert.match(clean, /## 子图2/);
  });

  it('handles non-string / empty input gracefully', () => {
    assert.equal(sanitizeDiagramMd(null), null);
    assert.equal(sanitizeDiagramMd(undefined), undefined);
    const out = sanitizeDiagramMd('plain text no fence');
    assert.equal(typeof out, 'string');
    assert.ok(out.endsWith('\n'));
  });
});

describe('viewSpecFor C4 drawing rules (flowchart cards expressing C4 semantics)', () => {
  it('c4 specs mandate flowchart + subgraph boundary and ban native C4 dialect', () => {
    for (const f of ['c4-context.md', 'c4-container.md', 'c4-component.md']) {
      const spec = viewSpecFor(f);
      assert.match(spec, /头必须是 flowchart/, f + ' mandates flowchart header');
      assert.match(spec, /subgraph/, f + ' uses subgraph boundary');
      assert.match(spec, /不要用 C4(Context|Container|Component) 原生方言/, f + ' bans native C4 dialect');
    }
  });

  it('all three C4 specs mandate classDef layer colors', () => {
    for (const f of ['c4-context.md', 'c4-container.md', 'c4-component.md']) {
      const spec = viewSpecFor(f);
      assert.match(spec, /classDef \+ class/, f + ' requires classDef coloring');
      assert.match(spec, /#ede7f6/, f + ' defines business color');
      assert.match(spec, /#e0f7fa/, f + ' defines data color');
      assert.match(spec, /禁止整图无 classDef|禁止单色/, f + ' forbids monochrome');
    }
  });

  it('c4 specs document stadium actors + card node signatures', () => {
    const context = viewSpecFor('c4-context.md');
    const component = viewSpecFor('c4-component.md');
    assert.match(context, /stadium/, 'context uses stadium actors');
    assert.match(component, /id\["图标 中文名<br\/><small>真实文件路径或技术<\/small>"\]/, 'component documents card signature');
  });

  it('c4-container and c4-component specs ban nested subgraph', () => {
    for (const f of ['c4-container.md', 'c4-component.md']) {
      const spec = viewSpecFor(f);
      assert.match(spec, /禁止 subgraph 嵌套|禁止嵌套/, f + ' bans nested subgraph');
    }
  });

  it('c4-container spec uses stadium for external Person', () => {
    const spec = viewSpecFor('c4-container.md');
    assert.match(spec, /stadium/);
  });

  it('c4-container/component/deploy sub2 specs split HTTP vs code vs local-startup', () => {
    assert.match(viewSpecFor('c4-container.md'), /HTTP 进出|发起 HTTP/);
    assert.match(viewSpecFor('c4-container.md'), /stadium 短名/);
    assert.match(viewSpecFor('c4-component.md'), /代码调用/);
    assert.match(viewSpecFor('c4-component.md'), /stadium 短名/);
    assert.match(viewSpecFor('deployment-ops.md'), /本地启动/);
    assert.match(viewSpecFor('deployment-ops.md'), /stadium/);
  });

  it('deployment-ops spec reuses Block flowchart visual grammar', () => {
    const spec = viewSpecFor('deployment-ops.md');
    assert.match(spec, /classDef/);
    assert.match(spec, /#ede7f6/);
    assert.match(spec, /#e0f7fa/);
    assert.match(spec, /<small>/);
    assert.match(spec, /禁止编造/);
    assert.match(spec, /人手绘/);
  });

  it('all five rest-view specs carry human Block-like voice', () => {
    for (const f of [
      'c4-context.md',
      'c4-container.md',
      'c4-component.md',
      'class-diagram.md',
      'deployment-ops.md'
    ]) {
      const spec = viewSpecFor(f);
      assert.match(spec, /人手绘|动宾|双胞胎|中文业务名/, f);
    }
    assert.match(viewSpecFor('c4-component.md'), /不是文件名|禁止纯英文文件名/);
    assert.match(viewSpecFor('c4-container.md'), /stadium/);
    assert.match(viewSpecFor('class-diagram.md'), /note for/);
  });
});
