'use strict';

/**
 * Shallow polish for the 5 non-block refine views.
 * Reuses Block flowchart visual grammar as a prompt contract (not the orch state machine).
 */

const FLOWCHART_VISUAL_RULE = [
  '复用 block-diagram 的 flowchart 视觉语法（不要上完整编排状态机）：',
  '1. 每层一个 subgraph L_xxx["图标 中文层名"]，层内 direction LR；空层不画。',
  '2. 节点：id["图标 中文名<br/><small>真实路径或技术</small>"]；存储用圆柱 id[("🗄️ 名<br/><small>path</small>")]；外部角色用 stadium id(["👤 名<br/><small>(外部)</small>"]) 且写在 subgraph 外。',
  '3. 必须 classDef + class 上色：api #ede7f6、storage #e0f7fa、ops #c8e6c9、actor #eceff1；禁止整图无 classDef。',
  '4. 边必须有 ≤8 字中文动宾标签（启动/注册蓝图/读写数据）；ops 与运行时之间用虚线 -.->。',
  '5. 禁止编造 Docker/k8s/Ingress/Prometheus；没有就画本地进程+数据文件。',
  '6. 子图2 必须是「主链路」特写：flowchart LR；节点一律 stadium id(["图标 短中文名"])，禁止 <small> 路径与矩形卡；6–8 节点。',
  '7. 场景标签要和本视图分工：deployment 用本地启动链（本地启动/进入运行时/注册蓝图）；禁止把子图1 原样缩写，也禁止与 container/component 共用同一套「发起请求→调用业务→读写待办」措辞。'
].join('\n');

/** Shared “hand-drawn architecture” voice — borrowed from block, dialect-safe. */
const HUMAN_STYLE_RULE = [
  '成片目标：像人手绘的业务架构图，不要像自动生成的 UML/清单。',
  '命名：中文业务名优先（含本系统特有对象，如「待办」），禁止裸「处理器/服务层/数据模型/API 路由层」。',
  '边标签：≤8 个汉字动宾短语（注册蓝图/读写待办/本地调试）；禁止「使用」「协作」「调用」单字；禁止把英文方法签名塞进标签；边标签严禁 ()[]{}（mermaid 会当成形状语法导致整图 Syntax error，如「实时推送(SSE/WS)」应写「实时推送 SSE」）。',
  '两张子图必须视角互补（全景 vs 主链路 / 角色 vs 外部依赖），禁止双胞胎只改措辞。',
  '## 标题用叙事短句（如「谁在用系统」「请求怎么落到库」），禁止空泛「子图1：内部容器」。'
].join('\n');

/**
 * C4 三视图（context/container/component）精修视觉契约：
 * 用 flowchart（Block 视觉语法）表达 C4 抽象层级，不用 C4Context 等原生方言
 * （原生方言盒形固定、带 <<stereotype>> 标签，观感是 UML 清单而非手绘业务图）。
 */
const C4_FLOWCHART_RULE = [
  '本图必须用 flowchart 表达 C4 语义（对标 Block 手绘分层卡片质感），不要用 C4Context/C4Container/C4Component 原生方言：',
  '1. 外部角色一律 stadium：id(["👤 中文名<br/><small>角色说明</small>"])，且写在所有 subgraph 之外。',
  '2. 本系统/容器/组件用矩形卡片：id["图标 中文名<br/><small>真实文件路径或技术</small>"]；数据库/存储用圆柱 id[("🗄️ 名<br/><small>路径</small>")]。',
  '3. 边界与分层用扁平 sibling subgraph（禁止嵌套）：要么只画一层边界 subgraph APP["…"]，要么只画多层 L_web / L_api / L_data（彼此同级）；禁止 APP 里再套 L_*（mermaid 会 Syntax error 或吞边）。层内写 direction LR。c4-context 不需要 subgraph（系统就是一张卡片，禁止画内部模块）。',
  '4. 必须 classDef + class 分层上色：外部角色/外部系统 #eceff1、业务卡片 #ede7f6、存储/模型 #e0f7fa；禁止整图无 classDef、禁止单色。',
  '5. 边必须有 ≤8 字中文动宾标签；对框架等间接依赖用虚线 -.->；<small> 中路径必须逐字来自文件树，禁止臆造。',
  '6. 两张子图视角互补：子图1 完整结构（矩形/圆柱卡片 + <small> 路径）；子图2 主链路特写（flowchart LR，节点一律 stadium 短名、禁止 <small> 路径）。',
  '7. 场景标签要分工：container 用 HTTP 进出（发起 HTTP/转发业务/落库 SQL）；component 用代码调用（注册蓝图/调用服务/映射模型，可从应用入口起链、不画运行时 DB）；禁止三视图子图2 双胞胎。'
].join('\n');

const C4_HUMAN_RULE = [
  HUMAN_STYLE_RULE,
  'C4 命名：卡片显示名用中文业务名（Flask 应用入口/待办路由蓝图/待办业务服务），禁止纯英文文件名当卡片标题；文件路径只放 <small>。',
  '边标签是中文动宾短语（注册蓝图/读写待办/挂载框架），禁止 register_blueprint/list_todos 等方法签名塞进边标签。',
  '外部依赖只留一等公民（主框架 + 主存储），禁止 Werkzeug/Jinja2 等间接依赖清单化。'
].join('\n');

function parseJsonLoose(raw) {
  const trimmed = String(raw || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

function parseCritique(raw) {
  const obj = parseJsonLoose(raw);
  if (!obj || typeof obj !== 'object') return { verdict: 'ok', issues: [] };
  const issues = Array.isArray(obj.issues)
    ? obj.issues
      .filter((i) => i && typeof i.issue === 'string' && i.issue.trim())
      .slice(0, 6)
      .map((i) => ({
        kind: String(i.kind || 'visual'),
        issue: String(i.issue).trim(),
        fix: String(i.fix || '').trim()
      }))
    : [];
  const verdict = obj.verdict === 'revise' && issues.length ? 'revise' : 'ok';
  return { verdict, issues };
}

function critiqueSystemPrompt() {
  return [
    '你是架构图浅批判器。只输出 JSON，不要解释。',
    '一轮即可。禁止要求编造仓库里没有的基础设施（Docker/k8s/集群）。',
    '路径必须仍来自当前稿或文件树。'
  ].join('\n');
}

function critiqueDialectRule(file) {
  const name = String(file || '');
  if (name === 'deployment-ops.md') {
    return [
      '本图是 flowchart：应检查 classDef、双行 <small>、分层 subgraph、中文动宾边；子图2 必须是 stadium 主链路特写（短名、无路径），场景为本地启动链。',
      '机器感红线：英文方法堆在边标签、无图标、无 classDef、子图2 仍带 <small>/矩形卡、与 container 共用「请求落到库」措辞。'
    ].join('');
  }
  if (/^c4-/.test(name)) {
    return [
      '本图是 flowchart（用 Block 视觉语法表达 C4 语义）：检查 classDef 分层上色、stadium 外部角色、圆柱存储、subgraph 系统边界（context 图除外）、<small> 真实路径、虚线外部依赖、中文动宾边；子图2 必须是 stadium 短名特写（禁止路径）。',
      '机器感红线：无 classDef 单色、无图标、英文文件名当卡片标题、register_blueprint 等方法签名塞边标签、子图2 仍是矩形卡缩写、三视图主链路双胞胎、仍在用 C4Context/C4Container/C4Component 原生方言（应改写为 flowchart 卡片图）。'
    ].join('');
  }
  if (name === 'class-diagram.md') {
    return [
      '本图是 classDiagram：禁止改成 flowchart；禁止 classDef/subgraph（上色用 style ClassName fill:...）。',
      '机器感红线：关系标签英文 uses/registers、类名臆造 Entity 后缀、无 style 上色、方法与源码不符。'
    ].join('');
  }
  return '只按本视图 mermaid 方言提意见，禁止跨方言套用。';
}

function critiqueUserPrompt(file, md, spec) {
  return [
    `审阅 ${file} 成片质量。输出严格 JSON：`,
    '{"verdict":"ok|revise","issues":[{"kind":"density|label|isolate|visual|story|machine","issue":"...","fix":"..."}]}',
    '最多 6 条。优先抓「机器感」：模板腔命名、英文边标签、双胞胎子图、清单化依赖、缺分层配色。',
    '其次才是节点过少、孤立节点。',
    critiqueDialectRule(file),
    'verdict=ok 表示可提交；有上述问题才 revise。',
    '',
    '本视图规范：',
    spec || '',
    '',
    '当前稿：',
    md
  ].join('\n');
}

function reviseAfterCritiquePrompt(file, md, issues, spec, digest, treeText) {
  return [
    `根据浅批判修订 ${file}。只输出修正后的完整 Markdown（含 ## 标题与 mermaid 围栏），不要 JSON、不要解释。`,
    '禁止模板占位页脚。禁止编造文件树里没有的路径或 Docker/集群。',
    critiqueDialectRule(file),
    '',
    '问题清单：',
    issues.map((i, n) => `${n + 1}. [${i.kind}] ${i.issue}${i.fix ? ' → ' + i.fix : ''}`).join('\n'),
    '',
    '本视图规范：',
    spec || '',
    digest ? '\n仓库扫描摘要：\n' + digest : '',
    treeText ? '\n文件树：\n' + treeText : '',
    '',
    '当前稿：',
    '-----8<-----',
    md,
    '-----8<-----'
  ].filter(Boolean).join('\n');
}

/**
 * One critic pass + at most one revise. Does not copy the orch state machine.
 */
async function applyShallowCritique(opts) {
  const {
    file, md, spec, chatFn, chatOpts, sanitize, lint, tree, digest, treeText
  } = opts;
  const log = opts.log || console.log;
  if (!md || typeof chatFn !== 'function') {
    return { md, critiqued: false, revised: false };
  }
  let raw;
  try {
    raw = await chatFn(
      [
        { role: 'system', content: critiqueSystemPrompt() },
        { role: 'user', content: critiqueUserPrompt(file, md, spec) }
      ],
      Object.assign({}, chatOpts, { json: true })
    );
  } catch (e) {
    log(`  ${file} → 浅批判失败：${e.message || e}`);
    return { md, critiqued: false, revised: false };
  }
  const verdict = parseCritique(raw);
  if (verdict.verdict !== 'revise') {
    log(`  ${file} → 浅批判通过`);
    return { md, critiqued: true, revised: false, issues: verdict.issues };
  }
  log(`  ${file} → 浅批判 ${verdict.issues.length} 条，修订中…`);
  verdict.issues.slice(0, 4).forEach((i) => log('    · ' + i.issue));
  try {
    const fixed = await chatFn(
      [
        {
          role: 'system',
          content: '你是架构图修订器。只输出修正后的完整 Markdown，不要解释、不要 JSON。禁止模板占位页脚。'
        },
        {
          role: 'user',
          content: reviseAfterCritiquePrompt(file, md, verdict.issues, spec, digest, treeText)
        }
      ],
      Object.assign({}, chatOpts, { json: false })
    );
    const next = sanitize && fixed ? sanitize(fixed.includes('```mermaid') ? fixed : '') : '';
    if (!next) return { md, critiqued: true, revised: false, issues: verdict.issues };
    if (typeof lint === 'function') {
      const before = lint(md, file, tree);
      const after = lint(next, file, tree);
      if (after.issues.length > before.issues.length) {
        log(`    · 修订后闸门问题增多（${before.issues.length}→${after.issues.length}），保留原稿`);
        return { md, critiqued: true, revised: false, issues: verdict.issues };
      }
    }
    log('    ✓ 浅批判修订已采纳');
    return { md: next, critiqued: true, revised: true, issues: verdict.issues };
  } catch (e) {
    log(`    · 浅批判修订失败：${e.message || e}`);
    return { md, critiqued: true, revised: false, issues: verdict.issues };
  }
}

module.exports = {
  FLOWCHART_VISUAL_RULE,
  HUMAN_STYLE_RULE,
  C4_FLOWCHART_RULE,
  C4_HUMAN_RULE,
  parseCritique,
  critiqueSystemPrompt,
  critiqueDialectRule,
  critiqueUserPrompt,
  reviseAfterCritiquePrompt,
  applyShallowCritique
};
