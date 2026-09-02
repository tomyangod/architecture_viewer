'use strict';

/**
 * Architecture Viewer MCP Server
 *
 * 暴露 4 个工具给 AI Agent（Cursor/Claude/Codex）：
 *   av_session_start    — AI 改代码前记录基线
 *   av_session_report   — AI 改完后返回架构 diff + 风险 + 影响面
 *   av_check_layering   — 实时检测当前代码的跨层违规（不需要基线）
 *   av_explain_finding  — 解释一条违规的结构化事实
 *
 * 刻意不暴露图谱查询工具（谁依赖谁）——那是 codebase-memory-mcp 的主场。
 * AV 给 Agent 的是判断和结论，不是原材料。
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { evaluateRisk, summarizeFindings, LAYER_LABEL } = require('../lib/risk-rules');
const { computeImpact } = require('../lib/impact');
const { generateReport } = require('../lib/session-report');

function avDir(repo) {
  return path.join(repo, '.av');
}

function baselinePath(repo) {
  return path.join(avDir(repo), 'graph-baseline.json');
}

function writeLayerSuggestions(repo, graph) {
  const dir = avDir(repo);
  fs.mkdirSync(dir, { recursive: true });
  const suggestedPath = path.join(dir, 'layers.suggested.json');
  if (graph.layerSignals && Object.keys(graph.layerSignals).length > 0) {
    fs.writeFileSync(suggestedPath, JSON.stringify(graph.layerSignals, null, 2));
    return suggestedPath;
  }
  return null;
}

function formatFinding(f) {
  const icon = f.severity === 'high' ? '🔴' : f.severity === 'medium' ? '🟠' : f.severity === 'low' ? '🔵' : '⚪';
  return `${icon} [${f.severity.toUpperCase()}] ${f.title}: ${f.message}\n   ${f.detail || ''}`;
}

function formatImpact(impact) {
  if (!impact || !impact.items || impact.items.length === 0) return '无影响面数据';
  const lines = [`被改实体 ${impact.summary.changed} 个，受影响下游 ${impact.summary.affected} 个`];
  for (const it of impact.items.slice(0, 5)) {
    const direct = (it.direct || []).length;
    const transitive = (it.transitive || []).length;
    lines.push(`  • [${it.change}] ${it.id} → 直接下游 ${direct}，间接 ${transitive}`);
  }
  return lines.join('\n');
}

function toolSessionStart(args) {
  const repo = path.resolve(args.repo);
  if (!fs.existsSync(repo)) throw new Error(`路径不存在: ${repo}`);
  fs.mkdirSync(avDir(repo), { recursive: true });
  const graph = buildGraph(repo);
  const snapshot = { ...graph, sessionStartedAt: new Date().toISOString() };
  fs.writeFileSync(baselinePath(repo), JSON.stringify(snapshot, null, 2));
  const suggested = writeLayerSuggestions(repo, graph);

  return {
    baseline: {
      files: graph.stats.files,
      types: graph.stats.types,
      edges: graph.stats.edges,
      externalPackages: graph.stats.externalPackages,
      fingerprint: graph.fingerprint,
      savedTo: baselinePath(repo)
    },
    layerSuggestions: suggested
      ? { path: suggested, note: '审阅无误无需操作；复制为 .av/layers.json 可锁定' }
      : null,
    message: `基线已记录（${graph.stats.files} 文件, ${graph.stats.types} 类型）。AI 改完代码后调用 av_session_report 验收。`
  };
}

function toolSessionReport(args) {
  const repo = path.resolve(args.repo);
  const bp = baselinePath(repo);
  if (!fs.existsSync(bp)) {
    return { error: 'NO_BASELINE', message: '未找到基线。请先调用 av_session_start 记录基线。' };
  }
  const baseline = JSON.parse(fs.readFileSync(bp, 'utf8'));
  const sessionStart = baseline.sessionStartedAt;
  const current = buildGraph(repo);
  const diff = diffGraphs(baseline, current);
  const impact = computeImpact(diff, baseline, current);
  const findings = evaluateRisk(diff, current, baseline, impact);
  const riskSummary = summarizeFindings(findings);

  const dir = avDir(repo);
  const reportJsonPath = path.join(dir, 'session-report.json');
  const htmlPath = path.join(dir, 'session-report.html');
  fs.writeFileSync(reportJsonPath, JSON.stringify({ diff, findings, riskSummary, impact }, null, 2));
  const html = generateReport({
    baseGraph: baseline, headGraph: current, diff, findings, impact,
    repoName: path.basename(repo), sessionStart
  });
  fs.writeFileSync(htmlPath, html);

  return {
    summary: {
      ...diff.summary,
      baseFingerprint: diff.base.fingerprint,
      headFingerprint: diff.head.fingerprint,
      riskLevel: riskSummary.level,
      riskCount: findings.length,
      riskCounts: riskSummary.counts
    },
    findings: findings.map(formatFinding),
    impact: formatImpact(impact),
    reportPaths: { json: reportJsonPath, html: htmlPath },
    message: riskSummary.level === 'high'
      ? `🔴 HIGH 风险 — ${findings.length} 条发现，建议逐条审查后再提交。`
      : riskSummary.level === 'medium'
        ? `🟠 MEDIUM 风险 — ${findings.length} 条发现，请关注。`
        : riskSummary.level === 'low'
          ? `🔵 LOW 风险 — ${findings.length} 条提示，可酌情处理。`
          : `✅ NONE — 无风险发现，结构变更正常。`
  };
}

function toolCheckLayering(args) {
  const repo = path.resolve(args.repo);
  if (!fs.existsSync(repo)) throw new Error(`路径不存在: ${repo}`);
  const graph = buildGraph(repo);

  const emptyBase = { nodes: [], edges: [], fingerprint: '', root: graph.root, stats: {} };
  const diff = diffGraphs(emptyBase, graph);
  const findings = evaluateRisk(diff, graph, emptyBase, null);
  const riskSummary = summarizeFindings(findings);

  const layered = graph.nodes.filter(n => n.layer && n.kind !== 'file' && n.kind !== 'external');
  const total = graph.nodes.filter(n => n.kind !== 'file' && n.kind !== 'external');
  const layerDist = {};
  for (const n of layered) {
    layerDist[n.layer] = (layerDist[n.layer] || 0) + 1;
  }

  return {
    repo: graph.root,
    fingerprint: graph.fingerprint,
    stats: graph.stats,
    layerCoverage: {
      layered: layered.length,
      total: total.length,
      coverage: total.length > 0 ? `${Math.round(layered.length / total.length * 100)}%` : '0%'
    },
    layerDistribution: layerDist,
    riskLevel: riskSummary.level,
    riskCount: findings.length,
    findings: findings.map(formatFinding),
    message: riskSummary.level === 'none'
      ? `✅ 无跨层违规 — ${layered.length}/${total.length} 个实体已分层，覆盖率 ${total.length > 0 ? Math.round(layered.length / total.length * 100) : 0}%。`
      : `${findings.length} 条风险发现（${riskSummary.level.toUpperCase()}），详见 findings。`
  };
}

function toolExplainFinding(args) {
  const repo = path.resolve(args.repo);
  const bp = baselinePath(repo);
  const hasBaseline = fs.existsSync(bp);

  let graph, baseline, diff, impact, findings;

  // 尝试从会话报告取数据
  if (hasBaseline && args.from === 'session') {
    const reportPath = path.join(avDir(repo), 'session-report.json');
    if (fs.existsSync(reportPath)) {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      if (report.findings && report.findings.length > 0) {
        diff = report.diff;
        impact = report.impact;
        baseline = JSON.parse(fs.readFileSync(bp, 'utf8'));
        graph = buildGraph(repo);
        findings = report.findings;
      }
    }
  }

  // fallback：实时检测——用空基线，让所有边都算"新增"，从而检测出当前图内部的跨层违规
  if (!findings) {
    graph = buildGraph(repo);
    const emptyBase = { nodes: [], edges: [], fingerprint: '', root: graph.root, stats: {} };
    diff = diffGraphs(emptyBase, graph);
    impact = computeImpact(diff, emptyBase, graph);
    findings = evaluateRisk(diff, graph, emptyBase, impact);
  }

  // 从 findings 里找匹配项；findings 可能是原始对象或已格式化的字符串
  let target = findings.find((f, i) => {
    if (typeof f === 'string') return false;
    return (args.rule && f.rule === args.rule) ||
           (args.index !== undefined && i === args.index);
  });

  // 如果 findings 是字符串数组，重新生成原始对象
  if (!target && findings.length > 0 && typeof findings[0] === 'string') {
    const rawFindings = evaluateRisk(diff, graph, baseline, impact);
    target = rawFindings.find((f, i) =>
      (args.rule && f.rule === args.rule) ||
      (args.index !== undefined && i === args.index)
    );
  }

  if (!target) {
    return { error: 'NOT_FOUND', message: `未找到匹配的违规。当前共 ${findings.length} 条发现。` };
  }

  return buildExplainResult(target, diff, graph);
}

function buildExplainResult(target, diff, graph) {
  let edgeEvidence = null;
  if (target.rule === 'cross-layer-violation' || target.rule === 'layer-skip') {
    const edge = (diff.addedEdges || []).find(e => {
      const fromNode = graph.nodes.find(n => n.id === e.from);
      const toNode = graph.nodes.find(n => n.id === e.to);
      return fromNode && toNode &&
        target.detail && target.detail.includes(fromNode.name) && target.detail.includes(toNode.name);
    });
    if (edge) {
      const fromNode = graph.nodes.find(n => n.id === edge.from);
      const toNode = graph.nodes.find(n => n.id === edge.to);
      edgeEvidence = {
        edgeType: edge.type,
        from: { id: edge.from, name: fromNode?.name, layer: fromNode?.layer, file: fromNode?.path, layerSignal: fromNode?.layerSignal },
        to: { id: edge.to, name: toNode?.name, layer: toNode?.layer, file: toNode?.path, layerSignal: toNode?.layerSignal },
        file: edge.file,
        line: edge.line
      };
    }
  }

  return {
    finding: formatFinding(target),
    rule: target.rule,
    severity: target.severity,
    edgeEvidence,
    suggestion: target.rule === 'cross-layer-violation' || target.rule === 'layer-skip'
      ? '在 from 和 to 之间引入 service 层进行中转，或将直接依赖改为通过接口/依赖注入。'
      : target.rule === 'removed-type'
        ? '检查是否有其他代码引用了被删除的类型，必要时保留或提供迁移路径。'
        : target.rule === 'new-external-dep'
          ? '确认新依赖是否必要，检查许可证和安全性。'
          : '请根据具体 finding 内容判断。'
  };
}

const TOOLS = [
  {
    name: 'av_session_start',
    description: 'AI 改代码前记录架构基线。在 Agent 开始修改代码之前调用。返回基线指纹和自动分层建议。不需要 API Key，完全离线。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '项目仓库的绝对路径' }
      },
      required: ['repo']
    }
  },
  {
    name: 'av_session_report',
    description: 'AI 改完代码后生成架构变更报告。返回新增/删除/修改的节点和边、风险发现、影响面。HIGH 风险建议拦截提交。需要先调用 av_session_start。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '项目仓库的绝对路径' },
        from: { type: 'string', enum: ['session'], description: '可选：从会话报告取数据' }
      },
      required: ['repo']
    }
  },
  {
    name: 'av_check_layering',
    description: '实时检测当前代码的跨层违规，不需要预先记录基线。适合 Agent 改完代码后立刻自查。返回分层覆盖率、每层实体数、违规列表。完全离线，1-2 秒完成。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '项目仓库的绝对路径' }
      },
      required: ['repo']
    }
  },
  {
    name: 'av_explain_finding',
    description: '解释一条架构违规的结构化事实：谁→谁、哪条边、依据什么分层、修复建议。可按 rule 名或序号定位。',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '项目仓库的绝对路径' },
        rule: { type: 'string', description: '规则名（cross-layer-violation, layer-skip, removed-type, new-external-dep）' },
        index: { type: 'integer', description: 'findings 列表中的序号（0-based）' },
        from: { type: 'string', enum: ['session'], description: '可选：从会话报告取数据而非实时检测' }
      },
      required: ['repo']
    }
  }
];

function handleToolCall(params) {
  const { name, arguments: args } = params;
  switch (name) {
    case 'av_session_start': return toolSessionStart(args || {});
    case 'av_session_report': return toolSessionReport(args || {});
    case 'av_check_layering': return toolCheckLayering(args || {});
    case 'av_explain_finding': return toolExplainFinding(args || {});
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

function createServer() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  function send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
  }

  function handleRequest(msg) {
    const { id, method, params } = msg;
    try {
      switch (method) {
        case 'initialize':
          send({
            jsonrpc: '2.0', id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'architecture-viewer', version: '0.10.0' }
            }
          });
          break;
        case 'notifications/initialized':
          break;
        case 'tools/list':
          send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
          break;
        case 'tools/call': {
          const result = handleToolCall(params);
          send({
            jsonrpc: '2.0', id,
            result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
          });
          break;
        }
        default:
          send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
    } catch (e) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
    }
  }

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try { msg = JSON.parse(trimmed); } catch { return; }
    handleRequest(msg);
  });

  return { rl };
}

module.exports = { TOOLS, handleToolCall, toolSessionStart, toolSessionReport, toolCheckLayering, toolExplainFinding, buildExplainResult, createServer };

if (require.main === module) {
  createServer();
}
