'use strict';

/**
 * Optional LLM generate via DeepSeek (OpenAI-compatible API).
 *
 * Env:
 *   DEEPSEEK_API_KEY   required
 *   DEEPSEEK_BASE_URL  default https://api.deepseek.com
 *   DEEPSEEK_MODEL     default deepseek-chat
 *
 * Usage:
 *   DEEPSEEK_API_KEY=sk-... node lib/llm-generate.js /path/to/repo
 *   DEEPSEEK_API_KEY=sk-... node lib/llm-generate.js /path/to/repo --only block-diagram.md
 *
 * Writes only the 6 diagram .md files under the kit dir. Does not touch HTML/config.
 */

const fs = require('fs');
const path = require('path');
const { scan } = require('./scan');
const { findKitDir, initKit, writeGenerated, productRoot } = require('./init');
const { validateDir } = require('./validate');
const { DIAGRAM_FILES } = require('./kit');
const { buildTree, lintDiagram } = require('./orch/lib');
const { FLOWCHART_VISUAL_RULE, HUMAN_STYLE_RULE, C4_FLOWCHART_RULE, C4_HUMAN_RULE, applyShallowCritique } = require('./refine-polish');
const { sanitizeFlowchartMarkdown } = require('./flowchart-sanitize');

const { chat: llmChat } = require('./llm-client');
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

function parseArgs(argv) {
  const out = { _: [], only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') out.only = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

function buildInventoryDigest(inv) {
  return JSON.stringify(
    {
      title: inv.title,
      folder: inv.folder,
      languages: inv.languages,
      entrypoints: inv.entrypoints,
      modules: inv.modules,
      services: inv.services,
      artifacts: inv.artifacts,
      deploy: inv.deploy,
      classes: (inv.classes || []).slice(0, 20),
      packages: (inv.packages || []).slice(0, 15)
    },
    null,
    2
  );
}

/** Per-view drawing contract. Block has its own orch/agent pipeline; these 5 share this map. */
const VIEW_SPEC = {
  'c4-context.md': [
    'mermaid 头必须是 flowchart（用 Block 分层卡片语法表达 C4 系统上下文），不要用 C4Context 原生方言。推荐 2 张子图：谁在用系统、跑起来靠谁。',
    'C4 语义边界：只画「外部角色 → 本系统（一张卡片）→ 一等外部依赖」；禁止画系统内部模块（路由/服务/仓储是 container/component 的内容）。',
    '子图1：角色用 stadium（id(["👤 中文名…"])）在 subgraph 外，指向本系统高亮卡片 id["🧩 系统名<br/><small>技术 · 入口路径</small>"]；角色用真实身份（开发者/调用方），禁止「用户角色A」。',
    '子图2：本系统 → 主框架（虚线 -.->，灰卡）+ 主存储（圆柱，青色）；外部依赖只留一等公民，禁止 Werkzeug/Jinja2 等间接依赖清单。',
    '禁止 desc/占位（unknown、服务A）。',
    C4_FLOWCHART_RULE,
    C4_HUMAN_RULE
  ].join('\n'),
  'c4-container.md': [
    'mermaid 头必须是 flowchart（Block 视觉语法表达 C4 容器视图），不要用 C4Container 原生方言。推荐 2 张子图：进程怎么分层、一次 HTTP 请求怎么进出。',
    'C4 语义：一个 subgraph 系统边界，内含运行时容器卡片（入口/路由/服务/仓储，<small> 写技术 + 真实文件路径）；数据库用圆柱画在边界外。',
    '外部角色（Person）用 stadium 且画在 subgraph 外；没有 compose/微服务就画单体进程 + 本地 SQLite，禁止编造集群。',
    '子图1 边方向跟源码：入口 → 路由 → 服务 → 仓储 → 库；标签中文动宾（注册蓝图/调用业务/读写待办/执行 SQL）。',
    '子图2 是 HTTP 进出主链路特写：节点一律 stadium 短名、禁止 <small> 路径；边标签用发起 HTTP/转发业务/落库 SQL 等，禁止与 component/deploy 共用同一套措辞。',
    C4_FLOWCHART_RULE,
    C4_HUMAN_RULE
  ].join('\n'),
  'c4-component.md': [
    'mermaid 头必须是 flowchart（Block 视觉语法表达 C4 组件视图），不要用 C4Component 原生方言。推荐 2 张子图：组件怎么分工、一次请求的代码调用。',
    'C4 语义：用扁平分层 subgraph 画代码级组件（入口层 / 接口业务层 / 数据层，一个 subgraph 一层；禁止 subgraph 嵌套——跨嵌套簇的边会被 mermaid 吞掉），每张卡 <small> 写真实文件路径；组件图包含数据模型卡，不画运行时数据库。',
    '组件来自模块目录、类、入口文件（源码摘录里看得到）；卡片名用中文业务名（Flask 应用入口/待办路由蓝图），禁止纯英文文件名当标题。',
    '子图1 边用真实调用语义中文标签（注册蓝图/调用业务/读写待办/映射模型），禁止臆造组件、禁止英文方法签名塞边标签。',
    '子图2 是代码调用主链路特写：节点一律 stadium 短名、禁止 <small> 路径；可从应用入口起链到 Todo 模型；边标签用注册蓝图/调用服务/映射模型，禁止与 container HTTP 链双胞胎。',
    C4_FLOWCHART_RULE,
    C4_HUMAN_RULE
  ].join('\n'),
  'class-diagram.md': [
    'mermaid 头必须是 classDiagram。',
    HUMAN_STYLE_RULE,
    '类名与文件来自扫描 classes + 源码摘录；方法/字段必须能在摘录里对上，禁止臆造 Entity 后缀或假方法。',
    '方法带可见性（+/-/#）和返回类型；关系标签用中文动宾（注册蓝图/读写仓储），禁止 uses/registers。',
    '每个关键类加 note for ClassName "真实路径"。',
    '上色用 style ClassName fill:#...,stroke:#...,stroke-width:2px（classDef 在 classDiagram 不生效）。',
    '色板：模型/仓储 "#e0f7fa" stroke #00838f、服务 "#ede7f6" stroke #5e35b1、路由 "#bbdefb" stroke #1565c0、入口 "#fce4ec" stroke #ad1457。',
    '推荐 2 子图：领域结构（TB）+ 调用主链路（LR）；direction TB/LR；禁止整图单色。'
  ].join('\n'),
  'deployment-ops.md': [
    'mermaid 头必须是 flowchart（TB 或 LR）。推荐 2 张子图：本地怎么启动、本地启动怎么串起来。',
    HUMAN_STYLE_RULE,
    '只画仓库里真实存在的交付物：Dockerfile / compose / github-actions / 本地 flask run。',
    '没有 k8s/CI 就画本地进程+数据文件，禁止编造集群、Ingress、Prometheus。',
    '节点 <small> 或标签里的路径必须在文件树中（仅子图1；子图2 stadium 特写禁止写路径）。',
    '子图2 是本地启动主链路特写：stadium 短名、无路径；边标签用本地启动/进入运行时/注册蓝图；ops→运行时用虚线 -.->；禁止与 container「HTTP 进出」措辞双胞胎。',
    FLOWCHART_VISUAL_RULE
  ].join('\n')
};

function viewSpecFor(file) {
  return VIEW_SPEC[file] || '遵守 AGENT.md；节点与路径必须来自扫描摘要和文件树。';
}

function clipText(text, maxChars) {
  const s = String(text || '');
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + `\n…（另 ${s.length - maxChars} 字符已省略）`;
}

function clipTree(treeText, maxLines) {
  const lines = String(treeText || '').split('\n');
  const cap = maxLines || 180;
  if (lines.length <= cap) return lines.join('\n');
  return lines.slice(0, cap).join('\n') + `\n…（另 ${lines.length - cap} 条路径已省略）`;
}

function formatExcerpts(excerpts) {
  return (excerpts || [])
    .map((e) => '### ' + e.path + '\n' + e.content)
    .join('\n\n');
}

/**
 * File tree + source excerpts for the 5 non-block views.
 * Reuses orch gatherExcerpts, then fills gaps with entrypoints / module files / classes.
 */
function gatherViewExcerpts(root, inv, tree, capChars) {
  const { gatherExcerpts } = require('./orch/lib');
  const cap = capChars || 50000;
  const seen = new Set();
  const out = [];
  let total = 0;
  const push = (rel, content, fileCap) => {
    if (!rel || seen.has(rel) || total > cap) return;
    let text = content;
    if (text == null) {
      const abs = path.join(root, rel);
      try {
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return;
        text = fs.readFileSync(abs, 'utf8');
      } catch {
        return;
      }
    }
    const c = text.length > fileCap ? text.slice(0, fileCap) + '\n…(截断)' : text;
    seen.add(rel);
    out.push({ path: rel, content: c });
    total += c.length + rel.length + 20;
  };
  const base = gatherExcerpts(root, tree, Math.min(cap, 35000));
  for (const e of base.excerpts || []) push(e.path, e.content, 8000);
  for (const e of inv.entrypoints || []) push(e, null, 3500);
  for (const a of (inv.artifacts || []).slice(0, 8)) {
    if (a && a.path) push(a.path, null, 2000);
    else if (a && a.file) push(a.file, null, 2000);
    else if (a && a.label && /\.(py|js|ts|go)$/.test(a.label)) push(a.label, null, 2000);
  }
  for (const m of inv.modules || []) {
    const label = m.label || m.id || '';
    for (const cand of [path.join(label, '__init__.py'), path.join(label, 'index.js'), path.join(label, 'index.ts')]) {
      push(cand, null, 1800);
    }
  }
  for (const c of (inv.classes || []).slice(0, 12)) {
    if (c && c.file) push(c.file, null, 2500);
  }
  return { excerpts: out, totalChars: total };
}

function buildRefineContext(root, inv) {
  const tree = buildTree(root);
  const gathered = gatherViewExcerpts(root, inv, tree, 50000);
  return {
    tree,
    treeText: clipTree(tree.treeText, 180),
    excerpts: gathered.excerpts,
    excerptText: clipText(formatExcerpts(gathered.excerpts), 45000)
  };
}

function restSystemPrompt(file, agentMd) {
  return [
    `你是架构图生成器，本轮只生成 ${file}。只输出 JSON，不要解释。`,
    '画得像人手绘的业务架构图（对标 block-diagram 的扫读感），不要像自动生成的 UML 清单。',
    '节点、路径、技术名必须来自扫描摘要 / 文件树 / 源码摘录，禁止臆造。',
    viewSpecFor(file),
    '禁止模板占位或页脚（「*模板文件 · 请替换*」、[你的项目名称]、用户角色A、服务A、unknown）。',
    '成品必须可直接提交：含 ## 子图标题与 mermaid 围栏。',
    '',
    agentMd
  ].join('\n');
}

function restUserPrompt(file, inv, ctx) {
  return [
    `根据仓库扫描摘要、文件树与源码摘录，生成 ${file} 的完整 Markdown。`,
    `输出严格 JSON：{"${file}": "完整 markdown"}`,
    '',
    '本视图规范：',
    viewSpecFor(file),
    '',
    '仓库扫描摘要：',
    buildInventoryDigest(inv),
    '',
    '文件树（路径必须逐字引用，禁止臆造）：',
    (ctx && ctx.treeText) || '',
    '',
    '源码与编排摘录：',
    (ctx && ctx.excerptText) || '（无摘录）'
  ].join('\n');
}

const PLACEHOLDER_LINE =
  /\*?模板文件\s*[·•]\s*请替换[^\n]*\n?/g;
const PLACEHOLDER_ANY =
  /\[你的项目名称\]|用户角色A|服务A|外部系统A|职责描述|模板文件\s*[·•]\s*请替换/;

/** Strip kit template footers the model often copies into finished diagrams. */
function sanitizeDiagramMd(md) {
  if (!md || typeof md !== 'string') return md;
  let text = md.replace(PLACEHOLDER_LINE, '');

  // Trim trailing JSON cruft (" } , etc.) that leaked past the last ``` fence.
  // Mermaid breaks on stray quotes/braces after the closing fence.
  const lastFence = text.lastIndexOf('```');
  if (lastFence !== -1) {
    const afterFence = text.slice(lastFence + 3);
    // Keep only footnote lines (starting with * or ---); drop JSON remnants.
    const kept = afterFence
      .split('\n')
      .filter((l) => /^\s*$|^\s*\*|^\s*---/.test(l))
      .map((l) => (/^\s*\*/.test(l) ? l.replace(/["}\s,]+$/u, '') : l))
      .join('\n');
    text = text.slice(0, lastFence + 3) + kept;
  }

  // Drop a leftover " glued to the last footnote line
  text = text.replace(/"+\s*$/u, '');
  text = text.replace(/\s+$/u, '\n');
  if (!text.endsWith('\n')) text += '\n';
  // flowchart 致命语法：嵌套 subgraph / 圆柱空格 / 边标签 ()[]{} —— 写盘前硬清洗
  text = sanitizeFlowchartMarkdown(text);
  return text;
}

function stillHasPlaceholder(md) {
  return PLACEHOLDER_ANY.test(md || '');
}

function systemPrompt(agentMd) {
  return [
    '你是架构图生成器。只输出 Markdown 文件内容，不要解释。',
    '必须遵守下列 AGENT 规范，尤其是 block-diagram 的彩色分层 flowchart 视觉规范。',
    '节点要用真实扫描到的模块/服务/文件名，禁止臆造。',
    'block-diagram.md 必须用 flowchart + 彩色 subgraph，节点格式：图标 + 中文名 + <br/><small>文件或技术</small>。',
    'flowchart/C4 图边的两端节点必须先声明形状再连线（禁止裸 id 端点）。',
    '禁止输出任何模板占位或页脚，例如「*模板文件 · 请替换为你项目的实际内容*」、[你的项目名称]、用户角色A、服务A。',
    '每个文件必须是可直接提交的成品图，不是 Init 模板。',
    '',
    agentMd
  ].join('\n');
}

function userPrompt(inv, files, ctx) {
  if (Array.isArray(files) && files.length === 1 && ctx) {
    return restUserPrompt(files[0], inv, ctx);
  }
  return [
    '根据下列仓库扫描摘要，生成这些文件的完整 Markdown 内容：',
    files.join(', '),
    '',
    '请用 JSON 对象返回，key 为文件名，value 为完整 md 文本（含 ## 标题与 mermaid 围栏）。',
    '不要包在 ```json 里，直接输出可 JSON.parse 的对象。',
    '',
    '仓库扫描摘要：',
    buildInventoryDigest(inv),
    ctx && ctx.treeText ? '\n文件树：\n' + ctx.treeText : '',
    ctx && ctx.excerptText ? '\n源码摘录：\n' + ctx.excerptText : ''
  ].filter(Boolean).join('\n');
}

function takeFileMd(raw, file) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const obj = extractJson(raw);
    if (typeof obj[file] === 'string' && obj[file].includes('```mermaid')) return obj[file];
    const first = Object.values(obj).find((v) => typeof v === 'string' && v.includes('```mermaid'));
    if (first) return first;
  } catch { /* fall through */ }
  if (raw.includes('```mermaid')) return raw;
  return null;
}

/**
 * Refine the 5 non-block views one file at a time with a dedicated spec +
 * file tree / source excerpts (same evidence depth as block's rich context).
 * chatFn injectable for tests.
 */
async function refineRestViews(rest, opts) {
  const { inv, ctx, agentMd, tree, chatOpts } = opts;
  const chatFn = opts.chatFn || chat;
  const out = {};
  const gateReport = {};
  for (const f of rest) {
    console.log('精修 ' + f + '…');
    let md = null;
    try {
      const raw = await chatFn(
        [
          { role: 'system', content: restSystemPrompt(f, agentMd) },
          { role: 'user', content: restUserPrompt(f, inv, ctx) }
        ],
        Object.assign({ json: true }, chatOpts)
      );
      md = takeFileMd(raw, f);
    } catch (e) {
      console.log('  ' + f + ' 首轮失败：' + (e.message || e));
    }
    if (!md) {
      console.log('  缺图重试：' + f);
      try {
        const raw2 = await chatFn(
          [
            { role: 'system', content: restSystemPrompt(f, agentMd) },
            {
              role: 'user',
              content: restUserPrompt(f, inv, ctx) + '\n\n上一轮未产出有效 mermaid。必须生成 ' + f + '，禁止模板占位页脚。'
            }
          ],
          Object.assign({ json: true }, chatOpts)
        );
        md = takeFileMd(raw2, f);
      } catch (e) {
        console.log('  缺图重试失败：' + (e.message || e));
      }
    }
    if (!md) continue;
    out[f] = sanitizeDiagramMd(md);
    if (stillHasPlaceholder(out[f])) out[f] = sanitizeDiagramMd(out[f]);
    const lint = lintDiagram(out[f], f, tree);
    gateReport[f] = { issues: lint.issues.length, metrics: lint.metrics, repaired: false };
    if (lint.issues.length === 0) continue;
    console.log(`  ${f} → 闸门发现 ${lint.issues.length} 个问题，修复中…`);
    lint.issues.slice(0, 8).forEach((s) => console.log('    · ' + s));
    try {
      const fixed = await chatFn(
        [
          {
            role: 'system',
            content: '你是架构图修复器。只输出修正后的完整 Markdown 内容，不要解释、不要 JSON。禁止模板占位页脚。'
          },
          { role: 'user', content: repairPrompt(f, out[f], lint.issues.slice(0, 12), inv, ctx) }
        ],
        Object.assign({ json: false }, chatOpts)
      );
      const fixedMd = sanitizeDiagramMd(fixed && fixed.includes('```mermaid') ? fixed : '');
      if (fixedMd) {
        const fixedLint = lintDiagram(fixedMd, f, tree);
        if (fixedLint.issues.length < lint.issues.length) {
          out[f] = fixedMd;
          gateReport[f] = {
            issues: fixedLint.issues.length,
            metrics: fixedLint.metrics,
            repaired: true,
            remaining: fixedLint.issues
          };
          console.log(`    ✓ 修复后剩余 ${fixedLint.issues.length} 个问题`);
        } else {
          console.log(`    · 修复未改善（仍 ${fixedLint.issues.length} 个），保留原稿`);
        }
      }
    } catch (e) {
      console.log(`    · 修复请求失败：${e.message}`);
    }
    const polished = await applyShallowCritique({
      file: f,
      md: out[f],
      spec: viewSpecFor(f),
      chatFn,
      chatOpts,
      sanitize: sanitizeDiagramMd,
      lint: lintDiagram,
      tree,
      digest: buildInventoryDigest(inv),
      treeText: ctx && ctx.treeText
    });
    out[f] = polished.md;
    gateReport[f] = Object.assign(gateReport[f] || {}, {
      critiqued: !!polished.critiqued,
      revised: !!polished.revised
    });
  }
  return { files: out, gateReport };
}

// 修复提示：把闸门报错反馈给 LLM，要求逐文件修正
function repairPrompt(fileName, original, issues, inv, ctx) {
  return [
    `你之前生成的 ${fileName} 未通过结构闸门，存在以下问题：`,
    issues.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    '',
    '规则：',
    '- 关系边的两端节点必须先声明（flowchart 用 id[形状] 且禁止裸 id，classDiagram 用 class，原生 C4 用 Person/System/Container/Component）',
    '- 节点描述中引用的文件/目录路径必须在仓库中真实存在，禁止臆造',
    '- 每个节点至少有一条关系边连接（孤立节点删除或补边）',
    '- 节点数须在合理范围（每子图 ≥3，classDiagram ≥2）',
    '- mermaid 头类型：c4-context/c4-container/c4-component/deployment-ops 用 flowchart（Block 视觉语法，c4-* 用卡片图表达 C4 语义），class-diagram 用 classDiagram',
    '- 禁止嵌套 subgraph（外层 APP 再套 L_* 会 Syntax error）；圆柱必须写成 id[("标签")]，禁止 id[( "标签" )] 括号内空格',
    '- 边标签禁止 ()[]{}',
    '',
    '本视图规范：',
    viewSpecFor(fileName),
    '',
    '仓库扫描摘要（真实模块/文件，只能引用这些）：',
    buildInventoryDigest(inv),
    ctx && ctx.treeText ? '\n文件树：\n' + ctx.treeText : '',
    '',
    '以下是你之前生成的内容，请输出修正后的完整 md 文本（含 ## 标题与 mermaid 围栏，不要 JSON，不要解释）：',
    '-----8<-----',
    original,
    '-----8<-----'
  ].filter(Boolean).join('\n');
}

async function chat(messages, chatOpts) {
  return llmChat(messages, {
    apiKey: chatOpts && chatOpts.apiKey,
    json: !chatOpts || chatOpts.json !== false,
    scene: 'generate',
    temperature: 0.2,
    model: MODEL
  });
}

function extractJson(content) {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('无法解析模型返回的 JSON');
    return JSON.parse(m[0]);
  }
}

/**
 * 精修 block-diagram.md 的执行与降级 seam：
 *   route.pipeline='agent' → 先试读仓画图（Agent + 路径闸门 + 扫尾）；
 *   agent 抛 AGENT_UNAVAILABLE（无 dsh 运行时 / 无 Key / 产物无效）→ 降级编排，不静默变骨架；
 *   agent 抛其他错误（bug）→ 向上抛，不静默吞；
 *   route.pipeline='orch' → 直接编排。
 * deps 可注入（测试用）：{ agent, orch }，均为 async (root, opts) => { md }。
 * @returns {Promise<{md: string, via: 'agent'|'orch'}>}
 */
async function refineBlockWithFallback(root, options, route, deps) {
  const d = deps || {};
  const agentGen = d.agent || (async (r, o) => {
    const { generateBlockAgent } = require('./orch/agent-block');
    return generateBlockAgent(r, o);
  });
  const orchGen = d.orch || (async (r, o) => {
    const { generateBlockAuto } = require('./orch/block-gen');
    return generateBlockAuto(r, o);
  });
  if (route && route.pipeline === 'agent') {
    try {
      const block = await agentGen(root, { apiKey: options.apiKey });
      if (block && block.md) return { md: block.md, via: 'agent' };
    } catch (e) {
      if (e && e.code === 'AGENT_UNAVAILABLE') {
        console.error('[refine] 读仓画图不可用（' + (e.message || '未知原因') + '），改走编排精修。');
        console.log('精修改走编排通路…');
      } else {
        throw e;  // 非降级类错误不静默吞，暴露给上层
      }
    }
  }
  const block = await orchGen(root, { apiKey: options.apiKey });
  return { md: block.md, via: 'orch' };
}

async function llmGenerate(repoRoot, opts) {
  const options = Object.assign({ only: null }, opts);
  const root = path.resolve(repoRoot);
  let kitDir;
  if (options.kitDir) {
    kitDir = path.resolve(options.kitDir);
    fs.mkdirSync(kitDir, { recursive: true });
  } else {
    kitDir = findKitDir(root);
    if (!kitDir) kitDir = initKit(root, options.dir).dest;
  }

  const agentMd = fs.readFileSync(path.join(productRoot(), 'AGENT.md'), 'utf8');
  const inv = scan(root);
  const onlyList = Array.isArray(options.only)
    ? options.only.filter((f) => DIAGRAM_FILES.includes(f))
    : (options.only ? [options.only] : null);
  const files = onlyList && onlyList.length
    ? onlyList
    : DIAGRAM_FILES.slice();
  const chatOpts = { apiKey: options.apiKey };

  const out = {};
  if (files.includes('block-diagram.md')) {
    const { inspectShape, chooseRefinePipeline } = require('./refine-route');
    let route = { pipeline: 'orch', reason: 'default', shape: 'web', confidence: 'low' };
    try { route = chooseRefinePipeline(inspectShape(root)); } catch { /* 形态识别失败走编排 */ }
    console.log('精修 block-diagram.md（约 30–150 秒）…');
    const block = await refineBlockWithFallback(root, options, route);
    route.resolvedVia = block.via;  // 决策（route.pipeline）与实际执行管线（via）都回传
    out['block-diagram.md'] = block.md.endsWith('\n') ? block.md : block.md + '\n';
    options._refineRoute = route;
  }

  const rest = files.filter((f) => f !== 'block-diagram.md');
  const tree = buildTree(root);
  const gateReport = {};
  if (rest.length) {
    const ctx = buildRefineContext(root, inv);
    const restResult = await refineRestViews(rest, {
      inv,
      ctx,
      agentMd,
      tree,
      chatOpts,
      chatFn: options.chatFn || chat
    });
    Object.assign(out, restResult.files);
    Object.assign(gateReport, restResult.gateReport);
  }
  if (!Object.keys(out).length) {
    throw new Error('模型未返回有效 mermaid 文件。');
  }
  for (const f of Object.keys(out)) {
    out[f] = sanitizeDiagramMd(out[f]);
    if (stillHasPlaceholder(out[f])) {
      throw new Error(f + ' 精修后仍含模板占位符，请重试 --refine。');
    }
  }

  // Keep non-generated diagrams if --only
  if (options.only) {
    for (const f of DIAGRAM_FILES) {
      if (out[f]) continue;
      const p = path.join(kitDir, f);
      if (fs.existsSync(p)) out[f] = fs.readFileSync(p, 'utf8');
    }
  }

  const written = writeGenerated(kitDir, out);
  const protocol = validateDir(kitDir, { requireFilled: false });
  return { kitDir, inventory: inv, written, protocol, model: MODEL, gateReport, refineRoute: options._refineRoute || null };
}

async function main(argv) {
  const args = parseArgs(argv);
  const repo = args._[0] || process.cwd();
  console.log('LLM generate via', MODEL, '→', path.resolve(repo));
  const result = await llmGenerate(repo, { only: args.only });
  console.log('Wrote:', result.written.join(', '));
  console.log('Kit:', result.kitDir);
  // 闸门结果汇总
  const gate = result.gateReport || {};
  for (const [f, r] of Object.entries(gate)) {
    const tag = r.repaired ? '修复' : (r.issues === 0 ? '通过' : '告警');
    console.log(`  闸门 ${f}: ${tag}（${r.metrics.节点数}节点/${r.metrics.边数}边${r.issues ? `，${r.issues}问题` : ''}）`);
  }
  if (result.protocol.errors.length) {
    console.warn('Validate warnings/errors:');
    result.protocol.errors.forEach((e) => console.warn(' ERROR', e));
    result.protocol.warnings.forEach((w) => console.warn(' WARN', w));
  } else {
    console.log('Protocol OK (basic)');
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = {
  llmGenerate,
  refineBlockWithFallback,
  sanitizeDiagramMd,
  stillHasPlaceholder,
  buildInventoryDigest,
  buildRefineContext,
  viewSpecFor,
  restSystemPrompt,
  restUserPrompt,
  refineRestViews,
  takeFileMd,
  FLOWCHART_VISUAL_RULE,
  HUMAN_STYLE_RULE,
  C4_FLOWCHART_RULE,
  C4_HUMAN_RULE
};
