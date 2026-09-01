'use strict';

/**
 * Optional LLM generate via DeepSeek (OpenAI-compatible API).
 *
 * Env:
 *   DEEPSEEK_API_KEY   required
 *   DEEPSEEK_BASE_URL  default https://api.deepseek.com
 *   DEEPSEEK_MODEL     default deepseek-chat
 *
 * Usage:
 *   DEEPSEEK_API_KEY=sk-... node lib/llm-generate.js /path/to/repo
 *   DEEPSEEK_API_KEY=sk-... node lib/llm-generate.js /path/to/repo --only block-diagram.md
 *
 * Writes only the 6 diagram .md files under the kit dir. Does not touch HTML/config.
 */

const fs = require('fs');
const path = require('path');
const { scan } = require('./scan');
const { findKitDir, initKit, writeGenerated, productRoot } = require('./init');
const { validateDir } = require('./validate');
const { DIAGRAM_FILES } = require('./kit');
const { buildTree, lintDiagram } = require('./orch/lib');

const BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

function parseArgs(argv) {
  const out = { _: [], only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') out.only = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

function buildInventoryDigest(inv) {
  return JSON.stringify(
    {
      title: inv.title,
      folder: inv.folder,
      languages: inv.languages,
      entrypoints: inv.entrypoints,
      modules: inv.modules,
      services: inv.services,
      artifacts: inv.artifacts,
      deploy: inv.deploy,
      classes: inv.classes.slice(0, 20),
      packages: inv.packages.slice(0, 15)
    },
    null,
    2
  );
}

const PLACEHOLDER_LINE =
  /\*?模板文件\s*[·•]\s*请替换[^\n]*\n?/g;
const PLACEHOLDER_ANY =
  /\[你的项目名称\]|用户角色A|服务A|外部系统A|职责描述|模板文件\s*[·•]\s*请替换/;

/** Strip kit template footers the model often copies into finished diagrams. */
function sanitizeDiagramMd(md) {
  if (!md || typeof md !== 'string') return md;
  let text = md.replace(PLACEHOLDER_LINE, '');
  // Drop trailing blank lines then ensure single trailing newline
  text = text.replace(/\s+$/u, '\n');
  if (!text.endsWith('\n')) text += '\n';
  return text;
}

function stillHasPlaceholder(md) {
  return PLACEHOLDER_ANY.test(md || '');
}

function systemPrompt(agentMd) {
  return [
    '你是架构图生成器。只输出 Markdown 文件内容，不要解释。',
    '必须遵守下列 AGENT 规范，尤其是 block-diagram 的彩色分层 flowchart 视觉规范。',
    '节点要用真实扫描到的模块/服务/文件名，禁止臆造。',
    'block-diagram.md 必须用 flowchart + 彩色 subgraph，节点格式：图标 + 中文名 + <br/><small>文件或技术</small>。',
    'C4 图 Rel 两端必须先声明。',
    '禁止输出任何模板占位或页脚，例如「*模板文件 · 请替换为你项目的实际内容*」、[你的项目名称]、用户角色A、服务A。',
    '每个文件必须是可直接提交的成品图，不是 Init 模板。',
    '',
    agentMd
  ].join('\n');
}

function userPrompt(inv, files) {
  return [
    '根据下列仓库扫描摘要，生成这些文件的完整 Markdown 内容：',
    files.join(', '),
    '',
    '请用 JSON 对象返回，key 为文件名，value 为完整 md 文本（含 ## 标题与 mermaid 围栏）。',
    '不要包在 ```json 里，直接输出可 JSON.parse 的对象。',
    '',
    '仓库扫描摘要：',
    buildInventoryDigest(inv)
  ].join('\n');
}

// 修复提示：把闸门报错反馈给 LLM，要求逐文件修正
function repairPrompt(fileName, original, issues, inv) {
  return [
    `你之前生成的 ${fileName} 未通过结构闸门，存在以下问题：`,
    issues.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    '',
    '规则：',
    '- 所有 Rel/关系边的两端节点必须先声明（C4 用 Person/System/Container/Component，classDiagram 用 class，flowchart 用 id[形状]）',
    '- 节点描述中引用的文件/目录路径必须在仓库中真实存在，禁止臆造',
    '- 每个节点至少有一条关系边连接（孤立节点删除或补边）',
    '- 节点数须在合理范围（C4 ≥3，classDiagram ≥2，deployment ≥3）',
    '- mermaid 头类型须匹配：c4-context 用 C4Context，c4-container 用 C4Container，c4-component 用 C4Component，class-diagram 用 classDiagram，deployment-ops 用 flowchart',
    '',
    '仓库扫描摘要（真实模块/文件，只能引用这些）：',
    buildInventoryDigest(inv),
    '',
    '以下是你之前生成的内容，请输出修正后的完整 md 文本（含 ## 标题与 mermaid 围栏，不要 JSON，不要解释）：',
    '-----8<-----',
    original,
    '-----8<-----'
  ].join('\n');
}

async function chat(messages, chatOpts) {
  const key = (chatOpts && chatOpts.apiKey) || process.env.DEEPSEEK_API_KEY;
  if (!key) {
    const err = new Error('缺少 DEEPSEEK_API_KEY。请先 export DEEPSEEK_API_KEY=sk-...');
    err.status = 401;
    throw err;
  }
  const url = BASE.replace(/\/$/, '') + '/v1/chat/completions';
  const payload = {
    model: MODEL,
    temperature: 0.2,
    messages
  };
  if (!chatOpts || chatOpts.json !== false) {
    payload.response_format = { type: 'json_object' };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key
    },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error('DeepSeek API HTTP ' + res.status + ': ' + text.slice(0, 400));
  }
  const data = JSON.parse(text);
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('DeepSeek 返回空 content');
  return content;
}

function extractJson(content) {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('无法解析模型返回的 JSON');
    return JSON.parse(m[0]);
  }
}

async function llmGenerate(repoRoot, opts) {
  const options = Object.assign({ only: null }, opts);
  const root = path.resolve(repoRoot);
  let kitDir;
  if (options.kitDir) {
    kitDir = path.resolve(options.kitDir);
    fs.mkdirSync(kitDir, { recursive: true });
  } else {
    kitDir = findKitDir(root);
    if (!kitDir) kitDir = initKit(root, options.dir).dest;
  }

  const agentMd = fs.readFileSync(path.join(productRoot(), 'AGENT.md'), 'utf8');
  const inv = scan(root);
  const files = options.only
    ? [options.only]
    : DIAGRAM_FILES.slice();
  const chatOpts = { apiKey: options.apiKey };

  const out = {};
  if (files.includes('block-diagram.md')) {
    const { generateBlockOrch4 } = require('./orch/block-gen');
    console.log('block-diagram.md → 精修引擎（重要性取证 + 结构/视觉闸门 + 确定性扫尾，约 30–90 秒）…');
    const block = await generateBlockOrch4(root, { apiKey: options.apiKey });
    out['block-diagram.md'] = block.md.endsWith('\n') ? block.md : block.md + '\n';
  }

  const rest = files.filter((f) => f !== 'block-diagram.md');
  const tree = buildTree(root);
  const gateReport = {};
  if (rest.length) {
    const raw = await chat(
      [
        { role: 'system', content: systemPrompt(agentMd) },
        { role: 'user', content: userPrompt(inv, rest) }
      ],
      Object.assign({ json: true }, chatOpts)
    );
    const obj = extractJson(raw);
    for (const f of rest) {
      if (typeof obj[f] === 'string' && obj[f].includes('```mermaid')) {
        out[f] = sanitizeDiagramMd(obj[f]);
      }
    }

    const missing = rest.filter((f) => !out[f]);
    if (missing.length) {
      console.log('  缺图重试：' + missing.join(', '));
      try {
        const raw2 = await chat(
          [
            { role: 'system', content: systemPrompt(agentMd) },
            {
              role: 'user',
              content:
                userPrompt(inv, missing) +
                '\n\n上一轮漏了这些文件。必须全部生成，且禁止任何「模板文件 · 请替换」页脚。'
            }
          ],
          Object.assign({ json: true }, chatOpts)
        );
        const obj2 = extractJson(raw2);
        for (const f of missing) {
          if (typeof obj2[f] === 'string' && obj2[f].includes('```mermaid')) {
            out[f] = sanitizeDiagramMd(obj2[f]);
          }
        }
      } catch (e) {
        console.log('  缺图重试失败：' + e.message);
      }
    }

    // 协议闸门：逐图 lint（头类型/幽灵端点/孤儿节点/节点数/路径核查），不合格则修复一轮
    for (const f of rest) {
      if (!out[f]) continue;
      if (stillHasPlaceholder(out[f])) {
        out[f] = sanitizeDiagramMd(out[f]);
      }
      let lint = lintDiagram(out[f], f, tree);
      gateReport[f] = { issues: lint.issues.length, metrics: lint.metrics, repaired: false };
      if (lint.issues.length === 0) continue;
      console.log(`  ${f} → 闸门发现 ${lint.issues.length} 个问题，修复中…`);
      lint.issues.slice(0, 8).forEach((s) => console.log('    · ' + s));
      try {
        const fixed = await chat(
          [
            {
              role: 'system',
              content:
                '你是架构图修复器。只输出修正后的完整 Markdown 内容，不要解释、不要 JSON。禁止模板占位页脚。'
            },
            { role: 'user', content: repairPrompt(f, out[f], lint.issues.slice(0, 12), inv) }
          ],
          Object.assign({ json: false }, chatOpts)
        );
        const fixedMd = sanitizeDiagramMd(fixed.includes('```mermaid') ? fixed : '');
        if (fixedMd) {
          const fixedLint = lintDiagram(fixedMd, f, tree);
          // 仅当修复后问题数减少才采纳
          if (fixedLint.issues.length < lint.issues.length) {
            out[f] = fixedMd;
            gateReport[f] = {
              issues: fixedLint.issues.length,
              metrics: fixedLint.metrics,
              repaired: true,
              remaining: fixedLint.issues
            };
            console.log(`    ✓ 修复后剩余 ${fixedLint.issues.length} 个问题`);
          } else {
            console.log(`    · 修复未改善（仍 ${fixedLint.issues.length} 个），保留原稿`);
          }
        }
      } catch (e) {
        console.log(`    · 修复请求失败：${e.message}`);
      }
    }
  }
  if (!Object.keys(out).length) {
    throw new Error('模型未返回有效 mermaid 文件。');
  }
  for (const f of Object.keys(out)) {
    out[f] = sanitizeDiagramMd(out[f]);
    if (stillHasPlaceholder(out[f])) {
      throw new Error(f + ' 精修后仍含模板占位符，请重试 --refine。');
    }
  }

  // Keep non-generated diagrams if --only
  if (options.only) {
    for (const f of DIAGRAM_FILES) {
      if (out[f]) continue;
      const p = path.join(kitDir, f);
      if (fs.existsSync(p)) out[f] = fs.readFileSync(p, 'utf8');
    }
  }

  const written = writeGenerated(kitDir, out);
  const protocol = validateDir(kitDir, { requireFilled: false });
  return { kitDir, inventory: inv, written, protocol, model: MODEL, gateReport };
}

async function main(argv) {
  const args = parseArgs(argv);
  const repo = args._[0] || process.cwd();
  console.log('LLM generate via', MODEL, '→', path.resolve(repo));
  const result = await llmGenerate(repo, { only: args.only });
  console.log('Wrote:', result.written.join(', '));
  console.log('Kit:', result.kitDir);
  // 闸门结果汇总
  const gate = result.gateReport || {};
  for (const [f, r] of Object.entries(gate)) {
    const tag = r.repaired ? '修复' : (r.issues === 0 ? '通过' : '告警');
    console.log(`  闸门 ${f}: ${tag}（${r.metrics.节点数}节点/${r.metrics.边数}边${r.issues ? `，${r.issues}问题` : ''}）`);
  }
  if (result.protocol.errors.length) {
    console.warn('Validate warnings/errors:');
    result.protocol.errors.forEach((e) => console.warn(' ERROR', e));
    result.protocol.warnings.forEach((w) => console.warn(' WARN', w));
  } else {
    console.log('Protocol OK (basic)');
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { llmGenerate, sanitizeDiagramMd, stillHasPlaceholder };
