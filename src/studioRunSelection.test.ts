import assert from 'node:assert/strict';
import test from 'node:test';
import { selectStudioRunForSet } from './studioRunSelection.ts';

test('Studio run selection keeps an empty selected set instead of falling back globally', () => {
  const runs = [
    { id: 'set-02-newest', setNumber: 2 },
    { id: 'set-01-older', setNumber: 1 }
  ];

  assert.equal(selectStudioRunForSet(runs, 3), null);
});

test('Studio run selection chooses the first run from the selected set', () => {
  const runs = [
    { id: 'set-02-newest', setNumber: 2 },
    { id: 'set-03-newest', setNumber: 3 },
    { id: 'set-03-older', setNumber: 3 }
  ];

  assert.deepEqual(selectStudioRunForSet(runs, 3), runs[1]);
});
