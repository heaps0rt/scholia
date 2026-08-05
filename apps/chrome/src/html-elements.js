export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

export function createHtmlElement(tagName, ownerDocument = document) {
  return ownerDocument.createElementNS(HTML_NAMESPACE, tagName);
}
