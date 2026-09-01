'use strict';

const WECOM_HOSTS = [
  'qyapi.weixin.qq.com',
  'hooks.qyapi.weixin.qq.com'
];

function isWecomUrl(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'https:') return false;
    return WECOM_HOSTS.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function allowLooseNotifyUrl(url) {
  if (process.env.NODE_ENV === 'test' || process.env.ARCH_PRO_NOTIFY_TEST === '1') {
    try {
      const u = new URL(String(url || ''));
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }
  return false;
}

function assertNotifyUrl(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  if (isWecomUrl(s) || allowLooseNotifyUrl(s)) return s;
  const err = new Error('企业微信地址应为 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…');
  err.status = 400;
  throw err;
}

function wecomPayload(markdown) {
  const text = String(markdown || '').slice(0, 4000);
  return {
    msgtype: 'markdown',
    markdown: { content: text }
  };
}

async function sendWecom(webhookUrl, markdown) {
  const url = String(webhookUrl || '').trim();
  if (!url) return { sent: false, reason: 'empty' };
  const hook = global.__AV_NOTIFY;
  if (typeof hook === 'function') {
    await hook(url, markdown);
    return { sent: true, via: 'hook' };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(wecomPayload(markdown))
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error('企业微信推送失败：' + (text || res.status));
    err.status = 502;
    throw err;
  }
  return { sent: true, via: 'wecom' };
}

module.exports = { isWecomUrl, assertNotifyUrl, wecomPayload, sendWecom };
