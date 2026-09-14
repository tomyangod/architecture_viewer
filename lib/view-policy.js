'use strict';

/**
 * Default delivery is not six diagrams.
 * Frozen: do not add more default views. Compat generators stay callable
 * via --compat-six-views / --views; they are not a quality promise.
 *
 * AV sells traceable structure change. Archify (after confirm) tells the story.
 */

const { spawnSync } = require('child_process');
const { DIAGRAM_FILES } = require('./kit');

const VIEW_ALIASES = {
  block: 'block-diagram.md',
  'block-diagram': 'block-diagram.md',
  'block-diagram.md': 'block-diagram.md',
  class: 'class-diagram.md',
  'class-diagram': 'class-diagram.md',
  'class-diagram.md': 'class-diagram.md',
  context: 'c4-context.md',
  'c4-context': 'c4-context.md',
  'c4-context.md': 'c4-context.md',
  container: 'c4-container.md',
  'c4-container': 'c4-container.md',
  'c4-container.md': 'c4-container.md',
  component: 'c4-component.md',
  'c4-component': 'c4-component.md',
  'c4-component.md': 'c4-component.md',
  deployment: 'deployment-ops.md',
  deploy: 'deployment-ops.md',
  ops: 'deployment-ops.md',
  'deployment-ops': 'deployment-ops.md',
  'deployment-ops.md': 'deployment-ops.md'
};

const VIEW_ROLES = {
  'block-diagram.md': { role: 'default', reason: 'static module overview; not a runtime topology' },
  'class-diagram.md': { role: 'on-demand', reason: 'local class neighborhood of this change; full-repo class diagrams are usually unreadable' },
  'c4-context.md': { role: 'confirm', reason: 'users and system boundary cannot be inferred from directories' },
  'c4-container.md': { role: 'compat', reason: 'source modules are not processes or containers' },
  'c4-component.md': { role: 'compat', reason: 'overlaps block/class; easy to duplicate' },
  'deployment-ops.md': { role: 'evidence', reason: 'omit unless launch or orchestration evidence exists' }
};

const DEFAULT_DIAGRAM_FILES = ['block-diagram.md'];
const COMPAT_DIAGRAM_FILES = DIAGRAM_FILES.slice();
const DEFAULT_SESSION_RENDERER = 'builtin';

function parseViewList(raw) {
  if (raw == null || raw === false) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => parseViewList(item));
  }
  const text = String(raw).trim();
  if (!text) return [];
  if (text === 'compat' || text === 'six' || text === 'compat-six') return COMPAT_DIAGRAM_FILES.slice();
  const out = [];
  const seen = new Set();
  for (const token of text.split(/[,\s]+/)) {
    const file = VIEW_ALIASES[token] || VIEW_ALIASES[token.toLowerCase()];
    if (!file) {
      const err = new Error('Unknown view "' + token + '". Use block, class, c4-context, c4-container, c4-component, deployment, or --compat-six-views.');
      err.code = 'UNKNOWN_VIEW';
      throw err;
    }
    if (!seen.has(file)) {
      seen.add(file);
      out.push(file);
    }
  }
  return out;
}

function gitChangedFiles(repoRoot) {
  if (!repoRoot) return [];
  try {
    const r = spawnSync('git', ['diff', '--name-only', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 4000
    });
    if (r.error || r.status !== 0) return [];
    return String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function hasDeploymentEvidence(inv) {
  if (!inv) return false;
  const deploy = inv.deploy || [];
  if (deploy.some((d) => /dockerfile|^k8s\/|^deploy\//i.test(String(d)))) return true;
  if ((inv.services || []).length) return true;
  if ((inv.modules || []).some((m) => m.operational || m.layer === 'ops' || m.kind === 'ops')) return true;
  return false;
}

function resolveFocusFiles(opts = {}) {
  if (Array.isArray(opts.focusFiles) && opts.focusFiles.length) {
    return opts.focusFiles.map((f) => String(f).replace(/\\/g, '/')).filter(Boolean);
  }
  if (typeof opts.focus === 'string' && opts.focus.trim()) {
    return opts.focus.split(/[,\s]+/).map((f) => f.replace(/\\/g, '/')).filter(Boolean);
  }
  return gitChangedFiles(opts.repoRoot);
}

function filterClassesForFocus(inv, focusFiles) {
  if (!inv) return inv;
  if (!focusFiles || !focusFiles.length) return inv;
  const norm = (p) => String(p || '').replace(/\\/g, '/');
  const focus = focusFiles.map(norm);
  const hit = (file) => {
    const f = norm(file);
    if (!f) return false;
    return focus.some((p) => f === p || f.endsWith('/' + p) || p.endsWith('/' + f) || f.endsWith(p));
  };
  const seed = (inv.classes || []).filter((c) => hit(c.file));
  if (!seed.length) {
    return Object.assign({}, inv, { classes: [], classRelationships: [] });
  }
  const ids = new Set(seed.map((c) => c.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of inv.classRelationships || []) {
      if (ids.has(e.from) && !ids.has(e.to)) {
        ids.add(e.to);
        grew = true;
      } else if (ids.has(e.to) && !ids.has(e.from)) {
        ids.add(e.from);
        grew = true;
      }
    }
  }
  return Object.assign({}, inv, {
    classes: (inv.classes || []).filter((c) => ids.has(c.id)),
    classRelationships: (inv.classRelationships || []).filter((e) => ids.has(e.from) && ids.has(e.to))
  });
}

function recordSkippedView(file, why, skipped) {
  skipped.push({ file, reason: why || (VIEW_ROLES[file] && VIEW_ROLES[file].reason) || 'not in default delivery' });
}

/**
 * Decide which diagram files to write.
 * @param {object} opts
 * @param {string|string[]} [opts.views]
 * @param {boolean} [opts.compatSix]
 * @param {boolean} [opts.confirmContext]
 * @param {object} [opts.inventory]
 * @param {string[]} [opts.focusFiles]
 * @param {string} [opts.focus]
 * @param {string} [opts.repoRoot]
 */
function resolveViews(opts = {}) {
  const skipped = [];
  const inventory = opts.inventory || {};
  const focusFiles = resolveFocusFiles(opts);
  const explicit = parseViewList(opts.views);

  if (opts.compatSix || opts.views === 'compat' || opts.views === 'six' || opts.views === 'compat-six') {
    return {
      selected: COMPAT_DIAGRAM_FILES.slice(),
      skipped,
      focusFiles,
      policy: 'compat-six',
      note: 'compat six-view write path; not default delivery and not a quality promise'
    };
  }

  if (explicit.length) {
    const selected = [];
    for (const file of explicit) {
      const role = VIEW_ROLES[file] && VIEW_ROLES[file].role;
      if (role === 'evidence' && !hasDeploymentEvidence(inventory)) {
        recordSkippedView(file, 'no launch/orchestration evidence (Dockerfile, compose, k8s, deploy/, ops modules)', skipped);
        continue;
      }
      selected.push(file);
    }
    return { selected, skipped, focusFiles, policy: 'explicit', note: 'on-demand views' };
  }

  const selected = DEFAULT_DIAGRAM_FILES.slice();
  if (opts.confirmContext) selected.push('c4-context.md');
  else recordSkippedView('c4-context.md', VIEW_ROLES['c4-context.md'].reason, skipped);

  recordSkippedView('c4-container.md', VIEW_ROLES['c4-container.md'].reason, skipped);
  recordSkippedView('c4-component.md', VIEW_ROLES['c4-component.md'].reason, skipped);

  if (focusFiles.length) selected.push('class-diagram.md');
  else recordSkippedView('class-diagram.md', 'no --focus and no git-changed files; class diagrams are on-demand and local', skipped);

  if (hasDeploymentEvidence(inventory)) selected.push('deployment-ops.md');
  else recordSkippedView('deployment-ops.md', VIEW_ROLES['deployment-ops.md'].reason, skipped);

  return {
    selected: [...new Set(selected)],
    skipped,
    focusFiles,
    policy: 'default',
    note: 'default delivery: structure overview (+ class if this change is focused, + deploy if evidenced)'
  };
}

module.exports = {
  VIEW_ALIASES,
  VIEW_ROLES,
  DEFAULT_DIAGRAM_FILES,
  COMPAT_DIAGRAM_FILES,
  DEFAULT_SESSION_RENDERER,
  parseViewList,
  gitChangedFiles,
  hasDeploymentEvidence,
  resolveFocusFiles,
  filterClassesForFocus,
  resolveViews
};
