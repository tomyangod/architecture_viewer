#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function isolatedEnv(owned, source = process.env) {
  const env = {};
  // Allowlist rather than blacklist: no provider credentials, NODE_OPTIONS,
  // external analyzer overrides, or user npm configuration reach the children.
  for (const [key, value] of Object.entries(source)) {
    if (/^(path|systemroot|windir|comspec|pathext|processor_architecture|number_of_processors)$/i.test(key)) {
      env[key] = value;
    }
  }
  return Object.assign(env, {
    HOME: owned, USERPROFILE: owned,
    TMPDIR: owned, TMP: owned, TEMP: owned,
    CI: '1', NO_COLOR: '1',
    AV_BASELINE: 'snapshot',
    npm_config_cache: path.join(owned, 'npm-cache'),
    npm_config_userconfig: path.join(owned, 'empty.npmrc'),
    npm_config_globalconfig: path.join(owned, 'empty-global.npmrc'),
    npm_config_audit: 'false', npm_config_fund: 'false',
    npm_config_fetch_timeout: '30000',
    npm_config_fetch_retries: '2',
    npm_config_fetch_retry_mintimeout: '1000',
    npm_config_fetch_retry_maxtimeout: '5000'
  });
}

function run(command, args, { cwd, env, expected = 0, input, timeout = 60000 } = {}) {
  const result = spawnSync(command, args, {
    cwd, env, input, encoding: 'utf8', timeout,
    maxBuffer: 16 * 1024 * 1024, windowsHide: true, killSignal: 'SIGKILL'
  });
  assert.ok(!result.error,
    `${command} ${args.join(' ')}\n${result.error ? result.error.message : ''}\n${result.stdout || ''}\n${result.stderr || ''}`);
  assert.equal(result.signal, null, `${command} terminated: ${result.signal}`);
  assert.equal(result.status, expected,
    `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function npmCli() {
  const candidates = [process.env.npm_execpath];
  const searchPath = process.env.PATH || process.env.Path || '';
  for (const dir of searchPath.split(path.delimiter)) {
    candidates.push(path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    const launcher = path.join(dir, 'npm');
    if (fs.existsSync(launcher)) candidates.push(fs.realpathSync(launcher));
  }
  const found = candidates.find(file => file && path.basename(file) === 'npm-cli.js' && fs.existsSync(file));
  assert.ok(found, 'Cannot locate npm-cli.js on PATH (npm must be installed with Node)');
  // Invoke npm with Node, avoiding Windows .cmd shell quoting and PATH bin ambiguity.
  return found;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function htmlPayload(html) {
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/i, 'Report must use inline scripts only');
  const match = html.match(/const REPORT_DATA = ([^\r\n]+);/);
  assert.ok(match, 'Missing embedded report contract');
  return JSON.parse(match[1]);
}

function assertPackedContents(files) {
  assert.ok(files.some(file => file.path === 'docs/delivery-scope.md'),
    'docs/delivery-scope.md must be included in npm pack');
  assert.equal(files.some(file => file.path === '.av' || file.path.startsWith('.av/')), false,
    'Source-session .av artifacts must not enter the candidate package');
}

function acceptanceOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--offline') options.offline = true;
    else if (args[i] === '--npm-cache') {
      const cache = args[++i];
      assert.ok(cache && path.isAbsolute(cache), '--npm-cache requires an absolute directory path');
      options.npmCache = cache;
    } else {
      throw new Error(`Unknown acceptance option: ${args[i]}`);
    }
  }
  assert.ok(!options.offline || options.npmCache, '--offline requires --npm-cache with preloaded dependencies');
  return options;
}

function verifyPackedDelivery({ npmCache, offline = false } = {}) {
  assert.ok(!npmCache || path.isAbsolute(npmCache), 'npmCache must be an absolute directory path');
  assert.ok(!offline || npmCache, 'offline acceptance requires a preloaded npmCache');
  const npm = npmCli();
  // Node 18 otherwise tries only one DNS address, unlike newer Node defaults.
  const npmArgs = ['-e',
    "require('node:net').setDefaultAutoSelectFamily?.(true); require(process.argv[1]);", npm];
  const sourcePackage = readJson(path.join(ROOT, 'package.json'));
  const gitStatus = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: ROOT, env: isolatedEnv(ROOT), encoding: 'utf8', timeout: 10000
  });
  const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT, env: isolatedEnv(ROOT), encoding: 'utf8', timeout: 10000
  });
  const source = {
    commit: gitHead.status === 0 ? gitHead.stdout.trim() : null,
    dirty: gitStatus.status === 0 ? gitStatus.stdout.trim().length > 0 : null
  };
  // Keep all artifacts below one uniquely owned directory, never the user's .av.
  const owned = fs.mkdtempSync(path.join(ROOT, '.packed-delivery-'));
  let evidence;
  try {
    const env = isolatedEnv(owned);
    if (npmCache) env.npm_config_cache = npmCache;
    if (offline) env.npm_config_offline = 'true';
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
    env[pathKey] = path.dirname(process.execPath) + path.delimiter + (env[pathKey] || '');
    const runtimeRoot = path.resolve(path.dirname(fs.realpathSync(process.execPath)), '..');
    const versionHeader = path.join(runtimeRoot, 'include', 'node', 'node_version.h');
    if (fs.existsSync(versionHeader)) {
      const header = fs.readFileSync(versionHeader, 'utf8');
      const parts = process.versions.node.split('.');
      if (['MAJOR', 'MINOR', 'PATCH'].every((part, index) =>
        new RegExp(`#define\\s+NODE_${part}_VERSION\\s+${parts[index]}\\b`).test(header))) {
        env.npm_config_nodedir = runtimeRoot;
      }
    }
    fs.writeFileSync(path.join(owned, 'empty.npmrc'), '');
    fs.writeFileSync(path.join(owned, 'empty-global.npmrc'), '');
    const packed = JSON.parse(run(process.execPath, [
      ...npmArgs, 'pack', '--json', '--ignore-scripts', '--pack-destination', owned
    ], { cwd: ROOT, env, timeout: 120000 }));
    assert.equal(packed.length, 1);
    const tarball = path.join(owned, packed[0].filename);
    assert.equal(path.dirname(tarball), owned);
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(tarball)).digest('hex');
    assertPackedContents(packed[0].files);
    evidence = {
      package: sourcePackage.name, version: sourcePackage.version, sha256,
      node: process.version, platform: process.platform, arch: process.arch,
      npm: run(process.execPath, [...npmArgs, '--version'], { cwd: owned, env }).trim(),
      source, installation: { offline, cache: npmCache ? 'explicit' : 'isolated-empty' }, cases: []
    };
    console.log('Packed artifact: ' + JSON.stringify(evidence));

    const project = path.join(owned, 'consumer');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
      name: 'packed-delivery-consumer', version: '1.0.0', private: true
    }));
    run(process.execPath, [
      ...npmArgs, 'install', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false', tarball
    ], { cwd: project, env, timeout: 300000 });
    const installed = path.join(project, 'node_modules', sourcePackage.name);
    assert.equal(fs.lstatSync(installed).isSymbolicLink(), false, 'Must install a tarball, not link source');
    const manifest = readJson(path.join(installed, 'package.json'));
    assert.equal(manifest.version, sourcePackage.version);
    assert.ok(fs.statSync(path.join(installed, 'docs/delivery-scope.md')).size > 0);
    for (const tooling of ['@playwright/test', '@vscode/vsce']) {
      assert.equal(fs.existsSync(path.join(project, 'node_modules', tooling)), false,
        `Runtime-only installation unexpectedly contains ${tooling}`);
    }
    const cli = fs.realpathSync(path.join(installed, manifest.bin['arch-viewer']));
    const mcp = fs.realpathSync(path.join(installed, manifest.bin['arch-viewer-mcp']));
    for (const entry of [cli, mcp]) {
      assert.ok(entry.startsWith(fs.realpathSync(installed) + path.sep), 'Entry point escaped installed package');
    }
    const nativeRepo = path.join(owned, 'native-parsers');
    const nativeFiles = {
      'py/domain/order.py': 'class Order:\n    pass\n',
      'py/app/service.py': 'from py.domain.order import Order as Ord\nclass Service:\n    def handle(self, o: Ord) -> Ord:\n        return o\n',
      'ts/domain/order.ts': 'export class Order {}\n',
      'ts/app/service.ts': 'import { Order as Ord } from "../domain/order";\nexport class Service extends Ord {}\n',
      'java/Main.java': 'public class Main {}\n',
      'go/main.go': 'package main\ntype Main struct {}\n',
      'web/view.vue': '<script>export default {};</script>\n',
      'web/widget.svelte': '<script>let value = 1;</script>\n',
      'js/main.js': 'export class Main {}\n'
    };
    for (const [file, content] of Object.entries(nativeFiles)) {
      const target = path.join(nativeRepo, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    const nativeStats = JSON.parse(run(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const { buildGraph } = require(process.argv[1]);
      let graph;
      for (let i = 0; i < 3; i++) {
        graph = buildGraph(process.argv[2]);
        assert.equal(graph.stats.files, 9);
        assert.equal(graph.stats.filesParsed, 9);
        assert.equal(graph.stats.parseErrors, 0);
        assert.ok(graph.edges.some(edge => edge.type === 'extends'
          && edge.from === 'ts/app/service#Service' && edge.to === 'ts/domain/order#Order'));
        assert.ok(graph.edges.some(edge => edge.type === 'method-param'
          && edge.from === 'py/app/service#Service' && edge.to === 'py/domain/order#Order'));
      }
      console.log(JSON.stringify(graph.stats));
    `, path.join(installed, 'lib', 'extract-graph.js'), nativeRepo], {
      cwd: project, env
    }));
    evidence.nativeParsers = { filesParsed: nativeStats.filesParsed, parseErrors: nativeStats.parseErrors, repeatedScans: 3 };
    // Stage only the test harness; its relative imports resolve to tarball code.
    const regressionSuites = [
      'delivery-hardening.test.js', 'python-bindings.test.js', 'js-bindings.test.js',
      'incremental.test.js', 'refine-cache.test.js', 'llm-sanitize.test.js',
      'layering-snapshot.test.js', 'generate-facts.test.js',
      'session-explain-evidence.test.js', 'session-verdict.test.js',
      'template-cleanup.test.js', 'view-policy.test.js',
      'source-content-line-endings.test.js', 'test-index.test.js',
      'inferred-layer-policy.test.js'
    ];
    const hardeningTests = regressionSuites.map(file => {
      const target = path.join(installed, 'test', file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'test', file), target);
      return target;
    });
    const hardeningOutput = run(process.execPath,
      ['--test', '--test-reporter=tap', ...hardeningTests], { cwd: project, env });
    const passed = hardeningOutput.match(/^# pass (\d+)$/m);
    assert.ok(passed && Number(passed[1]) > 0, hardeningOutput);
    evidence.deliveryHardeningTests = { suites: regressionSuites, passed: Number(passed[1]), failed: 0 };
    function fixture(name) {
      const repo = path.join(owned, name);
      fs.mkdirSync(path.join(repo, '.av'), { recursive: true });
      // An unborn local repository prevents parent-worktree baseline discovery.
      run('git', ['init', '--quiet', repo], { cwd: owned, env });
      fs.writeFileSync(path.join(repo, '.av', 'layers.json'), JSON.stringify({
        controllers: 'controller', storage: 'storage'
      }));
      fs.writeFileSync(path.join(repo, 'architecture-rules.yaml'),
        'version: 1\nname: packed-acceptance\nforbid_cross_layer:\n' +
        '  - id: no-controller-to-storage\n    from: controller\n    to: storage\n' +
        '    message: Controllers must use a service instead of storage directly\n');
      for (const dir of ['controllers', 'storage']) fs.mkdirSync(path.join(repo, dir));
      fs.writeFileSync(path.join(repo, 'controllers', 'api.js'),
        'export function handle(value) { return value; }\n');
      fs.writeFileSync(path.join(repo, 'storage', 'db.js'),
        'export function save(value) { return value; }\n');
      return repo;
    }

    function cliRun(repo, args, expected = 0) {
      return run(process.execPath, [cli, 'session', ...args, repo, '--renderer', 'builtin'],
        { cwd: repo, env, expected });
    }

    function mcpReport(repo) {
      const requests = [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call',
          params: { name: 'av_session_report', arguments: { repo } } }
      ];
      // Closing stdin ends the real stdio server; report does not start a watcher.
      const output = run(process.execPath, [mcp], {
        cwd: repo, env, input: requests.map(item => JSON.stringify(item)).join('\n') + '\n'
      });
      const responses = output.trim().split(/\r?\n/).map(line => JSON.parse(line));
      const init = responses.find(item => item.id === 1);
      assert.equal(init.result.serverInfo.version, manifest.version);
      const response = responses.find(item => item.id === 2);
      assert.ok(response && !response.error, JSON.stringify(response));
      return JSON.parse(response.result.content.find(item => item.type === 'text').text);
    }

    function reportCase(name, repo, exitCode, status, risk) {
      cliRun(repo, ['report'], exitCode);
      const cliJson = readJson(path.join(repo, '.av', 'session-report.json'));
      assert.equal(cliJson.analysis.status, status);
      assert.equal(cliJson.analysis.allowGreen, status === 'ok');
      assert.equal(cliJson.risk.level, risk);
      const cliHtml = htmlPayload(fs.readFileSync(path.join(repo, '.av', 'session-report.html'), 'utf8'));
      assert.deepEqual(cliHtml.analysis, cliJson.analysis);
      assert.equal(cliHtml.risk.level, cliJson.risk.level);
      const fromMcp = mcpReport(repo);
      assert.equal(fromMcp.exitCode, exitCode);
      assert.equal(fromMcp.analysisStatus, cliJson.analysis.status);
      assert.equal(fromMcp.analysisAllowGreen, cliJson.analysis.allowGreen);
      assert.equal(fromMcp.riskLevel, cliJson.risk.level);
      const mcpJson = readJson(fromMcp.reportPaths.json);
      assert.deepEqual(mcpJson.analysis, cliJson.analysis);
      assert.deepEqual(mcpJson.risk, cliJson.risk);
      const html = fs.readFileSync(fromMcp.reportPaths.builtinHtml, 'utf8');
      const embedded = htmlPayload(html);
      assert.deepEqual(embedded.analysis, cliJson.analysis);
      assert.equal(embedded.risk.level, cliJson.risk.level);
      if (status === 'incomplete') {
        assert.ok(embedded.analysis.reasons.length > 0);
        assert.match(html, /analysis-banner/);
      }
      if (exitCode === 1) {
        assert.ok(cliJson.findings.some(item => item.rule === 'no-controller-to-storage'));
        assert.ok(fromMcp.findings.some(item => item.rule === 'no-controller-to-storage'));
      }
      evidence.cases.push({ name, exitCode, analysis: status, risk });
    }

    const repo = fixture('session');
    cliRun(repo, ['start']);
    reportCase('unchanged', repo, 0, 'ok', 'none');
    fs.writeFileSync(path.join(repo, 'controllers', 'api.js'),
      'import { save } from "../storage/db.js";\nexport function handle(value) { return save(value); }\n');
    reportCase('team-rule-violation', repo, 1, 'ok', 'high');

    const incomplete = fixture('incomplete');
    cliRun(incomplete, ['start']);
    fs.writeFileSync(path.join(incomplete, 'oversized.js'), '// oversized\n' + ' '.repeat(600000));
    reportCase('oversized-scan', incomplete, 3, 'incomplete', 'medium');

    const missing = fixture('no-baseline');
    cliRun(missing, ['report'], 4);
    assert.equal(mcpReport(missing).error, 'NO_BASELINE');
    evidence.cases.push({ name: 'no-baseline', exitCode: 4, mcpError: 'NO_BASELINE' });
    console.log('Packed delivery PASS: ' + JSON.stringify(evidence));
    return evidence;
  } finally {
    fs.rmSync(owned, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

module.exports = { isolatedEnv, htmlPayload, assertPackedContents, acceptanceOptions, verifyPackedDelivery };

if (require.main === module) {
  try {
    verifyPackedDelivery(acceptanceOptions(process.argv.slice(2)));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
