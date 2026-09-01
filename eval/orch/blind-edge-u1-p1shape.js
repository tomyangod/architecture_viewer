/**
 * edge 四仓盲评：usage1（Cursor Agent 人工基准）vs edge-p1shape orch4（编排流水线+形态叙事）
 * 用法: DEEPSEEK_API_KEY=... node eval/orch/blind-edge-u1-p1shape.js [--round N]
 * 产物约定：
 *   usage1:    /tmp/arch-orch/out/edge-p1shape/usage1-<repo>/block-diagram.md
 *   orch4:     /tmp/arch-orch/out/edge-p1shape/orch4/<repo>/block-diagram.md
 * 输出：/tmp/arch-orch/out/blind-edge-u1-p1shape/round-<N>.json 及单仓 judge-*.json
 */
const fs = require('fs');
const path = require('path');
const { chat, extractJson, usage, maskKey } = require('./lib');

const OUT = '/tmp/arch-orch/out';
const BLIND = path.join(OUT, 'blind-edge-u1-p1shape');
const ROOT = path.join(OUT, 'edge-p1shape');

const REPOS = [
  { name: 'caddy', short: 'caddy',
    profile: 'Caddy 是开源反向代理/Web 服务器（Go）：模块化 HTTP 处理链、配置路由/编码/压缩/TLS 自动签发、上游反向代理流；管理员 HTTP API 在线改配。' },
  { name: 'ntfy', short: 'ntfy',
    profile: 'ntfy 是开源 HTTP 发布/订阅通知总线（Go）：Web 端/CLI 向 topic 发布消息，手机/浏览器经 WebSocket/FCM/WebPush 实时接收；自带邮件/Android 推送通道。' },
  { name: 'vaultwarden', short: 'vaultwarden',
    profile: 'Vaultwarden 是 Bitwarden 密码管理器的 Rust 重写后端：REST API 处理密码库同步、SMTP 邮件邀请/告警、WebSocket 实时推送变更、PostgreSQL/MySQL/SQLite 存储；前端为第三方 Vault Web 静态资源。' },
  { name: 'zigbee2mqtt', short: 'zigbee2mqtt',
    profile: 'zigbee2mqtt 是协议桥接中间件（TypeScript/Node.js）：把 Zigbee 协调器串口协议翻译成 MQTT 主题消息、经由控制器协调扩展/设备模型/状态、向家庭自动化系统发布事件；支持双向控制（命令下发/设备上报）。' }
];

const argv = process.argv.slice(2);
let round = 1;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--round') round = parseInt(argv[++i], 10) || 1;
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

(async () => {
  console.log('[blind] round=' + round + ' API key:', maskKey());
  fs.mkdirSync(BLIND, { recursive: true });
  const results = [];

  for (let ri = 0; ri < REPOS.length; ri++) {
    const { name, short, profile } = REPOS[ri];
    const f1 = path.join(ROOT, 'usage1-' + short, 'block-diagram.md');
    const f4 = path.join(ROOT, 'orch4', name, 'block-diagram.md');
    if (!fs.existsSync(f1) || !fs.existsSync(f4)) {
      console.log('[blind] ' + name + ': 产物缺失 u1=' + fs.existsSync(f1) + ' o4=' + fs.existsSync(f4));
      continue;
    }
    const cands = [
      { variant: 'usage1', md: fs.readFileSync(f1, 'utf8') },
      { variant: 'orch4', md: fs.readFileSync(f4, 'utf8') }
    ];
    // 每仓每轮不同种子
    const anon = seededShuffle(cands.map((c, i) => ({ letter: ['A', 'B'][i], ...c })),
      3000 + round * 131 + ri * 7);
    const key = Object.fromEntries(anon.map((a) => [a.letter, a.variant]));

    const sys = `你是资深软件架构评审专家，正在盲评同一系统的两份 block-diagram 架构图（Mermaid flowchart + subgraph 分层），你不知道它们分别由什么方法生成。
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
输出严格 JSON：{"scores":[{"id":"A","path_truth":n,"layer_semantics":n,"edge_correctness":n,"business_naming":n,"density_readability":n,"spec_compliance":n,"deliverable":n,"reason":"一句话总评","gaps":"关键缺口","flaws":"硬伤"}],"better":"A或B或tie","comments":"两份差异点一句话"}`;
    const user = anon.map((a) => '===== 图 ' + a.letter + ' =====\n' + a.md).join('\n\n');

    let scores;
    try {
      const raw = await chat([
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ], { json: true, temperature: 0.2, maxTokens: 4096 });
      scores = extractJson(raw);
    } catch (e) {
      console.log('[blind] ' + name + ': 评委失败 ' + e.message);
      continue;
    }
    fs.writeFileSync(path.join(BLIND, 'judge-' + short + '-r' + round + '.json'),
      JSON.stringify({ key, scores }, null, 2));

    const row = { repo: name, round, key, scores: scores.scores || [],
      better: scores.better, comments: scores.comments };
    results.push(row);
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
  }

  const agg = {};
  for (const v of ['usage1', 'orch4'])
    agg[v] = { dims: Object.fromEntries(DIMS.map((d) => [d, []])),
      deliverable: [], wins: 0, losses: 0, ties: 0 };
  for (const row of results) {
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
  console.log('\n========== edge 四仓盲评 round=' + round + ' ==========');
  console.log('维度均值: ' + DIMS.join(' | '));
  for (const v of ['usage1', 'orch4']) {
    const line = DIMS.map((d) => mean(agg[v].dims[d]).toFixed(2)).join(' | ');
    console.log(v.padEnd(8) + ': ' + line + ' | 胜' + agg[v].wins + ' 负' + agg[v].losses + ' 平' + agg[v].ties);
  }
  const delO4 = mean(agg.orch4.dims.deliverable);
  const delU1 = mean(agg.usage1.dims.deliverable);
  const gap = delO4 - delU1;
  console.log('\ndeliverable orch4=' + delO4.toFixed(2) + ' usage1=' + delU1.toFixed(2) +
    ' Δ(orch4-usage1)=' + (gap >= 0 ? '+' : '') + gap.toFixed(2));

  const outPath = path.join(BLIND, 'round-' + round + '.json');
  fs.writeFileSync(outPath, JSON.stringify({
    round, results,
    agg: Object.fromEntries(Object.entries(agg).map(([k, v]) =>
      [k, { ...v, meanDims: Object.fromEntries(DIMS.map((d) => [d, mean(v.dims[d])])) }]))
  }, null, 2));
  console.log('API calls=' + usage.calls + ' out=' + outPath);
})().catch((e) => { console.error('Fatal:', e); process.exit(1); });
