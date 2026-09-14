'use strict';

const path = require('path');
const { snake } = require('./scan');
const { blockDiagramMarkdown, renderLayeredFlowchart } = require('./layers');

function q(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\r\n]/g, ' ').slice(0, 120);
}

const DRAFT = '> 静态草稿 / static draft：仅展示扫描到的源码、导入/继承及用户配置；分层为启发式，不代表运行时调用、部署或数据流。扫描有界，缺失关系不代表不存在；需人工审阅。\n';

function document(title, sections) {
  return `# ${title}\n\n${DRAFT}\n` + sections.map(([heading, body], i) =>
    `## 子图${i + 1}：${heading}\n\n\`\`\`mermaid\n${body}\n\`\`\`\n`).join('\n');
}

function empty(message) {
  return `flowchart TB\n  scan_note["扫描说明：${q(message)}"]`;
}

function fileLanguage(file) {
  return ({
    py: 'python', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', go: 'go', java: 'java', rs: 'rust',
    html: 'html', vue: 'vue', svelte: 'svelte'
  })[path.extname(file).slice(1)] || 'unknown';
}

function moduleContainers(inv) {
  const byId = new Map();
  const add = (node) => { if (!byId.has(node.id)) byId.set(node.id, node); };
  (inv.modules || []).forEach((m) => add({
    id: m.id, label: m.label, tech: (m.languages || []).join(', ') || 'unknown',
    desc: m.path || m.label
  }));
  (inv.services || []).forEach((s) => add({ id: s.id, label: s.label, tech: 'compose', desc: s.source }));
  (inv.entrypoints || []).forEach((e) => add({
    id: snake(e.replace(/\.[^.]+$/, '')), label: e, tech: fileLanguage(e), desc: '入口候选文件'
  }));
  return [...byId.values()];
}

function nodeId(id) {
  const normalized = snake(id);
  return /^[a-z_]/.test(normalized) ? normalized : 'node_' + normalized;
}

function relations(inv, nodes) {
  const ids = new Map(nodes.map((n) => [n.id, nodeId(n.id)]));
  return (inv.relationships || []).filter((e) =>
    ['import', 'extends', 'implements'].includes(e.type) && e.file &&
    ids.has(e.from) && ids.has(e.to))
    .map((e) => `    Rel(${ids.get(e.from)}, ${ids.get(e.to)}, "${e.type}", "${q(e.file)}${e.line ? ':' + e.line : ''}")`)
    .join('\n');
}

function c4Modules(inv, component) {
  const boxes = moduleContainers(inv);
  const dialect = component ? 'C4Component' : 'C4Container';
  const kind = component ? 'Component' : 'Container';
  const boundary = component ? 'Container_Boundary' : 'System_Boundary';
  if (!boxes.length) return empty('未发现可展示的模块');
  return `${dialect}
    ${boundary}(_repository_boundary, "${q(inv.title || inv.folder)}") {
${boxes.map((c) => `        ${kind}(${nodeId(c.id)}, "${q(c.label)}", "${q(c.tech)}", "${q(c.desc)}")`).join('\n')}
    }
${relations(inv, boxes)}
    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")`;
}

function classBody(inv, component) {
  const classes = inv.classes || [];
  if (!classes.length) return empty('未发现可解析的类型；未创建占位类');
  const ids = new Map(classes.map((c, i) => [c.id, `type_${i}`]));
  const edges = (inv.classRelationships || []).filter((e) =>
    ['extends', 'implements'].includes(e.type) && e.file && ids.has(e.from) && ids.has(e.to));
  if (component) {
    return `C4Component
${classes.map((c, i) => `    Component(type_${i}, "${q(c.name)}", "${q(c.language || fileLanguage(c.file || ''))}", "${q(c.file)}")`).join('\n')}
${edges.map((e) => `    Rel(${ids.get(e.from)}, ${ids.get(e.to)}, "${e.type}", "${q(e.file)}")`).join('\n')}
    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")`;
  }
  return `classDiagram
${classes.map((c, i) => `  class type_${i}["${q(c.name)}"]\n  note for type_${i} "${q(c.file)}"`).join('\n')}
${edges.map((e) => `  ${ids.get(e.to)} ${e.type === 'implements' ? '<|..' : '<|--'} ${ids.get(e.from)} : ${e.type}`).join('\n')}`;
}

function deployment(inv) {
  // File/service presence is not evidence of a launch sequence or runtime topology.
  const operational = (inv.modules || []).filter((m) =>
    m.operational || ['ops', 'schedule', 'monitor'].includes(m.layer || m.kind));
  const operationalIds = new Set(operational.map((m) => m.id));
  const inventory = {
    ...inv, root: '',
    modules: operational,
    artifacts: (inv.artifacts || []).filter((a) => ['ops', 'schedule', 'monitor'].includes(a.layer)),
    relationships: (inv.relationships || []).filter((e) =>
      operationalIds.has(e.from) && operationalIds.has(e.to))
  };
  return document('Deploy & Ops — 部署运维', [
    ['交付文件与运维源码（非运行拓扑）', renderLayeredFlowchart(inventory, { override: {} })]
  ]);
}

function generateFiles(inv) {
  const context = `C4Context
    System(repo_system, "${q(inv.title || inv.folder)}", "${q((inv.languages || []).join(', ') || 'unknown')}")
    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")`;
  return {
    'c4-context.md': document('C4 Context — 系统全景', [['仓库边界（使用者与外部系统未推断）', context]]),
    'c4-container.md': document('C4 Container — 容器视图', [['源码模块（不等同于进程）', c4Modules(inv, false)]]),
    'c4-component.md': document('C4 Component — 组件详情', [
      ['模块静态依赖', c4Modules(inv, true)], ['源码类型', classBody(inv, true)]
    ]),
    'block-diagram.md': blockDiagramMarkdown(inv),
    'class-diagram.md': document('Class Diagram — 代码结构', [['源码类型与继承', classBody(inv, false)]]),
    'deployment-ops.md': deployment(inv)
  };
}

module.exports = { generateFiles };
