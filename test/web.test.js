const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');

// Web server exposes public-hosting-safe defaults (path/samples/projects off).
// We opt into the unsafe features *before* requiring server.js so the
// module-level feature flags are evaluated correctly (server.js caches them
// at require-time based on process.env).
process.env.ARCH_WEB_PATH_MODE = '1';
process.env.ARCH_WEB_PROJECTS_LIST = '1';
process.env.ARCH_WEB_SAMPLES = '1';
const { handler, generateOptsFromBody } = require('../web/server');

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: urlPath,
          method,
          headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            server.close();
            resolve({
              status: res.statusCode,
              body: Buffer.concat(chunks).toString('utf8'),
              headers: res.headers
            });
          });
        }
      );
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      if (body) req.write(body);
      req.end();
    });
  });
}

describe('generateOptsFromBody', () => {
  it('quality=refine maps to the same llm path as CLI --refine', () => {
    const r = generateOptsFromBody({ quality: 'refine', apiKey: 'sk-test' });
    assert.equal(r.mode, 'llm');
    assert.equal(r.strict, true);
    assert.equal(r.quality, 'refine');
    assert.equal(r.apiKey, 'sk-test');
  });

  it('quality=fast maps to skeleton', () => {
    const r = generateOptsFromBody({ quality: 'fast' });
    assert.equal(r.mode, 'skeleton');
    assert.equal(r.strict, false);
    assert.equal(r.quality, 'fast');
  });
});

describe('web product API', () => {
  it('health', async () => {
    const r = await request('GET', '/api/health');
    assert.equal(r.status, 200);
    assert.match(r.body, /architecture-viewer-web/);
    const data = JSON.parse(r.body);
    assert.equal(typeof data.llmAvailable, 'boolean');
  });

  it('landing page', async () => {
    const r = await request('GET', '/');
    assert.equal(r.status, 200);
    assert.match(r.body, /Architecture Viewer/);
    assert.match(r.body, /demo\.mp4/);
    assert.match(r.body, /¥29/);
    assert.match(r.body, /install|安装/i);
  });

  it('serves demo video from docs/', async () => {
    const r = await request('GET', '/demo.mp4');
    assert.equal(r.status, 200);
    assert.match(String(r.headers['content-type'] || ''), /video\/mp4/);
    assert.ok(Buffer.byteLength(r.body) > 10000);
    const vtt = await request('GET', '/demo.zh.vtt');
    assert.equal(vtt.status, 200);
    assert.match(vtt.body, /WEBVTT/);
  });

  it('records landing deploy SOP', () => {
    const deploy = fs.readFileSync(path.join(__dirname, '..', 'docs', 'commercial', 'landing-deploy.md'), 'utf8');
    assert.match(deploy, /127\.0\.0\.1:3847/);
    assert.match(deploy, /prepare-landing-static/);
    assert.match(deploy, /landing-pages\.yml/);
  });

  it('generate from local path', async () => {
    const tiny = path.join(__dirname, '..');
    // Force skeleton so a developer DEEPSEEK_API_KEY cannot trigger a live LLM call.
    const r = await request('POST', '/api/generate', JSON.stringify({ path: tiny, mode: 'skeleton' }));
    assert.equal(r.status, 200, r.body);
    const data = JSON.parse(r.body);
    assert.ok(data.id);
    assert.ok(data.shareUrl.startsWith('/p/'));
    assert.equal(data.engine, 'skeleton');
    assert.equal(data.quality, 'fast');
    assert.equal(data.fallback, false);

    const page = await request('GET', data.shareUrl);
    assert.equal(page.status, 200);
    assert.match(page.body, /__ARCH_INLINE_SOURCES__/);
  });

  it('generate llm without key falls back to skeleton', async () => {
    const prev = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const tiny = path.join(__dirname, '..');
      const r = await request('POST', '/api/generate', JSON.stringify({ path: tiny, mode: 'llm' }));
      assert.equal(r.status, 200, r.body);
      const data = JSON.parse(r.body);
      assert.equal(data.engine, 'skeleton');
      assert.equal(data.fallback, true);
      assert.equal(data.reason, 'no-key');
      assert.ok(data.shareUrl.startsWith('/p/'));
    } finally {
      if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev;
    }
  });

  it('quality=fast forces skeleton', async () => {
    const tiny = path.join(__dirname, '..');
    const r = await request('POST', '/api/generate', JSON.stringify({ path: tiny, quality: 'fast' }));
    assert.equal(r.status, 200, r.body);
    const data = JSON.parse(r.body);
    assert.equal(data.quality, 'fast');
    assert.equal(data.engine, 'skeleton');
    assert.equal(data.fallback, false);
  });

  it('quality=refine without key is 401 (same as CLI --refine)', async () => {
    const prev = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const tiny = path.join(__dirname, '..');
      const r = await request('POST', '/api/generate', JSON.stringify({ path: tiny, quality: 'refine' }));
      assert.equal(r.status, 401, r.body);
      const data = JSON.parse(r.body);
      assert.match(data.error, /精修|DEEPSEEK_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev;
    }
  });

  it('rejects unknown quality', async () => {
    const tiny = path.join(__dirname, '..');
    const r = await request('POST', '/api/generate', JSON.stringify({ path: tiny, quality: 'orch4' }));
    assert.equal(r.status, 400);
  });

  it('rejects oversized apiKey', async () => {
    const tiny = path.join(__dirname, '..');
    const r = await request(
      'POST',
      '/api/generate',
      JSON.stringify({ path: tiny, mode: 'llm', apiKey: 'x'.repeat(300) })
    );
    assert.equal(r.status, 400);
  });
});

