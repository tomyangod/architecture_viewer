'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'lib', 'cli.js');
const { magicPrompt } = require('../lib/setup');

function tmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-setup-'));
  return dir;
}

function runSetup(homeDir) {
  const out = execFileSync('node', [CLI, 'setup', '--no-open'], {
    env: { ...process.env, HOME: homeDir },
    encoding: 'utf8'
  });
  return out;
}

describe('setup: 一键接入', () => {
  let home;

  before(() => { home = tmpHome(); });
  after(() => fs.rmSync(home, { recursive: true, force: true }));

  it('没装任何 AI 工具时给出友好提示，不崩溃', () => {
    const out = runSetup(home);
    assert.ok(out.includes('没有检测到'));
  });

  it('检测到 Cursor 时自动写入配置，且保留已有的其他 MCP 工具', () => {
    const cursorDir = path.join(home, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    const cfgPath = path.join(cursorDir, 'mcp.json');
    fs.writeFileSync(cfgPath, JSON.stringify({
      mcpServers: { 'mcp-server-chart': { command: 'npx', args: ['-y', 'chart'] } }
    }));

    const out = runSetup(home);
    assert.ok(out.includes('Cursor：装好了'));

    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.ok(cfg.mcpServers['arch-viewer'], '应写入 arch-viewer');
    assert.ok(cfg.mcpServers['mcp-server-chart'], '原有的 chart 工具必须保留');
    assert.equal(cfg.mcpServers['arch-viewer'].command, 'node');
    assert.ok(cfg.mcpServers['arch-viewer'].args[0].endsWith(path.join('mcp', 'server.js')));
    assert.ok(fs.existsSync(cfgPath + '.av-bak'), '应备份原配置');
  });

  it('重复运行幂等：第二次跳过已配置的工具', () => {
    const out = runSetup(home);
    assert.ok(out.includes('Cursor：之前已经装过，跳过'));
  });

  it('口令文案指向 av_guard，不含旧拍照仪式', () => {
    const out = runSetup(home);
    assert.ok(out.includes('av_guard'));
    assert.ok(out.includes('架构门') || out.includes('结构'));
  });

  it('口令不写死绝对路径，即使传入 repo', () => {
    const abs = '/Users/someone/Desktop/architecture_viewer';
    const text = magicPrompt(abs);
    assert.ok(!text.includes(abs), '不得把绝对路径写进口令');
    assert.ok(!text.includes('我的项目在'), '不得写死「我的项目在」');
    assert.ok(text.includes('当前工作区'));
  });
});

describe('setup: DeepSeek Harness (dsh) 接入', () => {
  let home;

  const DEFAULT_PATCH = [
    '# Your patch layer for this dsh profile, applied after every bundle layer:',
    '# a top-level YAML array of loader patch entries (id-targeted config',
    '# overrides, disables, and insert lists; `!!js` expressions allowed).',
    '[]'
  ].join('\n');

  function patchPath(profile) {
    return path.join(home, '.dsh', 'profiles', profile, 'cordis.patch.yml');
  }

  function mkProfile(profile, content) {
    const p = path.join(home, '.dsh', 'profiles', profile);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'cordis.patch.yml'), content);
  }

  before(() => { home = tmpHome(); });
  after(() => fs.rmSync(home, { recursive: true, force: true }));

  it('没装 dsh 时给出友好提示，不崩溃', () => {
    const out = runSetup(home);
    assert.ok(out.includes('DeepSeek Harness'));
  });

  it('检测到 dsh profile 时写入 cordis patch（空占位替换、保留注释、备份）', () => {
    mkProfile('headless', DEFAULT_PATCH);

    const out = runSetup(home);
    assert.ok(out.includes('DeepSeek Harness（命令行 模式）：装好了'));

    const patch = fs.readFileSync(patchPath('headless'), 'utf8');
    assert.ok(patch.includes('mcp-arch-viewer'), '应写入 entry id');
    assert.ok(patch.includes('@deepseek-ai/dsh-mcp-client'), '应引用 dsh-mcp-client 插件');
    assert.ok(patch.includes('transport: stdio'), '应为 stdio 传输');
    assert.ok(patch.includes('serverName: arch-viewer'), 'serverName 应为 arch-viewer');
    assert.ok(patch.includes('command: node'), '应用 node 启动');
    assert.ok(patch.match(/- ".*mcp\/server\.js"/), 'args 应指向 mcp/server.js');
    assert.ok(patch.includes('Your patch layer'), '原有注释应保留');
    assert.ok(!/\n\[\]\n/.test(patch), '空的 [] 占位应被替换掉');
    assert.ok(fs.existsSync(patchPath('headless') + '.av-bak'), '应备份原配置');
  });

  it('重复运行幂等：第二次跳过 dsh', () => {
    const out = runSetup(home);
    assert.ok(out.includes('DeepSeek Harness（命令行 模式）：之前已经装过，跳过'));
  });

  it('追加时保留已有的其他插件配置', () => {
    mkProfile('web', [
      '- insert:',
      '    - id: some-other-plugin',
      "      name: '@example/some-plugin'",
      ''
    ].join('\n'));

    const out = runSetup(home);
    assert.ok(out.includes('DeepSeek Harness（网页版 模式）：装好了'));

    const patch = fs.readFileSync(patchPath('web'), 'utf8');
    assert.ok(patch.includes('some-other-plugin'), '原有的插件必须保留');
    assert.ok(patch.includes('mcp-arch-viewer'), 'arch-viewer 应追加进去');
  });
});

describe('setup: 全局安装启动方式（全局安装后免 clone 仓库）', () => {
  const {
    isGlobalInstalled, resolveLauncher, dshPatchBlock, writeDshPatch, NPM_PACKAGE
  } = require('../lib/setup');

  /** 造一个假的「全局 node_modules」，里面装/不装 arch-viewer */
  function fakeGlobalRoot(installed) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'av-global-'));
    if (installed) {
      const pkgDir = path.join(root, NPM_PACKAGE);
      fs.mkdirSync(path.join(pkgDir, 'mcp'), { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: NPM_PACKAGE, version: '0.10.0' }));
      fs.writeFileSync(path.join(pkgDir, 'mcp', 'server.js'), "'use strict';\n");
    }
    return root;
  }

  /** mock exec：只认 `npm root -g`，返回指定目录；其他命令抛错 */
  function execReturning(root) {
    return (cmd) => {
      if (cmd.includes('npm root -g')) return root + '\n';
      throw new Error('unexpected command: ' + cmd);
    };
  }

  it('全局装了包 → isGlobalInstalled 返回 true', () => {
    const root = fakeGlobalRoot(true);
    assert.equal(isGlobalInstalled(execReturning(root)), true);
  });

  it('没装包 → isGlobalInstalled 返回 false', () => {
    const root = fakeGlobalRoot(false);
    assert.equal(isGlobalInstalled(execReturning(root)), false);
  });

  it('npm 命令不可用 → 安全回退 false', () => {
    assert.equal(isGlobalInstalled(() => { throw new Error('npm not found'); }), false);
  });

  it('全局装了 → resolveLauncher 直接使用该版本的 mcp/server.js', () => {
    const root = fakeGlobalRoot(true);
    const l = resolveLauncher(execReturning(root));
    assert.equal(l.mode, 'global');
    assert.equal(l.command, process.execPath);
    assert.deepEqual(l.args, [path.join(root, NPM_PACKAGE, 'mcp', 'server.js')]);
    assert.equal(l.version, '0.10.0');
  });

  it('没装 → resolveLauncher 回退本地 node + mcp/server.js', () => {
    const root = fakeGlobalRoot(false);
    const l = resolveLauncher(execReturning(root));
    assert.equal(l.mode, 'local');
    assert.equal(l.command, 'node');
    assert.ok(l.args[0].endsWith(path.join('mcp', 'server.js')), 'args 应指向仓库内 server.js');
  });

  it('global launcher 生成的 dsh patch 固定使用已安装包路径', () => {
    const root = fakeGlobalRoot(true);
    const launcher = resolveLauncher(execReturning(root));
    const block = dshPatchBlock(launcher);
    assert.ok(block.includes(process.execPath), '应使用当前 Node 启动');
    assert.ok(block.includes(path.join(root, NPM_PACKAGE, 'mcp', 'server.js')), '应固定到检测到的全局安装');
    assert.ok(!block.includes('npx'), '不得再次通过 npx 解析其他版本');
    assert.ok(block.includes('transport: stdio'), '仍应为 stdio');
  });

  it('writeDshPatch 用 global launcher 写出的文件可被 dsh 识别', () => {
    const root = fakeGlobalRoot(true);
    const launcher = resolveLauncher(execReturning(root));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-dsh-npx-'));
    const patchPath = path.join(dir, 'cordis.patch.yml');
    fs.writeFileSync(patchPath, '# comment\n[]\n');

    const r = writeDshPatch(patchPath, launcher);
    assert.equal(r.changed, true);

    const content = fs.readFileSync(patchPath, 'utf8');
    assert.ok(content.includes('id: mcp-arch-viewer'));
    assert.ok(content.includes(process.execPath));
    assert.ok(content.includes(path.join(root, NPM_PACKAGE, 'mcp', 'server.js')));
    assert.ok(!content.includes('npx'), '不得写入未固定版本的 npx launcher');
    assert.ok(content.includes('# comment'), '原有注释应保留');
  });
});
