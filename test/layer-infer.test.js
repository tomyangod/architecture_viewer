'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  inferLayerByImports,
  inferLayerByStructure,
  matchUserLayer,
  resolveLayer,
  aggregateDirectorySignals
} = require('../lib/layer-infer');
const { buildGraph } = require('../lib/extract-graph');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-layer-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

const imp = (specifier, names = []) => ({ specifier, names });

describe('layer-infer: import 语义信号', () => {
  it('storage: sqlalchemy / mongoose / gorm / JPA Repository 高置信', () => {
    assert.equal(inferLayerByImports([imp('sqlalchemy')]).layer, 'storage');
    assert.equal(inferLayerByImports([imp('sqlalchemy.orm')]).layer, 'storage');
    assert.equal(inferLayerByImports([imp('mongoose')]).layer, 'storage');
    assert.equal(inferLayerByImports([imp('@prisma/client')]).layer, 'storage');
    assert.equal(inferLayerByImports([imp('gorm.io/gorm')]).layer, 'storage');
    assert.equal(inferLayerByImports([imp('database/sql')]).layer, 'storage');
    const jpa = inferLayerByImports([imp('org.springframework.data.jpa.repository.JpaRepository')]);
    assert.equal(jpa.layer, 'storage');
    assert.equal(jpa.confidence, 'high');
  });

  it('controller: flask / express / gin / RestController 高置信', () => {
    assert.equal(inferLayerByImports([imp('flask')]).layer, 'controller');
    assert.equal(inferLayerByImports([imp('fastapi')]).layer, 'controller');
    assert.equal(inferLayerByImports([imp('express')]).layer, 'controller');
    assert.equal(inferLayerByImports([imp('github.com/gin-gonic/gin')]).layer, 'controller');
    const rest = inferLayerByImports([imp('org.springframework.web.bind.annotation.RestController')]);
    assert.equal(rest.layer, 'controller');
    assert.equal(rest.confidence, 'high');
  });

  it('NestJS: 按 import 符号区分 Controller 与 Injectable', () => {
    const ctrl = inferLayerByImports([imp('@nestjs/common', ['Controller', 'Get'])]);
    assert.equal(ctrl.layer, 'controller');
    assert.equal(ctrl.confidence, 'high');
    const svc = inferLayerByImports([imp('@nestjs/common', ['Injectable'])]);
    assert.equal(svc.layer, 'service');
    assert.equal(svc.confidence, 'medium');
  });

  it('domain: JPA @Entity 高置信', () => {
    const entity = inferLayerByImports([imp('jakarta.persistence.Entity')]);
    assert.equal(entity.layer, 'domain');
    assert.equal(entity.confidence, 'high');
  });

  it('中置信: pydantic→dto, net/http→controller, celery→service, redis→storage', () => {
    assert.equal(inferLayerByImports([imp('pydantic')]).layer, 'dto');
    assert.equal(inferLayerByImports([imp('net/http')]).layer, 'controller');
    assert.equal(inferLayerByImports([imp('celery')]).layer, 'service');
    assert.equal(inferLayerByImports([imp('redis')]).layer, 'storage');
    assert.equal(inferLayerByImports([imp('pydantic_settings')]).layer, 'config');
  });

  it('内部相对 import 不参与推断', () => {
    assert.equal(inferLayerByImports([imp('./models/user'), imp('../db')]), null);
  });

  it('多 import 投票: 高置信优先于中置信', () => {
    const r = inferLayerByImports([imp('pydantic'), imp('sqlalchemy.orm'), imp('os')]);
    assert.equal(r.layer, 'storage');
    assert.equal(r.confidence, 'high');
    assert.match(r.signal, /^import:sqlalchemy/);
  });
});

describe('layer-infer: 结构位置信号', () => {
  it('高 fan-in 低 fan-out → domain', () => {
    const r = inferLayerByStructure(5, 0);
    assert.equal(r.layer, 'domain');
    assert.equal(r.confidence, 'low');
  });
  it('高 fan-out 零 fan-in → controller', () => {
    const r = inferLayerByStructure(0, 6);
    assert.equal(r.layer, 'controller');
  });
  it('中间形态不猜', () => {
    assert.equal(inferLayerByStructure(1, 2), null);
    assert.equal(inferLayerByStructure(0, 3), null);
  });
});

describe('layer-infer: 信号合并', () => {
  it('用户配置最高优先', () => {
    const r = resolveLayer({
      filePath: 'mydata/foo.py',
      imports: [imp('flask')],
      userLayers: { mydata: 'storage' },
      dirLayer: null
    });
    assert.equal(r.layer, 'storage');
    assert.equal(r.signal, 'config:.av/layers.json');
  });

  it('import 高置信压过目录名, 并记录冲突', () => {
    const r = resolveLayer({
      filePath: 'services/web.py',
      imports: [imp('flask')],
      userLayers: null,
      dirLayer: 'service'
    });
    assert.equal(r.layer, 'controller');
    assert.equal(r.conflict.dirLayer, 'service');
  });

  it('import 中置信让位目录名', () => {
    const r = resolveLayer({
      filePath: 'services/worker.py',
      imports: [imp('pydantic')],
      userLayers: null,
      dirLayer: 'service'
    });
    assert.equal(r.layer, 'service');
    assert.equal(r.signal, 'dir-name');
  });

  it('目录名缺失时中置信 import 兜底', () => {
    const r = resolveLayer({
      filePath: 'mydata/user_repo.py',
      imports: [imp('sqlalchemy.orm')],
      userLayers: null,
      dirLayer: null
    });
    assert.equal(r.layer, 'storage');
  });

  it('matchUserLayer 大小写不敏感且按路径段匹配', () => {
    assert.equal(matchUserLayer('app/Database/user.go', { database: 'storage' }).layer, 'storage');
    assert.equal(matchUserLayer('app/other/x.go', { database: 'storage' }), null);
  });

  it('目录聚合: 多数决 + 冲突文件标注', () => {
    const agg = aggregateDirectorySignals([
      { file: 'db/a.py', layer: 'storage', confidence: 'high', signal: 'import:sqlalchemy' },
      { file: 'db/b.py', layer: 'storage', confidence: 'high', signal: 'dir-name' },
      { file: 'db/c.py', layer: 'controller', confidence: 'high', signal: 'import:flask' },
      { file: 'svc/x.py', layer: 'service', confidence: 'high', signal: 'dir-name', conflict: { dirLayer: 'service' } }
    ]);
    assert.equal(agg.db.layer, 'storage');
    assert.equal(agg.db.conflictingFiles.length, 1);
    assert.equal(agg.db.conflictingFiles[0].file, 'db/c.py');
    assert.equal(agg.svc.signalConflicts.length, 1);
  });
});

describe('layer-infer: buildGraph 集成', () => {
  it('非标准目录名通过 import 语义识别为 storage', () => {
    const dir = makeRepo({
      'mydata/user_repo.py': `
from sqlalchemy.orm import Session

class UserRepo:
    def __init__(self, db: Session):
        self.db = db
`,
      'mydata/order_repo.py': `
import sqlalchemy

class OrderRepo:
    pass
`
    });
    const g = buildGraph(dir);
    const f = g.nodes.find((n) => n.kind === 'file' && n.path.endsWith('user_repo.py'));
    assert.equal(f.layer, 'storage');
    assert.equal(f.layerConfidence, 'high');
    assert.match(f.layerSignal, /^import:sqlalchemy/);
  });

  it('Flask 路由文件在非标准目录下识别为 controller', () => {
    const dir = makeRepo({
      'app/endpoints.py': `
from flask import Flask, request

app = Flask(__name__)

@app.route('/ping')
def ping():
    return 'ok'
`
    });
    const g = buildGraph(dir);
    const f = g.nodes.find((n) => n.kind === 'file' && n.path.endsWith('endpoints.py'));
    assert.equal(f.layer, 'controller');
  });

  it('结构兜底: 被 3+ 文件依赖且不依赖别人的模块判 domain', () => {
    const dir = makeRepo({
      'base/mod.js': `
export const STATUS = { open: 'open', closed: 'closed' };
`,
      'a.js': `import { STATUS } from './base/mod';\nexport const a = STATUS.open;`,
      'b.js': `import { STATUS } from './base/mod';\nexport const b = STATUS.closed;`,
      'c.js': `import { STATUS } from './base/mod';\nexport const c = STATUS.open;`
    });
    const g = buildGraph(dir);
    const f = g.nodes.find((n) => n.kind === 'file' && n.path.endsWith('base/mod.js'));
    assert.equal(f.layer, 'domain');
    assert.equal(f.layerConfidence, 'low');
    assert.equal(f.layerSignal, 'structure:high-fan-in');
  });

  it('layerSignals 目录聚合输出', () => {
    const dir = makeRepo({
      'mydata/repo.py': `import sqlalchemy\nclass Repo: pass\n`
    });
    const g = buildGraph(dir);
    assert.ok(g.layerSignals, 'graph 应包含 layerSignals');
    const key = Object.keys(g.layerSignals).find((k) => k.endsWith('mydata'));
    assert.ok(key, 'mydata 目录应有建议');
    assert.equal(g.layerSignals[key].layer, 'storage');
  });
});
