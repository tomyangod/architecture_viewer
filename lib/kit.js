'use strict';

/** Default kit copied by `init`. Compat C4/class/deploy files are not copied unless --compat-six-views. */
const DEFAULT_KIT_FILES = [
  'architecture_visualized.html',
  'architecture.config.js',
  'AGENT.md',
  'USER_GUIDE.md',
  'block-diagram.md',
  'vendor/mermaid.min.js',
  '.cursor/rules/architecture-viewer.mdc'
];

const DIAGRAM_FILES = [
  'c4-context.md',
  'c4-container.md',
  'c4-component.md',
  'block-diagram.md',
  'class-diagram.md',
  'deployment-ops.md'
];

const COMPAT_KIT_FILES = [
  'architecture_visualized.html',
  'architecture.config.js',
  'AGENT.md',
  'USER_GUIDE.md',
  ...DIAGRAM_FILES,
  'vendor/mermaid.min.js',
  '.cursor/rules/architecture-viewer.mdc'
];

const KIT_FILES = DEFAULT_KIT_FILES;

const KIT_DIR_CANDIDATES = ['architecture_viewer', 'docs/architecture', 'docs/architecture_viewer'];

module.exports = { KIT_FILES, DEFAULT_KIT_FILES, COMPAT_KIT_FILES, DIAGRAM_FILES, KIT_DIR_CANDIDATES };
