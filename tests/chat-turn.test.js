import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUserTurn,
  normalizeSelectionAttachment,
  requestConversation,
  turnRequestContent
} from '../apps/chrome/src/chat-turn.js';

test('page and response selections become bounded, explicitly delimited turn context', () => {
  const attachment = normalizeSelectionAttachment({
    origin: 'response',
    text: '  A response\r\n\n\n excerpt  '
  });
  assert.deepEqual(attachment, {
    origin: 'response',
    text: 'A response\n\nexcerpt',
    label: 'Selected from a response',
    embedded: false,
    messageIndex: null
  });
  const content = turnRequestContent('Why?', attachment);
  assert.match(content, /Excerpt selected from an earlier assistant response/);
  assert.match(content, /<scholia-selection>\nA response\n\nexcerpt\n<\/scholia-selection>/);
  assert.match(content, /Question: Why\?/);
});

test('an attachment already embedded in the source stays visible without duplicating request context', () => {
  const turn = createUserTurn('Explain this.', {
    origin: 'page',
    text: 'selected page text',
    embedded: true
  });
  assert.equal(turn.content, 'Explain this.');
  assert.equal(turn.requestContent, 'Explain this.');
  assert.equal(turn.attachment.text, 'selected page text');
});

test('request conversations use model-facing turn content and omit errors', () => {
  const turn = createUserTurn('Go deeper.', { origin: 'page', text: 'a selected claim' });
  assert.deepEqual(requestConversation([
    { role: 'user', content: 'First question' },
    { role: 'assistant', content: 'First answer' },
    turn,
    { role: 'assistant', content: 'Network failed', error: true }
  ]), [
    { role: 'user', content: 'First question' },
    { role: 'assistant', content: 'First answer' },
    { role: 'user', content: turn.requestContent }
  ]);
});
