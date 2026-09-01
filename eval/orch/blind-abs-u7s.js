/**
 * 绝对打分盲评（去 A/B 相对锚定）：每份图单独评分，不与任何其他图对比。
 * 10 份产物（5 仓 × 用法1/用法7s）匿名编号 P1..P10，种子洗牌，逐份调用评委。
 * 评分带分段锚点（9-10 直接交付 / 7-8 小修可交付 / 5-6 需返工 / <=4 不可用），
 * 使跨场次分数可比。
 * 用法: DEEPSEEK_API_KEY=... node eval/orch/blind-abs-u7s.js
 * 产物: /tmp/arch-orch/out/blind-abs-u7s/round-1.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chat, extractJson, usage, maskKey } = require('./lib');

const REPOS = [
  { name: 'changedetection.io', short: 'changedetection', brief: 'changedetection.io 是开源网页变更监控平台：用户添加待监控网址，后台按计划抓取网页，检测到内容变化时通过通知渠道（邮件/Apprise/80+ 渠道）告警。Python/Flask + 队列 + worker 抓取 + 通知服务。' },
  { name: 'listmonk', short: 'listmonk', brief: 'listmonk 是开源邮件营销/新闻通讯系统（Go + 前端）：管理员导入订阅者、创建邮件活动，系统通过 SMTP 批量发信，支持事务消息、模板管理、点击/打开统计。' },
  { name: 'uptime-kuma', short: 'uptime-kuma', brief: 'Uptime Kuma 是开源网站/服务监控工具（Node.js）：用户添加监控项，系统定时探测 HTTP/TCP/Ping/Docker 等，检测到宕机通过 90+ 通知渠道告警，状态页实时展示。' },
  { name: 'memos', short: 'memos', brief: 'memos 是开源轻量笔记/碎片记录应用（Go + React）：用户记录笔记（memo），按时间线展示，支持标签、搜索、分享；AI 功能（OpenAI/Gemini）是可选插件，不是主干。' },
  { name: 'umami', short: 'umami', brief: 'umami 是开源网站流量分析平台（Next.js + ClickHouse/PostgreSQL）：网站埋点上报事件，后端采集写入分析数据库，前端仪表盘展示访问统计；Kafka 仅为大规模部署的可选消息队列，非默认必经路径。' }
];
const OUT = '/tmp/arch-orch/out';
const DIR = path.join(OUT, 'blind-abs-u7s');
fs.mkdirSync(DIR, { recursive: true });

const SYS = `你是资深软件架构评审专家。给你一份产品简介和一份 block-diagram 架构图（Mermaid flowchart，可能含分层全景 subgraph 与主链路特写两个图）。
请完全独立地评价这一份图——不要假设存在其他对比图，按你心中的绝对交付标准打分。
逐维度打 1-10 整数分，分段锚点：9-10=可直接贴到架构门户交付；7-8=小修后可交付；5-6=有明显硬伤需返工；3-4=方向有问题；1-2=不可用。
维度：
- story: 主链路叙事是否完整且贴合产品（外部角色入口 → 核心处理链 → 存储 → 该产品标志性机制如通知/发信/告警/统计；可选/实验功能不占主干）
- layer: 分层语义是否正确（前端/api/调度/worker/存储/通知监控/运维 各归其位）
- edge: 边方向是否=真实运行时数据流，有无反向边/乱边/多余边，关键链路有无断点
- paths: 节点标注的文件路径是否具体、真实、贴代码结构
- naming: 中文业务命名是否准确、有业务味、非模板腔
- density: 节点/边密度与可读性（每层 2-6 节点，边不杂乱，无孤立节点）
- spec: Mermaid 规范度（classDef 上色、子图分层、主链路特写、外部角色形状）
- deliverable: 综合可交付分
输出严格 JSON：
{"story":n,"layer":n,"edge":n,"paths":n,"naming":n,"density":n,"spec":n,"deliverable":n,"reason":"一句话总评","main_flaw":"最主要的一个问题或无"}`;

(async () => {
  console.log('[abs] API key:', maskKey());
  // 组装 10 份产物并种子洗牌
  const items = [];
  for (const repo of REPOS) {
    items.push({ repo: repo.name, method: 'usage1', brief: repo.brief,
      file: path.join(OUT, 'usage1-' + repo.short, 'block-diagram.md') });
    items.push({ repo: repo.name, method: 'u7s', brief: repo.brief,
      file: path.join(OUT, 'usage7s-' + repo.short, 'block-diagram.md') });
  }
  let s = 20260831;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  items.forEach((it, i) => { it.code = 'P' + (i + 1); });

  const results = [];
  for (const it of items) {
    if (!fs.existsSync(it.file)) { console.log(`[abs] ${it.repo}/${it.method} 缺产物，跳过`); continue; }
    const user = `产品简介：${it.brief}

===== 待评架构图（编号 ${it.code}） =====
${fs.readFileSync(it.file, 'utf8')}`;
    let scored = null;
    for (let attempt = 1; attempt <= 3 && !scored; attempt++) {
      try {
        const raw = await chat([
          { role: 'system', content: SYS },
          { role: 'user', content: user }
        ], { json: true, temperature: 0.15, maxTokens: 2048 });
        scored = extractJson(raw);
      } catch (e) {
        console.log(`[abs] ${it.code} 第${attempt}次调用失败:`, e.message);
      }
    }
    if (!scored) { console.log(`[abs] ${it.code} 评委放弃`); continue; }
    const row = { code: it.code, repo: it.repo, method: it.method, scores: scored };
    results.push(row);
    console.log(`[abs] ${it.code} ${it.repo}/${it.method}: deliverable=${scored.deliverable} (story${scored.story}/edge${scored.edge}/spec${scored.spec}) | ${scored.reason}`);
    fs.writeFileSync(path.join(DIR, 'round-1.json'), JSON.stringify(results, null, 2));
  }

  console.log('\n========== 绝对打分汇总 ==========');
  const byMethod = { usage1: [], u7s: [] };
  for (const r of results) byMethod[r.method].push(r);
  for (const repo of REPOS) {
    const a = results.find((r) => r.repo === repo.name && r.method === 'usage1');
    const b = results.find((r) => r.repo === repo.name && r.method === 'u7s');
    if (a && b) console.log(`${repo.name.padEnd(20)} 用法1=${a.scores.deliverable}  u7s=${b.scores.deliverable}  Δ=${(b.scores.deliverable - a.scores.deliverable).toFixed(0)}`);
  }
  const avg = (arr) => (arr.reduce((n, r) => n + r.scores.deliverable, 0) / (arr.length || 1)).toFixed(2);
  const dims = ['story', 'layer', 'edge', 'paths', 'naming', 'density', 'spec', 'deliverable'];
  console.log('\n维度均分:');
  for (const d of dims) {
    const a1 = (byMethod.usage1.reduce((n, r) => n + r.scores[d], 0) / (byMethod.usage1.length || 1)).toFixed(2);
    const a7 = (byMethod.u7s.reduce((n, r) => n + r.scores[d], 0) / (byMethod.u7s.length || 1)).toFixed(2);
    console.log(`  ${d.padEnd(12)} 用法1=${a1}  u7s=${a7}  Δ=${(a7 - a1).toFixed(2)}`);
  }
  console.log(`\n交付均分: 用法1=${avg(byMethod.usage1)}  u7s=${avg(byMethod.u7s)}`);
  console.log('API 调用', usage.calls, '次');
})().catch((e) => { console.error('致命错误:', e); process.exit(1); });
