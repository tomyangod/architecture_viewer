// pm/scripts/wbs-lib.mjs
// WBS 共享库：配置/任务读写、依赖遍历、状态计算、活动日志。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(PM_ROOT, '..');

export const p = (...seg) => path.join(PM_ROOT, ...seg);

export function loadConfig() {
  return JSON.parse(fs.readFileSync(p('project.config.json'), 'utf8'));
}

export function loadTasksRaw() {
  return JSON.parse(fs.readFileSync(p('tasks/tasks.json'), 'utf8'));
}

export function loadTasks() {
  return loadTasksRaw().tasks;
}

export function saveTasks(tasks) {
  const raw = loadTasksRaw();
  raw.tasks = tasks;
  fs.writeFileSync(p('tasks/tasks.json'), JSON.stringify(raw, null, 2) + '\n', 'utf8');
}

export function taskMap(tasks) {
  const m = new Map();
  for (const t of tasks) m.set(t.id, t);
  return m;
}

export function weekMap(cfg) {
  const m = new Map();
  for (const w of cfg.weeks) m.set(w.id, w);
  return m;
}

/** 反向依赖：谁依赖 me（直接） */
export function dependentsMap(tasks) {
  const m = new Map();
  for (const t of tasks) {
    for (const d of t.deps || []) {
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(t.id);
    }
  }
  return m;
}

/** 递归：所有（传递性）下游任务 id */
export function downstreamOf(tasks, id) {
  const dep = dependentsMap(tasks);
  const out = new Set();
  const stack = [...(dep.get(id) || [])];
  while (stack.length) {
    const cur = stack.pop();
    if (out.has(cur)) continue;
    out.add(cur);
    for (const n of dep.get(cur) || []) stack.push(n);
  }
  return [...out];
}

/** 递归：所有（传递性）上游依赖 id */
export function upstreamOf(tasks, id) {
  const byId = taskMap(tasks);
  const out = new Set();
  const stack = [...(byId.get(id)?.deps || [])];
  while (stack.length) {
    const cur = stack.pop();
    if (out.has(cur)) continue;
    out.add(cur);
    for (const n of byId.get(cur)?.deps || []) stack.push(n);
  }
  return [...out];
}

/** 有效状态：自身 blocked 或任一传递上游 blocked/done 校验 */
export function effectiveStatus(tasks, t) {
  if (t.status === 'blocked') return 'blocked';
  const up = upstreamOf(tasks, t.id);
  const byId = taskMap(tasks);
  for (const u of up) {
    const ut = byId.get(u);
    if (ut && ut.status === 'blocked') return 'blocked-by-upstream';
  }
  return t.status;
}

export function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function logActivity(task, action, extra = {}) {
  if (!Array.isArray(task.activity)) task.activity = [];
  task.activity.push({ date: todayStr(), action, ...extra });
}

export function isOverdue(t, today = todayStr()) {
  return t.deadline && t.status !== 'done' && t.deadline < today;
}

export function weekNumOf(id) {
  const m = /^W(\d+)/.exec(id);
  return m ? Number(m[1]) : 99;
}

/** 数据完整性校验，返回问题列表 */
export function validate(tasks) {
  const issues = [];
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    for (const d of t.deps || []) {
      if (!ids.has(d)) issues.push(`${t.id}: 依赖 ${d} 不存在`);
    }
    if (!t.acceptance || t.acceptance.length === 0) issues.push(`${t.id}: 缺 acceptance`);
    if (!t.acceptanceCommands || t.acceptanceCommands.length === 0) issues.push(`${t.id}: 缺 acceptanceCommands`);
    if (!t.deadline && !String(t.id).startsWith('W13')) issues.push(`${t.id}: 缺 deadline`);
    for (const d of t.deps || []) {
      if (weekNumOf(d) > weekNumOf(t.id)) issues.push(`${t.id}: 依赖 ${d} 排在其后（跨周顺序异常）`);
    }
  }
  return issues;
}

export const STATUS_EMOJI = {
  todo: '⬜',
  doing: '🔵',
  blocked: '🔴',
  'blocked-by-upstream': '⛔',
  done: '✅',
};

export const STATUS_LABEL = {
  todo: '未开始',
  doing: '进行中',
  blocked: '阻塞',
  'blocked-by-upstream': '上游阻塞',
  done: '已完成',
};
