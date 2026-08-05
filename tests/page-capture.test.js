import test from 'node:test';
import assert from 'node:assert/strict';
import { currentSelectionCapture } from '../apps/chrome/src/page-capture.js';

test('a single selected character creates a text capture', () => {
  const previousNode = globalThis.Node;
  globalThis.Node = { ELEMENT_NODE: 1 };

  try {
    const rect = { left: 24, right: 32, top: 40, bottom: 58, width: 8, height: 18 };
    const textNode = { nodeType: 3, parentElement: { closest: () => null } };
    const range = {
      cloneContents: () => ({ querySelectorAll: () => [], textContent: 'A' }),
      cloneRange: () => range,
      getClientRects: () => [rect],
      getBoundingClientRect: () => rect
    };
    const selection = {
      anchorNode: textNode,
      focusNode: textNode,
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => 'A'
    };

    const capture = currentSelectionCapture('', selection);
    assert.equal(capture?.kind, 'text');
    assert.equal(capture?.selection, 'A');
    assert.equal(capture?.rect, rect);
  } finally {
    if (previousNode === undefined) delete globalThis.Node;
    else globalThis.Node = previousNode;
  }
});
