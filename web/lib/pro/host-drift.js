'use strict';

const path = require('path');
const { findKitDir, checkKit } = require('../../../lib');
const { formatComment } = require('./comment');

function runHostedCheck(repoRoot, meta) {
  const root = path.resolve(repoRoot);
  const kit = findKitDir(root);
  const base = {
    repo: meta && meta.repoLabel,
    pr: meta && meta.pr,
    sha: meta && meta.sha,
    kit: !!kit
  };
  if (!kit) {
    const result = Object.assign({ ok: false, protocol: { errors: ['kit missing'] }, drift: { missing: [] } }, base);
    return Object.assign(result, { markdown: formatComment(result) });
  }
  const checked = checkKit(kit, { requireFilled: true, drift: true, repo: root });
  const result = Object.assign(
    {
      ok: !!checked.ok,
      protocol: checked.protocol || { errors: [] },
      drift: checked.drift || { missing: [] }
    },
    base
  );
  result.markdown = formatComment(result);
  return result;
}

module.exports = { runHostedCheck };
