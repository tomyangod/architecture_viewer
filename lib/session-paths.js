'use strict';

const fs = require('fs');
const path = require('path');

function findGitRoot(dir) {
  let cur = path.resolve(dir);
  for (let i = 0; i < 50; i++) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

function realPath(p) {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync(resolved);
  } catch {
    // .av 等目录可能尚未创建：对已存在的祖先做 realpath，再拼回尾段
    // （macOS 上 /var → /private/var，否则 isInside 会误判）
    const parts = [];
    let cur = resolved;
    while (true) {
      const parent = path.dirname(cur);
      if (parent === cur) return resolved;
      parts.unshift(path.basename(cur));
      try {
        return path.join(fs.realpathSync(parent), ...parts);
      } catch {
        cur = parent;
      }
    }
  }
}

function samePath(a, b) {
  if (!a || !b) return false;
  return realPath(a) === realPath(b);
}

function isInside(child, parent) {
  const rel = path.relative(realPath(parent), realPath(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Git worktree 的 .git 是文件（含 gitdir:），不是目录。
 * 用来区分「主仓」和「worktree 检出」，避免把基线写到主仓。
 */
function isGitWorktree(dir) {
  const root = findGitRoot(dir);
  if (!root) return false;
  const gitPath = path.join(root, '.git');
  try {
    const st = fs.lstatSync(gitPath);
    if (!st.isFile()) return false;
    return /gitdir\s*:/i.test(fs.readFileSync(gitPath, 'utf8'));
  } catch {
    return false;
  }
}

function sessionPaths(repo) {
  const checking = path.resolve(repo);
  const reportDir = path.join(checking, '.av');
  const gitRoot = findGitRoot(checking);
  return {
    checking,
    baselineDir: reportDir,
    baselineSavedTo: path.join(reportDir, 'graph-baseline.json'),
    reportDir,
    reportEntry: path.join(reportDir, 'session-report.html'),
    gitRoot,
    worktree: isGitWorktree(checking),
    cwd: path.resolve(process.cwd()),
    cwdGitRoot: findGitRoot(process.cwd())
  };
}

/**
 * Fail-closed when the repo to check is a different Git root than
 * the directory actually being edited (editDir) or the process cwd
 * (classic: AI copied the main-repo path while the shell/IDE is in a worktree).
 *
 * Escape hatch: confirmRepo === resolved repo (MCP) or confirm === true (CLI).
 */
function detectPathMismatch(repo, opts) {
  const options = opts || {};
  const paths = sessionPaths(repo);
  const baselineOk = samePath(paths.baselineDir, paths.reportDir) && isInside(paths.baselineDir, paths.checking);
  if (!baselineOk) {
    return {
      error: 'PATH_MISMATCH',
      abort: true,
      path: paths,
      message: '基线目录与报告目录不在检查目录下。中止，不要改代码、不要把这份结果当验收。',
      nextStep: '用当前 IDE 工作区根的绝对路径重调，并在回复中回显检查目录 / 基线目录 / 报告目录。'
    };
  }

  const editRaw = typeof options.editDir === 'string' ? options.editDir.trim() : '';
  if (editRaw) {
    if (!path.isAbsolute(editRaw)) {
      return {
        error: 'PATH_MISMATCH',
        abort: true,
        path: { ...paths, editDir: editRaw },
        message: `editDir 必须是绝对路径：${editRaw}`,
        nextStep: '传入正在改代码的工作区绝对路径作为 editDir，或只传正确的 repo。'
      };
    }
    const editDir = path.resolve(editRaw);
    paths.editDir = editDir;
    const editGit = findGitRoot(editDir);
    if (editGit && paths.gitRoot && !samePath(editGit, paths.gitRoot)) {
      return {
        error: 'PATH_MISMATCH',
        abort: true,
        path: paths,
        message: [
          '实际修改目录与检查目录不是同一个 Git 根，已中止（避免对主仓拍基线、在 worktree 里改代码）。',
          `实际修改目录: ${editDir}`,
          `检查目录:     ${paths.checking}`,
          `基线目录:     ${paths.baselineDir}`,
          `报告目录:     ${paths.reportDir}`
        ].join('\n'),
        nextStep: '中止。对正在改代码的工作区根重调 av_session_start。不要沿用主仓绝对路径。'
      };
    }
    if (!samePath(editDir, paths.checking) && !isInside(editDir, paths.checking) && !isInside(paths.checking, editDir)) {
      return {
        error: 'PATH_MISMATCH',
        abort: true,
        path: paths,
        message: [
          '实际修改目录不在检查目录内，已中止。',
          `实际修改目录: ${editDir}`,
          `检查目录:     ${paths.checking}`,
          `基线目录:     ${paths.baselineDir}`,
          `报告目录:     ${paths.reportDir}`
        ].join('\n'),
        nextStep: '中止。repo 必须是正在改代码的工作区根。'
      };
    }
  }

  const confirmed = options.confirm === true
    || (typeof options.confirmRepo === 'string' && samePath(options.confirmRepo, paths.checking));
  if (paths.gitRoot && paths.cwdGitRoot && !samePath(paths.gitRoot, paths.cwdGitRoot) && !confirmed) {
    return {
      error: 'PATH_MISMATCH',
      abort: true,
      path: paths,
      message: [
        '检查目录与当前进程所在 Git 根不一致，已中止（常见于指南写死主仓、实际在 worktree 改代码）。',
        `检查目录:     ${paths.checking}`,
        `基线目录:     ${paths.baselineDir}`,
        `报告目录:     ${paths.reportDir}`,
        `进程 Git 根:  ${paths.cwdGitRoot}`,
        '若你确认就要检查这个 repo（MCP cwd 只是启动目录），再次调用并传入 confirmRepo=该绝对路径。'
      ].join('\n'),
      nextStep: '中止改代码。先确认 IDE 当前工作区根，用该路径重调 av_session_start；或显式传 confirmRepo 确认。'
    };
  }

  return null;
}

module.exports = {
  findGitRoot,
  realPath,
  samePath,
  isInside,
  isGitWorktree,
  sessionPaths,
  detectPathMismatch
};
