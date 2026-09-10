'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  flattenNestedSubgraphs,
  sanitizeCylinderDecls,
  sanitizeFlowchartMarkdown
} = require('../lib/flowchart-sanitize');
const { sanitizeDiagramMd } = require('../lib/llm-generate');
const { parseFlowchart } = require('../lib/orch/lib');

const BROKEN_CONTAINER = `## 谁在查看舆情数据

\`\`\`mermaid
flowchart TB
    user(["👤 运维人员"])
    subgraph APP["🧩 舆情监控系统"]
        direction TB
        subgraph L_web["🖥️ 前端页面"]
            direction LR
            dashboard["📊 仪表盘"]
        end
        subgraph L_api["🔌 接口"]
            direction LR
            server["🚀 入口"]
        end
    end
    db[( "🗄️ 告警库<br/><small>alerts.db</small>" )]
    user -->|查看| dashboard
    dashboard -->|请求| server
    server -->|读写| db
\`\`\`
`;

describe('flowchart-sanitize 根治 Mermaid Syntax error', () => {
  it('flattenNestedSubgraphs 拆掉 APP 套 L_*', () => {
    const code = `flowchart TB
    subgraph APP["x"]
        subgraph L_web["w"]
            a["A"]
        end
        subgraph L_api["a"]
            b["B"]
        end
    end
    a --> b`;
    const flat = flattenNestedSubgraphs(code);
    assert.equal(parseFlowchart(flat).nested, 0);
    assert.match(flat, /subgraph L_web/);
    assert.match(flat, /subgraph L_api/);
    assert.doesNotMatch(flat, /subgraph APP/);
  });

  it('sanitizeCylinderDecls 去掉 [( "..." )] 空格', () => {
    assert.equal(
      sanitizeCylinderDecls('db[( "🗄️ 告警库<br/><small>alerts.db</small>" )]'),
      'db[("🗄️ 告警库<br/><small>alerts.db</small>")]'
    );
  });

  it('舆情 Container 翻车样例：嵌套+圆柱空格 → sanitizeDiagramMd 后可过 nested=0', () => {
    const cleaned = sanitizeDiagramMd(BROKEN_CONTAINER);
    assert.match(cleaned, /```mermaid/);
    assert.doesNotMatch(cleaned, /subgraph APP/);
    assert.doesNotMatch(cleaned, /\[\(\s+"/);
    assert.match(cleaned, /db\[\("🗄️/);
    const body = cleaned.match(/```mermaid\s*\n([\s\S]*?)```/)[1];
    assert.equal(parseFlowchart(body).nested, 0);
  });

  it('sanitizeFlowchartMarkdown 不改 classDiagram', () => {
    const md = '```mermaid\nclassDiagram\n  class Foo\n```\n';
    assert.equal(sanitizeFlowchartMarkdown(md), md);
  });
});
