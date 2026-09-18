'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { TOOLS, handleToolCall, toolSessionStart, toolSessionReport, toolSessionChanges, toolSessionStatus, toolCheckLayering, toolExplainFinding, toolArchifyExport, toolReviewWalk, stopWatcher, resolveRepo, PKG_VERSION } = require('../mcp/server');
const { execFileSync } = require('child_process');
const { clearStaleSessionReports } = require('../lib/session-report');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-mcp-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

const FIXTURE = {
  'backend/routes/orders.py': `
from flask import Blueprint, request, jsonify
from services.order_service import OrderService
from database.db_session import get_async_engine  # layer skip!

bp = Blueprint('orders', __name__)

@bp.route('/orders', methods=['POST'])
def create_order():
    data = request.json
    result = OrderService.create(data)
    return jsonify(result)
`,
  'services/order_service.py': `
from models.order import Order
from database.db_session import save

class OrderService:
    def create(self, order: Order) -> Order:
        return save(order)
`,
  'models/order.py': `
class Order:
    def total(self) -> float:
        return 0.0
`,
  'database/db_session.py': `
import sqlalchemy as sa

engine = sa.create_engine('sqlite:///app.db')

def save(entity):
    pass

def get_async_engine():
    return engine
`
};

describe('MCP Server: tools/list', () => {
  it('暴露且仅暴露 9 个工具', () => {
    const names = TOOLS.map(t => t.name);
    assert.equal(names.length, 9);
    assert.ok(names.includes('av_guard'));
    assert.ok(names.includes('av_session_start'));
    assert.ok(names.includes('av_session_changes'));
    assert.ok(names.includes('av_session_report'));
    assert.ok(names.includes('av_review_walk'));
    assert.ok(names.includes('av_status'));
    assert.ok(names.includes('av_check_layering'));
    assert.ok(names.includes('av_explain_finding'));
    assert.ok(names.includes('av_archify_export'));
  });

  it('每个工具都要求显式传入 repo', () => {
    for (const t of TOOLS) {
      assert.ok(t.description.length > 10, `${t.name} 缺 description`);
      assert.ok(t.inputSchema.properties.repo, `${t.name} 缺 repo 参数`);
      assert.ok((t.inputSchema.required || []).includes('repo'), `${t.name} repo 应为必填`);
    }
  });

  it('resolveRepo 拒绝省略、空白和相对路径', () => {
    assert.throws(() => resolveRepo({}), /repo is required/);
    assert.throws(() => resolveRepo({ repo: '  ' }), /repo is required/);
    assert.throws(() => resolveRepo({ repo: 'relative/repo' }), /absolute path/);
  });
});

describe('MCP Server: av_session_start', () => {
  let repo;

  before(() => { repo = makeRepo(FIXTURE); });
  after(() => { stopWatcher(repo); });

  it('记录基线并生成 layers.suggested.json', () => {
    const result = toolSessionStart({ repo });
    assert.ok(result.baseline.files > 0);
    assert.ok(result.baseline.fingerprint);
    assert.ok(fs.existsSync(path.join(repo, '.av/graph-baseline.json')));
    assert.ok(result.message.includes('拍好了'));
  });

  it('刷新基线时删除上一轮 session-report', () => {
    const isolated = makeRepo(FIXTURE);
    try {
      toolSessionStart({ repo: isolated });
      const av = path.join(isolated, '.av');
      fs.writeFileSync(path.join(av, 'session-report.json'), '{"findings":[{"rule":"stale"}]}');
      fs.writeFileSync(path.join(av, 'session-report.html'), '<html>stale</html>');
      fs.writeFileSync(path.join(av, 'session-report.builtin.html'), '<html>stale-builtin</html>');
      fs.writeFileSync(path.join(av, 'session-report.archify.html'), '<html>stale-archify</html>');
      fs.writeFileSync(path.join(av, 'archify-changed.base.json'), '{}');
      fs.writeFileSync(path.join(av, 'archify-changed.head.json'), '{}');
      fs.writeFileSync(path.join(av, 'archify-changed.sidecar.json'), '{}');
      fs.writeFileSync(path.join(av, 'archify-violations.sidecar.json'), '{}');
      const again = toolSessionStart({ repo: isolated });
      assert.ok(again.clearedReports.includes('session-report.json'));
      assert.ok(again.clearedReports.includes('session-report.archify.html'));
      assert.ok(again.clearedReports.includes('archify-changed.head.json'));
      assert.ok(!fs.existsSync(path.join(av, 'session-report.json')));
      assert.ok(!fs.existsSync(path.join(av, 'session-report.html')));
      assert.ok(!fs.existsSync(path.join(av, 'session-report.builtin.html')));
      assert.ok(!fs.existsSync(path.join(av, 'session-report.archify.html')));
      assert.ok(!fs.existsSync(path.join(av, 'archify-changed.base.json')));
      assert.ok(!fs.existsSync(path.join(av, 'archify-violations.sidecar.json')));
      assert.ok(fs.existsSync(path.join(av, 'graph-baseline.json')), '基线必须保留');
    } finally {
      stopWatcher(isolated);
    }
  });

  it('清陈旧报告不碰 baseline / layers / session-history', () => {
    const isolated = makeRepo(FIXTURE);
    const av = path.join(isolated, '.av');
    fs.mkdirSync(av, { recursive: true });
    fs.writeFileSync(path.join(av, 'graph-baseline.json'), '{}');
    fs.writeFileSync(path.join(av, 'layers.json'), '{}');
    fs.writeFileSync(path.join(av, 'layers.suggested.json'), '{}');
    fs.writeFileSync(path.join(av, 'session-history.jsonl'), '{}\n');
    fs.writeFileSync(path.join(av, 'archify-changed.head.json'), '{}');
    const cleared = clearStaleSessionReports(isolated);
    assert.deepEqual(cleared.deleted, ['archify-changed.head.json']);
    assert.deepEqual(cleared.stubbed, []);
    assert.ok(fs.existsSync(path.join(av, 'graph-baseline.json')));
    assert.ok(fs.existsSync(path.join(av, 'layers.json')));
    assert.ok(fs.existsSync(path.join(av, 'layers.suggested.json')));
    assert.ok(fs.existsSync(path.join(av, 'session-history.jsonl')));
  });

  it('editDir 与 repo 不是同一 Git 根时 PATH_MISMATCH 且不写基线', () => {
    const checking = makeRepo(FIXTURE);
    const editing = makeRepo(FIXTURE);
    try {
      execFileSync('git', ['init'], { cwd: checking, stdio: 'ignore' });
      execFileSync('git', ['init'], { cwd: editing, stdio: 'ignore' });
      const result = toolSessionStart({ repo: checking, editDir: editing });
      assert.equal(result.error, 'PATH_MISMATCH');
      assert.equal(result.abort, true);
      assert.ok(!fs.existsSync(path.join(checking, '.av', 'graph-baseline.json')));
    } finally {
      stopWatcher(checking);
    }
  });
});

describe('MCP Server: av_status + idle 指纹', () => {
  it('av_status 回显基线/监听/报告是否过期', () => {
    const repo = makeRepo(FIXTURE);
    try {
      const before = toolSessionStatus({ repo });
      assert.equal(before.baseline.present, false);
      toolSessionStart({ repo });
      const st = toolSessionStatus({ repo });
      assert.equal(st.version, PKG_VERSION);
      assert.equal(st.baseline.present, true);
      assert.ok(st.path.checking);
      assert.ok(st.path.baselineDir);
      assert.ok(st.path.reportDir);
      assert.ok(st.watcher);
      assert.ok(st.message);
    } finally {
      stopWatcher(repo);
    }
  });

  it('idle 时写入新文件，changes 用实时指纹发现变更（不等 watcher）', () => {
    const repo = makeRepo(FIXTURE);
    try {
      toolSessionStart({ repo });
      const idle = toolSessionChanges({ repo });
      assert.ok(['idle', 'ready'].includes(idle.status));
      fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'src', 'brand-new.js'), 'export function brandNew() { return 1; }\n');
      const changes = toolSessionChanges({ repo });
      if (changes.status === 'analyzing') {
        assert.equal(changes.hasChanges, true);
      } else {
        assert.equal(changes.hasChanges, true, '不得因 watcher 未到而报没有变化');
        assert.equal(changes.peeked, true);
      }
    } finally {
      stopWatcher(repo);
    }
  });
});

describe('MCP Server: av_session_report', () => {
  let repo;

  before(() => { repo = makeRepo(FIXTURE); });
  after(() => { stopWatcher(repo); });

  it('无基线时返回 NO_BASELINE', () => {
    const result = toolSessionReport({ repo });
    assert.equal(result.error, 'NO_BASELINE');
  });

  it('有基线时返回 diff + findings', () => {
    toolSessionStart({ repo });
    const result = toolSessionReport({ repo });
    assert.ok(result.summary);
    assert.equal(result.summary.riskLevel, result.riskLevel, 'MCP summary.riskLevel 必须与顶层 riskLevel 同为 findings 严重度');
    assert.ok(result.summary.changeScale, 'MCP summary.changeScale 是变更规模启发式，不是风险');
    assert.ok(Array.isArray(result.findings));
    assert.ok(result.reportPaths.json);
    assert.ok(result.reportPaths.html);
    assert.equal(result.reportPaths.renderer, 'builtin');
  });

  it('W16-03: analyzerStatus 列出所有分析器状态（内置必可用，外部按需）', () => {
    toolSessionStart({ repo });
    const result = toolSessionReport({ repo });
    assert.ok(Array.isArray(result.analyzerStatus), 'analyzerStatus 必须是数组');
    assert.ok(result.analyzerStatus.length >= 1, '至少有 builtin 分析器');

    const builtin = result.analyzerStatus.find(s => s.id === 'builtin');
    assert.ok(builtin, '应包含 builtin 分析器');
    assert.equal(builtin.available, true, 'builtin 分析器必可用');
    assert.equal(typeof builtin.violations, 'number');

    // 外部分析器字段统一
    for (const s of result.analyzerStatus) {
      assert.ok(s.id, '每个分析器有 id');
      assert.equal(typeof s.available, 'boolean', 'available 是布尔值');
      assert.equal(typeof s.violations, 'number', 'violations 是数字');
      assert.ok('error' in s, '有 error 字段（可能为 null）');
      assert.ok('reason' in s, '有 reason 字段（可能为 null）');
    }

    assert.equal(typeof result.externalAdded, 'number', 'externalAdded 是数字');
  });
});

describe('MCP Server: av_session_changes（轻量检查 + 自动闭环）', () => {
  let repo;

  before(() => { repo = makeRepo(FIXTURE); });
  after(() => { stopWatcher(repo); });

  it('无基线时返回 NO_BASELINE', () => {
    const result = toolSessionChanges({ repo });
    assert.equal(result.error, 'NO_BASELINE');
  });

  it('start 后进入监听状态（idle）', () => {
    toolSessionStart({ repo });
    const result = toolSessionChanges({ repo });
    assert.equal(result.watching, true);
    assert.ok(['idle', 'ready'].includes(result.status), `status=${result.status}`);
  });

  it('改代码后 report 能检测到变更，changes 反映 hasChanges', () => {
    // 新增一个文件（模拟 AI 改代码）
    const newFile = path.join(repo, 'src/new-feature.js');
    fs.mkdirSync(path.dirname(newFile), { recursive: true });
    fs.writeFileSync(newFile, "export class NewFeature { run() { return 'new'; } }\n");
    // 手动触发 report 会取消防抖并立即重算
    const report = toolSessionReport({ repo });
    assert.ok(report.hasChanges, '应检测到新增文件');
    // changes 工具应反映 ready + hasChanges
    const changes = toolSessionChanges({ repo });
    assert.equal(changes.status, 'ready');
    assert.equal(changes.hasChanges, true);
  });

  describe('MCP Server: watcher 不可用时不复用缓存', () => {
    it('手动报告后继续改代码，下一次报告仍实时重算', () => {
      const repo = makeRepo(FIXTURE);
      const originalWatch = fs.watch;
      fs.watch = () => { throw new Error('recursive watch unavailable'); };
      try {
        const started = toolSessionStart({ repo });
        assert.match(started.autoWatch, /监听不可用/);

        const clean = toolSessionReport({ repo });
        assert.equal(clean.hasChanges, false);

        const newFile = path.join(repo, 'src', 'after-clean-report.js');
        fs.mkdirSync(path.dirname(newFile), { recursive: true });
        fs.writeFileSync(newFile, 'export class AfterCleanReport {}\n');

        const changed = toolSessionReport({ repo });
        assert.equal(changed.hasChanges, true, 'watcher 不可用时不得返回旧的 clean 缓存');
        assert.notEqual(changed.cached, true);
      } finally {
        fs.watch = originalWatch;
        stopWatcher(repo);
      }
    });
  });
});

describe('MCP Server: av_check_layering', () => {
  let repo;

  before(() => { repo = makeRepo(FIXTURE); });

  it('检测出跨层违规和层级穿透', () => {
    const result = toolCheckLayering({ repo });
    assert.ok(result.layerCoverage.coverage.endsWith('%'));
    assert.ok(result.layerDistribution.controller >= 1, '应检出 controller 层');
    assert.ok(result.layerDistribution.storage >= 1, '应检出 storage 层');
    assert.ok(result.layerDistribution.service >= 1, '应检出 service 层');
    assert.ok(result.riskCount > 0, '应有违规发现');
    assert.ok(
      result.findings.some(f => (f.title || f.text || '').includes('层级穿透') || (f.title || f.text || '').includes('跨层')),
      '应检出层级穿透或跨层违规'
    );
  });

  it('不需要预先记录基线', () => {
    assert.ok(!fs.existsSync(path.join(repo, '.av/graph-baseline.json')));
    const result = toolCheckLayering({ repo });
    assert.ok(result.fingerprint);
  });
});

describe('MCP Server: av_explain_finding', () => {
  let repo;

  before(() => {
    repo = makeRepo(FIXTURE);
    toolSessionStart({ repo });
    toolSessionReport({ repo });
  });

  it('按 rule 名定位违规并返回结构化事实', () => {
    const result = toolExplainFinding({ repo, rule: 'layer-skip' });
    assert.ok(result.finding);
    assert.ok(result.suggestion);
    assert.equal(result.rule, 'layer-skip');
  });

  it('按 index 定位违规', () => {
    const result = toolExplainFinding({ repo, index: 0 });
    assert.ok(result.finding);
    assert.ok(result.severity);
  });

  it('无匹配时返回 NOT_FOUND', () => {
    const result = toolExplainFinding({ repo, rule: 'nonexistent-rule' });
    assert.equal(result.error, 'NOT_FOUND');
  });

  it('from=session 且无报告时返回 NO_SESSION_FINDING，不扫全楼', () => {
    const isolated = makeRepo(FIXTURE);
    try {
      toolSessionStart({ repo: isolated });
      const result = toolExplainFinding({ repo: isolated, from: 'session', rule: 'layer-skip' });
      assert.equal(result.error, 'NO_SESSION_FINDING');
      assert.ok(!result.finding, '不得静默回退到全楼实时扫描');
    } finally {
      stopWatcher(isolated);
    }
  });

  it('from=session 且本轮 findings 为空时不 fallback', () => {
    const isolated = makeRepo(FIXTURE);
    try {
      toolSessionStart({ repo: isolated });
      toolSessionReport({ repo: isolated });
      const result = toolExplainFinding({ repo: isolated, from: 'session', index: 0 });
      assert.equal(result.error, 'NO_SESSION_FINDING');
      assert.ok(!result.finding);
    } finally {
      stopWatcher(isolated);
    }
  });

  it('from=session 能解释本轮报告中的 finding', () => {
    const isolated = makeRepo(FIXTURE);
    try {
      toolSessionStart({ repo: isolated });
      fs.writeFileSync(path.join(isolated, 'services', 'notify.py'), 'import requests\nclass Notify:\n    pass\n');
      const report = toolSessionReport({ repo: isolated });
      assert.ok(report.findingsCount > 0, '本轮应有 finding');
      const result = toolExplainFinding({ repo: isolated, from: 'session', index: 0 });
      assert.ok(!result.error, result.message);
      assert.ok(result.finding);
    } finally {
      stopWatcher(isolated);
    }
  });
});

describe('MCP Server: handleToolCall 路由', () => {
  it('未知工具抛错', () => {
    assert.throws(
      () => handleToolCall({ name: 'unknown_tool', arguments: {} }),
      /Unknown tool/
    );
  });

  it('正确路由到 5 个工具', () => {
    const repo = makeRepo(FIXTURE);
    assert.doesNotThrow(() => handleToolCall({ name: 'av_session_start', arguments: { repo } }));
    assert.doesNotThrow(() => handleToolCall({ name: 'av_session_changes', arguments: { repo } }));
    assert.doesNotThrow(() => handleToolCall({ name: 'av_check_layering', arguments: { repo } }));
    assert.doesNotThrow(() => handleToolCall({ name: 'av_session_report', arguments: { repo } }));
    assert.doesNotThrow(() => handleToolCall({ name: 'av_explain_finding', arguments: { repo } }));
    assert.doesNotThrow(() => handleToolCall({ name: 'av_status', arguments: { repo } }));
    stopWatcher(repo);
  });
});

describe('MCP Server: stdio JSON-RPC 协议', () => {
  it('initialize + tools/list + tools/call 全链路', async () => {
    const serverPath = path.join(__dirname, '..', 'mcp', 'server.js');
    const child = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    try {
    const lines = [];
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => lines.push(...d.split('\n').filter(Boolean)));

    function send(msg) {
      child.stdin.write(JSON.stringify(msg) + '\n');
    }

    function waitForResponse(id) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 5000);
        const handler = () => {
          for (const line of lines) {
            try {
              const msg = JSON.parse(line);
              if (msg.id === id) {
                clearTimeout(timer);
                child.stdout.off('data', handler);
                resolve(msg);
                return;
              }
            } catch { /* not JSON */ }
          }
        };
        child.stdout.on('data', handler);
      });
    }

    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const initResp = await waitForResponse(1);
    assert.equal(initResp.result.protocolVersion, '2024-11-05');
    assert.equal(initResp.result.serverInfo.name, 'architecture-viewer');
    assert.equal(initResp.result.serverInfo.version, PKG_VERSION);
    assert.match(initResp.result.serverInfo.version, /^\d+\.\d+\.\d+/);

    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const listResp = await waitForResponse(2);
    assert.equal(listResp.result.tools.length, 9);

    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'av_check_layering', arguments: { repo: makeRepo(FIXTURE) } } });
    const callResp = await waitForResponse(3);
    assert.ok(callResp.result.content[0].text.includes('layerCoverage'));
  } finally {
    child.kill();
  }
  });
});

describe('MCP Server: av_archify_export', () => {
  it('无 confirm 时拒绝导出', () => {
    const repo = makeRepo(FIXTURE);
    const r = toolArchifyExport({ repo, scope: 'layers' });
    assert.equal(r.error, 'CONFIRM_REQUIRED');
    assert.match(r.message, /人工确认/);
  });

  it('无基线时返回 NO_BASELINE，不抛异常', () => {
    const repo = makeRepo(FIXTURE);
    const r = toolArchifyExport({ repo, scope: 'layers', confirm: true });
    assert.equal(r.error, 'NO_BASELINE');
    assert.ok(r.message);
  });

  it('导出 IR 三件套到 .av/，组件带显式 row/col、id 合法', () => {
    const repo = makeRepo(FIXTURE);
    try {
      toolSessionStart({ repo }); // 建基线
      const r = toolArchifyExport({ repo, scope: 'layers', confirm: true });
      assert.ok(!r.error, '不应有错误');
      assert.equal(r.scopeUsed, 'layers');
      assert.ok(fs.existsSync(r.files.base), 'base IR 落盘');
      assert.ok(fs.existsSync(r.files.head), 'head IR 落盘');
      assert.ok(fs.existsSync(r.files.sidecar), 'sidecar 落盘');

      const head = JSON.parse(fs.readFileSync(r.files.head, 'utf8'));
      assert.equal(head.diagram_type, 'architecture');
      assert.equal(head.layout.mode, 'grid');
      const idRe = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
      for (const c of head.components) {
        assert.match(c.id, idRe, `组件 id ${c.id} 合法`);
        assert.equal(typeof c.row, 'number', `${c.id} 有 row`);
        assert.equal(typeof c.col, 'number', `${c.id} 有 col`);
        assert.ok(!c.sources, '不发 sources');
      }
      for (const cn of head.connections) assert.match(cn.id, idRe, `连接 id ${cn.id} 合法`);
      assert.ok(!(head.meta && head.meta.repository), '不发 meta.repository');
      assert.ok(r.validation, '应返回 validation 口径');
      assert.ok(['validated', 'validate_failed', 'not_validated', 'not_requested'].includes(r.validation.status));
      if (r.validation.status === 'not_validated' || r.validation.status === 'not_requested') {
        assert.match(r.validation.note || '', /不是校验通过的成品|未请求校验/);
      }
    } finally {
      stopWatcher(repo);
    }
  });

  it('handleToolCall 路由 av_archify_export', () => {
    const repo = makeRepo(FIXTURE);
    try {
      toolSessionStart({ repo });
      const r = handleToolCall({ name: 'av_archify_export', arguments: { repo, scope: 'changed', confirm: true } });
      assert.ok(!r.error);
      assert.ok(r.files.head);
    } finally {
      stopWatcher(repo);
    }
  });
});

describe('MCP Server: av_review_walk', () => {
  it('无基线时返回 NO_BASELINE', () => {
    const repo = makeRepo(FIXTURE);
    const r = toolReviewWalk({ repo });
    assert.equal(r.error, 'NO_BASELINE');
  });

  it('对话走查 ≤8 行，含入口与可选 HTML 链接', () => {
    const repo = makeRepo(FIXTURE);
    try {
      toolSessionStart({ repo });
      fs.writeFileSync(
        path.join(repo, 'backend/routes/orders.py'),
        fs.readFileSync(path.join(repo, 'backend/routes/orders.py'), 'utf8') +
          '\nfrom database.db_session import save\n'
      );
      const r = toolReviewWalk({ repo });
      assert.ok(!r.error, r.message || JSON.stringify(r));
      assert.equal(r.tool, 'av_review_walk');
      assert.ok(r.lines.length <= 8, r.lines.join('\n'));
      assert.match(r.message, /审查走查/);
      assert.ok(r.walk);
    } finally {
      stopWatcher(repo);
    }
  });
});

describe('MCP Server: 输入 schema 校验（fail-closed）', () => {
  const { validateToolArgs } = require('../mcp/server');

  it('repo 必填：省略或空串均 fail-closed', () => {
    assert.throws(() => validateToolArgs('av_session_start', {}), /args\.repo: required/);
    assert.throws(() => validateToolArgs('av_session_start', { repo: '' }), /args\.repo: required/);
  });

  it('相对路径 repo 在 resolveRepo 阶段拒绝', () => {
    assert.throws(() => resolveRepo({ repo: 'relative/repo' }), /absolute path/);
  });

  it('非法 enum 拒绝', () => {
    assert.throws(
      () => validateToolArgs('av_archify_export', { repo: '/tmp/x', scope: 'all' }),
      /INVALID_ARGS|scope/
    );
  });

  it('未知字段拒绝', () => {
    assert.throws(
      () => validateToolArgs('av_session_report', { repo: '/tmp/x', hack: true }),
      /unexpected property/
    );
  });

  it('合法参数通过', () => {
    const v = validateToolArgs('av_archify_export', { repo: '/tmp/x', scope: 'layers', validate: false });
    assert.equal(v.scope, 'layers');
    const muted = validateToolArgs('av_guard', { repo: '/tmp/x', muteAwareness: 'schema-touched' });
    assert.equal(muted.muteAwareness, 'schema-touched');
  });

  it('handleToolCall 非法参数不执行工具', () => {
    assert.throws(
      () => handleToolCall({ name: 'av_session_start', arguments: { repo: '/tmp/x', hack: true } }),
      /INVALID_ARGS/
    );
  });
});
