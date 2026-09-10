'use strict';

/**
 * Evaluate Import Linter contracts against the builtin file-import graph.
 * Does not spawn lint-imports; uses fields from parseContractConfig().
 *
 * Mapping (same as importlinter adapter, so merge.js can dedup):
 *   layers      → cross-layer-violation
 *   forbidden   → layer-skip when AV layers prove controller/component/entrypoint → storage
 *               → forbid-cross-layer otherwise
 *   independence → independence-violation
 */

const fs = require('fs');
const path = require('path');
const { ANALYZER_IDS, CONFIDENCE } = require('./analyzer');
const { findImportLinterConfig, parseContractConfig } = require('./contract-config');
const { loadLayerDefinitions, matchUserLayer } = require('../layer-infer');
const { changedFilesFromDiff, touchesChangedFiles, normalizeFilePath } = require('./paths');

const FINDING_CAP = 20;

function relToPythonModule(rel, repo) {
  if (!rel || !rel.endsWith('.py')) return null;
  let modulePath = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  if (modulePath.startsWith('src/') && !fs.existsSync(path.join(repo, 'src', '__init__.py'))) {
    modulePath = modulePath.slice(4);
  }
  const name = modulePath.replace(/\/__init__\.py$/, '').replace(/\.py$/, '').replace(/\//g, '.');
  return /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(name) ? name : null;
}

function fileRel(node) {
  if (!node) return null;
  if (typeof node.path === 'string' && node.path) return node.path.replace(/\\/g, '/');
  if (typeof node.id === 'string' && node.id.startsWith('file:')) return node.id.slice(5).replace(/\\/g, '/');
  return null;
}

function wildcardRe(pattern) {
  const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function moduleMatches(fileModule, listed, asPackages) {
  if (!fileModule || !listed) return false;
  if (listed.includes('*')) return wildcardRe(listed).test(fileModule);
  if (fileModule === listed) return true;
  return asPackages !== false && fileModule.startsWith(`${listed}.`);
}

function matchesAny(fileModule, listed, asPackages) {
  return (listed || []).some((item) => moduleMatches(fileModule, item, asPackages));
}

function parseIgnorePair(raw) {
  const m = /^\s*(.+?)\s*->\s*(.+?)\s*$/.exec(String(raw || ''));
  if (!m) return null;
  return { from: m[1].trim(), to: m[2].trim() };
}

function isIgnored(fromModule, toModule, ignore, asPackages) {
  for (const raw of ignore || []) {
    const pair = parseIgnorePair(raw);
    if (!pair) continue;
    if (moduleMatches(fromModule, pair.from, asPackages) && moduleMatches(toModule, pair.to, asPackages)) {
      return true;
    }
  }
  return false;
}

function expandLayers(contract) {
  const containers = contract.containers || [];
  return (contract.layers || []).map((raw) => {
    const optional = /^\(.*\)$/.test(raw);
    const name = optional ? raw.slice(1, -1) : raw;
    const modules = containers.length ? containers.map((c) => `${c}.${name}`) : [name];
    return { name, optional, modules };
  });
}

function buildImportGraph(graph, repo, asPackages, ignore) {
  const files = [];
  const byId = new Map();
  for (const node of graph.nodes || []) {
    if (node.kind && node.kind !== 'file') continue;
    const rel = fileRel(node);
    if (!rel) continue;
    const moduleName = relToPythonModule(rel, repo);
    const record = {
      id: node.id || `file:${rel}`,
      rel,
      module: moduleName,
      path: rel
    };
    files.push(record);
    byId.set(record.id, record);
  }

  const adj = new Map();
  const edges = [];
  for (const edge of graph.edges || []) {
    if (edge.type !== 'import') continue;
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to || !from.module || !to.module) continue;
    if (isIgnored(from.module, to.module, ignore, asPackages)) continue;
    if (!adj.has(from.id)) adj.set(from.id, []);
    adj.get(from.id).push(to.id);
    edges.push({ from, to, file: edge.file || from.rel, line: edge.line || null });
  }
  return { files, byId, adj, edges };
}

function findPath(adj, startId, isTarget, byId) {
  if (isTarget(byId.get(startId))) return [startId];
  const seen = new Set([startId]);
  const queue = [startId];
  const parent = new Map();
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adj.get(cur) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      parent.set(next, cur);
      if (isTarget(byId.get(next))) {
        const pathIds = [next];
        while (pathIds[pathIds.length - 1] !== startId) {
          pathIds.push(parent.get(pathIds[pathIds.length - 1]));
        }
        return pathIds.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

function chainModules(pathIds, byId) {
  return pathIds.map((id) => byId.get(id)?.module).filter(Boolean);
}

function avLayer(rel, layers) {
  if (!rel || !layers) return null;
  return matchUserLayer(rel, layers)?.layer || null;
}

function mapForbiddenRule(fromRel, toRel, layers) {
  const fromLayer = avLayer(fromRel, layers);
  const toLayer = avLayer(toRel, layers);
  const isSkip =
    (fromLayer === 'controller' || fromLayer === 'component' || fromLayer === 'entrypoint') &&
    toLayer === 'storage';
  if (isSkip) {
    return {
      rule: 'layer-skip',
      title: '层级穿透（契约）',
      fromLayer,
      toLayer
    };
  }
  return {
    rule: 'forbid-cross-layer',
    title: '禁止跨层导入（契约）',
    fromLayer,
    toLayer
  };
}

function makeFinding(partial) {
  return {
    severity: 'high',
    edgeType: 'import',
    sourceAnalyzer: ANALYZER_IDS.BUILTIN,
    confidence: CONFIDENCE.MEDIUM,
    line: partial.line || null,
    ...partial
  };
}

function pushCapped(out, finding, cap) {
  if (out.length >= cap) return;
  out.push(finding);
}

function evaluateForbidden(contract, world, layers, cap) {
  const asPackages = contract.as_packages;
  const directOnly = contract.allow_indirect_imports === true;
  const findings = [];
  const sources = world.files.filter((f) => matchesAny(f.module, contract.source_modules, asPackages));
  const forbidden = (f) => matchesAny(f.module, contract.forbidden_modules, asPackages);

  if (directOnly) {
    for (const edge of world.edges) {
      if (!matchesAny(edge.from.module, contract.source_modules, asPackages)) continue;
      if (!forbidden(edge.to)) continue;
      const mapped = mapForbiddenRule(edge.from.rel, edge.to.rel, layers);
      pushCapped(findings, makeFinding({
        ...mapped,
        ruleIdentity: mapped.rule,
        message: `${edge.from.module} → ${edge.to.module}（契约: ${contract.name}）`,
        detail: `${edge.from.module} → ${edge.to.module}`,
        file: edge.file,
        line: edge.line,
        from: edge.from.id,
        to: edge.to.id,
        importLinterContract: contract.name,
        importLinterType: 'forbidden',
        importChain: [edge.from.module, edge.to.module]
      }), cap);
    }
    return findings;
  }

  for (const src of sources) {
    const pathIds = findPath(world.adj, src.id, (node) => node && forbidden(node), world.byId);
    if (!pathIds || pathIds.length < 2) continue;
    const from = world.byId.get(pathIds[0]);
    const to = world.byId.get(pathIds[pathIds.length - 1]);
    const hop = world.byId.get(pathIds[1]);
    const mapped = mapForbiddenRule(from.rel, hop.rel, layers);
    const chain = chainModules(pathIds, world.byId);
    pushCapped(findings, makeFinding({
      ...mapped,
      ruleIdentity: mapped.rule,
      message: `${from.module} → ${to.module}（契约: ${contract.name}）`,
      detail: chain.length > 2 ? `导入链: ${chain.join(' → ')}` : `${from.module} → ${to.module}`,
      file: from.rel,
      from: from.id,
      to: to.id,
      importLinterContract: contract.name,
      importLinterType: 'forbidden',
      importChain: chain
    }), cap);
  }
  return findings;
}

function evaluateLayers(contract, world, layers, cap) {
  const asPackages = contract.as_packages;
  const expanded = expandLayers(contract);
  const filesIn = expanded.map((layer) =>
    world.files.filter((f) => matchesAny(f.module, layer.modules, asPackages))
  );
  const findings = [];
  for (let fromIdx = 0; fromIdx < expanded.length; fromIdx++) {
    if (expanded[fromIdx].optional && filesIn[fromIdx].length === 0) continue;
    for (let toIdx = 0; toIdx < fromIdx; toIdx++) {
      if (expanded[toIdx].optional && filesIn[toIdx].length === 0) continue;
      const targets = new Set(filesIn[toIdx].map((f) => f.id));
      if (!targets.size) continue;
      for (const src of filesIn[fromIdx]) {
        const pathIds = findPath(world.adj, src.id, (node) => node && targets.has(node.id), world.byId);
        if (!pathIds || pathIds.length < 2) continue;
        const from = world.byId.get(pathIds[0]);
        const to = world.byId.get(pathIds[pathIds.length - 1]);
        const chain = chainModules(pathIds, world.byId);
        pushCapped(findings, makeFinding({
          rule: 'cross-layer-violation',
          ruleIdentity: 'cross-layer-violation',
          title: '分层架构违规（契约）',
          message: `${from.module} → ${to.module}（契约: ${contract.name}）`,
          detail: chain.length > 2 ? `导入链: ${chain.join(' → ')}` : `${from.module} → ${to.module}`,
          file: from.rel,
          from: from.id,
          to: to.id,
          fromLayer: avLayer(from.rel, layers),
          toLayer: avLayer(to.rel, layers),
          importLinterContract: contract.name,
          importLinterType: 'layers',
          importChain: chain
        }), cap);
      }
    }
  }
  return findings;
}

function evaluateIndependence(contract, world, layers, cap) {
  const asPackages = contract.as_packages;
  const groups = (contract.modules || []).map((mod) =>
    world.files.filter((f) => moduleMatches(f.module, mod, asPackages))
  );
  const findings = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = 0; j < groups.length; j++) {
      if (i === j) continue;
      const targets = new Set(groups[j].map((f) => f.id));
      if (!targets.size) continue;
      for (const src of groups[i]) {
        const pathIds = findPath(world.adj, src.id, (node) => node && targets.has(node.id), world.byId);
        if (!pathIds || pathIds.length < 2) continue;
        const from = world.byId.get(pathIds[0]);
        const to = world.byId.get(pathIds[pathIds.length - 1]);
        const chain = chainModules(pathIds, world.byId);
        pushCapped(findings, makeFinding({
          rule: 'independence-violation',
          ruleIdentity: `independence:${contract.name}`,
          title: `独立性契约违规: ${contract.name}`,
          message: `${from.module} → ${to.module}（契约: ${contract.name}）`,
          detail: chain.length > 2 ? `导入链: ${chain.join(' → ')}` : `${from.module} → ${to.module}`,
          file: from.rel,
          from: from.id,
          to: to.id,
          fromLayer: avLayer(from.rel, layers),
          toLayer: avLayer(to.rel, layers),
          importLinterContract: contract.name,
          importLinterType: 'independence',
          importChain: chain
        }), cap);
      }
    }
  }
  return findings;
}

/**
 * @param {object} graph - { nodes, edges }
 * @param {string} repo
 * @param {object} [opts] - { diff, configPath, layers }
 * @returns {{ findings: object[], evidence: object }}
 */
function evaluateContracts(graph, repo, opts = {}) {
  repo = path.resolve(repo || process.cwd());
  const configPath = opts.configPath || findImportLinterConfig(repo);
  if (!configPath) {
    return { findings: [], evidence: { configPath: null, evaluated: 0 } };
  }
  const contracts = parseContractConfig(configPath);
  const { layers, error: layerConfigError } = opts.layers
    ? { layers: opts.layers, error: null }
    : loadLayerDefinitions(repo);
  const changedFiles = opts.diff === undefined ? null : changedFilesFromDiff(opts.diff, repo);
  const findings = [];
  let evaluated = 0;

  for (const contract of contracts.values()) {
    const asPackages = contract.as_packages;
    const world = buildImportGraph(graph, repo, asPackages, contract.ignore_imports);
    let produced = [];
    if (contract.type === 'forbidden') {
      produced = evaluateForbidden(contract, world, layers, FINDING_CAP);
      evaluated++;
    } else if (contract.type === 'layers') {
      produced = evaluateLayers(contract, world, layers, FINDING_CAP);
      evaluated++;
    } else if (contract.type === 'independence') {
      produced = evaluateIndependence(contract, world, layers, FINDING_CAP);
      evaluated++;
    }
    for (const finding of produced) {
      const files = [finding.file, ...(finding.importChain || []).map((mod) => {
        const rec = world.files.find((f) => f.module === mod);
        return rec && rec.rel;
      })];
      if (!touchesChangedFiles(files.filter(Boolean), changedFiles, repo) &&
          !(files.every((f) => !f) && changedFiles?.size)) {
        continue;
      }
      finding.file = normalizeFilePath(finding.file, repo) || finding.file;
      findings.push(finding);
    }
  }

  return {
    findings,
    evidence: {
      configPath,
      evaluated,
      findings: findings.length,
      layerConfigError: layerConfigError || null
    }
  };
}

module.exports = {
  evaluateContracts,
  relToPythonModule,
  moduleMatches,
  FINDING_CAP
};
