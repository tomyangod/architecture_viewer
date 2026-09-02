#!/usr/bin/env node
'use strict';

/**
 * explore-json.js — 用法8 P1：Agent 探索契约（explore JSON）
 *
 * 让 dsh headless（首选）或 DeepSeek chat（兜底）开放式读仓，产出结构化 explore JSON：
 *   { shape, confidence, trunkStory, mustPaths, forbidAsFrontend,
 *     emptyLayers, externalSystems, evidence }
 *
 * 产出经 schema 校验 + 路径真实性闸门 + 与确定性 shapeDetect 交叉验证后，
 * 写入 <outDir>/explore.json，供 orch8 variant 作为 state.explore 使用
 * （plan 阶段从 state.explore 取形态/故事/空层，而非 shapeDetect）。
 *
 * 硬原则（PLAN-USAGE8 §2）：探索可以猜，落盘必须过闸。
 * 校验失败 → 反馈修订（dsh 最多 3 轮 / llm 最多 2 轮）→ 仍失败 →
 * 降级为 importanceForensics 确定性结果（shapeSource='fallback'）。
 *
 * 用法:
 *   DEEPSEEK_API_KEY=... node eval/orch/explore-json.js <repoRoot> [outDir] [--engine dsh|llm|auto]
 *
 * 环境:
 *   DEEPSEEK_API_KEY   必填
 *   DSH_BIN            dsh 二进制路径（默认探测 ~/.npm/_npx 缓存）
 *   DSH_HOME           dsh 工作区 HOME（沙箱内写 ~/.dsh 被拦时指向 /tmp/dsh-home）
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  chat, extractJson, usage, maskKey,
  buildTree, importanceForensics
} = require('./lib');
// 确定性扫描用于兜底取证（与 usage7-sweep.js 同口径）
const { scan } = require(path.join(__dirname, '..', '..', 'lib', 'scan'));

// ---------------------------------------------------------------------------
// 契约 schema（与 PLAN-USAGE8.md §P1 的 JSON 结构一一对应，可加字段不可删字段）
// ---------------------------------------------------------------------------

const SHAPE_ENUM = ['web', 'bridge', 'proxy', 'notify-bus', 'api-svc', 'unknown'];
const LAYER_ENUM = ['frontend', 'api', 'schedule', 'worker', 'storage', 'monitor', 'ops'];
const CONF_ENUM = ['high', 'medium', 'low'];

const EXPLORE_TASK = `You are auditing a source code repository to produce a structured architecture-exploration contract (JSON only).

STEP 1 — Explore freely: use ls, find, grep, cat to understand the repository.
Look at: README first screen, top-level layout, entrypoints (cmd/*/main.go, src/main.rs, index.js/package.json main/bin, main.py), docker-compose*.yml services, and protocol/integration signals (mqtt/zigbee/modbus/ble, reverse proxy config, pubsub/notification servers).

STEP 2 — Decide the PRODUCT SHAPE (exactly one):
- "bridge"      : translates between two protocols/sides (e.g. device network <-> message broker)
- "proxy"       : reverse proxy / gateway / load balancer / TLS terminator
- "notify-bus"  : notification / pub-sub bus (topics, push fan-out, SMTP/FCM/APNs)
- "api-svc"     : backend service/API with NO real frontend project (no .vue/.jsx/.tsx SPA; server-rendered templates do NOT count as frontend)
- "web"         : full web application with real frontend project
- "unknown"     : cannot tell confidently

STEP 3 — WRITE the file architecture_viewer/explore.json with EXACTLY this JSON shape:
{
  "shape": "<one of the enum above>",
  "confidence": "high|medium|low",
  "trunkStory": ["actor/role", "entry file(s)", "core processing", "external systems", "storage"],
  "mustPaths": ["repo-relative paths of the 5-15 most important files/dirs; EVERY path must exist (verify with test -e)"],
  "forbidAsFrontend": ["repo-relative dirs that exist but must NOT be treated as frontend layer (e.g. test/assets, templates, examples)"],
  "emptyLayers": ["subset of: frontend,api,schedule,worker,storage,monitor,ops — layers that do NOT exist in this repo; empty array if unsure"],
  "externalSystems": [{"id": "ext_broker", "name": "MQTT Broker", "optional": false}],
  "evidence": {"entrypoints": ["..."], "shapeSignals": ["grep/dir evidence that decided the shape"]}
}

Rules:
- Every mustPaths / forbidAsFrontend entry MUST be a real repo-relative path that exists. Verify each with: test -e <path> && echo OK
- externalSystems ids must match /^ext_[a-z0-9_]+$/ . Include only REAL external peers (brokers, device networks, upstream servers, push services, independently-deployed DBs). Embedded libraries (SQLite/Bolt in-process files) are NOT external systems.
- trunkStory: 3-7 short Chinese phrases describing the main runtime data flow.
- Do NOT draw invent: when uncertain, use "unknown" / lower confidence rather than guessing paths.
- Create the architecture_viewer/ directory if missing.

When the file is written and valid, print exactly: EXPLORE_DONE`;

const REVIEW_TASK = (errors) => `The file architecture_viewer/explore.json FAILED validation. Fix ONLY that file (re-verify paths with test -e):

${errors.map((e) => '  - ' + e).join('\n')}

Re-write architecture_viewer/explore.json with the same schema, then print exactly: EXPLORE_DONE`;

// ---------------------------------------------------------------------------
// dsh 调用（与 usage7-gated.js 同口径；HOME 可重定向以绕沙箱）
// ---------------------------------------------------------------------------

const DSH_CANDIDATES = [
  process.env.DSH_BIN,
  '/Users/yanheyang/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh'
].filter(Boolean);

function findDsh() {
  for (const p of DSH_CANDIDATES) {
    if (p && fs.existsSync(p)) return p;
  }
  return 'npx';
}

function runDsh(cwd, task, logPath) {
  const bin = findDsh();
  const args = bin === 'npx'
    ? ['--yes', '@deepseek-ai/dsh', '--profile', 'headless', task]
    : ['--profile', 'headless', task];
  const env = { ...process.env };
  // 沙箱内 dsh 需写 ~/.dsh/sessions；DSH_HOME 指向可写目录时重定向 HOME
  if (process.env.DSH_HOME) env.HOME = process.env.DSH_HOME;
  const r = spawnSync(bin, args, {
    cwd, env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024
  });
  const text = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(logPath, text);
  return { code: r.status, text };
}

// ---------------------------------------------------------------------------
// LLM 兜底引擎（无 dsh 二进制时）：喂确定性摘要 + json 模式直出
// ---------------------------------------------------------------------------

function buildExplorePrompt(repoRoot, tree, importance) {
  // 喂给模型的确定性线索（不喂全树，只喂指纹 + 取证结论供其开放式判断）
  const topDirs = [...tree.all]
    .filter((p) => p.split('/').length === 1 && !p.includes('.'))
    .slice(0, 40);
  const digest = {
    repo: path.basename(repoRoot),
    topLevelDirs: topDirs,
    keyFiles: [...tree.files].filter((f) =>
      /(^|\/)(README|docker-compose|Dockerfile|package\.json|go\.mod|Cargo\.toml|main\.(go|py|rs|js|ts))/i.test(f)
    ).slice(0, 30),
    deterministicShape: importance.shape,
    deterministicEmptyLayers: importance.emptyLayers,
    detectedOptional: importance.optionalKw,
    coreServiceTokens: importance.coreTokens
  };
  return [
    {
      role: 'system',
      content: '你是代码仓库架构探索员。根据仓库指纹输出结构化探索契约 JSON。' +
        'shape 只能取：web/bridge/proxy/notify-bus/api-svc/unknown。' +
        'mustPaths/forbidAsFrontend 必须是真实存在的仓库相对路径（只能用给定指纹中出现过的目录/文件，禁止臆造）。' +
        'externalSystems 的 id 形如 ext_broker/ext_device/ext_upstream/ext_push/ext_db；嵌入式库（SQLite/Bolt 进程内文件）不算外部系统。'
    },
    { role: 'user', content: '仓库指纹：\n' + JSON.stringify(digest, null, 2) + '\n\n输出 explore JSON。' }
  ];
}

async function runLlmExplore(repoRoot, tree, importance) {
  const raw = await chat(buildExplorePrompt(repoRoot, tree, importance), { json: true, temperature: 0.1, maxTokens: 4096 });
  return extractJson(raw);
}

// ---------------------------------------------------------------------------
// 路径真实性（与 lintBlockDiagram 同口径：tree.all / tree.files + 目录前缀）
// ---------------------------------------------------------------------------

function pathExistsInTree(tree, p) {
  const norm = String(p || '').replace(/^\.\//, '').replace(/\/$/, '');
  if (!norm) return false;
  if (tree.all.has(norm) || tree.files.has(norm)) return true;
  // 目录锚点：锚点目录自身或其下任一文件存在即算
  const prefix = norm + '/';
  for (const e of tree.all) if (e.startsWith(prefix)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// schema + 路径真实性校验 → { errors: [], warnings: [] }
// errors 非空时打回修订；warnings 记录但放行
// ---------------------------------------------------------------------------

function validateExplore(ex, tree) {
  const errors = [];
  const warnings = [];
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) {
    return { errors: ['explore 必须是 JSON 对象'], warnings };
  }

  // shape
  if (!SHAPE_ENUM.includes(ex.shape)) {
    errors.push(`shape 非法：${JSON.stringify(ex.shape)}，必须是 ${SHAPE_ENUM.join('/')} 之一`);
  }
  if (!CONF_ENUM.includes(ex.confidence)) {
    warnings.push(`confidence 缺失/非法（${ex.confidence}），按 medium 处理`);
  }

  // trunkStory：3-7 条非空字符串
  if (!Array.isArray(ex.trunkStory) || ex.trunkStory.length < 3 || ex.trunkStory.length > 8) {
    errors.push('trunkStory 必须是 3-8 条字符串数组（角色→入口→核心处理→外部系统→存储）');
  } else if (ex.trunkStory.some((s) => typeof s !== 'string' || !s.trim())) {
    errors.push('trunkStory 每条都必须是非空字符串');
  }

  // mustPaths：3-20 条且全部真实存在
  if (!Array.isArray(ex.mustPaths) || ex.mustPaths.length < 3) {
    errors.push('mustPaths 必须是 ≥3 条仓库相对路径的数组');
  } else if (ex.mustPaths.length > 20) {
    warnings.push(`mustPaths ${ex.mustPaths.length} 条偏多，建议 5-15 条主干`);
  }
  for (const p of ex.mustPaths || []) {
    if (typeof p !== 'string' || !p.trim()) { errors.push('mustPaths 含空项'); continue; }
    if (!pathExistsInTree(tree, p)) errors.push(`mustPaths 路径不存在：${p}`);
  }

  // forbidAsFrontend：可空数组；给出的必须存在
  if (ex.forbidAsFrontend != null && !Array.isArray(ex.forbidAsFrontend)) {
    errors.push('forbidAsFrontend 必须是数组');
  }
  for (const p of ex.forbidAsFrontend || []) {
    if (!pathExistsInTree(tree, p)) errors.push(`forbidAsFrontend 路径不存在：${p}`);
  }

  // emptyLayers：必须是层枚举子集
  if (!Array.isArray(ex.emptyLayers)) {
    errors.push('emptyLayers 必须是数组（可为空）');
  } else {
    for (const l of ex.emptyLayers) {
      if (!LAYER_ENUM.includes(l)) errors.push(`emptyLayers 含非法层名：${l}（合法：${LAYER_ENUM.join('/')}）`);
    }
  }

  // externalSystems：id/name 规范
  if (!Array.isArray(ex.externalSystems)) {
    errors.push('externalSystems 必须是数组（可为空）');
  } else {
    const ids = new Set();
    for (const x of ex.externalSystems) {
      if (!x || typeof x !== 'object') { errors.push('externalSystems 项必须是对象'); continue; }
      if (!/^ext_[a-z0-9_]+$/.test(x.id || '')) {
        errors.push(`externalSystems id 非法：${x.id}（须匹配 /^ext_[a-z0-9_]+$/）`);
      } else if (ids.has(x.id)) {
        errors.push(`externalSystems id 重复：${x.id}`);
      }
      ids.add(x.id);
      if (!x.name || typeof x.name !== 'string') errors.push(`externalSystems ${x.id} 缺 name`);
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// 与确定性 shapeDetect 交叉验证
// 规则（PLAN-USAGE8 §6 风险缓解）：低置信或冲突时降级为确定性形态
// ---------------------------------------------------------------------------

function crossCheckShape(ex, importance) {
  const warnings = [];
  const detShape = importance.shape.kind;
  const confidence = CONF_ENUM.includes(ex.confidence) ? ex.confidence : 'medium';

  let shape = ex.shape;
  let shapeSource = 'explore';

  if (ex.shape === 'unknown' || confidence === 'low') {
    shape = detShape;
    shapeSource = 'forensics';
    warnings.push(`Agent 形态 ${ex.shape}/${confidence} → 采用确定性 shapeDetect：${detShape}`);
  } else if (ex.shape !== detShape) {
    // Agent 与确定性取证冲突：高置信保留 Agent 判断但留痕；中置信降级
    if (confidence === 'high') {
      warnings.push(`形态分歧：Agent=${ex.shape}(high) vs 确定性=${detShape}，保留 Agent 判断`);
    } else {
      shape = detShape;
      shapeSource = 'forensics';
      warnings.push(`形态分歧：Agent=${ex.shape}(medium) vs 确定性=${detShape}，降级采用确定性`);
    }
  }

  // emptyLayers：Agent 缺失时用确定性补；存在时保留（Agent 开放式读仓可能更准）
  let emptyLayers = Array.isArray(ex.emptyLayers) ? ex.emptyLayers.filter((l) => LAYER_ENUM.includes(l)) : [];
  if (emptyLayers.length === 0 && Array.isArray(importance.emptyLayers)) {
    emptyLayers = importance.emptyLayers;
    warnings.push(`emptyLayers 为空 → 采用确定性空层：${emptyLayers.join(',') || '（无）'}`);
  }

  return { shape, shapeSource, emptyLayers, warnings };
}

// ---------------------------------------------------------------------------
// 兜底契约：确定性取证直接产出（无 Agent 参与；orch8 等价退回 orch4+shape）
// ---------------------------------------------------------------------------

function fallbackExplore(importance) {
  return {
    shape: importance.shape.kind,
    confidence: 'low',
    trunkStory: [],
    mustPaths: [],
    forbidAsFrontend: [],
    emptyLayers: importance.emptyLayers || [],
    externalSystems: [],
    evidence: { fallback: true, shapeName: importance.shape.name, shapeSignal: importance.shape.signal || '' },
    _shapeSource: 'fallback'
  };
}

// ---------------------------------------------------------------------------
// 主流程：选引擎 → 产出 → 校验 → 修订 → 交叉验证 → 落盘
// ---------------------------------------------------------------------------

async function runOne(repoRoot, outDir, engine = 'auto') {
  const root = path.resolve(repoRoot);
  const dest = path.resolve(outDir || path.join('/tmp/arch-orch/out/explore-' + path.basename(root)));
  fs.mkdirSync(dest, { recursive: true });
  fs.mkdirSync(path.join(root, 'architecture_viewer'), { recursive: true });

  const tree = buildTree(root);
  // 确定性取证（交叉验证 + 兜底）
  const inv = scan(root, { write: false });
  const importance = importanceForensics(root, tree, inv.entrypoints || []);

  const rounds = [];
  let raw = null;
  let chosenEngine = engine;

  const canDsh = engine === 'dsh' || (engine === 'auto' && findDsh() !== 'npx');
  if (engine === 'auto') chosenEngine = canDsh ? 'dsh' : 'llm';

  if (chosenEngine === 'dsh') {
    // --- dsh headless：写 architecture_viewer/explore.json，闸门反馈修订 ---
    const kitJson = path.join(root, 'architecture_viewer', 'explore.json');
    const MAX_ROUNDS = 3;
    for (let i = 1; i <= MAX_ROUNDS; i++) {
      const task = i === 1 ? EXPLORE_TASK : REVIEW_TASK(rounds[i - 2].errors);
      const r = runDsh(root, task, path.join(dest, `run${i}.log`));
      let parsed = null;
      if (fs.existsSync(kitJson)) {
        try { parsed = JSON.parse(fs.readFileSync(kitJson, 'utf8')); } catch (e) { parsed = null; }
      }
      const v = parsed ? validateExplore(parsed, tree) : { errors: [`dsh 未产出可解析 explore.json（exit=${r.code}）`], warnings: [] };
      rounds.push({ round: i, engine: 'dsh', errors: v.errors, warnings: v.warnings });
      console.log(`[explore] dsh round${i} errors=${v.errors.length}`, v.errors.slice(0, 5));
      if (v.errors.length === 0) { raw = parsed; break; }
    }
  } else {
    // --- LLM 兜底：json 模式直出，校验失败补一轮纠错 ---
    const MAX_ROUNDS = 2;
    for (let i = 1; i <= MAX_ROUNDS; i++) {
      let parsed = null;
      try { parsed = await runLlmExplore(root, tree, importance); } catch (e) { parsed = null; }
      const v = parsed ? validateExplore(parsed, tree) : { errors: ['LLM 未返回可解析 JSON'], warnings: [] };
      rounds.push({ round: i, engine: 'llm', errors: v.errors, warnings: v.warnings });
      console.log(`[explore] llm round${i} errors=${v.errors.length}`, v.errors.slice(0, 5));
      if (v.errors.length === 0) { raw = parsed; break; }
    }
  }

  // --- 降级或交叉验证 ---
  let resolved;
  let degraded = false;
  if (!raw) {
    resolved = fallbackExplore(importance);
    degraded = true;
    console.log('[explore] Agent 契约校验终败 → 降级确定性 shapeDetect（shapeSource=fallback）');
  } else {
    const cc = crossCheckShape(raw, importance);
    resolved = {
      ...raw,
      shape: cc.shape,
      emptyLayers: cc.emptyLayers,
      _shapeSource: cc.shapeSource,
      _crossWarnings: cc.warnings
    };
    if (cc.shapeSource !== 'explore') degraded = true;
  }

  // --- 落盘 ---
  fs.writeFileSync(path.join(dest, 'explore.json'), JSON.stringify(resolved, null, 2));
  if (raw) fs.writeFileSync(path.join(dest, 'explore-raw.json'), JSON.stringify(raw, null, 2));
  fs.writeFileSync(path.join(dest, 'explore-validate.json'), JSON.stringify({
    engine: chosenEngine, degraded, rounds,
    llm: { calls: usage.calls, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens },
    deterministic: { shape: importance.shape.kind, emptyLayers: importance.emptyLayers }
  }, null, 2));
  // 同步到仓库 kit 目录（供 orch8 variant 读 state.explore）
  fs.writeFileSync(path.join(root, 'architecture_viewer', 'explore.json'), JSON.stringify(resolved, null, 2));

  return { explore: resolved, degraded, engine: chosenEngine, rounds, outDir: dest };
}

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('Need DEEPSEEK_API_KEY');
    process.exit(2);
  }
  const args = process.argv.slice(2);
  const engineIdx = args.indexOf('--engine');
  const engine = engineIdx >= 0 ? args[engineIdx + 1] : 'auto';
  const positional = args.filter((a, i) => a !== '--engine' && i !== engineIdx + 1 && !a.startsWith('--'));
  const repoRoot = positional[0];
  const outDir = positional[1];
  if (!repoRoot) {
    console.error('用法: node eval/orch/explore-json.js <repoRoot> [outDir] [--engine dsh|llm|auto]');
    process.exit(2);
  }
  console.log('[explore] API key:', maskKey(), '| engine =', engine);
  const r = await runOne(repoRoot, outDir, engine);
  console.log('\n===== EXPLORE SUMMARY =====');
  console.log('engine      :', r.engine);
  console.log('degraded    :', r.degraded);
  console.log('shape       :', r.explore.shape, '(source:', r.explore._shapeSource + ')');
  console.log('emptyLayers :', (r.explore.emptyLayers || []).join(',') || '（无）');
  console.log('mustPaths   :', (r.explore.mustPaths || []).length, '条');
  console.log('extSystems  :', (r.explore.externalSystems || []).map((x) => x.id).join(',') || '（无）');
  console.log('LLM calls   :', usage.calls, '| tokens:', usage.promptTokens + usage.completionTokens);
  console.log('产物        :', path.join(r.outDir, 'explore.json'));
}

if (require.main === module) {
  main().catch((e) => { console.error('致命错误:', e); process.exit(1); });
}

module.exports = {
  runOne, validateExplore, crossCheckShape, fallbackExplore,
  pathExistsInTree, SHAPE_ENUM, LAYER_ENUM
};
