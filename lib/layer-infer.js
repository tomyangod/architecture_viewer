'use strict';

/**
 * Multi-signal architectural layer inference.
 *
 * Layer vocabulary (must stay in sync with guessLayer in extract-graph.js):
 *   component | controller | service | domain | storage | dto | config | util
 *
 * Signals, in merge order:
 *   1. user config (.av/layers.json)          — explicit, always wins
 *   2. import semantics (frameworks/libs)     — high confidence beats dir name
 *   3. directory / file-name patterns (guessLayer)
 *   4. import semantics (medium confidence)   — only fills dir-name gaps
 *   5. structural position (fan-in/fan-out)   — low-confidence last resort
 *
 * Every result carries `signal` (why) and `confidence` (high|medium|low)
 * so reports and .av/layers.suggested.json can show the reasoning.
 */

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

/**
 * Import signature rules. First match per import wins — order matters:
 * put specific cases (pydantic_settings, .Entity, @nestjs names) first.
 * match(spec, names, lang, imp) — spec is lowercased module path/FQN;
 * names are lowercased imported symbol names (from-import / import {x}).
 */
const RULES = [
  // ---------- config (before pydantic generic) ----------
  { layer: 'config', confidence: 'medium', evidence: 'pydantic-settings',
    match: (s) => /^pydantic_settings/.test(s) },
  { layer: 'config', confidence: 'medium', evidence: 'dotenv',
    match: (s) => /^dotenv/.test(s) },
  { layer: 'config', confidence: 'medium', evidence: 'configparser',
    match: (s) => /^configparser$/.test(s) },
  { layer: 'config', confidence: 'medium', evidence: 'django.conf',
    match: (s) => /^django\.conf/.test(s) },
  { layer: 'config', confidence: 'medium', evidence: 'viper',
    match: (s) => /spf13\/viper/.test(s) },
  { layer: 'config', confidence: 'medium', evidence: 'spring-configuration',
    match: (s) => /org\.springframework\.context\.annotation\.configuration$/.test(s) ||
                  /org\.springframework\.boot\.context\.properties/.test(s) },
  { layer: 'config', confidence: 'low', evidence: 'spring-value',
    match: (s) => /org\.springframework\.beans\.factory\.annotation\.value$/.test(s) },

  // ---------- storage: ORMs / drivers (high) ----------
  { layer: 'storage', confidence: 'high', evidence: 'sqlalchemy',
    match: (s) => /^sqlalchemy\b/.test(s) },
  { layer: 'storage', confidence: 'high', evidence: 'python-db-driver',
    match: (s) => /^(pymysql|psycopg2|aiomysql|asyncpg|pymongo|mongoengine|mysql\.connector)\b/.test(s) },
  { layer: 'storage', confidence: 'high', evidence: 'node-orm',
    match: (s) => /^(mongoose|prisma|@prisma\/client|sequelize|typeorm|knex|kysely|drizzle-orm|better-sqlite3|mongodb)(\/|$)/.test(s) ||
                  /^pg$/.test(s) },
  { layer: 'storage', confidence: 'high', evidence: 'sqlite',
    match: (s) => /^sqlite3$/.test(s) },
  { layer: 'storage', confidence: 'medium', evidence: 'redis-client',
    match: (s) => /^(ioredis|redis)(\/|$)/.test(s) || /go-redis/.test(s) },
  { layer: 'storage', confidence: 'high', evidence: 'go-db',
    match: (s) => /^gorm\.io/.test(s) || /^database\/sql$/.test(s) ||
                  /go-sql-driver/.test(s) || /jackc\/pgx/.test(s) ||
                  /go\.mongodb\.org\/mongo-driver/.test(s) },
  { layer: 'storage', confidence: 'high', evidence: 'spring-repository',
    match: (s) => /org\.springframework\.stereotype\.repository$/.test(s) ||
                  /org\.springframework\.data\./.test(s) },
  { layer: 'storage', confidence: 'high', evidence: 'java-persistence',
    match: (s) => /org\.(hibernate|mybatis|jooq|jdbi)\b/.test(s) ||
                  /com\.mongodb\./.test(s) ||
                  /software\.amazon\.awssdk\.services\.dynamodb/.test(s) ||
                  /(jakarta|javax)\.persistence\.(entitymanager|persistencecontext|entitytransaction)$/.test(s) },
  { layer: 'storage', confidence: 'medium', evidence: 'django-orm',
    match: (s) => /^django\.db\b/.test(s) },

  // ---------- domain: entity annotations (high) ----------
  { layer: 'domain', confidence: 'high', evidence: 'jpa-entity',
    match: (s) => /(jakarta|javax)\.persistence\.entity$/.test(s) },
  { layer: 'domain', confidence: 'medium', evidence: 'jpa-package',
    match: (s) => /^(jakarta|javax)\.persistence$/.test(s) },

  // ---------- controller: web routing (high) ----------
  { layer: 'controller', confidence: 'high', evidence: 'python-web-framework',
    match: (s) => /^(flask|fastapi|starlette|sanic)(\/|\.|$)/.test(s) ||
                  /^aiohttp\.web\b/.test(s) ||
                  /^django\.(urls|views)\b/.test(s) },
  { layer: 'controller', confidence: 'medium', evidence: 'python-web-weak',
    match: (s) => /^django\.http\b/.test(s) || /^(tornado|django)(\/|\.|$)/.test(s) },
  { layer: 'controller', confidence: 'high', evidence: 'nestjs-controller',
    match: (s, names) => /^@nestjs\/common/.test(s) && names.includes('controller') },
  { layer: 'service', confidence: 'medium', evidence: 'nestjs-injectable',
    match: (s, names) => /^@nestjs\/common/.test(s) && names.includes('injectable') },
  { layer: 'controller', confidence: 'high', evidence: 'node-web-framework',
    match: (s) => /^(express|koa|fastify)(\/|$)/.test(s) || /^@hapi\//.test(s) },
  { layer: 'controller', confidence: 'high', evidence: 'go-web-framework',
    match: (s) => /gin-gonic\/gin/.test(s) || /labstack\/echo/.test(s) ||
                  /gofiber\/fiber/.test(s) || /go-chi\/chi/.test(s) ||
                  /gorilla\/mux/.test(s) },
  { layer: 'controller', confidence: 'medium', evidence: 'go-net-http',
    match: (s) => /^net\/http$/.test(s) },
  { layer: 'controller', confidence: 'high', evidence: 'spring-controller',
    match: (s) => /org\.springframework\.stereotype\.(rest)?controller$/.test(s) ||
                  /org\.springframework\.web\.bind/.test(s) ||
                  /^(jakarta|javax)\.ws\.rs\./.test(s) },
  { layer: 'controller', confidence: 'medium', evidence: 'spring-web',
    match: (s) => /org\.springframework\.web\./.test(s) },

  // ---------- service ----------
  { layer: 'service', confidence: 'high', evidence: 'spring-service',
    match: (s) => /org\.springframework\.stereotype\.service$/.test(s) },
  { layer: 'service', confidence: 'medium', evidence: 'celery',
    match: (s) => /^celery\b/.test(s) },

  // ---------- dto / schema ----------
  { layer: 'dto', confidence: 'medium', evidence: 'pydantic',
    match: (s) => /^pydantic(\/|\.|$)/.test(s) },
  { layer: 'dto', confidence: 'medium', evidence: 'node-schema',
    match: (s) => /^(zod|class-validator|class-transformer)(\/|$)/.test(s) },
  { layer: 'dto', confidence: 'medium', evidence: 'bean-validation',
    match: (s) => /^(jakarta|javax)\.validation\.constraints\./.test(s) }
];

/**
 * Signal 2: infer layer from what a file actually imports.
 * @param {Array<{specifier:string, names?:string[]}>} imports
 * @returns {{layer:string, confidence:'high'|'medium', signal:string}|null}
 */
function inferLayerByImports(imports) {
  const votes = [];
  for (const imp of imports || []) {
    const spec = String(imp.specifier || '').toLowerCase().trim();
    if (!spec || spec.startsWith('.') || spec.startsWith('/')) continue;
    const names = (imp.names || []).map((n) => String(n).toLowerCase());
    for (const rule of RULES) {
      if (rule.match(spec, names, imp)) {
        votes.push({ layer: rule.layer, confidence: rule.confidence, evidence: rule.evidence });
        break;
      }
    }
  }
  if (votes.length === 0) return null;
  for (const conf of ['high', 'medium']) {
    const group = votes.filter((v) => v.confidence === conf);
    if (group.length === 0) continue;
    const counts = {};
    for (const v of group) counts[v.layer] = (counts[v.layer] || 0) + 1;
    let best = null;
    for (const v of group) {
      if (!best || counts[v.layer] > counts[best.layer]) best = v;
    }
    return { layer: best.layer, confidence: conf, signal: `import:${best.evidence}` };
  }
  return null;
}

/**
 * Signal 4: infer layer from graph position (only fills remaining gaps).
 * High fan-in + low fan-out = core depended-on domain;
 * high fan-out + zero fan-in = entry/orchestration controller.
 * @returns {{layer:string, confidence:'low', signal:string}|null}
 */
function inferLayerByStructure(fanIn, fanOut) {
  if (fanIn >= 3 && fanOut <= 1) {
    return { layer: 'domain', confidence: 'low', signal: 'structure:high-fan-in' };
  }
  if (fanOut >= 5 && fanIn === 0) {
    return { layer: 'controller', confidence: 'low', signal: 'structure:high-fan-out' };
  }
  return null;
}

/**
 * Signal 1 (user config): match any path segment against .av/layers.json keys.
 * @returns {{layer:string, confidence:'high', signal:string}|null}
 */
function matchUserLayer(filePath, userLayers) {
  if (!userLayers || typeof userLayers !== 'object') return null;
  const lookup = {};
  for (const [k, v] of Object.entries(userLayers)) {
    if (typeof v === 'string' && v) lookup[String(k).toLowerCase()] = v;
  }
  for (const seg of String(filePath).toLowerCase().split('/')) {
    if (lookup[seg]) return { layer: lookup[seg], confidence: 'high', signal: 'config:.av/layers.json' };
  }
  return null;
}

/**
 * Merge signals for one file (structure signal applied later by the caller
 * once edges exist).
 * @param {{filePath:string, imports?:Array, userLayers?:Object, dirLayer?:string|null}} args
 * @returns {{layer:string|null, confidence:string, signal:string, conflict?:{dirLayer:string}}|null}
 */
function resolveLayer({ filePath, imports, userLayers, dirLayer }) {
  const user = matchUserLayer(filePath, userLayers);
  if (user) return user;

  const imp = inferLayerByImports(imports);
  const dir = dirLayer
    ? { layer: dirLayer, confidence: 'high', signal: 'dir-name' }
    : null;

  if (imp && imp.confidence === 'high') {
    if (dir && dir.layer !== imp.layer) {
      return { ...imp, conflict: { dirLayer: dir.layer } };
    }
    return imp;
  }
  if (dir) return dir;
  if (imp) return imp; // medium-confidence import fills dir-name gap
  return null;
}

/**
 * Aggregate per-file layer signals into per-directory suggestions
 * for .av/layers.suggested.json.
 * @param {Array<{file:string, layer:string|null, confidence?:string, signal?:string, conflict?:Object}>} fileSignals
 * @returns {Object} dir -> { layer, confidence, signal, files, conflictingFiles }
 */
function aggregateDirectorySignals(fileSignals) {
  const byDir = new Map();
  for (const f of fileSignals) {
    const dir = f.file.includes('/') ? f.file.slice(0, f.file.lastIndexOf('/')) : '.';
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(f);
  }
  const result = {};
  for (const [dir, files] of byDir) {
    const layered = files.filter((f) => f.layer);
    if (layered.length === 0) continue;
    const counts = {};
    for (const f of layered) counts[f.layer] = (counts[f.layer] || 0) + 1;
    let winner = null;
    for (const f of layered) {
      if (!winner || counts[f.layer] > counts[winner.layer]) winner = f;
    }
    let confidence = winner.confidence || 'low';
    for (const f of layered) {
      if (f.layer === winner.layer && CONFIDENCE_RANK[f.confidence] < CONFIDENCE_RANK[confidence]) {
        confidence = f.confidence;
      }
    }
    const conflictingFiles = files
      .filter((f) => f.layer && f.layer !== winner.layer)
      .map((f) => ({ file: f.file, layer: f.layer, signal: f.signal }));
    const signalConflicts = files
      .filter((f) => f.conflict)
      .map((f) => ({ file: f.file, layer: f.layer, dirLayer: f.conflict.dirLayer, signal: f.signal }));
    result[dir] = {
      layer: winner.layer,
      confidence,
      signal: winner.signal,
      files: files.length,
      ...(conflictingFiles.length > 0 ? { conflictingFiles } : {}),
      ...(signalConflicts.length > 0 ? { signalConflicts } : {})
    };
  }
  return result;
}

module.exports = {
  inferLayerByImports,
  inferLayerByStructure,
  matchUserLayer,
  resolveLayer,
  aggregateDirectorySignals,
  RULES
};
