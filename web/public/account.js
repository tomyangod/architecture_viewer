(function () {
  'use strict';

  var tipAuth = document.getElementById('auth-tip');
  var tipDash = document.getElementById('dash-tip');

  function showTip(el, text, isError) {
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || '';
    el.classList.toggle('error', !!isError);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().then(function (d) {
        return { ok: r.ok, status: r.status, data: d };
      });
    });
  }

  function render(me) {
    var gate = document.getElementById('gate');
    var dash = document.getElementById('dash');
    var logout = document.getElementById('logout-btn');
    if (!me || !me.user) {
      gate.hidden = false;
      dash.hidden = true;
      logout.hidden = true;
      return;
    }
    gate.hidden = true;
    dash.hidden = false;
    logout.hidden = false;
    var u = me.user;
    var line = document.getElementById('plan-line');
    var until = u.paidUntil || u.trialUntil || '';
    line.innerHTML =
      '当前：<strong>' +
      (u.active ? (u.entitlement === 'pro' ? 'Pro 已开通' : '试用中') : '已到期') +
      '</strong> · ' +
      esc(u.email) +
      (until ? ' · 有效期至 ' + esc(until.slice(0, 10)) : '');

    var list = document.getElementById('repo-list');
    list.innerHTML = (me.repos || [])
      .map(function (r) {
        return (
          '<article class="dl-card" style="margin:1rem 0">' +
          '<p><strong>' +
          esc(r.owner) +
          '/' +
          esc(r.repo) +
          '</strong> · ' +
          esc(r.provider) +
          '</p>' +
          '<p class="muted small">Webhook URL</p><pre><code>' +
          esc(me.webhookBase) +
          '</code></pre>' +
          '<p class="muted small">Webhook Secret / Gitee Token（请写入 Git 托管平台）</p>' +
          '<pre><code>' +
          esc(r.webhookSecret) +
          '</code></pre>' +
          '<p class="muted small">GitHub：Pull request 事件 + 上述 Secret。Gitee：Merge Request Hook，密码/Token 填同一 Secret。</p>' +
          '</article>'
        );
      })
      .join('') || '<p class="muted">尚未接入仓库。</p>';

    var ev = document.getElementById('event-list');
    ev.innerHTML = (me.events || [])
      .map(function (e) {
        return (
          '<li>' +
          (e.ok ? '绿灯' : '红灯') +
          ' · PR #' +
          esc(e.pr || '-') +
          ' · 漂移 ' +
          esc(e.missing || 0) +
          ' · ' +
          esc(String(e.at || '').replace('T', ' ').slice(0, 19)) +
          '</li>'
        );
      })
      .join('') || '<li class="muted">暂无托管检查记录</li>';
  }

  function refresh() {
    return api('GET', '/api/pro/me').then(function (r) {
      if (!r.ok) {
        render(null);
        return;
      }
      render(r.data);
    });
  }

  document.getElementById('auth-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = document.getElementById('email').value.trim();
    var password = document.getElementById('password').value;
    api('POST', '/api/pro/login', { email: email, password: password }).then(function (r) {
      if (!r.ok) {
        showTip(tipAuth, r.data.error || '登录失败', true);
        return;
      }
      showTip(tipAuth, '');
      refresh();
    });
  });

  document.getElementById('signup-btn').addEventListener('click', function () {
    var email = document.getElementById('email').value.trim();
    var password = document.getElementById('password').value;
    api('POST', '/api/pro/signup', { email: email, password: password }).then(function (r) {
      if (!r.ok) {
        showTip(tipAuth, r.data.error || '注册失败', true);
        return;
      }
      showTip(tipAuth, '');
      refresh();
    });
  });

  document.getElementById('logout-btn').addEventListener('click', function () {
    api('POST', '/api/pro/logout', {}).then(function () {
      render(null);
    });
  });

  document.getElementById('pay-btn').addEventListener('click', function () {
    api('POST', '/api/pro/billing/checkout', {}).then(function (r) {
      if (r.ok && r.data.url) {
        window.location.href = r.data.url;
        return;
      }
      showTip(tipDash, r.data.error || '支付未配置', true);
    });
  });

  document.getElementById('redeem-toggle').addEventListener('click', function () {
    var f = document.getElementById('redeem-form');
    f.hidden = !f.hidden;
  });

  document.getElementById('redeem-form').addEventListener('submit', function (e) {
    e.preventDefault();
    api('POST', '/api/pro/billing/redeem', { key: document.getElementById('license-key').value.trim() }).then(
      function (r) {
        if (!r.ok) {
          showTip(tipDash, r.data.error || '兑换失败', true);
          return;
        }
        showTip(tipDash, '已开通 Pro', false);
        refresh();
      }
    );
  });

  document.getElementById('repo-form').addEventListener('submit', function (e) {
    e.preventDefault();
    api('POST', '/api/pro/repos', {
      url: document.getElementById('repo-url').value.trim(),
      token: document.getElementById('repo-token').value.trim()
    }).then(function (r) {
      if (!r.ok) {
        showTip(tipDash, r.data.error || '接入失败', true);
        return;
      }
      showTip(tipDash, '已接入。把 Webhook URL 与 Secret 填到 Gitee/GitHub。', false);
      refresh();
    });
  });

  if (/paid=1/.test(location.search)) showTip(tipDash, '支付完成，正在刷新权益…', false);
  refresh();
})();
