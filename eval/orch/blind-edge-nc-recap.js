/**
 * edge 复评：ntfy + caddy（用最新 orch4 产物 vs 既有 usage1）
 * 用法: DEEPSEEK_API_KEY=... node eval/orch/blind-edge-nc-recap.js [--round N] [--rounds 3]
 * 产物约定：
 *   usage1: /tmp/arch-orch/out/edge-p1shape/usage1-<short>/block-diagram.md
 *   orch4:  /tmp/arch-orch/out/edge-p1shape/orch4/<repo>/block-diagram.md
 * 输出：/tmp/arch-orch/out/blind-edge-nc-recap/round-<N>.json + judge-<repo>-r<N>.json + summary.json
 */
const fs = require('fs');
const path = require('path');
const { chat, extractJson, usage, maskKey } = require('./lib');

const OUT = '/tmp/arch-orch/out';
const BLIND = path.join(OUT, 'blind-edge-nc-recap');
const ROOT = path.join(OUT, 'edge-p1shape');

const REPOS = [
  { name: 'ntfy', short: 'ntfy',
    profile: 'ntfy 是开源 HTTP 发布/订阅通知总线（Go）：Web 端/CLI 向 topic 发布消息，手机/浏览器经 WebSocket/FCM/WebPush 实时接收；自带邮件/Android 推送通道。' },
  { name: 'caddy', short: 'caddy',
    profile: 'Caddy 是开源反向代理/Web 服务器（Go）：模块化 HTTP 处理链、配置路由/编码/压缩/TLS 自动签发、上游反向代理流；管理员 HTTP API 在线改配。' }
];

const argv = process.argv.slice(2);
let round = 1, totalRounds = 3;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--round') round = parseInt(argv[++i], 10) || 1;
  if (argv[i] === '--rounds') totalRounds = parseInt(argv[++i], 10) || 3;
}

function seededShuffle(arr, seed) {
  const a = arr.slice();
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DIMS = ['path_truth', 'layer_semantics', 'edge_correctness', 'business_naming', 'density_readability', 'spec_compliance', 'deliverable'];

const SYS = (profile) => `你是资深软件架构评审专家，正在盲评同一系统的两份 block-diagram 架构图（Mermaid flowchart + subgraph 分层），你不知道它们分别由什么方法生成。
系统背景：${profile}
请严格按维度逐份打 1-10 整数分：
- path_truth: 节点标注的文件路径是否真实存在、贴合真实代码结构（无臆造路径）
- layer_semantics: 分层是否正确（前端/api/调度队列/worker 异步处理/存储/通知监控/运维；外部系统/协议对端不进子图）
- edge_correctness: 边方向=真实运行时数据流；bridge/proxy/notify-bus 形态的协议双向边合法；存储不直连前端；关键链路完整；无重复边/孤立节点
- business_naming: 中文业务名是否准确、说人话、非模板腔
- density_readability: 节点数 15-30、每层 2-5 个、边不杂乱、有主链路特写
- spec_compliance: Mermaid 语法、classDef 上色、subgraph 结构、外部角色/外部系统 stadium 形状
- deliverable: 综合可交付分（能否直接当架构门户给团队/老板看）
并指出每份图的「关键缺口」和「硬伤」（方向错/幻觉/乱边/形态不闭环）。
判定纪律（避免误判，两份图同一标准）：
- 路径纪律：你看不到真实文件树，禁止凭印象断言某个具体文件路径「不存在」（如 Go 项目里 server/smtp_server.go、server/server.go 这类常规命名）；路径硬伤只判明显语言/结构冲突（如 Go 项目出现 Django models.py、前端工程出现后端 main 包），拿不准不扣分
- 双向边不是重复边：同一对节点之间方向相反的两条边（如 前端→API「请求/订阅」与 API→前端「实时推送(SSE/WS)」）是发布订阅/SSE/WebSocket 形态的合法双向语义；「重复边」仅指同一对节点、同方向、同语义的多条边；同源不同目标的边（如 API 分别触发 FCM 与 WebPush 两个不同通道）也不是重复边
- 形状识别：外部节点声明为 id(["..."]) 即为 stadium 形状（圆括号+方括号），声明在 subgraph 之外即合规；虚线 -.-> 表示部署/可选依赖关系，合法
- 入站/出站分层：入站协议端点（收信 SMTP 服务器、入站 webhook 接收服务）归后端/API 层是正确的；出站投递执行器（sender/notifier/推送执行器）归通知/推送层；外部系统（推送服务/SMTP 中继/外部数据库）在 subgraph 之外才合规
输出严格 JSON：{"scores":[{"id":"A","path_truth":n,"layer_semantics":n,"edge_correctness":n,"business_naming":n,"density_readability":n,"spec_compliance":n,"deliverable":n,"reason":"一句话总评","gaps":"关键缺口","flaws":"硬伤"}],"better":"A或B或tie","comments":"两份差异点一句话"}`;

async function judgeOne(repo, ri, round) {
  const { name, short, profile } = repo;
  const f1 = path.join(ROOT, 'usage1-' + short, 'block-diagram.md');
  const f4 = path.join(ROOT, 'orch4', name, 'block-diagram.md');
  if (!fs.existsSync(f1) || !fs.existsSync(f4)) {
    console.log('[blind] ' + name + ': 产物缺失 u1=' + fs.existsSync(f1) + ' o4=' + fs.existsSync(f4));
    return null;
  }
  const cands = [
    { variant: 'usage1', md: fs.readFileSync(f1, 'utf8') },
    { variant: 'orch4', md: fs.readFileSync(f4, 'utf8') }
  ];
  const anon = seededShuffle(cands.map((c, i) => ({ letter: ['A', 'B'][i], ...c })),
    3000 + round * 131 + ri * 7);
  const key = Object.fromEntries(anon.map((a) => [a.letter, a.variant]));
  const user = anon.map((a) => '===== 图 ' + a.letter + ' =====\n' + a.md).join('\n\n');
  let scores;
  try {
    const raw = await chat([
      { role: 'system', content: SYS(profile) },
      { role: 'user', content: user }
    ], { json: true, temperature: 0.2, maxTokens: 4096 });
    scores = extractJson(raw);
  } catch (e) {
    console.log('[blind] ' + name + ': 评委失败 ' + e.message);
    return null;
  }
  fs.writeFileSync(path.join(BLIND, 'judge-' + short + '-r' + round + '.json'),
    JSON.stringify({ key, scores }, null, 2));
  const row = { repo: name, round, key, scores: scores.scores || [],
    better: scores.better, comments: scores.comments };
  for (const s of row.scores) {
    const v = key[s.id];
    console.log('[blind] ' + name + ' ' + s.id + '=' + v +
      ' 综合' + s.deliverable +
      ' 路径' + s.path_truth + ' 分层' + s.layer_semantics +
      ' 边' + s.edge_correctness + ' 命名' + s.business_naming +
      ' 密度' + s.density_readability + ' 规范' + s.spec_compliance);
    if (s.reason) console.log('         理由: ' + s.reason);
    if (s.gaps)   console.log('         缺口: ' + s.gaps);
    if (s.flaws)  console.log('         硬伤: ' + s.flaws);
  }
  const pick = row.better;
  console.log('[blind] ' + name + ' 选择=' + pick + '→' + (key[pick] || 'tie') +
    (row.comments ? ' | ' + row.comments : ''));
  return row;
}

(async () => {
  fs.mkdirSync(BLIND, { recursive: true });
  const allRows = [];
  for (let r = 1; r <= totalRounds; r++) {
    console.log('\n========== round ' + r + '/' + totalRounds + ' ==========');
    for (let ri = 0; ri < REPOS.length; ri++) {
      const row = await judgeOne(REPOS[ri], ri, r);
      if (row) allRows.push(row);
    }
    const agg = {};
    for (const v of ['usage1', 'orch4'])
      agg[v] = { dims: Object.fromEntries(DIMS.map((d) => [d, []])),
        deliverable: [], wins: 0, losses: 0, ties: 0 };
    for (const row of allRows.filter((x) => x.round === r)) {
      for (const s of row.scores) {
        const v = row.key[s.id];
        if (!agg[v]) continue;
        for (const d of DIMS) if (typeof s[d] === 'number') agg[v].dims[d].push(s[d]);
      }
      const b = row.key[row.better];
      if (b === 'orch4')     { agg.orch4.wins++;   agg.usage1.losses++; }
      else if (b === 'usage1') { agg.usage1.wins++; agg.orch4.losses++; }
      else                     { agg.orch4.ties++;  agg.usage1.ties++; }
    }
    const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    console.log('\n----- 本轮汇总 round=' + r + ' -----');
    for (const v of ['usage1', 'orch4']) {
      const line = DIMS.map((d) => mean(agg[v].dims[d]).toFixed(2)).join(' | ');
      console.log(v.padEnd(8) + ': ' + line + ' | 胜' + agg[v].wins + ' 负' + agg[v].losses + ' 平' + agg[v].ties);
    }
    const delO4 = mean(agg.orch4.dims.deliverable);
    const delU1 = mean(agg.usage1.dims.deliverable);
    console.log('deliverable orch4=' + delO4.toFixed(2) + ' usage1=' + delU1.toFixed(2) +
      ' Δ=' + (delO4 - delU1 >= 0 ? '+' : '') + (delO4 - delU1).toFixed(2));
    fs.writeFileSync(path.join(BLIND, 'round-' + r + '.json'), JSON.stringify({
      round: r, results: allRows.filter((x) => x.round === r),
      agg: Object.fromEntries(Object.entries(agg).map(([k, v]) =>
        [k, { ...v, meanDims: Object.fromEntries(DIMS.map((d) => [d, mean(v.dims[d])])) }]))
    }, null, 2));
  }

  // 跨轮汇总
  const summary = { generated_at: new Date().toISOString(), rounds: totalRounds, repos: REPOS.map((r) => r.name) };
  const totals = {};
  for (const v of ['usage1', 'orch4'])
    totals[v] = { dims: Object.fromEntries(DIMS.map((d) => [d, []])),
      wins: 0, losses: 0, ties: 0 };
  const perRepo = {};
  for (const repo of REPOS) perRepo[repo.name] = {
    wins: { usage1: 0, orch4: 0, tie: 0 },
    dims: { usage1: Object.fromEntries(DIMS.map((d) => [d, []])),
            orch4:  Object.fromEntries(DIMS.map((d) => [d, []])) } };
  for (const row of allRows) {
    for (const s of row.scores) {
      const v = row.key[s.id];
      if (!totals[v]) continue;
      for (const d of DIMS) if (typeof s[d] === 'number') {
        totals[v].dims[d].push(s[d]);
        perRepo[row.repo].dims[v][d].push(s[d]);
      }
    }
    const b = row.key[row.better];
    if (b === 'orch4')     { totals.orch4.wins++;   totals.usage1.losses++;   perRepo[row.repo].wins.orch4++; }
    else if (b === 'usage1') { totals.usage1.wins++; totals.orch4.losses++;   perRepo[row.repo].wins.usage1++; }
    else                     { totals.orch4.ties++;  totals.usage1.ties++;    perRepo[row.repo].wins.tie++; }
  }
  const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  summary.total = {
    wins: { usage1: totals.usage1.wins, orch4: totals.orch4.wins, tie: totals.orch4.ties },
    meanDims: Object.fromEntries(Object.entries(totals).map(([k, v]) =>
      [k, Object.fromEntries(DIMS.map((d) => [d, mean(v.dims[d])]))])),
    deliverableDelta: mean(totals.orch4.dims.deliverable) - mean(totals.usage1.dims.deliverable)
  };
  summary.perRepo = Object.fromEntries(Object.entries(perRepo).map(([repo, v]) => [
    repo, {
      betterCount: v.wins,
      meanDims: Object.fromEntries(Object.entries(v.dims).map(([variant, dims]) =>
        [variant, Object.fromEntries(DIMS.map((d) => [d, mean(dims[d])]))])),
      deliverableDelta: mean(v.dims.orch4.deliverable) - mean(v.dims.usage1.deliverable)
    }
  ]));
  fs.writeFileSync(path.join(BLIND, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('\n========== 跨轮汇总 ==========');
  console.log('总胜负: usage1 ' + summary.total.wins.usage1 + ' - orch4 ' + summary.total.wins.orch4 + ' - tie ' + summary.total.wins.tie);
  console.log('deliverable orch4=' + summary.total.meanDims.orch4.deliverable.toFixed(2) +
    ' usage1=' + summary.total.meanDims.usage1.deliverable.toFixed(2) +
    ' Δ=' + (summary.total.deliverableDelta >= 0 ? '+' : '') + summary.total.deliverableDelta.toFixed(2));
  for (const [repo, v] of Object.entries(summary.perRepo)) {
    console.log(repo.padEnd(14) + ' wins u1:' + v.betterCount.usage1 + ' orch4:' + v.betterCount.orch4 +
      ' Δ=' + (v.deliverableDelta >= 0 ? '+' : '') + v.deliverableDelta.toFixed(2));
  }
  console.log('API calls=' + usage.calls + ' out=' + BLIND);
})().catch((e) => { console.error('Fatal:', e); process.exit(1); });
