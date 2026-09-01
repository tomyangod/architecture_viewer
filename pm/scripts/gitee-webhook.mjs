// pm/scripts/gitee-webhook.mjs
// Gitee Webhook 服务：Push 事件中 commit message 含任务号 → 自动更新 tasks.json。
// 规则（见 project.config.json commitMessageConvention）：
//   完成 W01-01 / closes W01-01 / done W01-01 / fix W01-01 → status=done, progress=100
//   W07-01 60%                                            → 更新 progress，todo→doing
//   仅提及 W01-01                                          → todo→doing，记录活动
// 用法：node pm/scripts/wbs.mjs webhook [--port 3910]
import http from 'node:http';
import fs from 'node:fs';
import {
  p, loadConfig, loadTasks, saveTasks, taskMap,
  logActivity, todayStr,
} from './wbs-lib.mjs';

const TASK_RE = /\bW(\d{2})-(\d{2})\b/gi;
const DONE_RE = /(完成|搞定|closes?|closed|done|fix(es|ed)?|完成)/i;
const PCT_RE = /(\d{1,3})\s*%/;

function appendLog(line) {
  const dir = p('reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(p('reports/webhook.log'), `${new Date().toISOString()} ${line}\n`, 'utf8');
}

export function processPush(payload) {
  const cfg = loadConfig();
  const tasks = loadTasks();
  const byId = taskMap(tasks);
  const results = [];
  const commits = payload.commits || [];
  const ref = payload.ref || '';

  for (const c of commits) {
    const msg = String(c.message || '').split('\n')[0];
    const ids = [...msg.matchAll(TASK_RE)].map((m) => `W${m[1]}-${m[2]}`);
    if (!ids.length) continue;
    const shortSha = String(c.id || '').slice(0, 7);
    for (const id of ids) {
      const t = byId.get(id);
      if (!t) {
        results.push({ id, action: 'not-found' });
        appendLog(`WARN ${id} 任务不存在 commit=${shortSha} msg="${msg}"`);
        continue;
      }
      const prevStatus = t.status;
      let action = 'touched';
      if (DONE_RE.test(msg)) {
        t.status = 'done';
        t.progress = 100;
        action = 'done';
      } else {
        const pct = msg.match(PCT_RE);
        if (pct) {
          t.progress = Math.min(100, Number(pct[1]));
          action = `progress=${t.progress}%`;
          if (t.status === 'todo') t.status = 'doing';
        }
        if (t.status === 'todo') {
          t.status = 'doing';
          if (!action.startsWith('progress')) action = 'started';
        }
      }
      logActivity(t, `commit ${action}`, { commit: shortSha, detail: msg, ref });
      results.push({ id, action, prevStatus, status: t.status });
      appendLog(`OK ${id} ${prevStatus}→${t.status} (${action}) commit=${shortSha} msg="${msg}"`);
    }
  }

  saveTasks(tasks);
  return { receivedAt: todayStr(), ref, commits: commits.length, results };
}

export function startWebhook(port = 3910) {
  const secret = process.env.GITEE_WEBHOOK_SECRET || '';
  if (!secret) {
    console.log('[webhook] ⚠️ 未设置 GITEE_WEBHOOK_SECRET 环境变量，将不校验签名（仅建议本地调试）。');
  }
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'av-wbs-webhook' }));
      return;
    }
    if (req.method !== 'POST' || !req.url.startsWith('/gitee-webhook')) {
      res.writeHead(404); res.end('not found'); return;
    }
    if (secret && req.headers['x-gitee-token'] !== secret) {
      appendLog(`WARN 签名校验失败 ${req.socket.remoteAddress}`);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid token' }));
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const result = processPush(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...result }));
        console.log(`[webhook] ${result.results.length} 个任务更新：`, result.results.map((r) => `${r.id}:${r.action}`).join(', ') || '无');
      } catch (e) {
        appendLog(`ERROR 解析失败: ${e.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  });
  server.listen(port, () => {
    console.log(`[webhook] 监听 http://0.0.0.0:${port}/gitee-webhook （Gitee 仓库管理 → WebHooks 添加；密码填入 GITEE_WEBHOOK_SECRET）`);
  });
  return server;
}
