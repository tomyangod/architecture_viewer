'use strict';

/**
 * L1 路由消融盲评：edge 四仓 · usage7s vs orch4+shape（同场）
 * 用法: DEEPSEEK_API_KEY=... node eval/orch/blind-edge-7s-vs-orch4.js [--round N]
 *       node eval/orch/blind-edge-7s-vs-orch4.js --aggregate
 *
 * 产物约定：
 *   usage7s: OUT/usage7s-<short>/block-diagram.md
 *   orch4:   OUT/edge-p1shape/orch4/<name>/block-diagram.md  (优先)
 *            或 OUT/orch4/<name>/block-diagram.md
 * 输出：OUT/blind-edge-7s-vs-orch4/round-<N>.json + summary.json
 */

const fs = require('fs');
const path = require('path');
const { chat, extractJson, usage, maskKey } = require('./lib');

const OUT = process.env.OUT || '/tmp/arch-orch/out';
const BLIND = path.join(OUT, 'blind-edge-7s-vs-orch4');

const REPOS = [
  {
    name: 'caddy',
    short: 'caddy',
    brief:
      'Caddy 是开源反向代理/Web 服务器（Go）：模块化 HTTP 链、TLS 自动签发、上游反代、管理 API。'
  },
  {
    name: 'ntfy',
    short: 'ntfy',
    brief:
      'ntfy 是开源 HTTP 发布/订阅通知总线（Go）：向 topic 发布，经 WebSocket/FCM/WebPush 接收。'
  },
  {
    name: 'vaultwarden',
    short: 'vaultwarden',
    brief:
      'Vaultwarden 是 Bitwarden 兼容后端（Rust）：密码库同步 API、SMTP、WebSocket、SQL 存储。'
  },
  {
    name: 'zigbee2mqtt',
    short: 'zigbee2mqtt',
    brief:
      'zigbee2mqtt 是协议桥（TypeScript）：Zigbee 协调器 ↔ MQTT，双向控制与状态发布。'
  }
];

const DIMS = [
  'story',
  'layer',
  'edge',
  'paths',
  'naming',
  'density',
  'spec',
  'deliverable'
];

function mdUsage7s(spec) {
  return path.join(OUT, 'usage7s-' + spec.short, 'block-diagram.md');
}
function mdOrch4(spec) {
  // Prefer this campaign's same-SHA products, then historical edge-p1shape, then orch4/
  const candidates = [
    path.join(OUT, 'edge-l1', 'orch4', spec.name, 'block-diagram.md'),
    path.join(OUT, 'edge-p1shape', 'orch4', spec.name, 'block-diagram.md'),
    path.join(OUT, 'orch4', spec.name, 'block-diagram.md')
  ];
  for (const f of candidates) if (fs.existsSync(f)) return f;
  return candidates[0];
}

function seededOrder(seed) {
  let s = seed;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  return rnd() < 0.5 ? ['usage7s', 'orch4'] : ['orch4', 'usage7s'];
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

async function runRound(round) {
  fs.mkdirSync(BLIND, { recursive: true });
  console.log('[L1 blind] round', round, 'key', maskKey(), 'n=', REPOS.length);
  const results = [];

  for (let i = 0; i < REPOS.length; i++) {
    const spec = REPOS[i];
    const f7 = mdUsage7s(spec);
    const f4 = mdOrch4(spec);
    if (!fs.existsSync(f7) || !fs.existsSync(f4)) {
      console.log(
        '[skip]',
        spec.short,
        'missing',
        !fs.existsSync(f7) ? '7s' : '',
        !fs.existsSync(f4) ? 'orch4' : ''
      );
      continue;
    }
    const order = seededOrder(2000 + round * 131 + i * 17);
    const files = { usage7s: f7, orch4: f4 };
    const letterOf = { [order[0]]: 'A', [order[1]]: 'B' };
    const user = `产品简介：${spec.brief}\n\n===== 图 A =====\n${fs.readFileSync(
      files[order[0]],
      'utf8'
    )}\n\n===== 图 B =====\n${fs.readFileSync(files[order[1]], 'utf8')}`;

    let scored = null;
    for (let attempt = 1; attempt <= 3 && !scored; attempt++) {
      try {
        const raw = await chat(
          [
            { role: 'system', content: SYS },
            { role: 'user', content: user }
          ],
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
      order,
      reveal,
      winnerLetter: scored.winner,
      winnerMethod,
      decisive: scored.decisive,
      scores: {
        usage7s: scored[letterOf.usage7s],
        orch4: scored[letterOf.orch4]
      },
      mtimes: {
        usage7s: fs.statSync(f7).mtime.toISOString(),
        orch4: fs.statSync(f4).mtime.toISOString()
      }
    };
    results.push(row);
    const d7 = row.scores.usage7s && row.scores.usage7s.deliverable;
    const d4 = row.scores.orch4 && row.scores.orch4.deliverable;
    console.log(
      `[ok] ${spec.short} winner=${winnerMethod} 7s=${d7} orch4=${d4} Δ(o4-7s)=${(d4 - d7).toFixed?.(1) ?? d4 - d7}`
    );
  }

  const out = {
    campaign: 'L1-edge-7s-vs-orch4',
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
  const rounds = [1, 2, 3]
    .map((r) => {
      const p = path.join(BLIND, 'round-' + r + '.json');
      return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
    })
    .filter(Boolean);

  if (!rounds.length) {
    console.error('no rounds');
    process.exit(1);
  }

  const byRepo = {};
  for (const rnd of rounds) {
    for (const row of rnd.results) {
      if (!byRepo[row.short]) {
        byRepo[row.short] = {
          usage7s: Object.fromEntries(DIMS.map((d) => [d, []])),
          orch4: Object.fromEntries(DIMS.map((d) => [d, []])),
          wins: { usage7s: 0, orch4: 0, tie: 0 }
        };
      }
      const b = byRepo[row.short];
      for (const d of DIMS) {
        b.usage7s[d].push(+(row.scores.usage7s && row.scores.usage7s[d]) || 0);
        b.orch4[d].push(+(row.scores.orch4 && row.scores.orch4[d]) || 0);
      }
      if (row.winnerMethod === 'usage7s') b.wins.usage7s++;
      else if (row.winnerMethod === 'orch4') b.wins.orch4++;
      else b.wins.tie++;
    }
  }

  const per = {};
  const uDl = [];
  const oDl = [];
  const wins = { usage7s: 0, orch4: 0, tie: 0 };
  for (const [short, b] of Object.entries(byRepo)) {
    const ud = mean(b.usage7s.deliverable);
    const od = mean(b.orch4.deliverable);
    uDl.push(ud);
    oDl.push(od);
    wins.usage7s += b.wins.usage7s;
    wins.orch4 += b.wins.orch4;
    wins.tie += b.wins.tie;
    per[short] = {
      u7s: +ud.toFixed(2),
      orch4: +od.toFixed(2),
      delta_o4_minus_7s: +(od - ud).toFixed(2),
      wins: { ...b.wins }
    };
  }

  // L1 判定：edge 上冠军应为 orch4；若 7s 均分 > orch4 + 0.3 → 分流存疑
  const oMean = mean(oDl);
  const uMean = mean(uDl);
  const delta = oMean - uMean;
  let verdict;
  if (delta >= 0.3) verdict = 'ROUTING_JUSTIFIED_ORCH4_WINS';
  else if (delta <= -0.3) verdict = 'ROUTING_QUESTIONED_7S_WINS';
  else verdict = 'ROUTING_NEUTRAL_NOISE_BAND';

  const summary = {
    generated_at: new Date().toISOString(),
    campaign: 'L1-edge-7s-vs-orch4',
    rounds: rounds.map((r) => r.round),
    orch4_mean: +oMean.toFixed(2),
    usage7s_mean: +uMean.toFixed(2),
    delta_o4_minus_7s: +delta.toFixed(2),
    wins,
    per,
    verdict,
    rule:
      'Δ(orch4−7s)≥+0.3 → 维持 edge→orch4；≤−0.3 → 重审分流；|Δ|<0.3 → 噪声带，看成本'
  };

  const fp = path.join(BLIND, 'summary.json');
  fs.writeFileSync(fp, JSON.stringify({ summary, byRepo }, null, 2));
  console.log('\n=== L1 EDGE 7s vs orch4+shape ===');
  console.log('rounds:', summary.rounds.join(','));
  console.log(
    'orch4=',
    summary.orch4_mean,
    '7s=',
    summary.usage7s_mean,
    'Δ=',
    summary.delta_o4_minus_7s,
    'wins',
    wins
  );
  console.log('per:', JSON.stringify(per, null, 2));
  console.log('VERDICT:', summary.verdict);
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
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--round') round = parseInt(argv[++i], 10) || 1;
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('需要 DEEPSEEK_API_KEY');
    process.exit(2);
  }
  await runRound(round);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
