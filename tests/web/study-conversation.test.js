import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { StudyConversation } from '../../apps/web/chat/study-conversation.js';
import { conversationScope, courseCoverage } from '../../apps/web/workspace/study-session.js';

test('empty chat changes its starters when navigating between whole-course and reading scope', () => {
  const { document } = parseHTML('<div id="messages"></div>');
  const host = document.querySelector('#messages');
  const view = new StudyConversation(host);
  const state = {
    library: { courses: [], selectedThreadID: null },
    messages: [],
    contextScope: 'course',
  };
  view.render(state);
  assert.equal(host.querySelectorAll('[data-course-prompt]').length, 3);
  state.contextScope = 'document';
  view.render(state);
  assert.equal(host.querySelectorAll('[data-course-prompt]').length, 0);
  assert.equal(host.querySelectorAll('[data-study-prompt]').length, 3);
  state.contextScope = 'course';
  view.render(state);
  assert.match(host.textContent, /Your whole course/);
});

test('coverage distinguishes remote titles, saved originals and readable sources', () => {
  assert.equal(
    courseCoverage({ documents: [], canvasMaterials: [{ id: 'remote' }] }),
    '0 saved readings with text · 1 material with titles only until opened.'
  );
  const course = {
    id: 'course',
    documents: [
      { sourceKey: 'saved', kind: 'text', pageCount: 1 },
      { sourceKey: 'original', kind: 'preview', pageCount: 1 },
    ],
    canvasMaterials: [{ id: 'saved' }, { id: 'original' }, { id: 'remote' }],
    threads: [{ id: 'thread', documentID: null, assignmentID: null }],
  };
  assert.match(courseCoverage(course), /^1 saved reading with text · 1 material/);
  assert.equal(
    conversationScope({
      library: {
        courses: [course],
        selectedCourseID: 'course',
        selectedThreadID: 'thread',
        selectedDocumentID: 'citation',
      },
    }),
    'course'
  );
});
