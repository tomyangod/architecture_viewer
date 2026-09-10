'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  parseYaml,
  loadRules,
  evaluateRules,
  evaluateKitRules,
  extractDiagramModel,
  assignLayer
} = require('../lib/rules');
const { validateDir } = require('../lib/validate');
const { checkKit } = require('../lib');

const ROOT = path.join(__dirname, '..');
const EXAMPLE = path.join(ROOT, 'architecture-rules.example.yaml');
const VIOLATE = path.join(ROOT, 'eval', 'fixtures', 'rules-violate');
const OK = path.join(ROOT, 'eval', 'fixtures', 'rules-ok');

describe('architecture-rules.yaml 解析', () => {
  it('example 含命名、跨层禁止、Rel 白名单三类规则', () => {
    const rules = loadRules(EXAMPLE);
    assert.equal(rules.name, 'team-default');
    assert.ok(rules.naming.some((r) => r.id === 'node-id-snake'));
    assert.ok(rules.forbid_cross_layer.some((r) => r.id === 'no-controller-to-storage'));
    assert.ok(rules.rel_whitelist.some((r) => r.id === 'allowed-rel-labels'));
    assert.ok(rules.layers.controller && rules.layers.controller.includes('*_page'));
    assert.ok(rules.layers.storage && rules.layers.storage.includes('*_repo'));
  });

  it('YAML 子集：列表映射、行内数组、引号正则、注释', () => {
    const doc = parseYaml(`
# comment
name: demo
naming:
  - id: snake
    pattern: '^[a-z]+$'
    on: id
layers:
  service:
    match: ['*_svc', api]
rel_whitelist:
  - id: labels
    labels: [HTTP, 调用]
`);
    assert.equal(doc.name, 'demo');
    assert.equal(doc.naming[0].pattern, '^[a-z]+$');
    assert.deepEqual(doc.layers.service.match, ['*_svc', 'api']);
    assert.deepEqual(doc.rel_whitelist[0].labels, ['HTTP', '调用']);
  });

  it('层 glob 按声明顺序命中', () => {
    const layers = { controller: ['*_page'], service: ['*_service'], storage: ['*_repo'] };
    assert.equal(assignLayer('web_page', layers), 'controller');
    assert.equal(assignLayer('order_service', layers), 'service');
    assert.equal(assignLayer('order_repo', layers), 'storage');
    assert.equal(assignLayer('app_core', layers), null);
  });
});

describe('C4 模型提取', () => {
  it('抽出节点 kind 与 Rel 标签', () => {
    const md = fs.readFileSync(path.join(OK, 'c4-container.md'), 'utf8');
    const model = extractDiagramModel(md, 'c4-container.md');
    assert.ok(model.nodes.some((n) => n.id === 'web_page' && n.kind === 'container'));
    assert.ok(model.rels.some((r) => r.from === 'web_page' && r.to === 'order_service' && r.label === 'HTTP'));
  });
});

describe('规则评估', () => {
  it('违规夹具报出三类规则名', () => {
    const rules = loadRules(EXAMPLE);
    const result = evaluateRules(rules, VIOLATE);
    assert.equal(result.ok, false);
    const ids = result.violations.map((v) => v.rule);
    assert.ok(ids.includes('node-id-snake'), ids.join(','));
    assert.ok(ids.includes('no-controller-to-storage'), ids.join(','));
    assert.ok(ids.some((id) => String(id).includes('allowed-rel-labels')), ids.join(','));
  });

  it('合规夹具通过', () => {
    const rules = loadRules(EXAMPLE);
    const result = evaluateRules(rules, OK);
    assert.equal(result.ok, true, JSON.stringify(result.violations, null, 2));
  });

  it('checkKit --rules 违规夹具 ok=false', () => {
    const r = checkKit(VIOLATE, { rules: EXAMPLE });
    assert.equal(r.ok, false);
    assert.equal(r.protocol.ok, true, r.protocol.errors.join('\n'));
    assert.equal(r.rules.ok, false);
    assert.ok(r.rules.violations.some((v) => v.rule === 'no-controller-to-storage'));
  });

  it('checkKit --rules 合规夹具通过', () => {
    const r = checkKit(OK, { rules: EXAMPLE });
    assert.equal(r.ok, true, JSON.stringify(r.rules && r.rules.violations, null, 2));
    assert.equal(r.rules.ok, true);
  });

  it('validateDir 结果含 rules 段', () => {
    const r = validateDir(VIOLATE, { rules: EXAMPLE });
    assert.ok(r.rules);
    assert.equal(r.rules.ok, false);
    assert.ok(r.errors.some((e) => /\[node-id-snake\]/.test(e)));
  });

  it('未指定 rules 且目录无 architecture-rules.yaml 时不挡协议', () => {
    const r = evaluateKitRules(OK, {});
    assert.equal(r, null);
    const checked = checkKit(OK, {});
    assert.equal(checked.ok, true);
    assert.equal(checked.rules, null);
  });
});

describe('CLI check --rules', () => {
  const cli = path.join(ROOT, 'lib', 'cli.js');

  it('违规夹具退出码非 0 且报出规则名', () => {
    const r = spawnSync(process.execPath, [cli, 'check', VIOLATE, '--rules', EXAMPLE], {
      encoding: 'utf8'
    });
    assert.equal(r.status, 1, r.stderr + r.stdout);
    const out = (r.stdout || '') + (r.stderr || '');
    assert.match(out, /--- rules ---/);
    assert.match(out, /node-id-snake/);
    assert.match(out, /no-controller-to-storage/);
    assert.match(out, /allowed-rel-labels/);
  });

  it('合规夹具退出码 0', () => {
    const r = spawnSync(process.execPath, [cli, 'check', OK, '--rules', EXAMPLE], {
      encoding: 'utf8'
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /OK/);
  });
});
