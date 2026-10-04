import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../apps/server/store.js';
import { Workspaces } from '../apps/server/workspaces.js';
const recommendation = JSON.stringify({ courseLimit: 3, rankedCourses: [{ courseKey: 'TDT4100', reason: 'Programming is useful for your robotics goal.' }] });

async function fixture(t, complete) {
  const root = await mkdtemp(join(tmpdir(), 'scholia-exam-advice-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new AccountStore(root);
  await store.createUser('exams@example.com', 'local-test-password');
  const session = store.session((await store.login('exams@example.com', 'local-test-password')).value);
  const workspaces = new Workspaces(store, {}, { complete });
  const account = workspaces.account(session.user_id);
  account.library.examPlan = [{ id: 'one', courseCode: 'TDT4100', courseName: 'Programming', component: 'Final', kind: 'final', date: '2026-12-10', startTime: '09:00', endTime: '13:00', endDate: '', selected: false, source: 'manual' }];
  return { store, workspaces, account, session, request: { exams: structuredClone(account.library.examPlan), interests: 'Robotics' } };
}

test('hosted recommendations use the account model and interests without changing the saved selection', async (t) => {
  let payload;
  const f = await fixture(t, async (request) => { payload = request; return { text: recommendation }; });
  f.account.settings.modelID = 'fixture-model';
  const result = await f.workspaces.recommendExams(f.session, f.request);
  assert.deepEqual(result.selectedExamIDs, ['one']);
  assert.equal(payload.model, 'fixture-model');
  assert.match(payload.messages[0].content, /Robotics/);
  assert.equal(f.account.library.examPlan[0].selected, false);
  assert.equal(f.account.examRecommendationBusy, false);
  await f.store.createUser('other@example.com', 'local-test-password');
  const other = f.store.session((await f.store.login('other@example.com', 'local-test-password')).value);
  await assert.rejects(f.workspaces.recommendExams(other, f.request), /plan changed/);
});

test('changed plans, overlapping requests, aborted responses and provider failures leave recommendations retryable', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = await fixture(t, async () => { await gate; return { text: recommendation }; });
  const pending = f.workspaces.recommendExams(f.session, f.request);
  await assert.rejects(f.workspaces.recommendExams(f.session, f.request), /already running/);
  f.account.library.examPlan[0].date = '2026-12-11';
  release();
  await assert.rejects(pending, /changed/);
  assert.equal(f.account.examRecommendationBusy, false);
  f.request.exams = structuredClone(f.account.library.examPlan);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.workspaces.recommendExams(f.session, f.request, controller.signal), { name: 'AbortError' });
  f.workspaces.options.complete = async () => { throw new Error('Fixture offline'); };
  await assert.rejects(f.workspaces.recommendExams(f.session, f.request), /Fixture offline/);
  assert.equal(f.account.examRecommendationBusy, false);
  f.workspaces.options.complete = async () => ({ text: recommendation });
  assert.deepEqual((await f.workspaces.recommendExams(f.session, f.request)).selectedExamIDs, ['one']);
});
