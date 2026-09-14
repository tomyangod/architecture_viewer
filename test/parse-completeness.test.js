'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildGraph } = require('../lib/extract-graph');
const { assessAnalysisCompleteness } = require('../lib/analysis-completeness');

const cases = [
  ['js', 'export class Healthy {}\n', 'export class Broken {\n'],
  ['ts', 'export interface Healthy { id: string }\n', 'export interface Broken {\n'],
  ['java', 'public class Healthy {}\n', 'public class Broken {\n'],
  ['go', 'package app\ntype Healthy struct {}\n', 'package app\nfunc broken( {\n'],
  ['vue', '<script>export default {};</script>', '<script>export default {</script>'],
  ['svelte', '<script>let healthy = 1;</script>', '<script>let broken = ;</script>']
];

describe('recovered syntax errors are not successful analysis', () => {
  for (const [extension, valid, invalid] of cases) {
    it(`${extension}: exposes partial parse failure while retaining usable entities`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'av-parse-status-'));
      try {
        fs.writeFileSync(path.join(root, `healthy.${extension}`), valid);
        assert.equal(assessAnalysisCompleteness(buildGraph(root)).status, 'ok');
        fs.writeFileSync(path.join(root, `broken.${extension}`), invalid);
        const graph = buildGraph(root);
        assert.equal(graph.stats.files, 2);
        assert.equal(graph.stats.filesParsed, 1);
        assert.equal(graph.stats.parseErrors, 1);
        assert.equal(assessAnalysisCompleteness(graph).status, 'incomplete');
        assert.equal(assessAnalysisCompleteness(graph).allowGreen, false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
