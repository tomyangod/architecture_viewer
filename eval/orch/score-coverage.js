'use strict';
const fs = require('fs');
const path = require('path');

const KEYS = [
  ['入口', /changedetection\.py|flask_app\.py/],
  ['前端页面', /templates/],
  ['静态资源', /static/],
  ['REST/蓝图', /\/api\/|blueprint/],
  ['调度队列', /queue_handlers|custom_queue/],
  ['worker池', /worker_pool/],
  ['worker', /worker\.py/],
  ['抓取器', /content_fetchers/],
  ['差异处理', /\/diff|processors/],
  ['存储', /\/store/],
  ['通知服务', /notification_service/],
  ['通知渠道', /changedetectionio\/notification(?!_service)|notification\//],
  ['实时推送', /realtime/],
  ['部署', /Dockerfile|docker-compose/]
];

function score(md) {
  const hits = KEYS.map(([name, re]) => [name, re.test(md)]);
  const n = hits.filter((h) => h[1]).length;
  return { n, total: KEYS.length, hits };
}

const files = process.argv.slice(2);
for (const f of files) {
  const md = fs.readFileSync(f, 'utf8');
  const s = score(md);
  const trap = /-->\|[^|]*触发通知[^|]*\|\s*api_notifications/.test(md);
  console.log(path.basename(path.dirname(f)) + '/' + path.basename(f), s.n + '/' + s.total,
    trap ? 'TRAP:notify→configAPI' : '',
    s.hits.filter((h) => !h[1]).map((h) => h[0]).join(',') || 'full');
}
