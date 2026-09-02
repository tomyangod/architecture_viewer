'use strict';

/**
 * LangGraph 式编排实验：把「用法1（Cursor Chat）」的隐式行为
 * （规划→路径求证→起草→事实核查→批判→修订→校验）显式做成状态机。
 *
 * 用法：
 *   DEEPSEEK_API_KEY=sk-... node lib/orch/run.js <repo> [variant] [outdir]
 *   variant（默认 auto）:
 *     auto   —— 默认。按 shape 置信度自动选引擎：高置信走 orch4，低置信/歧义走 orch8 降级
 *     orch4  —— 确定性编排（重要性取证 + 结构/视觉闸门 + 确定性扫尾）
 *     orch8  —— Agent 探索契约（explore.json）兜底形态，受故事约束后走 orch4 全流程
 *     orch3/orch2/orch/rich1/digest/nocritic —— 历史实验引擎
 *
 * 每步状态落盘 <outdir>/state.json（断点可查）；最终图 <outdir>/block-diagram.md
 */

const fs = require('fs');
const path = require('path');
const {
  chat, chatJson, chatBlock, extractJson, usage, maskKey,
  buildTree, gatherExcerpts, lintBlockDiagram, layerGate, parseMermaid, parseFlowchart,
  findAnchors, coverageGate, injectAnchors, rewritePlanLayers, repairPlan, semanticTraps,
  importanceForensics, findAnchorsV2, storyGate, anchorCompanions, snakeId
} = require('./lib');

const KNOWN_VARIANTS = new Set(['digest', 'rich1', 'orch', 'nocritic', 'orch2', 'orch3', 'orch4', 'orch8', 'auto', 'edge']);
// 参数自适应：`run.js <repo> <variant> <outdir>`；若第 3 参不是已知引擎名，
// 视为省略 variant（默认 auto），该参数按 outdir 处理。
const arg3 = process.argv[3];
const variantIsExplicit = arg3 && KNOWN_VARIANTS.has(arg3);
const repo = path.resolve(process.argv[2] || '.');
const variant = variantIsExplicit ? arg3 : 'auto';
const outdir = path.resolve((variantIsExplicit ? process.argv[4] : process.argv[3]) || './out');
fs.mkdirSync(outdir, { recursive: true });

const log = (...a) => console.log(`[${variant}]`, ...a);
const checkpoint = (state) => fs.writeFileSync(path.join(outdir, 'state.json'), JSON.stringify(state, null, 2));

// ---------- AGENT.md block-diagram 视觉规范（节录） ----------
const BLOCK_SPEC = `block-diagram.md 视觉规范（必须遵守）：
1. flowchart TB；每层一个 subgraph L_xxx["图标 中文层名"]，层内 direction LR；空层不画；可用 style L_xxx fill:#颜色88 给层加淡填充
2. 层语义顺序（有节点才出现）：frontend 前端/交互 → api 后端/API → schedule 调度/队列 → worker 采集/异步处理 → storage 数据存储 → monitor 监控/通知 → ops 交付/运维
3. 节点写法：id["🎯 中文名<br/><small>path/or/tech</small>"]；存储节点用圆柱 id[("🗄️ 中文名<br/><small>path</small>")]
4. 每层用 classDef 定义颜色并 class 分配（前端粉#fce4ec、API紫#ede7f6、调度橙#fff3e0、worker绿#e8f5e9、存储青#e0f7fa、监控黄#fffde7、ops绿#c8e6c9；外部角色灰#eceff1）
5. 箭头必须有中文语义标签：A -->|调用/读写/投递/触发/通知| B；边方向=真实运行时数据流方向；边标签 ≤8 个汉字，用动宾短语（如「拉取HTML」「投递任务」「有变更」「发通知」），禁止写整句话
6. 节点落到真实文件/服务名，禁止空框，禁止臆造路径；节点 id 用英文 snake_case，全图唯一；中文业务名贴业务（如「重检优先队列」而非「队列1」）。
   严禁裸角色名（「处理器」「数据模型」「API 路由层」「任务调度」「通知服务」这类放之四海皆准的模板名禁止单独使用）：中文名必须含该系统特有的业务对象（Watch 监控目标/订阅者/笔记/站点事件等，取自代码真实概念）或真实技术词（Playwright/Apprise/Prisma/Flask/Next.js/WebSocket/SMTP/ClickHouse 等）；
   好：「🌐 Playwright 网页抓取」「📣 Apprise 渠道投递」「📥 站点 Tracker 脚本」「📐 Watch 数据模型」「📐 数据访问层(queries)」；坏：「📐 处理器」「📦 数据模型」「🔌 API 路由层」；
   数据访问节点（queries/repository）命名体现既读也写，禁止只叫「查询执行器」
7. emoji 必须按节点业务语义逐个挑选，严禁全图滥用同一个 emoji。参考词表：进程入口⚙️、API/路由🔌📡、Flask/应用🧩、前端页面🖥️、静态资源🖼️、队列/调度📬⏱️、Worker池🏊、Worker/消费者📥、抓取/采集🌐📄🧭、处理/差异📐、存储/数据库🗄️💾、模型/包📦、通知服务🔔、渠道投递📣、实时推送⚡、外部用户👤、外部系统/网站🌍、邮件✉️、镜像/Compose🐳
8. 外部角色（用户/被监控网站/订阅者等）与外部系统（消息代理/源站/推送服务 FCM·APNs/SMTP 中继/外部数据库等）：一律声明在所有 subgraph 之外，用 stadium 形状 id(["👤 名称<br/><small>(外部)</small>"])，定义 classDef actor fill:#eceff1 并 class 分配；禁止把任何外部角色/外部系统放进层 subgraph（存储层内只放代码节点：db 包/models/migrations 等矩形节点与嵌入式存储圆柱）；嵌入式库（SQLite/Bolt/Badger 等进程内文件库）不画外部数据库节点；独立部署的外部 DB（MySQL/PostgreSQL）才画 stadium 且用虚线 -.-> 标注「可选」
9. ops 层节点（Dockerfile/compose/镜像/部署）与运行时节点之间一律用虚线 -.-> 表示构建/部署关系（如 image -.-> flask），禁止用实线 --> 连接 ops 与运行时节点
10. 机制层粒度（仅当文件树中真实存在对应路径时才拆分，禁止臆造）：队列可拆「任务队列/通知队列」；worker 可拆「Worker 池 → Worker → 抓取器」，多种抓取技术可分列（如 Playwright/Requests/Selenium）；通知机制若同时有发送服务文件（notification_service.py/messenger 等）与渠道目录（notification/、Apprise），必须画成「发送服务 → 渠道投递」两级
11. 同一对节点之间方向相同的边只允许一条，禁止重复边；边只画运行时真实数据流，禁止为凑密度乱连
12. 文件结构：# Block Diagram — 分层模块 + 一句引言（产品是干什么的）+ ## 子图1：分层全景（TB 全图 mermaid 块）+ ## 子图2：<核心动作>主链路（flowchart LR，6–8 个节点，用简短中文名串起默认主流程，节点可不写 path）；
   末尾保留：---  与一行  *由 Architecture Viewer 编排流水线生成 · 已过事实核查*
13. 边方向硬规则（违反即返工，逐条自查）：
   a. 外部角色（人）只允许连三类节点：① 前端（访问/操作/查看界面）；② API 集成端点（发布/上报/webhook/订阅主题等机器对机器动作）；③ CLI 节点（人在终端运行命令）。**禁止 外部角色 --> 进程入口**（main.go/app.py/server.js 这类）：进程由部署设施启动，人不在运行时「启动/调用」一个 main 进程
   b. 进程入口节点只出边、不进边：入口 -->|启动/挂载| API/服务 是唯一正确方向；指向入口的连线只允许 ops 虚线（Dockerfile -.-> 入口）
   c. 前端与后端之间：前端 -->|请求/查询/订阅| API；API --> 前端 的实线只允许实时推送（标签必须含「推送」，SSE/WebSocket 场景），禁止「提供界面/返回页面/渲染」类反向实线（界面是用户经浏览器加载的，不是后端推给前端的）
   d. CLI / 客户端 SDK 属系统的客户端侧：CLI/SDK -->|HTTP 请求/调用| API 服务端、CLI --> SDK（命令行借助 SDK）合法；禁止 API 服务端 --> CLI/SDK（服务端不会反向调用自己的客户端库）
   e. ops 节点（Dockerfile/compose/镜像）与运行时节点之间只能虚线 -.->，方向 ops -.-> 入口/服务（构建/部署）；禁止实线、禁止运行时节点指向 ops；没有真实部署关系可表达时，ops 节点宁可少画
   f. 实时通知形态（发布订阅/WebSocket/SSE/推送总线）：全景**必须**有一条 服务端/API -->|实时推送(SSE/WebSocket)| 前端或客户端 的边——这是 c 条豁免边的合法且必需用途，不得因怕方向错而漏掉实时推送主链路；推送对端（FCM/APNs/WebPush 服务、SMTP 中继）画外部系统 stadium
   g. 内部节点禁止断头：每个层内节点至少有一条边连到另一个层内节点；投递通道/执行器（邮件/推送/短信）必须有上游 API/服务 -->|调用/发送| 通道 的边，禁止通道只连外部系统；存储节点必须有 API/worker 的读写边；配套锚点清单里的每个路径都必须出现在图上且连边
   h. 通道/包职责以包内文件名判定，禁止望文生义：文件名含 sender/dispatcher/notifier/mailer = 出站投递（本服务 → 外部对端），归通知/推送层；含 server/listener/handler = 入站接收（外部 → 本服务 → 内部发布，如收信 SMTP 服务器、入站 webhook 服务），**归后端/API 层**（语义等同 API 入口，禁止放进通知/推送层），方向与出站相反；含 store/repository/sqlite = 存储层，不是通道（如 webpush/store.go 是推送订阅记录存储）`;

const state = {
  variant, repo, startedAt: new Date().toISOString(),
  tree: null, excerpts: null, plan: null, planRounds: 0,
  drafts: [], factchecks: [], critiques: [], md: null, lint: null
};

// ---------- 节点 1：取证（确定性） ----------
function nodeGather() {
  state.tree = buildTree(repo);
  const g = gatherExcerpts(repo, state.tree);
  state.excerpts = g.excerpts;
  log(`取证完成：文件树 ${state.tree.all.size} 条路径，摘录 ${g.excerpts.length} 段 / ${g.totalChars} 字符`);
  checkpoint(state);
}

function excerptText(limit = 80000) {
  let out = '';
  for (const e of state.excerpts) {
    const chunk = `\n===== ${e.path} =====\n${e.content}\n`;
    if (out.length + chunk.length > limit) break;
    out += chunk;
  }
  return out;
}

// ---------- 节点 2：规划（LLM） ----------
async function nodePlan(feedback) {
  state.planRounds++;
  const sys = `你是资深软件架构师，为真实开源仓库设计「分层模块图」的作图计划。
输出严格 JSON（不要 markdown 围栏）：
{"layers":[{"key":"frontend|api|schedule|worker|storage|monitor|ops","cnName":"层中文名","icon":"emoji","nodes":[{"id":"snake_case_id","cn":"中文业务名","path":"逐字来自文件树的真实文件或目录路径","tech":"技术/框架","shape":"node|cylinder"}]}],"edges":[{"from":"节点id","to":"节点id","label":"中文动宾短语，如 投递重检任务"}]}
规则：
- 每层 2–5 节点，全图 18–25 节点；空层不画
- cnName 必须是中文层名（如「后端 / API」「调度 / 队列」「采集 / 异步处理」），禁止直接填 key 英文
- node.path 必须逐字出现在文件树中（文件或目录），禁止臆造、禁止近似
- 边方向=真实运行时数据流：用户→前端→Flask/API→队列/调度→worker池→抓取器→存储→diff→通知→外部渠道；部署侧 ops
- 【边方向禁区·违反必驳回】外部角色禁止直连进程入口（main.go/app.py/server.js）：人不「启动/调用」main 进程，入口只由 ops 虚线部署、只出边启动服务；人可连前端/API集成端点/CLI节点；前端-->API（请求/订阅），API-->前端 只允许标签含「推送」的实时推送边；CLI/客户端SDK 是客户端侧（CLI/SDK-->API 合法，API-->CLI/SDK 禁止）；ops 与运行时之间只能虚线 -.-> 且方向 ops-.->入口
- 【实时推送必画】发布订阅/WebSocket/SSE 形态：全景必须有 服务端 -->|实时推送(SSE/WS)| 前端/客户端 的边，推送链路不得缺；通道/执行器节点必须有上游 API-->通道 的边，禁止只连外部系统的断头通道；配套清单每个路径都必须上图连边
- 【通道方向看包内文件】sender/dispatcher/mailer 类=出站投递（→外部对端），归通知/推送层；server/listener/handler 类=入站接收（外部→本服务→内部发布，如收信 SMTP 服务器），归后端/API 层、禁止放进通知/推送层；store/repository/sqlite 类=存储层不是通道（如 webpush/store.go 是订阅记录存储）；禁止望文生义画反
- 存储（datastore/数据库/卷）shape=cylinder
- 外部角色（用户）与外部系统（通知渠道/浏览器/消息代理/源站/设备网络/推送服务/证书机构）可作为节点，path 可填 "(外部)"
- 【外部系统画法】消息代理、源站/上游、设备网络、第三方推送服务（FCM/APNs）、证书机构、外部数据库（独立部署的 MySQL/PostgreSQL 等）等外部系统一律用 stadium 形状（与外部角色相同）声明在所有 subgraph 之外，禁止放进任何层 subgraph 内；内部节点直连外部系统是合法运行时边（代理转发、协议桥接、推送投递都经此外部对端）；嵌入式库（SQLite/Bolt/Badger 等进程内文件库）不画外部数据库节点，存储层代码节点即数据落点
- 【空层不画】系统没有前端就不画 frontend 层、没有定时任务就不画 schedule 层；禁止为凑层数硬画空层或把模板/配置文件塞进不属于它的层
- 【命名质量·必须遵守】cn 禁止裸角色词（如「处理器」「数据模型」「API 路由层」「任务调度」「通知服务」单独出现）；必须是「该系统特有业务/技术词 + 角色词」：
  * 业务对象取自代码真实概念：如 changedetection 的 Watch（监控目标）、umami 的 站点/会话/事件、listmonk 的 订阅者/邮件活动、memos 的 笔记/Memo、kuma 的 监控项
  * 技术词取自真实类名/文件名/框架：如 Playwright 抓取器、Apprise 渠道投递、RecheckPriorityQueue 重检队列、Flask 蓝图、Prisma 模型、Next.js App Router、SSE/WebSocket 实时推送
  * 好例子：「📥 Watch 重检队列」「🌐 Playwright 网页抓取」「📣 Apprise 渠道投递」「📥 站点 Tracker 脚本」「📐 数据访问层(queries)」；坏例子：「📐 处理器」「📦 数据模型」「📬 任务调度」
  * 数据访问/读写节点（queries/repository/store 目录）命名要体现既读也写（如「数据访问层」「查询与写入封装」），禁止只叫「查询执行器」（采集写入会让读者困惑）
- tech 字段填该节点真实技术/框架（Flask、Playwright、Apprise、Prisma、ClickHouse、Next.js、WebSocket、Celery 等）；<small> 可写具体类名/入口文件`;
  const user = `仓库根目录名：${path.basename(repo)}
${feedback ? `\n上一版计划被核查出以下问题，请修正后重新输出完整 JSON：\n${feedback}\n` : ''}
文件树（path 必须逐字取自这里）：
${state.tree.treeText}

关键文件摘录：
${excerptText(30000)}`;
  state.plan = await chatJson([
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], { json: true, temperature: 0.15 });
  log(`规划完成（第 ${state.planRounds} 轮）：${state.plan.layers?.length || 0} 层，${(state.plan.layers || []).reduce((n, l) => n + (l.nodes?.length || 0), 0)} 节点，${state.plan.edges?.length || 0} 边`);
  checkpoint(state);
}

// ---------- 节点 3：路径闸门（确定性） ----------
function nodeGate() {
  const problems = [];
  const ids = new Set();
  const pathSeen = new Map();
  for (const layer of state.plan.layers || []) {
    for (const n of layer.nodes || []) {
      if (ids.has(n.id)) problems.push(`节点 id 重复: ${n.id}`);
      ids.add(n.id);
      if (!n.path || n.path === '(外部)') continue;
      const norm = n.path.replace(/\/$/, '');
      // 同路径重复节点（如两个节点都指向 src/app/api/realtime）：起草后会变成双节点/孤立节点
      const prevPath = pathSeen.get(norm);
      if (prevPath) problems.push(`路径重复: 节点 ${n.id} 与 ${prevPath} 都指向 ${norm}，必须合并为一个节点`);
      else pathSeen.set(norm, n.id);
      const ok = state.tree.all.has(norm) || state.tree.all.has(n.path) ||
        [...state.tree.all].some((p) => p === norm || p.startsWith(norm + '/') || p.startsWith(norm + '.'));
      if (!ok) problems.push(`路径不存在: ${n.path}（节点 ${n.cn || n.id}）`);
    }
  }
  const actorIds = [...ids].filter((id) => /^actor_/.test(id));
  for (const e of state.plan.edges || []) {
    for (const ep of [e.from, e.to]) {
      if (ids.has(ep)) continue;
      const isActorWord = /^(user|users?|actor|actors?|external_system|external|site|sites?|customer|client|subscriber|browser)$/i.test(String(ep));
      const hint = isActorWord && actorIds.length
        ? `（"${ep}" 不是节点 id；外部角色必须使用固定 id：${actorIds.join(', ')}，stadium 形状声明在 subgraph 之外）`
        : '';
      problems.push(`边端点不存在: ${ep}${hint}`);
    }
  }
  const nodeTotal = (state.plan.layers || []).reduce((n, l) => n + (l.nodes?.length || 0), 0);
  if (nodeTotal > 28) problems.push(`节点过密: ${nodeTotal}（目标 18–25）`);
  if (nodeTotal < 12) problems.push(`节点过少: ${nodeTotal}（目标 18–25）`);
  return problems;
}

// ---------- 节点 4：起草（LLM） ----------
async function nodeDraft(extraContext) {
  const sys = `你按「作图计划 JSON」与视觉规范绘制 block-diagram。输出严格 JSON：{"block-diagram.md": "完整 markdown"}
${BLOCK_SPEC}
- 严格使用计划中的节点 id / 中文业务名 / path，不得新增计划外路径
- 边按计划绘制，标签用计划 label，方向不得反转`;
  const user = `作图计划 JSON：
${JSON.stringify(state.plan, null, 1)}
${extraContext || ''}`;
  const md = await chatBlock([
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], { temperature: 0.2 });
  state.drafts.push({ round: state.drafts.length + 1, md });
  state.md = md;
  log(`起草完成：${md.length} 字符`);
  checkpoint(state);
}

// ---------- 节点 5：事实核查（确定性：路径 + mermaid 语法 + 层归属） ----------
function nodeFactcheck() {
  const lint = lintBlockDiagram(state.md, state.tree);
  state.layerIssues = layerGate(state.md);
  state.factchecks.push({ round: state.factchecks.length + 1, ...lint, layerIssues: state.layerIssues });
  state.lint = lint;
  log(`事实核查：幻觉路径 ${lint.metrics.幻觉路径数}，层归属错误 ${state.layerIssues.length}，lint 问题 ${lint.issues.length} 条`,
    state.layerIssues.length ? '→ 层: ' + state.layerIssues.slice(0, 4).join('；') : '',
    lint.issues.length ? '→ lint: ' + lint.issues.slice(0, 4).join('；') : '');
  checkpoint(state);
  return lint;
}

// ---------- 节点 6：批判（LLM，grounded=喂确定性解析结果） ----------
function parsedGraph() {
  const blocks = parseMermaid(state.md);
  let edges = [];
  const nodes = new Set();
  for (const code of blocks) {
    const g = parseFlowchart(code);
    g.nodeIds.forEach((n) => nodes.add(n));
    edges = edges.concat(g.edges.map((e) => `${e.from}->${e.to}`));
  }
  return { nodes: [...nodes], edges: [...new Set(edges)] };
}

async function nodeCritic(grounded, brief) {
  const graph = grounded ? parsedGraph() : null;
  const briefRules = brief ? `
6. backbone（最高优先级）：对照产品定义「${brief.product}」与默认主流程「${(brief.journey || []).join(' → ')}」：
   - 主链路必须能走通这条旅程；旅程中每一步都要有对应节点和边
   - 可选/插件/高部署档组件（${(brief.optionalSuspects || []).join('、') || '无'}）若出现在主链路必经路径上，报 high（应旁路或标注「可选」）
   - 外部角色（${(brief.actors || []).map((a) => a.name).join('、') || '用户'}）必须出场且与主链路相连` : '';
  const sys = `你是严格的架构评审组长。对照作图计划、规范与真实源码摘录，审查 block-diagram markdown。
输出严格 JSON：{"issues":[{"severity":"high|medium|low","kind":"edge-direction|edge-missing|layer|density|spec|naming|backbone|actor","where":"相关节点/边","issue":"问题","fix":"具体修法"}],"verdict":"ok|revise"}
审查重点：
1. edge-direction：边方向必须=真实运行时数据流（请求自顶向下；通知/外发由内向外）。重点严查五类高频反向边：① 外部角色 --> 进程入口（main.go/app.py 类，人不启动 main 进程，必删）；② 后端/API --> 前端 的非推送实线（「提供界面/返回页面」皆错，只允许标签含「推送」的 SSE/WebSocket 边）；③ API 服务端 --> CLI/客户端SDK（方向反，CLI/SDK 是调用方）；④ ops 与运行时之间的实线或反向边（必须虚线 -.-> 且 ops 为源）；⑤ 通道断头与方向画反：投递通道/执行器（邮件/推送/短信节点）只连外部系统、没有上游 API/服务 --> 通道 的边（断头，high）；入站类（server/listener，如收信 SMTP 服务）画成出站投递、或被放进通知/推送层（入站接收是 API 层端点，layer 错误报 high）；存储类包（文件名含 store/repository/sqlite，如 webpush 订阅存储）画成通道（high）
2. edge-missing：只遗漏**关键主链路**才算问题（入口→队列→worker→抓取/处理→存储→通知；实时推送）。发布订阅/WebSocket/SSE 形态若全景缺「服务端 -->|实时推送(SSE/WS)| 前端/客户端」边，报 high（推送主链路不得缺）；配套锚点清单中的路径未上图或上图但孤立，报 high。**禁止**给每个节点都补到存储的边
3. layer：content_fetchers/processors/diff 属 worker 采集处理层；notification/realtime 属 monitor；store/model 属 storage；blueprint/flask 属 api；templates/static 属 frontend；**外部系统（消息代理/推送服务/SMTP 中继/外部数据库等 stadium 节点）一律在所有 subgraph 之外**，发现外部节点被画进层 subgraph 报 high；嵌入式库（SQLite/Bolt）不应有外部数据库节点
4. density：节点 15–25；每层 2–5
5. naming：中文业务名准确
7. spec（视觉规范）：emoji 是否按业务语义多样化（同一 emoji 不得超过 3 个节点，禁止全图 🛒/🎯 同款）；外部角色与外部系统（含外部数据库）是否 stadium 形状 (["..."]) 且声明在所有 subgraph 之外；可选外部 DB 是否虚线 -.-> 标注「可选」；ops 节点（Dockerfile/compose/镜像）是否只用虚线 -.-> 连运行时；边标签是否 ≤8 字动宾短语；是否有「## 子图2：主链路」flowchart LR 特写；同一对节点是否有重复边（注意：同源不同目标的边不算重复，如 API 分别触发 FCM 与 WebPush 两个不同通道）${briefRules}
只报真实、可执行的问题，最多 8 条，按严重度排序；没问题就 verdict=ok、issues=[]。`;
  const user = `作图计划：
${JSON.stringify(state.plan, null, 1)}
${brief ? `\n产品定义（主干对照基准）：
- 产品：${brief.product}
- 默认主流程：${(brief.journey || []).join(' → ')}
- 外部角色：${(brief.actors || []).map((a) => a.name).join('、')}
- 可选组件（不得在主链路必经）：${(brief.optionalSuspects || []).join('、') || '无'}\n` : ''}

待审 block-diagram.md：
${state.md}

确定性核查指标：${JSON.stringify(state.lint.metrics)}
${graph ? `\n图中已存在节点（确定性解析）：${graph.nodes.join(', ')}\n图中已存在边（from->to，确定性解析）：\n${graph.edges.join('\n')}\n**严禁**把边表中已存在的边报为 edge-missing；报 edge-missing 前必须先在边表检索两个方向。` : ''}
${state.layerIssues && state.layerIssues.length ? `\n确定性层归属闸门已发现以下错误（必须修，直接列入 high）：\n${state.layerIssues.join('\n')}` : ''}

源码摘录（判断边方向/层归属的依据）：
${excerptText(40000)}`;
  let critique;
  try {
    critique = await chatJson([
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ], { json: true, temperature: 0.1 });
  } catch (e) {
    log('批判节点 JSON 解析失败，降级为空批判（确定性闸门继续生效）：', e.message);
    critique = { issues: [], verdict: 'revise' };
  }
  // 接地后处理：过滤与已存在边矛盾的 phantom edge-missing
  if (grounded && graph) {
    const edgeSet = new Set(graph.edges.map((e) => e.replace(/\s/g, '')));
    critique.issues = (critique.issues || []).filter((i) => {
      if (i.kind !== 'edge-missing' || !i.where) return true;
      const ids = (i.where.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []);
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
        if (edgeSet.has(`${ids[a]}->${ids[b]}`) || edgeSet.has(`${ids[b]}->${ids[a]}`)) return false;
      }
      return true;
    });
    for (const li of (state.layerIssues || [])) {
      critique.issues.push({ severity: 'high', kind: 'layer', where: li, issue: li, fix: '把节点移动到路径语义对应的 subgraph 层' });
    }
  }
  state.critiques.push({ round: state.critiques.length + 1, grounded: !!grounded, ...critique });
  const highs = (critique.issues || []).filter((i) => i.severity === 'high');
  log(`批判完成（${grounded ? '接地' : '裸眼'}）：${(critique.issues || []).length} 条问题（high ${highs.length}），verdict=${critique.verdict}`);
  checkpoint(state);
  return critique;
}

// ---------- 节点 7：修订（LLM） ----------
async function nodeRefine(issues, finalRound = false) {
  const sys = `你根据核查问题清单修订 block-diagram。输出严格 JSON：{"block-diagram.md": "修订后完整 markdown"}
规则：只修列出的问题；保留所有已验证正确的节点/路径/配色；禁止引入文件树中不存在的新路径；边方向按真实数据流。
${finalRound ? '这是最后一轮修订：清单里每一条都必须修掉——孤立节点要么连边要么删除节点声明（强制锚点必须连边，不得删除）；反向边逐条按修法改正；禁止以「保持现状」为由跳过任何一条。\n' : ''}${BLOCK_SPEC}`;
  const user = `当前 block-diagram.md：
${state.md}

必须修复的问题清单：
${issues.map((i, n) => `${n + 1}. [${i.severity || 'hard'}/${i.kind || 'factcheck'}] ${i.where || ''} ${i.issue} → 修法：${i.fix || '按规范修正'}`).join('\n')}

作图计划（路径以它为准）：
${JSON.stringify(state.plan, null, 1)}`;
  let md;
  try {
    md = await chatBlock([
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ], { temperature: 0.15 });
  } catch (e) {
    log('修订节点输出无法解析，保留当前稿继续：', e.message);
    return false;
  }
  state.md = md;
  state.drafts.push({ round: state.drafts.length + 1, md: state.md, refined: true });
  log(`修订完成：${state.md.length} 字符`);
  checkpoint(state);
}

// ---------- 变体 A：digest（复刻现有 llm-generate.js） ----------
async function runDigest() {
  nodeGather();
  const { scan } = require(path.join(__dirname, '..', 'scan'));
  const inv = scan(repo);
  const digest = JSON.stringify({
    title: inv.title, languages: inv.languages, entrypoints: inv.entrypoints,
    modules: inv.modules, services: inv.services, artifacts: inv.artifacts,
    deploy: inv.deploy, classes: inv.classes.slice(0, 20), packages: inv.packages.slice(0, 15)
  }, null, 1);
  const sys = `你是架构图生成器。根据仓库扫描摘要生成 block-diagram.md（分层模块图）。
输出严格 JSON：{"block-diagram.md": "完整 markdown"}
${BLOCK_SPEC}`;
  state.md = (await chatJson([
    { role: 'system', content: sys },
    { role: 'user', content: `仓库扫描摘要：\n${digest}` }
  ], { json: true, temperature: 0.2 }))['block-diagram.md'];
  state.drafts.push({ round: 1, md: state.md });
  nodeFactcheck();
}

// ---------- 变体 B：富上下文单次（复刻 method5） ----------
async function runRich1() {
  nodeGather();
  const sys = `你是资深架构师。根据完整文件树与关键源码摘录，为该仓库绘制 block-diagram.md（分层模块图）。
输出严格 JSON：{"block-diagram.md": "完整 markdown"}
- 节点 <small> 中的每个路径必须逐字来自文件树，禁止臆造
${BLOCK_SPEC}`;
  state.md = (await chatJson([
    { role: 'system', content: sys },
    { role: 'user', content: `仓库：${path.basename(repo)}
文件树：
${state.tree.treeText}
源码与编排摘录：
${excerptText(100000)}` }
  ], { json: true, temperature: 0.2 }))['block-diagram.md'];
  state.drafts.push({ round: 1, md: state.md });
  nodeFactcheck();
}

// ---------- 变体 orch3：锚点覆盖 + plan 回写 + 主链路自述 ----------
async function nodeStory(anchors) {
  const sys = `你是架构师。根据锚点路径与源码摘录，用一句话讲清运行时主链路，并列出必须出现在图中的边（用 path 引用，不要臆造路径）。
输出严格 JSON：
{"story":"用户…→…→通知渠道","mustEdges":[{"fromPath":"树中真实路径","toPath":"树中真实路径","label":"中文动宾"}]}
规则：
- 若存在 notification_service.py 或 notification/，通知执行边必须连到它们，禁止连到 api/Notifications.py
- 若存在 flask_app.py / changedetection.py，必须作为入口出现在 mustEdges 的一端
- 最多 10 条 mustEdges，只保留主链路`;
  state.story = await chatJson([
    { role: 'system', content: sys },
    { role: 'user', content: `锚点：\n${JSON.stringify(anchors, null, 1)}\n\n摘录：\n${excerptText(35000)}` }
  ], { json: true, temperature: 0.1 });
  log('主链路自述：', (state.story.story || '').slice(0, 160));
  checkpoint(state);
  return state.story;
}

function applyMustEdges(plan, story, tree) {
  if (!story || !Array.isArray(story.mustEdges)) return;
  const nodes = [];
  for (const l of plan.layers || []) for (const n of l.nodes || []) nodes.push(n);
  const findNode = (p) => {
    if (!p) return null;
    if (p === '(外部)') return nodes.find((n) => n.path === '(外部)');
    // 形态外部系统固定 id/中文名（ext_upstream/ext_broker/ext_device/ext_push/ext_db）
    const byExt = nodes.find((n) => n.id === p || (n.ext && (n.cn === p || n.cn.includes(p))));
    if (byExt) return byExt;
    const norm = String(p).replace(/\/$/, '');
    return nodes.find((n) => {
      const np = String(n.path || '').replace(/\/$/, '');
      return np === norm || np.endsWith(norm) || norm.endsWith(np) || np.endsWith(require('path').basename(norm));
    });
  };
  if (!plan.edges) plan.edges = [];
  const has = (a, b) => plan.edges.some((e) => e.from === a && e.to === b);
  const extOk = (p) => nodes.some((n) => n.id === p || (n.ext && n.cn === p));
  for (const me of story.mustEdges) {
    const fromOk = me.fromPath === '(外部)' || extOk(me.fromPath) || tree.all.has(me.fromPath.replace(/\/$/, '')) ||
      [...tree.all].some((p) => p.endsWith(me.fromPath.replace(/\/$/, '')) || p.endsWith('/' + require('path').basename(me.fromPath)));
    const toOk = me.toPath === '(外部)' || extOk(me.toPath) || tree.all.has(String(me.toPath).replace(/\/$/, '')) ||
      [...tree.all].some((p) => p.endsWith(String(me.toPath).replace(/\/$/, '')) || p.endsWith('/' + require('path').basename(me.toPath)));
    if (!fromOk || !toOk) continue;
    const a = findNode(me.fromPath);
    const b = findNode(me.toPath);
    if (a && b && !has(a.id, b.id)) plan.edges.push({ from: a.id, to: b.id, label: me.label || '协作' });
  }
}

async function runOrch3() {
  nodeGather();
  const anchors = findAnchors(state.tree);
  state.anchors = anchors;
  log('锚点：', anchors.map((a) => a.role + '=' + a.path).join(', '));

  let feedback = null;
  for (let i = 0; i < 3; i++) {
    const extra = `\n【强制】下列签名路径必须作为节点出现（path 逐字使用）：\n` +
      anchors.map((a) => `- ${a.path} → ${a.layer} 层（${a.hint}）`).join('\n');
    await nodePlan((feedback ? feedback + '\n' : '') + extra);
    injectAnchors(state.plan, anchors);
    rewritePlanLayers(state.plan);
    const problems = nodeGate();
    const cov = coverageGate(JSON.stringify(state.plan), anchors);
    if (cov.length) {
      problems.push(...cov.map((a) => `计划缺少签名锚点 ${a.path}（${a.hint}），必须加入 ${a.layer} 层`));
    }
    if (problems.length === 0) { log('orch3 计划闸门+覆盖通过'); break; }
    log(`orch3 计划驳回 ${problems.length} 条：${problems.slice(0, 4).join('；')}`);
    feedback = problems.join('\n');
    if (i === 2) log('达计划轮次上限');
  }

  await nodeStory(anchors);
  applyMustEdges(state.plan, state.story, state.tree);
  rewritePlanLayers(state.plan);
  checkpoint(state);

  await nodeDraft(`\n主链路（必须在图中可走通）：${state.story && state.story.story}\n关键源码摘录：\n${excerptText(60000)}`);

  for (let loop = 0; loop < 2; loop++) {
    const lint = nodeFactcheck();
    const hard = lint.issues.map((i) => ({ severity: 'high', kind: 'factcheck', issue: i, fix: '修正为真实路径/声明节点' }));
    for (const li of (state.layerIssues || [])) {
      hard.push({ severity: 'high', kind: 'layer', issue: li, fix: '把节点移到路径语义对应的层；随后视为已修，不得改回' });
    }
    for (const t of semanticTraps(state.md)) {
      hard.push({ severity: 'high', kind: 'edge-direction', issue: t, fix: t });
    }
    const missing = coverageGate(state.md, anchors);
    for (const a of missing) {
      hard.push({
        severity: 'high',
        kind: 'coverage',
        issue: `图中缺少签名锚点 ${a.path}（${a.hint}）`,
        fix: `在 ${a.layer} 层增加节点，<small> 必须含 ${a.path}`
      });
    }
    rewritePlanLayers(state.plan);
    const critique = await nodeCritic(true);
    const criticIssues = (critique.issues || []).filter((i) => {
      if (i.kind === 'layer' && state.layerIssues && state.layerIssues.length === 0) return false;
      return i.severity === 'high' || i.severity === 'medium';
    });
    const allIssues = [...hard, ...criticIssues];
    if (allIssues.length === 0) { log('orch3 核查与批判均通过'); break; }
    if (loop === 1) { log('orch3 达修订轮次上限'); break; }
    await nodeRefine(allIssues.slice(0, 14));
  }
  nodeFactcheck();
  const left = coverageGate(state.md, anchors);
  state.coverageMissing = left.map((a) => a.path);
  log('覆盖缺口：', left.length ? left.map((a) => a.path).join(', ') : '无');
}

// ---------- orch4：产品自述 + 重要性取证 + 通用锚点 + 主干/旁路闸门 ----------

// 热文件摘录：按 import 入度选主干文件，补上 changedetection 专用 EXCERPT_PATTERNS 覆盖不到的仓库
function gatherHotExcerpts(importance, cap = 40000) {
  const scored = [];
  for (const f of state.tree.files) {
    if (!/\.(py|js|ts|go)$/.test(f)) continue;
    const imp = importance.info(f);
    if (imp.heat > 0 || imp.reachable) scored.push({ f, score: imp.heat * 2 + (imp.reachable ? 1 : 0) });
  }
  scored.sort((a, b) => b.score - a.score);
  let total = 0;
  const out = [];
  for (const { f } of scored.slice(0, 14)) {
    if (total > cap) break;
    const abs = path.join(repo, f);
    try {
      let content = fs.readFileSync(abs, 'utf8');
      content = content.slice(0, 2600);
      out.push({ path: f, content });
      total += content.length + f.length + 20;
    } catch { /* skip */ }
  }
  return out;
}

async function nodeProductBrief(importance) {
  const readme = (() => { try { return fs.readFileSync(path.join(repo, 'README.md'), 'utf8').slice(0, 5000); } catch { return ''; } })();
  const compose = (() => {
    for (const f of ['docker-compose.yml', 'docker-compose.yaml']) {
      try { return fs.readFileSync(path.join(repo, f), 'utf8').slice(0, 3000); } catch { /* next */ }
    }
    return '';
  })();
  const sys = `你是产品分析师。只读 README 与编排文件，输出对这个开源产品的客观定义。不要猜代码细节。
输出严格 JSON：
{
  "product": "一句话说明这个产品是干什么的（中文，30字内）",
  "journey": ["核心用户旅程步骤1（用户做什么→系统做什么）", "步骤2…", "3-6 步，只写默认主流程，不写可选功能"],
  "actors": [{"name":"中文角色名","kind":"user|external_system","note":"为什么出场"}],
  "coreSubsystems": ["完成主流程必须有的子系统（中文，4-8个）"],
  "optionalSuspects": ["README/编排中暗示为可选、插件、高部署档才用的组件名（如 kafka/ai/openai）"]
}
规则：
- journey 只写「装完默认就能跑」的主流程；需要开关/profiles/额外部署的功能一律不进 journey
- actors 包含终端用户，以及产品与之交互的外部对象（如被监控的网站、访客浏览器、订阅者）
- 不确定就不写，禁止臆造`;
  const user = `README（节选）：
${readme}

docker-compose（节选）：
${compose}

确定性取证：以下组件被判为「可选/非默认」（证据）：
${(importance.optionalKw.length ? importance.optionalKw : ['（无）']).map((k) => '- ' + k).join('\n')}`;
  state.detachedKw = (importance.detachedList || []).map((d) => path.basename(d.path));
  state.brief = await chatJson([
    { role: 'system', content: sys },
    { role: 'user', content: user + `\n\n确定性取证：以下目录被引用但从进程入口不可达（条件注册/实验/独立工具，旁路组件）：\n${(importance.detachedList || []).map((d) => `- ${d.path}（引用 ${d.heat} 处）`).join('\n') || '- （无）'}`}
  ], { json: true, temperature: 0.1 });
  // 旁路组件并入可选嫌疑，让下游 story/批判节点统一按「非主干」对待
  state.brief.optionalSuspects = [...new Set([...(state.brief.optionalSuspects || []), ...state.detachedKw])];
  log('产品自述：', state.brief.product);
  log('主旅程：', (state.brief.journey || []).join(' → '));
  log('外部角色：', (state.brief.actors || []).map((a) => a.name).join('、') || '无');
  checkpoint(state);
  return state.brief;
}

// 可选/旁路组件标注闸门（正向）：图中出现 optional/detached 关键词节点，中文名必须带「可选/实验」。
// 反例保护：若 <small> 路径经取证为「入口可达且无权威可选证据」的主干代码（feature-flag/env 开关
// 只门控运行时行为），跳过强制标注——否则会与 requiredLabelGate 互相打架（openim push 教训）。
function optionalLabelGate(md, importance, detachedKw) {
  const issues = [];
  const kws = [...(importance.optionalKw || []), ...(detachedKw || [])].filter((k) => k.length >= 3);
  const infoOf = importance && typeof importance.info === 'function' ? importance.info : null;
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*[\[\(\{][^\n]*?<small>([\s\S]*?)<\/small>/g;
  let m;
  while ((m = re.exec(md))) {
    const label = m[0];
    const small = m[2];
    if (/\(外部\)|（外部）/.test(small)) { /* 外部系统正常走可选标注 */ }
    else if (infoOf) {
      const pm = small.match(/[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+/);
      if (pm) {
        let pi;
        try { pi = infoOf(pm[0]); } catch { pi = null; }
        if (pi && pi.reachable && !pi.optional) continue; // 主干代码：feature-flag 词不强制标注
      }
    }
    for (const kw of kws) {
      const hit = new RegExp('(^|[/_-])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([/_-]|\\.|$)', 'i').test(small) || new RegExp(kw, 'i').test(label.split('<small>')[0]);
      if (hit && !/可选|optional|实验|旁路/i.test(label)) {
        issues.push(`节点 ${m[1]} 含可选/旁路组件「${kw}」但未标注：中文名应加「（可选/实验）」，且不得位于主链路必经路径`);
        break;
      }
    }
  }
  return issues;
}

// 主干服务反向闸门：从进程入口可达、且无权威可选证据（compose profiles / 插件目录）的
// 代码节点，不得标注「可选/实验/旁路」。feature-flag/env 门控的是运行时行为与外部渠道
// （openim 教训：PUSH_ENABLE 门控 FCM/APNs 渠道，openim-push 有 cmd/openim-push/main.go
//   入口且 compose 默认部署；误标「（可选/实验）」与 c4-container 的标准 Container 跨图矛盾）。
// 外部系统节点（<small>(外部)</small>）豁免——外部 broker/推送渠道确实按需启用。
function requiredLabelGate(md, importance) {
  const issues = [];
  if (!importance || typeof importance.info !== 'function') return issues;
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*[\[\(\{][^\n]*?<small>([\s\S]*?)<\/small>/g;
  let m;
  while ((m = re.exec(md))) {
    const id = m[1];
    const head = m[0].split('<small>')[0];
    const small = m[2];
    if (/\(外部\)|（外部）/.test(small)) continue;           // 外部系统：可按需启用，豁免
    if (!/可选|optional|实验|旁路/i.test(head)) continue;    // 未标可选，归正向闸门管
    const pm = small.match(/[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+/); // small 中的路径
    if (!pm) continue;
    let info;
    try { info = importance.info(pm[0]); } catch { continue; }
    if (!info) continue;
    if (info.reachable && !info.optional) {
      issues.push(`节点 ${id} 是主干/默认部署代码（${pm[0]} 从进程入口可达且无权威可选证据），不得标注「可选/实验/旁路」：删除中文名里的可选标记，作为标准组件放回主链路（开关只门控其内部行为/外部渠道）`);
    }
  }
  return issues;
}

// 确定性扫尾配套：主干节点误标「可选/实验/旁路」时，程序化剥离标签
// （LLM 三轮修订可能仍保留旧标注；剥离只动节点标题头部，不动 <small> 路径与边）。
// 外部系统（(外部)）不动；marker 仅匹配括号内以 可选/optional/实验/experimental/旁路 开头的内容。
const OPTIONAL_MARKER_RE = /[（(]\s*(?:可选|optional|实验(?:性)?|experimental|旁路)[^）)]*[）)]/gi;
function stripMislabeledOptional(md, importance) {
  const actions = [];
  if (!importance || typeof importance.info !== 'function') return { md, actions };
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dm = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*[\[\(\{]/);
    if (!dm) continue;
    const smallAt = line.indexOf('<small>');
    if (smallAt < 0) continue;
    const head = line.slice(0, smallAt);
    const smallM = line.slice(smallAt).match(/^<small>([^<\n]*?)<\/small>/);
    if (!smallM) continue;
    const small = smallM[1];
    if (/\(外部\)|（外部）/.test(small)) continue;
    if (!/可选|optional|实验|旁路/i.test(head)) continue;
    const pm = small.match(/[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+/);
    if (!pm) continue;
    let info;
    try { info = importance.info(pm[0]); } catch { continue; }
    if (info && info.reachable && !info.optional) {
      const newHead = head.replace(OPTIONAL_MARKER_RE, '').replace(/\s{2,}/g, ' ');
      if (newHead !== head) {
        lines[i] = newHead + line.slice(smallAt);
        actions.push(`${dm[2]}（${pm[0]}）剥离误标的可选标记`);
      }
    }
  }
  return { md: lines.join('\n'), actions };
}

// ---------- 视觉/润色确定性闸门（orch4）：把用法1 的观感基线变成可核查项 ----------
function visualGates(md) {
  const issues = [];
  const blocks = parseMermaid(md);
  const main = blocks[0] || '';
  const lines = main.split(/\n/);

  const nodeInfo = new Map();
  const opsIds = new Set();
  const actorIds = new Set();
  const emojiCount = new Map();
  let nodeWithEmoji = 0;
  let depth = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^subgraph\b/.test(line)) depth++;
    if (/^end\b/.test(line)) depth = Math.max(0, depth - 1);
    const dm = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(\(\[|\[\(|\[|\(|\{)\s*["“]?([^\]})<\n]*)/);
    if (dm && !/^(flowchart|graph|subgraph|end|classDef|class|style|direction|linkStyle)$/.test(dm[1])) {
      const [, id, shape, text] = dm;
      nodeInfo.set(id, { shape, inSub: depth > 0, line });
      const em = text.match(/\p{Extended_Pictographic}/u);
      if (em) { emojiCount.set(em[0], (emojiCount.get(em[0]) || 0) + 1); nodeWithEmoji++; }
      // 外部角色：stadium 形状 + (外部)；圆柱 [("…(外部)")] 是外部基础设施（PostgreSQL 等），不是 actor
      if (shape !== '[(' && /\(外部\)/.test(line)) actorIds.add(id);
      // ops 节点：身份是 Dockerfile/compose/镜像/部署本身；圆柱存储节点即使 small 提到 compose 也不算 ops
      if (shape !== '[(') {
        const labelHead = line.split('<small>')[0];
        const smallM = line.match(/<small>([\s\S]*?)<\/small>/);
        const smallPath = (smallM ? smallM[1] : '').trim();
        const isOpsId = /(^|_)(docker|compose|dockerfile|image|container|deploy|ci)(_|$)/i.test(id);
        const opsLabel = /dockerfile|docker[ -]?compose|compose\.ya?ml|镜像|ghcr\.io|容器镜像/i.test(labelHead);
        const opsPath = /(^|\/)?(dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/i.test(smallPath);
        if (isOpsId || opsLabel || opsPath) opsIds.add(id);
      }
    }
  }

  // 1) emoji 单调：最高频 emoji 占比 > 55% 且带 emoji 节点 >= 8
  if (nodeWithEmoji >= 8) {
    let top = null, topN = 0;
    for (const [e, n] of emojiCount) if (n > topN) { top = e; topN = n; }
    if (topN / nodeWithEmoji > 0.55) {
      issues.push({ severity: 'high', kind: 'spec', issue: `emoji 单调：${topN}/${nodeWithEmoji} 个节点都用 ${top}`, fix: '按节点业务语义换用不同 emoji（规范第7条词表），全图同一 emoji 不超过 3 个' });
    }
  }

  // 2) 外部角色：stadium 形状 + 层外
  for (const [id, info] of nodeInfo) {
    if (!actorIds.has(id)) continue;
    if (info.shape !== '([' ) {
      issues.push({ severity: 'high', kind: 'spec', issue: `外部角色节点 ${id} 未用 stadium 形状`, fix: '改为 id(["👤 名称<br/><small>(外部)</small>"])，并加 classDef actor fill:#eceff1 上色' });
    }
    if (info.inSub) {
      issues.push({ severity: 'high', kind: 'spec', issue: `外部角色节点 ${id} 被放进层 subgraph`, fix: '把外部角色声明移到所有 subgraph 之外（层框结束后独立声明）' });
    }
  }

  // 3) ops 节点实线连运行时（actor 的部署操作如「用户 -->|启动容器| docker」属人类动作，不算违规）
  const g = parseFlowchart(main);
  for (const e of g.edges) {
    if (!opsIds.has(e.from) && !opsIds.has(e.to)) continue;
    if (actorIds.has(e.from) || actorIds.has(e.to)) continue;
    if (e.dashed) continue;
    issues.push({ severity: 'high', kind: 'spec', issue: `ops 节点用实线连运行时：${e.from} → ${e.to}`, fix: 'ops（Dockerfile/compose/镜像）与运行时节点之间改用虚线 -.-> 表示部署/构建关系' });
  }

  // 4) 边标签过长
  let longLabels = 0;
  for (const raw of lines) {
    const frags = raw.match(/\|([^|]+)\|/g) || [];
    for (const frag of frags) {
      const lab = (frag.match(/\|([^|]+)\|/) || [])[1] || '';
      if ((lab.match(/[一-鿿]/g) || []).length > 10) longLabels++;
    }
  }
  if (longLabels > 0) {
    issues.push({ severity: 'medium', kind: 'spec', issue: `${longLabels} 条边标签超过 10 个汉字`, fix: '边标签压缩为 ≤8 字动宾短语（如「拉取HTML」「投递任务」「有变更」）' });
  }

  // 5) 重复边（同方向）
  const seen = new Map();
  for (const e of g.edges) {
    const k = `${e.from}->${e.to}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const dup = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  if (dup.length) {
    issues.push({ severity: 'medium', kind: 'spec', issue: `重复边：${dup.slice(0, 3).join('、')}`, fix: '同一对节点同方向只保留一条边，标签合并' });
  }

  // 6) 子图2 主链路特写
  if (blocks.length < 2) {
    issues.push({ severity: 'medium', kind: 'spec', issue: '缺少子图2 主链路特写', fix: '子图1 后增加 ## 子图2：<核心动作>主链路（flowchart LR，6–8 个简短中文名节点串起默认主流程，可不写 path）' });
  }
  return issues;
}

// 通知两级方向闸门：发送服务文件（notification_service.py / messenger）→ 渠道目录（notification/、apprise）。
// 真实 import 方向是 service from channel（如 notification_service.py: from changedetectionio.notification import ...），
// 运行时由服务调用渠道，边必须 服务 → 渠道；画反即 high。
function notifyDirectionGate(md, anchors, companions) {
  const issues = [];
  const pairs = [];
  for (const c of companions.filter((x) => x.role === 'notify')) {
    const anchor = anchors.find((a) => a.role === 'notify' && a.path === c.companionOf);
    if (anchor) pairs.push({ service: c.path, channel: anchor.path });
  }
  if (!pairs.length) return issues;
  const blocks = parseMermaid(md);
  for (const code of blocks) {
    const g = parseFlowchart(code);
    const nodeSmalls = new Map();
    const declRe = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[\(|\(\[|\[|\(|\{)[^\n]*?<small>([\s\S]*?)<\/small>/g;
    let m;
    while ((m = declRe.exec(code))) nodeSmalls.set(m[1], m[2]);
    const pathTokens = (sp) => sp.match(/[A-Za-z0-9_./-]+\.(py|js|ts|go|ya?ml)|[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+/g) || [];
    const nodeFor = (p) => {
      const norm = p.replace(/\/$/, '');
      const base = path.basename(norm);
      for (const [id, sp] of nodeSmalls) {
        const toks = pathTokens(sp);
        if (toks.some((t) => t === norm || t.endsWith('/' + norm) || t === base || t.endsWith('/' + base))) return id;
      }
      return null;
    };
    for (const { service, channel } of pairs) {
      const sId = nodeFor(service);
      const cId = nodeFor(channel);
      if (!sId || !cId || sId === cId) continue;
      const reversed = g.edges.some((e) => e.from === cId && e.to === sId);
      const forward = g.edges.some((e) => e.from === sId && e.to === cId);
      if (reversed && !forward) {
        issues.push({ severity: 'high', kind: 'edge-direction',
          issue: `通知方向反转：${cId}（${channel}，渠道投递/apprise）→ ${sId}（${service}，发送服务）画反了；真实代码是服务 import 渠道（${path.basename(service)} from ${channel}）`,
          fix: `把边改为 ${sId} -->|调用渠道/投递| ${cId}（发送服务调用通知渠道）；触发通知的一方连 ${sId}，不要直连渠道目录` });
      }
    }
  }
  return issues;
}

// ---------- 结构/叙事确定性闸门（orch4b）：机评抓不到、但盲评一眼看穿的硬伤 ----------
// 同路径重复节点 / 孤立节点 / 数据库当 actor / 圆柱错层 / 机制误标（events 当实时推送）/
// 圆柱形状滥用（models 代码包）/ 存储直连前端 / 部署方向反 / 入口直连前端

const INFRA_RE = /postgres|postgre|mysql|mariadb|redis|clickhouse|mongo|sqlite|elastic|kafka|rabbitmq|nats|zookeeper|zoo[_-]?keeper|minio|s3\b|ceph|对象存储|数据库|database/i;
// 实时推送语义：SSE/WebSocket/推送是合法的服务端→客户端边（后端主动推向前端），不算反向边
const PUSH_RE = /推送|实时|realtime|流式|websocket|web[\s-]?socket|\bSSE\b|stream/i;

// 外部角色细分：人（用户/管理员/访客）vs 外部系统（被监控服务/第三方系统/协议对端）
// 探测/请求的目标是「外部系统」；只有通知服务能给「人」发消息
// 形态对端（消息代理/源站/设备网络/推送服务/证书机构/外部数据库/客户端 App）都是外部系统，内部节点直连合法
const SYSTEM_PEER_RE = /被监控|外部系统|外部服务|外部存储|目标服务|目标网站|第三方|external[\s_-]?system|上下游|回调来源|消息代理|broker|mqtt|证书|certificate|authority|acme|encrypt|源站|上游|upstream|origin|设备网络|协调器|coordinator|stick|zigbee|modbus|fcm|apns|firebase|推送服务|推送通道|手机推送|push[\s-]?service|smtp|邮件服务器|mail[\s-]?server|relay|中继|客户端|client|ext_upstream|ext_broker|ext_device|ext_push|ext_db|ext_ca|ext_mail/i;
const actorKindOf = (id, info, layer) => {
  if (layer !== 'actor' && !/^actor_/.test(id) && !(info && info.actor) && !(info && info.shape === '([')) return null;
  const t = `${id} ${info ? info.head + ' ' + info.small : ''}`;
  if (SYSTEM_PEER_RE.test(t)) return 'system';
  // 🌍/🌐 是外部系统的约定 emoji（人角色统一用 👤）
  // 注：必须用 u flag，否则字符集按 UTF-16 代理对拆分，📶=\uD83D\uDCF6 会让 \uD83D
  // 进入集合，导致所有 U+1F4xx 系列（📤/📥/📱/👤…）误判为外部系统（ntfy 推送边环未触发的真因）
  if (info && /[🌍🌐📶]/u.test(info.head || '')) return 'system';
  return 'user';
};
// 通知/消息类节点：只有它可以给「人」角色发告警/通知/邮件（uptime-kuma 通知服务 → 管理员 合法）
const notifLike = (id, info) => /通知|notification|notifier|notify|alert|告警|消息|邮件|短信|apprise|messenger|smtp|渠道|pushover|webhook/i
  .test(`${id} ${info ? info.head + ' ' + info.path : ''}`);

// actor 唯一性：产品自身永远是图的主角（由内部各层节点表达），不能作为外部角色出场。
// LLM 产品自述偶尔把「ntfy 服务器 / 本系统 / 核心服务」invent 成 external_system 演员，
// 注入后变成 actor_ntfy 这类臆造节点，盲评一眼判定幻觉（ntfy 教训）。
// 产品名 token 必须与自指角色词（服务器/服务/系统/后端）同时出现，避免误杀「ntfy 手机 App」这类合法外部客户端
const SELF_ACTOR_SELF_RE = /本(系统|服务|服务端|产品|应用|平台|程序|服务器)|该(系统|服务|产品)|(系统|服务|产品|平台)自身|核心(服务|系统|服务器|后端)/;
const SELF_ACTOR_ROLE_RE = /服务器|服务端|后端|本系统|本服务|本产品|本应用|本平台|该系统|该服务|核心服务|核心系统|系统自身|服务自身|产品自身/;
const SELF_ACTOR_BARE_RE = /^(本\s*)?(系统|服务|服务器|服务端|后端服务?|应用|平台|程序|产品)$/;
const SELF_ACTOR_EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;
function isSelfActorName(name, tokens) {
  const raw = String(name || '').trim();
  if (!raw) return false;
  if (SELF_ACTOR_SELF_RE.test(raw)) return true;
  if (SELF_ACTOR_BARE_RE.test(raw.replace(SELF_ACTOR_EMOJI_RE, '').replace(/\s+/g, ''))) return true;
  if (!SELF_ACTOR_ROLE_RE.test(raw)) return false;
  const n = raw.toLowerCase().replace(/[._\-\s]+/g, '');
  for (const t of tokens || []) {
    const tt = String(t).toLowerCase().replace(/[._\-\s]+/g, '');
    if (tt.length < 3) continue;
    // changedetection.io 这类产品目录名带 .io 后缀，标签常省略后缀
    if (n.includes(tt) || (tt.endsWith('io') && tt.length > 5 && n.includes(tt.slice(0, -2)))) return true;
  }
  return false;
}
// 产品名 token：仓库根目录名最可靠（ntfy/caddy/vaultwarden/zigbee2mqtt…）
const selfActorTokens = () => [path.basename(repo)].filter((t) => t && !t.startsWith('-'));
// 层间请求方向秩：前端(1) → API(2) → 调度/worker(3) → 监控(4) → 存储(5)；反向边即逆流
const LAYER_RANK = { frontend: 1, api: 2, schedule: 3, worker: 3, monitor: 4, storage: 5, ops: 6, actor: 0 };

// 解析 mermaid 块：节点 id → {shape, head 中文名, small, path, layer 层标题, actor}
// 同时支持行首声明（子图1 分层全景）与边行内声明（子图2 特写链 A[".."] -->|..| B[".."]）
function parseBlockStructure(code) {
  const nodes = new Map();
  const layers = [];
  let cur = null;
  // 节点声明全局扫描：opener 最长优先（[( 圆柱 / ([ 体育场 / [ 矩形 / ( 圆角 / { 菱形）；
  // 内容非贪婪，closer 后必须紧跟箭头/行尾/&，否则 <small> 路径里的 [websiteId]、(外部) 会被误当收尾
  const DECL_RE = /([A-Za-z_]\w*)\s*(\[\(|\(\[|\[|\(|\{)([\s\S]*?)(\)\]|\]\)|\]|\)|\})(?=\s*(?:-->|-\.->|---|&|$))/g;
  const addNode = (id, shape, contentRaw) => {
    if (nodes.has(id)) return;
    const inner = contentRaw.replace(/^\s*["“”']+/, '').replace(/["“”']+\s*$/, '').trim();
    const smallM = inner.match(/<small>([\s\S]*?)<\/small>/);
    const small = (smallM ? smallM[1] : '').trim();
    const head = inner.split('<small>')[0].replace(/<br\s*\/?>/g, ' ').replace(/\s+/g, ' ').trim();
    // 路径 token 允许 Next.js 约定段 (route-group)/[dynamic]，否则 src/app/(main)/x 会被截断成 src/app
    // 目录形式允许 "store/" 结尾（斜杠后零字符），否则 Datastore 这类存储执行器提取不到路径
    const tok = (small.match(/[A-Za-z0-9_./()\[\]-]+\.(?:py|js|ts|go|ya?ml|sh|toml|json|html|css|sql)/i) || [])[0]
      || (small.match(/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./()\[\]-]*/) || [])[0]
      || '';
    // 圆柱 [("…(外部)")] 是外部基础设施，不是 actor
    const info = { id, shape, head, small, path: tok.replace(/\/$/, ''), layer: cur ? cur.title : null, actor: shape !== '[(' && /\(外部\)/.test(small) };
    nodes.set(id, info);
    if (cur) cur.nodes.push(id);
  };
  for (const raw0 of code.split(/\n/)) {
    const line = raw0.trim();
    const sg = line.match(/^subgraph\s+([A-Za-z_]\w*)\s*\["?(.+?)"?\]\s*$/);
    if (sg) { cur = { id: sg[1], title: sg[2], nodes: [] }; layers.push(cur); continue; }
    if (/^end\b/.test(line)) { cur = null; continue; }
    if (/^(flowchart|graph|classDef|class|style|direction|linkStyle|subgraph)\b/.test(line)) continue;
    let m;
    DECL_RE.lastIndex = 0;
    while ((m = DECL_RE.exec(line))) addNode(m[1], m[2], m[3]);
  }
  return { nodes, layers };
}

function structureGates(md, anchors, importance, productTokens) {
  const issues = [];
  const blocks = parseMermaid(md);
  const main = blocks[0] || '';
  const { nodes, layers } = parseBlockStructure(main);
  const g = parseFlowchart(main);
  const selfTokens = (productTokens && productTokens.length) ? productTokens : selfActorTokens();

  const layerKey = (title, id) => {
    // subgraph id 是规划阶段生成的稳定英文 key（L_storage/L_api…）；LLM 可能把标题写成英文
    // （umami 教训：标题 "🗄️ storage" 不含「存储/数据」，中文正则失配导致整图层判全漏）
    const m = String(id || '').match(/^L_([a-z]+)$/i);
    if (m && ['frontend', 'api', 'schedule', 'worker', 'storage', 'monitor', 'ops'].includes(m[1].toLowerCase())) return m[1].toLowerCase();
    if (/前端|交互|界面|展示|frontend|\bui\b/i.test(title)) return 'frontend';
    if (/存储|数据|storage|store|persisten/i.test(title)) return 'storage';
    if (/交付|运维|部署|ops|deploy/i.test(title)) return 'ops';
    if (/api|后端|接口|backend/i.test(title)) return 'api';
    if (/调度|队列|schedule|queue|cron/i.test(title)) return 'schedule';
    if (/worker|采集|抓取|异步|处理|process/i.test(title)) return 'worker';
    if (/通知|监控|消息|monitor|notif|messag/i.test(title)) return 'monitor';
    return null;
  };
  const nodeLayer = new Map();
  for (const l of layers) { const k = layerKey(l.title, l.id); for (const id of l.nodes) nodeLayer.set(id, k); }

  const deg = new Map();
  for (const e of g.edges) {
    deg.set(e.from, (deg.get(e.from) || 0) + 1);
    deg.set(e.to, (deg.get(e.to) || 0) + 1);
  }

  const realtimeAnchors = (anchors || []).filter((a) => a.role === 'realtime').map((a) => a.path);
  const entryAnchors = (anchors || []).filter((a) => a.role === 'entry').map((a) => a.path);
  const pathMatch = (np, ap) => {
    const n = String(np).replace(/\/$/, ''), a = String(ap).replace(/\/$/, '');
    return n === a || n.endsWith('/' + a) || a.endsWith('/' + n) || path.basename(n) === path.basename(a);
  };

  // ops 节点（与 visualGates 同口径；圆柱存储不算 ops）
  const opsIds = new Set();
  for (const [id, n] of nodes) {
    if (n.shape === '[(') continue;
    if (/(^|_)(docker|compose|dockerfile|image|container|deploy|ci)(_|$)/i.test(id)
      || /dockerfile|docker[ -]?compose|compose\.ya?ml|镜像|ghcr\.io|容器镜像/i.test(n.head)
      || /(^|\/)?(dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/i.test(n.path)) opsIds.add(id);
  }

  // 1) 同路径重复节点
  //   L1 edge 误伤修订（SCORE-L1-EDGE-7S-VS-ORCH4）：
  //   a) 目录级 path（无扩展名）豁免：仓库常出现 data/ 目录既挂缓存圆柱又挂 DB 圆柱，语义分裂合法；
  //      另外两个节点同目录但分别是「主链路入口文件」vs「目录级职责」时也常被 LLM 用作层级分组。
  //   b) 同源码文件 path 但职责不重叠时豁免（如 server.go 同时画 HTTP API 入口与延时消息投递职责）：
  //      通过 head 关键词 + 层归属不同判断为「同一大模块的两个切面」，不算重复。
  const byPath = new Map();
  for (const [id, n] of nodes) {
    if (!n.path || n.path === '(外部)') continue;
    if (!byPath.has(n.path)) byPath.set(n.path, []);
    byPath.get(n.path).push({ id, n });
  }
  for (const [p, items] of byPath) {
    if (items.length <= 1) continue;
    // a) 目录 path（不含扩展名，最后一段无 .）→ 豁免
    const isDirPath = !/\.[a-z0-9]{1,6}$/i.test(p);
    if (isDirPath) continue;
    // b) 所有节点分层不同 / 关键词明显不同（API 入口 vs 消息调度 vs 业务处理等）→ 豁免
    const layers = new Set(items.map((x) => nodeLayer.get(x.id)));
    if (layers.size >= items.length && layers.size >= 2) continue;
    const heads = items.map((x) => (x.n.head || '').trim().toLowerCase());
    const KEY_SIG = /(http|api|路由|入口|controller|handler|handler|router|endpoint|server)\b.*\b(调度|sched|cron|job|queue|投递|worker|任务|consumer|消费|事件|notif)/i;
    const joined = heads.join(' | ');
    if (KEY_SIG.test(joined)) continue;
    issues.push({ severity: 'high', kind: 'dup-path',
      issue: `同路径重复节点：${items.map((x) => x.id).join('、')} 都指向 ${p}`,
      fix: '合并为一个节点：保留主链路上的那个、删除重复声明，所有边改连保留节点；同一文件/目录禁止出现两个节点（同一模块多职责用 head 里的「与/兼」表达，不要拆节点）' });
  }

  // 注：孤立节点统一下方第 7 段按 mermaid 块检测（覆盖子图1+子图2，避免重复报告）

  // 3) 数据库/中间件被画成外部 actor
  const hasDbCylinder = [...nodes.values()].some((n) => n.shape === '[(' && INFRA_RE.test(n.head + ' ' + n.path));
  for (const [id, n] of nodes) {
    const isActor = n.actor || /^actor_/.test(id) || (n.shape === '([' && !n.layer);
    if (isActor && INFRA_RE.test(n.head)) {
      issues.push({ severity: 'high', kind: 'actor-infra',
        issue: `外部角色「${n.head}」是数据库/中间件，不是外部 actor`,
        fix: hasDbCylinder
          ? '删除该 actor 节点，相关边改连到图中已有的数据库圆柱节点'
          : '删除该 actor；数据库应画成 storage 层圆柱节点 id[("🗄️ 名称<br/><small>真实路径</small>")]' });
    }
  }

  // 3.5) 产品自身被画成外部角色（actor 唯一性）：产品由图内各层节点表达，
  // stadium/actor_* 节点标签命中产品名 + 自指角色词（ntfy 服务器/本系统/核心服务）即臆造节点。
  // ext_* 是形态注入的固定外部系统 id，不可能是产品自身；基础设施由 actor-infra 另管
  for (const [id, n] of nodes) {
    if (/^ext_/.test(id)) continue;
    const isActor = n.actor || /^actor_/.test(id) || (n.shape === '([' && !n.layer);
    if (!isActor || INFRA_RE.test(n.head)) continue;
    if (isSelfActorName(n.head, selfTokens)) {
      issues.push({ severity: 'high', kind: 'actor-self',
        issue: `外部角色节点 ${id}（${n.head.replace(/\s+/g, ' ').trim()}）是产品自身（本系统/产品服务器），不是外部 actor`,
        fix: '删除该节点及其所有相连边：产品本身就是图的主角，由内部各层节点表达；外部角色只画产品边界之外的对象（发布者/订阅者/第三方服务/外部系统），不要把「xx服务器/本系统/核心服务」画成角色' });
    }
  }

  // 4) 圆柱数据库节点放错层（ops/frontend 里）
  for (const [id, n] of nodes) {
    if (n.shape !== '[(') continue;
    const lk = nodeLayer.get(id);
    if (lk === 'ops' || lk === 'frontend') {
      issues.push({ severity: 'high', kind: 'db-layer',
        issue: `数据库圆柱节点 ${id}（${n.head}）被放在「${n.layer}」层`,
        fix: '移到「数据存储」层；ops 层只放 Dockerfile/compose/镜像这类交付节点；外部数据库不画圆柱——stadium 声明在所有 subgraph 之外' });
    }
  }

  // 4.5) 节点 id 前缀与所在层跨越浏览器/服务器边界（LLM 自命名 frontend_* 却放进 worker 层等）；
  // umami 教训：src/tracker 是访客浏览器加载的前端脚本，被画进 worker 层后连带触发「访客直连后台任务」误判。
  // 只裁跨边界错误（前端资产↔后端层）；后端内部 worker/monitor/schedule 的边界模糊，前缀不比 plan 分层更可信，不裁。
  const BACKEND_LAYERS = ['api', 'worker', 'schedule', 'storage', 'monitor', 'ops'];
  for (const [id, n] of nodes) {
    const pm = id.match(/^(frontend|api|worker|schedule|storage|monitor|ops)_/);
    if (!pm) continue;
    const want = pm[1];
    const got = nodeLayer.get(id);
    if (!got || got === want || got === 'actor') continue;
    const crosses = (want === 'frontend' && BACKEND_LAYERS.includes(got))
      || (got === 'frontend' && BACKEND_LAYERS.includes(want));
    if (crosses) {
      issues.push({ severity: 'high', kind: 'layer-mismatch',
        issue: `节点 ${id}（${n.head}）按 id 前缀属于「${want}」层，却被放在「${n.layer}」层（跨浏览器/服务器边界）`,
        fix: `把该节点声明移到「${want}」层 subgraph 内，并把 class 行中的 ${id} 从原 class 改到 ${want} class；节点放哪层以它的运行时位置为准（浏览器里跑的脚本归前端，服务器里跑的归后端）` });
    }
  }

  // 5) 机制误标：声称实时推送但路径不是 realtime 锚点
  // L1 误伤修订（vaultwarden notifications.rs：文件名语义就是推送中枢，不用强带 ws/sse 字样）
  // a) STRONG_RT_FILE 扩：语义推送文件 (notifications/hub/push/broadcast)
  // b) HEAD_RT_TOKEN：节点词头直接带「WebSocket/SSE/长连接」时，允许结合 importance 推送锚点同目录的 nearby 路径
  const STRONG_RT_FILE = /(^|[/_-])(sse|ws|websocket|web-socket|socket|notifications?|push|hub|broadcast|stream)[\w.-]*\.(py|js|ts|go|java|rb|php|cs|rs)$/i;
  const HEAD_RT_TOKEN = /(WebSocket|SSE|长连接|realtime)/i;
  for (const [id, n] of nodes) {
    if (!n.path) continue;
    if (/实时推送|实时刷新|实时监控|实时更新|realtime|websocket|web[\s-]?socket|\bSSE\b/i.test(n.head)) {
      const ok = realtimeAnchors.some((a) => pathMatch(n.path, a)) || STRONG_RT_FILE.test(n.path)
        // b) 节点名明确写了 WebSocket/SSE，且 realtimeAnchors 存在（说明仓库确有推送机制）时，不苛刻要求同名文件
        || (realtimeAnchors.length && HEAD_RT_TOKEN.test(n.head));
      if (!ok) {
        // 前端接收端豁免（同上）
        const isFeClient = nodeLayer.get(id) === 'frontend'
          && /客户端|client/i.test(n.head)
          && /(^|\/)(static|public|assets|frontend|web|src\/mixins|src\/tracker)(\/|$)/i.test(n.path);
        if (isFeClient && realtimeAnchors.length) continue;
        issues.push({ severity: 'high', kind: 'mech-mislabel',
          issue: `节点 ${id}（${n.path}）标注为实时推送，但该路径未命中推送锚点/推送文件名规则${realtimeAnchors.length ? '；真实实时推送锚点是 ' + realtimeAnchors.join('、') : '（本仓库 importance 未识别实时推送锚点）'}`,
          fix: '按真实职责改名并归层（进程内事件总线改标「事件总线」放调度/worker 层），或删除该节点；禁止凭目录名 events/stream 臆造实时推送' });
      }
    }
  }

  // 6) 圆柱形状滥用：models/entities 等代码包画成圆柱
  const DB_BASE = /^(store|stores|db|database|datastore|prisma|repositories?|migrations?|queries)$/;
  for (const [id, n] of nodes) {
    if (n.shape !== '[(') continue;
    const base = path.basename(n.path).replace(/\.[^.]+$/, '').toLowerCase();
    const infra = INFRA_RE.test(n.head) || /\.sql$/i.test(n.path);
    if (!infra && !DB_BASE.test(base)) {
      issues.push({ severity: 'medium', kind: 'cylinder-shape',
        issue: `圆柱节点 ${id}（${n.path}）不是数据库：${base} 是代码包/目录`,
        fix: '改用矩形节点 id["📦 中文名…"]；圆柱只留给真实数据库（PostgreSQL/Redis/ClickHouse 等）或存储执行器 store/db' });
    }
  }

  // 7) 边方向闸门（统一跑全部 mermaid 块：子图1 分层全景 + 子图2 主链路特写）
  // 子图2 用 A/B/C 短 id 时按中文标题推断层；复用子图1 id 时直接用子图1 层归属
  const inferLayer = (head, small) => {
    const t = (head || '') + ' ' + (small || '');
    if (/docker|compose|镜像|部署|运维|容器/i.test(t)) return 'ops';
    if (/存储|数据库|postgres|mysql|mariadb|redis|clickhouse|mongo|sqlite|持久化/i.test(t)) return 'storage';
    // tracker/recorder 是访客浏览器端采集脚本（umami src/tracker），属前端资产
    if (/前端|页面|界面|仪表盘|报表|组件|frontend|dashboard|tracker|recorder|跟踪脚本|采集脚本/i.test(t)) return 'frontend';
    // API 判定先于 worker：「数据采集端点」是采集上报的 API 端点（umami /api/collect），不是后台任务
    if (/api|路由|接口|后端|端点|endpoint|handler|router|控制器/i.test(t)) return 'api';
    if (/通知|消息|邮件|发送|messenger|notification|smtp|渠道|推送/i.test(t)) return 'monitor';
    if (/队列|调度|queue|schedule|cron|定时/i.test(t)) return 'schedule';
    if (/worker|抓取|采集|执行器|监控类型|探测|处理器|任务管理/i.test(t)) return 'worker';
    if (/用户|管理员|访客|订阅者|被监控|目标网站|外部|浏览器|所有者/i.test(t)) return 'actor';
    return null;
  };
  const isEntryHead = (head, p) => /入口|进程启动/.test(head || '') || entryAnchors.some((a) => p && pathMatch(p, a));
  // 路由层模块（路由定义文件/目录）：只有它指向入口才是「挂载方向反」；
  // 主进程/服务器对象调度 jobs 进程（kuma -->|调度| jobs_entry）不算
  const isRouterLike = (info, id) => {
    if (!info) return false;
    const t = ' ' + (info.head || '') + ' ' + id + ' ';
    return /路由|router|routes/i.test(t);
  };

  for (let bi = 0; bi < blocks.length; bi++) {
    const code = blocks[bi];
    const { nodes: ln } = parseBlockStructure(code);
    const lg = parseFlowchart(code);
    const where = bi === 0 ? '子图1' : `子图${bi + 1}`;
    const infoOf = (id) => nodes.get(id) || ln.get(id);
    const layerOf = (id) => {
      if (nodeLayer.has(id)) return nodeLayer.get(id);
      const info = infoOf(id);
      // stadium 外部角色/外部系统（含形态注入的 ext_* 协议对端）按 actor 层参与方向判定；
      // 不能落到 inferLayer 关键词（如「消息代理」命中 monitor、「设备网络」命中 actor 口径不一），
      // 否则外部对端被当成内部节点，协议双向边被误判为环（z2m ext_broker 教训）
      if (info && (info.actor || /^actor_/.test(id) || /^ext_/.test(id) || info.shape === '([')) return 'actor';
      return info ? inferLayer(info.head, info.small) : null;
    };
    const ldeg = new Map();
    for (const e of lg.edges) { ldeg.set(e.from, (ldeg.get(e.from) || 0) + 1); ldeg.set(e.to, (ldeg.get(e.to) || 0) + 1); }
    // 孤立节点（特写块里每个节点都应在链上）
    for (const [id, n] of ln) {
      if (!ldeg.has(id)) {
        issues.push({ severity: 'high', kind: 'orphan',
          issue: `${where} 孤立节点：${id}（${(n.head || n.path || '').replace(/<br\/?>/g, ' ')}）没有任何边连接`,
          fix: '按真实运行时数据流连入/连出；若不属于默认主流程（可选/旁路组件），直接删除该节点' });
      }
    }
    // 外部角色/外部系统被画进 subgraph（仅全景块判定；特写块无 subgraph）：
    // stadium 外部节点（含 ext_db 外部数据库）必须声明在所有 subgraph 之外
    if (bi === 0) {
      for (const [id, n] of ln) {
        if (nodeLayer.has(id) && n.actor && n.shape !== '[(') {
          issues.push({ severity: 'high', kind: 'ext-in-subgraph',
            issue: `${where} 外部角色/外部系统节点 ${id}（${(n.head || '').slice(0, 24)}）被画在「${nodeLayer.get(id) || '某'}」subgraph 内`,
            fix: '把该节点的声明行移到所有 subgraph 之外（与外部用户节点同区），保持 stadium 形状与 classDef actor 上色，相连的边保持不变；嵌入式库（SQLite 等）不需要外部节点，存储层代码节点即数据落点' });
        }
      }
    }
    for (const e of lg.edges) {
      const fl = layerOf(e.from), tl = layerOf(e.to);
      const fi = infoOf(e.from), ti = infoOf(e.to);
      const actorLike = (id, info, layer) => layer === 'actor' || /^actor_/.test(id) || (info && info.actor);
      // 实时推送边（SSE/WebSocket/realtime 节点）是合法的服务端→客户端方向，豁免反向边判定。
      // 严格判定（ntfy 教训）：综合服务器节点 head 里带「实时推送」职责描述（如「HTTP 服务器与实时推送」）
      // 不代表它的每条出边都是推送边——只有「边标签是推送语义」或「专职推送节点（SSE/WS/FCM/WebPush 执行器）
      // 发往前端/角色」才豁免；否则 server_http -->|提供界面| web_frontend 会被误放行
      const isDedicatedPushNode = (info, id) =>
        /(sse|websocket|web[\s-]?socket|firebase|\bfcm\b|\bapns\b|webpush|web[\s_-]?push|event[\s-]?stream|推送执行器|推送通道|推送服务)/i
          .test(`${info ? info.head + ' ' + info.path + ' ' : ''}${id || ''}`);
      const isPush = (PUSH_RE.test(e.label || '') && (tl === 'frontend' || tl === 'actor'))
        || (isDedicatedPushNode(fi, e.from) && (tl === 'frontend' || tl === 'actor'));
      // 存储 → 前端直连（存储不主动调前端）
      if (fl === 'storage' && tl === 'frontend' && !isPush) {
        issues.push({ severity: 'medium', kind: 'cross-layer',
          issue: `${where} 存储层直连前端：${e.from} → ${e.to}`,
          fix: '存储不主动调前端：删除该边；前端取数画 前端 → API → 存储，数据返回不另画反向实线' });
      }
      // API/后端 → 前端 实线（请求方向反；实时推送豁免）
      if (!e.dashed && fl === 'api' && tl === 'frontend' && !isPush) {
        issues.push({ severity: 'medium', kind: 'edge-backwards',
          issue: `${where} 后端 → 前端的实线边：${e.from} → ${e.to}`,
          fix: '方向反：前端发起请求/订阅，画 前端 -->|请求/查询/订阅| API；响应返回不另画反向实线边；仅实时推送(SSE/WebSocket)允许 后端 -->|推送| 前端' });
      }
      // 前端 → 外部角色 实线（人操作界面，方向反）
      if (!e.dashed && fl === 'frontend' && tl === 'actor') {
        issues.push({ severity: 'medium', kind: 'edge-backwards',
          issue: `${where} 前端 → 外部角色的实线边：${e.from} → ${e.to}`,
          fix: '方向反：是人使用界面，画 外部角色 -->|访问/操作/查看| 前端；界面给人展示结果不另画反向实线边' });
      }
      // 外部角色之间直接连边（系统图里角色只通过系统交互）；
      // 人 ↔ 外部系统（消息代理/推送通道/设备网络）是形态叙事合法边——用户向 broker 发布主题、
      // 经 FCM/APNs 收推送都发生在产品边界对端（z2m/ntfy 教训），只有 人 ↔ 人 直连才报
      if (!e.dashed && fl === 'actor' && tl === 'actor') {
        const kF = actorKindOf(e.from, fi, fl), kT = actorKindOf(e.to, ti, tl);
        if (kF === 'user' && kT === 'user') {
          issues.push({ severity: 'medium', kind: 'actor-to-actor',
            issue: `${where} 两个外部角色直接相连：${e.from} → ${e.to}`,
            fix: '外部角色之间不直接画运行时边：用系统节点衔接（如 所有者 -->|嵌入脚本| 采集接口，访客 -->|访问页面| 采集接口）' });
        }
      }
      // 外部角色直连后端 API，边标签却是界面访问动作（用户必须经过前端）；
      // 采集/webhook/上报等集成端点豁免（访客浏览器直接打 collect API 是合法的）
      const uiLabel = /界面|web界面|管理后台|后台页面|打开页面|浏览|访问页面|后台|登录|认证|login/i;
      const integrationTarget = ti && /采集|collect|tracker|webhook|回调|上报|\/send|集成/i.test((ti.head || '') + ' ' + (ti.path || ''));
      if (!e.dashed && fl === 'actor' && tl === 'api' && uiLabel.test(e.label || '') && !integrationTarget) {
        issues.push({ severity: 'medium', kind: 'actor-api-bypass',
          issue: `${where} 外部角色直连后端 API：${e.from} →|${e.label}| ${e.to}（这是界面访问动作，应经过前端）`,
          fix: '画 外部角色 -->|访问/登录/查看| 前端节点，前端 -->|请求/查询| API；只有外部系统集成（webhook/采集上报）才允许 actor 直连 API' });
      }
      // 外部角色 ↔ 存储直连（人/外部系统不能直接读写数据库，必须经前端/API）
      if (!e.dashed && (fl === 'actor' || tl === 'actor') && (fl === 'storage' || tl === 'storage')) {
        issues.push({ severity: 'high', kind: 'actor-storage',
          issue: `${where} 外部角色直连存储：${e.from} →|${e.label || ''}| ${e.to}（角色不能直接读写数据库）`,
          fix: '删除该边：角色只能经界面/API 访问数据，正确链路是 角色 → 前端 → API → 存储；数据库连接一律由后端服务发起' });
      }
      // 前端 → 存储直连（前端代码里没有数据库连接，只能请求 API）
      // L1 误伤修订（caddy fileserver）：若「storage 层节点」其实是静态文件/磁盘目录（非 DB 圆柱，或头不含数据库/中间件词），
      // 且 from 是 HTTP 文件服务/静态资源 handler（api 层文件服务模块），允许 API 直接读本地静态文件——这是文件服务器的合法职责。
      if (!e.dashed && fl === 'frontend' && tl === 'storage') {
        const isStaticStore = ti
          && !INFRA_RE.test((ti.head || '') + ' ' + (ti.path || ''))
          && /(静态|文件|asset|static|fileserver|file\s*storage|store|disk|磁盘|目录|assets?)/i.test((ti.head || '') + ' ' + (ti.path || ''));
        const isFileServerFrom = fi
          && /(文件服务|fileserver|静态|file\s*server|asset\s*handler|static\s*files|serve\s*files|file\s*http)/i.test((fi.head || '') + ' ' + (fi.path || ''));
        if (!(isStaticStore && isFileServerFrom)) {
          issues.push({ severity: 'high', kind: 'frontend-storage',
            issue: `${where} 前端直连存储：${e.from} →|${e.label || ''}| ${e.to}（前端不直接读写数据库）`,
            fix: '删除该边，改画 前端 -->|请求/查询| API -->|读写| 存储；前端到数据库之间必须隔着 API 层' });
        }
      }
      // 内部节点 → 人角色：只有通知/消息类节点能给人发告警（探测目标是「外部系统」角色，不是人）
      // 推送边豁免：SSE/WebSocket/推送标签下服务端主动推给客户端/用户是合法方向
      const tgtKind = actorKindOf(e.to, ti, tl);
      if (!e.dashed && tgtKind === 'user' && ['api', 'schedule', 'worker', 'storage', 'monitor'].includes(fl)
        && !notifLike(e.from, fi) && !notifLike(e.to, ti) && !isPush) {
        issues.push({ severity: 'high', kind: 'internal-to-user',
          issue: `${where} 内部节点直连人角色：${e.from} →|${e.label || ''}| ${e.to}（调度/存储/API 不能直接联系用户）`,
          fix: `删除该边：给人发消息只能经通知服务（notification/通知/告警类节点）→ ${e.to}；探测/请求的目标连「被监控的外部系统」角色，不是用户` });
      }
      // 存储为源：存储层主动指向 API（数据库不会发起调用；消息队列投递/消费按 queue 语义另画，不在此列）
      if (!e.dashed && fl === 'storage' && tl === 'api' && !isPush) {
        issues.push({ severity: 'medium', kind: 'storage-source',
          issue: `${where} 存储层主动指向后端：${e.from} →|${e.label || ''}| ${e.to}（数据库不会发起调用）`,
          fix: '方向反：后端发起读写，画 API -->|查询/读写| 存储；数据返回不另画反向实线边' });
      }
      // 存储主动触发通知/告警/后台任务：数据库不会发起业务动作，真实触发者是写入存储后继续推进流程的业务节点
      if (!e.dashed && fl === 'storage' && (tl === 'worker' || tl === 'monitor' || tl === 'schedule') && !isPush) {
        issues.push({ severity: 'medium', kind: 'storage-trigger',
          issue: `${where} 存储层主动触发后台/通知：${e.from} →|${e.label || ''}| ${e.to}`,
          fix: `改由写入存储的上游节点触发（如 处理器/worker -->|${e.label || '触发通知'}| ${e.to}）；存储节点只被动接受读写` });
      }
      // 前端越层：前端直连 worker/调度（前端只能请求 API 或订阅推送通道，不能直达后台任务）
      if (!e.dashed && fl === 'frontend' && (tl === 'worker' || tl === 'schedule')) {
        issues.push({ severity: 'medium', kind: 'frontend-cross',
          issue: `${where} 前端越层直连${tl === 'worker' ? '后台任务' : '调度器'}：${e.from} →|${e.label || ''}| ${e.to}`,
          fix: '前端只能请求 API（或经 WebSocket 订阅推送）：画 前端 -->|请求/提交| API，再由 API -->|派发/调度| worker/调度；前端到后台任务之间必须隔着 API 层' });
      }
      // actor 入内：外部角色直连 worker/调度（人/外部系统只能触达前端页面或 API 集成端点）
      if (!e.dashed && fl === 'actor' && (tl === 'worker' || tl === 'schedule')) {
        issues.push({ severity: 'medium', kind: 'actor-internal',
          issue: `${where} 外部角色直连内部${tl === 'worker' ? '后台任务' : '调度器'}：${e.from} →|${e.label || ''}| ${e.to}`,
          fix: '外部角色只能触达前端页面或 API 集成端点（webhook/采集上报）：画 角色 -->|访问/上报| 前端/API，再由 API 派发任务给 worker/调度' });
      }
      // 展示边：worker/调度/监控 → 前端 实线（非推送；后台任务不主动调界面，结果经 API 返回或实时推送通道）
      if (!e.dashed && (fl === 'worker' || fl === 'schedule' || fl === 'monitor') && tl === 'frontend' && !isPush) {
        issues.push({ severity: 'medium', kind: 'edge-backwards',
          issue: `${where} 后台任务/监控直连前端：${e.from} →|${e.label || ''}| ${e.to}`,
          fix: '后台任务不主动调界面：删除该边；前端取数画 前端 -->|请求/查询| API，任务状态经 API 返回；仅实时推送(SSE/WebSocket)允许 后端 -->|推送| 前端' });
      }
      // 运行时 → ops 实线（部署方向反；虚线卷挂载/依赖关系豁免；actor 部署操作除外）
      if (!e.dashed && tl === 'ops' && fl && fl !== 'ops' && !actorLike(e.from, fi, fl)) {
        issues.push({ severity: 'medium', kind: 'ops-direction',
          issue: `${where} 部署方向反：${e.from} → ${e.to}（运行时节点实线指向 Docker/部署）`,
          fix: '改为 ops -.-> 运行时入口（如 docker -.->|构建镜像| main），虚线表示部署/构建关系' });
      }
      // 外部角色 → 进程入口（ntfy 教训：actor_user -->|启动服务| main_entry）：
      // 进程由部署设施启动，人不在运行时「启动/调用」main 进程；人可连前端/API集成端点/CLI。
      // CLI 节点（head 含「CLI/命令行」，如 ntfy cmd/ 子命令包）豁免——人在终端运行 CLI 命令是合法交互
      if (!e.dashed && fl === 'actor' && tl === 'api' && ti && isEntryHead(ti.head, ti.path)
        && !/CLI|命令行/i.test(`${ti.head || ''} ${ti.path || ''} ${e.to}`)) {
        issues.push({ severity: 'high', kind: 'actor-entry',
          issue: `${where} 外部角色直连进程入口：${e.from} →|${e.label || ''}| ${e.to}（人不在运行时启动/调用 main 进程）`,
          fix: '删除该边：入口只由部署设施启动（ops -.-> 入口 虚线）或自主启动服务（入口 -->|启动| API）；人与系统的交互画 角色 -->|访问/发布/订阅/运行命令| 前端/API/CLI 节点' });
      }
      // 服务端 → CLI/客户端 SDK（方向反：CLI/SDK 是调用方，服务端不会反向调用自己的客户端库）
      // L1 误伤修订（z2m mqtt_client：这是 bridge 进程内部的协议客户端，connect 在后端服务进程里运行，
      // 发布消息是合法方向，不是「人在终端运行 CLI/用户下载 SDK」那类方向反场景）。
      // 豁免：to 节点名/路径命中「运行在服务端的协议客户端词」（mqtt client / kafka producer / nats conn 等），
      // 它的层归属是内部后端层（非 actor/frontend），头含「客户端/protocol/client/lib mqtt 等」但词尾非真正人用 CLI/SDK
      if (!e.dashed && tl === 'api' && ti
        && /CLI|命令行|客户端\s*SDK|客户端库|SDK/i.test(`${ti.head || ''} ${ti.path || ''} ${e.to}`)
        && ['api', 'monitor', 'worker', 'schedule'].includes(fl) && fi
        && !/CLI|命令行|客户端\s*SDK|SDK/i.test(`${fi.head || ''} ${fi.path || ''} ${e.from}`)) {
        const toHead = (ti.head || '') + ' ' + (ti.path || '') + ' ' + e.to;
        // 服务端内部协议客户端：词头显式 mqtt/kafka/nats/redis/websocket client 等，且节点处于后端层
        const PROTO_CLIENT = /(mqtt|kafka|nats|redis|amqp|rabbit|pulsar|websocket|socket)[-\s_]*(client|producer|consumer|subscriber|publisher|conn|connection|driver|handler)/i;
        const isServerSideProtoClient = PROTO_CLIENT.test(toHead)
          && ['api', 'monitor', 'worker', 'schedule', 'storage'].includes(nodeLayer.get(e.to));
        if (!isServerSideProtoClient) {
          issues.push({ severity: 'high', kind: 'server-client-sdk',
            issue: `${where} 服务端指向客户端 SDK/CLI：${e.from} →|${e.label || ''}| ${e.to}（CLI/SDK 是调用方，方向反）`,
            fix: `方向反：画 ${e.to} -->|HTTP 请求/调用| ${e.from}；CLI 借助 SDK 时画 CLI --> SDK` });
        }
      }
      // 入口 → 前端（入口只挂载路由，前端由用户访问）；
      // 前端入口（src/main.js 这类浏览器侧启动文件，head 常含「前端入口」）豁免——它不是服务端进程入口
      if (fi && fl !== 'frontend' && isEntryHead(fi.head, fi.path) && tl === 'frontend') {
        issues.push({ severity: 'medium', kind: 'entry-frontend',
          issue: `${where} 入口节点直连前端：${e.from} → ${e.to}`,
          fix: '入口只启动/挂载 API 路由（入口 → 路由层）；前端由外部用户访问，画 actor → 前端' });
      }
      // 路由层模块 → 入口（挂载方向反：入口启动并挂载路由）；
      // 主进程/服务器调度 jobs 进程（kuma -->|调度| jobs_entry）不是挂载关系，豁免
      if (ti && isEntryHead(ti.head, ti.path) && isRouterLike(fi, e.from) && !e.dashed
        && !(fi && isEntryHead(fi.head, fi.path))) {
        issues.push({ severity: 'high', kind: 'entry-reversed',
          issue: `${where} 路由层指向进程入口：${e.from} → ${e.to}；真实依赖方向是入口启动/挂载路由`,
          fix: `把边改为 ${e.to} -->|挂载/启动| ${e.from}（入口 → 路由层）；前端请求方向另画 前端 --> 路由` });
      }
    }
    // 双向边环（A→B 与 B→A 同时存在）：与外部角色的探测/响应往返豁免；
    // 前端 ↔ 后端 且其中一条是实时推送边（请求 + 推送两条通道）豁免
    const pairMap = new Map();
    for (const e of lg.edges) {
      const fl2 = layerOf(e.from), tl2 = layerOf(e.to);
      if (fl2 === 'actor' || tl2 === 'actor') continue;
      const key = [e.from, e.to].sort().join('');
      if (!pairMap.has(key)) pairMap.set(key, []);
      pairMap.get(key).push(e);
    }
    for (const arr of pairMap.values()) {
      if (arr.length < 2) continue;
      const [a, b] = (arr[0].from < arr[0].to) ? [arr[0].from, arr[0].to] : [arr[0].to, arr[0].from];
      const ab = arr.find((e) => e.from === a && e.to === b);
      const ba = arr.find((e) => e.from === b && e.to === a);
      if (!ab || !ba) continue;
      const pushish = (ed) => {
        const info = infoOf(ed.from);
        return PUSH_RE.test(`${info ? info.head + ' ' + info.path + ' ' + info.id : ''} ${ed.label || ''}`);
      };
      const la = layerOf(a), lb = layerOf(b);
      if ((la === 'frontend' || lb === 'frontend') && (pushish(ab) || pushish(ba))) continue;
      const pushEdge = pushish(ba) ? ba : (pushish(ab) ? ab : null);
      issues.push({ severity: 'high', kind: 'edge-cycle',
        issue: `${where} 双向边成环：${a} ↔ ${b}（「${ab.label || ''}」与「${ba.label || ''}」）`,
        fix: pushEdge
          ? `保留「触发/请求/调度」方向边；推送边 ${pushEdge.from} -->|${pushEdge.label || ''}| ${pushEdge.to} 画错了终点：实时推送必须指向「前端」层节点（推给界面），不得绕回后端——把该边终点改连前端节点（与 ${pushEdge.to} 有边相连的那个前端节点），或直接删除`
          : '两个内部节点之间禁止双向实线边：保留请求/调用方向（前端 → API → 调度/worker → 存储），删除反向边；数据响应/返回不另画反向实线边' });
    }
    // 3.6) 推送边环（notify-bus 形态）：推送通道(ext_push)出边回指发布者形成路径级环
    // ntfy 教训：actor_user → http_server → push_exec → ext_push → actor_user
    {
      const PUBLISHER_RE = /发布|publisher|sender|发送者|投稿|author|作者/;
      const SUBSCRIBER_RE = /订阅|subscri|接收|receiver|读者|受众/;
      const uActors = [...ln.entries()].filter(([id, n]) => {
        const isActor = !!(n.actor || /^actor_/.test(id) || n.shape === '([');
        return isActor && actorKindOf(id, n, 'actor') === 'user';
      });
      const pubs = uActors.filter(([id, n]) => PUBLISHER_RE.test(id + ' ' + (n.head || '')));
      const subs = uActors.filter(([id, n]) => SUBSCRIBER_RE.test(id + ' ' + (n.head || '')));
      if (pubs.length && subs.length) {
        const pubIds = new Set(pubs.map(([id]) => id));
        const subIds = new Set(subs.map(([id]) => id));
        const isPushCh = (id, n) =>
          /^ext_(push|mail)/.test(id) ||
          /推送服务|推送通道|FCM|APNs|firebase|邮件服务器|mail[\s-]?server|SMTP/i.test((n ? n.head + ' ' : '') + id);
        for (const e of lg.edges) {
          if (e.dashed) continue;
          const fi = infoOf(e.from);
          if (!fi || !isPushCh(e.from, fi)) continue;
          if (pubIds.has(e.to) && !subIds.has(e.to)) {
            issues.push({ severity: 'high', kind: 'push-cycle',
              issue: `${where} 推送通道 ${e.from} →|${e.label || ''}| ${e.to}（发布者）形成路径级推送环`,
              fix: `推送通道只推给订阅者（${subs.map(([id, n]) => n.head).join('、')}），改 ${e.from} → ${subs[0][0]}` });
          }
        }
        const VIEW_RE = /订阅|查看|浏览|view|subscri|browse|查看通知|查看消息/;
        for (const e of lg.edges) {
          if (e.dashed) continue;
          if (!pubIds.has(e.from) || !VIEW_RE.test(e.label || '')) continue;
          if (lg.edges.some((x) => !x.dashed && subIds.has(x.from) && x.to === e.to)) {
            issues.push({ severity: 'medium', kind: 'push-cycle',
              issue: `${where} 发布者 ${e.from} →|${e.label}| ${e.to}（订阅者已有同目标边，越权）`,
              fix: '删除该越权边：发布者只负责发布消息，订阅/查看由订阅者完成' });
          }
        }
        const execType = (n, id) => {
          const t = ((n ? n.head + ' ' : '') + id).toLowerCase();
          if (/smtp|mail|邮件发送/.test(t)) return 'mail';
          if (/firebase|webpush|push|推送执行/.test(t)) return 'push';
          return null;
        };
        const chanType = (id, n) => {
          const t = ((n ? n.head + ' ' : '') + id).toLowerCase();
          if (/mail|smtp|邮件/.test(t)) return 'mail';
          if (/push|fcm|apns|firebase|推送/.test(t)) return 'push';
          return null;
        };
        for (const [execId, execInfo] of ln) {
          const et = execType(execInfo, execId);
          if (!et || execInfo.shape === '[(') continue;
          const outCh = lg.edges.filter((e) => !e.dashed && e.from === execId && infoOf(e.to) && isPushCh(e.to, infoOf(e.to)));
          if (outCh.length < 2) continue;
          if (!outCh.some((e) => chanType(e.to, infoOf(e.to)) === et)) continue;
          for (const e of outCh) {
            const ct = chanType(e.to, infoOf(e.to));
            if (!ct || ct === et) continue;
            issues.push({ severity: 'medium', kind: 'push-cycle',
              issue: `${where} 通知执行器 ${execId}（${et}）连到不匹配通道 ${e.to}（${ct}）`,
              fix: `删除该边：${et} 执行器只连 ${et} 通道，已有到匹配通道的边` });
          }
        }
      }
    }
  }

  // 10) 旁路/不可达组件进图：默认主流程不经过，禁止实线连主干（memos internal/scheduler 教训）
  if (importance) {
    // 实线度数：真正的旁路/可选组件不可能有 4+ 条实线边（如多进程应用的独立 worker 进程，
    // BFS 从 web 入口不可达但在图中是承上启下的骨干，changedetection worker.py 教训）
    const solidDeg = new Map();
    for (const e of g.edges) {
      if (e.dashed) continue;
      solidDeg.set(e.from, (solidDeg.get(e.from) || 0) + 1);
      solidDeg.set(e.to, (solidDeg.get(e.to) || 0) + 1);
    }
    const detachedPaths = (importance.detachedList || []).map((d) => d.path);
    for (const [id, n] of nodes) {
      if (!n.path || n.path === '(外部)') continue;
      let why = '';
      const hit = detachedPaths.find((d) => pathMatch(n.path, d));
      if (hit) why = `取证判定为旁路组件（${hit} 被引用但从进程入口不可达）`;
      else {
        try {
          const inf = importance.info(n.path);
          if (inf && inf.detached) why = `该路径 heat=${inf.heat} 但从进程入口不可达（条件注册/实验/独立工具）`;
        } catch { /* 树外路径忽略 */ }
      }
      if (!why) continue;
      if ((solidDeg.get(id) || 0) >= 4) continue; // 结构上承上启下的骨干节点（独立进程入口），放行
      const solid = g.edges.some((e) => !e.dashed && (e.from === id || e.to === id));
      const labeled = /可选|实验|旁路|optional/i.test(n.head);
      // 合规画法：已标注「可选/实验」且全部虚线连接 → 这正是闸门推荐的表达方式，放行
      if (labeled && !solid) continue;
      if (labeled && solid) {
        issues.push({ severity: 'medium', kind: 'detached-node',
          issue: `旁路组件 ${id}（${n.path}）已标注「可选/实验」但仍有实线边连主干`,
          fix: '把与该节点相连的实线边改为 -.-> 虚线，或移出主链路；可选组件不得位于实线必经路径上' });
        continue;
      }
      issues.push({ severity: 'high', kind: 'detached-node',
        issue: `旁路组件 ${id}（${n.path}）进入主图：${why}，默认部署的主流程不经过它`,
        fix: solid
          ? '删除该节点及所有相连实线边；若确需表达，只能用 -.-> 虚线连接、中文名标注「可选/实验」，且不得出现在主链路必经路径上'
          : '删除该节点；旁路组件不进入架构主图' });
    }
  }

  // 11) 幽灵节点：边行引用了从未声明的 id。注意 parseFlowchart 会静默过滤未声明端点，
  // 必须扫原始边行（剥掉边标签与行内声明内容后取 id token）（umami 教训：扫尾吞声明后 worker_tracker 被引用但无声明）
  {
    const SKIP_ID = new Set(['TB', 'LR', 'BT', 'RL', 'subgraph', 'end', 'direction', 'flowchart', 'graph', 'classDef', 'class', 'style', 'linkStyle']);
    const seen = new Set();
    for (const rawLine of main.split('\n')) {
      if (!/-->|-\.->/.test(rawLine)) continue;
      if (/^\s*(subgraph|end|flowchart|graph|classDef|class|direction|style|linkStyle)\b/.test(rawLine)) continue;
      const stripped = rawLine
        .replace(/\|[^|]*\|/g, '  ')
        .replace(/(\[\(|\(\[|\[|\(|\{)[\s\S]*?(\)\]|\]\)|\]|\)|\})/g, ' ');
      for (const id of stripped.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) {
        if (SKIP_ID.has(id) || nodes.has(id) || seen.has(id)) continue;
        seen.add(id);
        issues.push({ severity: 'high', kind: 'ghost-node',
          issue: `子图1 边引用了未声明节点：${id}（Mermaid 会渲染成裸 id 英文框）`,
          fix: `补写节点声明 ${id}["🎯 中文名<br/><small>真实路径</small>"]，或把边改连到已声明节点；禁止裸 id 出场` });
      }
    }
  }

  // 12) 访客角色连管理后台/仪表盘：访客浏览器只加载 tracker 采集脚本，不登录、不看报表（umami 教训）
  const layerOfNodeMain = (id) => {
    if (nodeLayer.has(id)) return nodeLayer.get(id);
    const n = nodes.get(id);
    if (!n) return null;
    if (n.actor || /^actor_/.test(id) || n.shape === '([') return 'actor';
    return inferLayer(n.head, n.small);
  };
  for (const e of g.edges) {
    const fi2 = nodes.get(e.from), ti2 = nodes.get(e.to);
    const fl2 = layerOfNodeMain(e.from), tl2 = layerOfNodeMain(e.to);
    if (e.dashed || fl2 !== 'actor' || tl2 !== 'frontend') continue;
    if (/访客|visitor/i.test(`${fi2 ? fi2.head : ''} ${e.from}`)
      && /仪表盘|dashboard|管理|报表|后台/.test(ti2 ? ti2.head : '')) {
      issues.push({ severity: 'medium', kind: 'visitor-admin',
        issue: `子图1 访客角色直连管理界面：${e.from} →|${e.label || ''}| ${e.to}`,
        fix: '访客不登录、不看仪表盘：画 访客 -->|加载跟踪脚本| tracker 采集脚本节点（前端层 src/tracker），再由 tracker -->|上报/发送| 采集 API（/api/record、/api/send）；管理界面只连管理员角色' });
    }
  }

  // 13) 子图2 特写叙事错配：标题是采集/上报链路，特写内容里却没有 tracker/采集端点节点（umami 教训：
  // 标题「数据采集主链路」画的却是管理员看报表）
  {
    const closeup = blocks[1] || '';
    if (closeup) {
      const beforeSecond = md.split(/```mermaid/)[1] || '';
      const heading = (beforeSecond.match(/##\s*([^\n]+)/) || [])[1] || '';
      if (/采集|上报|埋点|collect/i.test(heading)) {
        const cg = parseFlowchart(closeup);
        const cb = parseBlockStructure(closeup);
        const text = cg.edges.map((e) => `${e.label || ''}`).join(' ') + ' '
          + [...cb.nodes.values()].map((n) => `${n.head || ''} ${n.path || ''}`).join(' ');
        if (!/tracker|recorder|collect|record|\/send|埋点|采集|跟踪脚本|上报/i.test(text)) {
          issues.push({ severity: 'medium', kind: 'closeup-story',
            issue: `子图2 标题「${heading.trim()}」是采集/上报链路，但特写内容没有 tracker 脚本或采集端点（/api/record、/api/send）节点`,
            fix: '特写链应画：访客 -->|加载脚本| tracker -->|上报数据| 采集API --> 查询/写入层 --> 分析库；或把标题改成与内容一致的主流程名' });
        }
      }
    }
  }

  // 注：边方向检查统一在第 7 段按全部 mermaid 块执行（含 api→前端 / 前端→actor / actor→actor / 存储→前端 / ops 方向）

  return issues;
}

// ---------- 确定性扫尾：LLM 三轮修订仍修不掉的机械问题，程序化处理 ----------
// 1) 孤立节点：非强制锚点 → 删除声明行 + class 行中的 id（强制锚点保留，日志上报）
// 2) 响应反向边：后端/存储/worker/monitor → 前端的实线非推送边（响应被画成反向实线）→ 删除该行
//    （仅当两端都还有其他边，避免制造新孤儿；链式边不动）
// 3) 前端 → actor 实线边：存在反向 actor→前端 边则删除，否则交换端点方向
// 实时推送边（SSE/WebSocket/realtime）豁免。多轮迭代到无改动为止。
function deterministicSweep(md, anchors, productTokens) {
  const actions = [];
  const anchorPaths = new Set((anchors || []).map((a) => a.path));
  const selfTokens = (productTokens && productTokens.length) ? productTokens : selfActorTokens();

  // 层归属：优先 subgraph id（L_storage/L_api…），再标题中英文关键词（与 structureGates 同口径），
  // 文本推断兜底。umami 教训：标题写成 "🗄️ storage" 时纯中文正则失配，扫尾侧层判全漏。
  const layerKeyByTitle = (title, id) => {
    const m = String(id || '').match(/^L_([a-z]+)$/i);
    if (m && ['frontend', 'api', 'schedule', 'worker', 'storage', 'monitor', 'ops'].includes(m[1].toLowerCase())) return m[1].toLowerCase();
    if (/前端|交互|界面|展示|frontend|\bui\b/i.test(title)) return 'frontend';
    if (/存储|数据|storage|store|persisten/i.test(title)) return 'storage';
    if (/交付|运维|部署|ops|deploy/i.test(title)) return 'ops';
    if (/api|后端|接口|backend/i.test(title)) return 'api';
    if (/调度|队列|schedule|queue|cron/i.test(title)) return 'schedule';
    if (/worker|采集|抓取|异步|处理|process/i.test(title)) return 'worker';
    if (/通知|监控|消息|monitor|notif|messag/i.test(title)) return 'monitor';
    return null;
  };
  const layerOfNode = (nodes, id, nodeLayer) => {
    if (nodeLayer && nodeLayer.has(id)) return nodeLayer.get(id);
    const n = nodes.get(id);
    if (!n) return null;
    // stadium 形状 ([".."]) 是规范 actor 形状；特写链短 id（A/B/C）靠形状+标题识别
    if (n.actor || /^actor_/.test(id) || n.shape === '([') return 'actor';
    const t = n.head + ' ' + n.small;
    if (/docker|compose|镜像|部署|运维|容器/i.test(t)) return 'ops';
    if (/存储|数据库|postgres|mysql|mariadb|redis|clickhouse|mongo|sqlite|持久化|prisma|数据模型/i.test(t)) return 'storage';
    // tracker/recorder 是发到访客浏览器运行的采集脚本（umami src/tracker、src/recorder），属前端资产
    if (/前端|页面|界面|仪表盘|报表|组件|frontend|dashboard|tracker|recorder|跟踪脚本|采集脚本/i.test(t)) return 'frontend';
    // API 判定先于 worker：「数据采集端点」是采集上报 API，不是后台任务；「服务核心」是后端服务本体
    if (/api|路由|接口|后端|服务端|服务核心|端点|endpoint|handler|router|blueprint|控制器/i.test(t)) return 'api';
    if (/通知|消息|邮件|发送|messenger|notification|smtp|渠道|推送|实时/i.test(t)) return 'monitor';
    if (/队列|调度|queue|schedule|cron|定时/i.test(t)) return 'schedule';
    if (/worker|抓取|采集|执行器|监控类型|探测|处理器|任务管理/i.test(t)) return 'worker';
    if (/用户|管理员|访客|订阅者|被监控|目标网站|浏览器|所有者|外部角色/i.test(t)) return 'actor';
    return null;
  };

  const fixBlock = (code, blockIdx) => {
    const isCloseup = blockIdx >= 1; // 子图2+：主链路特写，节点声明与边同行、线性叙事链，删边会断链
    let lines = code.split('\n');
    for (let pass = 0; pass < 4; pass++) {
      // --- 0a) orch8 基础设施圆柱归位：cylinderExt 节点被误画成 stadium（(["..."])）时，
      //    强制改圆柱并移入「数据存储」子图 + class 改 storage（ext_s3/ext_zookeeper 教训）
      {
        const cylExt = (state.extList || []).filter((x) => x.shape === 'cylinder').map((x) => x.id);
        if (cylExt.length) {
          const scanSgs = () => {
            const out = []; const st = [];
            lines.forEach((l, i) => {
              const m = l.match(/^\s*subgraph\s+([A-Za-z_]\w*)\s*\["?(.+?)"?\]\s*$/);
              if (m) { const sg = { id: m[1], title: m[2], start: i, end: -1, key: layerKeyByTitle(m[2], m[1]) }; out.push(sg); st.push(sg); }
              else if (/^\s*end\s*$/.test(l) && st.length) { st.pop().end = i; }
            });
            return out.filter((sg) => sg.end >= 0);
          };
          const declIdx = new Map();
          lines.forEach((l, i) => {
            for (const id of cylExt) {
              const m = l.match(new RegExp('^\\s*' + id + '\\s*\\(\\[([\\s\\S]*?)\\]\\)\\s*;?\\s*$'));
              if (m) declIdx.set(id, { idx: i, label: m[1] });
            }
          });
          const targets = [...declIdx.keys()];
          if (targets.length && scanSgs().length) {
            const declText = new Map();
            for (const id of targets) {
              // 统一 🗄️ 前缀、剥离标签开头残留 emoji（📦/🌍 等）
              const label = declIdx.get(id).label.replace(/^[^\u4e00-\u9fa5A-Za-z]+/, '');
              declText.set(id, `${id}[("🗄️ ${label}")]`);
            }
            const drop = new Set([...declIdx.values()].map((v) => v.idx));
            lines = lines.filter((_, i) => !drop.has(i));
            let storage = scanSgs().find((x) => x.key === 'storage');
            if (!storage) {
              const all = scanSgs();
              const lastEnd = all.length ? Math.max(...all.map((x) => x.end)) : lines.length - 1;
              lines.splice(lastEnd + 1, 0,
                '    subgraph L_storage["🗄️ 数据存储"]',
                '        direction LR',
                '    end');
              storage = scanSgs().find((x) => x.key === 'storage');
            }
            lines.splice(storage.end, 0, ...targets.map((id) => '        ' + declText.get(id)));
            lines = lines.map((l) => {
              const m = l.match(/^(\s*class\s+)([A-Za-z0-9_,\s]+?)\s+([A-Za-z_]\w*)\s*;?\s*$/);
              if (!m) return l;
              const ids = m[2].split(',').map((s) => s.trim()).filter(Boolean);
              if (/^storage/.test(m[3])) {
                for (const id of targets) if (!ids.includes(id)) ids.push(id);
                return `${m[1]}${ids.join(',')} ${m[3]}`;
              }
              const kept = ids.filter((x) => !targets.includes(x));
              return kept.length ? `${m[1]}${kept.join(',')} ${m[3]}` : '';
            }).filter((l) => l !== '');
            if (!lines.some((l) => /^\s*class\s+[A-Za-z0-9_,\s]+\s+storage\w*\s*;?\s*$/.test(l))) {
              let lastClass = -1;
              lines.forEach((l, i) => { if (/^\s*class\s+/.test(l)) lastClass = i; });
              lines.splice(lastClass + 1, 0, `    class ${targets.join(',')} storageColor`);
            }
            actions.push(`基础设施圆柱归位：${targets.join(',')} 从外部角色区改为存储层圆柱`);
          }
        }
      }
      // --- 0b) 通用兜底：stadium 声明的节点若标签/ID 是数据库/中间件名（shape 模板 ext_db、
      //   未知 ext_*），则它不可能是真外部 actor → 强制改圆柱归位 storage（vaultwarden r1 ext_db
      //   教训：shape api-svc 默认 ext_db 是 stadium，externalSystems 里同名圆柱被去重）
      {
        // 真存储/中间件关键词：词名具体，避免"协调器/设备/网络/串口/总线"误伤协议对端
        const SWEEP_INFRA_RE = /postgres(?:ql)?|postgre|mysql|mariadb|redis|clickhouse|mongodb|\bmongo\b|sqlite|elasticsearch|\belastic\b|kafka|rabbitmq|\bnats\b|zookeeper|zoo[_-]?keeper|minio|\bs3\b|ceph|\boss\b|对象存储|(?:\bdatabase\b|\bdb\b|数据库|broker存储|消息队列)/i;
        const NETWORK_HINT_RE = /zigbee|modbus|ble|bluetooth|matter|thread|lora|knx|opc.?ua|canbus|bacnet|serial|串口|device|设备网络|协调器|终端设备|broker|网络/i;
        const scanSgs = () => {
          const out = []; const st = [];
          lines.forEach((l, i) => {
            const m = l.match(/^\s*subgraph\s+([A-Za-z_]\w*)\s*\["?(.+?)"?\]\s*$/);
            if (m) { const sg = { id: m[1], title: m[2], start: i, end: -1, key: layerKeyByTitle(m[2], m[1]) }; out.push(sg); st.push(sg); }
            else if (/^\s*end\s*$/.test(l) && st.length) { st.pop().end = i; }
          });
          return out.filter((sg) => sg.end >= 0);
        };
        const decl = [];
        lines.forEach((l, i) => {
          const m = l.match(/^\s*([A-Za-z_]\w*)\s*\(\["([\s\S]*?)"\]\)\s*;?\s*$/);
          if (!m) return;
          const id = m[1], label = m[2];
          if (!SWEEP_INFRA_RE.test(id + ' ' + label)) return;
          // 排除真外部 actor/用户；排除协议/设备/网络协议对端（它们可能含 broker/协调器）
          if (/^(actor_|user_?\d*$|client|audience|owner|admin$|dev(eloper)?$|system_?\d*$)/i.test(id)) return;
          if (NETWORK_HINT_RE.test(id + ' ' + label) && !/\b(postgres|mysql|maria|redis|mongo|kafka|minio|s3|elastic|nats|zookeeper)\b/i.test(id + ' ' + label)) return;
          decl.push({ id, label, idx: i });
        });
        if (decl.length && scanSgs().length) {
          const declText = new Map();
          for (const d of decl) {
            const clean = d.label.replace(/^[^\u4e00-\u9fa5A-Za-z]+/, '').replace(/<br[^>]*>.*$/, '');
            declText.set(d.id, `${d.id}[("🗄️ ${clean}")]`);
          }
          const drop = new Set(decl.map((d) => d.idx));
          lines = lines.filter((_, i) => !drop.has(i));
          const sgs = scanSgs();
          let storage = sgs.find((x) => x.key === 'storage');
          if (!storage) {
            const lastEnd = sgs.length ? Math.max(...sgs.map((x) => x.end)) : lines.length - 1;
            lines.splice(lastEnd + 1, 0,
              '    subgraph L_storage["🗄️ 数据存储"]',
              '        direction LR',
              '    end');
            storage = scanSgs().find((x) => x.key === 'storage');
          }
          const ids = decl.map((d) => d.id);
          lines.splice(storage.end, 0, ...ids.map((id) => '        ' + declText.get(id)));
          lines = lines.map((l) => {
            const m = l.match(/^(\s*class\s+)([A-Za-z0-9_,\s]+?)\s+([A-Za-z_]\w*)\s*;?\s*$/);
            if (!m) return l;
            const parts = m[2].split(',').map((s) => s.trim()).filter(Boolean);
            if (/^storage/.test(m[3])) {
              for (const id of ids) if (!parts.includes(id)) parts.push(id);
              return `${m[1]}${parts.join(',')} ${m[3]}`;
            }
            if (/^actor|userColor/.test(m[3])) {
              const kept = parts.filter((x) => !ids.includes(x));
              return kept.length ? `${m[1]}${kept.join(',')} ${m[3]}` : '';
            }
            return l;
          }).filter((l) => l !== '');
          if (!lines.some((l) => /^\s*class\s+[A-Za-z0-9_,\s]+\s+storage\w*\s*;?\s*$/.test(l))) {
            let lastClass = -1;
            lines.forEach((l, i) => { if (/^\s*class\s+/.test(l)) lastClass = i; });
            lines.splice(lastClass + 1, 0, `    class ${ids.join(',')} storageColor`);
          }
          actions.push(`stadium 伪基础设施转圆柱归位：${ids.join(',')}（stadium DB/中间件不可能是真外部 actor）`);
        }
      }
      // --- 0c) 外部角色「部署/启动」进程入口假边：部署关系归 ops（deployments -.部署.-> entry），
      //    人不在运行时启动/调用 main 进程；ops 已有部署虚线边时删除该假边（actor-entry 闸门）
      {
        const bsEdge = parseBlockStructure(code);
        const entryIds = new Set();
        const actorIds = new Set();
        for (const [id, n] of (bsEdge.nodes || new Map())) {
          const p = n.path || '';
          if (/(^|\/)cmd\/|(^|\/)main\.(go|py|rs|js|ts)$/.test(p)) entryIds.add(id);
          if (n.shape === '([' && (/^actor_/.test(id) || /👤|用户|开发者|管理员|访客|发布者|订阅者/.test(n.head || ''))) actorIds.add(id);
        }
        if (entryIds.size && actorIds.size) {
          const before = lines.length;
          lines = lines.filter((l) => {
            const m = l.match(/^\s*([A-Za-z_]\w*)\s*(?:-\.->|-->)\|([^|]*)\|\s*([A-Za-z_]\w*)\b/);
            if (!m) return true;
            const [, from, label, to] = m;
            if (actorIds.has(from) && entryIds.has(to) && /部署|启动|deploy|运行/i.test(label)) return false;
            return true;
          });
          if (lines.length < before) actions.push('删除外部角色直连进程入口的「部署/启动」假边（部署归 ops 节点）');
        }
      }
      // --- 0) 圆柱存储节点错层归位：[( 圆柱 + 基础设施名 却位于非 storage 子图 ---
      // 连声明行带 class 分配一起移到「数据存储」层（listmonk 教训：compose 里的外部 postgres 被画进 ops 层）
      let relocN = 0;
      {
        const scanSubgraphs = () => {
          const out = []; const st = [];
          lines.forEach((l, i) => {
            const m = l.match(/^\s*subgraph\s+([A-Za-z_]\w*)\s*\["?(.+?)"?\]\s*$/);
            if (m) { const sg = { id: m[1], title: m[2], start: i, end: -1, key: layerKeyByTitle(m[2], m[1]) }; out.push(sg); st.push(sg); }
            else if (/^\s*end\s*$/.test(l) && st.length) { st.pop().end = i; }
          });
          return out.filter((sg) => sg.end >= 0);
        };
        const sgs0 = scanSubgraphs();
        if (sgs0.length) { // 仅子图1 分层全景有 subgraph；特写块跳过
          const bs0 = parseBlockStructure(lines.join('\n'));
          // 节点 id → 声明它的 subgraph
          const ownerOf = new Map();
          for (const sg of sgs0) {
            for (let i = sg.start + 1; i < sg.end; i++) {
              let m;
              const re = /(^|[^\w])([A-Za-z_]\w*)\s*(\[\(|\(\[|\[|\(|\{)/g;
              while ((m = re.exec(lines[i]))) {
                if (!ownerOf.has(m[2])) ownerOf.set(m[2], sg);
              }
            }
          }
          const DB_BASE_RE = /^(store|stores|db|database|datastore|prisma|repositories?|migrations?|queries)$/;
          const misplaced = [];
          for (const [id, n] of bs0.nodes) {
            if (n.shape !== '[(') continue;
            const base = path.basename(n.path || '').replace(/\.[^.]+$/, '').toLowerCase();
            const isStore = INFRA_RE.test(n.head + ' ' + n.path) || DB_BASE_RE.test(base) || /\.sql$/i.test(n.path || '');
            if (!isStore) continue;
            const sg = ownerOf.get(id);
            // infra 圆柱声明在所有 subgraph 外（外部角色区）也归位 storage——
            // 圆柱是存储层形状，飘在外部会被边闸门当 actor（db_layer --> ext_mongo 误判 actor-storage）
            if (!sg) {
              if (INFRA_RE.test(n.head + ' ' + n.path)) misplaced.push({ id, from: null });
            } else if (sg.key && sg.key !== 'storage') {
              misplaced.push({ id, from: sg });
            }
          }
          // 声明行必须是独立行（块0 惯例），行内声明不动
          const declIdx = new Map();
          lines.forEach((l, i) => {
            for (const x of misplaced) {
              if (new RegExp('^\\s*' + x.id + '\\s*\\[\\(').test(l)) declIdx.set(x.id, i);
            }
          });
          const movables = misplaced.filter((x) => declIdx.has(x.id));
          if (movables.length) {
            const declText = new Map();
            for (const x of movables) declText.set(x.id, lines[declIdx.get(x.id)].trim());
            // 1) 删原声明行
            const drop = new Set([...declIdx.values()]);
            lines = lines.filter((_, i) => !drop.has(i));
            // 2) 定位/新建 storage 子图（行号已变，重新扫描）
            let storage = scanSubgraphs().find((x) => x.key === 'storage');
            if (!storage) {
              const all = scanSubgraphs();
              const lastEnd = all.length ? Math.max(...all.map((x) => x.end)) : (lines.length - 1);
              lines.splice(lastEnd + 1, 0,
                '    subgraph L_storage["🗄️ 数据存储"]',
                '        direction LR',
                '    end');
              storage = scanSubgraphs().find((x) => x.key === 'storage');
            }
            // 3) 插入 storage 子图 end 之前
            lines.splice(storage.end, 0, ...movables.map((x) => '        ' + declText.get(x.id)));
            // 4) 修正 class：从非 storage class 行移除，并入 storage class 行；无 storage class 行则补
            // （正则容忍 LLM 常写的行尾分号；曾因漏配分号导致旧 class 残留、新 class 重复添加）
            const movedIds = movables.map((x) => x.id);
            lines = lines.map((l) => {
              const m = l.match(/^(\s*class\s+)([A-Za-z0-9_,\s]+?)\s+([A-Za-z_]\w*)\s*;?\s*$/);
              if (!m) return l;
              const ids = m[2].split(',').map((s) => s.trim()).filter(Boolean);
              if (m[3] === 'storage') {
                for (const id of movedIds) if (!ids.includes(id)) ids.push(id);
                return `${m[1]}${ids.join(',')} storage`;
              }
              const kept = ids.filter((x) => !movedIds.includes(x));
              return kept.length ? `${m[1]}${kept.join(',')} ${m[3]}` : '';
            }).filter((l) => l !== '');
            if (!lines.some((l) => /^\s*class\s+[A-Za-z0-9_,\s]+\s+storage\s*;?\s*$/.test(l))) {
              let lastClass = -1;
              lines.forEach((l, i) => { if (/^\s*class\s+/.test(l)) lastClass = i; });
              const clsLine = `    class ${movedIds.join(',')} storage`;
              if (lastClass >= 0) lines.splice(lastClass + 1, 0, clsLine); else lines.push(clsLine);
            }
            for (const x of movables) {
              relocN++;
              actions.push(`圆柱存储节点归位：${x.id} 从「${x.from ? x.from.title : '外部角色区'}」层移到「数据存储」层并修正 class`);
            }
          }
        }
      }

      // --- 0.6) id 前缀与所在层矛盾归位：frontend_* 被放进 worker 层等（LLM 自命名自矛盾；
      // umami 教训：src/tracker 追踪脚本是访客浏览器加载的前端资产，错放 worker 层会连带误判「访客直连后台任务」）
      let reloc2N = 0;
      {
        const scanSg = () => {
          const out = []; const st = [];
          lines.forEach((l, i) => {
            const m = l.match(/^\s*subgraph\s+([A-Za-z_]\w*)\s*\["?(.+?)"?\]\s*$/);
            if (m) { const sg = { id: m[1], title: m[2], start: i, end: -1, key: layerKeyByTitle(m[2], m[1]) }; out.push(sg); st.push(sg); }
            else if (/^\s*end\s*$/.test(l) && st.length) { st.pop().end = i; }
          });
          return out.filter((sg) => sg.end >= 0);
        };
        const sgsX = scanSg();
        if (sgsX.length) {
          const bsX = parseBlockStructure(lines.join('\n'));
          const ownerOf = new Map();
          for (const sg of sgsX) {
            for (let i = sg.start + 1; i < sg.end; i++) {
              let m;
              const re = /(^|[^\w])([A-Za-z_]\w*)\s*(\[\(|\(\[|\[|\(|\{)/g;
              while ((m = re.exec(lines[i]))) {
                if (!ownerOf.has(m[2])) ownerOf.set(m[2], sg);
              }
            }
          }
          const PREFIX_LAYER = ['frontend', 'api', 'worker', 'schedule', 'storage', 'monitor', 'ops'];
          const BACKEND_LY = ['api', 'worker', 'schedule', 'storage', 'monitor', 'ops'];
          // 浏览器端资产路径：发到访客浏览器运行的脚本/页面/静态资源（umami src/tracker、src/recorder 教训：
          // LLM 按「采集」语义把它们放进 worker 层，但它们是前端资产）
          const FRONTEND_ASSET_RE = /(^|\/)(tracker|recorder|templates|static|frontend|web|ui|public|assets|components|pages)(\/|$)/i;
          const misplaced = [];
          const pushMisplaced = (id, want, sg) => {
            if (!misplaced.some((m) => m.id === id)) misplaced.push({ id, want, from: sg });
          };
          for (const id of bsX.nodes.keys()) {
            const n = bsX.nodes.get(id);
            const sg = ownerOf.get(id);
            if (!sg || !sg.key || sg.key === 'actor') continue;
            const p = n.path || n.small || '';
            // Next.js 例外：pages/api/、app/api/ 是服务端 API 路由，不是浏览器资产
            // （umami 教训：src/pages/api/ 含 /pages/ 会被前端资产正则误判，api_server 被错移到前端层）
            const nextApiRoute = /(^|\/)(pages|app)\/api(\/|$)/.test(p);
            const isFrontAsset = (!nextApiRoute && FRONTEND_ASSET_RE.test(p)) || /tracker|recorder|跟踪脚本|采集脚本/i.test(n.head || '');
            // 规则 A：id 前缀与所在层矛盾（LLM 自命名自矛盾）
            const pm = id.match(/^(frontend|api|worker|schedule|storage|monitor|ops)_/);
            if (pm) {
              const want = pm[1];
              if (sg.key !== want) {
                // 只自动归位跨浏览器/服务器边界的错误（前端资产↔后端层）；后端内部层级划分模糊，不动
                const crosses = (want === 'frontend' && BACKEND_LY.includes(sg.key))
                  || (sg.key === 'frontend' && BACKEND_LY.includes(want));
                // 路径证据优先于 id 前缀：前缀声称后端层（worker_/api_…）但路径证明是浏览器资产时，
                // 不得按前缀拉回后端——否则规则 B 刚移到前端、规则 A 下轮又拉回，两层之间来回振荡
                const prefixLiesToBackend = crosses && BACKEND_LY.includes(want) && isFrontAsset;
                if (crosses && !prefixLiesToBackend) pushMisplaced(id, want, sg);
              }
            }
            // 规则 B：路径证明是浏览器端资产却被放进后端层（id 前缀与错层一致时规则 A 抓不到）
            if (isFrontAsset && BACKEND_LY.includes(sg.key)) pushMisplaced(id, 'frontend', sg);
          }
          // 规则 C（改名集合，与移动分离处理）：id 前缀层 ≠ 所在子图层，且都在后端层内
          const backendRename = [];
          for (const id of bsX.nodes.keys()) {
            const n = bsX.nodes.get(id);
            const sg = ownerOf.get(id);
            if (!sg || !sg.key) continue;
            const pm = id.match(/^(frontend|api|worker|schedule|storage|monitor|ops)_([a-z0-9_]+)$/i);
            if (!pm) continue;
            const fromLayer = pm[1].toLowerCase();
            if (!BACKEND_LY.includes(fromLayer) || !BACKEND_LY.includes(sg.key) || fromLayer === sg.key) continue;
            const stem = pm[2];
            if (new RegExp('^' + sg.key, 'i').test(stem)) continue; // 已含层名（monitor_types 在 monitor 层），不重复改
            const newId = `${sg.key}_${stem}`;
            if (bsX.nodes.has(newId)) continue;
            backendRename.push({ id, newId });
          }
          // 跨边界修复的 id 不再参与后端内部改名（同一节点禁止既改名又移动，曾造 class 幽灵 id）
          const boundaryIds = new Set(misplaced.map((x) => x.id));
          // 独立声明行才移动（行内声明不动；特写块无 subgraph 自然跳过）
          const declIdx = new Map();
          lines.forEach((l, i) => {
            for (const x of misplaced) {
              if (new RegExp('^\\s*' + x.id + '\\s*[\\[\\(\\{]').test(l)) declIdx.set(x.id, i);
            }
          });
          const movables = misplaced.filter((x) => declIdx.has(x.id));
          // 目标层子图存在才移动；目标层缺失（如 umami 无 worker 层，但 tracker 是浏览器端前端资产、
          // LLM 误起 worker_ 前缀却放进前端层）→ 原地把 id 前缀改成所在层，绝不删声明（曾吞掉声明造幽灵节点）
          const toMove = [], toRename = [];
          for (const x of movables) {
            if (scanSg().some((s) => s.key === x.want)) toMove.push(x);
            else toRename.push(x);
          }
          const renameMap = new Map(); // oldId -> newId
          const usedNewIds = new Set(bsX.nodes.keys());
          const planRename = (oldId, newId, action) => {
            if (!newId || newId === oldId || usedNewIds.has(newId) || renameMap.has(oldId)) return;
            usedNewIds.add(newId);
            renameMap.set(oldId, newId);
            reloc2N++;
            actions.push(action);
          };
          // 1) 目标层缺失：原地按所在层改名，声明一行不动
          for (const x of toRename) {
            const stem = x.id.replace(/^[a-z]+_/, '');
            planRename(x.id, `${x.from.key}_${stem}`,
              `节点 id 前缀按所在层改名（目标层不存在，声明保留）：${x.id} → ${x.from.key}_${stem}（${x.from.title}）`);
          }
          // 2) 跨边界移动：id 前缀与目标层矛盾时随移动一起改名（如 worker_tracker 移入 frontend 层
          //    → frontend_tracker）。不改名则下一轮规则 A 会按前缀往回拉，与规则 B 在两层间振荡
          for (const x of toMove) {
            const pmId = x.id.match(/^([a-z]+)_([a-z0-9_]+)$/i);
            if (pmId && pmId[1].toLowerCase() !== x.want) {
              planRename(x.id, `${x.want}_${pmId[2]}`,
                `节点跨层归位并随层改名：${x.id} → ${x.want}_${pmId[2]}（移入「${x.want}」层）`);
            }
          }
          // 3) 后端内部改名（排除已做跨边界修复的 id）
          for (const r of backendRename) {
            if (boundaryIds.has(r.id)) continue;
            planRename(r.id, r.newId,
              `节点 id 前缀与所在层统一（后端内部改名，位置不变）：${r.id} → ${r.newId}`);
          }
          if (renameMap.size) {
            lines = lines.map((l) => {
              let out = l;
              for (const [oldId, newId] of renameMap) {
                out = out.replace(new RegExp('\\b' + oldId + '\\b', 'g'), newId);
              }
              return out;
            });
          }
          if (toMove.length) {
            const finalId = (id) => renameMap.get(id) || id;
            const declText = new Map();
            for (const x of toMove) declText.set(x.id, lines[declIdx.get(x.id)].trim());
            const dropIdx = new Set(toMove.map((x) => declIdx.get(x.id)));
            lines = lines.filter((_, i) => !dropIdx.has(i));
            const movedByWant = new Map();
            for (const x of toMove) {
              const target = scanSg().find((s) => s.key === x.want);
              const fid = finalId(x.id);
              if (target) {
                lines.splice(target.end, 0, '        ' + declText.get(x.id));
                actions.push(`节点按 id 前缀归位：${fid} 从「${x.from.title}」层移到「${x.want}」层并修正 class`);
              } else {
                // 安全网：目标层在删行后消失（理论上不应发生）时，把声明插回原子图 end 前——
                // 任何情况下不得丢失声明（幽灵节点根因：先删后插，插入失败即吞节点）
                const back = scanSg().find((s) => s.id === x.from.id) || scanSg().find((s) => s.key === x.from.key);
                const at = back ? back.end : lines.length - 1;
                lines.splice(at, 0, '        ' + declText.get(x.id));
                actions.push(`目标层缺失，声明保留在原层：${fid}（${x.from.title}）`);
              }
              reloc2N++;
              if (!movedByWant.has(x.want)) movedByWant.set(x.want, []);
              movedByWant.get(x.want).push(fid);
            }
            // class 行：从旧层 class 移出、并入目标层 class；目标 class 行不存在则补
            // （正则容忍 LLM 常写的行尾分号；曾因漏配分号导致旧 class 残留、新 class 重复添加）
            lines = lines.map((l) => {
              const m = l.match(/^(\s*class\s+)([A-Za-z0-9_,\s]+?)\s+([A-Za-z_]\w*)\s*;?\s*$/);
              if (!m) return l;
              let ids = m[2].split(',').map((s) => s.trim()).filter(Boolean);
              const cls = m[3];
              let changed = false;
              for (const [want, wantIds] of movedByWant) {
                if (cls === want) {
                  for (const id of wantIds) if (!ids.includes(id)) { ids.push(id); changed = true; }
                } else if (PREFIX_LAYER.includes(cls)) {
                  const before = ids.length;
                  ids = ids.filter((x) => !wantIds.includes(x));
                  if (ids.length !== before) changed = true;
                }
              }
              if (!changed) return l;
              return ids.length ? `${m[1]}${ids.join(',')} ${cls}` : '';
            }).filter((l) => l !== '');
            for (const [want, wantIds] of movedByWant) {
              if (!lines.some((l) => new RegExp('^\\s*class\\s+[A-Za-z0-9_,\\s]+\\s+' + want + '\\s*;?\\s*$').test(l))) {
                let lastClass = -1;
                lines.forEach((l, i) => { if (/^\s*class\s+/.test(l)) lastClass = i; });
                const clsLine = `    class ${wantIds.join(',')} ${want}`;
                if (lastClass >= 0) lines.splice(lastClass + 1, 0, clsLine); else lines.push(clsLine);
              }
            }
          }
        }
      }

      // --- 0.7) 空子图删除（规范：空层不画；umami 教训：残留空 L_monitor 子图只有 direction LR）---
      {
        const sgs0 = [];
        const st0 = [];
        lines.forEach((l, i) => {
          const m = l.match(/^\s*subgraph\s+([A-Za-z_]\w*)\b/);
          if (m) { const sg = { id: m[1], start: i, end: -1 }; sgs0.push(sg); st0.push(sg); }
          else if (/^\s*end\s*$/.test(l) && st0.length) { st0.pop().end = i; }
        });
        const empties = sgs0.filter((sg) => sg.end >= 0 &&
          lines.slice(sg.start + 1, sg.end).every((l) => /^\s*direction\b/.test(l) || !/[A-Za-z_]\w*\s*(\[\(|\(\[|\[|\(|\{)/.test(l)));
        if (empties.length) {
          const drop = new Set();
          for (const sg of empties) {
            for (let i = sg.start; i <= sg.end; i++) drop.add(i);
            actions.push(`删除空分层子图：${sg.id}`);
            reloc2N++;
          }
          lines = lines.filter((_, i) => !drop.has(i))
            .filter((l) => !empties.some((sg) => new RegExp('^\\s*style\\s+' + sg.id + '\\b').test(l)));
        }
      }

      // --- 0.8) 伪 actor 节点清除（actor 唯一性）：产品自身被画成外部角色
      // （ntfy 教训：actor_ntfy「👤 ntfy服务器」是产品自己，盲评一眼判定幻觉）。
      // 产品本身就是图的主角，由内部各层节点表达；外部角色只画边界之外的对象。
      // 删独立声明行 + 相连裸边行 + class/style 引用。安全前提：该 id 的全部引用都在可整行
      // 删除/重写的行上；若出现在行内声明边（特写链 A -->|x| B[".."]）或链式多箭头行上，
      // 则跳过该 id 交给 LLM 修订，绝不制造幽灵节点。删后可能产生的新孤儿由下一步孤立节点处理兜底。
      let selfActorN = 0;
      {
        const bsS = parseBlockStructure(lines.join('\n'));
        const LINE_DECL_S = /[A-Za-z_]\w*\s*(?:\[\(|\(\[|\[|\(|\{)[\s\S]*?(?:\)\]|\]\)|\]|\)|\})(?=\s*(?:-->|-\.->|---|&|$))/;
        const selfIds = [];
        for (const [id, n] of bsS.nodes) {
          if (/^ext_/.test(id)) continue; // 形态注入的固定外部系统 id 不可能是产品自身
          const isActor = n.actor || /^actor_/.test(id) || (n.shape === '([' && !n.layer);
          if (!isActor || INFRA_RE.test(n.head)) continue;
          if (isSelfActorName(n.head, selfTokens)) selfIds.push(id);
        }
        const dropLine = new Set();
        const classLines = new Set();
        const removable = new Set();
        for (const id of selfIds) {
          let ok = true;
          const myDrop = new Set(); const myClass = new Set();
          lines.forEach((l, i) => {
            if (!ok) return;
            if (!new RegExp('\\b' + id + '\\b').test(l)) return;
            if (new RegExp('^\\s*' + id + '\\s*(?:\\[\\(|\\(\\[|\\[|\\(|\\{)').test(l)) { myDrop.add(i); return; } // 独立声明行
            if (/^\s*class\s+/.test(l)) { myClass.add(i); return; }   // class 分配行（从中剔除 id）
            if (new RegExp('^\\s*style\\s+' + id + '\\b').test(l)) { myDrop.add(i); return; } // style 行
            if (/-->|-\.->/.test(l)) {
              const arrowN = (l.match(/-->|-\.->/g) || []).length;
              if (arrowN !== 1 || LINE_DECL_S.test(l)) { ok = false; return; } // 行内声明/链式边：不能动
              myDrop.add(i); return;                                          // 裸边行：整行删
            }
            ok = false; // 其他引用（linkStyle/subgraph 标题等）：保守跳过，交给 LLM
          });
          if (ok) {
            removable.add(id);
            myDrop.forEach((x) => dropLine.add(x));
            myClass.forEach((x) => classLines.add(x));
          }
        }
        if (removable.size) {
          lines = lines.map((l, i) => {
            if (dropLine.has(i)) return null;
            if (classLines.has(i) && /^\s*class\s+/.test(l)) {
              const m = l.match(/^(\s*class\s+)([A-Za-z0-9_,\s]+?)\s+([A-Za-z_]\w*)\s*;?\s*$/);
              if (!m) return l;
              const ids = m[2].split(',').map((s) => s.trim()).filter(Boolean).filter((x) => !removable.has(x));
              return ids.length ? `${m[1]}${ids.join(',')} ${m[3]}` : null;
            }
            return l;
          }).filter((l) => l !== null);
          for (const id of removable) {
            selfActorN++;
            actions.push(`删除伪外部角色节点：${id}（产品自身被画成 actor；产品本身就是图的主角，由内部各层节点表达）`);
          }
        }
      }

      // --- 0.9) 推送边环清理（notify-bus 形态）：
      // ntfy 教训：推送通道(ext_push)同时指向发布者(actor_user)和订阅者(actor_user_2)，
      // 形成 actor_user → http_server → push_exec → ext_push → actor_user 路径级环。
      // 现有闸门只检测 A↔B 双向边，不检测这种多跳推送环。三类修复（仅全景块、仅裸边行）：
      //  a) 推送/通知通道出边指向发布者且存在订阅者 → 改指订阅者
      //  b) 发布者有"订阅/查看"类越权边且订阅者已有同目标边 → 删除
      //  c) 通知执行器(smtp/firebase…)同时连到匹配和不匹配的外部通道 → 删除不匹配的边
      let pushCycleN = 0;
      if (!isCloseup) {
        const DECL_P = /[A-Za-z_]\w*\s*(?:\[\(|\(\[|\[|\(|\{)[\s\S]*?(?:\)\]|\]\)|\]|\)|\})(?=\s*(?:-->|-\.->|---|&|$))/;
        const findEdgeLine = (ed) => {
          let idx = -1;
          lines.forEach((l, i) => {
            if (idx >= 0) return;
            if (!/-->/.test(l) || /^\s*(subgraph|classDef|class|end|flowchart|graph)\b/.test(l.trim())) return;
            if ((l.match(/-->|-\.->/g) || []).length !== 1) return;
            const re = new RegExp('\\b' + ed.from + '\\b[\\s\\S]*?-->\\s*(?:\\|[^|]*\\|\\s*)?\\b' + ed.to + '\\b');
            if (!re.test(l) || DECL_P.test(l)) return;
            idx = i;
          });
          return idx;
        };
        const pc = lines.join('\n');
        const bsP = parseBlockStructure(pc);
        const gP = parseFlowchart(pc);
        const nodesP = bsP.nodes;
        const degP = new Map();
        for (const e of gP.edges) { degP.set(e.from, (degP.get(e.from) || 0) + 1); degP.set(e.to, (degP.get(e.to) || 0) + 1); }

        const PUBLISHER_RE = /发布|publisher|sender|发送者|投稿|author|作者/;
        const SUBSCRIBER_RE = /订阅|subscri|接收|receiver|读者|受众/;
        const userActors = [...nodesP.entries()].filter(([id, n]) => {
          const isActor = !!(n.actor || /^actor_/.test(id) || n.shape === '([');
          const kind = isActor ? actorKindOf(id, n, 'actor') : null;
          return isActor && kind === 'user';
        });
        const publishers = userActors.filter(([id, n]) => PUBLISHER_RE.test(id + ' ' + (n.head || '')));
        const subscribers = userActors.filter(([id, n]) => SUBSCRIBER_RE.test(id + ' ' + (n.head || '')));
        if (process.env.SWEEP_DEBUG) {
          console.error(`[0.9] nodesP.size=${nodesP.size} userActors=${userActors.length} pubs=${publishers.length} subs=${subscribers.length} edges=${gP.edges.length}`);
          for (const [id, n] of nodesP.entries()) {
            const isActor = !!(n.actor || /^actor_/.test(id) || n.shape === '([');
            const kind = isActor ? actorKindOf(id, n, 'actor') : null;
            console.error(`  node ${id} actor=${n.actor} shape=${n.shape} isActor=${isActor} kind=${kind} head=${JSON.stringify(n.head)}`);
          }
        }

        if (publishers.length && subscribers.length) {
          const pubIds = new Set(publishers.map(([id]) => id));
          const subIds = new Set(subscribers.map(([id]) => id));
          const isPushChannel = (id, n) =>
            /^ext_(push|mail)/.test(id) ||
            /推送服务|推送通道|FCM|APNs|firebase|邮件服务器|mail[\s-]?server|SMTP/i.test((n ? n.head + ' ' : '') + id);

          // a) 推送通道出边指向发布者 → 改指订阅者
          for (const e of gP.edges) {
            if (e.dashed) continue;
            const fi = nodesP.get(e.from);
            if (!fi || !isPushChannel(e.from, fi)) continue;
            if (!pubIds.has(e.to) || subIds.has(e.to)) continue;
            const idx = findEdgeLine(e);
            if (idx < 0) continue;
            const sub = subscribers[0][0];
            lines[idx] = lines[idx].replace(new RegExp('\\b' + e.to + '\\b(\\s*)$'), sub + '$1');
            pushCycleN++;
            actions.push(`推送边环修复：推送通道 ${e.from} → ${e.to}（发布者）改为 → ${sub}（订阅者），消除路径级推送环`);
          }

          // b) 发布者越权"订阅/查看"边且订阅者已有同目标边 → 删除
          const VIEW_RE = /订阅|查看|浏览|view|subscri|browse|查看通知|查看消息/;
          for (const e of gP.edges) {
            if (e.dashed) continue;
            if (!pubIds.has(e.from) || !VIEW_RE.test(e.label || '')) continue;
            const hasSubEdge = gP.edges.some((x) => !x.dashed && subIds.has(x.from) && x.to === e.to);
            if (!hasSubEdge) continue;
            const idx = findEdgeLine(e);
            if (idx < 0) continue;
            if ((degP.get(e.from) || 0) - 1 < 1 || (degP.get(e.to) || 0) - 1 < 1) continue;
            lines[idx] = null;
            pushCycleN++;
            actions.push(`推送边环修复：删除发布者越权边 ${e.from} →|${e.label}| ${e.to}（订阅者已有同目标边）`);
          }
          lines = lines.filter((l) => l !== null);

          // c) 通知执行器到不匹配外部通道 → 删除
          const execType = (n, id) => {
            const t = ((n ? n.head + ' ' : '') + id).toLowerCase();
            if (/smtp|mail|邮件发送/.test(t)) return 'mail';
            if (/firebase|webpush|push|推送执行/.test(t)) return 'push';
            return null;
          };
          const chanType = (id, n) => {
            const t = ((n ? n.head + ' ' : '') + id).toLowerCase();
            if (/mail|smtp|邮件/.test(t)) return 'mail';
            if (/push|fcm|apns|firebase|推送/.test(t)) return 'push';
            return null;
          };
          const notifExecs = [...nodesP.entries()].filter(([id, n]) => execType(n, id) && n.shape !== '[(');
          for (const [execId, execInfo] of notifExecs) {
            const et = execType(execInfo, execId);
            const outToChannels = gP.edges.filter((e) => !e.dashed && e.from === execId
              && nodesP.has(e.to) && isPushChannel(e.to, nodesP.get(e.to)));
            if (outToChannels.length < 2) continue;
            const hasMatch = outToChannels.some((e) => chanType(e.to, nodesP.get(e.to)) === et);
            if (!hasMatch) continue;
            for (const e of outToChannels) {
              const ct = chanType(e.to, nodesP.get(e.to));
              if (!ct || ct === et) continue;
              const idx = findEdgeLine(e);
              if (idx < 0) continue;
              if ((degP.get(e.from) || 0) - 1 < 1 || (degP.get(e.to) || 0) - 1 < 1) continue;
              lines[idx] = null;
              pushCycleN++;
              actions.push(`推送边环修复：删除通知执行器到不匹配通道的边 ${e.from} →|${e.label || ''}| ${e.to}（${et}→${ct} 类型不匹配，已有到匹配通道的边）`);
            }
            lines = lines.filter((l) => l !== null);
          }
        }
      }

      const cur = lines.join('\n');
      const { nodes } = parseBlockStructure(cur);
      const g = parseFlowchart(cur);
      const deg = new Map();
      for (const e of g.edges) { deg.set(e.from, (deg.get(e.from) || 0) + 1); deg.set(e.to, (deg.get(e.to) || 0) + 1); }

      // --- 1) 孤立节点 ---
      const dropIds = new Set();
      for (const [id, n] of nodes) {
        if (deg.has(id)) continue;
        const forced = n.path && n.path !== '(外部)' && anchorPaths.has(n.path);
        if (forced) { actions.push(`孤立锚点保留（需人工连边）：${id}（${n.path}）`); continue; }
        dropIds.add(id);
        actions.push(`删除孤立节点：${id}（${(n.head || n.path || '').replace(/<br\/?>/g, ' ').trim()}）`);
      }
      if (dropIds.size) {
        lines = lines
          // 删除节点声明行（id[ / id( / id{ 开头）
          .filter((l) => ![...dropIds].some((id) => new RegExp('^\\s*' + id + '\\s*[\\[\\(\\{]').test(l)))
          // class 行剔除被删 id；整行 id 删光则删行
          .map((l) => {
            if (!/^\s*class\s+/.test(l)) return l;
            const m = l.match(/^(\s*class\s+)([A-Za-z0-9_,\s]+?)\s+([A-Za-z_]\w*)\s*$/);
            if (!m) return l;
            const ids = m[2].split(',').map((s) => s.trim()).filter(Boolean).filter((x) => !dropIds.has(x));
            return ids.length ? `${m[1]}${ids.join(',')} ${m[3]}` : '';
          })
          .filter((l) => l !== '')
          // 删孤儿同步：引用被删节点的边行一并删除（全景块声明与边分行；
          // 特写块边与声明同行——整行删，声明随之消失，ntfy 特写 F --> G 教训）
          .filter((l) => {
            if (!/-->/.test(l) || /^\s*(subgraph|classDef|class|end|flowchart|graph)\b/.test(l)) return true;
            return ![...dropIds].some((id) => new RegExp('\\b' + id + '\\b').test(l));
          });
      }

      // --- 2)/3) 反向边（基于删孤儿后的最新图重新解析）---
      let cur2 = lines.join('\n');
      let bs2 = parseBlockStructure(cur2);
      const nodes2 = bs2.nodes;
      const nodeLayer2 = new Map();
      for (const ly of bs2.layers) {
        const k = layerKeyByTitle(ly.title, ly.id);
        for (const id of ly.nodes) nodeLayer2.set(id, k);
      }
      let g2 = parseFlowchart(cur2);
      const deg2 = new Map();
      const recountDeg = () => {
        deg2.clear();
        for (const e of g2.edges) { deg2.set(e.from, (deg2.get(e.from) || 0) + 1); deg2.set(e.to, (deg2.get(e.to) || 0) + 1); }
      };
      recountDeg();
      // 路由层 → 进程入口（挂载方向反）：入口启动并挂载路由，整行翻转为 入口 -->|挂载路由| 路由层
      // （uptime-kuma 教训：api_routers -->|路由处理| api_server 三轮修订后仍残留，需扫尾兜底）
      const entryAnchorPaths = (anchors || []).filter((a) => a.role === 'entry').map((a) => a.path);
      const nodePathMatch = (np, ap) => {
        const n = String(np).replace(/\/$/, ''), a = String(ap).replace(/\/$/, '');
        return n === a || n.endsWith('/' + a) || a.endsWith('/' + n) || path.basename(n) === path.basename(a);
      };
      const isEntryNode = (info) => {
        if (!info) return false;
        if (/入口|进程启动/.test(info.head || '')) return true;
        return !!(info.path && info.path !== '(外部)' && entryAnchorPaths.some((a) => nodePathMatch(info.path, a)));
      };
      const isRouterNode = (info, id) => {
        if (!info) return false;
        return /路由|router|routes/i.test(' ' + (info.head || '') + ' ' + id + ' ');
      };
      // 悬空边：边的端点未在任何地方声明（LLM 特写块漏写 F 声明时，F -->|..| G 整行残留，
      // mermaid 把裸 id F 渲染成默认矩形；ntfy 教训）——整行删除后重解析
      {
        const dangling = g2.edges.filter((e) => !nodes2.has(e.from) || !nodes2.has(e.to));
        if (dangling.length) {
          const dropLine = new Set();
          lines.forEach((l, i) => {
            if (!/-->/.test(l) || /^\s*(subgraph|classDef|class|end|flowchart|graph)\b/.test(l)) return;
            for (const e of dangling) {
              const re = new RegExp('\\b' + e.from + '\\b[\\s\\S]*?-->\\s*(?:\\|[^|]*\\|\\s*)?\\b' + e.to + '\\b');
              if (re.test(l)) {
                dropLine.add(i);
                actions.push(`删除悬空边（端点${!nodes2.has(e.from) ? '「' + e.from + '」未声明' : ''}${!nodes2.has(e.to) ? '「' + e.to + '」未声明' : ''}）：${e.from} →|${e.label || ''}| ${e.to}`);
                break;
              }
            }
          });
          if (dropLine.size) {
            lines = lines.filter((_, i) => !dropLine.has(i));
            cur2 = lines.join('\n');
            bs2 = parseBlockStructure(cur2);
            nodes2.clear(); for (const [k, v] of bs2.nodes) nodes2.set(k, v);
            nodeLayer2.clear();
            for (const ly of bs2.layers) { const k = layerKeyByTitle(ly.title, ly.id); for (const id of ly.nodes) nodeLayer2.set(id, k); }
            g2 = parseFlowchart(cur2);
            recountDeg();
          }
        }
      }
      // 孤立 ops 节点（Dockerfile/compose）：与进程入口之间补虚线部署边
      // （规范：ops -.-> 运行时；三轮修订仍连不上时机械补边，好过锚点孤立挂在图上）
      if (!isCloseup) {
        const opsOrphans = [];
        for (const [id, n] of nodes2) {
          if (deg2.has(id)) continue;
          if (layerOfNode(nodes2, id, nodeLayer2) === 'ops') opsOrphans.push(id);
        }
        const entryId = [...nodes2.keys()].find((id) => {
          const n = nodes2.get(id);
          return n && isEntryNode(n) && !/CLI|命令行/i.test(n.head || '');
        });
        for (const oid of opsOrphans) {
          if (!entryId || oid === entryId) continue;
          const n = nodes2.get(oid);
          const lab = /compose|编排/i.test(n.head || '') ? '编排部署' : '构建镜像';
          let lastEnd = -1;
          lines.forEach((l, i) => { if (/^\s*end\s*$/.test(l)) lastEnd = i; });
          const newLine = `    ${oid} -.->|${lab}| ${entryId}`;
          if (lastEnd >= 0) lines.splice(lastEnd + 1, 0, newLine); else lines.push(newLine);
          actions.push(`孤立 ops 节点补虚线部署边：${oid} -.->|${lab}| ${entryId}`);
          deg2.set(oid, (deg2.get(oid) || 0) + 1);
          deg2.set(entryId, (deg2.get(entryId) || 0) + 1);
        }
      }
      const isAnchorNode = (id) => {
        const n = nodes2.get(id);
        return !!(n && n.path && n.path !== '(外部)' && anchorPaths.has(n.path));
      };
      // 整行翻转：<左块> -->|标签| <右块> → <右块> -->|新标签| <左块>
      // 关键：特写链节点声明与边同行（D -->|..| E["仪表盘"]），必须整块翻转，
      // 声明才永远贴着自己的 id；字符串替换 id 会把声明挂到对方 id 上并使原 id 失联
      const reverseEdgeLine = (line, label) => {
        const m = line.match(/^(\s*)([\s\S]*?)(-\.->|-->)(\s*\|[^|]*\|\s*)?([\s\S]*?)\s*$/);
        if (!m) return line;
        const [, pad, left, arrow, oldLab, right] = m;
        const lab = label != null ? `|${label}| ` : (oldLab || '');
        return `${pad}${right.trim()} ${arrow}${lab}${left.trim()}`;
      };
      // 先收集坏边动作，再统一处理（防止删边把强制锚点删成新孤儿）
      const candidates = []; // {idx, edge, kind:'resp'|'fa', fl}
      lines.forEach((l, idx) => {
        if (!/-->/.test(l) || /^\s*(subgraph|classDef|class|end|flowchart|graph)\b/.test(l)) return;
        const arrowN = (l.match(/-->|-\.->/g) || []).length;
        if (arrowN !== 1) return; // 链式边不自动改，交给 LLM
        const edge = g2.edges.find((e) => {
          const re = new RegExp('\\b' + e.from + '\\b[\\s\\S]*?-->\\s*(?:\\|[^|]*\\|\\s*)?\\b' + e.to + '\\b');
          return re.test(l);
        });
        if (!edge) return;
        const fl = layerOfNode(nodes2, edge.from, nodeLayer2), tl = layerOfNode(nodes2, edge.to, nodeLayer2);
        const fi = nodes2.get(edge.from), ti = nodes2.get(edge.to);
        // 推送豁免同 lint 闸门：只认「推送标签 + 终点是前端/角色」或「专职推送节点 → 前端/角色」，
        // 综合服务器 head 含「推送」二字不豁免（ntfy server_http 教训）
        const isDedicatedPushNode2 = (info, id) =>
          /(sse|websocket|web[\s-]?socket|firebase|\bfcm\b|\bapns\b|webpush|web[\s_-]?push|event[\s-]?stream|推送执行器|推送通道|推送服务)/i
            .test(`${info ? info.head + ' ' + info.path + ' ' : ''}${id || ''}`);
        const isPush = (PUSH_RE.test(edge.label || '') && (tl === 'frontend' || tl === 'actor'))
          || (isDedicatedPushNode2(fi, edge.from) && (tl === 'frontend' || tl === 'actor'));
        if (!edge.dashed && !isPush && ['api', 'storage', 'worker', 'monitor', 'schedule'].includes(fl) && tl === 'frontend') {
          candidates.push({ idx, edge, kind: 'resp', fl });
        } else if (!edge.dashed && fl === 'frontend' && tl === 'actor') {
          candidates.push({ idx, edge, kind: 'fa', fl });
        } else if (!edge.dashed && !isPush && fl === 'storage' && tl === 'api') {
          // 存储为源：数据库不会主动调后端，整行翻转为 后端 -->|读写/查询| 存储（翻转后方向合法）
          candidates.push({ idx, edge, kind: 'stsrc', fl });
        } else if (!edge.dashed && !isPush && fl === 'storage'
          && ['worker', 'monitor', 'schedule'].includes(tl)) {
          // 存储主动触发后台/通知/调度（含裸边）：数据库不会发起业务动作，真实触发者是写入该存储的上游
          // 业务节点（changedetection 教训：store -->|触发通知| notification_service，应为 processors 触发）
          candidates.push({ idx, edge, kind: 'strig', fl });
        } else if (!edge.dashed && fl === 'actor' && tl === 'frontend'
          && /访客|visitor/i.test(`${fi ? fi.head : ''} ${edge.from}`)
          && /仪表盘|dashboard|管理|报表|后台/.test(ti ? ti.head : '')) {
          // 访客角色直连管理后台/仪表盘：访客浏览器只加载 tracker 采集脚本，不登录不看报表
          // （umami 教训：actor_user_2 网站访客 --> 仪表盘，应连 tracker 脚本节点）
          candidates.push({ idx, edge, kind: 'vis', fl });
        } else if (!edge.dashed && notifLike(edge.from, fi) && tl === 'actor'
          && /浏览器|browser/i.test(`${ti ? ti.head : ''} ${edge.to}`)) {
          // 通知服务推给「浏览器」actor：浏览器属于用户，图中存在用户角色时应推给用户（memos 教训）；
          // SMTP/外部服务器不在此例（按传输层目标处理）
          candidates.push({ idx, edge, kind: 'nuser', fl });
        } else if (!edge.dashed && fl === 'actor' && tl === 'api'
          && /界面|web界面|管理后台|后台页面|打开页面|浏览|访问页面|后台|登录|认证|login/i.test(edge.label || '')
          && !/采集|collect|tracker|webhook|回调|上报|\/send|集成/i.test(ti ? ti.head + ' ' + ti.path : '')) {
          // 角色绕前端直连 API 却是界面访问动作（uptime-kuma 教训：actor_user -->|浏览器访问Web界面| api_server
          // 与 actor_user -->|浏览界面| frontend_components 重复且叙事错误）；采集/webhook 集成端点豁免
          candidates.push({ idx, edge, kind: 'aab', fl });
        } else if (!edge.dashed) {
          // 非法方向组合：角色↔存储直连 / 前端→存储直连 / 前端越层到 worker/调度 /
          // 外部角色直连内部 worker/调度 / 内部非通知节点→人
          const tgtKind = actorKindOf(edge.to, ti, tl);
          const illegal =
            ((fl === 'actor' || tl === 'actor') && (fl === 'storage' || tl === 'storage')) ||
            (fl === 'frontend' && tl === 'storage') ||
            (fl === 'frontend' && (tl === 'worker' || tl === 'schedule')) ||
            (fl === 'actor' && (tl === 'worker' || tl === 'schedule')) ||
            // 外部角色直连进程入口（ntfy 教训：actor_user -->|启动服务| main_entry）；
            // CLI 节点（人在终端运行命令）豁免
            (fl === 'actor' && tl === 'api' && isEntryNode(ti)
              && !/CLI|命令行/i.test(ti ? ti.head + ' ' + (ti.path || '') : '')) ||
            // 服务端 → CLI/客户端 SDK（方向反，CLI/SDK 是调用方）
            (tl === 'api' && ti && /CLI|命令行|客户端\s*SDK|客户端库/i.test(ti.head + ' ' + (ti.path || ''))
              && ['api', 'monitor', 'worker', 'schedule'].includes(fl)
              && fi && !/CLI|命令行|客户端\s*SDK/i.test(fi.head + ' ' + (fi.path || ''))) ||
            (tgtKind === 'user' && ['api', 'schedule', 'worker', 'storage', 'monitor'].includes(fl)
              && !notifLike(edge.from, fi) && !notifLike(edge.to, ti));
          if (illegal) candidates.push({ idx, edge, kind: 'illegal', fl });
          else if (isEntryNode(ti) && isRouterNode(fi, edge.from) && !isEntryNode(fi)) {
            candidates.push({ idx, edge, kind: 'entryrev', fl });
          }
        }
      });
      // 会被删除的边集合（resp 暂定删除；fa 有反向则删除否则交换；illegal 暂定删除）
      const willDelete = new Set();
      for (const c of candidates) {
        if (c.kind === 'resp' || c.kind === 'illegal') willDelete.add(c.idx);
        else {
          const hasReverse = g2.edges.some((x) => x.from === c.edge.to && layerOfNode(nodes2, x.to, nodeLayer2) === 'frontend');
          if (hasReverse) willDelete.add(c.idx);
        }
      }
      // 非法边删除保护：删后任一端点孤立时，特写块保留（不碎线性链）；全景块保护强制锚点与外部角色，
      // 其余孤立节点交给下一轮孤儿清理
      for (const c of candidates.filter((x) => x.kind === 'illegal' && willDelete.has(x.idx))) {
        for (const v of [c.edge.from, c.edge.to]) {
          const surviving = (deg2.get(v) || 0)
            - candidates.filter((x) => willDelete.has(x.idx) && (x.edge.from === v || x.edge.to === v)).length;
          if (surviving <= 0) {
            const vInfo = nodes2.get(v);
            const isActorV = !!vInfo && (vInfo.actor || vInfo.shape === '([' || /^actor_/.test(v));
            if (isCloseup || isAnchorNode(v) || isActorV) { willDelete.delete(c.idx); break; }
          }
        }
      }
      // 检查删除后哪些前端节点会变孤立：若是强制锚点，把其中一条响应边改为「反向请求边」而非删除
      // （优先改 api 来源，其次 worker/monitor，最后 storage）
      const rescued = new Set();
      const layerRank = { api: 0, worker: 1, monitor: 2, storage: 3 };
      for (const c of candidates.filter((x) => x.kind === 'resp')) {
        const v = c.edge.to;
        if (!isAnchorNode(v)) continue;
        const incidentCandidates = candidates.filter((x) => x.edge.from === v || x.edge.to === v);
        // 交换方向的边仍保留连接，只有删除才会丢边；幸存度 = 当前度数 - 被删边数
        const surviving = (deg2.get(v) || 0) - incidentCandidates.filter((x) => willDelete.has(x.idx)).length;
        if (surviving > 0) continue;
        // 该锚点删完会孤立：选一条最优响应边救回（同节点只救一条）
        if ([...rescued].some((idx) => { const cc = candidates.find((x) => x.idx === idx); return cc && cc.edge.to === v; })) continue;
        const pool = incidentCandidates
          .filter((x) => x.kind === 'resp' && x.edge.to === v)
          .sort((a, b) => (layerRank[a.fl] ?? 9) - (layerRank[b.fl] ?? 9));
        if (pool.length) { rescued.add(pool[0].idx); willDelete.delete(pool[0].idx); }
      }
      // --- 1.4) sMed 修复 A：storage 层非 DB 圆柱节点（代码包被误用圆柱）改矩形
      //   圆柱只用于真数据库/缓存/中间件（INFRA_RE 命中）。代码包/适配器（如 caddy filestorage、
      //   distributedstek）被误画为圆柱时，对独立声明行（非边同行、非特写链 A-->|..| B[(..)]）改矩形。
      {
        const xcc = lines.join('\n');
        const bsX = parseBlockStructure(xcc);
        const cyls = [];
        // 先把 layers 的 storage 层节点 id 列出来（layerOfNode 语义推断不一定命中类名"配置文件"等，但层归属是 parseBlockStructure 硬信息）
        const storageNodeIds = new Set();
        for (const ly of (bsX.layers || [])) {
          const t = (ly.title || '').toLowerCase();
          if (/存储|storage|database|数据/i.test(t) && !/前端|api|接口/.test(t)) {
            for (const id of ly.nodes) storageNodeIds.add(id);
          }
        }
        for (const [id, n] of bsX.nodes) {
          if (n.shape !== '[(') continue;
          const lyr = layerOfNode(bsX.nodes, id, null);
          // 命中任一：层归属存储 / lyr 显式 storage → 候选
          if (lyr !== 'storage' && !storageNodeIds.has(id)) continue;
          const sig = `${n.head || ''} ${n.path || ''} ${n.small || ''} ${id}`;
          if (INFRA_RE.test(sig)) continue;
          cyls.push({ id });
        }
        if (cyls.length) {
          const safeToChange = new Set();
          lines.forEach((l, i) => {
            if (/-->|-\.->/.test(l)) return; // 边同行不碰（特写链常见）
            for (const c of cyls) {
              const re = new RegExp('^\\s*' + c.id + '\\s*\\[\\(\\s*"([\\s\\S]*?)"\\s*\\)\\]\\s*;?\\s*$');
              if (re.test(l)) safeToChange.add(i);
            }
          });
          if (safeToChange.size) {
            const ids = [];
            lines = lines.map((l, i) => {
              if (!safeToChange.has(i)) return l;
              const m = l.match(/^(\s*)([A-Za-z_]\w*)\s*\[\(\s*"([\s\S]*?)"\s*\)\]\s*(;?)\s*$/);
              if (!m) return l;
              ids.push(m[2]);
              return `${m[1]}${m[2]}["${m[3]}"]${m[4]}`;
            });
            if (ids.length) actions.push('storage 层非 DB 代码圆柱改矩形（圆柱只给真数据库/中间件）：' + ids.join(','));
          }
        }
      }

      // --- 1.5) sMed 修复 B：管理 API（admin/conf 类 id/head）指向前端 http 模块的实线边，
      //   标签为「配置/部署/挂载/下发/注册」非推送类 → 翻转为 http→admin，标签改「拉取配置」。
      //   caddy 教训：`admin(API) -->|部署应用| http(前端)` 被闸为 backend→frontend 反向前实线；
      //   实际是模块启动时向 admin API 查询配置（管理端推送用虚线）。
      //   仅裸边行（无行内声明）翻转，特写链整行翻转使用 reverseEdgeLine。
      {
        const ycc = lines.join('\n');
        const bsY = parseBlockStructure(ycc);
        const gY = parseFlowchart(ycc);
        const nlY = new Map();
        for (const ly of (bsY.layers || [])) {
          const k = layerKeyByTitle(ly.title, ly.id);
          for (const id of ly.nodes) nlY.set(id, k);
        }
        const ADMIN_RE = /^(admin|conf|config|cfg|settings)[_\d]*$/i;
        const HTTP_FE_RE = /^(http|httpserver|https|web|fe|frontend|server|app)[_\d]*$/i;
        const DEPLOY_LABEL_RE = /(配置|部署|挂载|下发|注册|应用|加载|初始化)/i;
        const LINE_DECL_SIDE = /[A-Za-z_]\w*\s*(?:\[\(|\(\[|\[|\(|\{)[\s\S]*?(?:\)\]|\]\)|\]|\)|\})(?=\s*(?:-->|-\.->|---|&|$))/;
        for (const e of gY.edges) {
          if (e.dashed) continue;
          const fi = bsY.nodes.get(e.from), ti = bsY.nodes.get(e.to);
          const fl = nlY.has(e.from) ? nlY.get(e.from) : layerOfNode(bsY.nodes, e.from, nlY);
          const tl = nlY.has(e.to) ? nlY.get(e.to) : layerOfNode(bsY.nodes, e.to, nlY);
          if (fl !== 'api' || tl !== 'frontend') continue;
          const fromSig = `${e.from} ${fi ? (fi.head||'') + ' ' + (fi.path||'') : ''}`;
          const toSig = `${e.to} ${ti ? (ti.head||'') + ' ' + (ti.path||'') : ''}`;
          if (!(ADMIN_RE.test(e.from) || /管理|admin|配置中心/i.test(fromSig))) continue;
          if (!(HTTP_FE_RE.test(e.to) || /HTTP|应用|接口服务|http[\s-]*server|http handler/i.test(toSig))) continue;
          if (!DEPLOY_LABEL_RE.test(e.label || '')) continue;
          if (/(推送|sse|ws|websocket|实时|realtime)/i.test(e.label || '')) continue;
          let targetIdx = -1;
          lines.forEach((l, i) => {
            if (targetIdx >= 0) return;
            if (!/-->/.test(l) || /^\s*(subgraph|classDef|class|end|flowchart|graph)\b/.test(l.trim())) return;
            if ((l.match(/-->|-\.->/g) || []).length !== 1) return;
            const re = new RegExp('\\b' + e.from + '\\b[\\s\\S]*?-->\\s*(?:\\|[^|]*\\|\\s*)?\\b' + e.to + '\\b');
            if (!re.test(l)) return;
            if (LINE_DECL_SIDE.test(l)) return;
            targetIdx = i;
          });
          if (targetIdx < 0) continue;
          lines[targetIdx] = reverseEdgeLine(lines[targetIdx], '拉取配置');
          actions.push(`admin→http 配置类反向边翻转（运行时模块拉取配置，非 API 反推 UI）：${e.from}→${e.to} → ${e.to}→|拉取配置|${e.from}`);
        }
      }

      const dropLineIdx = new Set();
      const swapLineIdx = new Map();
      for (const c of candidates) {
        const l = lines[c.idx];
        if (c.kind === 'resp') {
          const reqLabel = c.fl === 'storage' ? '请求数据' : '请求/查询数据';
          if (isCloseup) {
            // 子图2 主链路特写：节点声明与边同行、线性叙事链，删边会断链成碎片；
            // 一律整行翻转并改为请求类标签（边保留、链连通、声明不串位）
            swapLineIdx.set(c.idx, reverseEdgeLine(l, reqLabel));
            actions.push(`特写链响应边改为请求方向：${c.edge.to} →|${reqLabel}| ${c.edge.from}`);
          } else if (rescued.has(c.idx)) {
            // 子图1：整行翻转 + 换成请求类标签（保护强制锚点不被删成孤立）
            swapLineIdx.set(c.idx, reverseEdgeLine(l, reqLabel));
            actions.push(`响应边改为请求方向（保护锚点连接）：${c.edge.to} →|${reqLabel}| ${c.edge.from}`);
          } else if ((deg2.get(c.edge.from) || 0) >= 2 && (deg2.get(c.edge.to) || 0) >= 2) {
            dropLineIdx.add(c.idx);
            actions.push(`删除响应反向边：${c.edge.from} →|${c.edge.label || ''}| ${c.edge.to}`);
          } else if (c.fl !== 'storage') {
            // 全景块、一端度数<2：删边会孤立节点（如 SSR 页面蓝图 watchlist_ui 仅靠这条边连图）；
            // 整行翻转为请求方向（前端 → 后端）保持连通且方向合法。
            // storage 例外：翻转后变成非法的 前端→存储，保持原样交下一轮/人工
            swapLineIdx.set(c.idx, reverseEdgeLine(l, reqLabel));
            actions.push(`响应边改为请求方向（保持节点连通）：${c.edge.to} →|${reqLabel}| ${c.edge.from}`);
          }
        } else if (c.kind === 'fa') {
          if (willDelete.has(c.idx)) {
            dropLineIdx.add(c.idx);
            actions.push(`删除前端→角色反向边（反向已存在）：${c.edge.from} → ${c.edge.to}`);
          } else {
            // 整行翻转、保留原标签（如「查看报告」：管理员 查看 仪表盘）
            swapLineIdx.set(c.idx, reverseEdgeLine(l, null));
            actions.push(`交换前端→角色边方向：${c.edge.from} → ${c.edge.to} → ${c.edge.to} → ${c.edge.from}`);
          }
        } else if (c.kind === 'illegal' && willDelete.has(c.idx)) {
          dropLineIdx.add(c.idx);
          actions.push(`删除非法方向边：${c.edge.from} →|${c.edge.label || ''}| ${c.edge.to}`);
        } else if (c.kind === 'entryrev') {
          // 路由层 → 入口：翻转为 入口 -->|挂载路由| 路由层；正向边已存在则直接删反向边
          const hasReverse = g2.edges.some((x) => x.from === c.edge.to && x.to === c.edge.from);
          if (hasReverse) {
            dropLineIdx.add(c.idx);
            actions.push(`删除路由层→入口反向边（正向挂载边已存在）：${c.edge.from} → ${c.edge.to}`);
          } else {
            swapLineIdx.set(c.idx, reverseEdgeLine(l, '挂载路由'));
            actions.push(`挂载方向翻转：${c.edge.from} → ${c.edge.to} 改为 ${c.edge.to} →|挂载路由| ${c.edge.from}`);
          }
        } else if (c.kind === 'stsrc') {
          // 存储 → 后端：整行翻转为 后端 -->|读写/查询| 存储（翻转即合法方向，不断链；重复边交去重段合并）
          swapLineIdx.set(c.idx, reverseEdgeLine(l, '读写/查询'));
          actions.push(`存储为源边翻转：${c.edge.from} → ${c.edge.to} 改为 ${c.edge.to} →|读写/查询| ${c.edge.from}`);
        } else if (c.kind === 'aab') {
          // 角色 → API 却是界面访问动作：角色已有到前端的边 → 删冗余边；否则改指向度数最高的前端节点；
          // 边行内带 API 节点声明（特写链）时拆成独立声明行，绝不删声明
          // 前端节点识别回退到文本推断（特写块无 subgraph，nodeLayer2 为空）；
          // tracker/recorder 采集脚本是访客资产，不是管理员登录/访问目标，排除
          const feNodes = [...nodes2.keys()].filter((id) => {
            if (layerOfNode(nodes2, id, nodeLayer2) !== 'frontend') return false;
            const n = nodes2.get(id);
            return !/tracker|recorder|跟踪脚本|采集脚本|埋点/i.test(`${id} ${n ? n.head : ''}`);
          });
          const feTarget = feNodes.map((id) => ({ id, deg: deg2.get(id) || 0 })).sort((a, b) => b.deg - a.deg)[0];
          const actorHasFE = g2.edges.some((x) => x.from === c.edge.from
            && layerOfNode(nodes2, x.to, nodeLayer2) === 'frontend');
          const lineDecl = new RegExp('\\b' + c.edge.to + '\\b\\s*(?:\\[\\(|\\(\\[|\\[|\\(|\\{)').test(l);
          if (lineDecl && actorHasFE) {
            const dm = l.match(/^(\s*)([\s\S]*?)(?:-\.->|-->)(?:\s*\|[^|]*\|\s*)?([\s\S]*?)\s*$/);
            if (dm) {
              swapLineIdx.set(c.idx, `${dm[1]}${dm[3].trim()}`);
              actions.push(`拆除角色绕前端直连边并保留节点声明：${c.edge.from} →|${c.edge.label || ''}| ${c.edge.to}`);
            }
          } else if (actorHasFE) {
            // 删除前保护：API 端删后会孤立且是强制锚点 → 改指向前端而非删除
            const apiSurviving = (deg2.get(c.edge.to) || 0)
              - candidates.filter((x) => willDelete.has(x.idx) && (x.edge.from === c.edge.to || x.edge.to === c.edge.to)).length
              - 1;
            if (feTarget && apiSurviving <= 0 && isAnchorNode(c.edge.to)) {
              swapLineIdx.set(c.idx, l.replace(new RegExp('\\b' + c.edge.to + '\\b'), feTarget.id));
              actions.push(`角色界面访问边改指向前端（保护锚点连接）：${c.edge.from} → ${feTarget.id}`);
            } else {
              dropLineIdx.add(c.idx);
              actions.push(`删除角色绕前端直连 API 的界面访问边（角色到前端边已存在）：${c.edge.from} →|${c.edge.label || ''}| ${c.edge.to}`);
            }
          } else if (feTarget) {
            swapLineIdx.set(c.idx, l.replace(new RegExp('\\b' + c.edge.to + '\\b'), feTarget.id));
            actions.push(`角色界面访问边改指向前端节点：${c.edge.from} →|${c.edge.label || ''}| ${c.edge.to} 改为 → ${feTarget.id}`);
          }
        } else if (c.kind === 'nuser') {
          // 通知服务 →「浏览器」actor：改推给图中的用户角色（浏览器是用户的终端，memos 教训）
          const userActor = [...nodes2.entries()].find(([id, n]) =>
            id !== c.edge.to && (n.actor || /^actor_/.test(id) || n.shape === '([')
            && actorKindOf(id, n, layerOfNode(nodes2, id, nodeLayer2)) === 'user'
            && /用户|管理员|订阅者|所有者|笔记|终端/i.test(n.head || ''));
          if (userActor) {
            swapLineIdx.set(c.idx, l.replace(new RegExp('\\b' + c.edge.to + '\\b'), userActor[0]));
            actions.push(`通知推送目标改为用户角色：${c.edge.from} →|${c.edge.label || ''}| ${c.edge.to} 改为 → ${userActor[0]}`);
          }
        } else if (c.kind === 'strig') {
          // 存储 -->|触发通知/告警| 后端：源改接到「写入该存储的上游业务节点」（检测/处理完才触发通知）
          const BACKEND = ['api', 'worker', 'monitor', 'schedule'];
          const layerOf = (id) => layerOfNode(nodes2, id, nodeLayer2);
          const writersOf = (sid, hop) => {
            const direct = g2.edges.filter((x) => x.to === sid && BACKEND.includes(layerOf(x.from))).map((x) => x.from);
            if (direct.length || hop >= 1) return direct;
            for (const e of g2.edges.filter((x) => x.to === sid && layerOf(x.from) === 'storage')) {
              direct.push(...writersOf(e.from, hop + 1));
            }
            return direct;
          };
          const writers = [...new Set(writersOf(c.edge.from, 0))];
          const writer = writers.map((id) => ({ id, deg: deg2.get(id) || 0 })).sort((a, b) => b.deg - a.deg)[0];
          const dup = writer && g2.edges.some((x) => x.to === c.edge.to && x.from === writer.id);
          if (writer && !dup) {
            swapLineIdx.set(c.idx, l.replace(new RegExp('^(\\s*)' + c.edge.from + '\\b'), `$1${writer.id}`));
            actions.push(`存储触发边改接到真实触发者（写入存储的上游节点）：${c.edge.from} →|${c.edge.label || ''}| ${c.edge.to} 改为 ${writer.id} →|${c.edge.label || ''}| ${c.edge.to}`);
          } else if (g2.edges.some((x) => x.to === c.edge.to && BACKEND.includes(layerOf(x.from)) && x.from !== c.edge.from)) {
            dropLineIdx.add(c.idx);
            actions.push(`删除存储触发边（目标已有业务侧触发边）：${c.edge.from} →|${c.edge.label || ''}| ${c.edge.to}`);
          }
        } else if (c.kind === 'vis') {
          // 访客 --> 管理后台/仪表盘：改接到 tracker/采集脚本节点（访客浏览器只加载采集脚本，不看报表）
          const tracker = [...nodes2.entries()].find(([id, n]) =>
            /tracker|recorder|跟踪脚本|采集脚本|埋点|collect/i.test(`${id} ${n.head || ''} ${n.path || ''}`)
            && layerOfNode(nodes2, id, nodeLayer2) === 'frontend');
          if (tracker) {
            const tid = tracker[0];
            if (g2.edges.some((x) => x.from === c.edge.from && x.to === tid)) {
              dropLineIdx.add(c.idx);
              actions.push(`删除访客→后台边（访客到采集脚本边已存在）：${c.edge.from} →|${c.edge.label || ''}| ${c.edge.to}`);
            } else {
              const replaced = l.replace(new RegExp('\\b' + c.edge.to + '\\b'), tid).replace(/\|[^|]*\|/, '|加载跟踪脚本|');
              swapLineIdx.set(c.idx, replaced);
              actions.push(`访客边改接到采集脚本节点：${c.edge.from} →|${c.edge.label || ''}| ${c.edge.to} 改为 ${c.edge.from} →|加载跟踪脚本| ${tid}`);
            }
          }
        }
      }
      if (dropLineIdx.size || swapLineIdx.size) {
        lines = lines
          .map((l, idx) => (swapLineIdx.has(idx) ? swapLineIdx.get(idx) : l))
          .filter((_, idx) => !dropLineIdx.has(idx));
      }

      // --- 3.5) 双向边环：推送边改指向前端节点；其余按层秩删逆流边 ---
      // 环上两条边互为反向，删/改一条后两端仍由另一条连着，不会孤立
      let cycleN = 0;
      {
        const cc = lines.join('\n');
        const bsC = parseBlockStructure(cc);
        const nodesC = bsC.nodes;
        const nlC = new Map();
        for (const ly of bsC.layers) {
          const k = layerKeyByTitle(ly.title, ly.id);
          for (const id of ly.nodes) nlC.set(id, k);
        }
        const gC = parseFlowchart(cc);
        const layerC = (id) => (nlC.has(id) ? nlC.get(id) : layerOfNode(nodesC, id, nlC));
        // 层秩兜底：未知层按 9（视为靠近上游），保证排序比较不出 NaN
        const rankC = (id) => { const r = LAYER_RANK[layerC(id)]; return r == null ? 9 : r; };
        // 行内是否含节点声明（子图2 特写链 D --> E[".."]：删行/改行尾都会丢声明，绝不能动）
        const LINE_DECL_RE = /[A-Za-z_]\w*\s*(?:\[\(|\(\[|\[|\(|\{)[\s\S]*?(?:\)\]|\]\)|\]|\)|\})(?=\s*(?:-->|-\.->|---|&|$))/;
        // 定位边所在行：返回 {idx, hasDecl}；裸行（如返回边 E --> D）才可删可改
        const locateEdge = (ed) => {
          let idx = -1;
          lines.forEach((l, i) => {
            if (idx >= 0) return;
            if (!/-->/.test(l) || /^\s*(subgraph|classDef|class|end|flowchart|graph)\b/.test(l)) return;
            if ((l.match(/-->|-\.->/g) || []).length !== 1) return;
            const re = new RegExp('\\b' + ed.from + '\\b[\\s\\S]*?-->\\s*(?:\\|[^|]*\\|\\s*)?\\b' + ed.to + '\\b');
            if (re.test(l)) idx = i;
          });
          if (idx < 0) return { idx: -1, hasDecl: false };
          return { idx, hasDecl: LINE_DECL_RE.test(lines[idx]) };
        };
        const cycles = [];
        const seenPair = new Set();
        for (const e of gC.edges) {
          const fl = layerC(e.from), tl = layerC(e.to);
          if (fl === 'actor' || tl === 'actor') continue; // 与外部角色的探测/响应往返合法
          const key = [e.from, e.to].sort().join('|');
          if (seenPair.has(key)) continue;
          const rev = gC.edges.find((x) => x.from === e.to && x.to === e.from);
          if (rev) { seenPair.add(key); cycles.push([e, rev]); }
        }
        const repointMap = new Map(); // idx -> {oldId, newId, edge}
        const cycleDrop = new Set();
        for (const [fwd, rev] of cycles) {
          const pushish = (ed) => {
            const info = nodesC.get(ed.from);
            return PUSH_RE.test(`${info ? info.head + ' ' + info.path + ' ' + info.id : ''} ${ed.label || ''}`);
          };
          const flF = layerC(fwd.from), tlF = layerC(fwd.to);
          // 前端参与且一条是推送 → 请求+推送双通道，合法
          if ((flF === 'frontend' || tlF === 'frontend') && (pushish(fwd) || pushish(rev))) continue;
          const pushEdge = pushish(rev) ? rev : (pushish(fwd) ? fwd : null);
          const pushLoc = pushEdge ? locateEdge(pushEdge) : null;
          if (pushEdge && pushLoc.idx >= 0 && !pushLoc.hasDecl) {
            // 推送边终点必须是前端：找与环上另一节点相邻的前端节点改指（裸行才可改）
            const other = pushEdge.from === fwd.from ? fwd.to : fwd.from;
            const feCandidate = gC.edges
              .map((x) => (x.from === other ? x.to : (x.to === other ? x.from : null)))
              .filter(Boolean)
              .find((id) => layerC(id) === 'frontend');
            if (feCandidate) {
              repointMap.set(pushLoc.idx, { oldId: pushEdge.to, newId: feCandidate, edge: pushEdge });
              cycleN++;
            } else {
              cycleDrop.add(pushLoc.idx); cycleN++;
              actions.push(`删环：删除绕回后端的推送边 ${pushEdge.from} →|${pushEdge.label || ''}| ${pushEdge.to}`);
            }
          } else {
            // 无推送语义（或推送边在行内声明行上不能动）：删逆流边。
            // 只动裸行：子图2 前向链边是「D --> E[".."]」行内声明行，删除会丢节点声明并断链；
            // LLM 画的「返回边」永远是裸行（E --> D / F --> E / G --> F），正是删除目标。
            // 选边：裸行中按层秩差挑逆流边（rank 大→小），同差优先 rev（解析序靠后的正是回画的返回边）
            const opts = [fwd, rev].map((e, i) => ({ e, i, loc: locateEdge(e) }))
              .filter((o) => o.loc.idx >= 0 && !o.loc.hasDecl && !cycleDrop.has(o.loc.idx));
            if (!opts.length) continue;
            opts.sort((a, b) => {
              const da = rankC(a.e.from) - rankC(a.e.to);
              const db = rankC(b.e.from) - rankC(b.e.to);
              if (db !== da) return db - da;        // 逆流秩差大的优先
              return b.i - a.i;                     // 同差优先 rev（回画边）
            });
            const back = opts[0].e;
            cycleDrop.add(opts[0].loc.idx); cycleN++;
            actions.push(`删环：删除逆流返回边 ${back.from} →|${back.label || ''}| ${back.to}`);
          }
        }
        if (repointMap.size) {
          lines = lines.map((l, idx) => {
            if (!repointMap.has(idx)) return l;
            const { oldId, newId, edge } = repointMap.get(idx);
            actions.push(`改向：推送边 ${edge.from} →|${edge.label || ''}| ${oldId} 改指向前端节点 ${newId}`);
            return l.replace(new RegExp('\\b' + oldId + '\\b(\\s*)$'), newId + '$1');
          });
        }
        if (cycleDrop.size) lines = lines.filter((_, idx) => !cycleDrop.has(idx));
      }

      // --- 3.6) 外部对端三角短路：内部节点 X 绕过协议边界节点 Y 直连外部系统 E
      // （X-Y 相连、Y-E 相连、X-E 也连）。bridge/proxy/notify-bus 形态下外部对端只与协议适配/
      // 边界模块对话；controller 直连 broker/设备网络既绕开适配层又与协议边成环
      // （z2m 教训：controller -->|连接MQTT代理| ext_broker 四条「连接」边）。仅全景块、仅删裸实线。
      let extShortN = 0;
      if (!isCloseup) {
        const cc = lines.join('\n');
        const bsE = parseBlockStructure(cc);
        const nodesE = bsE.nodes;
        const nlE = new Map();
        for (const ly of bsE.layers) {
          const k = layerKeyByTitle(ly.title, ly.id);
          for (const id of ly.nodes) nlE.set(id, k);
        }
        const gE = parseFlowchart(cc);
        const layerE = (id) => (nlE.has(id) ? nlE.get(id) : layerOfNode(nodesE, id, nlE));
        const isSystemPeer = (id) => /^ext_/.test(id) || actorKindOf(id, nodesE.get(id), layerE(id)) === 'system';
        // 外部对端协议词：边界节点必须共享同一个词（mqtt/zigbee/proxy/push…），无法判定则不动
        const PROTO_WORDS = ['mqtt', 'broker', 'zigbee', 'coap', 'modbus', 'proxy', 'reverseproxy', 'upstream', 'origin',
          'firebase', 'webpush', 'apns', 'fcm', 'smtp', 'mail', 'email', 'push', 'device',
          '消息代理', '源站', '上游', '设备网络', '推送', '邮件', '代理'];
        const protoOf = (id) => {
          const n = nodesE.get(id);
          const t = `${id} ${n ? n.head + ' ' + n.path : ''}`.toLowerCase();
          return PROTO_WORDS.filter((w) => t.includes(w.toLowerCase()));
        };
        const LINE_DECL_E = /[A-Za-z_]\w*\s*(?:\[\(|\(\[|\[|\(|\{)[\s\S]*?(?:\)\]|\]\)|\]|\)|\})(?=\s*(?:-->|-\.->|---|&|$))/;
        const dropE = new Set();
        for (const ext of nodesE.keys()) {
          if (!isSystemPeer(ext)) continue;
          const toks = protoOf(ext);
          if (!toks.length) continue; // ext_db 等无协议词的对端不处理
          const nbrs = new Set();
          for (const e of gE.edges) {
            if (e.dashed) continue;
            if (e.from === ext && layerE(e.to) && layerE(e.to) !== 'actor') nbrs.add(e.to);
            if (e.to === ext && layerE(e.from) && layerE(e.from) !== 'actor') nbrs.add(e.from);
          }
          const arr = [...nbrs];
          for (let i = 0; i < arr.length; i++) {
            for (let j = i + 1; j < arr.length; j++) {
              const X = arr[i], Y = arr[j];
              const linked = gE.edges.some((e) => !e.dashed
                && ((e.from === X && e.to === Y) || (e.from === Y && e.to === X)));
              if (!linked) continue;
              const sX = protoOf(X).filter((w) => toks.includes(w)).length;
              const sY = protoOf(Y).filter((w) => toks.includes(w)).length;
              let bypasser = null;
              if (sX > 0 && sY === 0) bypasser = Y;
              else if (sY > 0 && sX === 0) bypasser = X;
              if (!bypasser) continue;
              // 删 bypasser ↔ ext 两个方向的实线裸边（删后 bypasser 仍经边界节点连通 ext，不会孤立）
              lines.forEach((l, k) => {
                if (dropE.has(k)) return;
                if (!/-->/.test(l) || /^\s*(subgraph|classDef|class|end|flowchart|graph)\b/.test(l)) return;
                if ((l.match(/-->|-\.->/g) || []).length !== 1) return;
                if (LINE_DECL_E.test(l)) return;
                const hit = (a, b) => new RegExp('^\\s*' + a + '\\b[\\s\\S]*?-->\\s*(?:\\|[^|]*\\|\\s*)?' + b + '\\b').test(l);
                if (hit(bypasser, ext) || hit(ext, bypasser)) {
                  dropE.add(k); extShortN++;
                  actions.push(`删短路：${l.trim()}（绕过协议边界直连外部对端 ${ext}，由边界节点统一对接）`);
                }
              });
            }
          }
        }
        if (dropE.size) lines = lines.filter((_, idx) => !dropE.has(idx));
      }

      // --- 4) 重复边合并：同 (from,to) 只留一条（先保含行内声明的行、再保实线、再保首次出现）---
      // 保留边维持邻接，删纯边冗余行不会制造孤立；链式多箭头行（一行为多跳链）不动。
      // 含节点声明的行（子图2 特写链 A -->|x| B[".."]）不能删——删行会丢行内声明导致节点退化为裸 id。
      let dedupN = 0;
      {
        const c3 = lines.join('\n');
        const g3 = parseFlowchart(c3);
        const DECL_TEST_RE = /[A-Za-z_]\w*\s*(?:\[\(|\(\[|\[|\(|\{)[\s\S]*?(?:\)\]|\]\)|\]|\)|\})(?=\s*(?:-->|-\.->|---|&|$))/;
        const lineInfo = new Map(); // idx -> {k, dashed, hasDecl, label, from, to}
        lines.forEach((l, idx) => {
          if (!/-->/.test(l) || /^\s*(subgraph|classDef|class|end|flowchart|graph)\b/.test(l)) return;
          const arrowN = (l.match(/-->|-\.->/g) || []).length;
          if (arrowN !== 1) return;
          const e = g3.edges.find((ed) => {
            const re = new RegExp('\\b' + ed.from + '\\b[\\s\\S]*?-->\\s*(?:\\|[^|]*\\|\\s*)?\\b' + ed.to + '\\b');
            return re.test(l);
          });
          // 标签/线型优先从本行提取（find 命中的可能是同对边的首条解析记录，标签会张冠李戴）
          const lineLabel = (l.match(/--?\.?--?\s*\|([^|]+)\|/) || l.match(/\|([^|]+)\|/) || [])[1] || '';
          const lineDashed = /-\.->/.test(l);
          if (e) lineInfo.set(idx, { k: `${e.from}->${e.to}`, dashed: lineDashed, hasDecl: DECL_TEST_RE.test(l), label: lineLabel || e.label || '', from: e.from, to: e.to });
        });
        const groups = new Map();
        for (const [idx, info] of lineInfo) {
          if (!groups.has(info.k)) groups.set(info.k, []);
          groups.get(info.k).push({ idx, ...info });
        }
        const dedupDrop = new Set();
        for (const arr of groups.values()) {
          if (arr.length < 2) continue;
          // 稳定排序：含行内声明 > 实线 > 原顺序
          const ranked = [...arr].sort((a, b) => {
            if (a.hasDecl !== b.hasDecl) return a.hasDecl ? -1 : 1;
            if (a.dashed !== b.dashed) return a.dashed ? 1 : -1;
            return 0;
          });
          const keep = ranked[0];
          for (const x of ranked.slice(1)) {
            if (x.hasDecl) continue; // 含行内声明的重复行保留（删了会丢节点声明）
            dedupDrop.add(x.idx);
            dedupN++;
            actions.push(`删除重复边（保留${keep.dashed ? '虚线' : '实线'}首条）：${x.from} →|${x.label}| ${x.to}`);
          }
        }
        if (dedupDrop.size) lines = lines.filter((_, idx) => !dedupDrop.has(idx));
      }

      // --- 5) 平行冗余边与收尾线型 ---
      // a) X→Z 实线边同时存在 X→Y→Z 两跳链（非角色、非虚线）→ 直连边越层冗余，删除
      //    （changedetection: processors→notification 与 →notification_service→notification 并存；
      //     umami: api_routes→storage_prisma 与经查询层并存；盲评反复指出的「重复边」多为此类）
      // b) actor → ops 实线部署边改虚线（部署不是运行时调用，评委反复点出该类边语义模糊）
      // c) 存储层内部「目录 -->|..接口..| 其下文件」边反转（文件实现包接口，包不调用接口文件）
      let chainN = 0;
      {
        const c5 = lines.join('\n');
        const bs5 = parseBlockStructure(c5);
        const nodes5 = bs5.nodes;
        const nl5 = new Map();
        for (const ly of bs5.layers) { const k = layerKeyByTitle(ly.title, ly.id); for (const id of ly.nodes) nl5.set(id, k); }
        const g5 = parseFlowchart(c5);
        const L5 = (id) => (nl5.has(id) ? nl5.get(id) : layerOfNode(nodes5, id, nl5));
        const LINE_DECL5 = /[A-Za-z_]\w*\s*(?:\[\(|\(\[|\[|\(|\{)[\s\S]*?(?:\)\]|\]\)|\]|\)|\})(?=\s*(?:-->|-\.->|---|&|$))/;
        const edgeOnLine = new Map();
        const drop5 = new Set(); const swap5 = new Map();
        lines.forEach((l, idx) => {
          if (!/-->/.test(l) || /^\s*(subgraph|classDef|class|end|flowchart|graph)\b/.test(l)) return;
          if ((l.match(/-->|-\.->/g) || []).length !== 1) return;
          const e = g5.edges.find((ed) => new RegExp('\\b' + ed.from + '\\b[\\s\\S]*?-->\\s*(?:\\|[^|]*\\|\\s*)?\\b' + ed.to + '\\b').test(l));
          if (!e) return;
          edgeOnLine.set(idx, e);
          const fl = L5(e.from), tl = L5(e.to);
          // b) actor → ops 实线 → 虚线
          if (!e.dashed && fl === 'actor' && tl === 'ops') {
            swap5.set(idx, l.replace(/-->/, '-.->'));
            chainN++;
            actions.push(`部署关系改虚线（非运行时数据流）：${e.from} →|${e.label || ''}| ${e.to}`);
            return;
          }
          // c) 存储内部接口边反转（父目录节点 → 其下接口文件；目录节点 path 可能为空，回退用 small）
          if (!e.dashed && fl === 'storage' && tl === 'storage') {
            const ti = nodes5.get(e.to), fi = nodes5.get(e.from);
            const fromLoc = String((fi && (fi.path || fi.small)) || '').replace(/\/$/, '');
            const toLoc = String((ti && (ti.path || ti.small)) || '');
            if (toLoc && fromLoc && toLoc !== fromLoc && toLoc.startsWith(fromLoc + '/')
              && /接口|interface/i.test(e.label || '')) {
              swap5.set(idx, reverseEdgeLine(l, '接口实现'));
              chainN++;
              actions.push(`存储内部接口边反转：${e.from} →|${e.label || ''}| ${e.to} 改为 ${e.to} →|接口实现| ${e.from}`);
              return;
            }
            // c2) 圆柱数据库/存储引擎 → 代码包节点（changedetection 教训：store 圆柱 --> model 包，
            // 数据库不会主动读代码；真实依赖是 model/包 调用 store）
            if (fi && fi.shape === '[(' && ti && ti.shape !== '[(') {
              swap5.set(idx, reverseEdgeLine(l, '读写数据'));
              chainN++;
              actions.push(`存储引擎→代码包方向反转：${e.from} →|${e.label || ''}| ${e.to} 改为 ${e.to} →|读写数据| ${e.from}`);
              return;
            }
          }
          // a) 平行冗余边（均后端层、非行内声明行）：
          //    ① 两跳链 X→Y→Z 与 X→Z 直连并存 → 删直连（跳过 Y 的越层直边）；
          //    ② 绕远路（≥3 跳）可达 Z 时，仅当 Z 是外部基础设施圆柱（外部数据库/引擎）才删直连——
          //      业务层→数据访问代码（core→queries）是标准调用，绕退信/导入子系统到达不算冗余（listmonk 教训）
          const BACK = ['api', 'worker', 'monitor', 'schedule', 'storage'];
          if (e.dashed || !BACK.includes(fl) || !BACK.includes(tl)) return;
          if (LINE_DECL5.test(l)) return;
          const adj = new Map();
          for (const ee of g5.edges) {
            if (ee.dashed || !BACK.includes(L5(ee.from)) || !BACK.includes(L5(ee.to))) continue;
            if (!adj.has(ee.from)) adj.set(ee.from, []);
            adj.get(ee.from).push(ee.to);
          }
          const twoHop = g5.edges.some((y) => y.from === e.from && y.to !== e.to && !y.dashed
            && BACK.includes(L5(y.to))
            && g5.edges.some((z) => z.from === y.to && z.to === e.to && !z.dashed));
          const reachFar = (x, target) => {
            let q = (adj.get(x) || []).filter((n) => n !== target).map((id) => ({ id, d: 1 }));
            const seen = new Set(q.map((o) => o.id));
            while (q.length) {
              const cur = q.shift();
              for (const nxt of adj.get(cur.id) || []) {
                if (nxt === target && cur.d + 1 >= 2) return true;
                if (seen.has(nxt)) continue;
                seen.add(nxt); q.push({ id: nxt, d: cur.d + 1 });
              }
            }
            return false;
          };
          const zIsCylinder = (nodes5.get(e.to) || {}).shape === '[(';
          if (!twoHop && !(zIsCylinder && reachFar(e.from, e.to))) return;
          drop5.add(idx);
          chainN++;
          actions.push(`删除平行冗余直连边（已有 X→Y→Z 两跳链）：${e.from} →|${e.label || ''}| ${e.to}`);
        });
        // 删除保护：端点是强制锚点且删后孤立 → 保留该行（链式行不在 drop5 内，自然计为幸存）
        const lineOfEdge = new Map();
        for (const [i, ee] of edgeOnLine) lineOfEdge.set(ee, i);
        for (const idx of [...drop5]) {
          const e = edgeOnLine.get(idx);
          for (const v of [e.from, e.to]) {
            const info = nodes5.get(v);
            const isAnchor = !!(info && info.path && info.path !== '(外部)' && anchorPaths.has(info.path));
            if (!isAnchor) continue;
            const surviving = g5.edges.filter((x) => (x.from === v || x.to === v))
              .filter((x) => !drop5.has(lineOfEdge.get(x))).length - 1;
            if (surviving <= 0) { drop5.delete(idx); chainN--; break; }
          }
        }
        if (drop5.size) lines = lines.filter((_, idx) => !drop5.has(idx));
        if (swap5.size) lines = lines.map((l, idx) => swap5.get(idx) || l);
      }

      // --- 6) 子图2 特写链：复用了全景图长 id 并重复声明同一链路时，统一改 A/B/C 短 id ---
      // （memos 教训：子图2 用 actor_user/web_frontend 等长 id 重画一遍，读者和评委都看到重复边）
      let shortN = 0;
      if (isCloseup) {
        const cc = lines.join('\n');
        const cn = parseBlockStructure(cc);
        const longIds = [...cn.nodes.keys()].filter((id) => panoIds.has(id) && id.length >= 4);
        if (longIds.length >= 4 && ![...cn.nodes.keys()].some((id) => /^[A-Z]$/.test(id))) {
          const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
          const order = [];
          for (const l of lines) {
            for (const id of longIds) {
              if (new RegExp('\\b' + id + '\\b').test(l) && !order.includes(id)) order.push(id);
            }
          }
          const shortMap = new Map(order.map((id, i) => [id, letters[i]]));
          // 安全替换：跳过 <small>...</small> 与节点 head 引号内文本，只替换「标识符位置」
          //   标识符位置的定义：
          //   - 声明行开头：行首/缩进后紧接着 ID[形状或空格]
          //   - 边端点：--> 前后（含标签 |...| 之后或之前）的单词 token
          //   实现：对每行拆成「字面段 / 标识符 token 段」交替，<small>...</small> 整体字面不扫描
          const safeShortReplace = (line) => {
            const smallRE = /<small>[\s\S]*?<\/small>/g;
            const slots = [];
            let stripped = line.replace(smallRE, (m, off) => { slots.push({ off, len: m.length, text: m }); return '\x00S' + (slots.length - 1) + '\x00'; });
            // 在 stripped 里对每个 longId 只替换为「标识符 token」形式：
            //   - 行首 + 可选缩进 + id + 可选空格 + [形状声明]
            //   - 边端点: id 紧跟 --> / 或者 -->|...| id
            // 粗暴但正确: 扫描每个位置，判断长 id 是否在「标识符边界」(左 = 行首 / 缩进 / & / , / ( / [ / " -->|...| " 后的位置)
            //             且 右 = 空格 / [ / ( / { / 换行 / --> / --- / -.-> / | 之前的位置
            for (const [longId, s] of shortMap) {
              // 用环视：左边界必须是 (^|[\s&,({[;|]) 后紧跟 longId，右边界必须是 后面跟 ([\s\[(\{;|]|-->|-\.->|---|&|$)
              // 注意：\b 会把 admin.go 中的 admin（非 word 点后）当成 word boundary 而匹配，所以这里自己手写边界
              const lookBehind = '(^|[^A-Za-z0-9_])';
              const lookAhead = '($|[^A-Za-z0-9_])';
              const idRE = new RegExp(lookBehind + longId + lookAhead, 'g');
              stripped = stripped.replace(idRE, (_, pre, post) => pre + s + post);
            }
            // 还原 small 占位符
            stripped = stripped.replace(/\x00S(\d+)\x00/g, (_, i) => slots[+i].text);
            return stripped;
          };
          lines = lines.map((l) => safeShortReplace(l));
          shortN++;
          actions.push(`子图2 复用全景长 id，统一改为短 id 特写链：${order.length} 个节点`);
        }
      }

      if (!dropIds.size && !dropLineIdx.size && !swapLineIdx.size && !dedupN && !cycleN && !relocN && !reloc2N && !chainN && !shortN && !extShortN && !selfActorN && !pushCycleN) break;
    }
    return lines.join('\n');
  };

  // 子图1 全景节点 id 集合（子图2 若复用这些长 id 重复声明同一链路，需改成 A/B/C 短 id 特写链）
  const panoBlocks = parseMermaid(md);
  const panoIds = new Set();
  if (panoBlocks[0]) {
    for (const id of parseBlockStructure(panoBlocks[0]).nodes.keys()) panoIds.add(id);
  }

  // 按 mermaid 围栏切块，逐块扫尾后拼回（blockIdx=0 子图1 分层全景；≥1 子图2 主链路特写）
  const parts = md.split(/(```mermaid[\s\S]*?```)/g);
  let blockIdx = 0;
  for (let i = 0; i < parts.length; i++) {
    if (!/^```mermaid/.test(parts[i])) continue;
    const code = parts[i].replace(/^```mermaid\n?/, '').replace(/\n?```$/, '');
    parts[i] = '```mermaid\n' + fixBlock(code, blockIdx) + '\n```';
    blockIdx++;
  }
  return { md: parts.join(''), actions };
}

async function runOrch4() {
  nodeGather();
  const { scan } = require(path.join(__dirname, '..', 'scan'));
  const inv = scan(repo);

  // 1) 确定性重要性取证
  const importance = importanceForensics(repo, state.tree, inv.entrypoints);
  state.importance = { edges: importance.edges, optionalKw: importance.optionalKw, detachedList: importance.detachedList };
  log(`重要性取证：import 边 ${importance.edges} 条；可选组件：${importance.optionalKw.join(', ') || '无'}；旁路：${(importance.detachedList || []).map((d) => d.path).join(', ') || '无'}`);

  // 2) 产品自述（LLM，只喂 README/compose/可选证据）
  const brief = await nodeProductBrief(importance);
  state.hotExcerpts = gatherHotExcerpts(importance);

  // 3) 通用锚点（语言无关 + 重要性过滤）
  const anchors = findAnchorsV2(state.tree, importance);
  state.anchors = anchors;
  log('通用锚点：', anchors.map((a) => `${a.role}:${a.path}(heat=${a.imp.heat}${a.imp.reachable ? ',可达' : ''})`).join(' | '));

  const anchorText = anchors.map((a) => {
    const tag = a.imp.optional ? '🌿可选' : (a.imp.heat >= 3 || a.imp.reachable) ? '🔥主干' : '主干';
    return `- ${a.path} → ${a.layer} 层（${a.hint}）[${tag} heat=${a.imp.heat} reachable=${a.imp.reachable}]`;
  }).join('\n');

  // 配套执行器：同级独立执行器（worker_pool.py/notification_service.py）承担主链路职责时必须拆为独立节点；
  // 锚点包内部组成（store/store.go 在 store/ 内）可并入锚点节点，也可按职责拆分
  const companions = anchorCompanions(state.tree, anchors, importance);
  state.companions = companions;
  const companionText = companions.length
    ? `\n【签名配套执行器（树中真实存在，禁止臆造）】\n${companions.map((c) => {
      const inDir = path.dirname(c.path) === c.companionOf;
      return inDir
        ? `- ${c.path} → ${c.layer} 层（${c.hint}，位于锚点 ${c.companionOf} 包内：可并入该锚点节点，也可按职责拆出）`
        : `- ${c.path} → ${c.layer} 层（${c.hint}，与 ${c.companionOf} 同级的独立执行器：承担主链路职责时必须拆为独立节点并连边）`;
    }).join('\n')}`
    : '';

  // 外部角色固定 id（中文名无拉丁字母时退化为 kind 英文，保证 id 合法且不撞）
  // 数据库/中间件不是外部 actor：它们是 storage 层圆柱节点（LLM 产品自述常把 PostgreSQL  invent 成 actor）
  const INFRA_ACTOR_RE = /postgres|postgre|mysql|mariadb|redis|clickhouse|mongo|sqlite|elasticsearch|kafka|rabbitmq|nats|数据库|database/i;
  const rawActors = brief.actors || [];
  const droppedActors = rawActors.filter((a) => INFRA_ACTOR_RE.test(a.name || ''));
  if (droppedActors.length) {
    log('剔除基础设施 actor（应画存储圆柱）：', droppedActors.map((a) => a.name).join('、'));
    brief.actors = rawActors.filter((a) => !INFRA_ACTOR_RE.test(a.name || ''));
  }
  // 产品自身不是外部角色：LLM 产品自述偶尔把「ntfy 服务器/本系统/核心服务」invent 成 actor
  // （ntfy 教训：注入后变成 actor_ntfy 臆造节点，盲评一眼判定幻觉）。
  // 必须产品名 token + 自指角色词同时命中；「ntfy 手机 App」这类合法外部客户端不含角色词，不受影响
  const selfToks = selfActorTokens();
  const selfActors = (brief.actors || []).filter((a) => isSelfActorName(a.name || '', selfToks));
  if (selfActors.length) {
    log('剔除产品自身 actor（产品由内部各层节点表达）：', selfActors.map((a) => a.name).join('、'));
    brief.actors = (brief.actors || []).filter((a) => !isSelfActorName(a.name || '', selfToks));
  }
  const actorList = [];
  {
    const used = new Set();
    (brief.actors || []).forEach((a, i) => {
      let sid = snakeId(a.name);
      if (!sid || sid === 'n') sid = snakeId(a.kind) || ('role_' + (i + 1));
      let id = 'actor_' + sid;
      let n = 2;
      while (used.has(id)) id = 'actor_' + sid + '_' + n++;
      used.add(id);
      actorList.push({ ...a, id });
    });
  }
  state.actorList = actorList;
  const actorIdText = actorList.length
    ? `\n【外部角色固定 id】edges 的 from/to 必须逐字使用这些节点 id：${actorList.map((a) => `${a.id}=${a.name}`).join('，')}；严禁用 user/external_system 等词充当边端点。外部角色用 stadium 形状声明在所有 subgraph 之外。`
    : '';

  // ===== 形态叙事强约束（P1）：shape/emptyLayers 进 plan + 形态外部系统固定 id 注入 =====
  // orch8：若 state.explore 存在（Agent 探索契约），优先用 explore 的形态/空层/外部系统
  const explore = state.explore || null;
  const shape = (explore && explore.shape) ? { kind: explore.shape, name: explore.shape, signal: '' } : (importance.shape || { kind: 'web', name: 'Web 应用' });
  const emptyLayers = (explore && Array.isArray(explore.emptyLayers)) ? explore.emptyLayers : (importance.emptyLayers || []);
  const sigTokens = (shape.signal || '').split(/[,\s]+/).filter(Boolean).map((t) => t.toLowerCase());
  const DEVICE_PROTO_NAME = { zigbee: 'Zigbee 设备网络（协调器/终端设备）', modbus: 'Modbus 设备网络', ble: 'BLE 蓝牙设备', bluetooth: 'BLE 蓝牙设备', matter: 'Matter 设备网络', thread: 'Thread 设备网络', lora: 'LoRa 设备网络', knx: 'KNX 设备网络', opcua: 'OPC UA 设备网络', canbus: 'CAN 总线设备', bacnet: 'BACnet 设备网络', zigate: 'ZiGate 协调器', deconz: 'ConBee/deCONZ 协调器', coordinator: '协调器 / 设备网络' };
  const BROKER_NAME = { mqtt: 'MQTT 消息代理 (Broker)', nats: 'NATS 消息服务器', kafka: 'Kafka 消息集群' };
  const extNodes = [];
  // orch8 有 explore 时，完全由 explore.externalSystems 提供外部系统（分流为 cylinder/node）
  // —— shape 模板的默认 ext（api-svc 的 stadium ext_db、bridge 的 stadium ext_broker/device）是
  // LLM 画成错误外部角色的根因：vaultwarden r1 多了 stadium ext_db 触发 actor-infra；
  // z2m 把驱动层接口强制转 stadium 外部角色，制造冗余+错误直连边
  if (!explore || !Array.isArray(explore.externalSystems) || explore.externalSystems.length === 0) {
    if (shape.kind === 'proxy') {
      extNodes.push({ id: 'ext_upstream', name: '🌍 源站 / 上游服务器', kind: '外部系统（被代理的后端服务）', shape: 'node' });
      extNodes.push({ id: 'ext_ca', name: '🌍 证书颁发机构 (CA)', kind: '外部系统（ACME/Let’s Encrypt）', shape: 'node', optional: true });
    } else if (shape.kind === 'bridge') {
      const bTok = ['mqtt', 'nats', 'kafka'].find((t) => sigTokens.includes(t));
      const dTok = Object.keys(DEVICE_PROTO_NAME).find((t) => sigTokens.includes(t));
      extNodes.push({ id: 'ext_broker', name: bTok ? BROKER_NAME[bTok] : '📡 消息代理 (Broker)', kind: '外部系统（消息协议对端）', shape: 'node' });
      extNodes.push({ id: 'ext_device', name: dTok ? '📶 ' + DEVICE_PROTO_NAME[dTok] : '📶 设备网络（协调器/终端设备）', kind: '外部系统（设备协议对端）', shape: 'node' });
    } else if (shape.kind === 'notify-bus') {
      extNodes.push({ id: 'ext_push', name: '📱 手机推送服务 (FCM/APNs/WebPush)', kind: '外部系统（推送通道）', shape: 'node' });
      extNodes.push({ id: 'ext_mail', name: '✉️ SMTP 邮件服务器', kind: '外部系统（邮件通道）', shape: 'node', optional: true });
    } else if (shape.kind === 'api-svc') {
      extNodes.push({ id: 'ext_db', name: '🗄️ 外部数据库', kind: '外部系统（独立部署的 MySQL/PostgreSQL 等数据库服务）', shape: 'node', optional: true });
    }
  }
  // orch8：explore.externalSystems 分流注入
  //   - 基础设施（数据库/消息中间件/对象存储/协调器，如 mongo/redis/kafka/zookeeper/s3）：
  //     不是外部 actor，画 storage 层圆柱；自托管时确定性 infra 检测已覆盖 → optional 不强推，
  //     避免被当作 stadium 外部角色触发 actor-infa / actor-storage 闸门
  //   - 真外部对端（推送网关/第三方 API/云服务）：stadium 外部系统
  const EXPLORE_INFRA_RE = /postgres|postgre|mysql|mariadb|redis|clickhouse|mongo|sqlite|elastic|kafka|rabbitmq|nats|zookeeper|zoo[_-]?keeper|minio|s3|ceph|oss|broker存储|对象存储|数据库|消息队列|数据库\/存储/i;
  const EXPLORE_BRIDGE_INFRA_RE = /mqtt|broker|kafka|nats|zigbee|modbus|ble|bluetooth|matter|thread|lora|knx|opc.?ua|canbus|bacnet|coordinator|device.?network|network|serial|串口|总线|协调器|设备网络/i;
  if (explore && Array.isArray(explore.externalSystems)) {
    for (const x of explore.externalSystems) {
      if (extNodes.some((e) => e.id === x.id)) continue;
      const combined = (x.name || '') + ' ' + (x.id || '');
      const isInfra = EXPLORE_INFRA_RE.test(combined);
      // bridge 形态：协议对端（MQTT broker / zigbee 设备网络 / 工业总线）不当真外部 actor——
      // 它们是驱动层接口，画为 storage/monitor 圆柱且 optional，LLM 有机会画成内部驱动节点，
      // 避免 z2m 盲评评委判"外部角色冗余 + 入口层绕过"扣分
      const isBridgeInfra = shape.kind === 'bridge' && EXPLORE_BRIDGE_INFRA_RE.test(combined);
      if (isInfra || isBridgeInfra) {
        extNodes.push({
          id: x.id, name: x.name,
          kind: '基础设施/中间件（存储层圆柱节点，不是外部 actor；compose 已检出同名圆柱时不重复画）',
          shape: 'cylinder', optional: true
        });
      } else {
        extNodes.push({ id: x.id, name: x.name, kind: '外部系统（Agent 探索发现）', shape: 'node', optional: x.optional || false });
      }
    }
  }
  state.extList = extNodes;
  const SHAPE_RULES = {
    proxy: `- 本产品是反向代理/网关：禁止画 frontend 层（配置/管理 API 不算前端层）
- 请求处理器（反向代理、文件服务、负载均衡、TLS/自动 HTTPS）归「后端/API」层，禁止放进「采集/异步处理」层；证书自动化不是调度任务
- 核心叙事必须闭环：客户端 → 监听/路由 → 反向代理处理器 → ext_upstream（源站/上游服务器）；ext_upstream 必须出场且有边相连（代理故事的终点是源站，不能止于代理模块自身）
- 内部节点直连 ext_upstream / ext_ca 等外部系统是合法运行时边，不要绕路`,
    bridge: explore && Array.isArray(explore.externalSystems)
      ? `- 本产品是协议桥接网关：协议适配 + 主控制逻辑组成内核。数据流双向闭环：设备/总线侧 → 协议适配/主控制器 → 桥接逻辑 → 消息对端；命令方向反向。
- 协议适配模块（mqtt/zigbee/modbus 等）与主控制器归「后端/API」层；插件/扩展/扩展点归「采集/异步处理」层
- 用户不直连内部桥接模块：用户命令经消息对端（broker/总线主题）中转
- explore.json 已列出外部系统，按说明使用固定 id 和对应形状；基础设施圆柱/中间件类禁止画成 stadium 外部角色
- 禁止直连错误：存储/驱动必须经主控制器访问，不能越过入口直接指向外部角色`
      : `- 本产品是协议桥接：核心叙事必须出现双侧协议对端——ext_broker（消息代理）与 ext_device（设备网络），两者都必须出场并连边
- 数据流双向闭环：设备侧 ext_device → 协议适配/主控制器 → 桥接器 → ext_broker；命令方向 ext_broker → 桥接器 → 主控制器 → 协议适配 → ext_device
- 协议适配模块（mqtt/zigbee 等）与主控制器归「后端/API」层；插件/扩展/扩展点归「采集/异步处理」层
- 用户不直连内部桥接模块：用户命令经 ext_broker 中转（发布到代理主题，桥接订阅）`,
    'notify-bus': `- 本产品是通知/发布订阅总线，核心叙事两段闭环：
  ① 发布者 → HTTP API → 主题/订阅管理 → 消息缓存/存储；
  ② 投递扇出：推送模块（FCM/WebPush/SMTP）→ ext_push（手机推送服务 FCM/APNs）→ 订阅者设备；ext_push 必须出场
- 禁止推送模块直接「推送」给订阅者而不经过外部推送通道：手机推送必须经 ext_push 节点
- 消息缓存/订阅存储归存储层；主题管理归 API 层（不是调度层）
- 嵌入式存储（SQLite/Bolt/Badger 等进程内文件库）不画外部数据库节点，存储层代码节点即数据落点；只有独立部署的 MySQL/PostgreSQL 等外部 DB 服务才画 ext_db（stadium，subgraph 外，虚线标注「可选」）`,
    'api-svc': `- 本产品是后端服务（无独立前端工程）：禁止画 frontend 层；服务端模板（templates/admin）是后端渲染资产，并入 API 层节点描述，不单独设前端层
- src/db、models、schema、migrations、queries 等代码目录/文件一律矩形节点归存储层；嵌入式库（SQLite/Bolt/Badger）不画外部数据库节点；只有独立部署的 MySQL/PostgreSQL 等外部 DB 服务才画 ext_db（stadium，声明在所有 subgraph 之外，虚线 -.-> 标注「可选」）
- 对外集成（推送中继、SMTP、外部身份提供方）用外部系统节点（stadium，subgraph 外）`,
    web: ''
  };
  const shapeRulesText = SHAPE_RULES[shape.kind] || '';
  const stadiumExt = extNodes.filter((x) => x.shape !== 'cylinder');
  const cylinderExt = extNodes.filter((x) => x.shape === 'cylinder');
  const trunkStoryText = (explore && Array.isArray(explore.trunkStory) && explore.trunkStory.length)
    ? `\n【Agent 读仓主干故事（必须体现在边链上，按此组织主数据流）】${explore.trunkStory.join(' → ')}`
    : '';
  const shapeText = `
【产品形态】${shape.name}${shape.signal ? `（信号：${shape.signal}）` : ''}
${shapeRulesText}${trunkStoryText}
${emptyLayers.length ? `【空层禁令】本仓库不存在以下层，禁止画（不得为凑层数硬画，也不得把模板/配置文件塞进去凑数）：${emptyLayers.join('、')}` : ''}`;
  const extIdText = stadiumExt.length || cylinderExt.length
    ? `${stadiumExt.length ? `\n【形态外部系统固定 id（stadium，声明在所有 subgraph 之外）】edges 的 from/to 必须逐字使用这些节点 id：${stadiumExt.map((x) => `${x.id}=${x.name}${x.optional ? '（可选）' : ''}`).join('，')}。
- 外部系统节点与外部角色同样用 stadium 形状，加 classDef actor 上色；内部节点 --> 外部系统是合法运行时边（代理转发/协议桥接/推送投递都经此外部对端），禁止删除或改道；可选外部系统出场时用虚线 -.-> 并标注「可选」` : ''}${cylinderExt.length ? `\n【基础设施固定 id（圆柱，画在「数据存储」层 subgraph 内，禁止画成 stadium/外部角色）】${cylinderExt.map((x) => `${x.id}=${x.name}（可选，compose/代码已检出同名圆柱时不重复画）`).join('，')}。
- 这类是自托管数据库/中间件（MongoDB/Redis/Kafka/对象存储等），用圆柱 [("🗄️ 名称<br/><small>(外部)</small>")] 归存储层，由 API/worker 层节点 -.读写.-> 连接；绝不用 stadium 形状，也不放进外部角色区` : ''}
- 嵌入式库（SQLite/Bolt 等进程内文件库）不画外部数据库节点`
    : '';

  const briefText = `【产品定义】${brief.product}
【默认主流程】${(brief.journey || []).join(' → ')}
【外部角色（必须出场）】${(brief.actors || []).map((a) => `${a.name}（${a.kind}）`).join('、') || '终端用户'}
【核心子系统】${(brief.coreSubsystems || []).join('、')}
【可选/旁路组件（禁止画进主链路必经路径；若画必须标注「可选/实验」）】${(brief.optionalSuspects || []).concat(importance.optionalKw).join('、') || '无'}`;

  // 4) plan 循环（锚点 + 产品自述 + 重要性 + 形态约束）
  let feedback = null;
  for (let i = 0; i < 3; i++) {
    const extra = `\n${briefText}${shapeText}${actorIdText}${extIdText}\n\n【强制锚点】下列签名路径必须作为节点（path 逐字使用）：\n${anchorText}${companionText}\n规则：主链路只能走 🔥主干 节点；🌿可选/开关组件不得出现在主链路 mustEdges 上；节点 18–25 个，机制层按配套执行器拆分粒度。`;
    await nodePlan((feedback ? feedback + '\n' : '') + extra);
    injectAnchors(state.plan, anchors);
    rewritePlanLayers(state.plan);
    // 外部 actors 注入 plan（path=(外部)，id 与 actorIdText 完全一致）
    const actorNodes = actorList.map((a) => ({ id: a.id, cn: a.name, path: '(外部)', tech: a.kind, shape: 'node', actor: true }));
    if (actorNodes.length) {
      let fe = state.plan.layers.find((l) => l.key === 'frontend');
      if (!fe) { fe = { key: 'frontend', cnName: '前端 / 交互层', icon: '🖥️', nodes: [] }; state.plan.layers.unshift(fe); }
      for (const n of actorNodes) if (!fe.nodes.some((x) => x.id === n.id)) fe.nodes.push(n);
    }
    // 形态外部系统注入 plan（stadium 节点随 actors 桶位，渲染时画在 subgraph 外；ext_db 圆柱进存储层）
    for (const x of extNodes) {
      const node = { id: x.id, cn: x.name, path: '(外部)', tech: x.kind, shape: x.shape === 'cylinder' ? 'cylinder' : 'node', ext: true };
      if (x.shape === 'cylinder') {
        let st = state.plan.layers.find((l) => l.key === 'storage');
        if (!st) { st = { key: 'storage', cnName: '存储 / 数据', icon: '🗄️', nodes: [] }; state.plan.layers.push(st); }
        if (!st.nodes.some((n) => n.id === x.id)) st.nodes.push(node);
      } else {
        let fe = state.plan.layers.find((l) => l.key === 'frontend');
        if (!fe) { fe = { key: 'frontend', cnName: '前端 / 交互层', icon: '🖥️', nodes: [] }; state.plan.layers.unshift(fe); }
        if (!fe.nodes.some((n) => n.id === x.id)) fe.nodes.push(node);
      }
    }
    // 无前端形态（proxy/api-svc/无前端 bridge）：frontend 桶只装外部角色/外部系统时，
    // 改标为「外部组」——禁止 LLM 把它们画进 frontend subgraph（ext_db 圆柱在存储层，不受影响）
    for (const l of state.plan.layers) {
      const ns = l.nodes || [];
      if (l.key === 'frontend' && ns.length && ns.every((n) => n.path === '(外部)' && n.shape !== 'cylinder')) {
        l.cnName = '外部角色 / 外部系统（本组节点必须用 stadium 形状声明在所有 subgraph 之外，禁止画 subgraph 包裹本组，也不要把本组当 frontend 层）';
        l.icon = '🌍';
        l.externalOnly = true;
      }
    }
    const problems = nodeGate();
    const cov = coverageGate(JSON.stringify(state.plan), anchors);
    if (cov.length) problems.push(...cov.map((a) => `计划缺少签名锚点 ${a.path}（${a.hint}），必须加入 ${a.layer} 层`));
    if (problems.length === 0) { log('orch4 计划闸门+覆盖通过'); break; }
    log(`orch4 计划驳回 ${problems.length} 条：${problems.slice(0, 4).join('；')}`);
    feedback = problems.join('\n');
    if (i === 2) log('达计划轮次上限');
  }

  // 4.5) 计划确定性修复：infra 外部节点误挂 compose 路径 → (外部)；同路径重复节点合并 + 边重映射
  repairPlan(state.plan, state.tree);
  rewritePlanLayers(state.plan);
  {
    const repairProblems = nodeGate();
    if (repairProblems.length === 0) log('orch4 计划确定性修复后闸门通过');
    else log('orch4 计划修复后遗留：', repairProblems.slice(0, 3).join('；'));
  }

  // 5) 主链路自述（带产品旅程约束 + 形态闭环）+ story 闸门
  const shapeStoryReq = {
    proxy: '- 主链路必须以 反向代理处理器 -->|转发/代理请求| ext_upstream 收尾（toPath 直接填 "ext_upstream"）：代理故事的终点是源站，不能止于代理模块',
    bridge: '- mustEdges 必须包含 ext_device 与 ext_broker 两个外部对端（fromPath/toPath 直接填 "ext_device"/"ext_broker"）：ext_device → 协议适配/控制器 → 桥接器 → ext_broker，命令方向反向',
    'notify-bus': '- 投递闭环必须包含 推送模块 → ext_push（toPath 填 "ext_push"）→ 订阅者；禁止推送模块直接连订阅者而跳过外部推送通道',
    'api-svc': '- 数据链路必须包含 代码数据节点 → ext_db（toPath 填 "ext_db"）的读写边',
    web: ''
  }[shape.kind] || '';
  let storyFeedback = null;
  for (let si = 0; si < 2; si++) {
    const sys = `你是架构师。依据产品主流程、锚点与源码，写运行时主链路。
输出严格 JSON：{"story":"一句话主链路","mustEdges":[{"fromPath":"树中真实路径或(外部)或形态固定id","toPath":"树中真实路径或(外部)或形态固定id","label":"中文动宾"}]}
规则：
- mustEdges 必须能串起产品主流程：${(brief.journey || []).join(' → ')}
- 通知/消息发送若存在 notification/messenger/mailer 等锚点，必须连到它们，禁止连到配置 API
- 入口锚点（main/app/server）必须在 mustEdges 一端
- 可选组件（${(brief.optionalSuspects || []).concat(importance.optionalKw).join('、') || '无'}）严禁出现在 mustEdges
${shapeStoryReq}
- 最多 10 条边`;
    try {
      state.story = await chatJson([
        { role: 'system', content: sys },
        { role: 'user', content: `${briefText}\n\n锚点：\n${JSON.stringify(anchors.map((a) => ({ role: a.role, path: a.path, layer: a.layer })), null, 1)}\n${storyFeedback ? '\n上一版问题：\n' + storyFeedback + '\n' : ''}\n摘录：\n${excerptText(30000)}` }
      ], { json: true, temperature: 0.1 });
    } catch (e) {
      log('主链路自述 JSON 解析失败，跳过 story 闸门继续（锚点覆盖仍强制）：', e.message);
      state.story = { story: '', mustEdges: [] };
      break;
    }
    const sg = storyGate(state.story, state.plan, importance, state.tree);
    if (sg.length === 0) { log('主链路自述通过 story 闸门：', (state.story.story || '').slice(0, 150)); break; }
    storyFeedback = sg.join('\n');
    log(`story 闸门驳回 ${sg.length} 条：${sg[0].slice(0, 100)}`);
    if (si === 1) log('story 达轮次上限，带问题继续');
  }
  applyMustEdges(state.plan, state.story, state.tree);
  rewritePlanLayers(state.plan);
  checkpoint(state);

  // 6) 起草（产品自述 + 形态约束 + 主链路 + 热文件摘录）
  const hotText = state.hotExcerpts.map((e) => `\n===== ${e.path} =====\n${e.content}`).join('\n').slice(0, 45000);
  await nodeDraft(`\n${briefText}${shapeText}${extIdText}\n\n主链路（图中必须可走通）：${state.story && state.story.story}\n关键源码摘录：\n${excerptText(40000)}${hotText}`);

  // 7) 核查 → 批判 → 修订（3 轮：前 2 轮含接地批判，第 3 轮纯确定性闸门扫尾）
  for (let loop = 0; loop < 3; loop++) {
    const lint = nodeFactcheck();
    const hard = lint.issues.map((i) => ({ severity: 'high', kind: 'factcheck', issue: i, fix: '修正为真实路径/声明节点' }));
    for (const li of (state.layerIssues || [])) {
      hard.push({ severity: 'high', kind: 'layer', issue: li, fix: '把节点移到路径语义对应的层；随后视为已修，不得改回' });
    }
    for (const t of semanticTraps(state.md)) {
      hard.push({ severity: 'high', kind: 'edge-direction', issue: t, fix: t });
    }
    for (const t of optionalLabelGate(state.md, importance, state.detachedKw)) {
      hard.push({ severity: 'high', kind: 'optional', issue: t, fix: t });
    }
    // 反向闸门：主干/可达代码节点不得误标「可选/实验」（openim push 跨图一致性）
    for (const t of requiredLabelGate(state.md, importance)) {
      hard.push({ severity: 'high', kind: 'required-label', issue: t, fix: t });
    }
    for (const t of notifyDirectionGate(state.md, anchors, companions)) {
      hard.push({ severity: 'high', kind: t.kind, issue: t.issue, fix: t.fix });
    }
    // 结构/叙事闸门（同路径重复 / 孤立节点 / DB当actor / 圆柱错层 / 旁路上主干 / 反向边）
    const structure = structureGates(state.md, anchors, importance, selfActorTokens());
    for (const s of structure.filter((x) => x.severity === 'high')) {
      hard.push({ severity: 'high', kind: s.kind, issue: s.issue, fix: s.fix });
    }
    // 视觉/润色确定性闸门（用法1 观感基线）
    const visual = visualGates(state.md);
    for (const v of visual.filter((x) => x.severity === 'high')) {
      hard.push({ severity: 'high', kind: v.kind, issue: v.issue, fix: v.fix });
    }
    const missing = coverageGate(state.md, anchors);
    for (const a of missing) {
      hard.push({ severity: 'high', kind: 'coverage', issue: `图中缺少签名锚点 ${a.path}（${a.hint}）`, fix: `在 ${a.layer} 层增加节点，<small> 必须含 ${a.path}` });
    }
    // 外部 actor 覆盖
    for (const ac of brief.actors || []) {
      if (!state.md.includes(ac.name)) {
        hard.push({ severity: 'high', kind: 'actor', issue: `图中缺少外部角色「${ac.name}」（${ac.note || ''}）`, fix: `在所有 subgraph 之外用 stadium 形状声明 id(["👤 ${ac.name}<br/><small>(外部)</small>"])，连入主链路，并加 classDef actor fill:#eceff1 上色` });
      }
    }
    // 形态外部系统覆盖（源站/设备对端/推送服务/外部数据库）
    for (const x of state.extList || []) {
      if (x.optional) continue;
      if (!state.md.includes(x.id) && !state.md.includes(x.name)) {
        hard.push({ severity: 'high', kind: 'shape-ext',
          issue: `图中缺少形态必需的外部系统节点「${x.name}」（${x.kind}）`,
          fix: x.shape === 'cylinder'
            ? `在存储层 subgraph 内声明圆柱节点 ${x.id}[("${x.name}<br/><small>(外部)</small>")]，并让代码层数据节点 -->|读写| ${x.id}；代码目录不得画成圆柱`
            : `在所有 subgraph 之外用 stadium 形状声明 ${x.id}(["${x.name}<br/><small>(外部)</small>"])，连入主链路并加 classDef actor 上色；内部节点直连该外部系统是合法边` });
      }
    }
    rewritePlanLayers(state.plan);
    // 接地批判（额外喂产品自述做主干对照；第 3 轮不再调用，省给确定性闸门扫尾）
    let criticIssues = [];
    if (loop < 2) {
      const critique = await nodeCritic(true, brief);
      criticIssues = (critique.issues || []).filter((i) => {
        if (i.kind === 'layer' && state.layerIssues && state.layerIssues.length === 0) return false;
        return i.severity === 'high' || i.severity === 'medium';
      });
    }
    const visualMed = visual.filter((x) => x.severity === 'medium')
      .map((x) => ({ severity: 'medium', kind: x.kind, issue: x.issue, fix: x.fix }));
    const structureMed = structure.filter((x) => x.severity === 'medium')
      .map((x) => ({ severity: 'medium', kind: x.kind, issue: x.issue, fix: x.fix }));
    // 去重（按 issue 文本）+ high 优先，避免同类问题浪费修订预算
    const seen = new Set();
    const allIssues = [...hard, ...criticIssues, ...visualMed, ...structureMed]
      .filter((i) => { const k = i.kind + '|' + i.issue; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (a.severity === 'high' ? 0 : 1) - (b.severity === 'high' ? 0 : 1));
    const highLeft = allIssues.filter((i) => i.severity === 'high').length;
    if (allIssues.length === 0) { log('orch4 核查与批判均通过'); break; }
    log(`orch4 第 ${loop + 1} 轮修订：问题 ${allIssues.length} 条（high ${highLeft}）`);
    // 三轮都执行修订；第 3 轮无批判（纯确定性闸门扫尾），修订指令更强制
    const refined = await nodeRefine(allIssues.slice(0, 16), loop === 2);
    if (refined === false) { log('修订失败，保留当前稿结束修订循环'); break; }
  }
  // 8) 确定性扫尾：LLM 三轮修不掉的机械问题（孤立装饰节点、响应反向边、主干误标可选）程序化处理
  {
    const sweepRes = deterministicSweep(state.md, anchors, selfActorTokens());
    if (sweepRes.actions.length) {
      state.md = sweepRes.md;
      log('确定性扫尾：' + sweepRes.actions.join('；'));
    }
    // 主干服务误标剥离（openim push：可达代码节点的「（可选/实验）」标记必须去掉，保证跨图一致）
    const stripRes = stripMislabeledOptional(state.md, importance);
    if (stripRes.actions.length) {
      state.md = stripRes.md;
      log('主干误标剥离：' + stripRes.actions.join('；'));
    }
  }
  // 终检：报告三轮修订 + 扫尾后仍遗留的确定性问题
  {
    const leftover = [...structureGates(state.md, anchors, importance, selfActorTokens()), ...visualGates(state.md),
      ...requiredLabelGate(state.md, importance).map((t) => ({ severity: 'high', issue: t }))]
      .filter((x) => x.severity === 'high');
    if (leftover.length) log('orch4 三轮修订+扫尾后遗留 high：' + leftover.slice(0, 4).map((x) => x.issue).join('；'));
    else log('orch4 终检：确定性 high 问题全部清零');
  }
  nodeFactcheck();
  const left = coverageGate(state.md, anchors);
  state.coverageMissing = left.map((a) => a.path);
  log('覆盖缺口：', left.length ? left.map((a) => a.path).join(', ') : '无');
}

// ---------- 变体 C/D/E：编排流水线 ----------
// useCritic: false=纯确定性闸门(nocritic)；true=裸眼批判(orch)；'grounded'=接地批判+层闸门(orch2)
async function runOrch(useCritic) {
  const grounded = useCritic === 'grounded';
  nodeGather();
  // plan → gate 循环
  let feedback = null;
  for (let i = 0; i < 3; i++) {
    await nodePlan(feedback);
    const problems = nodeGate();
    if (problems.length === 0) { log('计划路径闸门通过'); break; }
    log(`计划闸门驳回 ${problems.length} 条：${problems.slice(0, 3).join('；')}`);
    feedback = problems.join('\n');
    if (i === 2) log('达计划轮次上限，带问题继续');
  }
  // draft（带源码摘录帮助边语义）
  await nodeDraft(`\n关键源码摘录（边方向/层归属依据）：\n${excerptText(60000)}`);
  // factcheck → critic → refine 循环
  for (let loop = 0; loop < 2; loop++) {
    const lint = nodeFactcheck();
    const hard = lint.issues.map((i) => ({ severity: 'high', kind: 'factcheck', issue: i, fix: '修正为真实路径/声明节点/降低密度' }));
    if (grounded) {
      for (const li of state.layerIssues) hard.push({ severity: 'high', kind: 'layer', issue: li, fix: '把节点移动到路径语义对应的层' });
    }
    let criticIssues = [];
    if (useCritic) {
      const critique = await nodeCritic(grounded);
      criticIssues = (critique.issues || []).filter((i) => i.severity === 'high' || i.severity === 'medium');
      if (loop === 1 && (critique.verdict === 'ok') && hard.length === 0) break;
    }
    const allIssues = [...hard, ...criticIssues];
    if (allIssues.length === 0) { log('核查与批判均通过'); break; }
    if (loop === 1) { log('达修订轮次上限'); break; }
    await nodeRefine(allIssues.slice(0, 12));
  }
  nodeFactcheck();
}

// ---------- orch8：explore JSON → orch4 受故事约束 ----------
async function runOrch8() {
  // 1) 尝试加载 explore.json（由 eval/orch/explore-json.js 产出）
  const explorePaths = [
    path.join(repo, 'architecture_viewer', 'explore.json'),
    path.join(outdir, 'explore.json')
  ];
  let exploreJson = null;
  for (const p of explorePaths) {
    try {
      exploreJson = JSON.parse(fs.readFileSync(p, 'utf8'));
      log('explore.json 已加载：', p, '| shape:', exploreJson.shape, '| source:', exploreJson._shapeSource || 'explore');
      break;
    } catch { /* try next */ }
  }

  // 2) 未找到 → 自动生成（调 explore-json.js）
  if (!exploreJson) {
    log('explore.json 未找到，自动生成…');
    const { spawnSync } = require('child_process');
    const r = spawnSync(process.execPath, [
      path.join(__dirname, '..', '..', 'eval', 'orch', 'explore-json.js'),
      repo, outdir, '--engine', 'auto'
    ], {
      env: process.env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024
    });
    if (r.status !== 0) {
      log('explore-json.js 失败（exit=' + r.status + '），降级为 orch4+shape');
    } else {
      try {
        exploreJson = JSON.parse(fs.readFileSync(path.join(outdir, 'explore.json'), 'utf8'));
        log('explore.json 自动生成成功：shape:', exploreJson.shape, '| source:', exploreJson._shapeSource);
      } catch { log('explore.json 解析失败，降级为 orch4+shape'); }
    }
  }

  // 3) 注入 state.explore（runOrch4 会优先读它）
  if (exploreJson) {
    state.explore = exploreJson;
    log('orch8 形态来源：', exploreJson._shapeSource || 'explore',
      '| shape:', exploreJson.shape,
      '| emptyLayers:', (exploreJson.emptyLayers || []).join(',') || '无',
      '| extSystems:', (exploreJson.externalSystems || []).map((x) => x.id).join(',') || '无');
  } else {
    log('orch8 无 explore 契约，退化为 orch4+shape');
  }

  // 4) 委托 orch4 全流程（plan/draft/critic/sweep 均一致，仅 shape 来源不同）
  await runOrch4();
}

// ---------- main ----------
// ---------- runOrchAuto：按 shapeConfidence 自动在 orch4/orch8 之间切换
// 判定（分支 b + z2m 复测收紧，证据：eval/orch/blind-z2m-retest）：
//   orch4（确定性双引擎A）：
//     - confidence=high（margin>3）
//     - strongTop：第一名打满 10 分且 margin>=3
//     - 强协议形态 proxy/bridge 一律 orch4：z2m(bridge) orch8 盲评 7.67 vs orch4 8.0
//       仍输（已从明显反伤收窄到噪声级），且 explore 对 proxy/bridge 无形态纠正价值
//       （caddy/z2m 的 explore 形态与 shapeDetect 一致）
//   orch8（Agent explore 降级）：
//     - 已知形态误判组合：top2 = {api-svc, notify-bus}（openim）或 {notify-bus, web}（ntfy）
//       —— openim 盲评 3:0 胜、ntfy explore 把 web 纠正为 notify-bus，这是 orch8 证实有收益的区间
//     - 其余 medium/low 置信（形态模糊且非强协议形态）→ explore 兜底
function chooseOrchEngine(importance) {
  const conf = (importance && importance.shapeConfidence) || 'low';
  const margin = Number((importance && importance.shapeMargin) || 0);
  const cands = (importance && importance.shapeCandidates) || [];
  const topScore = (cands[0] && cands[0].score) || 0;
  const topKind = (cands[0] && cands[0].kind) || '';
  const top2Kinds = (cands.slice(0, 2).map((c) => c.kind)).sort().join(',');
  const knownAmbiguousCombo = top2Kinds === 'api-svc,notify-bus' || top2Kinds === 'notify-bus,web';
  const strongTop = topScore >= 10 && margin >= 3;
  // 强协议形态（反向代理/协议桥接）：盲评证据不支持 explore 注入带来交付增益，一律确定性引擎
  const strongProtocolShape = topKind === 'bridge' || topKind === 'proxy';
  const useOrch8 = !((conf === 'high') || strongTop || strongProtocolShape) || knownAmbiguousCombo;
  const shape = importance && importance.shape && importance.shape.kind;
  return {
    engine: useOrch8 ? 'orch8' : 'orch4',
    conf, margin, topScore, topKind, top2Kinds, strongTop, strongProtocolShape, knownAmbiguousCombo, shape
  };
}

async function runOrchAuto() {
  state.variant = 'auto';
  const importance = state.importance || (() => {
    const { scan } = require(path.join(__dirname, '..', 'scan'));
    const tree = buildTree(repo);
    const inv = scan(repo, { write: false });
    return importanceForensics(repo, tree, inv.entrypoints || []);
  })();
  state.importance = importance;
  const choice = chooseOrchEngine(importance);
  log('auto 判定：shape=', choice.shape, '(score=' + choice.topScore + ')',
    '| confidence=', choice.conf, '| margin=', choice.margin,
    '| strongTop=', !!choice.strongTop, '| top2=', choice.top2Kinds,
    '→ 使用引擎 =', choice.engine);
  state.engineChoice = choice;
  fs.mkdirSync(outdir, { recursive: true });
  fs.writeFileSync(path.join(outdir, 'engine-choice.json'), JSON.stringify(choice, null, 2));
  if (choice.engine === 'orch8') return runOrch8();
  return runOrch4();
}

// --- 合成 edge 路径：L1 冠军（auto 引擎）+ deterministic 扫尾 + orch4 闸门软报告
//   定义同 L1：盲评冠军（auto/usage7s 路径）+ 机评门卫（structureGates.high=0, visualGates.high=0）
//   与 auto 的区别：①跑 sweep 最终扫尾；②在输出目录写 edge-quality-report.json（软报告，
//   不阻塞 exit，但硬闸有 high 时设 fallback=true 提醒 CLI 调用方"建议人工复评"）。
async function runOrchEdge() {
  state.variant = 'edge';
  // 1) auto 引擎选择 + 双引擎生成（orch4 / orch8）。注意：orch4 内部会把 state.importance 从
  //   带 info() 函数的对象改写为只含 {edges, optionalKw, detachedList} 的纯字段对象（info
  //   函数无法 JSON 化），因此 step 2 要重新构建 importance，不能依赖 state.importance。
  await runOrchAuto();
  const { scan } = require(path.join(__dirname, '..', 'scan'));
  const tree = buildTree(repo);
  const inv = scan(repo, { write: false });
  const importance = importanceForensics(repo, tree, inv.entrypoints || []);
  state.importanceRaw = importance;  // 保留可 JSON 字段在 state.importance，原始函数版放这里
  const anchors = findAnchorsV2(tree, importance);
  const productTokens = selfActorTokens();

  // 2) deterministic 扫尾
  const sweepRes = deterministicSweep(state.md, anchors, productTokens);
  state.md = sweepRes.md;
  state.sweepActions = sweepRes.actions;

  // 3) 结构+视觉闸门（软报告：不阻塞写入，但作为交付门禁）
  const structure = structureGates(state.md, anchors, importance, productTokens);
  const visual = visualGates(state.md);
  const lint = lintBlockDiagram(state.md, tree);

  const sHigh = structure.filter((x) => x.severity === 'high').length;
  const sMed = structure.filter((x) => x.severity === 'medium').length;
  const sLow = structure.filter((x) => x.severity === 'low').length;
  const vHigh = visual.filter((x) => x.severity === 'high').length;
  const hallucination = lint.metrics.幻觉路径数 || 0;

  // orch4 闸门硬闸口径：sHigh=0 && vHigh=0（即 usage7s/auto 产物不触发结构否决项、视觉否决项）
  // L1 定义：机评 orch4 全过 + 盲评 7s 胜；edge 把 orch4 闸门软报告附加到交付目录，
  // 让评审能一键看到有没有 "闸门否决"。
  const hardGatePass = sHigh === 0 && vHigh === 0 && hallucination === 0;
  const qualityScore = (() => {
    const s = 10 - (hallucination * 10 + sHigh * 5 + sMed * 1 + vHigh * 2);
    return Math.max(0, Math.min(10, s));
  })();

  const report = {
    variant: 'edge',
    engine: state.engineChoice,
    sweepActions: sweepRes.actions,
    gates: {
      hardGatePass,
      // fallback=true 建议调用方（人或 CI）提高警惕：硬闸没通过、或 sMed>0 多、或有 hallucination
      fallback: !hardGatePass || sMed >= 3,
      fallbackReason:
        !hardGatePass
          ? (sHigh ? `硬闸 sHigh=${sHigh}（结构否决）` :
             vHigh ? `硬闸 vHigh=${vHigh}（视觉否决）` :
                     `幻觉路径=${hallucination}（存在代码路径在文件树不存在的节点）`)
          : sMed >= 3 ? `sMed=${sMed} ≥ 3（结构性中危堆积，建议在 sweep 继续打补丁）` : null,
      hallucination,
      sHigh, sMed, sLow, vHigh,
      qualityScore,
      structure,
      visual,
    },
    lintMetrics: lint.metrics,
    detachedKw: state.detachedKw || null,
    coverageMissing: state.coverageMissing || [],
    generatedAt: new Date().toISOString(),
  };

  fs.mkdirSync(outdir, { recursive: true });
  fs.writeFileSync(path.join(outdir, 'edge-quality-report.json'), JSON.stringify(report, null, 2));
  log('[edge] 扫尾动作：', sweepRes.actions.length ? sweepRes.actions.join('；') : '无');
  log('[edge] 质量：hardGate=', hardGatePass, 'sHigh=', sHigh, 'sMed=', sMed, 'vHigh=', vHigh,
      'hallu=', hallucination, 'score=', qualityScore,
      report.gates.fallback ? 'FALLBACK=' + report.gates.fallbackReason : '');
  return report;
}

if (require.main === module) {
  (async () => {
    log('API key:', maskKey(), '| model:', require('./lib').MODEL);
    try {
      if (variant === 'digest') await runDigest();
      else if (variant === 'rich1') await runRich1();
      else if (variant === 'orch') await runOrch(true);
      else if (variant === 'orch2') await runOrch('grounded');
      else if (variant === 'orch3') await runOrch3();
      else if (variant === 'orch4') await runOrch4();
      else if (variant === 'orch8') await runOrch8();
      else if (variant === 'auto') await runOrchAuto();
      else if (variant === 'edge') await runOrchEdge();
      else if (variant === 'nocritic') await runOrch(false);
      else throw new Error('未知 variant: ' + variant);

      fs.writeFileSync(path.join(outdir, 'block-diagram.md'), state.md);
      log('完成。API 调用', usage.calls, '次，tokens', `prompt=${usage.promptTokens} completion=${usage.completionTokens}`);
      log('最终指标：', JSON.stringify(state.lint?.metrics));
      log('最终层归属错误：', state.layerIssues?.length || 0, state.layerIssues?.length ? '→ ' + state.layerIssues.join('；') : '');
      if (state.coverageMissing) log('覆盖缺口：', state.coverageMissing.join(', ') || '无');
      if (state.lint?.issues.length) log('遗留问题：\n - ' + state.lint.issues.join('\n - '));
    } catch (e) {
      log('致命错误：', e.message);
      checkpoint(state);
      process.exit(1);
    }
  })();
}

module.exports = { runOrch3, runOrch4, runOrch8, runOrchAuto, runOrchEdge, chooseOrchEngine, visualGates, optionalLabelGate, requiredLabelGate, stripMislabeledOptional, notifyDirectionGate, structureGates, deterministicSweep, parseBlockStructure, BLOCK_SPEC };
