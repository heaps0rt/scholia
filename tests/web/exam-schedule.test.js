import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { examScheduleMarkup } from '../../apps/web/exams/exam-schedule.js';

const exam = (id, date, endDate = '') => ({
  id,
  courseCode: id,
  courseName: id,
  component: 'Final exam',
  kind: 'final',
  date,
  endDate,
  startTime: '09:00',
  endTime: '13:00',
  selected: true,
  source: 'manual',
});
test('schedule does not show revision gaps inside a multi-day exam', () => {
  const html = examScheduleMarkup({
    library: {
      courses: [],
      examPlan: [
        exam('LONG1000', '2026-12-01', '2026-12-10'),
        exam('MID1000', '2026-12-05'),
        exam('END1000', '2026-12-12'),
      ],
    },
  });
  assert.match(html, /1 day between exams/);
  assert.doesNotMatch(html, /3 days between exams|6 days between exams/);
  assert.match(html, /ends 10 Dec 2026/);
  assert.doesNotMatch(html, /type="date"|<dialog/);
});

test('oral timing is flexible by default, keeps its reference date and can be made fixed', () => {
  const written = exam('WRITTEN1000', '2026-12-01');
  const oral = { ...exam('ORAL1000', '2026-12-01'), component: 'Oral exam' };
  const render = (row) => parseHTML(examScheduleMarkup({
    library: { courses: [], examPlan: [written, row] },
  })).document;
  const flexible = render(oral);
  assert.equal(flexible.querySelectorAll('.exam-schedule-row').length, 2);
  assert.equal(flexible.querySelectorAll('.exam-comparison').length, 0);
  const row = flexible.querySelector('.exam-schedule-row.flexible');
  assert.match(row.textContent, /ORAL1000.*09:00–13:00.*Date kept for reference.*arrange with professor/s);
  assert.match(flexible.querySelector('.exam-day').textContent, /Dec 2026.*01/s);
  assert.equal(row.querySelector('[data-schedule-action="flexible"]').dataset.examId, oral.id);
  assert.equal(row.querySelector('[data-schedule-action="flexible"]').dataset.flexible, 'false');
  assert.match(flexible.querySelector('.exam-overview').textContent, /no fixed-time overlaps/);

  const fixed = render({ ...oral, flexible: false });
  assert.equal(fixed.querySelectorAll('.exam-comparison.collision').length, 1);
  assert.equal(fixed.querySelectorAll('.exam-schedule-row.flexible').length, 0);
  assert.deepEqual(
    [...fixed.querySelectorAll('.exam-comparison [data-schedule-action="flexible"]')]
      .map((button) => [button.dataset.examId, button.dataset.flexible]),
    [[written.id, 'true'], [oral.id, 'true']]
  );
});

test('possible overlaps offer flexible timing while course selection includes every component', () => {
  const rows = [
    exam('COURSE1000', '2026-12-01'),
    { ...exam('midterm', '2026-10-01'), courseCode: 'COURSE1000', component: 'Midterm' },
    { ...exam('OTHER1000', '2026-12-01'), startTime: '', endTime: '' },
  ];
  const render = (examPlan) => parseHTML(examScheduleMarkup({
    library: { courses: [], examPlan },
  })).document;
  const all = render(rows);
  assert.equal(all.querySelectorAll('.exam-comparison.possible').length, 1);
  assert.equal(all.querySelectorAll('.exam-comparison.possible [data-schedule-action="flexible"]').length, 2);
  assert.equal(all.querySelectorAll('[data-schedule-course]').length, 2);
  assert.match(all.querySelector('[data-schedule-course="COURSE1000"]').closest('label').textContent, /2\/2 exams selected/);
  assert.equal(all.querySelector('.exam-course-selection [data-schedule-action="selectAll"]').hasAttribute('disabled'), true);
  assert.equal(all.querySelector('.exam-course-selection [data-schedule-action="clearAll"]').hasAttribute('disabled'), false);

  const none = render(rows.map((row) => ({ ...row, selected: false })));
  assert.equal(none.querySelector('[data-schedule-action="selectAll"]').hasAttribute('disabled'), false);
  assert.equal(none.querySelector('[data-schedule-action="clearAll"]').hasAttribute('disabled'), true);
  assert.equal(none.querySelector('.exam-course-selection').hasAttribute('open'), true);
});
