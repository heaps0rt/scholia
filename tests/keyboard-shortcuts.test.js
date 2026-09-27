import test from 'node:test';
import assert from 'node:assert/strict';
import { isQuickChatShortcut } from '../apps/chrome/src/keyboard-shortcuts.js';

test('Quick Chat recognizes Command-Shift-K on macOS', () => {
  assert.equal(isQuickChatShortcut({ key: 'K', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }, 'MacIntel'), true);
  assert.equal(isQuickChatShortcut({ key: 'k', metaKey: false, ctrlKey: true, shiftKey: true, altKey: false }, 'MacIntel'), false);
});

test('Quick Chat recognizes Ctrl-Shift-K off macOS and rejects extra modifiers', () => {
  assert.equal(isQuickChatShortcut({ key: 'k', metaKey: false, ctrlKey: true, shiftKey: true, altKey: false }, 'Linux x86_64'), true);
  assert.equal(isQuickChatShortcut({ key: 'k', metaKey: false, ctrlKey: true, shiftKey: true, altKey: true }, 'Linux x86_64'), false);
  assert.equal(isQuickChatShortcut({ key: 'k', metaKey: false, ctrlKey: true, shiftKey: true, altKey: false, repeat: true }, 'Linux x86_64'), false);
});
