'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { lintDiagram, lintBlockDiagram, parseFlowchart } = require('../lib/orch/lib');

// 构造一个最小但全连通的 flowchart（3 节点 2 边，满足 c4 节点下限且无孤儿）
function flowBlock(header, body) {
  return `## 子图1：x

\`\`\`mermaid
${header}
${body}
\`\`\`
`;
}

const FLOW_BODY = `    user(["👤 终端用户"])
    entry["🐍 应用入口<br/><small>app/main.py</small>"]
    routes["🔌 待办路由<br/><small>app/routes/todos.py</small>"]
    user -->|发起请求| entry
    entry -->|注册蓝图| routes`;

const TREE = {
  all: new Set([
    'app',
    'app/main.py',
    'app/routes',
    'app/routes/todos.py',
    'app/services',
    'app/services/todo_service.py',
    'app/database',
    'app/database/todo_repo.py'
  ]),
  dirs: new Set(['app', 'app/routes', 'app/services', 'app/database']),
  files: new Set([
    'app/main.py',
    'app/routes/todos.py',
    'app/services/todo_service.py',
    'app/database/todo_repo.py'
  ])
};

const headerIssues = (r) => r.issues.filter((i) => /头类型错误/.test(i));
const nestedIssues = (r) => r.issues.filter((i) => /嵌套 subgraph/.test(i));
const pathIssues = (r) => r.issues.filter((i) => /路径在仓库中不存在|路径在仓库|在仓库中不存在/.test(i));

describe('lintDiagram mermaid 头类型闸门（c4-* 接受 flowchart）', () => {
  it('c4 三视图用 flowchart 头：不报头类型错误', () => {
    for (const f of ['c4-context.md', 'c4-container.md', 'c4-component.md']) {
      const r = lintDiagram(flowBlock('flowchart TB', FLOW_BODY), f, TREE);
      assert.deepEqual(headerIssues(r), [], f + ' should accept flowchart header');
    }
  });

  it('c4 三视图用原生 C4 方言头：仍合法（骨架生成路径）', () => {
    const native = flowBlock(
      'C4Container',
      `    Person(user, "用户")
    Container(entry, "入口", "python", "app/main.py")
    Container(routes, "路由", "python", "app/routes/todos.py")
    Rel(user, entry, "发起请求")
    Rel(entry, routes, "注册蓝图")`
    );
    const r = lintDiagram(native, 'c4-container.md', TREE);
    assert.deepEqual(headerIssues(r), [], 'native C4Container still accepted');
  });

  it('c4 视图用错误头（classDiagram/sequenceDiagram）：报头类型错误', () => {
    const wrong = flowBlock('classDiagram', '    class A { }');
    for (const f of ['c4-context.md', 'c4-container.md', 'c4-component.md']) {
      const r = lintDiagram(wrong, f, TREE);
      assert.equal(headerIssues(r).length, 1, f + ' should reject classDiagram header');
    }
  });

  it('class-diagram.md 只接受 classDiagram 头', () => {
    const okMd = flowBlock('classDiagram', '    class A {\n        +run()\n    }\n    class B {\n        +go()\n    }\n    A --> B : 调用');
    assert.deepEqual(headerIssues(lintDiagram(okMd, 'class-diagram.md', TREE)), []);
    const bad = lintDiagram(flowBlock('flowchart TB', FLOW_BODY), 'class-diagram.md', TREE);
    assert.equal(headerIssues(bad).length, 1, 'class view must reject flowchart');
  });

  it('deployment-ops.md 只接受 flowchart，拒绝 C4 方言头', () => {
    assert.deepEqual(headerIssues(lintDiagram(flowBlock('flowchart TB', FLOW_BODY), 'deployment-ops.md', TREE)), []);
    const native = flowBlock(
      'C4Context',
      `    Person(user, "用户")
    System(sys, "系统")
    Rel(user, sys, "ok")`
    );
    assert.equal(headerIssues(lintDiagram(native, 'deployment-ops.md', TREE)).length, 1);
  });
});

describe('lintDiagram 嵌套 subgraph 闸门（mermaid 静默吞边兜底）', () => {
  it('parseFlowchart：扁平 subgraph nested=0', () => {
    const code = `flowchart TB
    subgraph L_a["层 A"]
        direction LR
        A["🐍 入口"]
    end
    subgraph L_b["层 B"]
        direction LR
        B["🔌 路由"]
    end
    A -->|注册蓝图| B`;
    assert.equal(parseFlowchart(code).nested, 0);
  });

  it('parseFlowchart：嵌套 subgraph nested 计数（2 个内层）', () => {
    const code = `flowchart TB
    subgraph APP["应用"]
        subgraph L_a["入口层"]
            A["🐍 入口"]
        end
        subgraph L_b["接口层"]
            B["🔌 路由"]
        end
    end
    A -->|注册蓝图| B`;
    assert.equal(parseFlowchart(code).nested, 2);
  });

  it('lintDiagram：c4-component 嵌套 subgraph 报闸门错误', () => {
    const md = flowBlock('flowchart TB', `    subgraph APP["🧩 Flask 应用"]
        subgraph L_entry["🚪 入口层"]
            main_app["🐍 应用入口<br/><small>app/main.py</small>"]
        end
        subgraph L_api["🔌 接口层"]
            routes["🔌 待办路由<br/><small>app/routes/todos.py</small>"]
        end
    end
    main_app -->|注册蓝图| routes`);
    const r = lintDiagram(md, 'c4-component.md', TREE);
    assert.equal(nestedIssues(r).length, 1);
    assert.match(nestedIssues(r)[0], /2 处嵌套/);
    assert.match(nestedIssues(r)[0], /扁平分层/);
  });

  it('lintBlockDiagram：嵌套 subgraph 同样报错（Block 门同一失败模式）', () => {
    const md = flowBlock('flowchart TB', `    subgraph L_api["⚙️ 后端"]
        subgraph L_inner["内层"]
            A["🧩 应用<br/><small>app/main.py</small>"]
        end
        B["🔌 路由<br/><small>app/routes/todos.py</small>"]
    end
    A -->|注册蓝图| B`);
    const r = lintBlockDiagram(md, TREE);
    assert.ok(r.issues.some((i) => /嵌套 subgraph/.test(i)), 'block gate must flag nesting');
  });

  it('demo 成片 c4-component.md / c4-container.md 无嵌套（集成回归）', () => {
    const dir = path.join(__dirname, '..', 'examples', 'tutorial-demo', 'architecture_viewer');
    for (const f of ['c4-component.md', 'c4-container.md', 'c4-context.md', 'deployment-ops.md']) {
      const md = fs.readFileSync(path.join(dir, f), 'utf8');
      const r = lintDiagram(md, f, TREE);
      assert.deepEqual(nestedIssues(r), [], f + ' demo must stay flat');
    }
  });
});

describe('flowchart 边标签 mermaid 形状保留字符 ()[]{}', () => {
  const { sanitizeMermaidEdgeLabel, findUnsafeMermaidEdgeLabels } = require('../lib/orch/lib');
  const { deterministicSweep } = require('../lib/orch/run');

  it('sanitizeMermaidEdgeLabel 把括号换成空格并压缩', () => {
    assert.equal(sanitizeMermaidEdgeLabel('实时推送(SSE/WS)'), '实时推送 SSE/WS');
    assert.equal(sanitizeMermaidEdgeLabel('读[缓存]'), '读 缓存');
    assert.equal(findUnsafeMermaidEdgeLabels('A -->|实时推送(SSE/WS)| B').length, 1);
    assert.equal(findUnsafeMermaidEdgeLabels('A -->|实时推送 SSE| B').length, 0);
  });

  it('lintBlockDiagram 拒绝含 () 的边标签', () => {
    const md = `## 子图1

\`\`\`mermaid
flowchart TB
    user(["👤 用户"])
    api["🔌 API"]
    push["📡 推送"]
    db[("🗄️ 库")]
    cache[("🗄️ 缓存")]
    worker["⚙️ 工人"]
    user -->|发起请求| api
    api -->|实时推送(SSE/WS)| push
    api -->|读写| db
    api -->|读缓存| cache
    worker -->|投递| push
\`\`\`
`;
    const r = lintBlockDiagram(md, TREE);
    assert.ok(r.issues.some((i) => /边标签含 mermaid 形状保留字符/.test(i) && /SSE\/WS/.test(i)),
      'must flag paren edge label');
  });

  it('lintDiagram 对 deployment-ops flowchart 同样拒绝', () => {
    const body = `    user(["👤 用户"])
    entry["🐍 入口<br/><small>app/main.py</small>"]
    routes["🔌 路由<br/><small>app/routes/todos.py</small>"]
    user -->|启动(本地)| entry
    entry -->|注册蓝图| routes`;
    const r = lintDiagram(flowBlock('flowchart TB', body), 'deployment-ops.md', TREE);
    assert.ok(r.issues.some((i) => /边标签含 mermaid 形状保留字符/.test(i)),
      'deploy flowchart must flag unsafe edge labels');
  });

  it('deterministicSweep 清洗边标签括号', () => {
    const md = `## 子图1

\`\`\`mermaid
flowchart TB
    user(["👤 用户"])
    api["🔌 API"]
    push["📡 推送"]
    user -->|实时推送(SSE/WS)| push
    api -->|读写| push
\`\`\`
`;
    const swept = deterministicSweep(md, [], []);
    assert.ok(!/实时推送\(SSE\/WS\)/.test(swept.md), 'parens must be stripped');
    assert.ok(/实时推送 SSE\/WS/.test(swept.md), 'cleaned label must remain');
    assert.ok((swept.actions || []).some((a) => /边标签去掉 mermaid 形状保留字符/.test(a)));
  });
});

describe('lintDiagram 路径核查（c4 flowchart <small> 与原生 C4 描述参数）', () => {
  it('flowchart <small> 真实路径：不报幻觉路径', () => {
    const r = lintDiagram(flowBlock('flowchart TB', FLOW_BODY), 'c4-container.md', TREE);
    assert.deepEqual(pathIssues(r), []);
  });

  it('flowchart <small> 幻觉路径：报「在仓库中不存在」', () => {
    const body = `    user(["👤 终端用户"])
    entry["🐍 应用入口<br/><small>app/fake/nonexistent.py</small>"]
    routes["🔌 待办路由<br/><small>app/routes/todos.py</small>"]
    user -->|发起请求| entry
    entry -->|注册蓝图| routes`;
    const r = lintDiagram(flowBlock('flowchart TB', body), 'c4-component.md', TREE);
    assert.ok(pathIssues(r).some((i) => /app\/fake\/nonexistent\.py/.test(i)),
      'hallucinated <small> path must be flagged');
  });

  it('原生 C4 Component 第 4 参数幻觉路径：报路径错误', () => {
    const native = flowBlock(
      'C4Component',
      `    Component(entry, "入口", "python", "app/main.py")
    Component(ghost, "幽灵模块", "python", "app/ghost/module.py")
    Rel(entry, ghost, "调用")`
    );
    const r = lintDiagram(native, 'c4-component.md', TREE);
    assert.ok(pathIssues(r).some((i) => /app\/ghost\/module\.py/.test(i)),
      'C4 description path must also be checked');
    assert.ok(!pathIssues(r).some((i) => /app\/main\.py/.test(i)),
      'real path must not be flagged');
  });
});
