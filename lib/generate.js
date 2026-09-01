'use strict';

const { snake } = require('./scan');
const { blockDiagramMarkdown } = require('./layers');

function q(s) {
  return String(s || '').replace(/"/g, "'").replace(/\n/g, ' ').slice(0, 48);
}

function footer() {
  return '\n---\n\n*由 Architecture Viewer Community Generate 根据仓库扫描生成 · 请人工审阅后提交*\n';
}

function pick(arr, n) {
  return arr.slice(0, n);
}

function ensureSystem(inv) {
  return {
    id: snake(inv.folder) || 'system',
    title: q(inv.title || inv.folder)
  };
}

function moduleContainers(inv) {
  const sys = ensureSystem(inv);
  const byId = new Map();
  function add(c) {
    if (!c || !c.id || byId.has(c.id)) return;
    byId.set(c.id, c);
  }
  inv.services.forEach((s) => add({ id: s.id, label: q(s.label), tech: 'compose', desc: s.source }));
  inv.entrypoints.slice(0, 4).forEach((e) => {
    add({ id: snake(e.replace(/\.[^.]+$/, '')), label: q(e), tech: pathExtTech(e), desc: 'entrypoint' });
  });
  inv.modules.forEach((m) => {
    add({
      id: m.id,
      label: q(m.label),
      tech: m.kind === 'frontend' ? 'UI' : m.kind === 'ops' ? 'Ops' : (inv.languages[0] || 'service'),
      desc: m.kind
    });
  });
  if (!byId.size) {
    add({ id: 'app_core', label: q(sys.title), tech: inv.languages[0] || 'app', desc: 'core' });
  }
  return pick([...byId.values()], 14);
}

function pathExtTech(f) {
  if (/\.py$/.test(f)) return 'Python';
  if (/\.html$/.test(f)) return 'HTML';
  if (/\.go$/.test(f)) return 'Go';
  if (/\.js$/.test(f)) return 'Node';
  return 'app';
}

// Infrastructure services that are genuinely "external" — not app code, not npm/pip deps
const INFRA_PATTERNS = [
  'postgres', 'mysql', 'mariadb', 'redis', 'mongo', 'mongodb', 'rabbitmq',
  'elasticsearch', 'kafka', 'zookeeper', 'consul', 'etcd', 'minio',
  'nginx', 'traefik', 'caddy', 'haproxy', 'varnish',
  'grafana', 'prometheus', 'influxdb', 'clickhouse', 'timescaledb',
  'nats', 'nacos', 'vault', 'keycloak', 'supabase'
];

function inferExternalSystems(inv) {
  // From compose services: pick infra services that are NOT app modules
  const moduleIds = new Set(inv.modules.map((m) => m.id));
  const infra = inv.services
    .filter((s) => moduleIds.has(s.id) === false)
    .map((s) => s.id)
    .filter((id) => INFRA_PATTERNS.some((pat) => id.includes(pat)));
  const seen = new Set();
  const result = [];
  for (const id of infra) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({ id: 'ext_' + id, label: id });
    if (result.length >= 5) break;
  }
  return result;
}

function c4Context(inv) {
  const sys = ensureSystem(inv);
  const ext = inferExternalSystems(inv);
  const extFallback = ext.length ? ext : [];
  const lang = q(inv.languages.join(', ') || 'unknown');
  const rels = extFallback.map((e) => `    Rel(sys, ${e.id}, "依赖")`).join('\n');
  const extDecl = extFallback.map((e) => `    System_Ext(${e.id}, "${e.label}")`).join('\n');
  return `# C4 Context — 系统全景

## 子图1：系统与使用者

\`\`\`mermaid
C4Context
    title ${q(sys.title)} 系统全景

    Person(user, "使用者")
    System(sys, "${sys.title}", "${lang}")
${extDecl}

    Rel(user, sys, "使用")
${rels}

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
\`\`\`

## 子图2：运行时与交付面

\`\`\`mermaid
C4Context
    title 交付与入口

    Person(dev, "开发者")
    Person(ops, "运维")
    System(sys_deploy, "${sys.title}", "${q(inv.entrypoints.join(', ') || 'local app')}")
    System_Ext(vcs, "Git")
    System_Ext(ci, "${q(inv.deploy.join(', ') || 'local run')}")

    Rel(dev, sys_deploy, "开发")
    Rel(ops, sys_deploy, "部署/监控")
    Rel(dev, vcs, "提交")
    Rel(vcs, ci, "触发")
    Rel(ci, sys_deploy, "发布")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
\`\`\`
${footer()}`;
}

function c4Container(inv) {
  const sys = ensureSystem(inv);
  const boxes = moduleContainers(inv);
  const decls = boxes.map((c) => `        Container(${c.id}, "${c.label}", "${q(c.tech)}", "${q(c.desc)}")`).join('\n');
  const chain = [];
  for (let i = 0; i < boxes.length - 1 && chain.length < 10; i++) {
    chain.push(`    Rel(${boxes[i].id}, ${boxes[i + 1].id}, "协作")`);
  }
  chain.unshift('    Rel(user, ' + boxes[0].id + ', "访问")');
  const first = boxes[0].id;
  const last = boxes[boxes.length - 1].id;
  return `# C4 Container — 容器视图

## 子图1：内部容器布局

\`\`\`mermaid
C4Container
    title ${q(sys.title)} 容器地图

    Person(user, "使用者")

    System_Boundary(platform, "${sys.title}") {
${decls}
    }

    System_Ext(ext_dep, "外部依赖")

    Rel(user, ${first}, "访问")
    Rel(${last}, ext_dep, "调用")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
\`\`\`

## 子图2：协作数据流

\`\`\`mermaid
C4Container
    title 容器协作

    Person(user, "使用者")

    System_Boundary(platform, "${sys.title}") {
${decls}
    }

    System_Ext(ext_dep, "外部依赖")

${chain.join('\n')}
    Rel(${last}, ext_dep, "调用")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
\`\`\`
${footer()}`;
}

function c4Component(inv) {
  const boxes = pick(moduleContainers(inv), 6);
  if (boxes.length === 1) {
    boxes.push({ id: 'shared_lib', label: 'shared', tech: 'lib', desc: 'shared' });
  }
  const sys = ensureSystem(inv);
  const inner = boxes.map((c, i) => `        Component(c_${c.id}, "${c.label}", "${q(c.tech)}", "module ${i + 1}")`).join('\n');
  const rels = [];
  for (let i = 0; i < boxes.length - 1 && rels.length < 8; i++) {
    rels.push(`    Rel(c_${boxes[i].id}, c_${boxes[i + 1].id}, "依赖")`);
  }
  const classComps = pick(inv.classes, 6).map((c) => ({
    id: 'cls_' + snake(c.name),
    label: q(c.name)
  }));
  const cc = classComps.length ? classComps : [{ id: 'cls_core', label: 'Core' }];
  const classDecl = cc.map((c) => `        Component(${c.id}, "${c.label}", "class", "")`).join('\n');
  const classRels = ['    Rel(boundary_api, ' + cc[0].id + ', "调用")'];
  for (let i = 0; i < cc.length - 1; i++) {
    classRels.push(`    Rel(${cc[i].id}, ${cc[i + 1].id}, "协作")`);
  }
  return `# C4 Component — 组件详情

## 子图1：模块组件

\`\`\`mermaid
C4Component
    title ${q(sys.title)} 模块组件

    Container_Boundary(app, "${sys.title}") {
${inner}
    }

${rels.join('\n')}

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
\`\`\`

## 子图2：领域类组件

\`\`\`mermaid
C4Component
    title 领域类

    Container_Boundary(domain, "domain") {
        Component(boundary_api, "API/入口", "iface", "")
${classDecl}
    }

${classRels.join('\n')}

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
\`\`\`
${footer()}`;
}

function blockDiagram(inv) {
  return blockDiagramMarkdown(inv) + footer();
}

function classDiagram(inv) {
  const classes = pick(inv.classes, 10);
  const body = classes.length
    ? classes.map((c) => `  class ${c.name} {\n    +from ${q(c.file)}\n  }`).join('\n')
    : `  class ${pascal(inv.folder)}App {\n    +run()\n  }`;
  const links = [];
  for (let i = 0; i < classes.length - 1 && links.length < 8; i++) {
    links.push(`  ${classes[i].name} ..> ${classes[i + 1].name} : uses`);
  }
  const names = classes.length ? classes.map((c) => c.name) : [pascal(inv.folder) + 'App'];
  return `# Class Diagram — 代码结构

## 子图1：扫描到的类型

\`\`\`mermaid
classDiagram
${body}
${links.join('\n')}
\`\`\`

## 子图2：入口关系

\`\`\`mermaid
classDiagram
  class Entrypoint {
    +${q(inv.entrypoints[0] || 'main')}
  }
  class ${names[0]} {
    +domain
  }
  Entrypoint --> ${names[0]}
\`\`\`
${footer()}`;
}

function pascal(s) {
  return String(s || 'App').replace(/(^|[^a-zA-Z0-9]+)([a-zA-Z0-9])/g, (_, __, c) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, '') || 'App';
}

function deployment(inv) {
  const steps = inv.deploy.length ? inv.deploy : ['local-run'];
  const nodes = steps.map((s, i) => `  d${i}["${q(s)}"]`).join('\n');
  const arrows = steps.map((_, i) => i === 0 ? '  build --> d0' : `  d${i - 1} --> d${i}`).join('\n');
  return `# Deploy & Ops — 部署运维

## 子图1：交付路径

\`\`\`mermaid
flowchart LR
  build["构建 ${q(inv.languages.join(','))}"]
${nodes}
${arrows}
\`\`\`

## 子图2：运行时探测

\`\`\`mermaid
flowchart TB
  health["健康检查"] --> app["${q(inv.title)}"]
  app --> logs["logs"]
  app --> cfg["config"]
\`\`\`
${footer()}`;
}

function generateFiles(inv) {
  return {
    'c4-context.md': c4Context(inv),
    'c4-container.md': c4Container(inv),
    'c4-component.md': c4Component(inv),
    'block-diagram.md': blockDiagram(inv),
    'class-diagram.md': classDiagram(inv),
    'deployment-ops.md': deployment(inv)
  };
}

module.exports = { generateFiles };
