'use strict';

const path = require('path');

function normalizeFilePath(value, repo) {
  if (typeof value !== 'string' || !value) return null;
  const file = value.replace(/^file:/, '').replace(/\\/g, '/');
  const root = repo && repo.replace(/\\/g, '/');
  const normalized = path.posix.normalize(file);
  if (!root) return normalized;
  if (/^[A-Za-z]:\//.test(root)) {
    return path.win32.relative(path.win32.resolve(root), path.win32.resolve(root, normalized)).replace(/\\/g, '/');
  }
  return path.posix.relative(path.posix.resolve(root), path.posix.resolve(root, normalized));
}

function changedFilesFromDiff(diff, repo) {
  if (diff == null) return null;
  const files = new Set();
  const add = (value) => {
    const normalized = normalizeFilePath(value, repo);
    if (normalized) files.add(normalized);
  };
  for (const node of [
    ...(diff.addedNodes || []), ...(diff.modifiedNodes || []), ...(diff.removedNodes || []),
    ...(diff.movedNodes || []), ...(diff.renamedNodes || [])
  ]) {
    add(node.path || node.file || node.node?.path);
    add(node.from?.path || node.fromPath);
    add(node.to?.path || node.toPath);
  }
  for (const file of diff.fileLocChanges || []) {
    if (typeof file.delta === 'number' && file.delta !== 0) add(file.path);
  }
  for (const edge of [
    ...(diff.addedEdges || []), ...(diff.modifiedEdges || []),
    ...(diff.removedEdges || []), ...(diff.reroutedEdges || [])
  ]) {
    add(edge.file);
    for (const endpoint of [edge.from, edge.to]) {
      if (typeof endpoint === 'string' && endpoint.startsWith('file:')) add(endpoint);
    }
  }
  return files;
}

function touchesChangedFiles(files, changedFiles, repo) {
  if (changedFiles === null) return true;
  return files.some((file) => changedFiles.has(normalizeFilePath(file, repo)));
}

module.exports = { normalizeFilePath, changedFilesFromDiff, touchesChangedFiles };
