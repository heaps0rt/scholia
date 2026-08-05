import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ISOLATED_UI_EVENT_TYPES,
  isolateUiInputEvents
} from '../apps/chrome/src/ui-event-boundary.js';

test('in-page composer input events stop at the Scholia shadow boundary', () => {
  const listeners = new Map();
  const root = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    }
  };
  isolateUiInputEvents(root);

  assert.deepEqual([...listeners.keys()], [...ISOLATED_UI_EVENT_TYPES]);
  for (const type of ['keydown', 'keyup', 'beforeinput', 'input', 'focusin', 'paste', 'compositionend']) {
    let stopped = false;
    listeners.get(type)({ stopPropagation() { stopped = true; } });
    assert.equal(stopped, true, `${type} should not reach the host page`);
  }
});
