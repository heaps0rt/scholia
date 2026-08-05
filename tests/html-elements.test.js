import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HTML_NAMESPACE,
  createHtmlElement
} from '../apps/chrome/src/html-elements.js';

test('content UI elements are always created in the HTML namespace', () => {
  const calls = [];
  const ownerDocument = {
    createElement() {
      throw new Error('XML documents must not use unqualified element creation.');
    },
    createElementNS(namespace, tagName) {
      calls.push([namespace, tagName]);
      return { namespaceURI: namespace, localName: tagName };
    }
  };

  const host = createHtmlElement('div', ownerDocument);
  const template = createHtmlElement('template', ownerDocument);
  const canvas = createHtmlElement('canvas', ownerDocument);

  assert.deepEqual(calls, [
    [HTML_NAMESPACE, 'div'],
    [HTML_NAMESPACE, 'template'],
    [HTML_NAMESPACE, 'canvas']
  ]);
  assert.equal(host.namespaceURI, HTML_NAMESPACE);
  assert.equal(template.localName, 'template');
  assert.equal(canvas.localName, 'canvas');
});
