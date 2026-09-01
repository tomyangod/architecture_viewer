// pm/scripts/wbs-cards.mjs
// 从 tasks.json 重新生成每周任务卡（pm/tasks/Wxx/README.md）与总览索引（pm/README.md）。
// 用法：node pm/scripts/wbs-cards.mjs
import fs from 'node:fs';
import path from 'node:path';
import {
  PM_ROOT, p, loadConfig, loadTasks, taskMap, weekMap,
  effectiveStatus, isOverdue, STATUS_EMOJI, STATUS_LABEL,
} from './wbs-lib.mjs';

const cfg = loadConfig();
const tasks = loadTasks();
const weeks = weekMap(cfg);

function esc(s) {
  return String(s ?? '').replace(/\|/g, '\\|');
}

function taskCard(t, byId) {
  const eff = effectiveStatus(tasks, t);
  const overdue = isOverdue(t) ? ' ⚠️**已逾期**' : '';
  const depLinks = (t.deps || []).map((d) => `[${d}](../${d.slice(0, 3)}/README.md#${d.toLowerCase()})`).join('、') || '无';
  const refs = (t.refs || []).map((r) => `\`${r}\``).join(' ');
  const acc = t.acceptance.map((a) => `- [ ] ${a}`).join('\n');
  const cmds = t.acceptanceCommands.map((c) => `  \`\`\`bash\n  ${c}\n  \`\`\``).join('\n');
  const files = (t.files || []).map((f) => `\`${f}\``).join(' ');
  const activity = (t.activity || []).length
    ? t.activity.map((a) => `  - ${a.date} ${a.action}${a.detail ? `：${a.detail}` : ''}${a.commit ? ` (${a.commit})` : ''}`).join('\n')
    : '  - （暂无）';
  const blockedNote = eff === 'blocked-by-upstream'
    ? `> ⛔ 上游任务阻塞中，本任务自动标红。\n`
    : t.status === 'blocked'
      ? `> 🔴 阻塞原因：${t.blockedReason || '（未填写）'}\n`
      : '';
  return `
### <a id="${t.id.toLowerCase()}"></a>${STATUS_EMOJI[eff]} ${t.id} · ${t.title} ${overdue}

| 字段 | 内容 |
|---|---|
| 优先级 | **${t.priority}** |
| 状态 | ${STATUS_LABEL[eff]}（进度 ${t.progress ?? 0}%） |
| 工时预估 | ${t.estHours ? t.estHours + 'h' : 'backlog'} |
| 截止 | ${t.deadline || '—'} |
| 依赖 | ${depLinks} |
| 负责人 | ${t.assignee || '—'} |
| 标签 | ${(t.tags || []).join(' / ')} |

${blockedNote}
**背景**：${t.context}

**目标**：${t.goal}

**涉及文件**：${files}

**验收标准**（逐条勾选，全部满足才能标 done）：
${acc}

**验收命令**（退出码 0 即通过；人工验收项需在周报中记录证据）：
${cmds}

**参考文档**：${refs || '—'}

**活动记录**：
${activity}
`;
}

// 每周卡片
const byWeek = new Map();
for (const t of tasks) {
  const wk = t.id.slice(0, 3);
  if (!byWeek.has(wk)) byWeek.set(wk, []);
  byWeek.get(wk).push(t);
}

for (const [wk, list] of byWeek) {
  const w = weeks.get(wk) || { theme: 'backlog', phase: 3, deadline: null };
  list.sort((a, b) => a.id.localeCompare(b.id));
  const done = list.filter((t) => effectiveStatus(tasks, t) === 'done').length;
  const pct = Math.round((done / list.length) * 100);
  const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
  let md = `# ${wk} 任务卡 · ${w.theme || ''}\n\n`;
  md += `> 阶段：Phase ${w.phase} ｜ 周期：${w.start || '—'} ~ ${w.end || '持续'} ｜ 周截止：${w.deadline || '—'}\n>\n`;
  md += `> 完成度：${done}/${list.length} ${bar} ${pct}%\n\n`;
  md += `> 本文件由 \`node pm/scripts/wbs-cards.mjs\` 自动生成，请勿手改；状态请改 \`pm/tasks/tasks.json\` 或用 \`node pm/scripts/wbs.mjs set <任务号> <状态>\`。\n\n`;
  md += list.map((t) => taskCard(t)).join('\n---\n');
  const dir = p('tasks', wk);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), md, 'utf8');
}

// 总览索引
const phases = cfg.phases;
let idx = `# Architecture Viewer 商业化 · 项目总览\n\n`;
idx += `> 单一事实源：[\`project.config.json\`](../project.config.json) + [\`tasks/tasks.json\`](./tasks/tasks.json)（${tasks.length} 个任务）。\n`;
idx += `> 本页由 \`node pm/scripts/wbs-cards.mjs\` 自动生成。\n\n`;

const total = tasks.length;
const doneN = tasks.filter((t) => t.status === 'done').length;
const doingN = tasks.filter((t) => t.status === 'doing').length;
const blockedN = tasks.filter((t) => t.status === 'blocked').length;
const overdueN = tasks.filter((t) => isOverdue(t)).length;
idx += `## 全局进度\n\n`;
idx += `| 指标 | 数值 |\n|---|---|\n`;
idx += `| 总任务 | ${total} |\n`;
idx += `| ✅ 已完成 | ${doneN}（${Math.round((doneN / total) * 100)}%） |\n`;
idx += `| 🔵 进行中 | ${doingN} |\n`;
idx += `| 🔴 阻塞 | ${blockedN} |\n`;
idx += `| ⚠️ 逾期 | ${overdueN} |\n\n`;

idx += `## 阶段与里程碑\n\n`;
for (const ph of phases) {
  idx += `### ${ph.name}\n\n`;
  idx += `- 覆盖周次：W${Math.min(...ph.weeks)}–W${Math.max(...ph.weeks)}\n`;
  idx += `- 里程碑：${ph.milestone}\n`;
  idx += `- 准出闸门：${ph.gate}\n\n`;
}

idx += `## 周计划导航\n\n`;
idx += `| 周 | 主题 | 截止 | 任务数 | 完成 | 状态 |\n|---|---|---|---|---|---|\n`;
for (const w of cfg.weeks) {
  const list = byWeek.get(w.id) || [];
  const d = list.filter((t) => t.status === 'done').length;
  const blk = list.some((t) => effectiveStatus(tasks, t) === 'blocked' || effectiveStatus(tasks, t) === 'blocked-by-upstream');
  const od = list.some((t) => isOverdue(t));
  const flag = od ? '⚠️逾期' : blk ? '🔴有阻塞' : d === list.length && list.length ? '✅完成' : '🟢正常';
  idx += `| [${w.id}](./tasks/${w.id}/README.md) | ${esc(w.theme)} | ${w.deadline || '—'} | ${list.length} | ${d}/${list.length} | ${flag} |\n`;
}

idx += `\n## 常用命令\n\n`;
idx += '```bash\n';
idx += `node pm/scripts/wbs.mjs status                 # 查看实时看板（含阻塞/逾期高亮）\n`;
idx += `node pm/scripts/wbs.mjs sync                   # 依赖联动校验（阻塞下游标红、逾期检查）\n`;
idx += `node pm/scripts/wbs.mjs cards                  # 重新生成本页与每周任务卡\n`;
idx += `node pm/scripts/wbs.mjs report                 # 生成本周周报（pm/reports/weekly/）\n`;
idx += `node pm/scripts/wbs.mjs report --week W08      # 指定周次周报\n`;
idx += `node pm/scripts/wbs.mjs set W01-01 doing       # 更新任务状态：todo|doing|blocked|done\n`;
idx += `node pm/scripts/wbs.mjs set W01-01 blocked --reason "等支付账号"\n`;
idx += `node pm/scripts/wbs.mjs set W07-01 doing --progress 60\n`;
idx += `node pm/scripts/wbs.mjs verify                 # 校验 tasks.json 完整性（依赖/验收/截止）\n`;
idx += `node pm/scripts/wbs.mjs webhook                # 启动 Gitee Webhook 服务（默认 :3910）\n`;
idx += '```\n\n';

idx += `## 自动化规则\n\n`;
idx += `1. **周五周报**：每周五 17:00（北京时间）定时生成，统计完成率、延期风险、阻塞高亮与下周计划 → \`pm/reports/weekly/\`。\n`;
idx += `2. **阻塞联动**：任一任务标记 blocked，其所有下游任务（传递依赖）在看板与任务卡中自动标红；解除阻塞后自动恢复。\n`;
idx += `3. **Gitee Webhook**：Push 事件中 commit message 含任务号即自动更新进度——\n`;
idx += `   - \`完成 W01-01\` / \`closes W01-01\` / \`done W01-01\` → 任务标记 done；\n`;
idx += `   - \`W07-01 60%\` → 更新进度百分比；\n`;
idx += `   - 仅提及任务号 → todo 自动转 doing 并记录活动日志。\n`;
idx += `   - 服务：\`node pm/scripts/wbs.mjs webhook\`（端口 3910，路径 \`/gitee-webhook\`，密钥读环境变量 \`GITEE_WEBHOOK_SECRET\`）。\n\n`;

idx += `## 周报与记录\n\n`;
idx += `- 周报目录：[\`pm/reports/weekly/\`](./reports/weekly/)\n`;
idx += `- 指标台账：[\`pm/metrics.md\`](./metrics.md)\n`;
idx += `- Webhook 日志：\`pm/reports/webhook.log\`\n`;

fs.mkdirSync(p('reports/weekly'), { recursive: true });
fs.mkdirSync(p('reports'), { recursive: true });
fs.writeFileSync(p('README.md'), idx, 'utf8');

console.log(`[cards] 生成 ${byWeek.size} 个周任务卡 + pm/README.md`);
