/**
 * 五仓盲评：usage1（Cursor Agent 人工基准）vs orch4（编排流水线），匿名 A/B 洗牌后 LLM 评委打分。
 * 用法: DEEPSEEK_API_KEY=... node eval/orch/blind-u1-orch4.js
 * 产物：
 *   usage1: /tmp/arch-orch/out/usage1-<short>/block-diagram.md
 *   orch4:  /tmp/arch-orch/out/orch4/<repo>/block-diagram.md
 * 输出：/tmp/arch-orch/out/blind-u1-orch4/{judge-<repo>.json,summary.json}
 */
const fs = require('fs');
const path = require('path');
const { chat, extractJson, usage, maskKey } = require('./lib');

const OUT = '/tmp/arch-orch/out';
const REPOS = [
  { name: 'changedetection.io', short: 'changedetection',
    profile: 'changedetection.io 是开源网页变更监控平台：定时抓取目标网页、检测内容差异、通过邮件/Apprise 等渠道发送变更通知；含实时推送、队列、抓取 worker、数据存储。' },
  { name: 'listmonk', short: 'listmonk',
    profile: 'listmonk 是自托管新闻通讯与邮件列表管理工具（Go）：Web 界面管理订阅者与邮件活动、任务调度、批量邮件经 SMTP 发送、退信处理；含 PostgreSQL 存储。' },
  { name: 'uptime-kuma', short: 'uptime-kuma',
    profile: 'uptime-kuma 是自托管网站/服务监控工具（Node.js）：定时 HTTP/TCP/ping 探测、WebSocket 实时推送状态到浏览器、通知渠道（90+ 种）、状态页；含 SQLite 存储与定时任务队列。' },
  { name: 'memos', short: 'memos',
    profile: 'memos 是自托管轻量笔记/备忘录平台（Go + React）：Markdown 笔记 CRUD、多用户、API 路由层、异步任务 runner、通知、SQLite/MySQL 存储。' },
  { name: 'umami', short: 'umami',
    profile: 'umami 是自托管隐私友好网站分析平台（Next.js）：埋点上报 API、ClickHouse/MySQL 存储、实时访客 SSE 推送、仪表盘报表前端、后台 recorder/tracker 处理。' }
];

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

(async () => {
  console.log('[blind] API key:', maskKey());
  const outDir = path.join(OUT, 'blind-u1-orch4');
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];

  for (let ri = 0; ri < REPOS.length; ri++) {
    const { name, short, profile } = REPOS[ri];
    const f1 = path.join(OUT, `usage1-${short}`, 'block-diagram.md');
    const f4 = path.join(OUT, 'orch4', name, 'block-diagram.md');
    if (!fs.existsSync(f1) || !fs.existsSync(f4)) {
      console.log(`[blind] ${name}: 产物缺失（usage1=${fs.existsSync(f1)} orch4=${fs.existsSync(f4)}），跳过`);
      continue;
    }
    const cands = [
      { variant: 'usage1', md: fs.readFileSync(f1, 'utf8') },
      { variant: 'orch4', md: fs.readFileSync(f4, 'utf8') }
    ];
    // 每仓不同种子洗牌，消除 A/B 位置偏差
    const anon = seededShuffle(cands.map((c, i) => ({ letter: ['A', 'B'][i], ...c })), 100 + ri * 7);
    const key = Object.fromEntries(anon.map((a) => [a.letter, a.variant]));

    const sys = `你是资深软件架构评审专家，正在盲评同一系统的两份 block-diagram 架构图（Mermaid flowchart + subgraph 分层），你不知道它们分别由什么方法生成。
系统背景：${profile}
请严格按维度逐份打 1-10 整数分：
- path_truth: 节点标注的文件路径是否真实存在、贴合真实代码结构（无臆造路径）
- layer_semantics: 分层是否正确（前端/api/调度队列/worker 异步处理/存储/通知监控/运维）
- edge_correctness: 边方向=真实运行时数据流（用户→前端→API→业务→存储；通知服务→渠道；存储不直连前端）；关键链路完整无缺口；无重复边/孤立节点
- business_naming: 中文业务名是否准确、说人话、非模板腔
- density_readability: 节点数 15-30、每层 2-5 个、边不杂乱、有主链路特写
- spec_compliance: Mermaid 语法、classDef 上色、subgraph 结构、外部角色 stadium 形状
- deliverable: 综合可交付分（能否直接当架构门户给团队/老板看）
并指出每份图的「关键缺口」（本该出场却缺失的执行环节）和「硬伤」（方向错/幻觉/乱边）。
输出严格 JSON：{"scores":[{"id":"A","path_truth":n,"layer_semantics":n,"edge_correctness":n,"business_naming":n,"density_readability":n,"spec_compliance":n,"deliverable":n,"reason":"一句话总评","gaps":"关键缺口","flaws":"硬伤"}],"better":"A或B或tie","comments":"两份差异点一句话"}`;
    const user = anon.map((a) => `===== 图 ${a.letter} =====\n${a.md}`).join('\n\n');

    let scores;
    try {
      const raw = await chat([
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ], { json: true, temperature: 0.2, maxTokens: 4096 });
      scores = extractJson(raw);
    } catch (e) {
      console.log(`[blind] ${name}: 评委调用失败：${e.message}`);
      continue;
    }
    fs.writeFileSync(path.join(outDir, `judge-${short}.json`), JSON.stringify({ key, scores }, null, 2));

    const row = { repo: name, key, scores: scores.scores || [], better: scores.better, comments: scores.comments };
    results.push(row);
    for (const s of row.scores) {
      const v = key[s.id];
      console.log(`[blind] ${name} 图${s.id}=${v}: 综合 ${s.deliverable} | 路径${s.path_truth} 分层${s.layer_semantics} 边${s.edge_correctness} 命名${s.business_naming} 密度${s.density_readability} 规范${s.spec_compliance}`);
      console.log(`         理由: ${s.reason || ''}`);
      if (s.flaws) console.log(`         硬伤: ${s.flaws}`);
    }
    console.log(`[blind] ${name} 评委选择: ${scores.better} → ${key[scores.better] || 'tie'} | ${scores.comments || ''}`);
  }

  // ---- 汇总 ----
  const agg = {};
  for (const v of ['usage1', 'orch4']) {
    agg[v] = { dims: Object.fromEntries(DIMS.map((d) => [d, []])), deliverable: [], wins: 0, losses: 0, ties: 0 };
  }
  for (const row of results) {
    for (const s of row.scores) {
      const v = row.key[s.id];
      if (!agg[v]) continue;
      for (const d of DIMS) if (typeof s[d] === 'number') agg[v].dims[d].push(s[d]);
    }
    const betterVar = row.key[row.better];
    if (betterVar === 'orch4') { agg.orch4.wins++; agg.usage1.losses++; }
    else if (betterVar === 'usage1') { agg.usage1.wins++; agg.orch4.losses++; }
    else { agg.orch4.ties++; agg.usage1.ties++; }
  }
  const mean = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : 0);
  console.log('\n========== 五仓盲评汇总 ==========');
  console.log('维度（均值）: ' + DIMS.join(' | '));
  for (const v of ['usage1', 'orch4']) {
    const line = DIMS.map((d) => mean(agg[v].dims[d]).toFixed(2)).join(' | ');
    console.log(`${v.padEnd(8)}: ${line} | 胜${agg[v].wins} 负${agg[v].losses} 平${agg[v].ties}`);
  }
  const gap = mean(agg.orch4.dims.deliverable) - mean(agg.usage1.dims.deliverable);
  console.log(`\ndeliverable 差距（orch4 - usage1）: ${gap >= 0 ? '+' : ''}${gap.toFixed(2)}`);
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ results, agg: Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, { ...v, meanDims: Object.fromEntries(DIMS.map((d) => [d, mean(v.dims[d])])) }])) }, null, 2));
  console.log('API 调用', usage.calls, '次；明细：', outDir);
})().catch((e) => { console.error('致命错误:', e); process.exit(1); });
