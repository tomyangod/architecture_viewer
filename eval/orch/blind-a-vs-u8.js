#!/usr/bin/env node
'use strict';

/**
 * blind-a-vs-u8.js — 双引擎 A (orch4) vs 用法8 (orch8) 对比评测
 *
 * Phase 1: 产物已在 /tmp/arch-orch/out/{orch4,orch8}-${repo}-r{1,2,3}/block-diagram.md
 * Phase 2a: 机评（lintBlockDiagram + structureGates + drift）
 * Phase 2b: 盲评（匿名洗牌 → DeepSeek 评委 7 维打分 × 3 轮）
 * Phase 2c: 成本+稳定性汇总
 *
 * 用法: DEEPSEEK_API_KEY=... node eval/orch/blind-a-vs-u8.js <repo> [repoPath] [orch4Prefix] [orch8Prefix] [outDir]
 *   例: DEEPSEEK_API_KEY=... node eval/orch/blind-a-vs-u8.js vaultwarden
 *       DEEPSEEK_API_KEY=... node eval/orch/blind-a-vs-u8.js openim /tmp/arch-orch/repos/openim orch4-openim orch8d-openim /tmp/arch-orch/out/blind-a-vs-u8d
 */

const fs = require('fs');
const path = require('path');
const {
  chat, extractJson, usage, maskKey,
  buildTree, lintBlockDiagram, parseMermaid
} = require('./lib');
const { structureGates, visualGates } = require('./run');
const { importanceForensics, findAnchorsV2 } = require('./lib');
const { scan } = require(path.join(__dirname, '..', '..', 'lib', 'scan'));

const repoArg = process.argv[2] || 'openim';
const REPO = process.argv[3] || `/tmp/arch-orch/repos/${repoArg}`;
const orch4Pfx = process.argv[4] || `orch4-${repoArg}`;
const orch8Pfx = process.argv[5] || `orch8-${repoArg}`;
const OUT = process.argv[6] || `/tmp/arch-orch/out/blind-a-vs-u8-${repoArg}`;

const ROUNDS = [1, 2, 3];
const PIPELINES = [
  { id: 'orch4', label: '双引擎A（orch4+shapeDetect）', dir: (r) => `/tmp/arch-orch/out/${orch4Pfx}-r${r}` },
  { id: 'orch8', label: '用法8（orch8+explore）', dir: (r) => `/tmp/arch-orch/out/${orch8Pfx}-r${r}` }
];

function productTokensOf(name) {
  // self-actor 判定：产品名 + 常见自指别名；空或未知时退化为 repo 名本身
  const base = String(name).toLowerCase();
  const extras = {
    openim: ['open-im', 'open im', 'im server', 'openimsdk'],
    vaultwarden: ['vault warden', 'bitwarden', 'bit warden', 'password manager'],
    ntfy: ['notify', 'notification server', 'push server'],
    caddy: ['caddy server', 'web server', 'reverse proxy'],
    zigbee2mqtt: ['z2m', 'zigbee bridge', 'zigbee to mqtt']
  };
  return [base, ...(extras[base] || [])];
}
const PRODUCT_TOKENS = productTokensOf(repoArg);

const REPO_CAPTION = {
  openim: '开源即时通讯 IM 服务端平台，Go 微服务架构',
  vaultwarden: '开源 Bitwarden 密码管理器服务端，Rust + 单体 Web 服务',
  ntfy: '开源 HTTP 推送/通知服务，Go + 单体 + Web 前端',
  caddy: '开源 HTTP/2/TLS 反向代理与 Web 服务器，Go 单体',
  zigbee2mqtt: 'Zigbee 设备 → MQTT 桥接网关，Node.js/TS 单体加硬件驱动层'
};

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

// ---------- Phase 2a: 机评 ----------
function machineEval(md, tree, importance, repoName) {
  const lint = lintBlockDiagram(md, tree);
  const anchors = findAnchorsV2(tree, importance);
  const structure = structureGates(md, anchors, importance, productTokensOf(repoName));
  const visual = visualGates(md);
  const hallu = lint.metrics?.幻觉路径数 || 0;
  const sHigh = structure.filter((s) => s.severity === 'high').length;
  const sMed = structure.filter((s) => s.severity === 'medium').length;
  const vHigh = visual.filter((v) => v.severity === 'high').length;
  const vMed = visual.filter((v) => v.severity === 'medium').length;
  return {
    hallu, sHigh, sMed, vHigh, vMed,
    nodes: lint.metrics?.节点数 || 0,
    edges: lint.metrics?.边数 || 0,
    subgraphs: lint.metrics?.子图数 || 0,
    layers: lint.metrics?.分层数 || 0,
    lintIssues: lint.issues.length,
    missingPaths: lint.missingPaths || [],
    structIssues: structure.filter((s) => s.severity === 'high').map((s) => `[${s.kind}] ${s.issue}`),
    score: 10 - (hallu * 10 + sHigh * 5 + sMed * 1 + vHigh * 2),
    veto: hallu > 0 || sHigh > 0
  };
}

// ---------- Phase 2b: 盲评 ----------
async function blindEval(candidates, repoName) {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const shuffled = seededShuffle(candidates, 42);
  const anon = shuffled.map((c, i) => ({ letter: letters[i], ...c }));
  const caption = REPO_CAPTION[String(repoName).toLowerCase()] || `${repoName}: 开源软件项目`;

  const sys = `你是资深软件架构评审专家，正在盲评同一系统（${repoName}：${caption}）的 block-diagram 架构图（Mermaid flowchart + subgraph 分层）。
你不知道每份图由什么方法生成。请严格按以下维度逐份打分（1-10 整数），并给一句话理由：
- path_truth: 节点标注的文件路径是否真实、是否贴真实代码结构
- layer_semantics: 分层是否正确（HTTP handler/controller/路由归 api；业务处理/消费/转换归 worker；数据库模型/连接/存储接口归 storage；定时任务/调度归 schedule；部署/CI/容器编排归 ops；前端 UI/页面归 frontend）
- edge_correctness: 边方向=真实运行时数据流；关键链路完整；无多余乱边；数据经接口/controller 访问存储，不直连
- business_naming: 中文业务名是否准确、非模板腔
- density_readability: 节点数 15-35、每层 2-6、边不杂乱
- spec_compliance: Mermaid 语法、classDef 上色、subgraph 结构规范
- deliverable: 综合可交付分（能否直接当架构门户给团队/老板看）
输出严格 JSON：{"scores":[{"id":"A","path_truth":n,"layer_semantics":n,"edge_correctness":n,"business_naming":n,"density_readability":n,"spec_compliance":n,"deliverable":n,"reason":"一句话"}],"ranking":["C","A"],"best":"字母","comments":"总体观察"}`;

  const user = anon.map((a) => `===== 图 ${a.letter} =====\n${a.md}`).join('\n\n');
  const raw = await chat([
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], { json: true, temperature: 0.2, maxTokens: 4096 });

  const scores = extractJson(raw);
  return { scores, anon };
}

// ---------- 主流程 ----------
async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('Need DEEPSEEK_API_KEY');
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const tree = buildTree(REPO);
  const inv = scan(REPO, { write: false });
  const importance = importanceForensics(REPO, tree, inv.entrypoints || []);

  // ---- Phase 2a: 机评 ----
  console.log('\n===== Phase 2a: 机评 =====');
  const machineResults = {};
  for (const p of PIPELINES) {
    machineResults[p.id] = [];
    for (const r of ROUNDS) {
      const dir = p.dir(r);
      const mdPath = path.join(dir, 'block-diagram.md');
      if (!fs.existsSync(mdPath)) {
        console.log(`  [SKIP] ${p.id} r${r}: 产物不存在`);
        machineResults[p.id].push(null);
        continue;
      }
      const md = fs.readFileSync(mdPath, 'utf8');
      const m = machineEval(md, tree, importance, repoArg);
      machineResults[p.id].push(m);
      console.log(`  ${p.id} r${r}: hallu=${m.hallu} sHigh=${m.sHigh} sMed=${m.sMed} vHigh=${m.vHigh} | nodes=${m.nodes} edges=${m.edges} | score=${m.score}${m.veto ? ' [VETO]' : ''}`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'machine-eval.json'), JSON.stringify(machineResults, null, 2));

  // ---- Phase 2b: 盲评 × 3 轮 ----
  console.log('\n===== Phase 2b: 盲评 =====');
  const blindResults = [];
  for (let round = 1; round <= 3; round++) {
    console.log(`\n--- 盲评第 ${round} 轮 ---`);
    const candidates = [];
    for (const p of PIPELINES) {
      const dir = p.dir(round);
      const mdPath = path.join(dir, 'block-diagram.md');
      if (fs.existsSync(mdPath)) {
        candidates.push({ id: p.id, label: p.label, md: fs.readFileSync(mdPath, 'utf8') });
      }
    }
    if (candidates.length < 2) {
      console.log('  参评不足 2 份，跳过');
      continue;
    }
    console.log(`  参评 ${candidates.length} 份，调用 LLM 评委…`);
    const { scores, anon } = await blindEval(candidates, repoArg);
    const key = Object.fromEntries(anon.map((a) => [a.letter, a]));
    blindResults.push({ round, scores, anon: anon.map(({ letter, id, label }) => ({ letter, id, label })) });
    for (const s of (scores.scores || [])) {
      const c = key[s.id] || {};
      console.log(`  ${s.id}=${c.id}: path=${s.path_truth} layer=${s.layer_semantics} edge=${s.edge_correctness} name=${s.business_naming} density=${s.density_readability} spec=${s.spec_compliance} | deliverable=${s.deliverable}`);
    }
    console.log('  评委排名:', (scores.ranking || []).map((l) => `${l}=${key[l]?.id}`).join(' > '));
    console.log('  API 调用', usage.calls, '| tokens', usage.promptTokens + usage.completionTokens);
  }
  fs.writeFileSync(path.join(OUT, 'blind-eval.json'), JSON.stringify(blindResults, null, 2));

  // ---- Phase 2c: 汇总 ----
  console.log('\n===== Phase 2c: 汇总 =====');
  const summary = { machine: {}, blind: {}, cost: {}, stability: {} };

  for (const p of PIPELINES) {
    const ms = machineResults[p.id].filter(Boolean);
    const deliverables = [];
    for (const br of blindResults) {
      for (const s of (br.scores?.scores || [])) {
        const anon = br.anon?.find((a) => a.letter === s.id);
        if (anon?.id === p.id) deliverables.push(s.deliverable);
      }
    }
    const dMean = deliverables.length ? deliverables.reduce((a, b) => a + b, 0) / deliverables.length : 0;
    const dVar = deliverables.length > 1
      ? deliverables.reduce((a, d) => a + (d - dMean) ** 2, 0) / deliverables.length
      : 0;

    summary.machine[p.id] = {
      hallu: ms.map((m) => m.hallu),
      sHigh: ms.map((m) => m.sHigh),
      veto: ms.some((m) => m.veto),
      avgScore: ms.length ? ms.reduce((a, m) => a + m.score, 0) / ms.length : 0,
      avgNodes: ms.length ? ms.reduce((a, m) => a + m.nodes, 0) / ms.length : 0,
      avgEdges: ms.length ? ms.reduce((a, m) => a + m.edges, 0) / ms.length : 0
    };
    summary.blind[p.id] = {
      deliverables,
      mean: +dMean.toFixed(2),
      variance: +dVar.toFixed(2)
    };
    summary.stability[p.id] = {
      deliverableStd: +Math.sqrt(dVar).toFixed(2),
      halluVariance: ms.length > 1 ? ms.reduce((a, m, i, arr) => a + (m.hallu - arr.reduce((s, x) => s + x.hallu, 0) / arr.length) ** 2, 0) / ms.length : 0
    };
  }
  summary.cost = { totalCalls: usage.calls, totalTokens: usage.promptTokens + usage.completionTokens };

  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));

  // ---- 打印汇总表 ----
  console.log('\n========== 最终对比 ==========');
  console.log('维度\t\t\torch4(A)\t\torch8(U8)');
  for (const dim of ['hallu', 'sHigh', 'avgScore', 'avgNodes', 'avgEdges']) {
    const a = summary.machine.orch4?.[dim];
    const b = summary.machine.orch8?.[dim];
    const av = Array.isArray(a) ? a.join('/') : (a != null ? a.toFixed(2) : '-');
    const bv = Array.isArray(b) ? b.join('/') : (b != null ? b.toFixed(2) : '-');
    console.log(`${dim.padEnd(16)}\t${av}\t\t\t${bv}`);
  }
  console.log(`blind deliverable\t${summary.blind.orch4?.mean || '-'}\t\t\t${summary.blind.orch8?.mean || '-'}`);
  console.log(`blind variance  \t${summary.blind.orch4?.variance || '-'}\t\t\t${summary.blind.orch8?.variance || '-'}`);
  console.log(`veto            \t${summary.machine.orch4?.veto}\t\t\t${summary.machine.orch8?.veto}`);
  console.log(`\n评委 LLM 调用 ${usage.calls} 次 | tokens ${usage.promptTokens + usage.completionTokens}`);
  console.log(`产物: ${OUT}`);
}

main().catch((e) => { console.error('致命错误:', e); process.exit(1); });
