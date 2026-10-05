import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostedServer } from '../../apps/server/server.js';

async function fixture(t, complete) {
  const root = await mkdtemp(join(tmpdir(), 'scholia-course-chat-'));
  const requests = [];
  const app = createHostedServer({
    root,
    origin: 'http://127.0.0.1:3000',
    complete: async (payload, ...rest) => {
      requests.push(payload);
      if (complete) return complete(payload, ...rest);
      return { text: 'A grounded course answer.' };
    },
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const user = await app.store.createUser('course@example.com', 'isolated-course-test');
  const login = await app.store.login('course@example.com', 'isolated-course-test');
  const session = app.store.session(login.value);
  const account = app.workspaces.account(user.id);
  const action = async (command) => {
    const state = await app.workspaces.state(session);
    return app.workspaces.action(session, { owner: state.draftOwner, ...command });
  };
  await action({ action: 'create', name: 'Geometric computing', code: 'MATH204' });
  const course = account.library.courses[0];
  course.term = 'Autumn 2026';
  return { ...app, session, account, course, action, requests };
}

test('chat reports generation phases and elapsed start, then saves streamed text', async (t) => {
  let release, begun;
  const started = new Promise((resolve) => { begun = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  let token, reasoning;
  const app = await fixture(t, async (_payload, _settings, onToken, _signal, onReasoning) => {
    token = onToken; reasoning = onReasoning; begun(); await gate;
    return { text: 'A streamed answer.' };
  });
  await app.action({ action: 'send', text: 'Describe this course.' });
  await started;
  let state = await app.workspaces.state(app.session);
  const reply = () => app.course.threads[0].messages.at(-1);
  assert.match(reply().metadata, /Waiting for/);
  assert.ok(state.answerStartedAt > 0);
  reasoning('private reasoning delta');
  assert.equal(reply().metadata, 'Model is reasoning…');
  assert.doesNotMatch(reply().metadata, /private reasoning/);
  token('A streamed answer.');
  assert.equal(reply().metadata, 'Writing answer…');
  release(); await app.account.job;
  state = await app.workspaces.state(app.session);
  assert.equal(reply().isStreaming, false);
  assert.equal(reply().content, 'A streamed answer.');
  assert.equal(state.answerStartedAt, null);
});

test('empty model responses fail visibly and leave chat ready to retry', async (t) => {
  const app = await fixture(t, async () => ({ text: '' }));
  await app.action({ action: 'send', text: 'Describe this course.' });
  await app.account.job;
  assert.match(app.account.error, /empty response/);
  assert.equal(app.account.streaming, false);
  assert.equal(app.course.threads[0].messages.at(-1).isStreaming, false);
});

test('a selected passage can be sent without a comment and retains its document context', async (t) => {
  const app = await fixture(t);
  const doc = await app.workspaces.importFile(app.account, app.course, 'Orbitals.md', Buffer.from('The ground state has the lowest energy.'));
  await app.action({ action: 'document', id: doc.id });
  const draft = await app.action({ action: 'draft', text: '', selection: 'ground state' });
  assert.equal(draft.canSend, true);
  await app.action({ action: 'send', text: '', selection: 'ground state' });
  await app.account.job;
  assert.equal(app.account.error, null);
  assert.match(app.requests[0].context, /lowest energy/);
  const thread = app.course.threads.find((thread) => thread.documentID === doc.id);
  assert.match(thread.messages[0].content, /Explain this passage[\s\S]*> ground state/);
  assert.equal(thread.messages.at(-1).content, 'A grounded course answer.');
});

test('course chat uses catalog information without a document and preserves scope, drafts and course isolation', async (t) => {
  const app = await fixture(t);
  const { action, course, account } = app;
  course.canvasMaterials.push(
    { id: 'files:1', title: 'Course syllabus', kind: 'files' },
    {
      id: 'assignments:1',
      title: 'Capstone project',
      kind: 'assignments',
      assignment: { dueAt: '2026-10-02T12:00:00+02:00', status: 'notSubmitted' },
    }
  );
  await action({ action: 'askCourse' });
  await action({ action: 'context', enabled: false });
  await action({ action: 'send', text: 'When is the capstone project due?' });
  await account.job;
  assert.equal(account.error, null);
  assert.match(app.requests[0].context, /MATH204[\s\S]*Autumn 2026/);
  assert.match(app.requests[0].context, /Capstone project \| due: 2026-10-02T12:00:00\+02:00/);
  assert.match(app.requests[0].context, /Course syllabus \| remote only; contents unavailable/);
  assert.match(app.requests[0].context, /Reading contents were not loaded/);
  const courseThread = (await action({ action: 'draft', text: 'My course draft' })).library
    .selectedThreadID;
  const doc = await app.workspaces.importFile(
    account,
    course,
    'Vectors.md',
    Buffer.from('Vectors combine through linear maps.')
  );
  await action({ action: 'document', id: doc.id });
  const reading = await action({ action: 'draft', text: 'My reading draft' });
  const back = await action({ action: 'askCourse' });
  assert.equal(back.draft, 'My course draft');
  assert.equal(back.library.selectedThreadID, courseThread);
  assert.equal(back.contextScope, 'course');
  assert.equal(
    course.threads.find((thread) => thread.id === reading.library.selectedThreadID).draft,
    'My reading draft'
  );
  const citation = await action({ action: 'source', id: doc.id, page: 1 });
  assert.equal(citation.contextScope, 'course');
  assert.equal(citation.includeCourse, true);
  await action({ action: 'send', text: 'How do these topics connect?' });
  await account.job;
  assert.match(app.requests[1].context, /Vectors combine through linear maps/);
  assert.equal(app.requests[1].pageTitle, course.name);
  const newThread = await action({ action: 'newThread' });
  assert.equal(newThread.contextScope, 'course');
  await action({ action: 'create', name: 'Separate course', code: 'PRIVATE' });
  await action({ action: 'send', text: 'What do we know about this course?' });
  await account.job;
  assert.doesNotMatch(app.requests[2].context, /Vectors|Capstone|MATH204/);
  assert.match(app.requests[2].context, /PRIVATE/);
});

test('reasoning selection survives reopening, reaches completion, and rejects unsupported or stale model choices', async (t) => {
  const app = await fixture(t);
  const { action, account, course } = app;
  const model = { id: 'gpt-6-astra', providerID: 'openai' };
  let state = await action({ action: 'model', ...model });
  assert.equal(state.reasoningEffort, 'medium');
  assert.ok(
    state.models
      .find((entry) => entry.id === model.id && entry.providerID === model.providerID)
      .reasoningEfforts.includes('high')
  );
  state = await action({ action: 'reasoning', ...model, text: 'high' });
  assert.equal(state.reasoningEffort, 'high');
  assert.equal(app.store.account(account.id).settings.reasoningEfforts.openai, 'high');
  await action({ action: 'send', text: 'Describe this course.' });
  await account.job;
  assert.equal(app.requests[0].reasoningEffort, 'high');
  assert.equal(course.threads[0].messages.at(-1).content, 'A grounded course answer.');
  await assert.rejects(action({ action: 'reasoning', ...model, text: 'invented' }), /unavailable/);
  state = await action({ action: 'model', id: 'claude-sonnet-4-6', providerID: 'anthropic' });
  assert.equal(state.reasoningEffort, null);
  await assert.rejects(action({ action: 'reasoning', ...model, text: 'low' }), /model changed/);
  await assert.rejects(
    action({ action: 'reasoning', id: 'claude-sonnet-4-6', providerID: 'anthropic', text: 'high' }),
    /unavailable/
  );
  state = await action({ action: 'model', ...model });
  assert.equal(state.reasoningEffort, 'high');
});
