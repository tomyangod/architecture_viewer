#!/usr/bin/env node
// pm/scripts/wbs.mjs — WBS 命令行入口
//
//   node pm/scripts/wbs.mjs status                    实时看板
//   node pm/scripts/wbs.mjs sync                      依赖联动 + 阻塞/逾期检查
//   node pm/scripts/wbs.mjs cards                     重新生成任务卡与总览
//   node pm/scripts/wbs.mjs report [--week W08]       生成周报
//   node pm/scripts/wbs.mjs set <id> <status> [--progress N] [--reason "..."]
//   node pm/scripts/wbs.mjs verify                    数据完整性校验
//   node pm/scripts/wbs.mjs webhook [--port 3910]     启动 Gitee Webhook 服务
import {
  loadTasks, saveTasks, taskMap, validate, isOverdue,
  effectiveStatus, downstreamOf, upstreamOf, logActivity, todayStr,
} from './wbs-lib.mjs';
import { printDashboard, generateWeekly } from './wbs-report.mjs';
import { startWebhook } from './gitee-webhook.mjs';

function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { flags[key] = next; i++; }
      else flags[key] = true;
    } else rest.push(argv[i]);
  }
  return { flags, rest };
}

function cmdSync() {
  const tasks = loadTasks();
  const issues = validate(tasks);
  const byId = taskMap(tasks);
  let problems = 0;

  console.log('\n== 依赖联动 / 阻塞高亮 ==');
  for (const t of tasks) {
    if (t.status === 'blocked') {
      const ds = downstreamOf(tasks, t.id);
      problems++;
      console.log(`🔴 ${t.id} 阻塞：${t.blockedReason || '（未填写原因）'}`);
      if (ds.length) console.log(`   ⛔ 下游自动标红：${ds.join(', ')}`);
    }
    const eff = effectiveStatus(tasks, t);
    if (eff === 'blocked-by-upstream' && t.status !== 'blocked') {
      const ups = upstreamOf(tasks, t.id).filter((u) => byId.get(u)?.status === 'blocked');
      console.log(`   ⛔ ${t.id} 因上游阻塞联动标红（${ups.join(', ')}）`);
    }
  }

  console.log('\n== 逾期检查 ==');
  const overdue = tasks.filter((t) => isOverdue(t));
  if (overdue.length) {
    for (const t of overdue) { problems++; console.log(`⚠️  ${t.id} 截止 ${t.deadline} 未完成：${t.title}`); }
  } else {
    console.log('✅ 无逾期任务');
  }

  console.log('\n== 完成态依赖一致性 ==');
  let depIssue = 0;
  for (const t of tasks) {
    if (t.status === 'done') {
      for (const d of t.deps || []) {
        if (byId.get(d)?.status !== 'done') {
          depIssue++; problems++;
          console.log(`⚠️  ${t.id} 已完成但依赖 ${d} 状态为 ${byId.get(d)?.status}`);
        }
      }
    }
  }
  if (!depIssue) console.log('✅ 完成任务依赖均已闭环');

  if (issues.length) {
    console.log('\n== 数据完整性 ==');
    for (const i of issues) { problems++; console.log(`❌ ${i}`); }
  }

  console.log(problems ? `\n发现 ${problems} 个需关注项。\n` : '\n✅ 全部检查通过。\n');
  process.exitCode = problems ? 1 : 0;
}

function cmdSet(rest, flags) {
  const [id, status] = rest;
  if (!id || !status) {
    console.error('用法：set <任务号> <todo|doing|blocked|done> [--progress N] [--reason "..."]');
    process.exit(1);
  }
  if (!['todo', 'doing', 'blocked', 'done'].includes(status)) {
    console.error(`非法状态：${status}`); process.exit(1);
  }
  const tasks = loadTasks();
  const byId = taskMap(tasks);
  const t = byId.get(id);
  if (!t) { console.error(`任务不存在：${id}`); process.exit(1); }

  const prev = t.status;
  t.status = status;
  if (status === 'done') {
    t.progress = 100;
  } else if (status === 'doing') {
    t.progress = Math.max(t.progress || 0, Number(flags.progress) || (t.progress > 0 ? t.progress : 10));
  } else if (status === 'blocked') {
    t.blockedReason = flags.reason || t.blockedReason || '';
    if (!t.blockedReason) console.log('⚠️  建议用 --reason 填写阻塞原因');
  } else if (status === 'todo') {
    t.progress = 0;
  }
  if (flags.progress !== undefined && status !== 'done') {
    t.progress = Math.min(100, Number(flags.progress));
    if (t.progress > 0 && t.status === 'todo') t.status = 'doing';
  }
  logActivity(t, `状态变更 ${prev}→${status}`, flags.reason ? { detail: flags.reason } : {});
  saveTasks(tasks);

  console.log(`✅ ${id} ${prev}→${status}（进度 ${t.progress}%）`);
  if (status === 'blocked') {
    const ds = downstreamOf(tasks, id);
    if (ds.length) console.log(`⛔ 下游联动标红：${ds.join(', ')}`);
  }
  if (status === 'done') {
    // 提示刚刚解锁的下游
    const ds = downstreamOf(tasks, id);
    const unblocked = ds.filter((d) => {
      const dt = byId.get(d);
      return dt && (dt.deps || []).every((x) => byId.get(x)?.status === 'done') && dt.status === 'todo';
    });
    if (unblocked.length) console.log(`🔓 依赖已就绪、可启动：${unblocked.join(', ')}`);
  }

  // 状态变更后自动刷新任务卡
  import('./wbs-cards.mjs').then(() => console.log('[cards] 任务卡已刷新'));
}

function cmdVerify() {
  const issues = validate(loadTasks());
  if (issues.length) {
    for (const i of issues) console.log(`❌ ${i}`);
    process.exit(1);
  }
  console.log('✅ tasks.json 完整性校验通过');
}

const { flags, rest } = parseFlags(process.argv.slice(2));
const cmd = rest[0];

switch (cmd) {
  case 'status': printDashboard(); break;
  case 'sync': cmdSync(); break;
  case 'cards': await import('./wbs-cards.mjs'); break;
  case 'report': {
    await import('./wbs-cards.mjs'); // 确保卡片最新
    generateWeekly(flags.week);
    break;
  }
  case 'set': cmdSet(rest.slice(1), flags); break;
  case 'verify': cmdVerify(); break;
  case 'webhook': startWebhook(Number(flags.port) || 3910); break;
  default:
    console.log(`Architecture Viewer WBS 工具
用法：node pm/scripts/wbs.mjs <command>

  status                 实时看板（完成率/阻塞/逾期）
  sync                   依赖联动校验 + 阻塞下游标红 + 逾期检查
  cards                  重新生成 pm/README.md 与每周任务卡
  report [--week Wxx]    生成周五周报到 pm/reports/weekly/
  set <id> <status>      更新任务：todo|doing|blocked|done
                         [--progress N] [--reason "原因"]
  verify                 校验 tasks.json 完整性
  webhook [--port N]     启动 Gitee Webhook 服务
`);
}
