'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DIAGRAM_FILES } = require('../../lib/kit');

const DATA_ROOT = path.join(__dirname, '..', '..', '.data', 'web-projects');

function ensureRoot() {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  return DATA_ROOT;
}

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function projectDir(id) {
  return path.join(ensureRoot(), id);
}

function writeProject(meta, diagrams) {
  const id = meta.id || newId();
  const dir = projectDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    id,
    title: meta.title || 'Untitled architecture',
    source: meta.source || 'unknown',
    createdAt: new Date().toISOString(),
    fingerprint: meta.fingerprint || null,
    protocolOk: meta.protocolOk !== false,
    driftOk: meta.driftOk !== false,
    errors: meta.errors || [],
    warnings: meta.warnings || [],
    driftMissing: meta.driftMissing || [],
    engine: meta.engine || 'skeleton',
    fallback: !!meta.fallback,
    generateReason: meta.generateReason || null
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(record, null, 2));
  for (const name of DIAGRAM_FILES) {
    const body = diagrams[name];
    if (typeof body === 'string') {
      fs.writeFileSync(path.join(dir, name), body.endsWith('\n') ? body : body + '\n');
    }
  }
  return record;
}

function readProject(id) {
  const dir = projectDir(id);
  const metaPath = path.join(dir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const diagrams = {};
  for (const name of DIAGRAM_FILES) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) diagrams[name] = fs.readFileSync(p, 'utf8');
  }
  return { meta, diagrams, dir };
}

function listProjects(limit) {
  ensureRoot();
  const ids = fs.readdirSync(DATA_ROOT).filter((name) => {
    return fs.existsSync(path.join(DATA_ROOT, name, 'meta.json'));
  });
  return ids
    .map((id) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(DATA_ROOT, id, 'meta.json'), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit || 20);
}

module.exports = {
  DATA_ROOT,
  writeProject,
  readProject,
  listProjects,
  projectDir,
  DIAGRAM_FILES
};
