'use strict';

/** Files copied into a target repo by `init`. Viewer is the deliverable; commands live in the extension. */
const KIT_FILES = [
  'architecture_visualized.html',
  'architecture.config.js',
  'AGENT.md',
  'USER_GUIDE.md',
  'c4-context.md',
  'c4-container.md',
  'c4-component.md',
  'block-diagram.md',
  'class-diagram.md',
  'deployment-ops.md',
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

const KIT_DIR_CANDIDATES = ['architecture_viewer', 'docs/architecture', 'docs/architecture_viewer'];

module.exports = { KIT_FILES, DIAGRAM_FILES, KIT_DIR_CANDIDATES };
