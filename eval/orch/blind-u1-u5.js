/**
 * 五仓配对盲评：用法1（Cursor Agent 人工基准）vs orch4（LLM 编排引擎）。
 * 每仓一次评委调用：两份图匿名洗牌为 A/B，附产品 README 简介，评委按交付物维度打分并选胜者。
 * 用法: DEEPSEEK_API_KEY=... node eval/orch/blind-u1-u5.js [--round N]
 * 产物: /tmp/arch-orch/out/blind-u1-u5/round-<N>.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chat, extractJson, usage, maskKey } = require('./lib');

const REPOS = [
  { name: 'changedetection.io', brief: 'changedetection.io 是开源网页变更监控平台：用户添加待监控网址，后台按计划抓取网页，检测到内容变化时通过通知渠道（邮件/Apprise/80+ 渠道）告警。Python/Flask + 队列 + worker 抓取 + 通知服务。' },
  { name: 'listmonk', brief: 'listmonk 是开源邮件营销/新闻通讯系统（Go + 前端）：管理员导入订阅者、创建邮件活动，系统通过 SMTP 批量发信，支持事务消息、模板管理、点击/打开统计。' },
  { name: 'uptime-kuma', brief: 'Uptime Kuma 是开源网站/服务监控工具（Node.js）：用户添加监控项，系统定时探测 HTTP/TCP/Ping/Docker 等，检测到宕机通过 90+ 通知渠道告警，状态页实时展示。' },
  { name: 'memos', brief: 'memos 是开源轻量笔记/碎片记录应用（Go + React）：用户记录笔记（memo），按时间线展示，支持标签、搜索、分享；AI 功能（OpenAI/Gemini）是可选插件，不是主干。' },
  { name: 'umami', brief: 'umami 是开源网站流量分析平台（Next.js + ClickHouse/PostgreSQL）：网站埋点上报事件，后端采集写入分析数据库，前端仪表盘展示访问统计；Kafka 仅为大规模部署的可选消息队列，非默认必经路径。' }
];
const OUT = '/tmp/arch-orch/out';
const BLIND = path.join(OUT, 'blind-u1-u5');
fs.mkdirSync(BLIND, { recursive: true });

const roundArg = (process.argv[2] || '').match(/--round(?:=|\s+)(\d+)/);
const ROUND = roundArg ? Number(roundArg[1]) : 1;

function mdUsage1(repo) {
  return path.join(OUT, 'usage1-' + repo.replace(/\.io$/, ''), 'block-diagram.md');
}
function mdOrch4(repo) {
  return path.join(OUT, 'orch4', repo, 'block-diagram.md');
}

// 每仓固定种子洗牌，可复现；不同仓不同种子避免顺序偏差
function seededPick(seed) {
  let s = seed;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  return rnd() < 0.5 ? ['usage1', 'orch4'] : ['orch4', 'usage1'];
}

const SYS = `你是资深软件架构评审专家，正在盲评同一系统的两份 block-diagram 架构图（Mermaid flowchart + subgraph 分层 + 主链路特写）。
你不知道每份图由什么方法生成（一份是资深工程师用 AI 编程助手手工迭代产出，一份是全自动 LLM 编排流水线产出）。
我会给你产品简介和两份图（图 A、图 B）。请严格按维度各打 1-10 整数分，并给一句话理由：
- story: 主链路叙事是否完整且贴合产品（用户/外部角色入口 → 核心处理链 → 存储 → 该产品标志性机制如通知/发信/告警/统计；可选/实验功能不应占据主干）
- layer: 分层语义是否正确（前端/api/调度/worker/存储/通知监控/运维 各归其位）
- edge: 边方向是否=真实运行时数据流，有无反向边/乱边/多余边，关键链路有无断点
- paths: 节点标注的文件路径是否具体、真实、贴代码结构（而非笼统的 src/ 或编造）
- naming: 中文业务命名是否准确、有业务味、非模板腔
- density: 节点/边密度与可读性（每层 2-6 节点，边不杂乱，无孤立节点）
- spec: Mermaid 规范度（classDef 上色、子图分层、主链路特写、外部角色形状）
- deliverable: 综合可交付分——能否直接贴到架构门户给团队/老板看
另外指出：每份图把什么组件错误地抬成了主干、或漏掉了什么产品标志性链路（没有则写"无"）。
输出严格 JSON：
{"A":{"story":n,"layer":n,"edge":n,"paths":n,"naming":n,"density":n,"spec":n,"deliverable":n,"reason":"一句话","over_emphasized":"被错抬主干的组件或无","missing_link":"漏掉的标志性链路或无"},"B":{...同结构},"winner":"A 或 B 或 tie","decisive":"决胜的一句话"}`;

(async () => {
  console.log('[blind] API key:', maskKey(), '| round', ROUND);
  const results = [];
  for (let i = 0; i < REPOS.length; i++) {
    const repo = REPOS[i];
    const f1 = mdUsage1(repo.name);
    const f4 = mdOrch4(repo.name);
    if (!fs.existsSync(f1) || !fs.existsSync(f4)) {
      console.log(`[blind] ${repo.name} 缺产物，跳过`);
      continue;
    }
    const order = seededPick(42 + i * 7 + ROUND * 131);
    const files = { usage1: f1, orch4: f4 };
    const letterOf = { [order[0]]: 'A', [order[1]]: 'B' };
    const user = `产品简介：${repo.brief}

===== 图 A =====
${fs.readFileSync(files[order[0]], 'utf8')}

===== 图 B =====
${fs.readFileSync(files[order[1]], 'utf8')}`;

    let scored = null;
    for (let attempt = 1; attempt <= 3 && !scored; attempt++) {
      try {
        const raw = await chat([
          { role: 'system', content: SYS },
          { role: 'user', content: user }
        ], { json: true, temperature: 0.15, maxTokens: 4096 });
        scored = extractJson(raw);
      } catch (e) {
        console.log(`[blind] ${repo.name} 第${attempt}次评委调用失败:`, e.message);
      }
    }
    if (!scored) { console.log(`[blind] ${repo.name} 评委放弃`); continue; }

    const reveal = { A: order[0], B: order[1] };
    const row = {
      repo: repo.name,
      order,
      reveal,
      winnerLetter: scored.winner,
      winnerMethod: scored.winner === 'tie' ? 'tie' : reveal[scored.winner],
      decisive: scored.decisive,
      scores: {
        usage1: scored[letterOf.usage1 === 'A' ? 'A' : 'B'],
        orch4: scored[letterOf.orch4 === 'A' ? 'A' : 'B']
      }
    };
    results.push(row);
    const s1 = row.scores.usage1, s4 = row.scores.orch4;
    console.log(`[blind] ${repo.name}: 用法1=${s1.deliverable} orch4=${s4.deliverable} | 胜者=${row.winnerMethod} | ${row.decisive}`);
    fs.writeFileSync(path.join(BLIND, `round-${ROUND}.json`), JSON.stringify(results, null, 2));
  }

  // 汇总
  console.log('\n========== 配对盲评汇总（round ' + ROUND + '） ==========');
  let w1 = 0, w4 = 0, wt = 0;
  let sum1 = 0, sum4 = 0;
  for (const r of results) {
    const s1 = r.scores.usage1, s4 = r.scores.orch4;
    sum1 += s1.deliverable; sum4 += s4.deliverable;
    if (r.winnerMethod === 'usage1') w1++;
    else if (r.winnerMethod === 'orch4') w4++;
    else wt++;
    console.log(`${r.repo.padEnd(20)} 用法1=${s1.deliverable} (story${s1.story}/layer${s1.layer}/edge${s1.edge}/paths${s1.paths})  orch4=${s4.deliverable} (story${s4.story}/layer${s4.layer}/edge${s4.edge}/paths${s4.paths})  胜者=${r.winnerMethod}`);
    if (r.scores.orch4.over_emphasized) console.log(`    orch4 错抬: ${r.scores.orch4.over_emphasized} | 漏链: ${r.scores.orch4.missing_link}`);
    if (r.scores.usage1.over_emphasized) console.log(`    用法1 错抬: ${r.scores.usage1.over_emphasized} | 漏链: ${r.scores.usage1.missing_link}`);
  }
  const n = results.length || 1;
  console.log(`\n均分: 用法1=${(sum1 / n).toFixed(2)}  orch4=${(sum4 / n).toFixed(2)}  Δ=${(sum4 / n - sum1 / n).toFixed(2)}`);
  console.log(`胜场: 用法1=${w1}  orch4=${w4}  平=${wt}`);
  console.log('API 调用', usage.calls, '次');
})().catch((e) => { console.error('致命错误:', e); process.exit(1); });
