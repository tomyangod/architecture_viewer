'use strict';

/**
 * 战役盲评：双引擎冠军 vs 用法1（同日 · 现有产物 · 不重生图）
 * Web 五仓: usage7s vs usage1
 * Edge 四仓: orch4@edge-p1shape vs usage1
 *
 * 用法: DEEPSEEK_API_KEY=... node eval/orch/blind-combat.js [--round N] [--sets web,edge]
 * 产物: /tmp/arch-orch/out/blind-combat/round-<N>.json
 * 聚合: node eval/orch/blind-combat.js --aggregate
 */

const fs = require('fs');
const path = require('path');
const { chat, extractJson, usage, maskKey } = require('./lib');

const OUT = process.env.OUT || '/tmp/arch-orch/out';
const BLIND = path.join(OUT, 'blind-combat');

const WEB = [
  { name: 'changedetection.io', short: 'changedetection', set: 'web', champ: 'usage7s',
    brief: 'changedetection.io 是开源网页变更监控平台：用户添加待监控网址，后台按计划抓取网页，检测到内容变化时通过通知渠道告警。Python/Flask + 队列 + worker + 通知。' },
  { name: 'listmonk', short: 'listmonk', set: 'web', champ: 'usage7s',
    brief: 'listmonk 是开源邮件营销/新闻通讯系统（Go）：管理员导入订阅者、创建活动，经 SMTP 批量发信，支持事务消息与统计。' },
  { name: 'uptime-kuma', short: 'uptime-kuma', set: 'web', champ: 'usage7s',
    brief: 'Uptime Kuma 是开源网站/服务监控（Node.js）：定时探测 HTTP/TCP/Ping 等，宕机经多渠道告警，状态页展示。' },
  { name: 'memos', short: 'memos', set: 'web', champ: 'usage7s',
    brief: 'memos 是开源轻量笔记应用（Go + React）：时间线 memo、标签搜索分享；AI 为可选插件非主干。' },
  { name: 'umami', short: 'umami', set: 'web', champ: 'usage7s',
    brief: 'umami 是开源网站流量分析（Next.js + DB）：埋点上报、采集入库、仪表盘统计；Kafka 仅大规模可选。' }
];
const EDGE = [
  { name: 'caddy', short: 'caddy', set: 'edge', champ: 'orch4',
    brief: 'Caddy 是开源反向代理/Web 服务器（Go）：模块化 HTTP 链、TLS 自动签发、上游反代、管理 API。' },
  { name: 'ntfy', short: 'ntfy', set: 'edge', champ: 'orch4',
    brief: 'ntfy 是开源 HTTP 发布/订阅通知总线（Go）：向 topic 发布，经 WebSocket/FCM/WebPush 接收。' },
  { name: 'vaultwarden', short: 'vaultwarden', set: 'edge', champ: 'orch4',
    brief: 'Vaultwarden 是 Bitwarden 兼容后端（Rust）：密码库同步 API、SMTP、WebSocket、SQL 存储。' },
  { name: 'zigbee2mqtt', short: 'zigbee2mqtt', set: 'edge', champ: 'orch4',
    brief: 'zigbee2mqtt 是协议桥（TypeScript）：Zigbee 协调器 ↔ MQTT，双向控制与状态发布。' }
];

const DIMS = ['story', 'layer', 'edge', 'paths', 'naming', 'density', 'spec', 'deliverable'];

function mdUsage1(spec) {
  return path.join(OUT, 'usage1-' + spec.short, 'block-diagram.md');
}
function mdChamp(spec) {
  if (spec.champ === 'usage7s') return path.join(OUT, 'usage7s-' + spec.short, 'block-diagram.md');
  const edge = path.join(OUT, 'edge-p1shape', 'orch4', spec.name, 'block-diagram.md');
  if (fs.existsSync(edge)) return edge;
  return path.join(OUT, 'orch4', spec.name, 'block-diagram.md');
}

function seededOrder(seed) {
  let s = seed;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  return rnd() < 0.5 ? ['usage1', 'champ'] : ['champ', 'usage1'];
}

const SYS = `你是资深软件架构评审专家，盲评同一系统的两份 block-diagram（Mermaid flowchart + subgraph 分层）。
不知道生成方法。按维度打 1-10 整数分：
- story: 主链路是否贴合产品
- layer: 分层语义
- edge: 边方向=真实数据流
- paths: 路径真实具体
- naming: 中文业务命名
- density: 密度与可读性
- spec: Mermaid 规范与特写
- deliverable: 综合可交付
输出严格 JSON：
{"A":{"story":n,"layer":n,"edge":n,"paths":n,"naming":n,"density":n,"spec":n,"deliverable":n,"reason":"..."},"B":{...},"winner":"A"|"B"|"tie","decisive":"..."}`;

function mean(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

async function runRound(round, sets) {
  fs.mkdirSync(BLIND, { recursive: true });
  const repos = [];
  if (sets.includes('web')) repos.push(...WEB);
  if (sets.includes('edge')) repos.push(...EDGE);

  console.log('[blind-combat] round', round, 'key', maskKey(), 'n=', repos.length);
  const results = [];

  for (let i = 0; i < repos.length; i++) {
    const spec = repos[i];
    const f1 = mdUsage1(spec);
    const fc = mdChamp(spec);
    if (!fs.existsSync(f1) || !fs.existsSync(fc)) {
      console.log('[skip]', spec.short, 'missing', !fs.existsSync(f1) ? 'u1' : '', !fs.existsSync(fc) ? 'champ' : '');
      continue;
    }
    const order = seededOrder(1000 + round * 131 + i * 17);
    const files = { usage1: f1, champ: fc };
    const letterOf = { [order[0]]: 'A', [order[1]]: 'B' };
    const user = `产品简介：${spec.brief}\n\n===== 图 A =====\n${fs.readFileSync(files[order[0]], 'utf8')}\n\n===== 图 B =====\n${fs.readFileSync(files[order[1]], 'utf8')}`;

    let scored = null;
    for (let attempt = 1; attempt <= 3 && !scored; attempt++) {
      try {
        const raw = await chat(
          [{ role: 'system', content: SYS }, { role: 'user', content: user }],
          { json: true, temperature: 0.15, maxTokens: 4096 }
        );
        scored = extractJson(raw);
      } catch (e) {
        console.log('[retry]', spec.short, attempt, e.message);
      }
    }
    if (!scored) {
      console.log('[fail]', spec.short);
      continue;
    }
    const reveal = { A: order[0], B: order[1] };
    const winnerMethod = scored.winner === 'tie' ? 'tie' : reveal[scored.winner];
    const row = {
      repo: spec.name,
      short: spec.short,
      set: spec.set,
      champ: spec.champ,
      order,
      reveal,
      winnerLetter: scored.winner,
      winnerMethod,
      decisive: scored.decisive,
      scores: {
        usage1: scored[letterOf.usage1],
        champ: scored[letterOf.champ]
      },
      mtimes: {
        usage1: fs.statSync(f1).mtime.toISOString(),
        champ: fs.statSync(fc).mtime.toISOString()
      }
    };
    results.push(row);
    const d1 = row.scores.usage1 && row.scores.usage1.deliverable;
    const dc = row.scores.champ && row.scores.champ.deliverable;
    console.log(`[ok] ${spec.short} winner=${winnerMethod} u1=${d1} champ=${dc} Δ=${(dc - d1).toFixed?.(1) ?? dc - d1}`);
  }

  const out = {
    campaign: 'blind-combat',
    round,
    generated_at: new Date().toISOString(),
    usage: { ...usage },
    results
  };
  const fp = path.join(BLIND, 'round-' + round + '.json');
  fs.writeFileSync(fp, JSON.stringify(out, null, 2));
  console.log('[wrote]', fp);
  return out;
}

function aggregate() {
  const rounds = [1, 2, 3].map((r) => {
    const p = path.join(BLIND, 'round-' + r + '.json');
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  }).filter(Boolean);

  if (!rounds.length) {
    console.error('no rounds');
    process.exit(1);
  }

  const byRepo = {};
  for (const rnd of rounds) {
    for (const row of rnd.results) {
      if (!byRepo[row.short]) {
        byRepo[row.short] = {
          set: row.set,
          champ: row.champ,
          usage1: Object.fromEntries(DIMS.map((d) => [d, []])),
          champScores: Object.fromEntries(DIMS.map((d) => [d, []])),
          wins: { champ: 0, usage1: 0, tie: 0 }
        };
      }
      const bucket = byRepo[row.short];
      for (const d of DIMS) {
        bucket.usage1[d].push(+(row.scores.usage1 && row.scores.usage1[d]) || 0);
        bucket.champScores[d].push(+(row.scores.champ && row.scores.champ[d]) || 0);
      }
      if (row.winnerMethod === 'champ' || row.winnerMethod === 'usage7s' || row.winnerMethod === 'orch4') {
        bucket.wins.champ++;
      } else if (row.winnerMethod === 'usage1') {
        bucket.wins.usage1++;
      } else {
        bucket.wins.tie++;
      }
    }
  }

  function setStats(setName) {
    const repos = Object.entries(byRepo).filter(([, v]) => v.set === setName);
    const uDl = [];
    const cDl = [];
    const wins = { champ: 0, usage1: 0, tie: 0 };
    const per = {};
    for (const [short, b] of repos) {
      const ud = mean(b.usage1.deliverable);
      const cd = mean(b.champScores.deliverable);
      uDl.push(ud);
      cDl.push(cd);
      wins.champ += b.wins.champ;
      wins.usage1 += b.wins.usage1;
      wins.tie += b.wins.tie;
      per[short] = {
        u1: +ud.toFixed(2),
        champ: +cd.toFixed(2),
        delta: +(cd - ud).toFixed(2),
        wins: { ...b.wins }
      };
    }
    return {
      n: repos.length,
      u1_mean: +mean(uDl).toFixed(2),
      champ_mean: +mean(cDl).toFixed(2),
      delta: +(mean(cDl) - mean(uDl)).toFixed(2),
      wins,
      per,
      pass_s1_2: setName === 'web' ? mean(cDl) >= mean(uDl) : (mean(cDl) - mean(uDl)) >= -0.5,
      // 稳定性：每仓均值 ≥ 用法1
      pass_s1_3: repos.every(([, b]) => mean(b.champScores.deliverable) >= mean(b.usage1.deliverable))
    };
  }

  const web = setStats('web');
  const edge = setStats('edge');
  const summary = {
    generated_at: new Date().toISOString(),
    rounds: rounds.map((r) => r.round),
    web,
    edge,
    plan_s1_2: web.pass_s1_2 && edge.pass_s1_2 ? 'PASS' : 'FAIL',
    plan_s1_3: web.pass_s1_3 && edge.pass_s1_3 ? 'PASS' : 'FAIL',
    note: '同战役产物 + 同批评委；不拼接历史分'
  };

  const fp = path.join(BLIND, 'summary.json');
  fs.writeFileSync(fp, JSON.stringify({ summary, byRepo }, null, 2));
  console.log('\n=== BLIND COMBAT AGGREGATE ===');
  console.log('rounds:', summary.rounds.join(','));
  console.log('Web  7s vs u1:  Δ=' + web.delta, 'means', web.champ_mean, web.u1_mean, 'wins', web.wins, '§1.2', web.pass_s1_2, '§1.3', web.pass_s1_3);
  console.log('Edge o4 vs u1:  Δ=' + edge.delta, 'means', edge.champ_mean, edge.u1_mean, 'wins', edge.wins, '§1.2', edge.pass_s1_2, '§1.3', edge.pass_s1_3);
  console.log('PLAN §1.2:', summary.plan_s1_2, '| §1.3:', summary.plan_s1_3);
  console.log(JSON.stringify(web.per, null, 2));
  console.log(JSON.stringify(edge.per, null, 2));
  console.log('→', fp);
  return summary;
}

(async () => {
  const argv = process.argv.slice(2);
  if (argv.includes('--aggregate')) {
    aggregate();
    return;
  }
  let round = 1;
  let sets = ['web', 'edge'];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--round') round = parseInt(argv[++i], 10) || 1;
    if (argv[i] === '--sets') sets = argv[++i].split(',');
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('需要 DEEPSEEK_API_KEY');
    process.exit(2);
  }
  await runRound(round, sets);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
