'use strict';

/**
 * 绿灯文案：区分「源码内容变了但结构没变」与「源码和结构都没变」。
 * summary.sourceChanged: true | false | null（旧基线没有 contentFingerprint 时为 null）
 */
function describeGreenLight(summary) {
  const s = summary || {};
  const tc = s.totalChanges || 0;
  const implN = s.implChangedCount || 0;
  if (tc > 0) {
    const implNote = implN > 0 ? `另有 ${implN} 个函数体实现变化。` : '';
    return {
      kind: 'struct-ok',
      cli: `有 ${tc} 项架构变更，但无风险发现。${implNote}未检查业务逻辑。`,
      htmlNotice: null,
      htmlFindings: null,
      mcp: `✅ 绿灯 — 有 ${tc} 项架构变更，但无风险发现。${implNote}未检查业务逻辑。`,
      mcpShort: `有 ${tc} 项架构变更，但无风险发现。${implNote}未检查业务逻辑。`,
      pr: null
    };
  }
  if (implN > 0) {
    return {
      kind: 'impl-only',
      cli: `检测到源码内容变化（${implN} 个函数体实现差异），未检测到架构结构变化。未判定业务对错。`,
      htmlNotice: `✅ 检测到源码内容变化（${implN} 个函数体实现差异），未检测到架构结构变化。结构指纹只看类型 / import 边 / 分层；函数体变化见下方「实现差异」。未判定业务对错。`,
      htmlFindings: `检测到源码内容变化（${implN} 个函数体实现差异），未检测到架构结构变化。请对列出的函数补测试与审查。未判定业务对错。`,
      mcp: `✅ 绿灯 — 检测到 ${implN} 个函数体实现变化，未检测到架构结构变化。未判定业务对错，请配合测试与代码审查。`,
      mcpShort: `检测到 ${implN} 个函数体实现变化，未检测到架构结构变化。未判定业务对错。`,
      pr: `**✅ 本次 PR 未检测到架构结构变更**（实体、依赖边、外部依赖均无增减）。已检测到 ${implN} 个函数体实现差异——请配合单元测试、集成测试和代码审查。未判定业务对错。`
    };
  }
  if (s.sourceChanged === true) {
    return {
      kind: 'source-only',
      cli: '检测到源码内容变化，未检测到架构结构变化。未检查业务逻辑。',
      htmlNotice: '✅ 检测到源码内容变化，未检测到架构结构变化。结构指纹只看类型 / import 边 / 分层，函数体、日志字符串、注释不进指纹。绿灯不等于业务逻辑正确。',
      htmlFindings: '检测到源码内容变化，未检测到架构结构变化。函数体 / 文案 / 注释不进结构指纹。未检查业务逻辑。',
      mcp: '✅ 绿灯 — 检测到源码内容变化，未检测到架构结构变化。结构指纹只看类型 / import 边 / 分层。未检查业务逻辑。',
      mcpShort: '检测到源码内容变化，未检测到架构结构变化。未检查业务逻辑。',
      pr: '**✅ 本次 PR 未检测到架构结构变更**（实体、依赖边、外部依赖均无增减）。已检测到源码内容变化，但结构指纹无变化——函数体、日志、注释不进指纹。未检查业务逻辑。'
    };
  }
  if (s.sourceChanged === false) {
    return {
      kind: 'unchanged',
      cli: '源码与结构均未变化。未检查业务逻辑。',
      htmlNotice: '✅ 源码与结构均未变化。未检查业务逻辑。',
      htmlFindings: '源码与结构均未变化。未检查业务逻辑。',
      mcp: '✅ 绿灯 — 源码与结构均未变化。未检查业务逻辑。',
      mcpShort: '源码与结构均未变化。未检查业务逻辑。',
      pr: '**✅ 本次 PR 未检测到架构结构变更**（实体、依赖边、外部依赖均无增减）。源码内容指纹与结构指纹均未变化。未检查业务逻辑。'
    };
  }
  return {
    kind: 'unknown-source',
      cli: '未检测到架构结构变化（源代码内容可能已修改）。未检查业务逻辑。',
      htmlNotice: '✅ 未检测到架构结构变化——<strong>不是源码没变</strong>。结构指纹只看类型 / import 边 / 分层，函数体、日志字符串、注释不进指纹，所以这里是 0 节点 / 0 边 / 0 findings。绿灯不等于业务逻辑正确。',
      htmlFindings: '未检测到架构结构变化——不是源码没变。函数体 / 文案 / 注释不进结构指纹。未检查业务逻辑。',
      mcp: '✅ 绿灯 — 未检测到架构结构变化（源代码内容可能已修改）。结构指纹只看类型 / import 边 / 分层，函数体、日志、注释不进指纹。未检查业务逻辑。',
      mcpShort: '未检测到架构结构变化（源代码内容可能已修改）。未检查业务逻辑。',
      pr: '**✅ 本次 PR 未检测到架构结构变更**（实体、依赖边、外部依赖均无增减）。源代码内容可能已修改，但结构指纹无变化——函数体、日志、注释不进指纹。未检查业务逻辑。'
  };
}

module.exports = { describeGreenLight };
