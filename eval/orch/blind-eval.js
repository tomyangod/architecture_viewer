/**
 * 盲评：7 份 block-diagram.md 匿名洗牌，LLM 评委按 rubric 打分 + 确定性指标机评。
 * 用法: DEEPSEEK_API_KEY=... node eval/orch/blind-eval.js <repo-root> <out-dir>
 */
const fs = require('fs');
const path = require('path');
const { chat, extractJson, usage, maskKey, buildTree, lintBlockDiagram, layerGate } = require('./lib');

const repo = path.resolve(process.argv[2] || '/tmp/arch-orch/changedetection.io');
const outdir = path.resolve(process.argv[3] || '/tmp/arch-orch/out/blind');
fs.mkdirSync(outdir, { recursive: true });

const log = (...a) => console.log('[blind]', ...a);

// 固定种子洗牌，保证可复现
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

const CANDIDATES = [
  { id: 'method1', label: '方法1 Cursor Agent（人工基准 ≈9）', file: '/tmp/arch-compare/method1-cursor-agent/block-diagram.md' },
  { id: 'method5', label: '方法5 DeepSeek全树手写引擎（≈7.5）', file: '/tmp/arch-compare/method5-deepseek-handwriter/block-diagram.md' },
  { id: 'digest', label: 'A: digest 扫描摘要', file: '/tmp/arch-orch/out/digest/block-diagram.md' },
  { id: 'rich1', label: 'B: rich1 全树+摘录单轮', file: '/tmp/arch-orch/out/rich1/block-diagram.md' },
  { id: 'nocritic', label: 'D: nocritic 流水线无批判', file: '/tmp/arch-orch/out/nocritic/block-diagram.md' },
  { id: 'orch', label: 'C: orch 裸眼批判', file: '/tmp/arch-orch/out/orch/block-diagram.md' },
  { id: 'orch2', label: 'E: orch2 接地批判+层闸门', file: '/tmp/arch-orch/out/orch2/block-diagram.md' }
];

(async () => {
  log('API key:', maskKey());
  const tree = buildTree(repo);

  // ---- 1. 确定性机评指标 ----
  const present = CANDIDATES.filter((c) => fs.existsSync(c.file));
  log('参评', present.length, '份');
  const metrics = {};
  for (const c of present) {
    const md = fs.readFileSync(c.file, 'utf8');
    const lint = lintBlockDiagram(md, tree);
    metrics[c.id] = {
      ...c,
      mdLen: md.length,
      lintIssues: lint.issues.length,
      hallucinatedPaths: lint.missingPaths,
      layerIssues: layerGate(md),
      m: lint.metrics
    };
  }
  fs.writeFileSync(path.join(outdir, 'metrics.json'), JSON.stringify(metrics, null, 2));
  log('机评完成');

  // ---- 2. 匿名洗牌 ----
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const shuffled = seededShuffle(present, 42);
  const anon = shuffled.map((c, i) => ({ letter: letters[i], ...c }));
  fs.writeFileSync(path.join(outdir, 'anon-key.json'), JSON.stringify(anon.map(({ letter, id, label }) => ({ letter, id, label })), null, 2));

  // ---- 3. LLM 评委 ----
  const sys = `你是资深软件架构评审专家，正在盲评 7 份同一系统（changedetection.io 网页变更监控平台）的 block-diagram 架构图（Mermaid flowchart + subgraph 分层）。
你不知道每份图由什么方法生成。请严格按以下维度逐份打分（1-10 整数），并给一句话理由：
- path_truth: 节点标注的文件路径是否真实、是否贴真实代码结构
- layer_semantics: 分层是否正确（采集/处理链属 worker；通知/实时推送属 monitor；store/model 属 storage；Flask/blueprint/api 属 api 层；templates/static 属 frontend；queue/scheduler 属调度）
- edge_correctness: 边方向=真实运行时数据流；关键链路完整（入口→队列→worker→抓取→处理/差异→存储→通知；实时推送至浏览器）；无多余乱边
- business_naming: 中文业务名是否准确、非模板腔
- density_readability: 节点数 15-25、每层 2-5、边不杂乱
- spec_compliance: Mermaid 语法、classDef 上色、subgraph 结构规范
- deliverable: 综合可交付分（能否直接当架构门户给团队/老板看）
输出严格 JSON：{"scores":[{"id":"A","path_truth":n,"layer_semantics":n,"edge_correctness":n,"business_naming":n,"density_readability":n,"spec_compliance":n,"deliverable":n,"reason":"一句话"}],"ranking":["C","A",...],"best":"字母","comments":"总体观察：不同方法的质量差异点"}
ranking 按 deliverable 从高到低。`;
  const user = anon.map((a) => `===== 图 ${a.letter} =====\n${fs.readFileSync(a.file, 'utf8')}`).join('\n\n');
  const raw = await chat([
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ], { json: true, temperature: 0.2 });
  const scores = extractJson(raw);
  fs.writeFileSync(path.join(outdir, 'llm-judge.json'), JSON.stringify(scores, null, 2));
  log('LLM 评委完成。API 调用', usage.calls, '次');

  // ---- 4. 汇总打印 ----
  const key = Object.fromEntries(anon.map((a) => [a.letter, a]));
  console.log('\n========== 盲评结果（揭盲） ==========');
  const rows = (scores.scores || []).map((s) => {
    const cand = key[s.id] || {};
    const mm = metrics[cand.id] || {};
    return { letter: s.id, id: cand.id, label: cand.label, ...s, _m: mm };
  });
  rows.sort((a, b) => (b.deliverable || 0) - (a.deliverable || 0));
  for (const r of rows) {
    console.log(`\n[${r.letter}] ${r.id} — ${r.label}`);
    console.log(`  评委分: 路径${r.path_truth} 分层${r.layer_semantics} 边${r.edge_correctness} 命名${r.business_naming} 密度${r.density_readability} 规范${r.spec_compliance} | 综合 ${r.deliverable}`);
    console.log(`  机评:   幻觉路径=${(r._m.hallucinatedPaths || []).length} 层错误=${(r._m.layerIssues || []).length} 节点=${r._m.m?.节点数} 边=${r._m.m?.边数} lint=${r._m.lintIssues}`);
    console.log(`  理由: ${r.reason}`);
  }
  console.log('\n评委排名:', (scores.ranking || []).map((l) => `${l}=${key[l]?.id}`).join(' > '));
  console.log('评委最佳:', scores.best, '=', key[scores.best]?.id);
  console.log('评委总评:', scores.comments);
})().catch((e) => { console.error('致命错误:', e); process.exit(1); });
