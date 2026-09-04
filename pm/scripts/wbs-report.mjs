// pm/scripts/wbs-report.mjs
// 看板与周报：status（控制台看板）、weekly（周五进度周报 markdown）。
import fs from 'node:fs';
import path from 'node:path';
import {
  p, loadConfig, loadTasks, weekMap, effectiveStatus,
  isOverdue, STATUS_EMOJI, STATUS_LABEL, todayStr, downstreamOf,
} from './wbs-lib.mjs';

const cfg = loadConfig();
const tasks = loadTasks();
const weeks = weekMap(cfg);

function fmtRow(t) {
  const eff = effectiveStatus(tasks, t);
  const od = isOverdue(t) ? ' ⚠逾期' : '';
  return `${STATUS_EMOJI[eff]} ${t.id}  ${(t.title).slice(0, 34).padEnd(34)} ${t.priority} 截止:${t.deadline || '—'} 进度:${(t.progress ?? 0)}%${od}`;
}

export function printDashboard() {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const doing = tasks.filter((t) => t.status === 'doing').length;
  const blocked = tasks.filter((t) => t.status === 'blocked');
  const overdue = tasks.filter((t) => isOverdue(t));
  const pct = Math.round((done / total) * 100);
  const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));

  console.log(`\n Architecture Viewer 商业化 WBS  ${todayStr()}`);
  console.log(` ${bar} ${done}/${total} (${pct}%)  进行中 ${doing}  阻塞 ${blocked.length}  逾期 ${overdue.length}\n`);

  for (const ph of cfg.phases) {
    console.log(`── ${ph.name}`);
    for (const w of cfg.weeks.filter((x) => x.phase === ph.id)) {
      const list = tasks.filter((t) => t.id.startsWith(w.id));
      if (!list.length) continue;
      const d = list.filter((t) => t.status === 'done').length;
      const flag = list.some((t) => isOverdue(t)) ? '⚠' : list.some((t) => effectiveStatus(tasks, t) === 'blocked' || effectiveStatus(tasks, t) === 'blocked-by-upstream') ? '🔴' : ' ';
      console.log(`  ${flag} ${w.id} (${w.theme.slice(0, 22)}) ${d}/${list.length} 截止 ${w.deadline || '—'}`);
      for (const t of list) {
        if (t.status !== 'done') console.log(`      ${fmtRow(t)}`);
      }
    }
    console.log('');
  }

  if (blocked.length) {
    console.log('🔴 阻塞任务及受影响下游：');
    for (const b of blocked) {
      const ds = downstreamOf(tasks, b.id);
      console.log(`   ${b.id} ${b.title}`);
      console.log(`     原因：${b.blockedReason || '（未填写）'}`);
      if (ds.length) console.log(`     下游联动标红：${ds.join(', ')}`);
    }
    console.log('');
  }
  if (overdue.length) {
    console.log('⚠️ 逾期任务：');
    for (const t of overdue) console.log(`   ${t.id} 截止 ${t.deadline} · ${t.title}`);
    console.log('');
  }
}

function weekIdFromDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  let best = null;
  for (const w of cfg.weeks) {
    if (!w.start) continue;
    if (w.start <= dateStr && (w.end === null || w.end >= dateStr)) best = w.id;
  }
  return best || 'W13';
}

export function generateWeekly(weekId) {
  const wk = weekId || weekIdFromDate(todayStr());
  const w = weeks.get(wk);
  if (!w) throw new Error(`未知周次 ${wk}`);
  const weekTasks = tasks.filter((t) => t.id.startsWith(wk));
  const done = weekTasks.filter((t) => t.status === 'done');
  const doing = weekTasks.filter((t) => t.status === 'doing');
  const blocked = weekTasks.filter((t) => t.status === 'blocked' || effectiveStatus(tasks, t) === 'blocked-by-upstream');
  const todo = weekTasks.filter((t) => t.status === 'todo');
  const overdue = tasks.filter((t) => isOverdue(t) && !t.id.startsWith(wk));
  const carryOver = tasks.filter((t) => t.status !== 'done' && !t.id.startsWith(wk) && t.deadline && t.deadline <= (w.end || '9999'));

  // 下周
  const nextNum = w.num + 1;
  const nextW = cfg.weeks.find((x) => x.num === nextNum);
  const nextTasks = nextW ? tasks.filter((t) => t.id.startsWith(nextW.id)) : [];

  const totalAll = tasks.filter((t) => !t.id.startsWith('W13')).length;
  const doneAll = tasks.filter((t) => t.status === 'done' && !t.id.startsWith('W13')).length;

  let md = `# 周报 · ${wk}（${w.start || ''} ~ ${w.end || ''}）\n\n`;
  md += `> 生成时间：${todayStr()} ｜ 主题：${w.theme || ''}\n\n`;

  md += `## 一、完成率\n\n`;
  md += `| 范围 | 完成 | 总数 | 完成率 |\n|---|---|---|---|\n`;
  md += `| 本周 | ${done.length} | ${weekTasks.length} | ${weekTasks.length ? Math.round((done.length / weekTasks.length) * 100) : 0}% |\n`;
  md += `| 全项目（W01–W12） | ${doneAll} | ${totalAll} | ${Math.round((doneAll / totalAll) * 100)}% |\n\n`;

  md += `## 二、本周已完成\n\n`;
  md += (done.length ? done.map((t) => `- ✅ ${t.id} ${t.title}`).join('\n') : '- （本周暂无完成项）') + '\n\n';

  md += `## 三、进行中\n\n`;
  md += (doing.length ? doing.map((t) => `- 🔵 ${t.id} ${t.title}（进度 ${t.progress ?? 0}%${isOverdue(t) ? '，⚠️ 已逾期' : ''}）`).join('\n') : '- （无）') + '\n\n';

  md += `## 四、阻塞与延期风险（自动高亮）\n\n`;
  if (blocked.length) {
    for (const t of blocked) {
      const eff = effectiveStatus(tasks, t);
      const reason = t.status === 'blocked' ? t.blockedReason : '上游任务阻塞';
      const ds = downstreamOf(tasks, t.id);
      md += `- 🔴 **${t.id} ${t.title}**：${reason || '（未填写原因）'}${ds.length ? `；联动下游：${ds.join(', ')}` : ''}\n`;
    }
  } else {
    md += '- 本周无阻塞任务。\n';
  }
  if (overdue.length || carryOver.length) {
    md += `\n**跨周遗留/逾期：**\n`;
    for (const t of [...new Set([...overdue, ...carryOver])]) {
      md += `- ⚠️ ${t.id} ${t.title}（截止 ${t.deadline}，状态：${STATUS_LABEL[effectiveStatus(tasks, t)]}）\n`;
    }
  }
  md += '\n';

  md += `## 五、下周计划（${nextW ? nextW.id : '—'} · ${nextW ? nextW.theme : ''}）\n\n`;
  md += (nextTasks.length
    ? nextTasks.map((t) => `- ${STATUS_EMOJI[effectiveStatus(tasks, t)]} ${t.id} ${t.title}（${t.priority}，截止 ${t.deadline || '—'}；依赖：${(t.deps || []).join(', ') || '无'}）`).join('\n')
    : '- Phase 3 backlog，按 12 周复盘结论排期。') + '\n\n';

  md += `## 六、数据与指标（人工填写）\n\n`;
  md += `> 数据源：npm 下载 + CLI/网页遥测，详见 [pm/metrics.md](../metrics.md)。Marketplace 口径暂缓。\n\n`;
  md += `| 指标 | 本周 | 上周 | 备注 |\n|---|---|---|---|\n`;
  md += `| 累计安装 |  |  |  |\n`;
  md += `| 周活跃 |  |  |  |\n`;
  md += `| Generate 触发 |  |  |  |\n`;
  md += `| Pro 试用/付费 |  |  |  |\n`;
  md += `| 收入（¥） |  |  |  |\n\n`;

  md += `## 七、本周活动流水（Webhook/手动）\n\n`;
  const acts = [];
  for (const t of tasks) {
    for (const a of t.activity || []) {
      if (w.start && a.date >= w.start && (w.end === null || a.date <= w.end)) {
        acts.push({ ...a, task: t.id, title: t.title });
      }
    }
  }
  acts.sort((a, b) => (a.date < b.date ? 1 : -1));
  md += (acts.length
    ? acts.map((a) => `- ${a.date} ${a.task} ${a.action}${a.detail ? `：${a.detail}` : ''}${a.commit ? `（${a.commit}）` : ''}`).join('\n')
    : '- （暂无记录）') + '\n';

  const dir = p('reports/weekly');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${wk}.md`);
  fs.writeFileSync(file, md, 'utf8');
  console.log(`[report] 周报已生成：${path.relative(process.cwd(), file)}`);
  return file;
}
