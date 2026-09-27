import test from 'node:test';
import assert from 'node:assert/strict';
import { responseSelectionInteractionProtected } from '../apps/chrome/src/response-selection.js';

test('response selection remains attached while its Explain composer takes focus', () => {
  assert.equal(responseSelectionInteractionProtected({ pointerInteraction: true }), true);
  assert.equal(responseSelectionInteractionProtected({ focusInside: true }), true);
  assert.equal(responseSelectionInteractionProtected({}), false);
});
