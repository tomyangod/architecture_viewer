'use strict';

const crypto = require('node:crypto');

const SOURCE_CONTENT_HASH_VERSION = 'lf-v1';

function normalizeSourceContent(content) {
  return String(content).replace(/\r\n/g, '\n');
}

function hashSourceContent(content) {
  return crypto.createHash('sha256').update(normalizeSourceContent(content)).digest('hex').slice(0, 16);
}

// A raw legacy digest cannot be normalized without the original source.
// Keep that migration unknown rather than attributing the hash upgrade to code.
function compareSourceContentHashes(before, after) {
  if (!before || !after || !before.contentHash || !after.contentHash) return null;
  if (before.contentHash === after.contentHash) return false;
  if ((before.contentHashVersion || 'raw-v0') !== (after.contentHashVersion || 'raw-v0')) return null;
  return true;
}

module.exports = { SOURCE_CONTENT_HASH_VERSION, normalizeSourceContent, hashSourceContent, compareSourceContentHashes };
