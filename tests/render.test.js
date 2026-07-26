import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../apps/chrome/src/render.js';

test('renderer escapes raw model HTML', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> **safe**');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(html, /<strong>safe<\/strong>/);
});

test('renderer produces local KaTeX markup and code blocks', () => {
  const html = renderMarkdown('Energy is $E = mc^2$.\n\n```js\nconst x = 1;\n```');
  assert.match(html, /class="katex"/);
  assert.match(html, /data-copy-code/);
  assert.match(html, /const x = 1/);
});
