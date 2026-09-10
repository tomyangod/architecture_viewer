'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { changedFilesFromDiff, touchesChangedFiles } = require('../lib/analyzers/paths');

test('incremental paths include actual graph node shapes, moves, removals and LOC-only changes', () => {
  const changed = changedFilesFromDiff({
    addedNodes: [{ id: 'file:added.py', node: { path: 'added.py' } }],
    modifiedNodes: [{ from: { path: 'modified.py' }, to: { path: 'modified.py' } }],
    renamedNodes: [{ fromPath: 'old.py', toPath: 'new.py' }],
    removedEdges: [{ file: 'consumer.py', from: 'file:consumer.py', to: 'file:removed.py' }],
    reroutedEdges: [{ from: 'file:rerouted.py', to: 'file:target.py' }],
    fileLocChanges: [{ path: 'grown.py', delta: 1 }, { path: 'unchanged.py', delta: 0 }]
  }, '/repo');
  assert.deepEqual([...changed].sort(), [
    'added.py', 'consumer.py', 'grown.py', 'modified.py', 'new.py',
    'old.py', 'removed.py', 'rerouted.py', 'target.py'
  ].sort());
  assert.equal(touchesChangedFiles(['/repo/modified.py'], changed, '/repo'), true);
  assert.equal(touchesChangedFiles(['/repo/prefix/modified.py'], changed, '/repo'), false);
  assert.equal(touchesChangedFiles(['anything.py'], changedFilesFromDiff({}, '/repo'), '/repo'), false);
});
