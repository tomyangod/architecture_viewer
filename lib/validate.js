'use strict';

const fs = require('fs');
const path = require('path');
const { DIAGRAM_FILES } = require('./kit');

const C4_DECL = /(?:Person_Ext|Person|SystemDb_Ext|SystemQueue_Ext|SystemDb|SystemQueue|System_Ext|System|ContainerDb_Ext|ContainerQueue_Ext|Container_Ext|ContainerDb|ContainerQueue|Container|Component_Ext|Component|Container_Boundary|System_Boundary|Enterprise_Boundary)\s*\(\s*([A-Za-z_][\w]*)/g;
const REL = /Rel(?:_[A-Za-z]+)?\s*\(\s*([A-Za-z_][\w]*)\s*,\s*([A-Za-z_][\w]*)/g;
const SECRET = /(\.env\b|api[_-]?key|secret_key|private_key|BEGIN (RSA |OPENSSH )?PRIVATE)/i;
const PLACEHOLDER = /\[你的项目名称\]|用户角色A|服务A|外部系统A|职责描述|模板文件 · 请替换/;

function extractBlocks(content) {
  const headers = [];
  const headerRe = /^## (.+)$/gm;
  let hm;
  while ((hm = headerRe.exec(content))) {
    headers.push({ title: hm[1].trim(), index: hm.index });
  }
  const blocks = [];
  const blockRe = /```mermaid\s*\n([\s\S]*?)```/g;
  let bm;
  while ((bm = blockRe.exec(content))) {
    blocks.push({ code: bm[1], index: bm.index });
  }
  return { headers, blocks };
}

function checkFile(filePath, content, opts) {
  const errors = [];
  const warnings = [];
  const name = path.basename(filePath);
  const { headers, blocks } = extractBlocks(content);

  if (blocks.length === 0) {
    errors.push(`${name}: no mermaid blocks`);
    return { file: name, errors, warnings };
  }
  if (headers.length !== blocks.length) {
    errors.push(`${name}: ${headers.length} ## headers != ${blocks.length} mermaid blocks`);
  }
  if (!content.endsWith('\n')) {
    errors.push(`${name}: missing trailing newline`);
  }
  if (SECRET.test(content)) {
    errors.push(`${name}: possible secret/token leakage`);
  }
  if (opts && opts.requireFilled && PLACEHOLDER.test(content)) {
    errors.push(`${name}: still contains template placeholders`);
  }

  const isC4 = /c4-/.test(name);
  blocks.forEach((block, i) => {
    const n = i + 1;
    const declared = new Set();
    C4_DECL.lastIndex = 0;
    let m;
    while ((m = C4_DECL.exec(block.code))) {
      if (declared.has(m[1])) {
        warnings.push(`${name} sub-${n}: duplicate id "${m[1]}"`);
      }
      declared.add(m[1]);
    }
    REL.lastIndex = 0;
    while ((m = REL.exec(block.code))) {
      for (const id of [m[1], m[2]]) {
        if (declared.size && !declared.has(id)) {
          errors.push(`${name} sub-${n}: Rel(${m[1]}, ${m[2]}) → "${id}" NOT DECLARED`);
        }
      }
    }
    if (isC4 && !/UpdateLayoutConfig\s*\(/.test(block.code)) {
      warnings.push(`${name} sub-${n}: missing UpdateLayoutConfig`);
    }
    const badId = block.code.match(/\b(?:Person|Container|System|Component)\w*\s*\(\s*[^A-Za-z_\s]/);
    if (badId) {
      warnings.push(`${name} sub-${n}: node id should be snake_case ASCII`);
    }
  });

  return { file: name, errors, warnings, blockCount: blocks.length };
}

function validateDir(dir, opts) {
  const options = Object.assign({ requireFilled: false }, opts);
  const results = [];
  const missing = [];
  for (const f of DIAGRAM_FILES) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) {
      missing.push(f);
      results.push({ file: f, errors: [`${f}: file not found`], warnings: [] });
      continue;
    }
    const content = fs.readFileSync(p, 'utf8');
    results.push(checkFile(p, content, options));
  }
  const errors = results.flatMap((r) => r.errors);
  const warnings = results.flatMap((r) => r.warnings);
  return {
    ok: errors.length === 0,
    dir,
    missing,
    results,
    errors,
    warnings
  };
}

function mentionedIds(dir) {
  const ids = new Set();
  if (!fs.existsSync(dir)) return ids;
  for (const f of DIAGRAM_FILES) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8').toLowerCase();
    for (const token of text.split(/[^a-z0-9_]+/)) {
      if (token.length >= 3) ids.add(token);
    }
  }
  return ids;
}

module.exports = {
  extractBlocks,
  checkFile,
  validateDir,
  mentionedIds,
  PLACEHOLDER,
  DIAGRAM_FILES
};
