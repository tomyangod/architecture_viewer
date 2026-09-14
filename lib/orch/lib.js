'use strict';

/**
 * 编排流水线共享工具：LLM 客户端、上下文取证、Mermaid 事实核查/lint。
 * Key 只从环境变量 DEEPSEEK_API_KEY 读取，日志脱敏。
 */

const fs = require('fs');
const path = require('path');
const { SKIP_DIRS: SCAN_SKIP_DIRS } = require('../scan');
const { makeDirSkip, DOT_OPS_ENTRIES } = require('../scan-ignore');

const { chat, usage, maskKey, modelFor } = require('../llm-client');
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '__pycache__', '.pytest_cache', '.venv', 'venv',
  'dist', 'build', '.idea', '.vscode', '.mypy_cache', 'site-packages'
]);

// ---------- LLM 客户端（lib/llm-client.js：超时 / 指数退避 / 备用端点 / 分场景模型） ----------

function extractJson(content) {
  let t = String(content || '').trim();
  // 1) 剥代码围栏 ```json ... ```
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // 2) 直接解析
  try { return JSON.parse(t); } catch (_) { /* fall through */ }
  // 3) 平衡括号提取（从第一个 { 或 [ 起，找到匹配的结束符）
  const start = t.search(/[[{]/);
  if (start >= 0) {
    const open = t[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end > start) {
      let body = t.slice(start, end + 1);
      // 4) 常见修复：尾随逗号
      body = body.replace(/,\s*([}\]])/g, '$1');
      try { return JSON.parse(body); } catch (_) { /* fall through */ }
    }
  }
  // 5) 兜底：贪婪正则 + 去尾随逗号
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    const body = m[0].replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(body);
  }
  throw new Error('无法解析模型 JSON: ' + t.slice(0, 200));
}

// 要求 JSON 的 LLM 调用：解析失败时带错误信息重试一次；仍失败则抛出（由调用方决定降级策略）
async function chatJson(messages, opts = {}) {
  let lastErr;
  let msgs = messages;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chat(msgs, opts);
    try {
      return extractJson(raw);
    } catch (e) {
      lastErr = e;
      msgs = [
        ...messages,
        { role: 'assistant', content: raw.slice(0, 3000) },
        { role: 'user', content: `你上一条输出无法被 JSON.parse 解析（${e.message}）。常见原因：尾随逗号、字符串内未转义的换行或引号、JSON 外混入说明文字。请重新输出**仅一个合法 JSON 对象**，不要代码围栏，不要任何解释文字。` }
      ];
    }
  }
  throw lastErr;
}

// 起草/修订节点：优先 JSON {"block-diagram.md": ...}；模型直接返回 markdown 文档时兜底
function extractBlockMd(content) {
  const raw = String(content || '');
  try {
    const obj = extractJson(raw);
    const md = obj['block-diagram.md'] || obj.blockDiagram ||
      Object.values(obj).find((v) => typeof v === 'string' && /flowchart|subgraph/.test(v));
    if (md && /flowchart|subgraph/.test(md)) return md;
  } catch (_) { /* fall through */ }
  // 截断的 JSON 字符串：{"block-diagram.md":"# ...\n```mermaid ...（被 max_tokens 截断）
  const truncated = raw.match(/\{\s*"(?:block-diagram\.md|blockDiagram)"\s*:\s*"([\s\S]*)$/);
  if (truncated && /flowchart|subgraph/.test(truncated[1])) {
    return unescapeJsonString(truncated[1]);
  }
  // 模型直接输出 markdown 文档（含 ```mermaid 块）
  if (/flowchart|subgraph/.test(raw)) {
    return raw.trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/m, '').trim();
  }
  throw new Error('响应中既无合法 JSON 也无 mermaid 内容: ' + raw.slice(0, 150));
}

function unescapeJsonString(s) {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\r/g, '');
}

// 起草/修订专用：JSON 与 markdown 双通道，失败带提示重试一次
async function chatBlock(messages, opts = {}) {
  let lastErr;
  let msgs = messages;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chat(msgs, { ...opts, json: true });
    try {
      return extractBlockMd(raw);
    } catch (e) {
      lastErr = e;
      msgs = [
        ...messages,
        { role: 'user', content: '上一条输出无法解析或被截断。请重新输出：优先严格 JSON {"block-diagram.md": "完整 markdown 文档"}；markdown 文档必须完整输出到最后一个 ``` 围栏，不得中途截断。' }
      ];
    }
  }
  throw lastErr;
}

// Dot-prefixed entries are skipped by default (.git/.vscode/…), but these
// are legitimate ops/CI evidence that diagrams reference (e.g. <small>.github/workflows</small>).
function walk(root, rel, acc, skip) {
  const abs = path.join(root, rel);
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    if (e.name.startsWith('.') && !DOT_OPS_ENTRIES.has(e.name)) continue;
    const relPath = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (skip(e.name, path.join(root, relPath))) continue;
      acc.dirs.add(relPath);
      walk(root, relPath, acc, skip);
    } else if (e.isFile()) {
      acc.files.add(relPath);
    }
  }
}

function buildTree(root) {
  const acc = { files: new Set(), dirs: new Set() };
  const skip = makeDirSkip(root, SCAN_SKIP_DIRS, { allowDotEntries: DOT_OPS_ENTRIES });
  walk(root, '', acc, skip);
  const all = new Set([...acc.dirs, ...acc.files]);
  const lines = [];
  const sorted = [...all].sort();
  for (const p of sorted) {
    lines.push(acc.dirs.has(p) ? p + '/' : p);
  }
  return { root, treeText: lines.join('\n'), files: acc.files, dirs: acc.dirs, all };
}

const EXCERPT_PATTERNS = [
  /(^|\/)flask_app\.py$/, /(^|\/)queue_handlers\.py$/, /(^|\/)worker_pool\.py$/,
  /(^|\/)worker\.py$/, /(^|\/)notification_service\.py$/, /(^|\/)custom_queue\.py$/,
  /(^|\/)queuedWatchMetaData\.py$/, /(^|\/)store\/(base|file_saving_datastore|updates|__init__)\.py$/,
  /(^|\/)realtime\/(socket_server|events)\.py$/, /(^|\/)processors\/(base|difference_base)\.py$/,
  /(^|\/)notification\/handler\.py$/, /(^|\/)diff\//, /(^|\/)model\//,
  /(^|\/)content_fetchers\/(base|playwright|requests)\.py$/,
  /(^|\/)api\/(Watch|Notifications|SystemInfo|__init__)\.py$/,
  /(^|\/)auth_decorator\.py$/, /(^|\/)forms\.py$/, /(^|\/)changedetection\.py$/,
  /(^|\/)app\.py$/, /(^|\/)main\.py$/, /(^|\/)settings\.py$/
];

function gatherExcerpts(root, tree, capChars = 90000) {
  const out = [];
  let total = 0;
  const push = (rel, content, cap) => {
    if (total > capChars) return false;
    const c = content.length > cap ? content.slice(0, cap) + '\n…(截断)' : content;
    out.push({ path: rel, content: c });
    total += c.length + rel.length + 20;
    return true;
  };
  // 文档/编排/依赖（信息确定性最高）
  for (const f of ['README.md', 'docker-compose.yml', 'docker-compose.yaml', 'Dockerfile', 'requirements.txt', 'package.json']) {
    const p = path.join(root, f);
    if (tree.files.has(f)) {
      const cap = f === 'README.md' ? 7000 : 6000;
      if (!push(f, fs.readFileSync(p, 'utf8'), cap)) break;
    }
  }
  // 关键目录清单（帮助理解模块边界，成本极低）
  for (const d of ['changedetectionio/api', 'changedetectionio/blueprint', 'changedetectionio/processors',
    'changedetectionio/content_fetchers', 'changedetectionio/notification', 'changedetectionio/model',
    'changedetectionio/diff', 'changedetectionio/realtime', 'changedetectionio/store']) {
    if (tree.dirs.has(d)) {
      const listing = [...tree.all].filter(p => p.startsWith(d + '/') &&
        !p.slice(d.length + 1).includes('/')).sort()
        .map(p => p.slice(d.length + 1) + (tree.dirs.has(p) ? '/' : '')).join('  ');
      out.push({ path: d + '/ (目录清单)', content: listing });
      total += listing.length + d.length + 40;
    }
  }
  // 关键源码摘录
  for (const f of [...tree.files].sort()) {
    if (total > capChars) break;
    if (!EXCERPT_PATTERNS.some((re) => re.test(f))) continue;
    if (/\.(py|js|ts)$/.test(f) === false) continue;
    try { push(f, fs.readFileSync(path.join(root, f), 'utf8'), 3500); } catch { /* skip */ }
  }
  return { excerpts: out, totalChars: total };
}

// ---------- Mermaid 事实核查 / lint（确定性） ----------

function parseMermaid(md) {
  const blocks = [];
  const re = /```mermaid\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md))) blocks.push(m[1]);
  return blocks;
}

// 从 flowchart 文本中提取节点 id 与边
// 两遍解析：先收集全部节点声明 id，再剥掉边标签后按箭头切段；
// 边端点只接受已声明的节点 id（标签里的拉丁词如「启动listmonk容器」不会再被误当成节点）
function parseFlowchart(code) {
  const nodeIds = new Set();
  const edges = [];
  const subgraphs = [];
  const undeclared = new Set();
  const lines = code.split(/\n/).map((l) => l.trim());
  const SKIP_ID = /^(TB|LR|BT|RL|subgraph|end|direction|flowchart|graph|classDef|class|style|linkStyle)$/;
  // subgraph 深度跟踪：嵌套 subgraph（subgraph 内再开 subgraph）会让 mermaid
  // 静默吞掉跨嵌套簇的边（不报错、图缺边），必须由闸门显式拦截
  let depth = 0;
  let nested = 0;
  // 第一遍：节点声明（在剥掉边标签后的行上扫，避免紧凑写法 A-->|x|B[..] 中 B 前是 | 而漏声明）
  for (const line of lines) {
    if (!line || line.startsWith('%%')) continue;
    if (/^subgraph\b/.test(line)) {
      depth++;
      if (depth > 1) nested++;
    } else if (/^end\b/.test(line)) {
      depth = Math.max(0, depth - 1);
    }
    const sg = line.match(/^subgraph\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (sg) { subgraphs.push(sg[1]); continue; }
    const strippedDecl = line
      .replace(/\|[^|]*\|/g, '  ')
      .replace(/--\s+[\s\S]*?-->/g, '-->');
    // 节点声明：id[..] id(..) id[(..)] id([..]) id{..]
    const declRe = /(?:^|[\s])([A-Za-z_][A-Za-z0-9_]*)\s*(\[\(|\(\[|\[|\(|\{)/g;
    let dm;
    while ((dm = declRe.exec(strippedDecl))) {
      if (!SKIP_ID.test(dm[1])) nodeIds.add(dm[1]);
    }
  }
  // 第二遍：边
  for (const line of lines) {
    if (!line || line.startsWith('%%')) continue;
    if (/^(subgraph|end|flowchart|graph|classDef|class|direction|style|linkStyle)\b/.test(line)) continue;
    if (!/-->|---|-\.-/.test(line)) continue;
    const labeled = /\|[^|]+\|/.test(line);
    // 边标签按箭头出现顺序提取（-->|中文| 形式），供方向闸门判断动作语义
    const labels = [];
    {
      const re = /(?:-\.?->|---)\s*\|([^|]*)\|/g;
      let m;
      while ((m = re.exec(line))) labels.push(m[1].trim());
    }
    // 剥边标签：|中文标签| 与 -- 长标签 -->（要求 -- 后紧跟空白，避免误伤 --> 链）
    const stripped = line
      .replace(/\|[^|]*\|/g, '  ')
      .replace(/--\s+[\s\S]*?-->/g, '-->');
    // 行内显式声明（兼容 A-->|x|B[".."] 这类无空格紧凑写法，第一遍声明扫描要求前导空白会漏）
    const inlineDecl = new Set();
    {
      const re = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[\(|\(\[|\[|\(|\{)/g;
      let mm;
      while ((mm = re.exec(line))) if (!SKIP_ID.test(mm[1])) inlineDecl.add(mm[1]);
    }
    // 按箭头切段：chunk, arrow, chunk, arrow ...
    const parts = stripped.split(/(-\.->|-->|---)/).filter((s) => s !== '');
    const idsIn = (s) => (s.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []).filter((id) => nodeIds.has(id) && !SKIP_ID.test(id));
    // 幽灵端点：边行里出现、但既无形状声明也不是 subgraph/关键字的裸 id
    // （mermaid 会把裸 id 直接当矩形节点渲染，如 F -->|申请证书| G 里的 G）
    const rawIdsIn = (s) => {
      const cleaned = s
        .replace(/“[^”]*”|"[^"]*"|'[^']*'/g, ' ')  // 引号内节点名整体剥掉
        .replace(/\([^)]*\)/g, ' ')                   // stadium/圆角形状内容
        .replace(/\[[^\]]*\]/g, ' ')                  // 矩形/圆柱形状内容
        .replace(/\{[^}]*\}/g, ' ');                  // 菱形形状内容
      return cleaned.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
    };
    for (const p of parts) {
      if (/^(-\.->|-->|---)$/.test(p)) continue;
      for (const id of rawIdsIn(p)) {
        if (SKIP_ID.test(id) || nodeIds.has(id) || inlineDecl.has(id) || subgraphs.includes(id)) continue;
        undeclared.add(id);
      }
    }
    let prev = null;
    let arrowIdx = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (/^(-\.->|-->|---)$/.test(p)) {
        const dashed = p === '-.->';
        const label = labels[arrowIdx] || '';
        arrowIdx++;
        const next = idsIn(parts[i + 1] || '');
        if (prev) for (const a of prev) for (const b of next) edges.push({ from: a, to: b, labeled: labeled || !!label, dashed, label });
        prev = next;
        i++; // 跳过下一 chunk（已消费）
      } else if (prev === null) {
        prev = idsIn(p);
      }
    }
  }
  return { nodeIds: [...nodeIds], edges, subgraphs, undeclared: [...undeclared], nested };
}

/**
 * Mermaid flowchart 边标签里的 ()[]{} 会被当成 stadium/矩形/菱形形状语法，
 * 典型失败：`A -->|实时推送(SSE/WS)| B` → Parse error Expecting STADIUMEND got PS，
 * viewer 整图回退占位图。闸门拒绝；扫尾清洗为空格。
 */
function sanitizeMermaidEdgeLabel(lab) {
  return String(lab || '')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findUnsafeMermaidEdgeLabels(code) {
  const bad = [];
  const re = /(?:-\.?->|---)\s*\|([^|]*)\|/g;
  let m;
  while ((m = re.exec(String(code || '')))) {
    const lab = m[1].trim();
    if (lab && /[()[\]{}]/.test(lab)) bad.push(lab);
  }
  return [...new Set(bad)];
}

// 路径核查：支持 Next.js 特殊目录约定 —— (route-group) 路由组、[dynamic] 动态段
function pathMatchesTree(tok, tree) {
  const norm = String(tok).replace(/\/$/, '');
  const direct = tree.all.has(norm) || tree.all.has(tok) ||
    [...tree.all].some((p) => p === norm || p.startsWith(norm + '/') || p.startsWith(norm + '.') ||
      p.endsWith('/' + norm) || p.endsWith(norm)) ||
    [...tree.dirs].some((d) => d === norm || d.endsWith('/' + norm));
  if (direct) return true;
  // 含 (xxx) 或 [xxx] 段：转成通配正则后在树中匹配（如 src/app/(main)/websites/[websiteId]/(reports)）
  if (/[()[\]]/.test(norm)) {
    // 先转义全部正则元字符（含括号），再把转义后的 (group)/[dynamic] 段换成通配；括号不平衡也不会崩
    try {
      const escaped = norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = escaped
        .replace(/\\\([^/\\]*\\\)/g, "[^/]+")
        .replace(/\\\[[^\]/\\]*\\\]/g, "[^/]+");
      const re = new RegExp('(^|/)' + pattern + '(/|$)');
      return [...tree.all].some((p) => re.test(p));
    } catch { return false; }
  }
  return false;
}

// 从 <small>…</small> 中提取路径候选并核查
function verifyPaths(md, tree) {
  const missing = [];
  const checked = [];
  const smallRe = /<small>([\s\S]*?)<\/small>/g;
  let m;
  while ((m = smallRe.exec(md))) {
    const parts = m[1].split(/[·,，、→\n]|<br\s*\/?>/);
    for (let part of parts) {
      part = part.replace(/[*`：:]/g, ' ').trim();
      // 路径样子的 token：允许 Next.js 的 (group) / [dynamic] 段
      const tokens = part.match(/[\w.@/\-()[\]]{3,}/g) || [];
      for (let tok of tokens) {
        // 剥首尾杂散符号：去掉 "./" 前缀（如 ./internal/api）和结尾标点，
        // 但保留真实点目录前缀（.github/workflows、.gitlab-ci.yml）。
        tok = tok
          .replace(/^(?:\.[/\\])+/, '')
          .replace(/[.\-\/\\]+$/, '')
          .replace(/^[-]+/, '');
        if (!tok) continue;
        const looksPath = /\//.test(tok) || /\.(py|js|jsx|ts|tsx|go|rs|java|kt|rb|php|c|cpp|h|html|vue|yml|yaml|md|txt|toml|cfg|ini|conf|sh|json|css|sql|proto)$/.test(tok) || /(^|\/)dockerfile$/i.test(tok);
        if (!looksPath) continue;
        if (tok.length < 3) continue;
        // 豁免：docker 镜像引用（ghcr.io/x/y:tag）、端口主机等
        if (/^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?\//i.test(tok) || /^[a-z0-9.-]+:[a-z0-9.-]+$/.test(tok)) continue;
        checked.push(tok);
        if (!pathMatchesTree(tok, tree)) missing.push(tok);
      }
    }
  }
  return { missing: [...new Set(missing)], checked: [...new Set(checked)] };
}

function lintBlockDiagram(md, tree) {
  const blocks = parseMermaid(md);
  const issues = [];
  let nodeCount = 0, edgeCount = 0, labeledEdges = 0, subgraphCount = 0;
  for (const code of blocks) {
    const { nodeIds, edges, subgraphs, undeclared, nested } = parseFlowchart(code);
    if (nested > 0) {
      issues.push(`检测到 ${nested} 处嵌套 subgraph——subgraph 内再开 subgraph 时 mermaid 会静默丢弃跨簇边（图能渲染但缺边），请改为扁平分层（同级多个 subgraph，一个 subgraph 一层）`);
    }
    subgraphCount += subgraphs.length;
    // id 重复只在同一个 mermaid 块内算错误；子图2 复用主图 id 是合法特写
    const declCount = new Map();
    const declRe = /(?:^|[\s])([A-Za-z_][A-Za-z0-9_]*)\s*(\[\(|\(\[|\[|\(|\{)/g;
    let dm;
    while ((dm = declRe.exec(code))) {
      if (/^(flowchart|graph|subgraph|end|classDef|class|style|direction|linkStyle)$/.test(dm[1])) continue;
      if (subgraphs.includes(dm[1])) continue;
      declCount.set(dm[1], (declCount.get(dm[1]) || 0) + 1);
    }
    for (const [id, n] of declCount) if (n > 1) issues.push(`节点 id 重复: ${id}`);
    for (const e of edges) {
      edgeCount++;
      if (e.labeled) labeledEdges++;
    }
    // 幽灵端点：边引用了从未声明形状的裸 id（mermaid 会自动渲染成默认矩形，显示为原始 id）
    for (const id of undeclared) {
      issues.push(`边引用未声明节点: ${id}（裸 id 会被 mermaid 当默认矩形直接渲染，必须显式声明形状或修正为正确节点 id）`);
    }
    // 边标签 ()[]{}：mermaid 会当成形状语法，整图 Syntax error → viewer 回退占位图
    for (const lab of findUnsafeMermaidEdgeLabels(code)) {
      const fix = sanitizeMermaidEdgeLabel(lab);
      issues.push(
        `边标签含 mermaid 形状保留字符 (): 「${lab}」——flowchart 边标签里的 ()[]{} 会被解析成 stadium/矩形/菱形语法，导致整图 Syntax error；请改为「${fix || '短中文动宾'}」或去掉括号`
      );
    }
    nodeCount += nodeIds.length;
    // 密度按块判：子图1 全景 15–25、子图2 主链路特写 5–12；跨块求和会误伤双图文档
    // （usage1-changedetection 24+8=32 本身合格）
    const bi = blocks.indexOf(code);
    if (nodeIds.length > (bi === 0 ? 28 : 10)) issues.push(`子图${bi + 1} 节点过密: ${nodeIds.length} 个（建议${bi === 0 ? '15–25' : '6–8'}）`);
    if (nodeIds.length < (bi === 0 ? 5 : 6)) issues.push(bi === 0
      ? `子图${bi + 1} 节点过少: ${nodeIds.length} 个`
      : `主链路特写节点过少: ${nodeIds.length} 个（规范 6–8 个节点，需串起完整默认主流程：角色→入口→核心处理→存储/通道→外部对端，禁止只画 4–5 个节点的简化片段）`);
    // 全景块断头检查（ntfy 教训：mail/webpush 通道节点只连外部系统、缺上游内部边，
    // 评委三轮均指出「链路断裂」）：subgraph 内节点必须至少有一条对端也是内部节点的边
    if (bi === 0) {
      // 自包含解析：跟踪 subgraph 深度，收集层内声明/出现的节点 id（不依赖 run.js 的 parseBlockStructure）
      const internal = new Set();
      let depth = 0;
      for (const line of code.split('\n')) {
        const t = line.trim();
        if (/^subgraph\b/.test(t)) { depth++; continue; }
        if (/^end\s*$/.test(t)) { depth = Math.max(0, depth - 1); continue; }
        if (depth > 0) {
          const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(\[\(|\(\[|\[|\(|\{)/);
          if (m && !/^(flowchart|graph|direction|classDef|class|style|linkStyle)$/.test(m[1])) internal.add(m[1]);
        }
      }
      const internalDegree = new Map();
      for (const e of edges) {
        if (internal.has(e.from) && internal.has(e.to)) {
          internalDegree.set(e.from, (internalDegree.get(e.from) || 0) + 1);
          internalDegree.set(e.to, (internalDegree.get(e.to) || 0) + 1);
        }
      }
      for (const id of internal) {
        if (!internalDegree.has(id)) {
          issues.push(`内部节点断头: ${id} 没有任何连向其他内部节点的边——通道/执行器必须有上游 API/服务 --> 通道 的边，存储必须有读写边，ops 必须有虚线部署边；若该节点与主流程无关则删除`);
        }
      }
    }
  }
  const pathCheck = verifyPaths(md, tree);
  for (const p of pathCheck.missing) issues.push(`路径在文件树中不存在: ${p}`);

  const smallTags = (md.match(/<small>/g) || []).length;
  const classDefs = (md.match(/classDef\s+/g) || []).length;
  const chineseEdges = (md.match(/-->\|[^|]*[\u4e00-\u9fff][^|]*\|/g) || []).length;
  const metrics = {
    子图数: blocks.length,
    分层数: subgraphCount,
    节点数: nodeCount,
    边数: edgeCount,
    带中文标签边数: chineseEdges,
    双行标签节点数: smallTags,
    classDef数: classDefs,
    路径核查数: pathCheck.checked.length,
    幻觉路径数: pathCheck.missing.length
  };
  // 密度问题已按块上报（见上）；总数仅作指标
  if (edgeCount > 0 && labeledEdges === 0 && chineseEdges === 0) issues.push('边缺少语义标签');
  if (classDefs === 0) issues.push('缺少 classDef 上色');
  return { issues, metrics, missingPaths: pathCheck.missing };
}

// ---------- 通用视图协议闸门（C4 三视图 / classDiagram / deployment flowchart） ----------

// 解析 C4 mermaid 块（C4Context / C4Container / C4Component）
function parseC4(code) {
  const nodeIds = new Set();
  const edges = [];
  const undeclared = new Set();
  let m;
  // 节点声明：Person / System / System_Ext / Container / Container_Ext / ContainerDb / Component / ComponentDb / Deployment_Node
  const declRe = /\b(?:Person(?:_Ext)?|System(?:_Ext|Db)?|Container(?:_Ext|Db)?|Component(?:_Ext|Db)?|Deployment_Node|Node)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  while ((m = declRe.exec(code))) nodeIds.add(m[1]);
  // 边界声明：System_Boundary / Container_Boundary / Enterprise_Boundary
  const boundRe = /\b(?:System_Boundary|Container_Boundary|Enterprise_Boundary)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  while ((m = boundRe.exec(code))) nodeIds.add(m[1]);
  // 关系边：Rel / Rel_D / Rel_U / Rel_L / Rel_R / BiRel / BiRel_*
  const relRe = /\b(?:BiRel(?:_[DULR])?|Rel(?:_[DULR])?)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  while ((m = relRe.exec(code))) {
    edges.push({ from: m[1], to: m[2], label: '' });
    if (!nodeIds.has(m[1])) undeclared.add(m[1]);
    if (!nodeIds.has(m[2])) undeclared.add(m[2]);
  }
  return { nodeIds: [...nodeIds], edges, undeclared: [...undeclared] };
}

// 解析 classDiagram mermaid 块
function parseClassDiagram(code) {
  const classIds = new Set();
  const edges = [];
  const undeclared = new Set();
  let m;
  // 显式 class 声明：class Name { ... } 或 class Name
  const classRe = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  while ((m = classRe.exec(code))) classIds.add(m[1]);
  // 关系：A <|-- B, A *-- B, A o-- B, A --> B, A -- B, A .. B, A <|.. B 等
  // 支持基数标注 "1" -- "*" 和标签 : label
  const relLineRe = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*(?:"[^"]*"[ \t]*)?(<\|--|--\|>|<\|\.\.|\.\.\|>|\*--|--\*|o--|--o|-->|<--|\.\.>|<\.\.|\.\.|--)[ \t]*(?:"[^"]*"[ \t]*)?([A-Za-z_][A-Za-z0-9_]*)/gm;
  while ((m = relLineRe.exec(code))) {
    // 跳过关键字误匹配
    if (/^(class|classDiagram|direction|link|style|note|click)$/i.test(m[1]) || /^(class|classDiagram|direction|link|style|note|click)$/i.test(m[3])) continue;
    edges.push({ from: m[1], to: m[3], label: '' });
    if (!classIds.has(m[1])) undeclared.add(m[1]);
    if (!classIds.has(m[3])) undeclared.add(m[3]);
  }
  return { nodeIds: [...classIds], edges, undeclared: [...undeclared] };
}

// 各视图的节点数下限
const DIAGRAM_NODE_MIN = {
  'c4-context.md': 3,
  'c4-container.md': 3,
  'c4-component.md': 3,
  'class-diagram.md': 2,
  'deployment-ops.md': 3
};
const DIAGRAM_NODE_MAX = {
  'c4-context.md': 20,
  'c4-container.md': 25,
  'c4-component.md': 30,
  'class-diagram.md': 25,
  'deployment-ops.md': 25
};
// 期望的 mermaid 头。c4-* 精修片用 flowchart 表达 C4 语义（Block 视觉语法），
// 原生 C4 方言（C4Context 等）仅骨架生成使用，闸门两者都接受。
const DIAGRAM_EXPECTED_HEADER = {
  'c4-context.md': /^(C4Context|flowchart|graph)/m,
  'c4-container.md': /^(C4Container|flowchart|graph)/m,
  'c4-component.md': /^(C4Component|flowchart|graph)/m,
  'class-diagram.md': /^classDiagram/m,
  'deployment-ops.md': /^(flowchart|graph)/m
};
const DIAGRAM_HEADER_HINT = {
  'c4-context.md': 'flowchart（推荐：Block 视觉语法）或 C4Context',
  'c4-container.md': 'flowchart（推荐：Block 视觉语法）或 C4Container',
  'c4-component.md': 'flowchart（推荐：Block 视觉语法）或 C4Component',
  'class-diagram.md': 'classDiagram',
  'deployment-ops.md': 'flowchart'
};

// 从 C4 声明参数中提取路径 token（Container/Component 的第 3、4 参数字符串）
function extractC4Paths(code) {
  const tokens = [];
  // 匹配 ("..."  '...') 字符串参数中的路径样子 token
  const strRe = /"([^"]*)"|'([^']*)'/g;
  let m;
  while ((m = strRe.exec(code))) {
    const s = m[1] || m[2] || '';
    const toks = s.match(/[\w.@/\-()[\]]{3,}/g) || [];
    for (let tok of toks) {
      tok = tok.replace(/^[./\-]+|[./\-]+$/g, '');
      if (!tok) continue;
      const looksPath = /\//.test(tok) || /\.(py|js|jsx|ts|tsx|go|rs|java|kt|rb|php|c|cpp|h|html|vue|yml|yaml|md|txt|toml|cfg|ini|conf|sh|json|css|sql|proto)$/.test(tok) || /(^|\/)dockerfile$/i.test(tok);
      if (looksPath && !/^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?\//i.test(tok)) tokens.push(tok);
    }
  }
  return tokens;
}

/**
 * 通用视图闸门：检查 C4 三视图 / classDiagram / deployment 图的结构完整性。
 * 检查项：mermaid 头类型、边端点已声明（无幽灵节点）、节点数上下限、孤儿节点、路径核查。
 * @returns {{issues: string[], metrics: object}}
 */
function lintDiagram(md, fileName, tree) {
  const blocks = parseMermaid(md);
  const issues = [];
  const metrics = { 子图数: blocks.length, 节点数: 0, 边数: 0, 路径核查数: 0, 幻觉路径数: 0 };

  if (blocks.length === 0) {
    issues.push('缺少 mermaid 代码块');
    return { issues, metrics };
  }

  const headerRe = DIAGRAM_EXPECTED_HEADER[fileName];
  const nodeMin = DIAGRAM_NODE_MIN[fileName] || 3;
  const nodeMax = DIAGRAM_NODE_MAX[fileName] || 25;
  const allPathTokens = [];

  for (let bi = 0; bi < blocks.length; bi++) {
    const code = blocks[bi];
    const label = '子图' + (bi + 1);

    // 1. 图类型头检查
    if (headerRe && !headerRe.test(code)) {
      issues.push(`${label}: mermaid 头类型错误，${fileName} 应使用 ${DIAGRAM_HEADER_HINT[fileName] || '规定的图类型'}`);
    }

    // 2. 按语法解析
    let parsed;
    if (/^C4(Context|Container|Component)/m.test(code)) {
      parsed = parseC4(code);
      allPathTokens.push(...extractC4Paths(code));
    } else if (/^classDiagram/m.test(code)) {
      parsed = parseClassDiagram(code);
    } else {
      parsed = parseFlowchart(code);
    }

    metrics.节点数 += parsed.nodeIds.length;
    metrics.边数 += parsed.edges.length;

    // 3. 幽灵端点：边引用了未声明的节点
    for (const id of parsed.undeclared) {
      issues.push(`${label}: 边引用未声明节点「${id}」——必须先声明该节点（Person/System/Container/Component/class/形状节点），再在 Rel/关系中引用`);
    }

    // 3b. 嵌套 subgraph：mermaid 会静默吞掉跨嵌套簇的边（不报错、图缺边），
    // 分层一律用扁平 subgraph（一个 subgraph 一层），禁止 subgraph 内再开 subgraph
    if (parsed.nested > 0) {
      issues.push(`${label}: 检测到 ${parsed.nested} 处嵌套 subgraph——subgraph 内再开 subgraph 时 mermaid 会静默丢弃跨簇边（图能渲染但缺边），请改为扁平分层（同级多个 subgraph，一个 subgraph 一层）`);
    }

    // flowchart 边标签不得含 ()[]{}（与 lintBlockDiagram 同口径）
    if (!/^C4(Context|Container|Component)/m.test(code) && !/^classDiagram/m.test(code)) {
      for (const lab of findUnsafeMermaidEdgeLabels(code)) {
        const fix = sanitizeMermaidEdgeLabel(lab);
        issues.push(
          `${label}: 边标签含 mermaid 形状保留字符 (): 「${lab}」——请改为「${fix || '短中文动宾'}」或去掉括号（否则整图 Syntax error）`
        );
      }
    }

    // 4. 孤儿节点：声明了但没有任何边连接（C4/class 图中孤立节点无意义）
    const connected = new Set();
    for (const e of parsed.edges) { connected.add(e.from); connected.add(e.to); }
    const orphans = parsed.nodeIds.filter((id) => !connected.has(id));
    // 边界节点（System_Boundary 等）和 Person 在 context 图中允许少量孤立
    const isBoundary = (id) => /boundary|platform|sys/i.test(id);
    const realOrphans = orphans.filter((id) => !isBoundary(id));
    if (realOrphans.length > 0 && parsed.nodeIds.length > 2) {
      // 仅当孤立节点超过总数 1/3 时报错（容忍 context 图中独立外部系统）
      if (realOrphans.length > parsed.nodeIds.length / 3) {
        issues.push(`${label}: ${realOrphans.length} 个节点无任何关系边（${realOrphans.slice(0, 5).join('、')}）——每个节点至少应有一条 Rel/关系边连接，否则从图中移除或补充关系`);
      }
    }

    // 5. 节点数按块检查
    if (parsed.nodeIds.length < nodeMin) {
      issues.push(`${label}: 节点过少（${parsed.nodeIds.length} 个，至少 ${nodeMin} 个）——视图内容不完整，请补充扫描到的真实组件/类/服务`);
    }
    if (parsed.nodeIds.length > nodeMax) {
      issues.push(`${label}: 节点过密（${parsed.nodeIds.length} 个，建议 ≤ ${nodeMax}）——请合并同类项或拆分到子图`);
    }
  }

  // 6. 路径核查：节点描述 / flowchart <small> 中引用的文件路径必须在代码树中存在
  if (tree) {
    const { checked: smallChecked } = verifyPaths(md, tree);
    const missing = [];
    const checked = new Set();
    for (const tok of [...allPathTokens, ...smallChecked]) {
      if (checked.has(tok)) continue;
      checked.add(tok);
      if (!pathMatchesTree(tok, tree)) missing.push(tok);
    }
    metrics.路径核查数 = checked.size;
    metrics.幻觉路径数 = missing.length;
    for (const p of missing) issues.push(`节点描述引用的路径在仓库中不存在: ${p}`);
  }

  return { issues, metrics };
}

// ---------- 层归属确定性闸门（路径关键词 → AGENT.md 层语义约定） ----------
const LAYER_RULES = [
  // tracker/recorder 是发到访客浏览器运行的采集脚本（umami src/tracker、src/recorder：rollup IIFE、
  // window/document/rrweb），属浏览器端前端资产，不是服务端 worker
  { key: 'frontend', re: /(^|\/)(templates|static|frontend|web|ui|public|assets|tracker|recorder)(\/|$)/i, titleRe: /前端|交互|展示/ },
  { key: 'api', re: /(flask_app|\/api\/|\/blueprint\/|routes?|controller|app\.py|main\.py|forms|auth_decorator)/i, titleRe: /api|后端|接口/ },
  { key: 'schedule', re: /(queue|schedul|custom_queue|queuedwatch|celery|cron)/i, titleRe: /调度|队列/ },
  // monitor 排在 worker 前：通知/实时关键词具专一性，避免「监控处理」标题被 worker 的「处理」抢占
  { key: 'monitor', re: /(notification|notify|realtime|socket|monitor|alert|observability|logging|apprise)/i, titleRe: /监控|通知|告警/ },
  { key: 'worker', re: /(worker|content_fetcher|processors?|\/diff|fetch|crawl|spider|tasks?|jobs?|browser_steps|playwright|selenium)/i, titleRe: /worker|采集|抓取|处理|异步/ },
  // queries 是数据访问层（如 umami src/queries/prisma，Prisma 查询封装），归存储层而非 API 层
  { key: 'storage', re: /(^|\/)(store|model|entity|entities|repository|repositories|db|migrations|schema|queries)(\/|$)|datastore/i, titleRe: /存储|数据|持久/ },
  { key: 'ops', re: /(dockerfile|docker-compose|compose\.ya?ml|k8s|kubernetes|deploy|\.github|ci\/|entrypoint|helm)/i, titleRe: /交付|运维|部署|ops/i }
];

// 解析每个 subgraph 的标题与其内节点 id
function parseLayers(code) {
  const layers = [];
  let cur = null;
  for (const rawLine of code.split(/\n/)) {
    const line = rawLine.trim();
    const sg = line.match(/^subgraph\s+[A-Za-z_][A-Za-z0-9_]*\["?(.+?)"?\]/);
    if (sg) { cur = { title: sg[1], nodes: [] }; layers.push(cur); continue; }
    if (/^end\b/.test(line)) { cur = null; continue; }
    if (!cur) continue;
    const dm = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[\[\(\{]/);
    if (dm) cur.nodes.push(dm[1]);
  }
  return layers;
}

// 节点 id → <small> 中的路径
function nodePaths(md) {
  const map = {};
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[\(|\[\(|\(\[|\[\(|\[|\(|\{)[^\n]*?<small>([\s\S]*?)<\/small>/g;
  let m;
  while ((m = re.exec(md))) {
    const tok = (m[2].match(/[A-Za-z0-9_./-]+\.(?:py|js|ts|html|ya?ml|sh|toml)/g) || [])[0] ||
                (m[2].match(/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]*/g) || [])[0];
    if (tok) map[m[1]] = tok.replace(/\/$/, '');
  }
  return map;
}

function layerGate(md) {
  const issues = [];
  const blocks = parseMermaid(md);
  const paths = nodePaths(md);
  for (const code of blocks) {
    const layers = parseLayers(code);
    for (const layer of layers) {
      const titleRule = LAYER_RULES.find((r) => r.titleRe.test(layer.title));
      for (const id of layer.nodes) {
        const p = paths[id];
        if (!p || p === '(外部)') continue;
        const expected = LAYER_RULES.find((r) => r.re.test(p));
        if (expected && titleRule && expected.key !== titleRule.key) {
          issues.push(`层归属错误: 节点 ${id} 路径 ${p} 应属 ${expected.key} 层，当前在「${layer.title}」`);
        }
      }
    }
  }
  return issues;
}

function snakeId(s) {
  return String(s || 'n')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36) || 'n';
}

function pickTreePath(tree, names, kind) {
  const pool = kind === 'dir' ? [...tree.dirs] : [...tree.files];
  for (const n of names) {
    const hits = pool.filter((p) => p === n || p.endsWith('/' + n));
    hits.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);
    if (hits[0]) return hits[0];
  }
  return null;
}

/** 签名子系统锚点：入口 / 队列 / worker / 抓取 / 存储 / 通知执行 / 交付。存在于树中才必选。 */
function findAnchors(tree) {
  const add = (role, layer, p, hint) => (p ? [{ role, layer, path: p, hint }] : []);
  return [
    ...add('entry', 'api', pickTreePath(tree, ['changedetection.py', 'flask_app.py', 'app.py', 'main.py', 'server.js', 'index.js'], 'file'), '进程入口'),
    ...add('flask', 'api', pickTreePath(tree, ['flask_app.py'], 'file'), 'Flask 应用'),
    ...add('queue', 'schedule', pickTreePath(tree, ['queue_handlers.py', 'custom_queue.py'], 'file'), '任务队列'),
    ...add('worker', 'worker', pickTreePath(tree, ['worker.py'], 'file'), '采集 Worker'),
    ...add('worker_pool', 'worker', pickTreePath(tree, ['worker_pool.py'], 'file'), 'Worker 池'),
    ...add('fetch', 'worker', pickTreePath(tree, ['content_fetchers'], 'dir') ||
      pickTreePath(tree, ['content_fetchers/playwright.py', 'content_fetchers/requests.py'], 'file'), '抓取器'),
    ...add('store', 'storage', pickTreePath(tree, ['store', 'datastore'], 'dir'), '数据存储'),
    ...add('notify_svc', 'monitor', pickTreePath(tree, ['notification_service.py'], 'file'), '通知执行服务'),
    ...add('notify_chan', 'monitor', pickTreePath(tree, ['notification'], 'dir'), '通知渠道/Apprise'),
    ...add('ui', 'frontend', pickTreePath(tree, ['changedetectionio/templates', 'templates'], 'dir'), '前端页面'),
    ...add('static', 'frontend', pickTreePath(tree, ['changedetectionio/static', 'static', 'public'], 'dir'), '静态资源'),
    ...add('ops', 'ops', pickTreePath(tree, ['docker-compose.yml', 'docker-compose.yaml', 'Dockerfile'], 'file'), '交付'),
    ...add('realtime', 'monitor', pickTreePath(tree, ['realtime'], 'dir'), '实时推送')
  ];
}

function coverageGate(md, anchors) {
  const hay = String(md || '');
  const missing = [];
  for (const a of anchors) {
    const base = path.basename(a.path);
    const hit = hay.includes(a.path) || (base.length > 3 && hay.includes(base));
    if (!hit) missing.push(a);
  }
  return missing;
}

function injectAnchors(plan, anchors) {
  if (!plan.layers) plan.layers = [];
  const existing = [];
  for (const l of plan.layers) {
    for (const n of l.nodes || []) existing.push(String(n.path || '').replace(/\/$/, ''));
  }
  const covered = (p) => {
    const norm = String(p).replace(/\/$/, '');
    return existing.some((e) => e === norm || e.endsWith(norm) || norm.endsWith(e) || e.includes(path.basename(norm)));
  };
  const LAYER_CN = {
    frontend: '前端 / 交互层', api: '后端 / API 层', schedule: '调度 / 队列层',
    worker: '采集 / Worker 层', storage: '数据 / 存储层', monitor: '监控 / 通知层', ops: '交付 / 运维层'
  };
  const LAYER_ICON = { frontend: '🖥️', api: '🔌', schedule: '⏱️', worker: '📥', storage: '💾', monitor: '🔔', ops: '🚀' };
  for (const a of anchors) {
    if (covered(a.path)) continue;
    let layer = plan.layers.find((l) => l.key === a.layer);
    if (!layer) {
      layer = { key: a.layer, cnName: LAYER_CN[a.layer] || a.layer, icon: LAYER_ICON[a.layer] || '', nodes: [] };
      plan.layers.push(layer);
    }
    if (!layer.nodes) layer.nodes = [];
    const id = snakeId(a.role + '_' + path.basename(a.path).replace(/\.[^.]+$/, ''));
    layer.nodes.push({
      id,
      cn: a.hint || a.role,
      path: a.path,
      tech: '',
      shape: a.layer === 'storage' ? 'cylinder' : 'node'
    });
    existing.push(a.path.replace(/\/$/, ''));
  }
  const order = ['frontend', 'api', 'schedule', 'worker', 'storage', 'monitor', 'ops'];
  plan.layers.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return plan;
}

function rewritePlanLayers(plan) {
  if (!plan || !Array.isArray(plan.layers)) return plan;
  const meta = {};
  const all = [];
  for (const layer of plan.layers) {
    meta[layer.key] = layer;
    for (const n of layer.nodes || []) all.push({ ...n, fromKey: layer.key });
  }
  const buckets = {};
  for (const n of all) {
    const expected = n.path && n.path !== '(外部)' ? LAYER_RULES.find((r) => r.re.test(n.path)) : null;
    const key = (expected && expected.key) || n.fromKey || 'api';
    if (!buckets[key]) {
      buckets[key] = {
        key,
        cnName: (meta[key] && meta[key].cnName) || key,
        icon: (meta[key] && meta[key].icon) || '',
        nodes: []
      };
    }
    buckets[key].nodes.push(n);
  }
  const order = ['frontend', 'api', 'schedule', 'worker', 'storage', 'monitor', 'ops'];
  plan.layers = order.filter((k) => buckets[k] && buckets[k].nodes.length).map((k) => buckets[k]);
  return plan;
}

// 基础设施/外部系统名词（用于把误挂 compose 路径的外部节点改写为 (外部)）
const INFRA_WORDS = /(postgres|postgre|mysql|mariadb|redis|kafka|rabbit|clickhouse|mongo(database|db)?|smtp|mailgun|sendgrid|mailjet|ses|elastic(search)?|minio|\bs3\b|nats|mqtt|nginx|traefik|prometheus|grafana|apprise|discord|slack|telegram|gotify|ntfy|pushover|webhook)/i;

/**
 * 计划确定性修复：
 * 1) 外部基础设施节点把 docker-compose.yml/Dockerfile 当 path（与 ops 撞路径）→ 改写 (外部)
 * 2) 树中不存在且名词像基础设施的节点 → (外部)
 * 3) 同路径重复节点 → 保留第一个，其余删除并重映射边
 */
function repairPlan(plan, tree) {
  if (!plan || !Array.isArray(plan.layers)) return plan;
  const all = [];
  for (const l of plan.layers) for (const n of l.nodes || []) all.push(n);

  const pathExists = (p) => {
    if (!p || p === '(外部)') return true;
    const norm = String(p).replace(/\/$/, '');
    return tree.all.has(norm) || tree.all.has(p) ||
      [...tree.all].some((x) => x === norm || x.startsWith(norm + '/') || x.startsWith(norm + '.'));
  };

  for (const n of all) {
    if (!n.path || n.path === '(外部)' || n.actor) continue;
    const words = `${n.cn || ''} ${n.tech || ''} ${n.id || ''}`;
    const looksInfra = INFRA_WORDS.test(words);
    const pointsAtCompose = /(docker-compose|compose\.ya?ml|Dockerfile|docker\/)/i.test(n.path);
    if (looksInfra && (pointsAtCompose || !pathExists(n.path))) {
      n.path = '(外部)';
      n.external = true;
    }
  }

  const keep = new Map();
  const remap = new Map();
  for (const n of all) {
    if (!n.path || n.path === '(外部)') continue;
    const norm = String(n.path).replace(/\/$/, '');
    if (keep.has(norm)) remap.set(n.id, keep.get(norm).id);
    else keep.set(norm, n);
  }
  if (remap.size) {
    for (const l of plan.layers) l.nodes = (l.nodes || []).filter((n) => !remap.has(n.id));
    for (const e of plan.edges || []) {
      if (remap.has(e.from)) e.from = remap.get(e.from);
      if (remap.has(e.to)) e.to = remap.get(e.to);
    }
    plan.edges = (plan.edges || []).filter((e) => e.from !== e.to);
    const seen = new Set();
    plan.edges = plan.edges.filter((e) => {
      const k = `${e.from}->${e.to}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }
  return plan;
}

function semanticTraps(md) {
  const issues = [];
  if (/-->\|[^|]*通知[^|]*\|\s*api_notifications/i.test(md) ||
      /触发通知[\s\S]{0,120}Notifications\.py/i.test(md)) {
    issues.push('禁止把 api/Notifications.py（配置 API）当成通知执行器；应连到 notification_service.py 或 notification/');
  }
  return issues;
}

// ---------- orch4：重要性取证（主干 vs 旁路，确定性） ----------

const SRC_EXT = /\.(py|js|mjs|cjs|ts|tsx|jsx|go|rs|java)$/;

function readSafe(root, rel) {
  try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; }
}

/** 解析单个源文件的本地 import 目标（返回仓库内相对路径候选），跨 py/js/ts/go。 */
function localImports(root, rel, content, tree) {
  const out = new Set();
  const dir = path.dirname(rel);
  const ext = path.extname(rel);

  const resolveRel = (spec) => {
    // 相对路径：./x ../x → 尝试多种后缀/index
    const base = path.normalize(path.join(dir, spec));
    const cands = [
      base, base + '.py', base + '.js', base + '.ts', base + '.tsx', base + '.jsx', base + '.mjs',
      path.join(base, 'index.js'), path.join(base, 'index.ts'), path.join(base, '__init__.py')
    ];
    for (const c of cands) if (fs.existsSync(path.join(root, c))) { out.add(c.split(path.sep).join('/')); return; }
  };

  if (ext === '.py') {
    const modRoots = [];
    for (const top of fs.readdirSync(root, { withFileTypes: true })) {
      if (top.isDirectory() && !top.name.startsWith('.') && !SKIP_DIRS.has(top.name)) modRoots.push(top.name);
    }
    let m;
    const reFrom = /^\s*from\s+(\.+)?([\w.]*)\s+import\s+/gm;
    while ((m = reFrom.exec(content))) {
      const dots = m[1] ? m[1].length : 0;
      const mod = m[2] || '';
      if (dots > 0) {
        // 相对导入：基于当前文件包目录上溯 dots-1 级
        let d = dir;
        for (let i = 1; i < dots; i++) d = path.dirname(d);
        const base = mod ? path.join(d, mod.split('.').join('/')) : d;
        [base, base + '.py', path.join(base, '__init__.py')].forEach((c) => {
          const cc = c.split(path.sep).join('/');
          if (fs.existsSync(path.join(root, cc))) out.add(cc);
        });
      } else if (mod) {
        const parts = mod.split('.');
        for (let len = parts.length; len >= 1; len--) {
          const c = parts.slice(0, len).join('/');
          if (fs.existsSync(path.join(root, c + '.py'))) { out.add(c + '.py'); break; }
          if (fs.existsSync(path.join(root, c, '__init__.py'))) { out.add((c + '/__init__.py').split(path.sep).join('/')); break; }
        }
      }
    }
    const reImp = /^\s*import\s+([\w.]+)/gm;
    while ((m = reImp.exec(content))) {
      const parts = m[1].split('.');
      for (let len = parts.length; len >= 1; len--) {
        const c = parts.slice(0, len).join('/');
        if (fs.existsSync(path.join(root, c + '.py'))) { out.add(c + '.py'); break; }
        if (fs.existsSync(path.join(root, c, '__init__.py'))) { out.add((c + '/__init__.py').split(path.sep).join('/')); break; }
      }
    }
  } else if (ext === '.java') {
    // Java: import com.example.foo.Bar; → src/main/java/com/example/foo/Bar.java
    // 通配 import com.example.foo.*; → src/main/java/com/example/foo/ (包目录)
    const javaRoots = [];
    for (const r of ['src/main/java', 'app/src/main/java', 'src']) {
      if (fs.existsSync(path.join(root, r))) javaRoots.push(r);
    }
    let m;
    const re = /^\s*import\s+(?:static\s+)?([\w.]+)(\.\*)?\s*;/gm;
    while ((m = re.exec(content))) {
      const fqcn = m[1];
      const isWildcard = !!m[2];
      const parts = fqcn.split('.');
      if (isWildcard) {
        const rel = parts.join('/');
        for (const jr of javaRoots) {
          const d = jr + '/' + rel;
          if (fs.existsSync(path.join(root, d))) { out.add(d + '/'); break; }
        }
      } else {
        // 最后一段是类名，前面是包路径
        const className = parts[parts.length - 1];
        const pkgPath = parts.slice(0, -1).join('/');
        for (const jr of javaRoots) {
          const f = jr + '/' + pkgPath + '/' + className + '.java';
          if (fs.existsSync(path.join(root, f))) { out.add(f); break; }
        }
      }
    }
  } else if (ext === '.go') {
    let modName = '';
    const gomod = readSafe(root, 'go.mod');
    if (gomod) { const mm = gomod.match(/^module\s+(\S+)/m); if (mm) modName = mm[1]; }
    let m;
    const re = /"([^"]+)"/g;
    const block = content.slice(content.indexOf('import'));
    while ((m = re.exec(block))) {
      const spec = m[1];
      if (spec.startsWith('.')) { resolveRel(spec); continue; }
      const rel2 = modName && spec.startsWith(modName + '/') ? spec.slice(modName.length + 1) : null;
      if (rel2) {
        for (const c of [rel2, path.join(rel2, path.basename(rel2) + '.go')]) {
          if (fs.existsSync(path.join(root, c))) { out.add(c.split(path.sep).join('/')); break; }
        }
        // 包目录：目录下任意 .go 即视为目标目录
        if (fs.existsSync(path.join(root, rel2))) out.add(rel2 + '/');
      }
    }
  } else if (ext === '.rs') {
    // Rust：use crate::mod::sub; use super::x; use self::x; mod xxx;
    // 粗粒度的可达性：按路径归一化到 crate 根 src/，mod 声明 = 子文件或子目录/mod.rs
    let base = dir;
    const crateRoot = tree.files.has('src/main.rs') || tree.files.has('src/lib.rs') ? 'src' : '';
    // mod 声明
    const modRe = /^\s*(?:pub\s+)?(?:crate\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gm;
    let m;
    while ((m = modRe.exec(content))) {
      const sub = m[1];
      // 1) dir/sub.rs  2) dir/sub/mod.rs
      const cands = [path.join(base, sub + '.rs'), path.join(base, sub, 'mod.rs')];
      for (const c of cands) {
        const cc = c.split(path.sep).join('/');
        if (fs.existsSync(path.join(root, cc))) { out.add(cc); break; }
      }
    }
    // use 语句的本 crate 路径：use crate::a::b -> src/a/b.rs 或 src/a/b/mod.rs
    const useRe = /^\s*(?:pub\s+)?use\s+crate::([A-Za-z0-9_:]+)/gm;
    while ((m = useRe.exec(content))) {
      const parts = m[1].split(':').filter(Boolean);
      if (!parts.length || !crateRoot) continue;
      for (let len = parts.length; len >= 1; len--) {
        const rel = crateRoot + '/' + parts.slice(0, len).join('/');
        const cands = [rel + '.rs', rel + '/mod.rs'];
        let hit = false;
        for (const c of cands) if (fs.existsSync(path.join(root, c))) { out.add(c); hit = true; break; }
        if (hit) break;
      }
    }
    const useSuper = /^\s*(?:pub\s+)?use\s+((?:super::)+)([A-Za-z0-9_:]*)/gm;
    while ((m = useSuper.exec(content))) {
      const levels = (m[1].match(/super/g) || []).length;
      let d = dir;
      for (let i = 0; i < levels; i++) d = path.dirname(d);
      const parts = (m[2] || '').split(':').filter(Boolean);
      for (let len = parts.length; len >= 1; len--) {
        const rel = (d ? d + '/' : '') + parts.slice(0, len).join('/');
        const cands = [rel + '.rs', rel + '/mod.rs'];
        let hit = false;
        for (const c of cands) if (fs.existsSync(path.join(root, c))) { out.add(c); hit = true; break; }
        if (hit) break;
      }
    }
  } else {
    // js/ts：require('...') / import ... from '...'（含 tsconfig path alias，如 @/ → src/）
    let m;
    const re = /(?:require\(\s*|from\s*|import\(\s*)['"]([^'"]+)['"]/g;
    const aliasMap = aliasMapFor(loadTsAliases(root), rel);
    while ((m = re.exec(content))) {
      const spec = m[1];
      if (spec.startsWith('.')) { resolveRel(spec); continue; }
      for (const [pre, target] of aliasMap) {
        if (spec === pre || spec.startsWith(pre + '/')) {
          const rest = spec.slice(pre.length).replace(/^\//, '');
          const base = path.join(target, rest).split(path.sep).join('/');
          const cands = [base, base + '.ts', base + '.tsx', base + '.js', base + '.jsx', base + '.mjs',
            path.join(base, 'index.ts'), path.join(base, 'index.tsx'), path.join(base, 'index.js')].map((c) => c.split(path.sep).join('/'));
          for (const c of cands) {
            if (fs.existsSync(path.join(root, c))) {
              if (fs.statSync(path.join(root, c)).isDirectory()) out.add(c + '/');
              else out.add(c);
              break;
            }
          }
        }
      }
    }
  }
  return [...out];
}

const _aliasCache = new Map();
/**
 * 读取仓库内所有 tsconfig/jsconfig 的 compilerOptions.paths（如 @/* → src/*），按仓库缓存。
 * 前端工程常为嵌套目录（web/tsconfig.json、frontend/tsconfig.json），baseUrl 相对该配置目录，
 * target 统一换算成「仓库根相对路径」。返回 [{ dir: 配置所在目录('' 为根), map: prefix→target }]，
 * 调用方按导入文件所在位置选最深匹配配置。
 */
function loadTsAliases(root) {
  if (_aliasCache.has(root)) return _aliasCache.get(root);
  const configs = [];
  _aliasCache.set(root, configs);
  // 深度 ≤3 收集所有 tsconfig/jsconfig（跳过 node_modules/dist 等）
  const cfgFiles = [];
  const scanCfg = (dir, depth) => {
    if (depth > 3) return;
    let ents;
    try { ents = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const rel = dir ? dir + '/' + e.name : e.name;
      if (!e.isDirectory() && /^(tsconfig|jsconfig)(\.[\w-]+)?\.json$/.test(e.name)) {
        // 跳过 tsconfig.node.json / tsconfig.test.json 等非主配置里的 paths（主配置才有 paths）
        cfgFiles.push(rel);
      } else if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) {
        scanCfg(rel, depth + 1);
      }
    }
  };
  scanCfg('', 0);
  for (const f of cfgFiles) {
    const txt = readSafe(root, f);
    if (!txt || !/"paths"\s*:/.test(txt)) continue;
    const cfgDir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
    let baseUrl = '.';
    let paths = null;
    try {
      const cfg = JSON.parse(txt.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/,\s*([}\]])/g, '$1'));
      const co = cfg.compilerOptions || {};
      baseUrl = co.baseUrl || '.';
      paths = co.paths || null;
    } catch { /* JSONC 解析失败，走正则兜底 */ }
    if (!paths) {
      const bm = txt.match(/"baseUrl"\s*:\s*"([^"]+)"/);
      if (bm) baseUrl = bm[1];
      const pm = txt.match(/"paths"\s*:\s*\{([\s\S]*?)\}/);
      if (pm) {
        paths = {};
        const re = /"([^"]+)"\s*:\s*\[?\s*"([^"]+)"/g;
        let m;
        while ((m = re.exec(pm[1]))) paths[m[1]] = [m[2]];
      }
    }
    const map = new Map();
    for (const [k, vals] of Object.entries(paths || {})) {
      const target = String(Array.isArray(vals) ? vals[0] : vals).replace(/\*$/, '').replace(/\/$/, '');
      const pre = k.replace(/\*$/, '').replace(/\/$/, '');
      const absTarget = path.join(cfgDir, baseUrl, target).split(path.sep).join('/').replace(/\/$/, '');
      map.set(pre, absTarget);
    }
    if (map.size) configs.push({ dir: cfgDir, map });
  }
  return configs;
}

/** 按导入文件位置选最深匹配的 alias 配置（根配置兜底） */
function aliasMapFor(aliasConfigs, rel) {
  let best = null;
  for (const c of aliasConfigs) {
    if (c.dir === '' || rel.startsWith(c.dir + '/')) {
      if (!best || c.dir.length > best.dir.length) best = c;
    }
  }
  return best ? best.map : new Map();
}

function buildImportGraph(root, tree) {
  const edges = [];
  const files = [...tree.files].filter((f) => SRC_EXT.test(f));
  for (const f of files) {
    const content = readSafe(root, f);
    if (!content) continue;
    for (const t of localImports(root, f, content, tree)) {
      if (t !== f) edges.push({ from: f, to: t });
      // Go/包导入：目标是目录（包）时，包内所有源文件视为同一可达单元
      // （Go 同包文件间无 import 边；Python __init__ 同理），补 目录→包内文件 隐式边
      if (t.endsWith('/')) {
        const prefix = t;
        for (const sib of tree.files) {
          if (sib.startsWith(prefix) && SRC_EXT.test(sib) && !/_test\.|__tests__|\.test\.|\.spec\./.test(sib)) {
            edges.push({ from: t, to: sib });
          }
        }
      }
    }
  }

  // ===== 编译产物→源码 桥接：JS 入口（index.js / CLI）仅 require dist/ 或 build/，源码在 lib/**/*.ts =====
  // zigbee2mqtt 模式：package.json main=index.js，index.js 只引用 dist/，真实代码是 lib/controller.ts 等
  for (const pkgFile of tree.files) {
    if (!/(^|\/)package\.json$/.test(pkgFile)) continue;
    const pkgDir = pkgFile.includes('/') ? pkgFile.slice(0, pkgFile.lastIndexOf('/')) : '';
    const dep = pkgDir.split('/').length;
    if (dep > 3) continue;
    const pkg = (() => { try { return JSON.parse(readSafe(root, pkgFile) || ''); } catch { return null; } })();
    if (!pkg) continue;
    const mains = [];
    if (pkg.main) mains.push(path.posix.join(pkgDir, String(pkg.main)));
    if (pkg.bin) {
      const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin);
      for (const b of bins) if (b) mains.push(path.posix.join(pkgDir, String(b)));
    }
    const sourceDirs = [];
    for (const cand of ['lib', 'src', 'source']) {
      const p = pkgDir ? pkgDir + '/' + cand : cand;
      if (tree.dirs.has(p)) sourceDirs.push(p);
    }
    for (const entry of mains) {
      if (!tree.files.has(entry)) continue;
      // 入口引用了编译产物目录（dist/build/out），把桥接边补到同根的源码目录
      const entContent = readSafe(root, entry) || '';
      const refsBuild = /require\(["']\.\.?\/[^"']*dist|from\s+["']\.\.?\/[^"']*dist|exec\([^)]*node_modules|path\.join\(__dirname,\s*["']dist/.test(entContent);
      if (!refsBuild && !/\bdist\b|__dirname.*hashFile|setSourceMapsEnabled/.test(entContent)) continue;
      for (const sd of sourceDirs) {
        // 入口 -> 源码目录顶层文件，让 BFS 可以继续往里走
        for (const sf of tree.files) {
          if (!sf.startsWith(sd + '/') || !SRC_EXT.test(sf)) continue;
          // 只连顶层关键文件（非目录嵌套深度 ≤ sd 深度 + 1），避免 1:N 爆边
          const rest = sf.slice(sd.length + 1);
          if (rest.includes('/')) continue;
          edges.push({ from: entry, to: sf });
        }
        // 目录桥：入口 -> 源码目录（让目录级热度传导）
        edges.push({ from: entry, to: sd + '/' });
      }
    }
  }

  // ===== Rust 同 crate 同目录兄弟文件隐式边（像 Go 一样，同一目录所有 .rs 符号共享）=====
  const rsSiblings = new Map();
  for (const f of tree.files) {
    if (!f.endsWith('.rs')) continue;
    if (/\.spec\.rs|_test\.rs$/.test(f)) continue;
    const d = path.posix.dirname(f);
    if (!rsSiblings.has(d)) rsSiblings.set(d, []);
    rsSiblings.get(d).push(f);
  }
  // 同目录文件之间互相连：每包一个代表文件 -> 所有兄弟的星型，避免 N^2
  for (const [dir, sibs] of rsSiblings) {
    if (sibs.length < 2) continue;
    const rep = sibs.find(s => /(main|lib)\.rs$/.test(s)) || sibs[0];
    for (const s of sibs) if (s !== rep) edges.push({ from: rep, to: s });
  }

  return { edges, files };
}

/** 可选性检测：compose profiles / feature flag 环境变量 / 插件目录 / 外部 key 依赖 / README「optional」共现。 */
// 框架/安全/通用设置词：即使命中 *_ENABLED 也不是「可选组件」（如 LOGIN_ENABLED、WTF_CSRF_ENABLED）
const OPTIONAL_STOP = new Set([
  'login', 'logout', 'signin', 'signup', 'register', 'registration', 'auth', 'oauth', 'oidc', 'saml', 'ldap', 'jwt',
  'csrf', 'wtf', 'cors', 'tls', 'ssl', 'https', 'gzip', 'compression', 'cache', 'caching', 'cookie', 'session',
  'debug', 'demo', 'seed', 'test', 'dev', 'prod', 'maintenance', '2fa', 'totp', 'mfa', 'recaptcha', 'captcha',
  'sentry', 'telemetry', 'health', 'auto', 'update', 'upgrade', 'watchtower', 'secure', 'security',
  'password', 'rate_limit', 'ratelimit', 'metrics', 'pprof', 'image', 'upload', 'export', 'import',
  'backup', 'cron', 'i18n', 'locale', 'email_verified', 'verify', 'hsts', 'trusted'
]);
// 按性质「需要额外部署/付费 key 才启用」的组件：仅凭命名即可判可选
const OPTIONAL_INFRA = new Set([
  'kafka', 'rabbitmq', 'nats', 'pulsar', 'sqs', 'snssqs', 'pubsub',
  'elasticsearch', 'opensearch', 'meilisearch', 'typesense', 'manticore',
  's3', 'minio', 'oss', 'gcs', 'azureblob',
  'openai', 'anthropic', 'gemini', 'ollama', 'deepseek', 'llm', 'ai', 'stt', 'ocr', 'embedding'
]);

function detectOptional(root, tree) {
  const optional = new Map(); // 关键词(小写) → 证据
  const flag = (kw, reason) => {
    const k = String(kw).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!k || OPTIONAL_STOP.has(k)) return;
    if (!optional.has(k)) optional.set(k, reason);
  };
  // 仓库真实路径段（目录名 / 文件名主干）：flag 词必须对应真实组件，否则只是框架开关
  const pathSegs = new Set();
  for (const d of tree.dirs) pathSegs.add(d.split('/').pop().toLowerCase());
  for (const f of tree.files) pathSegs.add(f.split('/').pop().toLowerCase().replace(/\.[^.]+$/, ''));
  const isComponent = (comp) => {
    if (OPTIONAL_INFRA.has(comp)) return true;
    if (pathSegs.has(comp)) return true;
    return comp.split(/[_-]/).some((seg) => seg.length >= 4 && pathSegs.has(seg) && !OPTIONAL_STOP.has(seg));
  };

  // 1) docker-compose profiles
  for (const f of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml']) {
    const txt = readSafe(root, f);
    if (!txt) continue;
    const lines = txt.split(/\n/);
    let curSvc = null;
    let inProfiles = false;
    for (const line of lines) {
      const svc = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/);
      if (svc) { curSvc = svc[1]; inProfiles = false; continue; }
      if (/profiles:/.test(line) && curSvc) { flag(curSvc, `compose ${f} 中 ${curSvc} 带 profiles（默认不启动）`); inProfiles = true; continue; }
      if (inProfiles && /^ {4,}-?\s*\S+/.test(line)) continue;
      inProfiles = false;
    }
  }

  // 2) 路径信号：插件/集成/示例目录
  for (const d of tree.dirs) {
    const m = d.match(/(^|\/)(plugins?|addons?|integrations?|examples?|optional|extras?|contrib)(\/|$)/i);
    if (m) flag(m[2], `目录 ${d} 属插件/集成/示例区，非默认主链路`);
  }

  // 3) feature flag 环境变量：XXX_ENABLED / ENABLE_XXX / USE_XXX
  const flagHits = new Map(); // 组件词 → 出现次数
  // 3b) 基础设施 client 显式开关：同一行内 enabled/optional 与 process.env.<INFRA>_URL|BROKER|HOST...
  const gateHits = new Map();
  // 3c) AI/LLM 外部 key 依赖：provider 名与 apiKey 同文件共现
  const aiKeyHits = new Set();
  const GATE_INFRA = /\b(kafka|rabbitmq|nats|pulsar|sqs|snssqs|redis|elasticsearch|opensearch|meilisearch|typesense|s3|minio|mariadb|mysql|postgres(?:ql)?|mssql|clickhouse)\b/gi;
  // 环境变量名里的通用词/动作词：不是组件（如 UPTIME_KUMA_DISABLE_FRAME_SAMEORIGIN）
  const GENERIC_FLAG_TOK = new Set([
    'enable', 'enabled', 'disable', 'disabled', 'use', 'using', 'used', 'embedded', 'external', 'internal',
    'frame', 'sameorigin', 'allow', 'force', 'default', 'mode', 'type', 'feature', 'features', 'support',
    'config', 'setting', 'settings', 'option', 'options', 'with', 'without', 'remote', 'local', 'custom'
  ]);
  // 仓库名本身的词根（uptime-kuma → uptime/kuma）：出现在变量名里不是组件
  const prodToks = new Set(path.basename(root).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
  /** 从 ENABLE_XXX / XXX_ENABLED 变量名提取真实组件词（分词后逐词校验） */
  const flagTokens = (varName) => {
    const out = [];
    for (const t of varName.toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length < 3 || OPTIONAL_STOP.has(t) || GENERIC_FLAG_TOK.has(t) || prodToks.has(t)) continue;
      if (isComponent(t)) out.push(t);
    }
    return out;
  };
  for (const f of tree.files) {
    if (!SRC_EXT.test(f) && !/\.(yml|yaml|env|example|md|toml|json)$/.test(f)) continue;
    const content = readSafe(root, f);
    if (!content) continue;
    let m;
    const re = /(?:process\.env|os\.environ|getenv|ENV\[|config\.|getConfig\()?[.\s]*['"]?([A-Z][A-Z0-9_]*(?:ENABLE|ENABLED|DISABLE|USE_KAFKA|KAFKA_ENABLED)[A-Z0-9_]*)['"]?/g;
    while ((m = re.exec(content))) {
      for (const t of flagTokens(m[1])) flagHits.set(t, (flagHits.get(t) || 0) + 1);
    }
    // kafka/ai 等组件名与 enable 开关在同一行出现
    const re2 = /(kafka|rabbitmq|nats|redis-stream|openai|anthropic|gemini|llm|ai-?feature)[^\n]{0,60}(enable|optional|disabled?|default.{0,10}false)|(enable|optional)[^\n]{0,60}(kafka|rabbitmq|nats|openai|anthropic|gemini|llm)/ig;
    while ((m = re2.exec(content))) {
      const comp = (m[1] || m[4] || '').toLowerCase();
      if (comp && isComponent(comp)) flagHits.set(comp, (flagHits.get(comp) || 0) + 1);
    }
    // 3b) 逐行：enabled 判定 + 环境变量 + 基础设施组件名
    for (const line of content.split(/\n/)) {
      if (!/enabled?|optional|isEnabled/i.test(line)) continue;
      if (!/process\.env|os\.environ|getenv|ENV\[/.test(line)) continue;
      const g = line.match(GATE_INFRA);
      if (g) for (const name of g) gateHits.set(name.toLowerCase(), (gateHits.get(name.toLowerCase()) || 0) + 1);
    }
    // 3c) AI provider 需要外部 apiKey（管理后台配置/环境变量），代码里不配置就不工作
    if (/(openai|anthropic|gemini|ollama|deepseek)/i.test(content) && /api[_\s-]?key|apikey|secret[_\s-]?key/i.test(content)) {
      const mm = content.match(/(openai|anthropic|gemini|ollama|deepseek)/i);
      if (mm) { aiKeyHits.add(mm[1].toLowerCase()); aiKeyHits.add('ai'); }
    }
  }
  for (const [comp, n] of flagHits) {
    if (OPTIONAL_STOP.has(comp) || !isComponent(comp)) continue;
    flag(comp, `源码/配置中 ${comp} 受开关控制（feature flag 命中 ${n} 次），非默认启用`);
  }
  for (const [comp, n] of gateHits) {
    flag(comp, `源码中 ${comp} 客户端由环境变量门控（enabled 判定命中 ${n} 次），未配置即不启用`);
  }
  for (const comp of aiKeyHits) {
    flag(comp, `AI 能力依赖外部 API Key（${comp}），未配置则不可用，属按需启用`);
  }

  // 4) README「optional/可选」共现
  const readme = readMeText(root);
  const optRe = /(optional|optionally|opt-in|if you want|you can enable|可选|按需启用)[^\n]{0,120}/gi;
  let m;
  while ((m = optRe.exec(readme))) {
    const seg = m[0].toLowerCase();
    for (const kw of ['kafka', 'rabbitmq', 'nats', 'redis', 'ai', 'openai', 'ollama', 's3', 'minio', 'elasticsearch', 'prometheus', 'grafana']) {
      // 词边界：'ai' 不得命中 'available'/'email'/'main'
      const re = new RegExp('(^|[^a-z0-9])' + kw + '([^a-z0-9]|$)');
      if (re.test(seg)) flag(kw, `README 将 ${kw} 描述为 optional/可选`);
    }
  }
  return optional;
}

function readMeText(root) {
  return readSafe(root, 'README.md') || '';
}

/**
 * 框架约定入口 + 前端根发现：
 * - Next.js/Nuxt/SvelteKit 的约定路由文件（route.ts、+server.ts、server/api）由框架加载，不走 import 图，
 *   必须作为 BFS 起点，否则整个 API 层误判为「不可达」
 * - 前端工程（react/vue/next/nuxt/vite/svelte）的 main.tsx/main.js 等入口同样加入，
 *   否则前端目录从后端入口永远不可达，被误报为旁路
 * 返回 { starts: 文件集合, feRoots: 前端根目录（'' 表示仓库根） }
 */
function frameworkEntrypoints(root, tree) {
  const starts = new Set();
  const add = (f) => { if (tree.files.has(f)) starts.add(f); };
  // 1) 约定路由与页面（服务端入口 + 前端框架入口，均由框架加载，不走 import 图）
  for (const f of tree.files) {
    if (/(^|\/)(src\/)?app\/.*\/route\.(ts|js)$/.test(f)) add(f);           // Next App Router API
    else if (/(^|\/)(src\/)?pages\/api\/.*\.(ts|js)$/.test(f)) add(f);        // Next Pages Router API
    else if (/(^|\/)server\/(api|routes)\/.*\.(ts|js)$/.test(f)) add(f);      // Nuxt/Nitro
    else if (/\+server\.(ts|js)$/.test(f)) add(f);                            // SvelteKit
    else if (/(^|\/)(src\/)?routes\/.*\.(go|rb|php)$/.test(f)) add(f);        // 传统框架路由文件
    else if (/(^|\/)(src\/)?app\/.*\/page\.(tsx|jsx|ts|js)$/.test(f)) add(f); // Next App Router 页面
    else if (/(^|\/)(src\/)?pages\/(?!api\/).*\.(tsx|jsx|vue)$/.test(f)) add(f); // Next Pages / Nuxt 页面
  }
  // 2) 前端工程根：package.json 深度 ≤3 且依赖前端框架
  const feRoots = [];
  for (const f of tree.files) {
    if (!/(^|\/)package\.json$/.test(f)) continue;
    const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
    if (dir.split('/').length > 3) continue;
    let pkg = null;
    try { pkg = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')); } catch { continue; }
    // 精确包名匹配：'vite' 不得命中 'vitest'（z2m 教训：测试框架子串把整仓误判为前端工程）
    const FE_DEP_RE = /^(next|react|react-dom|vue|nuxt|nuxt3|vite|@sveltejs\/kit|svelte|webpack|parcel|quasar|@angular\/core|@angular\/common)$/;
    const depNames = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
    if (depNames.some((d) => FE_DEP_RE.test(d))) {
      if (!feRoots.includes(dir)) feRoots.push(dir);
    }
  }
  // 3) 各前端根的构建入口
  const FE_ENTRIES = [
    'src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js',
    'src/index.tsx', 'src/index.jsx', 'src/index.ts', 'src/index.js',
    'main.tsx', 'main.jsx', 'main.ts', 'main.js',
    'index.tsx', 'index.jsx',
    'app/layout.tsx', 'app/layout.jsx', 'src/app/layout.tsx',
    'pages/_app.tsx', 'pages/_app.jsx', 'src/pages/_app.tsx',
    'src/App.tsx', 'src/App.jsx', 'App.tsx', 'App.jsx'
  ];
  for (const r of feRoots) {
    for (const cand of FE_ENTRIES) add(r ? r + '/' + cand : cand);
  }
  return { starts, feRoots };
}

/** 路径是否属于前端代码（用于阻止前端 api client / 通知组件 / 前端构建入口污染后端角色锚点） */
function isFrontendPath(p, feRoots) {
  for (const r of feRoots || []) {
    const inRoot = r === '' ? !/^(server|cmd|internal|backend|worker|workers|app\/server)\//.test(p) : p.startsWith(r + '/');
    if (!inRoot) continue;
    // 服务端约定路由不算前端
    if (/(^|\/)(app|pages)\/api\//.test(p) || /(^|\/)server\/(api|routes)\//.test(p)) return false;
    if (/route\.(ts|js)$/.test(p) || /\+server\.(ts|js)$/.test(p)) return false;
    // 前端构建入口（vite/webpack 的 src/main.js、index.tsx 等）不是后端进程入口
    if (/(^|\/)(src\/)?(main|index|app)\.(jsx?|tsx?|vue)$/.test(p) && !/(^|\/)(server|cmd|internal|backend)\//.test(p)) return true;
    // 典型前端目录（tracker/recorder：发到访客浏览器运行的采集/录制脚本，如 umami src/tracker、src/recorder）
    if (/(^|\/)(components|pages|views|templates|hooks|mixins|layouts|assets|public|static|styles?|ui|router|store\/(modules)?|src\/api|src\/store|tracker|recorder)(\/|$)/.test(p)) return true;
    // 独立前端仓目录（web/、frontend/ 等）默认前端
    if (r !== '') return true;
  }
  return false;
}

/**
 * 重要性取证：每个仓库内路径的 heat（被 import 入度）、reachable（入口 BFS 可达）、optional。
 * 目录热度 = 目录内文件热度之和。
 */
/**
 * 「默认不启动/不随主链路交付」的权威可选证据理由：
 *  1) compose profiles 显式标记的服务；2) 插件/集成/示例目录中的代码。
 * 其余证据（feature flag、env 门控、AI Key、README 描述）只门控运行时行为/外部依赖，
 * 不能把随默认产物部署的代码节点判成可选组件。可达路径仅承认权威证据。
 */
const AUTHORITATIVE_OPTIONAL_RE = /profiles（默认不启动）|插件\/集成\/示例区/;

/**
 * 默认部署服务词元：cmd/<svc>/main.go（Go）、crates/<svc>/src/main.rs（Rust）、
 * docker-compose 中不带 profiles 的服务名，分词后去掉产品名词与通用词。
 * 用途：feature-flag 证据（如 openim 的 PUSH_ENABLE）门控的是服务「内部行为/外部渠道」
 * （FCM/APNs 推送渠道），不是服务进程本身——openim-push 有独立 cmd 入口且默认部署，
 * 不得因名字撞上 ENABLE 开关被判为可选组件（跨图一致性：c4-container 视其为标准 Container）。
 */
function coreServiceTokens(root, tree) {
  const toks = new Set();
  const prodToks = new Set(path.basename(root).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
  const STOP = new Set(['api', 'server', 'app', 'main', 'web', 'service', 'svc', 'cmd', 'cmdutils',
    'util', 'utils', 'common', 'tools', 'tool', 'v1', 'v2', 'v3', 'core', 'base', 'srv']);
  const add = (name) => {
    for (const t of String(name).toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length < 3 || prodToks.has(t) || STOP.has(t)) continue;
      toks.add(t);
    }
  };
  // Go/Rust 进程入口目录（cmd/<svc>/main.go、crates/<svc>/src/main.rs）
  for (const f of tree.files) {
    const m = f.match(/^cmd\/([^/]+)\/main\.go$/) || f.match(/^crates\/([^/]+)\/src\/main\.rs$/);
    if (m) add(m[1]);
  }
  // docker-compose 服务：带 profiles 的是「默认不启动」，排除（权威可选信号）
  for (const f of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    const txt = readSafe(root, f);
    if (!txt) continue;
    let inServices = false, curSvc = null, inProfiles = false;
    const profileSvc = new Set();
    const services = [];
    for (const line of txt.split(/\n/)) {
      if (/^services:\s*$/.test(line)) { inServices = true; continue; }
      if (inServices && /^[a-zA-Z]/.test(line)) break; // 顶级新段，services 块结束
      if (!inServices) continue;
      const svc = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/);
      if (svc) { curSvc = svc[1]; inProfiles = false; services.push(curSvc); continue; }
      if (curSvc && /^\s{4}profiles:/.test(line)) { profileSvc.add(curSvc); inProfiles = true; continue; }
      if (inProfiles && /^ {6,}\S/.test(line)) continue;
      inProfiles = false;
    }
    for (const s of services) if (!profileSvc.has(s)) add(s);
  }
  return toks;
}

function importanceForensics(root, tree, entrypoints) {
  const { edges } = buildImportGraph(root, tree);
  const inDegree = new Map();
  const adj = new Map();
  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }
  // 入口集合：scan 的 entrypoints 文件名 → 树中匹配
  const starts = new Set();
  for (const ep of entrypoints || []) {
    const base = String(ep).split('/').pop();
    for (const f of tree.files) {
      if (f === ep || f.endsWith('/' + base) || f === base) starts.add(f);
    }
  }
  // 常见入口兜底
  for (const name of ['main.py', 'app.py', 'server.py', 'wsgi.py', 'asgi.py', 'manage.py', 'celery_app.py', 'celery.py', 'changedetection.py', 'main.go', 'index.js', 'server.js', 'app.js', 'index.ts', 'server.ts', 'app.ts', 'main.ts', 'src/main.rs', 'src/lib.rs', 'app.go']) {
    for (const f of tree.files) if (f.endsWith('/' + name) || f === name) starts.add(f);
  }
  // Go cmd/*/main.go、Rust 工作区 bin 入口（cargo workspace 常见）
  for (const f of tree.files) {
    if (/^cmd\/[^/]+\/main\.go$/.test(f) || /^crates\/[^/]+\/src\/main\.rs$/.test(f) || /^src\/bin\/[^/]+\.rs$/.test(f)) starts.add(f);
  }
  // Java Spring Boot：*Application.java 含 @SpringBootApplication 或 public static void main
  for (const f of tree.files) {
    if (!/\.java$/.test(f) || !/Application\.java$/.test(f)) continue;
    const c = readSafe(root, f);
    if (c && /@SpringBootApplication|public\s+static\s+void\s+main\s*\(/.test(c)) starts.add(f);
  }
  // 框架约定入口（Next/Nuxt/SvelteKit 路由 + 前端构建入口）
  const fw = frameworkEntrypoints(root, tree);
  for (const s of fw.starts) starts.add(s);
  // Go/Rust 同目录兄弟文件符号共享：同一目录文件之间互隐式可达。
  // Go 同包文件：同一目录下所有 .go 文件一起编译、符号共享，无 import 边。
  // 访问到任一 .go 文件时，其同目录兄弟文件同样可达（如 cmd/main.go → cmd/handlers.go）
  const goSiblings = new Map();
  for (const f of tree.files) {
    if (!/\.go$/.test(f) || /_test\.go$/.test(f)) continue;
    const d = path.dirname(f);
    if (!goSiblings.has(d)) goSiblings.set(d, []);
    goSiblings.get(d).push(f);
  }
  // Rust 同目录：mod/main.rs 同目录共享
  const rsSiblings = new Map();
  for (const f of tree.files) {
    if (!f.endsWith('.rs') || /\.spec\.rs|_test\.rs$/.test(f)) continue;
    const d = path.dirname(f);
    if (!rsSiblings.has(d)) rsSiblings.set(d, []);
    rsSiblings.get(d).push(f);
  }
  // Java 同包：同一目录下 .java 文件属于同一个 package，类之间无需 import 即可互引
  const javaSiblings = new Map();
  for (const f of tree.files) {
    if (!f.endsWith('.java') || /Test\.java$|Tests\.java$/.test(f)) continue;
    const d = path.dirname(f);
    if (!javaSiblings.has(d)) javaSiblings.set(d, []);
    javaSiblings.get(d).push(f);
  }
  const reachable = new Set(starts);
  const queue = [...starts];
  while (queue.length) {
    const cur = queue.pop();
    const nxts = adj.get(cur) || [];
    if (/\.go$/.test(cur)) {
      const d = path.dirname(cur);
      for (const sib of goSiblings.get(d) || []) nxts.push(sib);
    }
    if (/\.rs$/.test(cur)) {
      const d = path.dirname(cur);
      for (const sib of rsSiblings.get(d) || []) nxts.push(sib);
    }
    if (/\.java$/.test(cur)) {
      const d = path.dirname(cur);
      for (const sib of javaSiblings.get(d) || []) nxts.push(sib);
    }
    for (const nxt of nxts) {
      if (!reachable.has(nxt)) { reachable.add(nxt); queue.push(nxt); }
    }
  }
  const optional = detectOptional(root, tree);

  // 主干服务遮蔽：默认部署的服务进程（cmd 入口 / compose 无 profiles）即使名字撞上
  // feature-flag 开关，服务本体也不是可选组件——开关门控的是服务内部行为或外部渠道
  // （openim 教训：PUSH_ENABLE 门控 FCM/APNs 渠道，openim-push 进程却默认部署；
  //   不遮蔽则 optionalLabelGate 会把 internal/push 节点强制标成「可选/实验」，
  //   与 c4-container 的标准 Container 跨图矛盾）。
  // compose profiles 与插件/示例目录证据是「默认不启动」的权威信号，不遮蔽。
  const coreToks = coreServiceTokens(root, tree);
  const shadowedKw = [];
  for (const [kw, reason] of optional) {
    const toks = kw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (!AUTHORITATIVE_OPTIONAL_RE.test(reason) && toks.some((t) => coreToks.has(t))) {
      shadowedKw.push(kw);
      optional.delete(kw);
    }
  }

  // 汇总到任意路径（文件或目录）。key 统一不带尾斜杠，避免查询不一致。
  const heatOf = new Map();
  const bump = (k, n) => { heatOf.set(k, (heatOf.get(k) || 0) + n); };
  for (const [f, n] of inDegree) {
    bump(f, n);
    let d = path.dirname(f);
    while (d && d !== '.') { bump(d, n); d = path.dirname(d); }
  }
  const reachOf = new Set();
  for (const f of reachable) {
    reachOf.add(f);
    let d = path.dirname(f);
    while (d && d !== '.') { reachOf.add(d); d = path.dirname(d); }
  }

  function info(p) {
    const norm = String(p).replace(/\/$/, '');
    const heat = heatOf.get(norm) || 0;
    let reach = reachOf.has(norm);
    // 目录：目录内任意文件可达即视为可达
    if (!reach && tree.dirs.has(norm)) {
      const prefix = norm + '/';
      reach = [...reachOf].some((r) => r.startsWith(prefix));
    }
    const low = norm.toLowerCase();
    const optAll = [];
    for (const [kw, reason] of optional) {
      // 词边界匹配：'ai' 不得命中 'main'/'email'，'kafka' 不得命中 'kafkamanager' 之外的子串
      const re = new RegExp('(^|[^a-z0-9])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)');
      if (re.test(low)) optAll.push(reason);
    }
    // 可达路径 = 编译进默认部署产物的代码：只承认权威可选证据（compose profiles / 插件示例目录）；
    // feature-flag / env 门控 / AI key 类证据门控的是运行时行为与外部依赖（如 FCM/APNs 渠道、
    // kafka broker 连接），不使「随服务默认部署的代码」本身成为可选组件
    // （openim 教训：PUSH_ENABLE 门控推送渠道，internal/push 随 openim-push 进程默认部署）。
    // 不可达路径：所有证据有效（条件注册/旁路加载的插件仍算可选）。
    const optReasons = reach
      ? optAll.filter((r) => AUTHORITATIVE_OPTIONAL_RE.test(r))
      : optAll;
    const isOpt = optReasons.length > 0;
    // detached：被引用但从入口不可达且非可选 → 旁路/条件注册组件，不得占主链路
    const detached = !reach && heat > 0 && !isOpt;
    return { heat, reachable: reach, optional: isOpt, detached, optReasons: [...new Set(optReasons)].slice(0, 2) };
  }

  // 旁路组件汇总：浅位目录（深度 1-3）、被多处引用但入口不可达、非可选
  // Go 仓库 pkg/ 是可复用工具库（非架构组件），tools/ 是开发工具，均不进旁路列表
  // （openim 教训：pkg/common/version、tools/formitychecker 曾污染 detachedKw 连带误标可选）
  const isGoRepo = tree.files.has('go.mod');
  const detachedSkip = new RegExp('node_modules|vendor|\\.git|dist|build|__pycache__|test|docs?|examples?|scripts|tools|deployments?|configs?'
    + (isGoRepo ? '|(^|/)pkg(/|$)' : ''));
  const detachedList = [];
  for (const d of tree.dirs) {
    const depth = d.split('/').length;
    if (depth > 3 || depth < 1) continue;
    if (detachedSkip.test(d)) continue;
    const i = info(d);
    if (i.detached && i.heat >= 2) detachedList.push({ path: d, heat: i.heat });
  }
  detachedList.sort((a, b) => b.heat - a.heat);

  // ===== 形态枚举（usage8 的 P0）：根据锚点/文件结构判断产品形态 =====
  // shapeDetectWithCandidates：返回所有形态候选 + 打分（0-10 整数），供 shapeConfidence 判定是否
  // 低置信（前两名分差 <=1 视为低置信），auto 模式下触发 orch8 降级（Agent explore 兜底）
  const shapeDetectWithCandidates = () => {
    const hasPackageJson = tree.files.has('package.json');
    const hasCargo = tree.files.has('Cargo.toml') || [...tree.files].some(f => f === 'Cargo.toml' || f.startsWith('crates/'));
    const hasGoMod = tree.files.has('go.mod');
    const fe = fw.feRoots.length > 0;
    const SHAPE_IGNORE = /(^|\/)(tests?|__tests__|testdata|fixtures?|examples?|samples?|docs?|cypress|playwright|e2e|mock[s]?|stubs?|vendor|third_party|node_modules|plugins?|providers?|monitor-types?|notification-providers?|integrations?|addons?|extensions?|adapters?\/.*vendor|components?|views?|pages?|settings|assets?|static|public)(\/|$)/i;
    const isUiFile = /\.(vue|tsx|jsx|css|html|svelte)$/i;
    const bridgeRe = /(^|\/)(zigbee|mqtt|modbus|ble|bluetooth|bacnet|canbus|zigate?|coordinator|deconz|matter|thread|lora|opcua|knx)(\/|\.[a-z]+$)/i;
    const bridgeStrong = new Set(['zigbee', 'modbus', 'canbus', 'bacnet', 'knx', 'opcua', 'matter', 'thread', 'lora', 'zigate', 'zigbee2mqtt', 'coordinator', 'deconz', 'ble', 'bluetooth']);
    const bridgeTokens = new Set();
    let bridgeStrongHit = false;
    for (const t of tree.all) {
      if (SHAPE_IGNORE.test(t)) continue;
      const m = t.match(bridgeRe);
      if (!m) continue;
      const tok = m[2].toLowerCase();
      bridgeTokens.add(tok);
      if (bridgeStrong.has(tok) && t.split('/').length <= 3) bridgeStrongHit = true;
    }
    const anyBridge = bridgeTokens.size >= 2 || bridgeStrongHit;
    const bridgeScore = bridgeStrongHit ? 10 : (bridgeTokens.size >= 2 ? 7 : 0);
    const proxyRe = /(^|\/)(reverseproxy|reverse_proxy|proxyhandler|loadbalancer|upstream|caddyfile)(\/|\.[a-z]+$)|(^|\/)proxy\.go$/i;
    const anyProxy = [...tree.all].some(t => {
      if (SHAPE_IGNORE.test(t) || isUiFile.test(t)) return false;
      return proxyRe.test(t);
    });
    const proxyScore = anyProxy && !fe ? 9 : (anyProxy ? 7 : 0);
    const notiDirRe = /(^|\/)(smtpd?|smtp_server|fcm|apns|onesignal|pushover|ntfy|notify_send|mqtt_publish|sns|pubsub)(\/|\.[a-z]+$)|notification.*broker/i;
    const notiFileRe = /(^|\/)server\/(topic|subscription|publish|subscriber)[\w.-]*\.(go|py|js|ts)$|(^|\/)(topic|pubsub|broker)[\w.-]*\.(go|py)$/;
    const anyNotifyBus = [...tree.all].some(t => {
      if (SHAPE_IGNORE.test(t) || isUiFile.test(t)) return false;
      return notiDirRe.test(t) || notiFileRe.test(t);
    });
    const notifyScore = anyNotifyBus ? (fe ? 8 : 9) : 0;
    const realFe = fe || [...tree.files].some(f => /\.(vue|tsx|jsx)$/.test(f)
      && !TEST_ASSETS_PATH.test(f)
      && !/(^|\/)node_modules\//.test(f));
    const apiSvcScore = (hasCargo && !realFe) ? 8 : ((hasGoMod && !realFe) ? 7 : 0);
    const webScore = realFe ? 10 : (!hasCargo && !hasGoMod && hasPackageJson ? 7 : 1);

    const scored = [
      { kind: 'bridge', score: bridgeScore, signal: [...bridgeTokens].join(','), attachFe: fe },
      { kind: 'proxy', score: proxyScore, signal: '', attachFe: fe },
      { kind: 'notify-bus', score: notifyScore, signal: '', attachFe: fe },
      { kind: 'api-svc', score: apiSvcScore, signal: hasCargo ? 'rust' : (hasGoMod ? 'go' : ''), attachFe: false },
      { kind: 'web', score: webScore, signal: '', attachFe: false }
    ];
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    const topSignal = top.signal;
    const SHAPE_NAME = {
      'bridge':     top.attachFe ? '协议桥接（附前端）' : '协议桥接',
      'proxy':      top.attachFe ? '反向代理/网关（附前端）' : '反向代理/网关',
      'notify-bus': top.attachFe ? '通知总线（附前端）' : '通知总线',
      'api-svc':    (top.signal === 'rust') ? '后端服务（Rust）' : ((top.signal === 'go') ? '后端服务（Go）' : '后端服务'),
      'web':        'Web 应用（前后端）'
    };
    const shapeObj = { kind: top.kind, name: SHAPE_NAME[top.kind] || top.kind };
    if (topSignal) shapeObj.signal = topSignal;
    const gap = scored.length >= 2 ? scored[0].score - scored[1].score : scored[0].score;
    const confidence = top.score === 0 ? 'low' : (gap <= 1 ? 'low' : (gap <= 3 ? 'medium' : 'high'));
    return {
      shape: shapeObj,
      candidates: scored.map(s => ({ kind: s.kind, score: s.score, signal: s.signal || '' })),
      shapeConfidence: confidence,
      shapeMargin: gap
    };
  };
  const det = shapeDetectWithCandidates();
  const shape = det.shape;
  const emptyLayers = [];
  if ((shape.kind === 'proxy' || shape.kind === 'bridge' || shape.kind === 'api-svc')
      && fw.feRoots.length === 0) emptyLayers.push('frontend');
  // 无 worker/queue 锚点 → worker/schedule 可能空，后续 plan 可根据锚点再决定是否启用
  const detachTopKw = new Set();
  detachedList.slice(0, 5).forEach(d => {
    const s = String(d.path).toLowerCase();
    for (const tok of s.split(/[\/_-]/)) if (tok) detachTopKw.add(tok);
  });
  return { info, edges: edges.length, optionalKw: [...optional.keys()], shadowedKw, coreTokens: [...coreToks],
    detachedList: detachedList.slice(0, 8), feRoots: fw.feRoots, shape, emptyLayers,
    shapeCandidates: det.candidates, shapeConfidence: det.shapeConfidence, shapeMargin: det.shapeMargin };
}

// 通用角色模式（语言/产品无关）：role → 层 + 路径正则
const ANCHOR_PATTERNS_V2 = [
  { role: 'entry', layer: 'api', re: /(^|\/)(main\.(py|go|js|ts|rs)|app\.(py|js|ts|rs)|server\.(js|ts|py|go)|changedetection\.py|flask_app\.py|wsgi\.py|asgi\.py|manage\.py|index\.(js|ts))$|\w*Application\.java$/i, kind: 'file', hint: '进程入口' },
  { role: 'api', layer: 'api', re: /(^|\/)(api|apis|routes?|routers?|controllers?|services?|handlers?|blueprints?|http|endpoints?)(\/|$)|(^|\/)(api|routes?|routers?|controller|handlers?|blueprint|service)\.(go|js|ts|py|rb|php|java|cs)$/i, kind: 'any', hint: 'API / 路由层 / 业务逻辑' },
  { role: 'frontend', layer: 'frontend', re: /(^|\/)(templates?|views?|static|public|assets?|frontend|web|ui|src\/pages|src\/app|app\/templates|src\/components)(\/|$)/i, kind: 'dir', hint: '前端页面' },
  { role: 'queue', layer: 'schedule', re: /(^|\/)(queue|queues|schedulers?|jobs?|tasks?|mq|message-?bus|celery|asynq|bull|bullmq|sidekiq|rq)(\/|$)|(^|\/)[\w-]*(queue|celery|bullmq|asynq|sidekiq)[\w-]*\.(py|js|ts|go|java)$/i, kind: 'any', hint: '任务/消息队列' },
  // 注意：tracker/recorder 不在此列——Web 分析产品的 tracker/recorder 是发到访客浏览器运行的脚本
  // （umami src/tracker、src/recorder：rollup IIFE、window/document/rrweb），属前端资产；
  // 服务端后台处理在 workers/processors/jobs/consumers/runners 目录
  // 注意：文件级 manager.* 不算 worker——user/manager.go（ntfy）、certmanagers.go（caddy）是领域/工具管理器；
  // 真正的异步编排管理器是「目录」形态（listmonk internal/manager/ 活动发送引擎），故 manager 只保留目录级匹配
  { role: 'worker', layer: 'worker', re: /(^|\/)(workers?|consumers?|processors?|fetchers?|crawlers?|spiders?|runners?|managers?)(\/|$)|(^|\/)(worker|processor|consumer|fetcher|crawler|runner)[\w-]*\.(py|js|ts|go|rs)$/i, kind: 'any', hint: '异步处理 / 采集脚本' },
  { role: 'store', layer: 'storage', re: /(^|\/)(store|stores?|models?|entities?|repositories?|db|database|schema|migrations?|prisma)(\/|$)|datastore/i, kind: 'any', hint: '数据存储 / 模型' },
  // 文件级匹配含 mail/email/smtp 词（vaultwarden src/mail.rs 教训：Rust 邮件模块无 mailer 后缀）
  { role: 'notify', layer: 'monitor', re: /(^|\/)(notifications?|notify|messenger|mailers?|smtp|webhooks?|alerts?)(\/|$)|(^|\/)(notifications?|messenger|notifier|mailers?|mail|email|smtp|notify)[\w-]*\.(py|js|ts|go|rs)$/i, kind: 'any', hint: '通知 / 消息发送' },
  // 文件级强信号：sse_hub.go / sse_handler.py / socket_server.js / ws_hub.ts 等推送执行器
  // （memos 教训：sse_hub.go 藏在 api/v1 路由目录下，目录级模式 (^|/)sse(/|$) 匹配不到文件）
  { role: 'realtime', layer: 'monitor', re: /(^|\/)(realtime|websocket|ws|sse|events?|stream)(\/|$)|socket|(^|\/)(realtime|websockets?|sockets?|sse|ws)[\w.-]*\.(py|js|ts|go|java|rb|php|cs)$/i, kind: 'any', hint: '实时推送' },
  { role: 'ops', layer: 'ops', re: /(^|\/)(docker-compose\.ya?ml|Dockerfile(\.[\w-]+)?|deployments?(\/|$)|kubernetes\/|k8s\/|helm\/|\.github\/workflows\/|docker(\/|$))/i, kind: 'any', hint: '交付 / 运维' },
  // CLI 子命令包（ntfy 教训：根 main.go 只是 urfave/cli 薄壳，cmd/ 才是 pub/sub/serve 子命令；
  // cmd/ 在 Go 生态也常是服务端 main 包布局——listmonk cmd/main.go、memos cmd/memos/main.go、caddy cmd/caddy/main.go，
  // 靠 consider() 内 CLI 框架内容标记 + 「entry 锚点同包」后置过滤双重排除）
  { role: 'cli', layer: 'api', re: /(^|\/)(cmd|cli)(\/|$)/i, kind: 'dir', hint: 'CLI 命令行入口（子命令包）' },
  // 官方客户端 SDK 库（ntfy client/：发布/订阅 Go SDK，CLI 与外部集成都用它；仓库内的 actor 侧接口）
  { role: 'client', layer: 'api', re: /(^|\/)(clients?|sdk)(\/|$)/i, kind: 'dir', hint: '客户端 SDK / 官方客户端库' }
];
// 生成代码目录（protobuf/wire/codegen 输出）：heat 虚高且非架构层，不得作锚点
const GENERATED_PATH = /(^|\/)(gen|generated|__generated__|third_party)(\/|$)|(^|\/)proto\/gen\//;

// 机制角色强信号目录名：API 约定路由下以此命名的目录即执行器（如 app/api/realtime/），不做 API 降权
const MECH_STRONG_TERMINAL = {
  entry: /^(main|app|server|changedetection|flask_app|index)$/,
  realtime: /^(realtime|websocket|web-socket|socket|sockets|sse|ws)$/,
  notify: /^(notifications?|notify|messenger|mailers?|smtp|webhooks?|alerts?|apprise|notification_service)$/,
  queue: /^(queues?|schedulers?|celery|asynq|bull|mq|messenger|jobs?|tasks?)$/,
  worker: /^(workers?|processors?|consumers?|fetchers?|crawlers?|runners?)$/,
  store: /^(store|stores|db|database|prisma|models|repositories?|datastore)$/
};
// 锚点候选源码扩展名（ops 角色豁免：Dockerfile/compose 无扩展名）
const ANCHOR_SRC_EXT = /\.(py|go|js|jsx|ts|tsx|rb|java|php|cs|rs)$/;
// 后端服务端角色（前端代码不得竞争这些角色）
const BACKEND_ROLES = new Set(['entry', 'api', 'queue', 'worker', 'store', 'notify', 'realtime', 'cli', 'client']);
// CLI 框架标记（Go/Python/Node/Rust）：cmd/ 目录内必须出现才算真 CLI 子命令包
const CLI_FW_RE = /urfave\/cli|spf13\/cobra|cobra\.Command|cli\.(App|Command)|click\.(command|group)|argparse\.ArgumentParser|typer\.|@oclif|["']commander["']|yargs|clap::|structopt/i;
// 入口排除路径（埋点 SDK / 构建产物 / 依赖 / 测试样例）
const ENTRY_BLACKLIST = /(^|\/)(recorder|tracker|sdk|dist|build|vendor|node_modules|test|tests|__tests__|__test__|specs?|fixtures?|examples?|mock|stubs?|cjs|esm|playwright|cypress|e2e)(\/|$)/i;
// 测试资产/样例/文档：前端锚点落到这里必须降级（z2m test/assets、ntfy docs）
const TEST_ASSETS_PATH = /(^|\/)(test[s]?|__tests__|specs?|fixtures?|examples?|samples?|docs?|cypress|playwright|e2e|benchmarks?|mock[s]?|stubs?)(\/|$)/i;

/**
 * 通用锚点（orch4）：语言无关模式匹配 + 重要性过滤。
 * 可选组件不作锚点；主干角色按 heat/reachable 排序取最可信路径。
 */
function findAnchorsV2(tree, importance) {
  const anchors = [];
  const seenRole = new Map();
  const feRoots = (importance && importance.feRoots) || [];
  const shapeKind = importance && importance.shape ? importance.shape.kind : null;
  // Java Maven/Gradle 源根前缀：src/main/java/ 等不贡献架构深度，剥离后再算
  const JAVA_SRC_PREFIX = /^(?:app\/)?src\/(?:main|test)\/(?:java|kotlin)\//;
  const depthOf = (p) => p.replace(JAVA_SRC_PREFIX, '').split('/').length;
  const consider = (p0, pat) => {
    const p = p0.replace(/\/$/, '');
    const isFile = tree.files.has(p);
    // 形态抑制：proxy 无前端；api-svc / 无前端 bridge 的 frontend 层为空（emptyLayers），
    // 不得把响应模板/内置静态目录（caddy templates、vaultwarden src/static）锚成前端层
    if (pat.role === 'frontend') {
      if (shapeKind === 'proxy') return;
      if ((shapeKind === 'api-svc' || shapeKind === 'bridge') && feRoots.length === 0) return;
    }
    // 生成代码（proto/gen、wire_gen 等）heat 虚高但不是架构层，跳过
    if (pat.role !== 'ops' && GENERATED_PATH.test(p)) return;
    // 非 ops 角色：文件候选必须是源码（排除 README/图片/锁文件/测试文件等）
    if (isFile && pat.role !== 'ops' && (!ANCHOR_SRC_EXT.test(p) || /(^|\/)(__tests__|tests?)(\/|$)|(\.|_)(test|spec)\./.test(p))) return;
    // 测试资产/样例/文档：z2m test/assets、ntfy docs 等不得作锚点（误标 frontend/realtime）
    if (pat.role !== 'ops' && TEST_ASSETS_PATH.test(p)) return;
    // 后端角色：前端代码（api client / 通知组件 / store 模块）不得竞争
    if (BACKEND_ROLES.has(pat.role) && isFrontendPath(p, feRoots)) return;
    // 后端角色：静态资源目录（static/js/scheduler.js 这类前端脚本）不得竞争
    if (BACKEND_ROLES.has(pat.role) && /(^|\/)(static|assets?|public|dist|build|vendor|node_modules|templates?|__pycache__)(\/|$)/i.test(p)) return;
    // frontend：仅 templates/ 目录（无 HTML/JS 构建资产，如 Caddy 的响应模板），不是真 SPA 前端，跳过
    if (pat.role === 'frontend' && !feRoots.length) {
      // 检查是否存在真实前端资产（JS/TS/TSX/Vue 源文件）
      const pf = p.replace(/\/$/, '');
      const hasSrcAsset = pf.includes('/static') || pf.includes('/assets') || pf.includes('/web/') ||
          pf.includes('/frontend') || pf.includes('/ui') || pf.includes('/pages') ||
          pf.includes('/src/app') || pf.includes('/components') || pf.includes('/views');
      if (!hasSrcAsset && /(^|\/)(templates?|embed|assets?)\//i.test(p + '/')) {
        // templates-only 目录：若同级/父级无 frontend 构建入口，则降级（非真正产品 UI）
        let hasFe = false;
        for (const fe of ['vite', 'webpack', 'next', 'vue', 'react']) {
          if ([...tree.all].some(t => t.includes(fe + '.config') || t.includes('/' + fe + '/'))) { hasFe = true; break; }
        }
        if (!hasFe) return;
      }
    }
    const imp = importance ? importance.info(p) : { heat: 0, reachable: true, optional: false, detached: false, optReasons: [] };
    if (imp.optional) return; // 可选组件不作强制锚点
    // cli 角色：cmd/ 必须是真 CLI 子命令包（内含 urfave/cli、cobra、click、argparse、commander、clap 等框架调用）。
    // Go 服务端 main 包布局（cmd/server/main.go 这类）目录内无框架标记，自然出局；
    // 再叠加后面的「entry 锚点同包」后置过滤，双保险。
    if (pat.role === 'cli') {
      let hit = false;
      for (const f of tree.files) {
        if (path.dirname(f) !== p) continue;
        if (!ANCHOR_SRC_EXT.test(f) || /(\.|_)(test|spec)\./.test(f)) continue;
        const c = readSafe(tree.root, f);
        if (c && CLI_FW_RE.test(c.slice(0, 60000))) { hit = true; break; }
      }
      if (!hit) return;
    }
    const depth = depthOf(p);
    let score;
    if (pat.role === 'entry') {
      // 入口特征：浅位 + 可达；入度低是正常的（没人 import 入口），不用 heat
      if (depth > 4) return;
      if (ENTRY_BLACKLIST.test(p)) return; // 埋点 SDK / 构建产物
      // Next/Nuxt 等框架项目无传统进程入口：index.ts 多为组件库 barrel，排除
      const isFrameworkApp = [...tree.all].some((t) => /(^|\/)next\.config\.(js|ts|mjs)$|(^|\/)nuxt\.config\.(js|ts)$/.test(t));
      if (isFrameworkApp && /(^|\/)index\.(ts|js)$/.test(p) && depth > 1) return;
      const terminal = path.basename(p).replace(/\.[^.]+$/, '').toLowerCase();
      // 真正的进程入口（main.* / cmd 下入口）加权，胜过 server 引导文件
      const isMain = terminal === 'main' || /(^|\/)cmd\//.test(p);
      score = (imp.reachable ? 6 : 0) + (5 - depth) * 2 + (isMain ? 4 : 0);
    } else {
      // 架构锚点：主干目录浅位优先；深层叶子文件（库/组件）不代表子系统
      if (depth > 5) return;
      if (imp.detached) return; // 旁路组件不作锚点
      const isDir = tree.dirs.has(p);
      // 纯静态资源目录（public/static/assets）是前端资源而非「前端页面层」，降权
      const staticDir = /(^|\/)(public|static|assets)(\/|$)/.test(p);
      score = imp.heat + (imp.reachable ? 4 : 0) + (isDir ? 3 : 0) + (4 - Math.min(depth, 4)) * 2 - (staticDir ? 6 : 0);
      // 机制层角色（通知/实时/队列/worker/存储）：API 路由层里的 handler 文件是「配置/触发入口」而非执行器，
      // 正是「触发通知 → 通知配置 API」语义陷阱（如 api/Notifications.py），降权让真实执行目录胜出；
      // 但 Next/Nuxt 约定路由下、目录名本身就是机制词时（src/app/api/realtime/），route handler 即执行器，不罚
      if (['notify', 'realtime', 'queue', 'worker', 'store'].includes(pat.role)
          && /(^|\/)(api|apis|router|routes|controllers?|handlers?|blueprints?|http)(\/|\.)/i.test(p)) {
        const terminal = path.basename(p).replace(/\.[^.]+$/, '').toLowerCase();
        const strongTerminal = MECH_STRONG_TERMINAL[pat.role] && MECH_STRONG_TERMINAL[pat.role].test(terminal);
        if (isFile || !strongTerminal) score -= 12;
      }
      // 数据层目录（queries/sql/models/prisma…）里命中弱机制词（events/stream/jobs 数据表）不是执行器：
      // 如 umami src/queries/sql/events 抢 realtime 角色，重罚
      if (['notify', 'realtime', 'queue', 'worker'].includes(pat.role)
          && /(^|\/)(queries|sql|models?|entities|repositories?|schema|migrations?|prisma)(\/|$)/i.test(p)) {
        score -= 15;
      }
      // notify：bounce（退信/投诉入站处理）不是通知发送执行器，降权让 messenger/mailer 胜出
      if (pat.role === 'notify' && /(^|\/)bounce(\/|$)/i.test(p)) {
        score -= 12;
      }
      // realtime：强信号（websocket/sse/socket/realtime 目录）优先；弱信号（events/stream 数据目录）压分
      if (pat.role === 'realtime') {
        if (/(realtime|websocket|socket|\bsse\b|(^|\/)ws(\/|$))/i.test(p)) score += 8;
        else score = Math.min(score, 10);
      }
      // notify：notification(s) 目录是通知编排层（签名节点，如 server/notification、changedetectionio/notification）；
      // webhook 是发送渠道/入站接收（如 internal/webhook），编排层必须胜出，避免「渠道顶替通知服务」
      if (pat.role === 'notify') {
        const notifyTerminal = path.basename(p).replace(/\.[^.]+$/, '').toLowerCase();
        if (/^notifications?$/.test(notifyTerminal)) score += 10;
        if (/^webhooks?$/.test(notifyTerminal)) score -= 6;
      }
    }
    const prev = seenRole.get(pat.role);
    if (!prev || score > prev.score) {
      seenRole.set(pat.role, { path: p, score, imp, hint: pat.hint, layer: pat.layer, role: pat.role });
    }
  };
  for (const pat of ANCHOR_PATTERNS_V2) {
    const pool = pat.kind === 'dir' ? tree.dirs : pat.kind === 'file' ? tree.files : tree.all;
    for (const p of pool) {
      if (pat.re.test(p)) consider(p, pat);
    }
  }
  // cli 后置过滤：entry 锚点位于 cmd/ 之内时，cmd/ 是服务端 main 包布局而非独立 CLI 产品
  // （listmonk cmd/main.go、memos cmd/memos/main.go、caddy cmd/caddy/main.go）。
  // ntfy 例外：入口在根 main.go，cmd/ 是子命令包，保留。
  {
    const entryA = seenRole.get('entry');
    const cliA = seenRole.get('cli');
    if (entryA && cliA && (entryA.path === cliA.path || entryA.path.startsWith(cliA.path + '/'))) {
      seenRole.delete('cli');
    }
  }
  for (const v of seenRole.values()) anchors.push(v);
  // 去重（同路径不同角色只保留分高的）
  const byPath = new Map();
  for (const a of anchors) {
    const ex = byPath.get(a.path);
    if (!ex || a.score > ex.score) byPath.set(a.path, a);
  }
  // 入站协议端点校正：notify/realtime 角色命中的文件，若文件名是 server/listener/receiver/inbound 类
  // 且不含出站/推送词，是入站接收服务（ntfy server/smtp_server.go：收外部邮件→内部发布消息），
  // 语义等同 API 入口，归 api 层——不是出站通知机制（r2 盲评：「接收服务器不应在通知层」）。
  // sse_server/websocket_server 是出站推送服务端，保持 monitor。
  for (const a of byPath.values()) {
    if ((a.role === 'notify' || a.role === 'realtime') && tree.files.has(a.path)) {
      const base = path.basename(a.path).replace(/\.[^.]+$/, '').toLowerCase();
      if (/[_-](server|listener|receiver|inbound|ingress)$/.test(base)
          && !/(sse|websocket|socket|push|stream|sender|dispatcher|notifier|mailer|outbound)/.test(base)) {
        a.role = 'api';
        a.layer = 'api';
        a.hint = a.hint + ' · 入站协议端点（server/listener 类：外部→本服务→内部发布，归 API 层，非出站通知）';
      }
    }
  }
  // 内容级 realtime 锚点：路径正则抓不到「文件名弱、内容强」的 SSE/WebSocket 服务端。
  // listmonk 教训：SSE 端点是 cmd/events.go 里写死 text/event-stream 的 HTTP handler，
  // 而 internal/events/events.go 只是进程内事件总线——路径同名 events，必须读内容区分。
  // （shapeKind 已在函数顶部计算）
  // 代理/转发透传路径：出现 text/event-stream 只是「代理 SSE 时特殊处理」，不是本产品提供推送
  // （caddy 教训：reverseproxy/streaming.go、encode/encode.go 命中 SSE 内容但属转发内部）
  const PROXY_PASSTHROUGH = /(^|\/)(reverseproxy|reverse_proxy|proxyhandler|loadbalanc\w*|upstreams?|forwardproxy|streaming|httpclient|transport|headers?|encode)(\/|\.|$)/i;
  if (tree.root && shapeKind !== 'proxy') {
    // 服务端推送标记（前端 EventSource/socket.io-client 已被 isFrontendPath 排除）
    const RT_CONTENT = /text\/event-stream|websocket\.Upgrad|new\s+WebSocketServer|WebSocket\.Server|SocketIOServer|socketio\.Server|flask_socketio|SseEmitter|EventSourceResponse|@WebSocketGateway|AsyncWebsocketConsumer|ActionCable|require\(["']socket\.io["']\)|from\s+["']socket\.io["']/i;
    for (const f of tree.files) {
      if (!ANCHOR_SRC_EXT.test(f)) continue;
      if (f.split('/').length > 6) continue;
      if (/(^|\/)(__tests__|tests?|node_modules|vendor|dist|build|third_party)(\/|$)|(\.|_)(test|spec)\./.test(f)) continue;
      if (isFrontendPath(f, feRoots)) continue;
      if (GENERATED_PATH.test(f)) continue;
      if (/(^|\/)(static|assets?|public|templates?)(\/|$)/i.test(f)) continue;
      if (PROXY_PASSTHROUGH.test(f)) continue;
      const c = readSafe(tree.root, f);
      if (c && RT_CONTENT.test(c.slice(0, 200000))) {
        const imp = importance ? importance.info(f) : { heat: 0, reachable: true, optional: false, detached: false, optReasons: [] };
        // 可选/旁路组件不作锚点（与路径锚点一致）
        if (imp.optional || imp.detached) continue;
        // 前端控制台/面板服务文件（z2m lib/extension/frontend.ts 内嵌 WS 仅服务 dashboard）：
        // 属「可选 Web 控制台」而非产品级实时推送通道，不得标 realtime
        if (/[\w.-]*(frontend|dashboard|webui|web-ui|console)[\w.-]*\.(ts|js|py|go|rs)$/i.test(path.basename(f))) continue;
        byPath.set(f, { path: f, score: 40 + (6 - Math.min(f.split('/').length, 6)) * 2,
          hint: '实时推送（内容核验）', layer: 'monitor', role: 'realtime', contentVerified: true, imp });
      }
    }
  }
  // realtime 锚点必须是强信号（websocket/sse/socket/realtime 推送端点）或内容核验命中。
  // 弱信号（events 进程内事件总线、stream 数据流目录）在没有强信号候选的仓库里
  // 宁可不出 realtime 锚点——漏画好过把事件总线误标成「实时推送」（listmonk internal/events 教训）。
  const REALTIME_STRONG = /(realtime|websocket|web-socket|socket|sse|(^|[/_.-])ws([/_.-]|$))/i;
  return [...byPath.values()].filter((a) => {
    if (a.role !== 'realtime') return true;
    // proxy 形态自身不产生推送（只透传），realtime 锚点全是误判（caddy sockets/streaming 教训）
    if (shapeKind === 'proxy') return false;
    if (!a.contentVerified && !REALTIME_STRONG.test(a.path)) return false;
    // 非内容核验的文件级 sockets.* 工具（unix fd 传递等），且不在强语义目录、热度低 → 工具类误判
    if (!a.contentVerified && tree.files.has(a.path)) {
      const base = path.basename(a.path).replace(/\.[^.]+$/, '').toLowerCase();
      const dir = path.dirname(a.path);
      if (/^sockets?$/.test(base) && !/(realtime|websocket|web-socket|ws|sse|hub)/i.test(dir) && a.imp.heat < 20) return false;
    }
    return true;
  }).sort((a, b) => b.score - a.score);
}

// 配套执行器文件名模式（锚点目录附近、真实存在的执行器）
const COMPANION_RE = {
  worker: /(^|_)(worker[_-]?pool|workers?|consumers?|runners?|fetchers?|crawlers?|spiders?)$/,
  queue: /(^|_)(queue[_-]?handlers?|queues?|schedulers?|jobs?|tasks?)$/,
  notify: /(^|_)(notification[_-]?service|notify[_-]?service|messenger|notifiers?|mailers?)$/,
  realtime: /(^|_)(realtime|websockets?|sockets?|sse|ws)$/,
  store: /(^|_)(datastore|stores?|db)$/
};

/**
 * 锚点配套路径（orch4 粒度引导，非强制覆盖）：机制角色锚点附近真实存在的执行器文件/目录。
 * 例：worker 锚点=processors/ 时，同父目录的 worker.py / worker_pool.py；
 *     notify 锚点=notification/ 时，父目录的 notification_service.py。
 * 只返回树中真实路径，供 plan/draft 决定是否拆分为独立节点，禁止臆造。
 */
function anchorCompanions(tree, anchors, importance) {
  const out = [];
  const anchorPaths = new Set(anchors.map((a) => a.path));
  const added = new Set();
  const feRoots = (importance && importance.feRoots) || [];
  for (const a of anchors) {
    const re = COMPANION_RE[a.role];
    if (!re) continue;
    const parent = path.dirname(a.path);
    const grand = path.dirname(parent);
    const found = [];
    for (const f of tree.all) {
      if (anchorPaths.has(f) || found.includes(f)) continue;
      const d = path.dirname(f);
      if (d !== a.path && d !== parent && d !== grand) continue;
      const base = path.basename(f).replace(/\.[^.]+$/, '').toLowerCase();
      if (!re.test(base)) continue;
      const isFile = tree.files.has(f);
      if (isFile && (!ANCHOR_SRC_EXT.test(f) || /(^|\/)(__tests__|tests?)(\/|$)|(\.|_)(test|spec)\./.test(f))) continue;
      // 后端角色：前端状态/组件目录（如 umami src/store Zustand）不得作配套
      if (BACKEND_ROLES.has(a.role) && isFrontendPath(f, feRoots)) continue;
      // 可选/旁路组件不进主干配套
      if (importance) {
        const inf = importance.info(f);
        if (inf.optional || inf.detached) continue;
      }
      found.push(f);
      if (found.length >= 3) break;
    }
    for (const f of found) {
      if (added.has(f)) continue;
      added.add(f);
      out.push({ role: a.role, layer: a.layer, path: f, hint: a.hint + ' · 执行器', companionOf: a.path });
    }
  }
  // ===== 形态配套（P1）：bridge/proxy/notify-bus 有签名级搭档，语言无关 =====
  // z2m 教训：lib/mqtt.ts、lib/zigbee.ts 是桥接双协议侧，无角色正则能锚到，靠 LLM 捞会漏；
  // ntfy 教训：server/firebase.go、server/webpush.go 是投递侧执行器；
  // caddy 教训：modules/caddyhttp/reverseproxy 是代理核心目录，需作为锚点同级配套。
  // 文件级匹配允许 / _ - 三种分隔：ntfy 投递侧文件是 server_firebase.go / server_webpush.go（下划线前缀）
  const SHAPE_COMPANIONS = [
    { shape: 'bridge', roles: ['api', 'entry', 'worker'],
      fileRe: /(^|[/_-])(mqtt|zigbee|modbus|ble|bluetooth|bacnet|canbus|coordinator|zigate?|deconz|matter|thread|lora|opcua|knx|adapter|protocol|gateway|serial)[\w.-]*\.(py|js|ts|go|rs)$/i,
      dirRe: /(^|\/)(mqtt|zigbee|modbus|coordinators?|protocols?|adapters?|gateways?)(\/|$)/i,
      hint: '协议适配侧（桥接主干，必须连边到对端 actor）', layer: 'api' },
    { shape: 'proxy', roles: ['api', 'entry'],
      fileRe: /(^|[/_-])(reverseproxy|reverse_proxy|proxyhandler|loadbalancer\w*|forwardproxy|upstream\w*)[\w.-]*\.(go|py|js|ts|rs)$/i,
      dirRe: /(^|\/)(reverseproxy|reverse_proxy|proxyhandler|loadbalanc\w*|upstreams?)(\/|$)/i,
      hint: '代理转发核心（必须有 → 源站/上游 actor 的转发边）', layer: 'api' },
    { shape: 'notify-bus', roles: ['realtime', 'notify', 'api', 'entry'],
      // 注意：smtp_server 不入此列——ntfy server/smtp_server.go 是入站收信服务器（邮件→发布），
      // 方向与出站投递相反；出站发信在 mail/sender.go，由 sibling 目录配套收
      fileRe: /(^|[/_-])(firebase|fcm|apns|webpush|web_push|push|mailer|sender|notification_service|notify_service)[\w.-]*\.(go|py|js|ts)$/i,
      dirRe: /(^|\/)(firebase|fcm|apns|webpush|push)(\/|$)/i,
      hint: '推送投递执行器（出站：服务端 → 手机推送服务/浏览器；FCM/APNs/WebPush 对端画外部系统 stadium）', layer: 'monitor' },
    // 兄弟目录配套（scope:sibling）：锚点包的同级独立包，子树搜索永远够不到（ntfy 教训：
    // mail/、webpush/、attachment/、s3/ 都是 server/、db/ 的顶层兄弟，usage1 手写图里它们全在）。
    // 只收目录：附件/对象存储归 storage 层
    { shape: 'notify-bus', roles: ['store'], scope: 'sibling',
      dirRe: /(^|\/)(attachments?|uploads?|s3|blobs?|object[\s_-]?storage|filestore?)(\/|$)/i,
      hint: '附件/对象存储（本地盘内置；S3/Blob 等外部对象存储画虚线标注「可选」）', layer: 'storage' },
    // 独立通道包（mail/ 邮件包等）归 monitor 层；职责方向必须读包内文件名判定，禁止望文生义：
    // sender/dispatcher/notifier=出站投递（→外部 SMTP/推送服务）；server/listener/handler=入站服务（外部→本服务→发布）
    { shape: 'notify-bus', roles: ['notify', 'realtime', 'api'], scope: 'sibling',
      dirRe: /(^|\/)(mail|email|fcm|firebase|smtp)(\/|$)/i,
      hint: '独立通道包（先读包内文件名定方向：sender/dispatcher 类=出站投递→外部服务；server/listener 类=入站接收→内部发布；必须有 api→本包的上游内部边，不得只连外部）', layer: 'monitor' },
    // 推送订阅存储包（ntfy 教训：webpush/ 内全是 store.go/store_sqlite.go，是订阅记录持久化，
    // 不是投递通道）——dirRe 命中后再由包内文件信号校正层级（见下方 storePkg 判定）
    { shape: 'notify-bus', roles: ['store', 'notify', 'realtime'], scope: 'sibling',
      dirRe: /(^|\/)(webpush|web[\s_-]?push|subscriptions?|push[\s_-]?subscriptions?)(\/|$)/i,
      hint: 'WebPush/推送订阅包（包内若为 store/sqlite/repository 文件则是订阅记录存储，归存储层；投递执行器在 server 侧）', layer: 'monitor' }
  ];
  const shapeKind = importance && importance.shape ? importance.shape.kind : null;
  for (const rule of SHAPE_COMPANIONS) {
    if (rule.shape !== shapeKind) continue;
    const seedAnchors = anchors.filter((a) => rule.roles.includes(a.role));
    for (const a of seedAnchors) {
      const anchorDir = tree.dirs.has(a.path) ? a.path : path.dirname(a.path);
      let n = 0;
      for (const f of tree.all) {
        if (n >= 3) break;
        if (anchorPaths.has(f) || added.has(f)) continue;
        const isFile = tree.files.has(f);
        // 默认搜锚点子树；scope:sibling 时也收锚点目录的同级包（ntfy mail/ webpush/ attachment/ s3/ 是 server/ db/ 的顶层兄弟）
        const isSubtree = f !== anchorDir && f.startsWith(anchorDir + '/');
        const isSibling = rule.scope === 'sibling' && f !== anchorDir &&
          path.dirname(f) === path.dirname(anchorDir);
        if (!isSubtree && !isSibling) continue;
        if (isSibling && isFile) continue; // 兄弟配套只收目录（独立包）
        const depthDiff = f.split('/').length - anchorDir.split('/').length;
        if (depthDiff > 2) continue;
        if (isFile) {
          if (!rule.fileRe) continue; // dir-only 规则（scope:sibling）
          if (!ANCHOR_SRC_EXT.test(f) || /(^|\/)(__tests__|tests?|testdata)(\/|$)|(\.|_)(test|spec|dummy)\./.test(f)) continue;
          if (!rule.fileRe.test(f)) continue;
        } else {
          if (TEST_ASSETS_PATH.test(f)) continue;
          if (!rule.dirRe.test(f)) continue;
        }
        if (BACKEND_ROLES.has(a.role) && isFrontendPath(f, feRoots)) continue;
        if (importance) {
          const inf = importance.info(f);
          if (inf.optional || inf.detached) continue;
        }
        // 已加目录配套时，其内部文件/子目录不再重复（reverseproxy/ 目录与 reverseproxy/fastcgi 二选一，目录优先）
        if (out.some((c) => c.shapeCompanion === rule.shape && c.path !== f && f.startsWith(c.path + '/'))) continue;
        if (!isFile) {
          // 浅目录后命中时，替换掉已加的更深配套（祖先优先）
          for (let i = out.length - 1; i >= 0; i--) {
            const c = out[i];
            if (c.shapeCompanion === rule.shape && c.path.startsWith(f + '/')) {
              added.delete(c.path);
              out.splice(i, 1);
              n = Math.max(0, n - 1);
            }
          }
        }
        // 兄弟目录配套：包内文件信号校正层级（ntfy 教训：webpush/ 内全是 store.go/store_sqlite.go/
        // store_postgres.go，是推送订阅记录持久化，不是投递通道；mail/sender.go 则是出站发信）
        let layer = rule.layer, hint = rule.hint;
        if (!isFile && rule.scope === 'sibling') {
          const pkgFiles = [...tree.files].filter((p) => p.startsWith(f + '/') && ANCHOR_SRC_EXT.test(p)
            && !/(^|\/)(__tests__|tests?|testdata)(\/|$)|(\.|_)(test|spec|dummy)\./.test(p))
            .map((p) => path.basename(p));
          // 只看文件名：目录名（如 webpush/）会污染信号——webpush/store.go 的职责是 store，不是 push
          const storeSig = pkgFiles.filter((b) => /(store|repository|repo|dao|sqlite|postgres|mysql|persistence|schema|migration)/i.test(b)).length;
          const sendSig = pkgFiles.filter((b) => /(sender|dispatcher|notifier|mailer|notify|push|webpush|apns|fcm)/i.test(b)).length;
          const inSig = pkgFiles.filter((b) => /[_-](server|listener|receiver|inbound|ingress)\./i.test(b)
            && !/(sse|websocket|socket|push|stream)/i.test(b)).length;
          if (storeSig >= 1 && storeSig >= sendSig) {
            layer = 'storage';
            hint = hint + '【包内文件信号：store/持久化文件为主，校正为存储层——画成存储节点，边为 api 读写订阅记录】';
          } else if (inSig >= 1 && inSig >= sendSig) {
            layer = 'api';
            hint = hint + '【包内文件信号：server/listener 入站文件为主，校正为 API 层——入站协议端点（外部→本服务→内部发布），不是出站通知机制】';
          }
        }
        added.add(f);
        out.push({ role: a.role, layer, path: f, hint, companionOf: a.path, shapeCompanion: rule.shape });
        n++;
      }
    }
  }
  return out;
}

/** story 闸门：主链路边不得经过 optional / detached / 不可达节点。返回问题列表。 */
function storyGate(story, plan, importance, tree) {
  const problems = [];
  if (!story || !Array.isArray(story.mustEdges)) return problems;
  const exists = (p) => tree && (tree.files.has(p) || tree.dirs.has(p) || [...tree.all].some((t) => t === p || t.startsWith(p + '/')));
  for (const me of story.mustEdges) {
    for (const key of ['fromPath', 'toPath']) {
      const p = me[key];
      if (!p || p === '(外部)' || !exists(p)) continue;
      const imp = importance.info(p);
      if (imp.optional) {
        problems.push(`主链路边经过可选组件 ${p}（${imp.optReasons[0]}）：可选组件不得画成必经路径，改为标注「可选」或移出主链路`);
      } else if (imp.detached) {
        problems.push(`主链路边经过旁路组件 ${p}（被 ${imp.heat} 处引用但从进程入口不可达，多为条件注册/实验功能）：不得画成主干必经，降级为旁路标注「可选/实验」`);
      }
    }
  }
  return problems;
}

module.exports = {
  chat, extractJson, chatJson, chatBlock, extractBlockMd, usage, maskKey, modelFor,
  buildTree, gatherExcerpts, lintBlockDiagram, parseMermaid, parseFlowchart,
  layerGate, nodePaths, MODEL, LAYER_RULES,
  findAnchors, coverageGate, injectAnchors, rewritePlanLayers, repairPlan, semanticTraps, snakeId,
  importanceForensics, findAnchorsV2, storyGate, anchorCompanions,
  buildImportGraph, localImports, frameworkEntrypoints, isFrontendPath, loadTsAliases,
  lintDiagram, parseC4, parseClassDiagram,
  sanitizeMermaidEdgeLabel, findUnsafeMermaidEdgeLabels
};
