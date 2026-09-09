'use strict';

/**
 * Shared DeepSeek / OpenAI-compatible chat client.
 *
 * Env:
 *   DEEPSEEK_API_KEY              required
 *   DEEPSEEK_BASE_URL             default https://api.deepseek.com
 *   DEEPSEEK_FALLBACK_BASE_URL    optional second endpoint after primary exhausted
 *   DEEPSEEK_TIMEOUT_MS           default 30000
 *   DEEPSEEK_MODEL                default deepseek-chat
 *   DEEPSEEK_MODEL_BLIND          optional override for blind review
 *   DEEPSEEK_MODEL_GENERATE       optional override for diagram generation
 *   DEEPSEEK_MODEL_EXPLAIN        optional override for finding explanation
 */

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TIMEOUT_MS = 30000;

const usage = { calls: 0, promptTokens: 0, completionTokens: 0 };

function envStr(name, fallback) {
  const v = process.env[name];
  return v == null || String(v).trim() === '' ? fallback : String(v).trim();
}

function MODEL() {
  return envStr('DEEPSEEK_MODEL', DEFAULT_MODEL);
}

function BASE() {
  return envStr('DEEPSEEK_BASE_URL', DEFAULT_BASE);
}

function timeoutMs(opts) {
  if (opts && opts.timeoutMs != null) return Number(opts.timeoutMs);
  const env = Number(process.env.DEEPSEEK_TIMEOUT_MS);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TIMEOUT_MS;
}

function modelFor(scene) {
  if (scene === 'blind') return envStr('DEEPSEEK_MODEL_BLIND', MODEL());
  if (scene === 'generate') return envStr('DEEPSEEK_MODEL_GENERATE', MODEL());
  if (scene === 'explain') return envStr('DEEPSEEK_MODEL_EXPLAIN', MODEL());
  return MODEL();
}

function endpointList() {
  const primary = BASE().replace(/\/$/, '');
  const fallback = envStr('DEEPSEEK_FALLBACK_BASE_URL', '');
  const list = [primary];
  if (fallback) {
    const fb = fallback.replace(/\/$/, '');
    if (fb && fb !== primary) list.push(fb);
  }
  return list;
}

function maskKey() {
  const k = process.env.DEEPSEEK_API_KEY || '';
  return k ? k.slice(0, 4) + '***' + k.slice(-4) : '(none)';
}

function backoffMs(attempt) {
  return Math.min(8000, 400 * (2 ** attempt));
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

function isRetryableError(err) {
  if (!err || err.fatal) return false;
  if (err.name === 'AbortError') return true;
  const msg = String(err.message || err);
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|network|timeout|fetch failed|AbortError|HTTP (429|5\d\d)/i.test(msg);
}

async function chat(messages, opts = {}) {
  const key = (opts && opts.apiKey) || process.env.DEEPSEEK_API_KEY;
  if (!key) {
    const e = new Error(opts && opts.apiKey === '' ? '缺少 DEEPSEEK_API_KEY。请先 export DEEPSEEK_API_KEY=sk-...' : '缺少 DEEPSEEK_API_KEY 环境变量');
    e.fatal = true;
    e.status = 401;
    throw e;
  }
  const temperature = opts.temperature != null ? opts.temperature : 0.2;
  const maxRetries = opts.maxRetries != null ? opts.maxRetries : 3;
  const model = opts.model || modelFor(opts.scene);
  const bases = opts.baseUrl ? [String(opts.baseUrl).replace(/\/$/, '')] : endpointList();
  const wait = timeoutMs(opts);
  let lastErr;

  for (let bi = 0; bi < bases.length; bi++) {
    const base = bases[bi];
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), wait) : null;
      try {
        const res = await fetch(base + '/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({
            model,
            temperature,
            max_tokens: opts.maxTokens || 8192,
            messages,
            ...(opts.json ? { response_format: { type: 'json_object' } } : {})
          }),
          ...(controller ? { signal: controller.signal } : {})
        });
        const text = await res.text();
        if (!res.ok) {
          lastErr = new Error(`DeepSeek HTTP ${res.status}: ${text.slice(0, 300)}`);
          lastErr.status = res.status;
          if (isRetryableStatus(res.status) && attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, backoffMs(attempt)));
            continue;
          }
          if (isRetryableStatus(res.status) && bi < bases.length - 1) break;
          throw lastErr;
        }
        const data = JSON.parse(text);
        const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!content) throw new Error('DeepSeek 返回空 content');
        const u = data.usage || {};
        usage.calls++;
        usage.promptTokens += u.prompt_tokens || 0;
        usage.completionTokens += u.completion_tokens || 0;
        return content;
      } catch (err) {
        lastErr = err;
        if (err && err.fatal) throw err;
        const retry = isRetryableError(err) && attempt < maxRetries;
        if (retry) {
          await new Promise((r) => setTimeout(r, backoffMs(attempt)));
          continue;
        }
        if (isRetryableError(err) && bi < bases.length - 1) break;
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }
  throw lastErr;
}

module.exports = {
  chat,
  modelFor,
  maskKey,
  usage,
  backoffMs,
  isRetryableError,
  endpointList,
  timeoutMs,
  get MODEL() { return MODEL(); },
  get BASE() { return BASE(); }
};
