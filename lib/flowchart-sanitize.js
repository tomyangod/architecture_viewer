'use strict';

/**
 * Flowchart 成片清洗：把 LLM 常写出的「Mermaid Syntax error / 占位图回退」模式
 * 在写盘前消掉，而不是只靠提示词或事后手改。
 *
 * 已知致命模式（舆情 Container 教训）：
 *   1. 外层 APP subgraph 再套 L_* 层 → 嵌套 subgraph，mermaid 解析失败或吞边
 *   2. 圆柱写成 id[( "label" )]（括号内空格）→ Syntax error
 *   3. 边标签含 ()[]{} → 被当成 stadium/矩形语法（已有 sanitizeMermaidEdgeLabel）
 */

const { sanitizeMermaidEdgeLabel } = require('./orch/lib');

function isFlowchartHeader(line) {
  return /^(flowchart|graph)\b/i.test(String(line || '').trim());
}

/**
 * 反复拆掉「内部还含 subgraph」的外层 wrapper，直到扁平。
 * 只删外层的 subgraph / end 行，保留内层分层与节点。
 */
function flattenNestedSubgraphs(code) {
  let lines = String(code || '').split('\n');
  for (let guard = 0; guard < 12; guard++) {
    const ranges = [];
    const stack = [];
    let depth = 0;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^subgraph\b/.test(t)) {
        depth += 1;
        stack.push({ start: i, depth });
      } else if (/^end\s*$/.test(t) && stack.length) {
        const sg = stack.pop();
        sg.end = i;
        ranges.push(sg);
        depth = Math.max(0, depth - 1);
      }
    }
    const parents = ranges.filter(
      (p) =>
        p.depth === 1 &&
        p.end != null &&
        ranges.some((c) => c.depth > 1 && c.start > p.start && c.end < p.end)
    );
    if (!parents.length) break;
    const drop = new Set();
    for (const p of parents) {
      drop.add(p.start);
      drop.add(p.end);
    }
    lines = lines.filter((_, i) => !drop.has(i));
  }
  return lines.join('\n');
}

/** id[( "label" )] / id[( 'label' )] → id[("label")] */
function sanitizeCylinderDecls(code) {
  return String(code || '')
    .replace(/(\b[A-Za-z_][\w]*)\s*\[\(\s*"([\s\S]*?)"\s*\)\]/g, '$1[("$2")]')
    .replace(/(\b[A-Za-z_][\w]*)\s*\[\(\s*'([\s\S]*?)'\s*\)\]/g, "$1[('$2')]");
}

function sanitizeEdgeLabelsInCode(code) {
  return String(code || '').replace(/(-\.?->|---)\s*\|([^|]*)\|/g, (full, arrow, lab) => {
    if (!/[()[\]{}]/.test(lab)) return full;
    const clean = sanitizeMermaidEdgeLabel(lab);
    if (!clean || clean === lab.trim()) return full;
    return `${arrow}|${clean}|`;
  });
}

function sanitizeFlowchartBlock(code) {
  let out = String(code || '');
  const first = out.split('\n').find((l) => l.trim()) || '';
  if (!isFlowchartHeader(first)) return out;
  out = flattenNestedSubgraphs(out);
  out = sanitizeCylinderDecls(out);
  out = sanitizeEdgeLabelsInCode(out);
  return out;
}

/**
 * 对 Markdown 里每个 mermaid 围栏：若是 flowchart/graph，做语法清洗。
 * 非 flowchart（classDiagram / 原生 C4）原样返回。
 */
function sanitizeFlowchartMarkdown(md) {
  if (!md || typeof md !== 'string') return md;
  return md.replace(/```mermaid\s*\n([\s\S]*?)```/g, (full, body) => {
    const cleaned = sanitizeFlowchartBlock(body.trimEnd());
    return '```mermaid\n' + cleaned + '\n```';
  });
}

module.exports = {
  flattenNestedSubgraphs,
  sanitizeCylinderDecls,
  sanitizeEdgeLabelsInCode,
  sanitizeFlowchartBlock,
  sanitizeFlowchartMarkdown
};
