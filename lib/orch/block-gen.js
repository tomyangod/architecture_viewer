'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * 产品精修引擎（重要性取证 + 产品自述 + 通用锚点 + 接地批判 +
 * 结构/视觉闸门 + 多轮修订 + 确定性扫尾：孤立/反向边/环/非法方向/圆柱错层归位）
 *
 * 注意：本模块是产品运行时（lib/orch/）。对外错误消息不得出现内部引擎代号、
 * 临时目录路径等实现细节——用户面只说「精修」。详细诊断打到服务端 stderr。
 */
function spawnEnv(opts) {
  const env = Object.assign({}, process.env);
  if (opts && typeof opts.apiKey === 'string' && opts.apiKey.trim()) {
    env.DEEPSEEK_API_KEY = opts.apiKey.trim();
  }
  return env;
}

// 把子进程 stderr 归类为用户可操作的错误
function classifyFailure(stderrText) {
  const t = stderrText || '';
  // DeepSeek 认证失败：HTTP 401 / Authentication Fails / invalid api key
  if (/HTTP 401|Authentication\s+Fails?|invalid\s+api\s+key|api\s+key.*(invalid|unauthorized)|Unauthorized/i.test(t)) {
    const e = new Error('API Key 无效或已被模型服务拒绝（认证失败）。请检查 Key 后重试；或先去掉 Key 生成骨架。');
    e.status = 401;
    return e;
  }
  // 限流 / 额度
  if (/HTTP 429|rate\s*limit|insufficient\s+balance|quota|余额/i.test(t)) {
    const e = new Error('模型服务繁忙或账户额度不足（429）。请稍后重试，或检查 API Key 账户余额。');
    e.status = 429;
    return e;
  }
  // 超时 / 网络
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|network|timeout|fetch failed/i.test(t)) {
    const e = new Error('无法连接模型服务（网络错误）。请检查网络后重试，或先使用无 Key 骨架。');
    e.status = 502;
    return e;
  }
  return null;
}

function runOrch(engineTag, repoRoot, opts) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-refine-'));
  const runner = path.join(__dirname, 'run.js');
  return new Promise((resolve, reject) => {
    // stdout/stderr 都 pipe：边转发到父进程（CLI/服务端日志可见进度），边收集用于错误分类
    const child = spawn(process.execPath, [runner, path.resolve(repoRoot), engineTag, out], {
      env: spawnEnv(opts),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let outBuf = '';
    let errBuf = '';
    const cap = (buf, chunk) => {
      let s = buf + chunk.toString();
      return s.length > 20000 ? s.slice(-20000) : s;
    };
    child.stdout.on('data', (chunk) => {
      outBuf = cap(outBuf, chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      errBuf = cap(errBuf, chunk);
      process.stderr.write(chunk);
    });
    child.on('error', (err) => {
      // spawn 本身失败（node 不存在等）——不泄露内部细节
      console.error('[refine] spawn error:', err && err.message);
      reject(new Error('精修引擎启动失败，请检查 Node.js 运行环境。'));
    });
    child.on('exit', (code) => {
      if (code === 0) { resolve(out); return; }
      // 子进程的致命错误走 stdout（console.log），诊断日志走 stderr，合并后分类
      const classified = classifyFailure(outBuf + '\n' + errBuf);
      if (classified) {
        reject(classified);
        return;
      }
      console.error('[refine] 子进程退出码', code, '，诊断尾部：\n', (outBuf + errBuf).slice(-1500));
      reject(new Error('精修过程中出错（模型生成未通过结构校验）。可稍后重试，或先使用无 Key 骨架。'));
    });
  });
}

async function generateBlockOrch4(repoRoot, opts) {
  const out = await runOrch('orch4', repoRoot, opts);
  const mdPath = path.join(out, 'block-diagram.md');
  if (!fs.existsSync(mdPath)) throw new Error('精修未产出 block-diagram.md，可稍后重试或先用骨架。');
  const md = fs.readFileSync(mdPath, 'utf8');
  let state = null;
  try { state = JSON.parse(fs.readFileSync(path.join(out, 'state.json'), 'utf8')); } catch { /* ignore */ }
  return { md, outdir: out, state };
}

/**
 * 旧版引擎（全树 + 锚点覆盖 + plan 回写 + 主链路 + 接地批判），保留用于对比
 */
async function generateBlockOrch3(repoRoot, opts) {
  const out = await runOrch('orch3', repoRoot, opts);
  const mdPath = path.join(out, 'block-diagram.md');
  if (!fs.existsSync(mdPath)) throw new Error('精修未产出 block-diagram.md，可稍后重试或先用骨架。');
  const md = fs.readFileSync(mdPath, 'utf8');
  let state = null;
  try { state = JSON.parse(fs.readFileSync(path.join(out, 'state.json'), 'utf8')); } catch { /* ignore */ }
  return { md, outdir: out, state };
}

module.exports = { generateBlockOrch4, generateBlockOrch3 };
