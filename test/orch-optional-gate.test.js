'use strict';

// 主干服务可选误标修复（openim push_service 跨图一致性）：
//  证据层 lib.js：coreServiceTokens 遮蔽 feature-flag 误判；可达路径仅承认权威可选证据；
//                 Go pkg/ 工具库与 tools/ 不进旁路列表。
//  闸门层 run.js：requiredLabelGate 反向闸门 + stripMislabeledOptional 确定性剥离；
//                 optionalLabelGate 正向闸门对主干路径让位，避免双闸门互搏。

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const orchLib = require('../lib/orch/lib.js');
const { optionalLabelGate, requiredLabelGate, stripMislabeledOptional } = require('../lib/orch/run.js');

// ---------- 合成 Go 仓库：push 是默认部署服务（cmd 入口 + compose 无 profiles），
//             但配置里存在 PUSH_ENABLE 开关；profiler 是 compose profiles 服务（权威可选）；
//             plugins/notify 被主程序静态 import（可达但属插件区，权威可选）。 ----------
let repo;
let imp;

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-opt-gate-'));
  const put = (rel, content) => {
    fs.mkdirSync(path.join(repo, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), content);
  };
  put('go.mod', 'module example.com/demoapp\n\ngo 1.21\n');
  put('cmd/push/main.go', [
    'package main',
    '',
    'import (',
    '  "example.com/demoapp/internal/push"',
    '  "example.com/demoapp/plugins/notify"',
    ')',
    '',
    'func main() { push.Run(); notify.Run() }',
    ''
  ].join('\n'));
  put('cmd/worker/main.go', 'package main\n\nfunc main() {}\n');
  put('internal/push/push.go', [
    'package push',
    '',
    'import "example.com/demoapp/internal/push/callback"',
    '',
    'func Run() { callback.Do() }',
    ''
  ].join('\n'));
  put('internal/push/callback/callback.go', 'package callback\n\nfunc Do() {}\n');
  put('plugins/notify/notify.go', 'package notify\n\nfunc Run() {}\n');
  // pkg/ 工具库：无入口可达，但不应出现在旁路（detached）列表
  put('pkg/version/version.go', 'package version\n\nfunc Version() string { return "v0" }\n');
  // tools/ 开发工具：同上
  put('tools/devtool/main.go', 'package main\n\nfunc main() {}\n');
  put('docker-compose.yml', [
    'services:',
    '  push:',
    '    image: example/demo-push:latest',
    '  worker:',
    '    image: example/demo-worker:latest',
    '  profiler:',
    '    image: example/demo-profiler:latest',
    '    profiles: ["debug"]',
    ''
  ].join('\n'));
  // feature flag 开关：门控的是 push 内部行为/外部渠道，不是服务进程
  put('config/app.yaml', [
    'push:',
    '  enable: true   # PUSH_ENABLE 门控 FCM/APNs 渠道',
    'callback:',
    '  enable: false  # CALLBACK_ENABLE 回调 webhook',
    ''
  ].join('\n'));
  put('.env.example', 'PUSH_ENABLE=true\nCALLBACK_ENABLE=false\n');

  const tree = orchLib.buildTree(repo);
  const entries = [...tree.files].filter((f) => /^cmd\/[^/]+\/main\.go$/.test(f));
  imp = orchLib.importanceForensics(repo, tree, entries);
});

describe('证据层：feature-flag 不得把默认部署服务判成可选', () => {
  it('coreServiceTokens 从 cmd 入口与 compose 默认服务提取主干词元', () => {
    assert.ok(imp.coreTokens.includes('push'), 'coreTokens 应含 push（cmd/push + compose 服务）');
    assert.ok(imp.coreTokens.includes('worker'), 'coreTokens 应含 worker');
    assert.ok(!imp.coreTokens.includes('profiler'), 'profiler 带 profiles，不属于默认部署');
  });

  it('push 关键词被遮蔽（shadowedKw），不再出现在 optionalKw', () => {
    assert.ok(imp.shadowedKw.includes('push'));
    assert.ok(!imp.optionalKw.includes('push'), 'push 不应留在 optionalKw');
  });

  it('权威可选证据不被遮蔽：compose profiles 服务与插件目录仍在 optionalKw', () => {
    assert.ok(imp.optionalKw.includes('profiler'), 'profiles 服务 profiler 必须保留为可选');
    assert.ok(imp.optionalKw.some((k) => /plugin/.test(k)), '插件目录证据必须保留');
  });

  it('可达主干代码路径 optional=false（feature-flag 理由被过滤）', () => {
    const pushDir = imp.info('internal/push');
    assert.equal(pushDir.reachable, true);
    assert.equal(pushDir.optional, false, 'internal/push 随 cmd/push 默认部署，不是可选');
    const pushEntry = imp.info('cmd/push');
    assert.equal(pushEntry.reachable, true);
    assert.equal(pushEntry.optional, false);
  });

  it('可达路径上的 feature-flag 词（callback）不使其成为可选组件', () => {
    const cb = imp.info('internal/push/callback');
    assert.equal(cb.reachable, true);
    assert.equal(cb.optional, false, 'CALLBACK_ENABLE 门控运行时行为，代码仍随主程序部署');
  });

  it('反例：可达的插件目录代码仍判可选（权威证据不过滤）', () => {
    const plug = imp.info('plugins/notify');
    assert.equal(plug.reachable, true, '被主程序静态 import，可达');
    assert.equal(plug.optional, true, '插件/示例区是权威可选证据，可达也保留');
  });

  it('Go pkg/ 工具库与 tools/ 开发工具不进旁路（detached）列表', () => {
    const paths = (imp.detachedList || []).map((d) => d.path);
    assert.ok(!paths.some((p) => /(^|\/)pkg(\/|$)/.test(p)), 'pkg/ 不应出现在 detachedList：' + paths.join(','));
    assert.ok(!paths.some((p) => /(^|\/)tools(\/|$)/.test(p)), 'tools/ 不应出现在 detachedList：' + paths.join(','));
  });
});

// ---------- 闸门层：用 mock 取证对象做确定性断言 ----------
const mockImportance = {
  optionalKw: ['kafka'],
  info(p) {
    if (p === 'cmd/push' || p === 'internal/worker') return { heat: 10, reachable: true, optional: false };
    if (p === 'plugins/notify') return { heat: 3, reachable: true, optional: true };
    if (p === 'internal/legacy') return { heat: 2, reachable: false, optional: false, detached: true };
    return { heat: 0, reachable: false, optional: false };
  }
};

const sampleMd = [
  'flowchart TB',
  '  push["📨 推送服务（可选/实验）<br/><small>cmd/push</small>"]',
  '  worker["⚙️ 异步 Worker（可选）<br/><small>internal/worker</small>"]',
  '  plugin["🔌 通知插件（可选/实验）<br/><small>plugins/notify</small>"]',
  '  legacy["🧪 遗留工具<br/><small>internal/legacy</small>"]',
  '  ext_mq(["Kafka 消息队列（可选）<br/><small>(外部)</small>"])',
  '  ext_unmarked(["Kafka 备用集群<br/><small>(外部)</small>"])',
  ''
].join('\n');

describe('requiredLabelGate 反向闸门', () => {
  it('抓住主干/可达节点误标「可选/实验」', () => {
    const issues = requiredLabelGate(sampleMd, mockImportance);
    const ids = issues.map((s) => (s.match(/节点 (\w+)/) || [])[1]);
    assert.ok(ids.includes('push'), 'push 必须被抓');
    assert.ok(ids.includes('worker'), 'worker 必须被抓');
  });

  it('豁免：外部系统节点与权威可选（插件）节点', () => {
    const issues = requiredLabelGate(sampleMd, mockImportance);
    const text = issues.join('\n');
    assert.ok(!/ext_mq/.test(text), '外部 Kafka（(外部)）标可选合法');
    assert.ok(!/plugin/.test(text), '插件目录节点标可选合法');
  });

  it('无取证对象时安全降级（不报错、不误报）', () => {
    assert.deepEqual(requiredLabelGate(sampleMd, null), []);
  });
});

describe('stripMislabeledOptional 确定性剥离', () => {
  it('仅剥离主干节点的可选标记，保留外部/插件标记', () => {
    const res = stripMislabeledOptional(sampleMd, mockImportance);
    assert.equal(res.actions.length, 2, '应剥离 push + worker 两个节点');
    assert.ok(/push\["📨 推送服务<br\/><small>cmd\/push<\/small>"\]/.test(res.md), 'push 标记应被剥离');
    assert.ok(/worker\["⚙️ 异步 Worker<br\/><small>internal\/worker<\/small>"\]/.test(res.md), 'worker 标记应被剥离');
    assert.ok(/通知插件（可选\/实验）/.test(res.md), '插件标记必须保留');
    assert.ok(/Kafka 消息队列（可选）/.test(res.md), '外部系统标记必须保留');
  });

  it('幂等：二次剥离无新动作', () => {
    const once = stripMislabeledOptional(sampleMd, mockImportance);
    const twice = stripMislabeledOptional(once.md, mockImportance);
    assert.equal(twice.actions.length, 0);
  });

  it('剥离后节点语法仍完整（方括号/小括号闭合）', () => {
    const res = stripMislabeledOptional(sampleMd, mockImportance);
    for (const line of res.md.split('\n')) {
      if (!/^\s*\w+\s*[\[\(\{]/.test(line)) continue;
      const opens = (line.match(/[\[\(\{]/g) || []).length;
      const closes = (line.match(/[\]\)\}]/g) || []).length;
      assert.equal(opens, closes, '括号不配对：' + line);
    }
  });
});

describe('optionalLabelGate 正向闸门与反向闸门不互搏', () => {
  it('主干路径节点：不再被 feature-flag/可选词强制标注', () => {
    // push/worker 路径可达且非可选，即使 kafka 等可选词与标签无关也不应被强制
    const issues = optionalLabelGate(sampleMd, mockImportance, ['legacy']);
    const text = issues.join('\n');
    assert.ok(!/节点 push/.test(text), 'push 是主干，正向闸门不得要求标注可选');
    assert.ok(!/节点 worker/.test(text), 'worker 是主干，正向闸门不得要求标注可选');
  });

  it('旁路（detached）节点与外部未标注节点仍被正向闸门抓住', () => {
    const issues = optionalLabelGate(sampleMd, mockImportance, ['legacy']);
    const text = issues.join('\n');
    assert.ok(/legacy/.test(text), 'detached 旁路节点未标注必须被抓');
    assert.ok(/ext_unmarked/.test(text), '外部可选 Kafka 节点未标注必须被抓');
  });
});
