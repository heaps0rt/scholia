import test from 'node:test';
import assert from 'node:assert/strict';
import { compareExamDates, analyzeExamCollisions } from '../../packages/core/src/exam-planner.js';
import { examRecommendationInput, checkedExamRecommendation } from '../../packages/core/src/exam-recommendations.js';

const exam = (id, changes = {}) => ({ id, courseCode: id, courseName: id, component: 'Final exam', kind: 'final',
  date: '2026-12-10', startTime: '09:00', endTime: '13:00', endDate: '', selected: false, source: 'manual', ...changes });
const ranked = (keys, changes = {}) => JSON.stringify({ courseLimit: 4, rankedCourses: keys.map((courseKey) => ({ courseKey, reason: `${courseKey} fits your robotics interests.` })), ...changes });

test('exam date order crosses course groups and years, with missing dates and times last', () => {
  const rows = [exam('A', { date: '2027-01-01' }), exam('Z', { date: '2026-10-01' }),
    exam('unknown', { date: '', startTime: '', endTime: '' }), exam('time', { startTime: '', endTime: '' }), exam('known')];
  assert.deepEqual([...rows].sort(compareExamDates).map((row) => row.id), ['Z', 'known', 'time', 'A', 'unknown']);
  assert.equal(rows[0].id, 'A');
});

test('recommendation inputs include stated interests and matched titles without course files, grades or other account data', () => {
  const rows = [exam('TDT4100', { courseName: '' })];
  const input = JSON.parse(examRecommendationInput(rows, 'Robotics and practical programming', [
    { code: 'TDT4100-26H', name: 'Object-oriented programming', documents: [{ text: 'PRIVATE FILE' }], grade: 'PRIVATE GRADE' },
    { code: 'OTHER', name: 'PRIVATE COURSE' },
  ]));
  assert.equal(input.courses[0].courseName, 'Object-oriented programming');
  assert.equal(input.interests, 'Robotics and practical programming');
  assert.doesNotMatch(JSON.stringify(input), /PRIVATE/);
  assert.throws(() => examRecommendationInput(rows, ''), /interests/);
  assert.throws(() => examRecommendationInput(rows, 'x'.repeat(4001)), /4,000/);
  assert.throws(() => examRecommendationInput([], 'Robotics'), /Add exam/);
});

test('rankings select whole courses without clashes, skip incomplete courses, and never mutate the plan', () => {
  const rows = [exam('A-mid', { courseCode: 'A', date: '2026-10-01', component: 'Midterm' }),
    exam('A-final', { courseCode: 'A' }), exam('B'), exam('C', { date: '2026-12-12' }),
    exam('D', { date: '2026-12-14', endTime: '' })];
  const before = structuredClone(rows);
  const result = checkedExamRecommendation(rows, ranked(['A', 'B', 'D', 'C']));
  assert.deepEqual(result.selectedExamIDs, ['A-mid', 'A-final', 'C']);
  assert.deepEqual(result.choices.map((c) => c.courseKey), ['A', 'C']);
  assert.match(result.excluded.find((c) => c.courseKey === 'B').reason, /Clashes/);
  assert.match(result.excluded.find((c) => c.courseKey === 'D').reason, /missing/);
  assert.equal(analyzeExamCollisions(rows.map((row) => ({ ...row, selected: result.selectedExamIDs.includes(row.id) }))).collisions.length, 0);
  assert.deepEqual(rows, before);
  assert.deepEqual(checkedExamRecommendation(rows, ranked(['C', 'A'], { courseLimit: 1 })).selectedExamIDs, ['C']);
});

test('recommendations check overnight intervals and internal component clashes while accepting back-to-back exams', () => {
  const rows = [exam('night', { date: '2026-12-10', startTime: '22:00', endTime: '02:00', endDate: '2026-12-11' }),
    exam('overlap', { date: '2026-12-11', startTime: '01:00', endTime: '03:00' }),
    exam('adjacent', { date: '2026-12-11', startTime: '02:00', endTime: '04:00' }),
    exam('self1', { courseCode: 'SELF' }), exam('self2', { courseCode: 'SELF' })];
  const result = checkedExamRecommendation(rows, ranked(['NIGHT', 'OVERLAP', 'ADJACENT', 'SELF']));
  assert.deepEqual(result.selectedExamIDs, ['night', 'adjacent']);
  assert.match(result.excluded.find((c) => c.courseKey === 'SELF').reason, /components/);
});

test('required courses take priority and impossible required combinations fail visibly', () => {
  const rows = [exam('A'), exam('B'), exam('C', { date: '2026-12-12' })];
  assert.deepEqual(checkedExamRecommendation(rows, ranked(['A', 'B', 'C'], { requiredCourseKeys: ['B'] })).selectedExamIDs, ['B', 'C']);
  assert.throws(() => checkedExamRecommendation(rows, ranked(['A', 'B'], { requiredCourseKeys: ['A', 'B'] })), /Cannot include required/);
  assert.throws(() => checkedExamRecommendation(rows, ranked(['A'], { requiredCourseKeys: ['missing'] })), /invalid required/);
});

test('recommendations respect flexible oral timing and explicit fixed timing', () => {
  const rows = [exam('A'), exam('ORAL', { component: 'Oral exam', startTime: '', endTime: '' }),
    exam('FLEX', { date: '', startTime: '', endTime: '', flexible: true })];
  assert.deepEqual(checkedExamRecommendation(rows, ranked(['A', 'ORAL', 'FLEX'])).choices.map((row) => row.courseKey), ['A', 'ORAL', 'FLEX']);
  assert.equal(JSON.parse(examRecommendationInput(rows, 'Robotics')).courses.find((course) => course.courseKey === 'ORAL').exams[0].flexible, true);
  assert.deepEqual(checkedExamRecommendation(rows.map((row) => ({ ...row, flexible: false })), ranked(['A', 'ORAL', 'FLEX'])).selectedExamIDs, ['A']);
});

test('unreadable, duplicate and fabricated model choices cannot become a recommendation', () => {
  const rows = [exam('A')];
  for (const response of ['prose', ranked(['missing']), ranked(['A', 'A']), ranked(['A'], { courseLimit: -1 }),
    ranked(['A'], { rankedCourses: [{ courseKey: 'A', reason: '' }] })])
    assert.throws(() => checkedExamRecommendation(rows, response));
  assert.deepEqual(checkedExamRecommendation(rows, '```json\n' + ranked(['A']) + '\n```').selectedExamIDs, ['A']);
  assert.deepEqual(checkedExamRecommendation(rows, ranked([])).selectedExamIDs, []);
});
