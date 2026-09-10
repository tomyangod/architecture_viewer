'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildGraph, guessLayer } = require('../lib/extract-graph');
const { diffGraphs } = require('../lib/diff-graph');
const { evaluateRisk } = require('../lib/risk-rules');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-layer-ep-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe('guessLayer: tools/ 拆 util vs entrypoint', () => {
  it('路径启发式：helper→util，cli/main/scripts/diagnostics→entrypoint', () => {
    assert.equal(guessLayer('tools/helper.py'), 'util');
    assert.equal(guessLayer('tools/cli.py'), 'entrypoint');
    assert.equal(guessLayer('tools/main.py'), 'entrypoint');
    assert.equal(guessLayer('scripts/export_data.py'), 'entrypoint');
    assert.equal(guessLayer('bin/run.py'), 'entrypoint');
    assert.equal(guessLayer('tools/restore_backup.py'), 'entrypoint');
    assert.equal(guessLayer('tools/misc.py'), null);
    assert.equal(guessLayer('tools/diagnostics/probe_weibo.py'), 'entrypoint');
    assert.equal(guessLayer('tools/monitoring/check_lag.py'), 'entrypoint');
    assert.equal(guessLayer('tools/crawl/worker_helper.py'), 'entrypoint');
    assert.equal(guessLayer('utils/ids.py'), 'util');
  });

  it('entrypoint → service 不报跨层；util → service 仍报', () => {
    const dir = makeRepo({
      'services/order.py': 'class OrderService:\n    pass\n',
      'tools/cli.py': 'from services import order\nclass Cli:\n    pass\n',
      'tools/helper.py': 'from services import order\nclass Helper:\n    pass\n'
    });
    try {
      const empty = { nodes: [], edges: [], fingerprint: '0', root: 'x', stats: {} };
      const head = buildGraph(dir);
      const cli = head.nodes.find((n) => n.path === 'tools/cli.py');
      const helper = head.nodes.find((n) => n.path === 'tools/helper.py');
      assert.equal(cli.layer, 'entrypoint');
      assert.equal(helper.layer, 'util');

      const diff = diffGraphs(empty, head);
      const findings = evaluateRisk(diff, head, empty);
      const cross = findings.filter((f) => f.rule === 'cross-layer-violation');
      assert.ok(
        !cross.some((f) => /入口/.test(f.message) && /服务/.test(f.message)),
        'entrypoint→service 应放行: ' + cross.map((f) => f.message).join('; ')
      );
      assert.ok(
        cross.some((f) => /工具/.test(f.message) && /服务/.test(f.message)),
        'util→service 仍应红灯: ' + cross.map((f) => f.message).join('; ')
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tools/ 无入口特征保持未分层：不误报 util→service，也不默认放行', () => {
    const dir = makeRepo({
      'services/order.py': 'class OrderService:\n    pass\n',
      'tools/misc.py': 'from services import order\nclass Misc:\n    pass\n'
    });
    try {
      const empty = { nodes: [], edges: [], fingerprint: '0', root: 'x', stats: {} };
      const head = buildGraph(dir);
      const misc = head.nodes.find((n) => n.path === 'tools/misc.py');
      assert.ok(!misc.layer, '无入口特征的 tools/ 脚本不应分层，实际=' + misc.layer);
      const diff = diffGraphs(empty, head);
      const findings = evaluateRisk(diff, head, empty);
      const cross = findings.filter((f) => f.rule === 'cross-layer-violation');
      assert.ok(
        !cross.some((f) => (f.file || '').includes('tools/misc')),
        '未分层不应产生跨层 finding: ' + cross.map((f) => f.message).join('; ')
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tools/ 含 if __name__ == "__main__" 才升为 entrypoint', () => {
    const dir = makeRepo({
      'services/order.py': 'class OrderService:\n    pass\n',
      'tools/job.py': 'from services import order\nif __name__ == "__main__":\n    print(order)\n'
    });
    try {
      const head = buildGraph(dir);
      const job = head.nodes.find((n) => n.path === 'tools/job.py');
      assert.equal(job.layer, 'entrypoint');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
