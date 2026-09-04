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
      (until ? ' · 有效期至 ' + esc(until.slice(0, 10)) : '') +
      (u.active
        ? ''
        : '<br><span class="muted">到期后仍可点「现在检查」。自动检查与企业微信推送请兑换许可证。</span>');

    var intervalInput = document.getElementById('local-interval');
    var wecomInput = document.getElementById('local-wecom');
    if (intervalInput) {
      intervalInput.disabled = !u.active;
      if (!u.active) intervalInput.value = '0';
    }
    if (wecomInput) wecomInput.disabled = !u.active;

    var localsEl = document.getElementById('local-list');
    if (localsEl) {
      if (me.localEnabled === false) {
        localsEl.innerHTML = '<p class="muted">本地检查已关闭。本机运行网页或设置 ARCH_PRO_LOCAL=1。</p>';
      } else {
        localsEl.innerHTML = (me.locals || [])
          .map(function (p) {
            var lamp =
              p.lastOk === true ? 'lamp-green' : p.lastOk === false ? 'lamp-red' : 'lamp-none';
            var lampText =
              p.lastOk === true ? '绿灯' : p.lastOk === false ? '红灯' : '尚未检查';
            return (
              '<article class="dl-card" data-local-id="' +
              esc(p.id) +
              '" style="margin:1rem 0">' +
              '<p><strong>' +
              esc(p.path) +
              '</strong></p>' +
              '<p><span class="lamp ' +
              lamp +
              '">' +
              lampText +
              '</span>' +
              (p.lastAt ? ' · ' + esc(String(p.lastAt).replace('T', ' ').slice(0, 19)) : '') +
              ' · 协议问题 ' +
              esc(p.lastErrors || 0) +
              ' · 漂移 ' +
              esc(p.lastMissing || 0) +
              (p.hasWecom ? ' · 已接企业微信' : '') +
              ' · 每 ' +
              esc(p.intervalMin) +
              ' 分钟自动查</p>' +
              '<div class="dl-actions">' +
              '<button type="button" class="btn primary local-check">现在检查</button>' +
              '<button type="button" class="btn ghost local-del">移除</button>' +
              '</div></article>'
            );
          })
          .join('') || '<p class="muted">尚未添加本地项目。填上面的文件夹路径即可。</p>';
      }
    }

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
          ' · ' +
          (e.kind === 'local' ? '本地 ' + esc(e.label || '') : 'PR #' + esc(e.pr || '-')) +
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

  function runProFeature(path) {
    return api('POST', path, {}).then(function (r) {
      var tip = document.getElementById('pro-feature-tip');
      if (!r.ok) {
        var extra = r.data.pricingUrl ? ' 定价：' + r.data.pricingUrl : '';
        showTip(tip, (r.data.error || '需要升级') + extra, true);
        return;
      }
      showTip(tip, r.data.message || '已受理', false);
    });
  }

  var refineBtn = document.getElementById('pro-refine-btn');
  var syncBtn = document.getElementById('pro-sync-btn');
  if (refineBtn) refineBtn.addEventListener('click', function () { runProFeature('/api/pro/refine'); });
  if (syncBtn) syncBtn.addEventListener('click', function () { runProFeature('/api/pro/sync'); });

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

  var localForm = document.getElementById('local-form');
  if (localForm) {
    localForm.addEventListener('submit', function (e) {
      e.preventDefault();
      api('POST', '/api/pro/local', {
        path: document.getElementById('local-path').value.trim(),
        wecomWebhook: document.getElementById('local-wecom').value.trim(),
        intervalMin: document.getElementById('local-interval').value
      }).then(function (r) {
        if (!r.ok) {
          showTip(tipDash, r.data.error || '保存失败', true);
          return;
        }
        showTip(tipDash, r.data.note || '已保存本地项目。点「现在检查」看红灯/绿灯。', !!r.data.limited);
        refresh();
      });
    });
  }

  var localList = document.getElementById('local-list');
  if (localList) {
    localList.addEventListener('click', function (e) {
      var checkBtn = e.target.closest && e.target.closest('.local-check');
      var delBtn = e.target.closest && e.target.closest('.local-del');
      var card = e.target.closest && e.target.closest('[data-local-id]');
      if (!card) return;
      var id = card.getAttribute('data-local-id');
      if (checkBtn) {
        api('POST', '/api/pro/local/' + id + '/check', { notify: true }).then(function (r) {
          if (!r.ok) {
            showTip(tipDash, r.data.error || '检查失败', true);
            return;
          }
          showTip(
            tipDash,
            r.data.note ||
              (r.data.checkOk ? '绿灯 · 图与代码一致' : '红灯 · 图和代码对不上') +
                (r.data.notified ? ' · 已推企业微信' : ''),
            !r.data.checkOk || !!r.data.notifySkipped
          );
          refresh();
        });
        return;
      }
      if (delBtn) {
        api('DELETE', '/api/pro/local/' + id, {}).then(function (r) {
          if (!r.ok) {
            showTip(tipDash, r.data.error || '移除失败', true);
            return;
          }
          refresh();
        });
      }
    });
  }

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
  api('GET', '/api/billing/links').then(function (r) {
    if (!r.ok || !r.data) return;
    var map = { 'pay-afdian': r.data.afdian, 'pay-wechat': r.data.wechat, 'pay-lemon': r.data.lemon };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && map[id]) el.setAttribute('href', map[id]);
    });
  });
})();
