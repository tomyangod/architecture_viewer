'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { extractFile } = require('../lib/extract/jsts');
const { buildGraph } = require('../lib/extract-graph');
const { diffGraphs, isArchitecturalEdge } = require('../lib/diff-graph');
const { buildReportData } = require('../lib/session-report');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-di-mod-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

const FOO_MODULE = 'export class FooModule {}\n';
const APP_CTRL = 'export class AppController {}\n';
const APP_SVC = 'export class AppService {}\n';
const EXTRA_SVC = 'export class ExtraService {}\n';

function appModuleSource(providersInner) {
  return [
    "import { Module } from '@nestjs/common';",
    "import { FooModule } from './foo.module';",
    "import { AppController } from './app.controller';",
    "import { AppService } from './app.service';",
    "import { ExtraService } from './extra.service';",
    '',
    '@Module({',
    '  imports: [FooModule],',
    '  controllers: [AppController],',
    `  providers: [${providersInner}],`,
    '})',
    'export class AppModule {}',
    ''
  ].join('\n');
}

describe('NestJS @Module di-registered', () => {
  it('jsts 抽出 @Module 三个数组里的类名', () => {
    const dir = makeRepo({
      'src/app.module.ts': appModuleSource('AppService'),
      'src/foo.module.ts': FOO_MODULE,
      'src/app.controller.ts': APP_CTRL,
      'src/app.service.ts': APP_SVC,
      'src/extra.service.ts': EXTRA_SVC
    });
    try {
      const fe = extractFile(path.join(dir, 'src/app.module.ts'), dir);
      assert.ok(!fe.error, fe.error);
      const byRole = {};
      for (const d of fe.diDependencies) {
        (byRole[d.role] || (byRole[d.role] = [])).push(d.refName);
      }
      assert.deepEqual(byRole.imports, ['FooModule']);
      assert.deepEqual(byRole.controllers, ['AppController']);
      assert.deepEqual(byRole.providers, ['AppService']);
      assert.ok(fe.diDependencies.every((d) => d.decorator === 'Module' && d.ownerName === 'AppModule'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('providers 里 useClass 也抽出类名', () => {
    const dir = makeRepo({
      'src/app.module.ts': [
        "import { Module } from '@nestjs/common';",
        "import { AppService } from './app.service';",
        '@Module({',
        "  providers: [{ provide: 'X', useClass: AppService }],",
        '})',
        'export class AppModule {}',
        ''
      ].join('\n'),
      'src/app.service.ts': APP_SVC
    });
    try {
      const fe = extractFile(path.join(dir, 'src/app.module.ts'), dir);
      assert.ok(fe.diDependencies.some((d) => d.role === 'providers' && d.refName === 'AppService'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('图上落 di-registered 实体边', () => {
    const dir = makeRepo({
      'src/app.module.ts': appModuleSource('AppService'),
      'src/foo.module.ts': FOO_MODULE,
      'src/app.controller.ts': APP_CTRL,
      'src/app.service.ts': APP_SVC,
      'src/extra.service.ts': EXTRA_SVC
    });
    try {
      const g = buildGraph(dir);
      const di = g.edges.filter((e) => e.type === 'di-registered' && e.from === 'src/app.module#AppModule');
      const tos = di.map((e) => e.to).sort();
      assert.deepEqual(tos, [
        'src/app.controller#AppController',
        'src/app.service#AppService',
        'src/foo.module#FooModule'
      ].sort());
      assert.ok(di.some((e) => e.role === 'imports' && e.decorator === 'Module'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('只改 providers 数组能进 session delta（架构边）', () => {
    const files = {
      'src/app.module.ts': appModuleSource('AppService'),
      'src/foo.module.ts': FOO_MODULE,
      'src/app.controller.ts': APP_CTRL,
      'src/app.service.ts': APP_SVC,
      'src/extra.service.ts': EXTRA_SVC
    };
    const dir = makeRepo(files);
    try {
      const baseline = buildGraph(dir);
      fs.writeFileSync(path.join(dir, 'src/app.module.ts'), appModuleSource('AppService, ExtraService'));
      const head = buildGraph(dir);
      const diff = diffGraphs(baseline, head);

      const addedDi = (diff.addedEdges || []).filter(
        (e) => e.type === 'di-registered' && e.to === 'src/extra.service#ExtraService'
      );
      assert.equal(addedDi.length, 1, '应新增 AppModule → ExtraService 的 di-registered: ' +
        JSON.stringify((diff.addedEdges || []).filter((e) => e.type === 'di-registered')));
      assert.ok(isArchitecturalEdge(addedDi[0]));
      assert.ok(
        (diff.summary.addedArchitecturalEdges || 0) >= 1,
        'addedArchitecturalEdges 应计入 di-registered'
      );
      // import 边未变：ExtraService 在 baseline 就已 import
      const addedImportToExtra = (diff.addedEdges || []).filter(
        (e) => e.type === 'import' && String(e.to).includes('extra.service')
      );
      assert.equal(addedImportToExtra.length, 0, 'providers 变更不应依赖新 import 边');

      const data = buildReportData(baseline, head, diff, [], null, 't', null);
      const implicit = data.edges.filter((e) => e.type === 'di-registered' && e.to === 'src/extra.service#ExtraService');
      assert.equal(implicit.length, 1);
      assert.equal(implicit[0].implicit, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
