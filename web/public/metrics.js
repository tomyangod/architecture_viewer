'use strict';
/* 安装与激活指标看板前端逻辑（W06-04） */

let refreshTimer = null;

async function loadMetrics(force) {
  const btn = document.getElementById('btnRefresh');
  const content = document.getElementById('content');
  const updatedAt = document.getElementById('updatedAt');

  if (btn) { btn.disabled = true; btn.textContent = '加载中…'; }

  try {
    const url = '/api/metrics' + (force ? '?force=1' : '');
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await resp.json();

    if (data.error && !data.kpi) {
      content.innerHTML = '<div class="error-box">指标加载失败：' + escapeHtml(data.error) + '</div>';
      return;
    }

    render(data);
    updatedAt.textContent = '更新于 ' + new Date(data.generatedAt || Date.now()).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    content.innerHTML = '<div class="error-box">网络错误：' + escapeHtml(err.message) + '</div>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '刷新'; }
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('zh-CN');
}

function render(d) {
  const kpi = d.kpi || {};
  const npm = d.npm || {};
  const pro = d.pro || {};
  const funnel = d.funnel || {};
  const tel = d.telemetry || {};

  let html = '';

  // --- KPI cards ---
  html += '<div class="kpi-grid">';
  html += kpiCard('累计安装', fmt(kpi.totalInstalls), 'npm 下载总量');
  html += kpiCard('周新增安装', fmt(kpi.weeklyInstalls), npm.weekRange ? npm.weekRange.from + ' ~ ' + npm.weekRange.to : '本周', kpi.weeklyInstalls > 0 ? 'up' : '');
  html += kpiCard('周活跃', kpi.weeklyActive != null ? fmt(kpi.weeklyActive) + ' 天' : '—', tel.available ? '遥测样本' : '遥测未开启', tel.available ? '' : 'warn');
  html += kpiCard('Pro 用户', fmt(kpi.proUsers), '注册账号（不含测试）');
  html += kpiCard('活跃试用', fmt(kpi.activeTrial), '7 天试用期内');
  html += kpiCard('付费用户', fmt(kpi.paidUsers), 'Pro + Team');
  html += kpiCard('付费订单', fmt(kpi.paidOrders), kpi.revenueYuan ? '¥' + fmt(kpi.revenueYuan) : '待首笔');
  html += '</div>';

  // --- Daily download chart ---
  if (npm.daily && npm.daily.length) {
    html += '<div class="panel">';
    html += '<h2 class="panel-title">近 30 天 npm 下载量</h2>';
    html += renderDailyChart(npm.daily);
    html += '<div class="panel-note">数据源：npm downloads API（含镜像/代理，偏高作上界）</div>';
    html += '</div>';
  }

  // --- Conversion funnel ---
  const conv = funnel.conversion || {};
  const fe = funnel.events || {};
  const weekly = fe.weekly || {};
  html += '<div class="panel">';
  html += '<h2 class="panel-title">本周转化漏斗</h2>';
  html += '<div class="funnel">';
  html += funnelRow('周安装', kpi.weeklyInstalls || 0, null, '');
  html += funnelRow('注册', weekly.signup || 0, conv.installToSignup, '');
  html += funnelRow('试用', weekly.trial || 0, conv.signupToTrial, 'trial');
  html += funnelRow('付费', weekly.pay || 0, conv.trialToPay, 'paid');
  html += '</div>';
  html += '<div class="panel-note">目标：安装→注册 ≥5%，注册→试用 ≥60%，试用→付费 0.5–1%。遥测/漏斗数据依赖真实用户行为。</div>';
  html += '</div>';

  // --- Pro breakdown ---
  html += '<div class="panel">';
  html += '<h2 class="panel-title">Pro 账号明细</h2>';
  if (pro.available) {
    html += '<div class="pro-grid">';
    html += proStat(pro.users, '总用户');
    html += proStat(pro.trial, '试用中');
    html += proStat(pro.pro, 'Pro 订阅');
    html += proStat(pro.team, 'Team');
    html += proStat(pro.orders, '订单总数');
    html += proStat(pro.paidOrders, '已付费');
    html += proStat(pro.weeklyLogins, '本周登录');
    html += proStat(pro.weeklySignups, '本周注册');
    html += '</div>';
  } else {
    html += '<div class="panel-note">.data/pro/store.json 不存在（生产环境部署后才有数据）。</div>';
  }
  html += '</div>';

  // --- Funnel events total ---
  if (fe.available && fe.total) {
    const t = fe.total;
    html += '<div class="panel">';
    html += '<h2 class="panel-title">累计漏斗事件</h2>';
    html += '<div class="pro-grid">';
    html += proStat(t.signup || 0, '注册');
    html += proStat(t.trial || 0, '试用');
    html += proStat(t.login || 0, '登录');
    html += proStat(t.paywall_shown || 0, '付费墙展示');
    html += proStat(t.pay || 0, '付费');
    html += proStat(t.checkout || 0, '结账');
    html += proStat(t.team_order || 0, 'Team 下单');
    html += '</div>';
    html += '</div>';
  }

  document.getElementById('content').innerHTML = html;
}

function kpiCard(label, value, sub, cls) {
  return '<div class="kpi-card">' +
    '<div class="kpi-label">' + escapeHtml(label) + '</div>' +
    '<div class="kpi-value">' + escapeHtml(value) + '</div>' +
    '<div class="kpi-delta ' + (cls || '') + '">' + escapeHtml(sub || '') + '</div>' +
    '</div>';
}

function proStat(num, label) {
  return '<div class="pro-stat"><div class="num">' + fmt(num) + '</div><div class="lbl">' + escapeHtml(label) + '</div></div>';
}

function funnelRow(label, count, pct, cls) {
  const maxCount = 500; // bar scale reference
  const widthPct = Math.max(2, Math.min(100, (count / maxCount) * 100));
  const pctText = pct != null ? pct + '%' : '';
  return '<div class="funnel-row">' +
    '<div class="funnel-label">' + escapeHtml(label) + '</div>' +
    '<div class="funnel-bar-track"><div class="funnel-bar-fill ' + cls + '" style="width:' + widthPct.toFixed(1) + '%"></div></div>' +
    '<div><div class="funnel-count">' + fmt(count) + '</div><div class="funnel-pct">' + pctText + '</div></div>' +
    '</div>';
}

function renderDailyChart(daily) {
  if (!daily.length) return '<div class="panel-note">暂无数据</div>';

  const W = 900;
  const H = 200;
  const padL = 40;
  const padR = 10;
  const padT = 20;
  const padB = 30;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const maxVal = Math.max(1, ...daily.map((d) => d.downloads));
  const barW = Math.max(3, (chartW / daily.length) * 0.7);
  const gap = chartW / daily.length;

  let svg = '<div class="chart-wrap"><svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:' + W + 'px" xmlns="http://www.w3.org/2000/svg">';

  // Y axis grid lines
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = padT + (chartH / steps) * i;
    const val = Math.round(maxVal - (maxVal / steps) * i);
    svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="rgba(201,192,176,0.4)" stroke-width="1"/>';
    svg += '<text class="bar-label" x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end">' + val + '</text>';
  }

  // Bars
  daily.forEach((d, i) => {
    const x = padL + gap * i + (gap - barW) / 2;
    const barH = maxVal > 0 ? (d.downloads / maxVal) * chartH : 0;
    const y = padT + chartH - barH;
    const isToday = i === daily.length - 1;
    const fill = isToday ? '#1a9474' : (d.downloads > 0 ? '#0f6e56' : 'rgba(15,110,86,0.15)');

    svg += '<rect class="bar" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + barH.toFixed(1) + '" rx="2" fill="' + fill + '">';
    svg += '<title>' + d.day + ': ' + d.downloads + ' 次下载</title>';
    svg += '</rect>';

    // Value label on significant bars
    if (d.downloads > 0 && (i % 5 === 0 || d.downloads > maxVal * 0.3 || isToday)) {
      svg += '<text class="bar-value" x="' + (x + barW / 2).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" text-anchor="middle">' + d.downloads + '</text>';
    }

    // X axis date labels (every 5th)
    if (i % 5 === 0 || isToday) {
      const label = d.day.slice(5); // MM-DD
      svg += '<text class="bar-label" x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + label + '</text>';
    }
  });

  svg += '</svg></div>';
  return svg;
}

// Auto-refresh every 5 minutes
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => loadMetrics(false), 5 * 60 * 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  loadMetrics(false);
  startAutoRefresh();
});
