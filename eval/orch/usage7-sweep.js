#!/usr/bin/env node
'use strict';

/**
 * usage7-sweep.js — dsh 产物的确定性扫尾（用法7+sweep）
 *
 * 输入：/tmp/arch-orch/out/usage7g-<short>/block-diagram.md（dsh + 路径闸门产物，幻觉已为 0）
 * 输出：/tmp/arch-orch/out/usage7s-<short>/block-diagram.md + sweep.json
 *
 * 原则：只做机械修复，绝不新增路径（不会引入幻觉）：
 *   1. 圆柱纠正：[(...)] 仅保留真实数据库/缓存中间件；基类/模型/查询/迁移/驱动/访问层/代码文件 → 矩形
 *   2. 细节节点剪枝：基类/元数据/事件定义/数据模型 等实现细节节点删除
 *   3. 可选组件剪枝：命中 importance.optionalKw 且为叶子（度=1）的非圆柱节点删除
 *   4. 运维剪枝：CI/CD、托管平台、配置样例节点删除；ops 内部边删除；ops→业务边虚线化（健康检查边删除）
 *   5. 环/双向边：<--> 按层秩定向；成对反向边删除「回/返」语义边
 *   6. 子图2：存储为源的查询边翻转；后端→前端的「返回/响应」边翻转并改标签
 *   7. tracker/recorder（浏览器端采集脚本）从 worker 层归位到 frontend 层
 *   8. actor 注入：子图1/子图2 缺外部角色时在顶部注入
 *   9. 孤立节点与空 subgraph 清理（迭代到稳定）
 *
 * 用法：node eval/orch/usage7-sweep.js [short ...]
 */

const fs = require('fs');
const path = require('path');
const {
  buildTree, parseMermaid, parseFlowchart, lintBlockDiagram,
  importanceForensics, findAnchorsV2
} = require('./lib');
const { parseBlockStructure, structureGates, visualGates } = require('./run');
const { scan } = require(path.join(__dirname, '..', '..', 'lib', 'scan'));

const REPOS_ROOT = '/tmp/arch-orch/repos';
const OUT = '/tmp/arch-orch/out';
const ALL = [
  { name: 'changedetection.io', short: 'changedetection' },
  { name: 'listmonk', short: 'listmonk' },
  { name: 'uptime-kuma', short: 'uptime-kuma' },
  { name: 'memos', short: 'memos' },
  { name: 'umami', short: 'umami' },
  { name: 'ntfy', short: 'ntfy' },
  { name: 'vaultwarden', short: 'vaultwarden' },
  { name: 'zigbee2mqtt', short: 'zigbee2mqtt' },
  { name: 'caddy', short: 'caddy' }
];

const RANK = { actor: 0, frontend: 1, api: 2, schedule: 3, worker: 4, monitor: 4, storage: 5, ops: 6 };
const rankOf = (k) => (k in RANK ? RANK[k] : 9);

function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ---------- 层识别（与 run.js structureGates 同口径） ----------
function layerKeyOf(title, id) {
  const m = String(id || '').match(/^L_([a-z]+)$/i);
  if (m && ['frontend', 'api', 'schedule', 'worker', 'storage', 'monitor', 'ops'].includes(m[1].toLowerCase())) return m[1].toLowerCase();
  if (/前端|交互|界面|展示|frontend|\bui\b/i.test(title)) return 'frontend';
  if (/存储|数据|storage|store|persisten/i.test(title)) return 'storage';
  if (/交付|运维|部署|ops|deploy/i.test(title)) return 'ops';
  if (/api|后端|接口|backend/i.test(title)) return 'api';
  if (/调度|队列|schedule|queue|cron/i.test(title)) return 'schedule';
  if (/worker|采集|抓取|异步|处理|process/i.test(title)) return 'worker';
  if (/通知|监控|消息|monitor|notif|messag/i.test(title)) return 'monitor';
  return null;
}

// 子图2（无 L_* subgraph 或 M1-M6）的节点层推断
function inferLayer2(id, n) {
  if (n.shape === '[(') return 'storage';
  if (n.shape === '([' ) return 'actor';
  const h = n.head || '';
  const pid = id.toLowerCase();
  if (/^(actor|user|visitor|browser|brw|customer)/.test(pid) && /用户|访客|浏览器|管理员|运营|访问者/.test(h)) return 'actor';
  // frontend: 前缀型 / 裸 id=http（HTTP 接入）/fileserver/web/app/www/home
  //   + head 含 HTTP 接入/页面/静态文件服务/路由（B0 明确 frontend，特写块2 继承）
  if (
    /^(ui|fe|frontend|page|view|spa|m_fe|tracker|recorder|http|fileserver|files|web|www|home|app|gateway|ingress|entry_web|p_web|serve)$/.test(pid) ||
    /前端|页面|仪表盘|看板|spa|后台界面|浏览器|文件服务|静态文件|HTTP 应用|HTTP 接入|Web 应用|Web\b|入口接入|接入层|应用层|路由层|展示|模板渲染|Server\s*Render|SSR|CSR|fileserver/i.test(h)
  ) return 'frontend';
  if (/^(db|st_|store|cache|redis|mongo|pg|mysql|sqlite|clickhouse)/.test(pid) || /数据库|存储|缓存/.test(h)) return 'storage';
  return 'api';
}

function isActorNode(id, n) {
  if (n.shape === '([' ) return true;
  if (/^(actor|user|visitor|browser|brw|customer)/i.test(id) && /用户|访客|浏览器|管理员|运营|访问者/.test(n.head || '')) return true;
  return false;
}

// ---------- 圆柱判定（与 lib/orch/run.js 1.4 pass 同口径） ----------
// 白名单词（真 DB/中间件）。
// ⚠️ 泛缩写（TLS/MQTT/S3）不能直接放 INFRA_WORDS，否则代码路径（caddytls/mqtt.js/s3client.go）
//   会被误判为基础设施；改为在 head/特征短语级别匹配它们的"基础设施形态"：
//   TLS → Certbot/Let's Encrypt/CA/Certificate/证书；MQTT → broker/消息代理；S3 → 对象存储 + 云词
const INFRA_WORDS = /PostgreSQL|Postgres|MySQL|SQLite|ClickHouse|MongoDB|MariaDB|Redis|Kafka|Elasticsearch|ZooKeeper|Zookeeper|zookeeper|MinIO|Minio|minio|PostGIS|DuckDB|Cassandra|Memcached|RabbitMQ|NATS|etcd|Consul|Vault|LDAP|Samba|NFS|Maria|Certbot|Let's?\s*Encrypt|OpenLDAP|对象存储|S3对象|OSS\s*对象|AWS\s*S3|Azure\s*Blob|GCS|Cloudflare\s*R2|R2\s*存储|SQS|SNS|Kinesis|MQTT\s*(broker|代理|服务器)|MQTT\s*Server|broker/i;
function isInfraHead(h) {
  if (!h) return false;
  // head 含基础设施词 + 不含「访问层/驱动/接口/基类/门面/客户端」语义覆盖层
  if (INFRA_WORDS.test(h)) {
    if (/访问层|驱动|接口|基类|门面|客户端|adapter|wrapper|provider|connector|helper|sdk/i.test(h)) return false;
    return true;
  }
  return false;
}
// 与 head 不同口径：sig = head+path+id+small，判断整体是否描述基础设施节点
function signatureInfra(sig) {
  // 基础白词匹配；另外对 MQTT/S3/TLS 这类极易在代码标识符中出现的缩写，
  // 要求同时出现"自指基础设施形态词"而非只在路径片段里出现
  const s = sig || '';
  if (INFRA_WORDS.test(s)) {
    if (/访问层|驱动|接口|基类|门面|客户端|adapter|wrapper|provider|connector|helper|sdk|caddytls|caddypki|caddyevents|caddyhttp|caddyadmin|caddytls\.DistributedSTEK/i.test(s)) return false;
    return true;
  }
  // S3/对象存储 云对象形态（必须 head 含对象/存储/桶/bucket，避免 s3client.js 命中）
  if (/\b(S3|OSS|R2|GCS)\b/.test(s) && /对象存储|存储桶|bucket|云盘|object\s*storage/i.test(s)) return true;
  // MQTT broker/代理 形态（head 明确 broker/server，避免 mqtt.js/zigbee2mqtt 路径命中）
  if (/MQTT/i.test(s) && /broker|代理|服务器|消息服务|server/i.test(s)) return true;
  // TLS 基础设施（证书/CA/Let's Encrypt/ACME，避免 caddytls 包名）
  if (/TLS|SSL|证书|CA\b|ACME/.test(s) && /颁发|证书|Let'?s\s*Encrypt|Certbot|ACME|Certificate|Authority/i.test(s)) return true;
  return false;
}
function cylinderVerdict(n) {
  if (n.shape !== '[(') return null;
  const h = n.head || '';
  const p = n.path || '';
  const white =
    isInfraHead(h)
    || /\.(db|sqlite|sqlite3)$/i.test(p)
    || /prisma\/schema/i.test(p)
    || (/schema\.sql$/i.test(p) && /仓库|数据库|ClickHouse|Postgre/i.test(h));
  if (white) return 'keep';
  const black =
    /基类|数据模型|元数据|查询|迁移|驱动|访问层|门面|数据访问|SDK|客户端|helper|adapter/i.test(h)
    || /\.(py|js|ts|go|java|rb|php|cs)$/i.test(p)
    || /(^|\/)(base|queries|migrations?|migration|media|driver|sdk|client|adapter|helper)(\/|$)/i.test(p);
  return black ? 'rect' : 'keep';
}

// 细节实现节点（基类/元数据/事件定义/数据模型）
const DETAIL_RE = /基类|元数据|事件定义|类型定义|常量定义|数据模型/;
// 运维必删节点
const OPS_PRUNE_RE = /CI\/CD|流水线|GitHub Actions|Netlify|Vercel|托管部署|工作流|服务配置|配置注入/;
const OPS_PRUNE_PATH = /(^|\/)(netlify\.toml|vercel\.json)$|config\.(toml|ya?ml|json)(\.sample)?$/i;

// ---------- 行级工具 ----------
// 允许行尾带内联声明（B["…"]）或 class 等残余；支持：
//   A -->|"label"| B
//   A["<b>rich head</b><br/><small>path</small>"] -->|"label"| B
//   A -->|"label"| B["rich head"]
// 只取首段 from → arrow → label → to 的裸标识符
// 形状声明：[(..)] / [..] / (..) / {..}（用非捕获组，允许 inner 含任意非对应结束括号字符，再闭合）
const _D = '(?:\\s*(?:\\[\\(|\\(\\[|\\[|\\(|\\{)[^\\]\\)\\}]*[\\]\\)\\}])?';
const EDGE_RE = new RegExp('^(\\s*)([A-Za-z_]\\w*)' + _D + '\\s*(<-->|-->|-\\.->)\\s*\\|([^|]*)\\|\\s*([A-Za-z_]\\w*)' + _D + '\\b');
const EDGE_RE_NOLABEL = new RegExp('^(\\s*)([A-Za-z_]\\w*)' + _D + '\\s*(<-->|-->|-\\.->)\\s*([A-Za-z_]\\w*)' + _D + '\\b');
const DECL_RE = /^\s*([A-Za-z_]\w*)\s*(\[\(|\(\[|\[|\(|\{)/;
const CLASS_RE = /^(\s*)class\s+([A-Za-z_][\w,]*)\s+(\w+)\s*$/;
const SUBGRAPH_RE = /^(\s*)subgraph\s+([A-Za-z_]\w*)\b(.*)$/;
const END_RE = /^\s*end\s*$/;
const STYLE_RE = /^\s*style\s+([A-Za-z_]\w*)\b/;

const stripQ = (s) => s.trim().replace(/^["“”'`]+|["“”'`]+$/g, '');
function parseEdgeLine(line) {
  let m = line.match(EDGE_RE);
  if (m) return { indent: m[1], from: m[2], arrow: m[3], label: stripQ(m[4]), to: m[5] };
  m = line.match(EDGE_RE_NOLABEL);
  if (m) return { indent: m[1], from: m[2], arrow: m[3], label: '', to: m[4] };
  return null;
}

// 构建块内结构信息
function analyze(code) {
  const { nodes, layers } = parseBlockStructure(code);
  const flow = parseFlowchart(code);
  const nodeLayer = new Map();
  const layerById = new Map(); // subgraph id -> layer key
  for (const l of layers) {
    const k = layerKeyOf(l.title, l.id);
    layerById.set(l.id, k);
    for (const id of l.nodes) nodeLayer.set(id, k);
  }
  const deg = new Map();
  for (const e of flow.edges) {
    deg.set(e.from, (deg.get(e.from) || 0) + 1);
    deg.set(e.to, (deg.get(e.to) || 0) + 1);
  }
  return { nodes, layers, nodeLayer, layerById, edges: flow.edges, nodeIds: flow.nodeIds, deg };
}

// 层秩（块2 用推断层）
function rankOfNode(id, info, block2) {
  const n = info.nodes.get(id);
  if (!n) return 9;
  if (block2) return rankOf(inferLayer2(id, n));
  return rankOf(info.nodeLayer.get(id));
}

// 删除节点：声明行 + 引用边 + class 列表
function deleteNodes(lines, targets) {
  const removed = [];
  // subgraph 区间（扁平结构）
  const sgStack = [];
  const ranges = [];
  lines.forEach((line, i) => {
    if (SUBGRAPH_RE.test(line)) {
      const m = line.match(SUBGRAPH_RE);
      sgStack.push({ id: m[2], start: i });
    } else if (END_RE.test(line) && sgStack.length) {
      const sg = sgStack.pop();
      ranges.push({ id: sg.id, start: sg.start, end: i });
    }
  });
  const inSg = (i) => ranges.find((r) => i > r.start && i < r.end);

  const drop = new Set();
  for (const id of targets) {
    // 声明行（subgraph 内行首声明）
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(new RegExp('^\\s*' + escRe(id) + '\\s*[\\[\\(\\{]'));
      if (m && inSg(i)) { drop.add(i); break; }
    }
    removed.push(id);
  }
  // 边行：端点命中即删（块1 边均为独立单行）
  for (let i = 0; i < lines.length; i++) {
    if (drop.has(i)) continue;
    const e = parseEdgeLine(lines[i]);
    if (e && (targets.has(e.from) || targets.has(e.to))) drop.add(i);
  }
  // class 行移除 id
  for (let i = 0; i < lines.length; i++) {
    if (drop.has(i)) continue;
    const m = lines[i].match(CLASS_RE);
    if (m) {
      const ids = m[2].split(',').filter((x) => !targets.has(x));
      if (ids.length === 0) drop.add(i);
      else if (ids.length !== m[2].split(',').length) lines[i] = m[1] + 'class ' + ids.join(',') + ' ' + m[3];
    }
  }
  return lines.filter((_, i) => !drop.has(i));
}

// 删除空 subgraph（无节点声明行）及其 style 行
function removeEmptySubgraphs(lines) {
  const drop = new Set();
  const sgStack = [];
  const ranges = [];
  lines.forEach((line, i) => {
    const m = line.match(SUBGRAPH_RE);
    if (m) sgStack.push({ id: m[2], start: i });
    else if (END_RE.test(line) && sgStack.length) ranges.push({ id: sgStack.pop().id, start: sgStack.length ? 0 : 0, end: i });
  });
  // 重新精确配对
  const stack = [];
  const pairs = [];
  lines.forEach((line, i) => {
    if (SUBGRAPH_RE.test(line)) stack.push({ id: line.match(SUBGRAPH_RE)[2], start: i });
    else if (END_RE.test(line) && stack.length) pairs.push({ ...stack.pop(), end: i });
  });
  for (const r of pairs) {
    const inner = lines.slice(r.start + 1, r.end);
    const hasNode = inner.some((l) => DECL_RE.test(l) && !/^\s*subgraph/.test(l));
    if (!hasNode) {
      for (let i = r.start; i <= r.end; i++) drop.add(i);
      lines.forEach((l, i) => {
        const sm = l.match(STYLE_RE);
        if (sm && sm[1] === r.id) drop.add(i);
      });
    }
  }
  return lines.filter((_, i) => !drop.has(i));
}

// tracker/recorder 归位到前端层（块1）
function relocateFrontendAssets(code, actions) {
  let lines = code.split('\n');
  const info = analyze(code);
  const feLayer = info.layers.find((l) => layerKeyOf(l.title, l.id) === 'frontend');
  if (!feLayer) return code;
  const candidates = [];
  for (const [id, n] of info.nodes) {
    const layer = info.nodeLayer.get(id);
    if (layer === 'frontend') continue;
    const p = n.path || '';
    if (/(^|\/)(tracker|recorder)(\/|$)/i.test(p) || /^(tracker|recorder)$/i.test(id)) candidates.push(id);
  }
  if (!candidates.length) return code;

  // subgraph 行号区间
  const pairs = [];
  const stack = [];
  lines.forEach((line, i) => {
    const m = line.match(SUBGRAPH_RE);
    if (m) stack.push({ id: m[2], start: i });
    else if (END_RE.test(line) && stack.length) pairs.push({ ...stack.pop(), end: i });
  });
  const sgOf = (id) => pairs.find((r) => lines.slice(r.start + 1, r.end).some((l) => new RegExp('^\\s*' + escRe(id) + '\\s*[\\[\\(]').test(l)));
  const feRange = pairs.find((r) => r.id === feLayer.id);
  if (!feRange) return code;

  // class 行：层 -> class 名
  const classOfLayer = new Map();
  for (const l of lines) {
    const m = l.match(CLASS_RE);
    if (m) {
      const first = m[2].split(',')[0];
      const k = info.nodeLayer.get(first);
      if (k && !classOfLayer.has(k)) classOfLayer.set(k, m[3]);
    }
  }
  const feClass = classOfLayer.get('frontend');
  const moveSet = new Set(candidates);

  // 抽出声明行
  const declLines = new Map();
  const drop = new Set();
  for (const id of candidates) {
    const r = sgOf(id);
    if (!r) continue;
    for (let i = r.start + 1; i < r.end; i++) {
      if (new RegExp('^\\s*' + escRe(id) + '\\s*[\\[\\(]').test(lines[i])) {
        declLines.set(id, lines[i].trim());
        drop.add(i);
        actions.push({ type: 'relocate', id, from: r.id, to: feLayer.id });
        break;
      }
    }
  }
  if (!declLines.size) return code;
  lines = lines.filter((_, i) => !drop.has(i));

  // 插入到 frontend subgraph 的 end 前（end 行号因删除而位移，重新定位）
  const feEnd = lines.findIndex((l, i) => i > 0 && END_RE.test(l) &&
    lines.slice(0, i).filter((x) => SUBGRAPH_RE.test(x)).length - lines.slice(0, i).filter((x) => END_RE.test(x)).length === 1 &&
    new RegExp('subgraph\\s+' + escRe(feLayer.id) + '\\b').test(lines.slice(0, i).reverse().find((x) => SUBGRAPH_RE.test(x)) || ''));
  // 简化：直接找 feLayer subgraph 行后第一个配对 end
  const feStart = lines.findIndex((l) => new RegExp('subgraph\\s+' + escRe(feLayer.id) + '\\b').test(l));
  let depth = 0, insertAt = -1;
  for (let i = feStart; i < lines.length; i++) {
    if (SUBGRAPH_RE.test(lines[i])) depth++;
    else if (END_RE.test(lines[i])) { depth--; if (depth === 0) { insertAt = i; break; } }
  }
  if (insertAt < 0) return code;
  const insertText = [...declLines.values()].map((t) => '        ' + t);
  lines.splice(insertAt, 0, ...insertText);

  // class 行维护
  lines = lines.map((l) => {
    const m = l.match(CLASS_RE);
    if (!m) return l;
    let ids = m[2].split(',');
    const movedHere = ids.filter((x) => moveSet.has(x));
    if (!movedHere.length) return l;
    ids = ids.filter((x) => !moveSet.has(x));
    return ids.length ? m[1] + 'class ' + ids.join(',') + ' ' + m[3] : null;
  }).filter(Boolean);
  if (feClass) {
    // 加到 frontend class 行
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(CLASS_RE);
      if (m && m[3] === feClass) {
        const ids = m[2].split(',');
        for (const id of moveSet) if (!ids.includes(id)) ids.push(id);
        lines[i] = m[1] + 'class ' + ids.join(',') + ' ' + m[3];
        break;
      }
    }
  }
  return lines.join('\n');
}

// 块2 class 归位：tracker/recorder 从 worker 色系移到 frontend 色系
function reclassBlock2FrontendAssets(code, actions) {
  const lines = code.split('\n');
  // classDef 行收集可用色系名
  const classDefs = new Set();
  for (const l of lines) {
    const m = l.match(/^\s*classDef\s+(\w+)\b/);
    if (m) classDefs.add(m[1]);
  }
  const feName = [...classDefs].find((n) => /l_frontend|^fe|front/i.test(n));
  if (!feName) return code; // 无前端色系可挂，不动
  const moved = [];
  const out = lines.map((l) => {
    const m = l.match(CLASS_RE);
    if (!m) return l;
    const cls = m[3];
    if (/l_frontend|^fe|front/i.test(cls)) return l; // 已在前端色系
    const ids = m[2].split(',');
    const wrong = ids.filter((x) => /^(tracker|recorder)$/i.test(x));
    if (!wrong.length) return l;
    const rest = ids.filter((x) => !wrong.includes(x));
    moved.push(...wrong);
    return rest.length ? m[1] + 'class ' + rest.join(',') + ' ' + cls : null;
  }).filter(Boolean);
  if (!moved.length) return code;
  // 挂到前端色系 class 行（没有则新建一行）
  const feRowIdx = out.findIndex((l) => {
    const m = l.match(CLASS_RE);
    return m && /l_frontend|^fe|front/i.test(m[3]);
  });
  if (feRowIdx >= 0) {
    const m = out[feRowIdx].match(CLASS_RE);
    const ids = m[2].split(',').concat(moved.filter((x) => !m[2].split(',').includes(x)));
    out[feRowIdx] = m[1] + 'class ' + ids.join(',') + ' ' + m[3];
  } else {
    // 插到最后一个 classDef 行之后
    let lastDef = -1;
    out.forEach((l, i) => { if (/^\s*classDef\b/.test(l)) lastDef = i; });
    out.splice(lastDef + 1, 0, '    class ' + moved.join(',') + ' ' + feName);
  }
  actions.push({ type: 'reclass-fe', ids: moved, cls: feName });
  return out.join('\n');
}

// actor 注入
function injectActor(code, block2, actions) {
  const info = analyze(code);
  const hasActor = [...info.nodes].some(([id, n]) => isActorNode(id, n));
  if (hasActor) return code;
  const lines = code.split('\n');
  const fcIdx = lines.findIndex((l) => /^\s*flowchart\s+/.test(l));
  if (fcIdx < 0) return code;

  let actorId, label, target;
  // 访客侧采集脚本（tracker）存在 → 访客浏览器
  const trackerNode = [...info.nodes].find(([id, n]) =>
    /(^|\/)(tracker|recorder)(\/|$)/i.test(n.path || '') || /^(tracker|recorder)$/i.test(id));
  if (trackerNode && !block2) {
    actorId = 'actor_visitor';
    label = '加载统计脚本';
    target = trackerNode[0];
  } else {
    actorId = 'actor_user';
    // 前端入口节点：页面/路由/仪表盘/看板/后台 优先
    const feNodes = [...info.nodes].filter(([id, n]) => {
      const layer = block2 ? inferLayer2(id, n) : info.nodeLayer.get(id);
      return layer === 'frontend';
    });
    const pref = feNodes.find(([id, n]) => /页面|路由|入口|仪表盘|看板|后台|spa|应用/i.test(n.head || ''));
    target = (pref || feNodes[0] || [...info.nodes][0])[0];
    label = block2 ? '登录 / 查看' : '访问 Web 界面';
  }
  if (!target || info.nodes.has(actorId)) return code;
  const indent = '    ';
  const head = actorId === 'actor_visitor' ? '🌐 访客浏览器' : '🧑 用户';
  const insert = [
    `${indent}${actorId}(["${head}<br/><small>浏览器</small>"])`,
    `${indent}${actorId} -->|"${label}"| ${target}`
  ];
  lines.splice(fcIdx + 1, 0, ...insert);
  actions.push({ type: 'inject-actor', id: actorId, target, label });
  return lines.join('\n');
}

// ---------- 单块扫尾 ----------
function sweepBlock(code, blockIdx, ctx) {
  const actions = [];
  const block2 = blockIdx === 1;
  let text = code;

  // P1 圆柱纠正
  {
    const info = analyze(text);
    const layerOf = (id) => {
      const n = info.nodes.get(id);
      if (!n) return null;
      return block2 ? inferLayer2(id, n) : info.nodeLayer.get(id);
    };
    for (const [id, n] of info.nodes) {
      if (n.shape !== '[(') continue;
      const cv = cylinderVerdict(n);
      // run.js 1.4 pass 兜底：storage 层的圆柱若不是真基础设施 → 改矩形
      // （代码包 filestorage/stek、配置文件 st_cfg、状态缓存 st_state 都会在这里命中）
      const layer = layerOf(id);
      const sig = `${n.head || ''} ${n.path || ''} ${n.small || ''} ${id}`;
      const isTrueInfra = isInfraHead(n.head || '')
        || /\.(db|sqlite|sqlite3)$/i.test(n.path || '')
        || /prisma\/schema/i.test(n.path || '')
        || signatureInfra(sig);
      let need = false;
      if (cv === 'rect') need = true;
      else if (layer === 'storage' && !isTrueInfra) need = true;
      if (need) {
        const re = new RegExp('\\b' + escRe(id) + '\\s*\\[\\(("[\\s\\S]*?")\\)\\]', 'g');
        const before = text;
        text = text.replace(re, id + '[$1]');
        if (text !== before) actions.push({ type: 'cylinder-rect', id, head: n.head });
      }
    }
  }

  // P2 节点剪枝（细节 / 可选叶子 / 运维必删 / 前端登录态叶子）
  {
    const info = analyze(text);
    const targets = new Set();
    const optKw = ctx.optionalKw || [];
    for (const [id, n] of info.nodes) {
      const layer = block2 ? inferLayer2(id, n) : info.nodeLayer.get(id);
      const head = n.head || '';
      const deg = info.deg.get(id) || 0;
      // 细节剪枝只针对矩形实现节点；圆柱（真实数据库/中间件）即使标签含「元数据」
      // （如「元数据库 PostgreSQL」）也必须保留——它是存储主干，不是数据模型类
      if (DETAIL_RE.test(head) && !block2 && n.shape !== '[(') { targets.add(id); actions.push({ type: 'prune-detail', id, head }); continue; }
      if (layer === 'ops' && (OPS_PRUNE_RE.test(head) || OPS_PRUNE_PATH.test(n.path || ''))) {
        targets.add(id); actions.push({ type: 'prune-ops', id, head }); continue;
      }
      // 可选组件叶子（非圆柱基础设施）
      if (deg === 1 && n.shape !== '[(' && !block2) {
        const hay = (head + ' ' + (n.path || '')).toLowerCase();
        if (optKw.some((kw) => new RegExp('(^|[^a-z0-9])' + escRe(kw.toLowerCase()) + '([^a-z0-9]|$)').test(hay))) {
          targets.add(id); actions.push({ type: 'prune-optional-leaf', id, head }); continue;
        }
      }
      // 前端登录态/状态管理叶子
      if (layer === 'frontend' && deg === 1 && /登录态|认证状态/.test(head)) {
        targets.add(id); actions.push({ type: 'prune-fe-leaf', id, head });
      }
    }
    if (targets.size) text = deleteNodes(text.split('\n'), targets).join('\n');
    text = removeEmptySubgraphs(text.split('\n')).join('\n');
  }

  // P3 边规则
  {
    const info = analyze(text);
    const lines = text.split('\n');
    const layerOf = (id) => {
      const n = info.nodes.get(id);
      if (!n) return null;
      return block2 ? inferLayer2(id, n) : info.nodeLayer.get(id);
    };
    // 决策表：key "from=>to" => {op, label?}
    const decisions = new Map();
    const keyOf = (f, t) => f + '=>' + t;

    // 成对反向边
    const pairSeen = new Set();
    for (const e of info.edges) {
      const revKey = e.to + '=>' + e.from;
      const fwdKey = e.from + '=>' + e.to;
      if (pairSeen.has(fwdKey)) continue;
      if (info.edges.some((x) => x.from === e.to && x.to === e.from)) {
        // 外部协议对端（ext_*：MQTT broker/设备网络/推送通道/源站）的双向边是真实协议语义
        // （发布↔订阅投递、控制↔状态上报），两个方向各有独立含义，不是请求/响应回边，禁止折叠
        // （z2m bridge 教训：sweep 误删「订阅命令主题」「上报状态」「推送状态」三条协议边）
        if (/^ext_/.test(e.from) || /^ext_/.test(e.to)) continue;
        pairSeen.add(fwdKey); pairSeen.add(revKey);
        const back = /回传|返回|回调|回执|回流|响应/.test(e.label);
        const fwd = /回传|返回|回调|回执|回流|响应/.test((info.edges.find((x) => x.from === e.to && x.to === e.from) || {}).label || '');
        let victim;
        if (back && !fwd) victim = e;
        else if (fwd && !back) victim = info.edges.find((x) => x.from === e.to && x.to === e.from);
        else {
          // 按层秩：回边（源秩>目标秩）删
          const r1 = rankOfNode(e.from, info, block2), r2 = rankOfNode(e.to, info, block2);
          victim = r1 > r2 ? e : info.edges.find((x) => x.from === e.to && x.to === e.from);
        }
        if (victim) decisions.set(keyOf(victim.from, victim.to), { op: 'drop', reason: 'reverse-pair: ' + victim.label });
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const e = parseEdgeLine(lines[i]);
      if (!e) continue;
      if (!info.nodes.has(e.from) || !info.nodes.has(e.to)) { decisions.set(keyOf(e.from, e.to), { op: 'drop', reason: 'dangling' }); continue; }
      const lf = layerOf(e.from), lt = layerOf(e.to);
      const decKey = keyOf(e.from, e.to);
      if (decisions.has(decKey)) continue;

      // <--> 定向
      if (e.arrow === '<-->') {
        const rf = rankOf(lf), rt = rankOf(lt);
        decisions.set(decKey, rf > rt ? { op: 'flip' } : { op: 'orient' });
        continue;
      }
      if (!block2) {
        // ops 内部边删；ops→业务：健康检查删，其余虚线
        if (lf === 'ops' && lt === 'ops') { decisions.set(decKey, { op: 'drop', reason: 'ops-internal' }); continue; }
        if (lf === 'ops' && lt && lt !== 'ops') {
          if (/健康检查|healthcheck/i.test(e.label)) decisions.set(decKey, { op: 'drop', reason: 'ops-healthcheck' });
          else decisions.set(decKey, { op: 'dash', reason: 'ops-deploy' });
          continue;
        }
      } else {
        // 子图2：存储为源的查询/读取边 → 翻转
        if (lf === 'storage' && lt !== 'storage' && lt !== 'actor' && /查询|读取|聚合|统计|加载/.test(e.label)) {
          decisions.set(decKey, { op: 'flip', reason: 'storage-src' });
          continue;
        }
        // 后端→前端的「返回/响应」边 → 翻转 + 标签改请求
        if (/返回|响应/.test(e.label) && rankOf(lt) < rankOf(lf) && rankOf(lt) <= 1) {
          decisions.set(decKey, { op: 'flip', label: e.label.replace(/返回|响应/g, '请求'), reason: 'response-edge' });
          continue;
        }
      }
    }

    // 应用决策
    const out = [];
    for (const line of lines) {
      const e = parseEdgeLine(line);
      if (!e) { out.push(line); continue; }
      const dec = decisions.get(keyOf(e.from, e.to));
      if (!dec) { out.push(line); continue; }
      if (dec.op === 'drop') { actions.push({ type: 'edge-drop', edge: e.from + '->' + e.to, reason: dec.reason }); continue; }
      const label = dec.label !== undefined ? dec.label : e.label;
      const arrow = dec.op === 'dash' ? '-.->' : '-->';
      if (dec.op === 'flip') {
        out.push(`${e.indent}${e.to} ${arrow}${label ? '|"' + label + '"| ' : ' '}${e.from}`);
        actions.push({ type: 'edge-flip', edge: e.from + '->' + e.to, reason: dec.reason, newLabel: label });
      } else {
        out.push(`${e.indent}${e.from} ${arrow}${label ? '|"' + label + '"| ' : ' '}${e.to}`);
        if (dec.op === 'dash') actions.push({ type: 'edge-dash', edge: e.from + '->' + e.to });
      }
    }
    text = out.join('\n');
  }

  // P3b realtime 误标改指：节点声称 SSE/实时推送但路径不是 realtime 锚点时，
  // 把 <small> 路径改指到内容核验锚点（listmonk 教训：SSE 叙事对、路径指到进程内事件总线，
  // 真实端点 cmd/events.go 由 findAnchorsV2 内容扫描给出）。只换成已验证真实路径，不新增节点。
  {
    const info = analyze(text);
    const rtAnchors = ctx.realtimeAnchors || [];
    // 严格匹配（不做 basename 兜底）：internal/events/events.go 与 cmd/events.go 同名不同物，
    // 前者是进程内事件总线、后者才是 SSE 端点——basename 相同必须改指到内容核验锚点
    const pathMatchLoose = (np, ap) => {
      const n = String(np).replace(/\/$/, ''), a = String(ap).replace(/\/$/, '');
      return n === a || n.endsWith('/' + a) || a.endsWith('/' + n);
    };
    const strongRtFile = /(^|[/_-])(sse|ws|websocket|web-socket|socket)[\w.-]*\.(py|js|ts|go|java|rb|php|cs|rs)$/i;
    const repaths = [];
    for (const [id, n] of info.nodes) {
      if (!n.path) continue;
      if (/实时推送|实时刷新|实时监控|实时更新|实时日志|实时事件|realtime|websocket|web[\s-]?socket|\bSSE\b/i.test(n.head || '')) {
        const ok = rtAnchors.some((a) => pathMatchLoose(n.path, a)) || strongRtFile.test(n.path);
        if (!ok && rtAnchors.length) repaths.push({ id, from: n.path, to: rtAnchors[0] });
      }
    }
    for (const r of repaths) {
      const re = new RegExp('(\\b' + escRe(r.id) + '\\s*\\[[^\\]]*<small>)' + escRe(r.from) + '(</small>)', 'g');
      const before = text;
      text = text.replace(re, '$1' + r.to + '$2');
      if (text !== before) actions.push({ type: 'repath-realtime', id: r.id, from: r.from, to: r.to });
    }
  }

  // P4 tracker/recorder 归位（块1）
  if (!block2) text = relocateFrontendAssets(text, actions);

  // P4b 块2 class 归位：tracker/recorder 是浏览器端采集脚本（前端资产），
  // dsh 常把它们 class 到 worker 绿色系；块2 无 subgraph，class 是唯一层信号，必须改色
  if (block2) text = reclassBlock2FrontendAssets(text, actions);

  // P5 actor 注入
  text = injectActor(text, block2, actions);

  // P6 孤立节点迭代清理（块1）+ 空 subgraph
  if (!block2) {
    for (let round = 0; round < 3; round++) {
      const info = analyze(text);
      const iso = [...info.nodeIds].filter((id) => {
        const n = info.nodes.get(id);
        if (!n || isActorNode(id, n)) return false;
        return !(info.deg.get(id) > 0);
      });
      if (!iso.length) break;
      actions.push({ type: 'prune-isolated', ids: iso });
      text = deleteNodes(text.split('\n'), new Set(iso)).join('\n');
      text = removeEmptySubgraphs(text.split('\n')).join('\n');
    }
  }

  // P7 重复边去重（独立单行）
  {
    const seen = new Set();
    const out = [];
    for (const line of text.split('\n')) {
      const e = parseEdgeLine(line);
      if (e) {
        const k = e.from + '>' + e.to + '>' + (e.arrow === '-.->');
        if (seen.has(k)) { actions.push({ type: 'edge-dedup', edge: e.from + '->' + e.to }); continue; }
        seen.add(k);
      }
      out.push(line);
    }
    text = out.join('\n');
  }

  // P8 层秩逆流 实线边 翻转（run.js 1.5 pass 同口径）：
  //   from-layer 层秩 > to-layer 层秩 的实线边 → 结构闸门算逆流（sMed）。
  //   但排除：推送/投递/SSE/WebSocket/通知 这类真实下行响应语义的边，
  //   也排除 虚线（-.->，运维/通知 语义）。其余「渲染/下发/托管/部署/配置」
  //   这类 FE 请求 API 获得页面/资源的关系，正确方向应是 FE→API，翻转箭头。
  {
    const info = analyze(text);
    const RANK = { frontend: 1, api: 2, schedule: 3, worker: 3, monitor: 4, storage: 5, ops: 6, actor: 0 };
    const layerOf = (id) => {
      const n = info.nodes.get(id);
      if (!n) return null;
      return block2 ? inferLayer2(id, n) : info.nodeLayer.get(id);
    };
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const e = parseEdgeLine(lines[i]);
      if (!e) continue;
      if (e.arrow !== '-->') continue; // 只翻实线
      const from = e.from, to = e.to, label = e.label || '';
      const fr = RANK[layerOf(from) || ''] || 0;
      const tr = RANK[layerOf(to) || ''] || 0;
      if (fr === 0 || tr === 0) continue;
      if (!(fr > tr)) continue; // 不是逆流跳过
      // actor/ops 层（rank=0/6）不参与：actor→FE/API 正常，ops→任何层是部署
      if (layerOf(from) === 'ops' || layerOf(to) === 'ops') continue;
      if (layerOf(from) === 'actor' || layerOf(to) === 'actor') continue;
      // 真实下行语义的边（推送/实时/通知/响应）不翻
      //  ⚠️ 「下发」是歧义词："配置下发/热配置下发"是 FE→API 请求方向（应翻），
      //    但 "Web Push 下发/消息下发/邮件下发"是真实下行（不应翻）。故只在组合词中排除。
      const PUSH_RE = /推送|通知|上报|投递|SSE|WebSocket|事件|触发|stream\b|push\b|emit\b|广播|消息|回传|响应|callback|回调|回执|实时|Web\s*Push|WebPush|Mobile|移动端|Mail|邮件|短信|语音|附件|下载|WebHook|Signaling|PostMessage|Push\s*下发|消息\s*下发|告警\s*下发|事件\s*下发|指令下发|控制\s*下发/i;
      if (PUSH_RE.test(label)) continue;
      // storage/worker → FE 的数据读取边：若不含"请求"可视为"存储层读文件/资源返回 FE"，不翻
      // worker_push→fe_sw（Web Push）已被 PUSH_RE 排除，放心；
      // WS→FE_VAULT（WebSocket 实时推送）被 PUSH_RE 排除；
      // 仅翻"API→FE"的页面/资源关系（页面渲染/静态资源下发/托管 Web 应用）
      if (!/渲染|下发|托管|部署|配置|注册|启动|加载|挂载|适配|装配|热加载|reload|静态资源|页面|前端界面|界面渲染|serve|serving|暴露|返回页面|返回静态|提供界面|提供页面/i.test(label)) {
        // API→FE 且无标签 → 也翻（空标签通常是错误方向的默认边）
        if (label.length > 0) continue;
        if (!(layerOf(from) === 'api' && layerOf(to) === 'frontend')) continue;
      }
      lines[i] = e.indent + to + ' -->|' + label + '| ' + from;
      actions.push({ type: 'edge-layer-back-flip', edge: from + '(' + layerOf(from) + ')→' + to + '(' + layerOf(to) + ')', label: label || '(空)', reason: '高秩→低秩实线应为 FE 请求方向' });
    }
    text = lines.join('\n');
  }

  return { code: text, actions };
}

// ---------- 主流程 ----------
function sweepOne(spec) {
  const srcDir = path.join(OUT, 'usage7g-' + spec.short);
  const dstDir = path.join(OUT, 'usage7s-' + spec.short);
  const srcMd = path.join(srcDir, 'block-diagram.md');
  if (!fs.existsSync(srcMd)) throw new Error('missing ' + srcMd);
  fs.mkdirSync(dstDir, { recursive: true });

  const md = fs.readFileSync(srcMd, 'utf8');
  const root = path.join(REPOS_ROOT, spec.name);
  const tree = buildTree(root);
  const inv = scan(root);
  const importance = importanceForensics(root, tree, inv.entrypoints);
  const anchors = findAnchorsV2(tree, importance);
  const ctx = {
    optionalKw: importance.optionalKw || [],
    realtimeAnchors: anchors.filter((a) => a.role === 'realtime').map((a) => a.path)
  };

  // 逐块替换（全局回调，按 fence 出现顺序对应 block 0/1，避免每次都替换第一块）
  const blocks = parseMermaid(md);
  const allActions = [];
  let bi = 0;
  const out = md.replace(/```mermaid\s*\n[\s\S]*?```/g, (fence) => {
    const code = blocks[bi] || '';
    const res = sweepBlock(code, bi, ctx);
    allActions.push({ block: bi, actions: res.actions });
    const next = '```mermaid\n' + res.code.replace(/\s+$/, '') + '\n```';
    bi++;
    return next;
  });

  // 机检
  const lint = lintBlockDiagram(out, tree);
  const sg = structureGates(out, anchors, importance, [spec.name, spec.short]);
  const vg = visualGates(out);
  const blocks2 = parseMermaid(out);
  const pf0 = parseFlowchart(blocks2[0] || '');
  const pf1 = parseFlowchart(blocks2[1] || '');

  const report = {
    repo: spec.name,
    optionalKw: ctx.optionalKw,
    actions: allActions,
    block1: { nodes: pf0.nodeIds.length, edges: pf0.edges.length },
    block2: { nodes: pf1.nodeIds.length, edges: pf1.edges.length },
    lint: { hallu: lint.metrics.幻觉路径数, issues: lint.issues, metrics: lint.metrics },
    structureGates: {
      high: sg.filter((i) => i.severity === 'high').map((i) => i.kind + ': ' + i.issue),
      medium: sg.filter((i) => i.severity === 'medium').map((i) => i.kind + ': ' + i.issue)
    },
    visualGates: vg.slice(0, 8).map((i) => i.msg || i.issue || String(i))
  };

  fs.writeFileSync(path.join(dstDir, 'block-diagram.md'), out);
  fs.writeFileSync(path.join(dstDir, 'sweep.json'), JSON.stringify(report, null, 2));
  return report;
}

function main() {
  const want = process.argv.slice(2);
  const list = want.length
    ? ALL.filter((s) => want.includes(s.name) || want.includes(s.short))
    : ALL;
  const reports = list.map((s) => {
    const r = sweepOne(s);
    console.log('\n===== usage7s ' + s.short + ' =====');
    console.log('块1 节点=' + r.block1.nodes + ' 边=' + r.block1.edges + ' | 块2 节点=' + r.block2.nodes + ' 边=' + r.block2.edges);
    console.log('幻觉=' + r.lint.hallu + ' | structureGates high=' + r.structureGates.high.length + ' medium=' + r.structureGates.medium.length);
    for (const a of r.actions) for (const x of a.actions) console.log('  [' + a.block + '] ' + x.type + ' ' + (x.id || x.edge || '') + ' ' + (x.head || x.reason || x.label || '').slice(0, 60));
    if (r.lint.issues.length) console.log('  lint issues: ' + r.lint.issues.slice(0, 5).join(' | '));
    for (const h of r.structureGates.high.slice(0, 6)) console.log('  [HIGH] ' + h.slice(0, 140));
    for (const m of r.structureGates.medium.slice(0, 6)) console.log('  [MED] ' + m.slice(0, 140));
    return r;
  });
  console.log('\n===== SUMMARY =====');
  for (const r of reports) {
    console.log(r.repo.padEnd(20), 'nodes=' + r.block1.nodes, 'hallu=' + r.lint.hallu,
      'sg:H' + r.structureGates.high.length + '/M' + r.structureGates.medium.length,
      'actions=' + r.actions.reduce((n, a) => n + a.actions.length, 0));
  }
}

if (require.main === module) main();
module.exports = { sweepBlock, sweepOne };
