'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeDiagramMd, stillHasPlaceholder } = require('../lib/llm-generate');

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
});
