(function () {
  'use strict';

  var tipEl = document.getElementById('demo-tip');

  function setTip(text, isError) {
    if (!tipEl) return;
    tipEl.hidden = !text;
    tipEl.textContent = text || '';
    tipEl.classList.toggle('error', !!isError);
  }

  // --- i18n ---
  var I18N = {
    zh: {
      'brand': 'Architecture Viewer',
      'nav.product': '产品',
      'nav.demo': '演示',
      'nav.download': '安装',
      'nav.pricing': '定价',
      'nav.repo': '开源仓',
      'hero.eyebrow': '开源 Apache-2.0 · 对照 Git 基线 · CLI / MCP',
      'hero.title': 'AI 改完代码，先看这次改动涉及哪些依赖和调用方。',
      'hero.lede': 'Architecture Viewer 对照 Git 基线，列出结构变化、潜在影响和需要复查的位置，方便你把检查结果交回 AI 处理。不替代测试或完整代码审查；结构通过不代表功能正确。',
      'hero.tryBtn': '生成架构图',
      'hero.tryHint': '公开仓库 · 无 Key 即时骨架 · 有 Key 精修约 30–90 秒',
      'hero.tryHintLlm': '服务端已配置 API Key · 默认精修约 30–90 秒',
      'hero.tryAdvanced': '我有 API Key · 精修（可选）',
      'hero.tryKeyHint': 'Key 只随本次请求发送，不会写入分享页或服务端。服务端已配置 Key 时可不填。',
      'hero.tryRemember': '在本机浏览器记住 Key（仅存于 localStorage）',
      'hero.modeFast': '本次：骨架（即时）',
      'hero.modeRefine': '本次：精修（约 30–90 秒）',
      'hero.generating': '生成骨架…',
      'hero.generatingLlm': '精修中，约 30–90 秒…',
      'hero.errUrl': '请输入 Git 仓库 URL（如 https://gitee.com/user/repo）',
      'hero.errKeyBad': 'API Key 无效或服务端未配置 Key，无法精修。可去掉 Key 先出骨架，或检查 Key 后重试。',
      'hero.errFailed': '生成失败：',
      'hero.errNetwork': '请求失败：网络错误或服务不可达',
      'hero.okRefine': '精修完成，正在打开分享页…',
      'hero.okFast': '骨架已生成，正在打开分享页…',
      'hero.ctaSecondary': '看 60 秒演示',
      'hero.ctaCli': 'CLI 安装',
      'product.title': '一条引擎，两个入口',
      'product.copy': '扫描、生成、校验全在 <code>lib/</code> 里，Web 和 CLI 共用一套引擎。Web 负责粘贴 URL 即出图；CLI 负责写进仓库 + CI 漂移红灯。',
      'product.webTitle': '① 网页版 · 粘贴即出图',
      'product.webBody': '粘贴 Git 仓库 URL，得到六视图分享页 <code>/p/&lt;id&gt;</code>。无 Key 即时骨架；有 Key 精修后再分享。',
      'product.web1': '支持 Gitee / GitHub / GitLab 公开仓库',
      'product.web2': '可缩放、搜索节点、高亮依赖',
      'product.web3': '一张链接发评审会，图随版本走',
      'product.extTitle': '② CLI · 写进仓库 + CI 漂移',
      'product.extBody': '<code>npm i -g arch-viewer</code>。Init → Generate → check --drift。图落在仓库里，跟 PR 一起 review。',
      'product.ext1': '六视图一次出图，图随仓库保存',
      'product.ext2': 'GitHub Actions 模板：PR 漂移直接红灯',
      'product.ext3': '零运行时依赖，Node ≥ 18 即可',
      'product.ext4': '可选 LLM 精修（用户自带 API Key）',
      'demo.title': '60 秒走一遍真实链路',
      'demo.copy': '先看 60 秒成片：session start → 改代码 → session report 红灯。下面还有 Coffee Shop 六视图分享页（官网不实时扫你的仓库）。',
      'demo.videoCaption': '60 秒：基线 → 改代码 → 漂移红灯（中英字幕）',
      'demo.step1': '拷入 Viewer 套件',
      'demo.step2': '扫描仓库出六视图',
      'demo.step3': '浏览器 / Webview 看图',
      'demo.step4': '协议 + 漂移；坏图 CI 红灯',
      'demo.tabShowcase': '完整六视图 · Coffee Shop',
      'demo.tabDrift': '漂移红灯 · 故意坏图',
      'demo.showcaseTitle': 'Coffee Shop · 咖啡订单平台',
      'demo.showcaseDesc': '顾客下单 → frontend → api（Order / Payment / Inventory）→ postgres / redis → mq → worker 出杯通知。扫描命中 6 个 compose 服务、backend 领域类、deploy/K8s，协议 PASS，漂移 0。',
      'demo.openShowcase': '打开六视图分享页',
      'demo.copyCmd': '复制本地复现命令',
      'pain.title': '跨文件改完，先核对依赖和调用方',
      'pain.copy': '价值是看清这一轮动了谁；证据是文件、边、规则和 Git 基线；边界是不替代测试或完整审查。结构变化不一定是坏事，结构通过也不代表功能正确。',
      'pain.leftTitle': '常见卡点',
      'pain.left1': 'AI 跨模块改代码，调用方和依赖容易漏',
      'pain.left2': '编译、单测、AI 自查过了，结构边仍可能变了',
      'pain.left3': '全仓历史债和本轮增量混在一起，难复查',
      'pain.left4': '把结果交回 AI 时，缺少可指认的文件和边',
      'pain.right1': '对照 Git 基线列出本轮结构变化',
      'pain.right2': '标出潜在影响面和需要复查的位置',
      'pain.right3': '规则可复验；不承诺无误报、无漏报',
      'pain.right4': '本地 CLI / MCP，方便把检查结果交回 AI',
      'dl.title': '安装 · 一分钟跑起来',
      'dl.copy': 'Community 永远免费 + 开源（Apache-2.0）。两种方式任选其一。',
      'pricing.title': '社区能力免费。下面是试验报价。',
      'pricing.copy': '分析能力本身免费。体检、Team 入门包、Pro 都是试验报价，不是已验证的商业模式：早鸟体检 ¥999、Team ¥4,999/年（5 席）、Pro ¥29/月或 ¥199/年。'
    },
    en: {
      'brand': 'Architecture Viewer',
      'nav.product': 'Product',
      'nav.demo': 'Demo',
      'nav.download': 'Install',
      'nav.pricing': 'Pricing',
      'nav.repo': 'Open Source',
      'hero.eyebrow': 'Apache-2.0 · Git baseline · CLI / MCP',
      'hero.title': 'After AI edits the code, see which dependencies and callers this change actually touches.',
      'hero.lede': 'Architecture Viewer compares against a Git baseline and lists structural changes, likely impact, and places to re-check, so you can hand the findings back to the AI. It does not replace tests or a full code review. A structural pass does not mean the feature is correct.',
      'hero.tryBtn': 'Generate diagram',
      'hero.tryHint': 'Public repos · instant skeleton without a key · refine ~30–90s with a key',
      'hero.tryHintLlm': 'Server has an API key · default refine ~30–90s',
      'hero.tryAdvanced': 'I have an API key · refine (optional)',
      'hero.tryKeyHint': 'The key is sent only with this request; it is never written to the share page or stored server-side. Leave blank if the server already has a key.',
      'hero.tryRemember': 'Remember key in this browser (localStorage only)',
      'hero.modeFast': 'This run: skeleton (instant)',
      'hero.modeRefine': 'This run: refine (~30–90s)',
      'hero.generating': 'Generating skeleton…',
      'hero.generatingLlm': 'Refining, about 30–90s…',
      'hero.errUrl': 'Enter a Git repo URL (e.g. https://gitee.com/user/repo)',
      'hero.errKeyBad': 'The API key is invalid or the server has no key, so refine cannot run. Remove the key for a skeleton, or check the key and retry.',
      'hero.errFailed': 'Generation failed: ',
      'hero.errNetwork': 'Request failed: network error or server unreachable',
      'hero.okRefine': 'Refine done, opening share page…',
      'hero.okFast': 'Skeleton ready, opening share page…',
      'hero.ctaSecondary': '60-second demo',
      'hero.ctaCli': 'Install CLI',
      'product.title': 'One engine, two surfaces',
      'product.copy': 'Scan, generate, and validate live in <code>lib/</code>. The web surface lets you paste a URL; the CLI writes diagrams into your repo with CI drift gates.',
      'product.webTitle': '① Web · paste URL, get diagrams',
      'product.webBody': 'Paste a Git repo URL, get a six-view share page <code>/p/&lt;id&gt;</code>. Instant skeleton without a key; refine when a key is set.',
      'product.web1': 'Supports Gitee / GitHub / GitLab public repos',
      'product.web2': 'Zoom, search nodes, highlight paths',
      'product.web3': 'One link for design reviews; diagrams track versions',
      'product.extTitle': '② CLI · repo + CI drift gate',
      'product.extBody': '<code>npm i -g arch-viewer</code>. Init → Generate → check --drift. Diagrams land in the repo and review with the PR.',
      'product.ext1': 'Six views in one pass, saved to repo',
      'product.ext2': 'GitHub Actions template: drift fails the PR',
      'product.ext3': 'Zero runtime deps, Node ≥ 18',
      'product.ext4': 'Optional LLM refine (bring your own API key)',
      'demo.title': 'A real loop in 60 seconds',
      'demo.copy': 'Watch the 60s film first: session start → change code → session report red light. Baked Coffee Shop share pages sit below (the marketing site does not scan your private repos).',
      'demo.videoCaption': '60s: baseline → code change → drift red light (ZH/EN captions)',
      'demo.step1': 'Copy the Viewer kit',
      'demo.step2': 'Scan the repo into six views',
      'demo.step3': 'Preview in browser / Webview',
      'demo.step4': 'Protocol + drift; bad diagrams fail CI',
      'demo.tabShowcase': 'Six views · Coffee Shop',
      'demo.tabDrift': 'Drift red light · broken fixture',
      'demo.showcaseTitle': 'Coffee Shop · order platform',
      'demo.showcaseDesc': 'Order → frontend → api (Order / Payment / Inventory) → postgres / redis → mq → worker. Hits 6 compose services, backend domain classes, deploy/K8s. Protocol PASS, drift 0.',
      'demo.openShowcase': 'Open six-view share page',
      'demo.copyCmd': 'Copy local reproduce commands',
      'pain.title': 'After a cross-file edit, check dependencies and callers first',
      'pain.copy': 'Value: see who this round actually moved. Evidence: files, edges, rules, and a Git baseline. Boundary: not a substitute for tests or a full review. Structural change is not automatically bad; a structural pass is not functional correctness.',
      'pain.leftTitle': 'Where it usually breaks down',
      'pain.left1': 'AI edits across modules; callers and dependencies get missed',
      'pain.left2': 'Compile, unit tests, and the AI’s self-check can still miss a structural edge',
      'pain.left3': 'Historical debt and this round’s delta get mixed together',
      'pain.left4': 'Handing work back to the AI lacks a file and an edge you can point to',
      'pain.right1': 'Lists this round’s structural changes against a Git baseline',
      'pain.right2': 'Marks likely impact and places that need a re-check',
      'pain.right3': 'Rules are reproducible; we do not claim zero false positives or misses',
      'pain.right4': 'Local CLI / MCP, so you can hand findings back to the AI',
      'dl.title': 'Install · up in one minute',
      'dl.copy': 'Community stays free and open source (Apache-2.0). Pick any path.',
      'pricing.title': 'Community is free. Paid items below are experimental offers.',
      'pricing.copy': 'Analysis itself stays free. The checkup, Team starter, and Pro prices are experimental offers, not a proven business: early-bird checkup ¥999, Team ¥4,999/year (5 seats), Pro ¥29/month or ¥199/year.'
    }
  };

  function detectLang() {
    var q = new URLSearchParams(location.search).get('lang');
    if (q === 'en' || q === 'zh') return q;
    try {
      var stored = localStorage.getItem('av_lang');
      if (stored === 'en' || stored === 'zh') return stored;
    } catch (_) {}
    return 'zh';
  }

  var currentLang = detectLang();
  var serverLlm = false;

  function hintKey() {
    return serverLlm ? 'hero.tryHintLlm' : 'hero.tryHint';
  }

  function applyLang(lang) {
    var dict = I18N[lang] || I18N.zh;
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (key === 'hero.tryHint') key = hintKey();
      if (dict[key] != null) el.textContent = dict[key];
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (dict[key] != null) el.innerHTML = dict[key];
    });
    var btn = document.getElementById('lang-toggle');
    if (btn) btn.textContent = lang === 'en' ? '中文' : 'EN';
    try { localStorage.setItem('av_lang', lang); } catch (_) {}
    var url = new URL(location.href);
    url.searchParams.set('lang', lang);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  applyLang(currentLang);
  var langBtn = document.getElementById('lang-toggle');
  if (langBtn) {
    langBtn.addEventListener('click', function () {
      currentLang = currentLang === 'en' ? 'zh' : 'en';
      applyLang(currentLang);
      updateModeBadge();
      setTryStatus(statusEl && statusEl.textContent ? statusEl.textContent : '', statusEl.classList.contains('error') ? 'error' : (statusEl.classList.contains('success') ? 'success' : 'loading'));
    });
  }

  // --- Demo tabs: Coffee Shop showcase + drift-fail ---
  var demoTabs = document.querySelectorAll('#demo .tab[data-sample]');
  if (demoTabs.length) {
    Array.prototype.forEach.call(demoTabs, function (tab) {
      tab.addEventListener('click', function (e) {
        if (e && e.preventDefault) e.preventDefault();
        var key = tab.getAttribute('data-sample');
        var panel = document.getElementById('panel-' + key);
        document.querySelectorAll('#demo .tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('#demo .panel').forEach(function (p) { p.classList.remove('active'); });
        tab.classList.add('active');
        if (panel) panel.classList.add('active');
      });
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-copy]');
    if (!btn) return;
    e.preventDefault();
    var sel = btn.getAttribute('data-copy');
    var target = sel ? document.querySelector(sel) : null;
    if (!target) { setTip('复制失败：找不到目标', true); return; }
    var text = (target.innerText || target.textContent || '').trim();
    copyText(text).then(function () {
      setTip('已复制：' + (text.length > 40 ? text.slice(0, 40) + '…' : text), false);
    }).catch(function () {
      setTip('复制失败，请手动选择文本', true);
    });
  });

  // --- Git URL 生成（骨架 fast / 精修 refine） ---
  var urlForm = document.getElementById('url-generate-form');
  var urlInput = document.getElementById('repo-url');
  var genBtn = document.getElementById('url-generate-btn');
  var keyEl = document.getElementById('repo-api-key');
  var rememberEl = document.getElementById('repo-api-remember');
  var advancedEl = document.getElementById('try-advanced');
  var modeEl = document.getElementById('try-mode');
  var statusEl = document.getElementById('try-status');
  var KEY_STORE = 'av_api_key';

  function dict() { return I18N[currentLang] || I18N.zh; }

  function setTryStatus(text, kind) {
    if (!statusEl) return;
    statusEl.hidden = !text;
    statusEl.textContent = text || '';
    statusEl.classList.remove('error', 'success', 'loading');
    if (kind) statusEl.classList.add(kind);
  }

  function userKey() {
    return (keyEl && keyEl.value || '').trim();
  }

  // 当前将走的模式：服务端有 Key 或用户填了 Key → refine，否则 fast
  function willRefine() {
    return !!(serverLlm || userKey());
  }

  function updateModeBadge() {
    if (!modeEl) return;
    var refine = willRefine();
    modeEl.textContent = refine ? dict()['hero.modeRefine'] : dict()['hero.modeFast'];
    modeEl.classList.toggle('is-refine', refine);
  }

  // 回填本机记住的 Key
  try {
    var savedKey = localStorage.getItem(KEY_STORE) || '';
    if (savedKey && keyEl) {
      keyEl.value = savedKey;
      if (advancedEl) advancedEl.open = true;
    }
  } catch (_) {}
  updateModeBadge();

  if (keyEl) {
    keyEl.addEventListener('input', function () {
      updateModeBadge();
      setTryStatus('');
    });
  }

  function saveOrClearKey() {
    try {
      var k = userKey();
      if (k && rememberEl && rememberEl.checked) {
        localStorage.setItem(KEY_STORE, k);
      } else {
        localStorage.removeItem(KEY_STORE);
      }
    } catch (_) {}
  }

  function looksGitUrl(s) {
    return /^https?:\/\//i.test(s) || /^git@[\w.-]+:/i.test(s) || /^ssh:\/\//i.test(s);
  }

  if (urlForm) {
    urlForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var d = dict();
      var url = (urlInput && urlInput.value || '').trim();
      if (!url || !looksGitUrl(url)) {
        setTryStatus(d['hero.errUrl'], 'error');
        if (urlInput) urlInput.focus();
        return;
      }
      var key = userKey();
      var refine = willRefine();
      genBtn.disabled = true;
      genBtn.textContent = '⏳ ' + (refine ? d['hero.generatingLlm'] : d['hero.generating']);
      setTryStatus(refine ? d['hero.generatingLlm'] : d['hero.generating'], 'loading');

      var payload = { url: url, quality: refine ? 'refine' : 'fast' };
      if (key) payload.apiKey = key;
      fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json().then(function (data) { return { status: r.status, ok: r.ok, data: data }; }); })
        .then(function (res) {
          if (!res.ok || res.data.error) {
            // 401/403：精修 Key 问题 —— 给出可操作提示，不静默降级
            var msg = (res.status === 401 || res.status === 403)
              ? d['hero.errKeyBad']
              : d['hero.errFailed'] + (res.data.error || ('HTTP ' + res.status));
            setTryStatus(msg, 'error');
            genBtn.disabled = false;
            genBtn.textContent = d['hero.tryBtn'];
            return;
          }
          if (!res.data.shareUrl) {
            setTryStatus(d['hero.errFailed'] + (currentLang === 'en' ? 'no share link in response' : '返回数据缺少分享链接'), 'error');
            genBtn.disabled = false;
            genBtn.textContent = d['hero.tryBtn'];
            return;
          }
          saveOrClearKey();
          setTryStatus(refine ? d['hero.okRefine'] : d['hero.okFast'], 'success');
          window.location.href = res.data.shareUrl;
        })
        .catch(function (err) {
          setTryStatus(d['hero.errNetwork'] + (err && err.message ? '（' + err.message + '）' : ''), 'error');
          genBtn.disabled = false;
          genBtn.textContent = d['hero.tryBtn'];
        });
    });
  }

  fetch('/api/health').then(function (r) { return r.ok ? r.json() : null; }).then(function (h) {
    if (!h) return;
    if (h.version) {
      var v = document.getElementById('ver');
      if (v) v.textContent = h.version;
    }
    serverLlm = !!(h.llmAvailable || h.llm);
    // applyLang 的 hintKey() 会据 serverLlm 自动选择底部提示文案
    applyLang(currentLang);
    updateModeBadge();
    if (h.billing) {
      var map = {
        'pay-afdian': h.billing.afdian,
        'pay-wechat': h.billing.wechat,
        'pay-lemon': h.billing.lemon
      };
      Object.keys(map).forEach(function (id) {
        var el = document.getElementById(id);
        if (el && map[id]) el.setAttribute('href', map[id]);
      });
    }
  }).catch(function () { /* ignore */ });

  var teamForm = document.getElementById('team-apply');
  if (teamForm) {
    teamForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var tip = document.getElementById('team-apply-tip');
      var email = (document.getElementById('team-email') || {}).value || '';
      var repoUrl = (document.getElementById('team-repo') || {}).value || '';
      fetch('/api/billing/team-application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), repoUrl: repoUrl.trim(), channel: 'landing' })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          if (!res.ok) {
            if (tip) { tip.hidden = false; tip.textContent = res.data.error || '申请失败'; tip.classList.add('error'); }
            return;
          }
          if (tip) { tip.hidden = false; tip.textContent = '申请 ' + res.data.applicationId + ' 已登记，2 个工作日内人工联系报价。'; tip.classList.remove('error'); }
        })
        .catch(function () {
          if (tip) { tip.hidden = false; tip.textContent = '网络错误'; tip.classList.add('error'); }
        });
    });
  }
})();
