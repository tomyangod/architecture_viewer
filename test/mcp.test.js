'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { TOOLS, handleToolCall, toolSessionStart, toolSessionReport, toolSessionChanges, toolCheckLayering, toolExplainFinding, stopWatcher } = require('../mcp/server');

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
  it('暴露且仅暴露 5 个工具', () => {
    const names = TOOLS.map(t => t.name);
    assert.equal(names.length, 5);
    assert.ok(names.includes('av_session_start'));
    assert.ok(names.includes('av_session_changes'));
    assert.ok(names.includes('av_session_report'));
    assert.ok(names.includes('av_check_layering'));
    assert.ok(names.includes('av_explain_finding'));
  });

  it('每个工具有 description 和 inputSchema', () => {
    for (const t of TOOLS) {
      assert.ok(t.description.length > 10, `${t.name} 缺 description`);
      assert.ok(t.inputSchema.properties.repo, `${t.name} 缺 repo 参数`);
      assert.ok(t.inputSchema.required.includes('repo'), `${t.name} repo 未标 required`);
    }
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
    assert.ok(result.summary.riskLevel);
    assert.ok(Array.isArray(result.findings));
    assert.ok(result.reportPaths.json);
    assert.ok(result.reportPaths.html);
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
    // 手动触发 report（watcher 防抖 20s，测试里直接调）
    const report = toolSessionReport({ repo });
    assert.ok(report.hasChanges, '应检测到新增文件');
    // changes 工具应反映 ready + hasChanges
    const changes = toolSessionChanges({ repo });
    assert.equal(changes.status, 'ready');
    assert.equal(changes.hasChanges, true);
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
      result.findings.some(f => f.includes('层级穿透') || f.includes('跨层')),
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
    stopWatcher(repo);
  });
});

describe('MCP Server: stdio JSON-RPC 协议', () => {
  it('initialize + tools/list + tools/call 全链路', async () => {
    const serverPath = path.join(__dirname, '..', 'mcp', 'server.js');
    const child = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });

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

    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const listResp = await waitForResponse(2);
    assert.equal(listResp.result.tools.length, 5);

    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'av_check_layering', arguments: { repo: makeRepo(FIXTURE) } } });
    const callResp = await waitForResponse(3);
    assert.ok(callResp.result.content[0].text.includes('layerCoverage'));

    child.kill();
  });
});
