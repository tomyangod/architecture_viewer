'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    process.env[k] = env[k];
  }
  try { return fn(); } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe('telemetry module', () => {
  let tmpDir;
  let telemetry;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-tele-'));
    delete require.cache[require.resolve('../lib/telemetry')];
    telemetry = require('../lib/telemetry');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('default OFF — track() writes nothing', () => {
    withEnv({ ARCH_CONFIG_DIR: tmpDir, ARCH_TELEMETRY: '' }, () => {
      assert.equal(telemetry.isEnabled(), false);
      telemetry.track('test_event', { x: 1 });
      assert.equal(fs.existsSync(telemetry.logPath()), false);
    });
  });

  it('ARCH_TELEMETRY=1 turns on — track() writes JSONL entry', () => {
    withEnv({ ARCH_CONFIG_DIR: tmpDir, ARCH_TELEMETRY: '1' }, () => {
      assert.equal(telemetry.isEnabled(), true);
      telemetry.track('cli_command', { command: 'session', duration_ms: 42, exit_code: 0 });
      const lines = fs.readFileSync(telemetry.logPath(), 'utf8').trim().split('\n');
      assert.equal(lines.length, 1);
      const entry = JSON.parse(lines[0]);
      assert.equal(entry.event, 'cli_command');
      assert.equal(entry.command, 'session');
      assert.equal(entry.duration_ms, 42);
      assert.equal(entry.exit_code, 0);
      assert.ok(entry.version);
      assert.ok(entry.platform);
      assert.ok(entry.ts);
      assert.equal(entry.path, undefined);
      assert.equal(entry.repo, undefined);
      assert.equal(entry.code, undefined);
    });
  });

  it('DO_NOT_TRACK=1 overrides ARCH_TELEMETRY — never tracks', () => {
    withEnv({ ARCH_CONFIG_DIR: tmpDir, ARCH_TELEMETRY: '1', DO_NOT_TRACK: '1' }, () => {
      assert.equal(telemetry.isEnabled(), false);
      telemetry.track('test_event', {});
      assert.equal(fs.existsSync(telemetry.logPath()), false);
    });
  });

  it('ARCH_TELEMETRY_OFF overrides ARCH_TELEMETRY', () => {
    withEnv({ ARCH_CONFIG_DIR: tmpDir, ARCH_TELEMETRY: '1', ARCH_TELEMETRY_OFF: '1' }, () => {
      assert.equal(telemetry.isEnabled(), false);
    });
  });

  it('wrap() records command + duration + exit code', async () => {
    const saved = { ARCH_CONFIG_DIR: process.env.ARCH_CONFIG_DIR, ARCH_TELEMETRY: process.env.ARCH_TELEMETRY };
    process.env.ARCH_CONFIG_DIR = tmpDir;
    process.env.ARCH_TELEMETRY = '1';
    try {
      const result = await telemetry.wrap('extract', async () => 0);
      assert.equal(result, 0);
      const entry = JSON.parse(fs.readFileSync(path.join(tmpDir, 'telemetry.log'), 'utf8').trim());
      assert.equal(entry.event, 'cli_command');
      assert.equal(entry.command, 'extract');
      assert.equal(entry.exit_code, 0);
      assert.ok(entry.duration_ms >= 0);
    } finally {
      for (const k of Object.keys(saved)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  it('wrap() captures non-zero exit code on error', async () => {
    const saved = { ARCH_CONFIG_DIR: process.env.ARCH_CONFIG_DIR, ARCH_TELEMETRY: process.env.ARCH_TELEMETRY };
    process.env.ARCH_CONFIG_DIR = tmpDir;
    process.env.ARCH_TELEMETRY = '1';
    try {
      await assert.rejects(
        telemetry.wrap('check', async () => { throw new Error('boom'); }),
        /boom/
      );
      const entry = JSON.parse(fs.readFileSync(path.join(tmpDir, 'telemetry.log'), 'utf8').trim());
      assert.equal(entry.command, 'check');
      assert.equal(entry.exit_code, 1);
    } finally {
      for (const k of Object.keys(saved)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  it('payload contains no file paths or code snippets', () => {
    withEnv({ ARCH_CONFIG_DIR: tmpDir, ARCH_TELEMETRY: '1' }, () => {
      telemetry.track('cli_command', {
        command: 'diff',
        duration_ms: 100,
        exit_code: 0,
        filePath: '/secret/path/to/file.js',
        code: 'console.log("secret")',
        repo: 'https://github.com/secret',
        validNumber: 42
      });
      const entry = JSON.parse(fs.readFileSync(telemetry.logPath(), 'utf8').trim());
      assert.equal(entry.filePath, undefined, 'filePath must not be in payload');
      assert.equal(entry.code, undefined, 'code must not be in payload');
      assert.equal(entry.repo, undefined, 'repo must not be in payload');
      assert.equal(entry.validNumber, 42);
    });
  });
});
