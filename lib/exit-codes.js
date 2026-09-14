'use strict';

// 退出码契约（Exit Code Contract）
// 自动化脚本（CI、pre-commit、shell set -e）不解析自然语言，只看退出码。
// 全 CLI 命令统一遵循此表，新增命令时必须从这里取常量。
//
// | 码 | 含义 | 典型场景 |
// |---|---|---|
// | 0 | 成功，架构门通过 | 无 HIGH 风险（或风险低于 --fail-on 阈值） |
// | 1 | 成功，但架构门未通过 | 检测到 HIGH（或阈值以上）风险；报告已正常生成 |
// | 2 | 参数或配置错误 | 缺参数、未知命令、rules 文件格式错、未登录 |
// | 3 | 扫描或解析失败 | buildGraph 抛异常、安装失败、文件无法解析 |
// | 4 | 基线不存在或失效 | 没跑 session start 就 report；基线文件损坏 |
//
// 注意：1 不是崩溃。CI 里 1 = 阻断合并；3 = 工具本身出问题，应修工具或环境。

const EXIT = Object.freeze({
  OK: 0,
  GATE_FAILED: 1,
  USAGE_ERROR: 2,
  SCAN_FAILED: 3,
  NO_BASELINE: 4
});

const VALID_FAIL_ON = Object.freeze(['high', 'medium', 'low', 'none']);

// 规范化 --fail-on 参数；非法值直接抛错（fail-closed，不静默回退）。
function normalizeFailOn(value) {
  const v = String(value == null ? 'high' : value).toLowerCase();
  if (!VALID_FAIL_ON.includes(v)) {
    throw new Error(`--fail-on must be one of: ${VALID_FAIL_ON.join(', ')} (got "${value}")`);
  }
  return v;
}

const SEVERITY_ORDER = { none: 0, low: 1, medium: 2, high: 3 };

// --fail-on 阈值：返回 true 表示该风险等级应阻断（退出码 1）
// high（默认）：仅 HIGH 阻断
// medium：MEDIUM 及以上阻断
// low：任何 finding 都阻断
// none：永不阻断（只出报告）
function shouldGate(level, failOn) {
  const threshold = normalizeFailOn(failOn || 'high');
  if (threshold === 'none') return false;
  const severity = SEVERITY_ORDER[level] || 0;
  return severity >= SEVERITY_ORDER[threshold];
}

// 便捷封装：直接返回退出码（0 或 1）
function exitCodeForRisk(level, failOn) {
  return shouldGate(level, failOn) ? EXIT.GATE_FAILED : EXIT.OK;
}

/**
 * 分析完整性优先于风险门：failed / incomplete → 3（不是违规）。
 * 脚本用 analysisStatus 区分「分析失败」与「架构门未通过」。
 */
function exitCodeForAnalysis(completeness, riskLevel, failOn) {
  const status = completeness && completeness.status;
  if (status === 'failed' || status === 'incomplete') return EXIT.SCAN_FAILED;
  return exitCodeForRisk(riskLevel, failOn);
}

function codedError(message, exitCode) {
  const err = new Error(message);
  err.exitCode = exitCode;
  return err;
}

function exitCodeFromError(err) {
  if (err && Number.isInteger(err.exitCode)) return err.exitCode;
  if (err && (err.code === 'RULES_NOT_FOUND' || err.code === 'USAGE')) return EXIT.USAGE_ERROR;
  if (err && (err.code === 'ENOENT' || err.code === 'NO_BASELINE')) return EXIT.NO_BASELINE;
  return EXIT.SCAN_FAILED;
}

// check：配置错 / 扫描失败 / 无套件 优先于「协议或规则未通过」。
function exitCodeForCheck(result) {
  if (!result) return EXIT.SCAN_FAILED;
  if (result.configError) return EXIT.USAGE_ERROR;
  if (result.scanError) return EXIT.SCAN_FAILED;
  if (result.missingRepo || result.missingKit) return EXIT.NO_BASELINE;
  if (!result.ok) return EXIT.GATE_FAILED;
  return EXIT.OK;
}

module.exports = {
  EXIT,
  VALID_FAIL_ON,
  normalizeFailOn,
  shouldGate,
  exitCodeForRisk,
  exitCodeForAnalysis,
  codedError,
  exitCodeFromError,
  exitCodeForCheck
};
