'use strict';

// 分支 b 落地验收：
//  1) sweep 0b：shape 模板 stadium ext_db（「外部数据库」）改圆柱归位后 actor-infra 清零
//     —— vaultwarden orch8 r1 真根因不是 INFRA_RE 漏 _pgsql，是 api-svc 默认 stadium 模板
//  2) sweep 0b 不误伤 bridge 协议对端（zigbee 设备网络 / MQTT broker）
//  3) chooseOrchEngine 规则：high/strongTop/强协议形态(proxy,bridge) → orch4；
//     medium/low 或已知歧义(api-svc↔notify-bus、notify-bus↔web) → orch8
//     —— z2m 复测（blind-z2m-retest）：bridge orch8 盲评 7.67 vs orch4 8.0 仍输，收紧为 proxy/bridge 一律 orch4

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const orchLib = require('../lib/orch/lib.js');
const { structureGates, deterministicSweep, chooseOrchEngine } = require('../lib/orch/run.js');

function wrap(code) {
  return '## 子图1：分层\n\n```mermaid\n' + code.trim() + '\n```\n';
}

function highs(md) {
  return structureGates(md, [], null, ['demo']).filter((x) => x.severity === 'high');
}

const VW_STADIUM_DB = wrap(`
flowchart TB
    actor_user(["👤 用户"])
    ext_db(["🗄️ 外部数据库"])
    subgraph L_api["🔌 后端/API"]
        direction LR
        api_core["🎯 核心 API<br/><small>src/api.rs</small>"]
    end
    subgraph L_storage["🗄️ 数据存储"]
        direction LR
        db_local[("🗄️ 本地数据<br/><small>data/</small>")]
    end
    actor_user -->|调用| api_core
    api_core -->|读写| ext_db
    ext_db -->|落盘| db_local
    classDef apiColor fill:#ede7f6
    classDef storageColor fill:#e0f7fa
    classDef actorColor fill:#eceff1
    class api_core apiColor
    class db_local storageColor
    class actor_user,ext_db actorColor
`);

const BRIDGE_STADIUM = wrap(`
flowchart TB
    actor_user(["👤 用户"])
    ext_broker(["📡 MQTT 消息代理 (Broker)"])
    ext_device(["📶 设备网络（协调器/终端设备）"])
    subgraph L_api["🔌 后端/API"]
        direction LR
        controller["🎯 主控制器<br/><small>lib/controller.js</small>"]
    end
    actor_user -->|发布| ext_broker
    ext_broker -->|订阅| controller
    controller -->|适配| ext_device
    classDef apiColor fill:#ede7f6
    classDef actorColor fill:#eceff1
    class controller apiColor
    class actor_user,ext_broker,ext_device actorColor
`);

describe('sweep 0b：stadium 伪基础设施', () => {
  it('把 api-svc 模板 stadium ext_db 改圆柱后 actor-infra / actor-storage 清零', () => {
    const before = highs(VW_STADIUM_DB);
    assert.ok(before.some((x) => x.kind === 'actor-infra'),
      '扫尾前应报 actor-infra，实得 ' + before.map((x) => x.kind).join(','));
    assert.ok(before.some((x) => x.kind === 'actor-storage'),
      '扫尾前应报 actor-storage（stadium DB 直连存储圆柱）');

    const swept = deterministicSweep(VW_STADIUM_DB, [], ['demo']);
    assert.ok(swept.actions.some((a) => /伪基础设施|圆柱/.test(a)),
      '应产生 stadium→圆柱归位动作，实得 ' + JSON.stringify(swept.actions));
    assert.match(swept.md, /ext_db\[\(/, 'ext_db 应变圆柱 [(');
    assert.doesNotMatch(swept.md, /ext_db\(\[/, 'ext_db 不应再是 stadium');

    const after = highs(swept.md);
    assert.equal(after.filter((x) => x.kind === 'actor-infra' || x.kind === 'actor-storage').length, 0,
      '扫尾后不应再否决：' + after.map((x) => x.kind + ':' + x.issue).join(' | '));
  });

  it('复合 id ext_db_mysql_pgsql 同样改圆柱（标签含「数据库」/mysql）', () => {
    const md = VW_STADIUM_DB
      .replace(/ext_db\(\["🗄️ 外部数据库"\]\)/g, 'ext_db_mysql_pgsql(["🗄️ 外部数据库 MySQL/PgSQL"])')
      .replace(/\bext_db\b/g, 'ext_db_mysql_pgsql');
    const before = highs(md);
    assert.ok(before.some((x) => x.kind === 'actor-infra'));
    const swept = deterministicSweep(md, [], ['demo']);
    assert.match(swept.md, /ext_db_mysql_pgsql\[\(/);
    const after = highs(swept.md);
    assert.equal(after.filter((x) => x.kind === 'actor-infra' || x.kind === 'actor-storage').length, 0);
  });

  it('不把 bridge 协议对端（broker/设备网络/协调器）改成圆柱', () => {
    const swept = deterministicSweep(BRIDGE_STADIUM, [], ['zigbee2mqtt']);
    assert.ok(!swept.actions.some((a) => /伪基础设施/.test(a)),
      'bridge 对端不应被 0b 误伤：' + JSON.stringify(swept.actions));
    assert.match(swept.md, /ext_broker\(\[/);
    assert.match(swept.md, /ext_device\(\[/);
  });
});

describe('chooseOrchEngine（分支 b 写死规则）', () => {
  const cands = (pairs) => pairs.map(([kind, score]) => ({ kind, score, signal: '' }));

  it('high（margin>3）走 orch4', () => {
    const r = chooseOrchEngine({
      shapeConfidence: 'high', shapeMargin: 7, shape: { kind: 'api-svc' },
      shapeCandidates: cands([['api-svc', 8], ['web', 1]])
    });
    assert.equal(r.engine, 'orch4');
    assert.equal(r.strongTop, false);
  });

  it('strongTop（bridge score=10 且 margin>=3）走 orch4', () => {
    const r = chooseOrchEngine({
      shapeConfidence: 'medium', shapeMargin: 3, shape: { kind: 'bridge' },
      shapeCandidates: cands([['bridge', 10], ['web', 7]])
    });
    assert.equal(r.engine, 'orch4');
    assert.equal(r.strongTop, true);
  });

  it('强协议形态 proxy 即使 medium/margin=2 也走 orch4（caddy；z2m 复测收紧）', () => {
    const r = chooseOrchEngine({
      shapeConfidence: 'medium', shapeMargin: 2, shape: { kind: 'proxy' },
      shapeCandidates: cands([['proxy', 9], ['api-svc', 7]])
    });
    assert.equal(r.engine, 'orch4');
    assert.equal(r.strongProtocolShape, true);
  });

  it('强协议形态 bridge 非 strongTop 也走 orch4', () => {
    const r = chooseOrchEngine({
      shapeConfidence: 'medium', shapeMargin: 2, shape: { kind: 'bridge' },
      shapeCandidates: cands([['bridge', 9], ['web', 7]])
    });
    assert.equal(r.engine, 'orch4');
    assert.equal(r.strongProtocolShape, true);
    assert.equal(r.strongTop, false);
  });

  it('已知歧义 api-svc↔notify-bus 强制 orch8（openim）', () => {
    const r = chooseOrchEngine({
      shapeConfidence: 'medium', shapeMargin: 2, shape: { kind: 'notify-bus' },
      shapeCandidates: cands([['notify-bus', 9], ['api-svc', 7]])
    });
    assert.equal(r.engine, 'orch8');
    assert.equal(r.knownAmbiguousCombo, true);
  });

  it('已知歧义 notify-bus↔web 强制 orch8（ntfy）', () => {
    const r = chooseOrchEngine({
      shapeConfidence: 'medium', shapeMargin: 2, shape: { kind: 'web' },
      shapeCandidates: cands([['web', 10], ['notify-bus', 8]])
    });
    assert.equal(r.engine, 'orch8');
    assert.equal(r.knownAmbiguousCombo, true);
  });

  it('low 走 orch8', () => {
    const r = chooseOrchEngine({
      shapeConfidence: 'low', shapeMargin: 1, shape: { kind: 'web' },
      shapeCandidates: cands([['web', 1], ['api-svc', 0]])
    });
    assert.equal(r.engine, 'orch8');
  });
});

describe('shapeDetect 置信度信号', () => {
  it('纯 Rust 无前端 → api-svc high', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'av-shape-rs-'));
    const put = (rel, content) => {
      fs.mkdirSync(path.join(repo, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(repo, rel), content);
    };
    put('Cargo.toml', '[package]\nname="vw"\nversion="0.1.0"\n');
    put('src/main.rs', 'fn main() {}\n');
    put('src/api.rs', 'pub fn api() {}\n');
    const tree = orchLib.buildTree(repo);
    const imp = orchLib.importanceForensics(repo, tree, ['src/main.rs']);
    assert.equal(imp.shape.kind, 'api-svc');
    assert.equal(imp.shapeConfidence, 'high');
    assert.ok(imp.shapeMargin > 3);
    assert.equal(chooseOrchEngine(imp).engine, 'orch4');
  });
});
