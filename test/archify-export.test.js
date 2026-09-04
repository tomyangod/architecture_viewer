'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { exportArchify, findArchifyCli, tryRenderArchify, finalizeSessionHtml, SCOPES } = require('../lib/archify-export');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-ax-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

const FIXTURE = {
  'src/controller/user_controller.py': `
from services.user_service import UserService
class UserController:
    def handle(self):
        return UserService().get()
`,
  'src/services/user_service.py': `
from models.user import User
class UserService:
    def get(self):
        return User()
`,
  'src/models/user.py': `
class User:
    pass
`
};

/** 建基线：直接写 .av/graph-baseline.json（复用 extract-graph）。 */
function seedBaseline(repo) {
  const { buildGraph } = require('../lib/extract-graph');
  const g = buildGraph(repo);
  const av = path.join(repo, '.av');
  fs.mkdirSync(av, { recursive: true });
  fs.writeFileSync(path.join(av, 'graph-baseline.json'), JSON.stringify(g, null, 2));
  return g;
}

describe('archify-export 编排模块', () => {
  it('SCOPES 固定为 changed/violations/layers', () => {
    assert.deepEqual(SCOPES, ['changed', 'violations', 'layers']);
  });

  it('无基线返回 NO_BASELINE，不写文件、不抛异常', () => {
    const repo = makeRepo(FIXTURE);
    const r = exportArchify({ repo, scope: 'layers' });
    assert.equal(r.error, 'NO_BASELINE');
    assert.ok(r.message);
    assert.ok(!fs.existsSync(path.join(repo, '.av', 'archify-layers.head.json')));
  });

  it('导出三件套（base/head/sidecar），IR 形状合法', () => {
    const repo = makeRepo(FIXTURE);
    seedBaseline(repo);
    const r = exportArchify({ repo, scope: 'layers' });
    assert.ok(!r.error, '无错误');
    assert.equal(r.scope, 'layers');
    for (const f of [r.files.base, r.files.head, r.files.sidecar]) {
      assert.ok(fs.existsSync(f), `落盘: ${path.basename(f)}`);
    }
    const head = JSON.parse(fs.readFileSync(r.files.head, 'utf8'));
    assert.equal(head.schema_version, 1);
    assert.equal(head.diagram_type, 'architecture');
    assert.equal(head.layout.mode, 'grid');
    assert.ok(head.components.length >= 1);
    // 每个组件带显式 row/col
    for (const c of head.components) {
      assert.equal(typeof c.row, 'number');
      assert.equal(typeof c.col, 'number');
      assert.match(c.id, /^[a-zA-Z][a-zA-Z0-9_-]*$/);
    }
    // sidecar 记录 scope 与计数
    const side = JSON.parse(fs.readFileSync(r.files.sidecar, 'utf8'));
    assert.equal(side.tool, 'architecture-viewer');
    assert.equal(side.scopeUsed, 'layers');
    assert.ok(side.componentCount.head >= 1);
  });

  it('--out 自定义输出目录', () => {
    const repo = makeRepo(FIXTURE);
    seedBaseline(repo);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'av-ax-out-'));
    const r = exportArchify({ repo, scope: 'layers', outDir: out });
    assert.ok(r.files.head.startsWith(out));
    assert.ok(fs.existsSync(path.join(out, 'archify-layers.head.json')));
  });

  it('非法 scope 回退默认 changed（不抛异常）', () => {
    const repo = makeRepo(FIXTURE);
    seedBaseline(repo);
    const r = exportArchify({ repo, scope: 'bogus' });
    assert.equal(r.scope, 'changed');
    assert.equal(r.sidecar.scopeRequested, 'changed');
  });

  it('validate=true 但找不到 archify CLI 时 available:false，不报错', () => {
    const repo = makeRepo(FIXTURE);
    seedBaseline(repo);
    const r = exportArchify({ repo, scope: 'layers', validate: true, archifyCli: '/nonexistent/archify' });
    assert.ok(r.validation);
    assert.equal(r.validation.available, false);
    assert.ok(r.validation.message);
    // IR 仍然写出
    assert.ok(fs.existsSync(r.files.head));
  });

  it('findArchifyCli: 显式路径不存在返回 null', () => {
    assert.equal(findArchifyCli({ explicit: '/nope/archify.mjs' }), null);
  });

  it('tryRenderArchify renderer=builtin 不调 CLI', () => {
    const repo = makeRepo(FIXTURE);
    seedBaseline(repo);
    const r = tryRenderArchify({ repo, renderer: 'builtin' });
    assert.equal(r.used, 'builtin');
    assert.equal(r.reason, 'renderer=builtin');
  });

  it('tryRenderArchify 找不到 CLI 时回退 builtin', () => {
    const repo = makeRepo(FIXTURE);
    seedBaseline(repo);
    const r = tryRenderArchify({ repo, renderer: 'auto', archifyCli: '/nonexistent/archify' });
    assert.equal(r.used, 'builtin');
    assert.equal(r.reason, 'archify-cli-missing');
  });

  it('finalizeSessionHtml 始终写出 builtin，失败时主报告仍是内置 HTML', () => {
    const repo = makeRepo(FIXTURE);
    seedBaseline(repo);
    const out = finalizeSessionHtml({
      repo,
      builtinHtml: '<html>builtin-marker</html>',
      renderer: 'auto',
      archifyCli: '/nonexistent/archify'
    });
    assert.equal(out.renderer.used, 'builtin');
    assert.ok(fs.existsSync(out.htmlPath));
    assert.ok(fs.existsSync(out.builtinPath));
    assert.match(fs.readFileSync(out.htmlPath, 'utf8'), /builtin-marker/);
    assert.match(fs.readFileSync(out.builtinPath, 'utf8'), /builtin-marker/);
  });
});
