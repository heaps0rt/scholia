import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCourseContext,
  courseMetadataContext,
  courseContextScope,
  isCourseScheduleQuestion,
} from '../apps/server/course-context.js';

const course = (documents = [], canvasMaterials = []) => ({
  id: 'course-a',
  name: 'Course in geometric computing',
  code: 'MATH204',
  term: 'Autumn 2026',
  documents,
  canvasMaterials,
});
const document = (id) => ({ id, title: `Reading ${id}`, kind: 'text', pageCount: 3 });

test('schedule questions skip reading indexes but mixed and content questions retain retrieval', async () => {
  for (const question of ["What's due next?", 'When is Exercise 5 due?', 'List the deadlines']) {
    assert.equal(isCourseScheduleQuestion(question), true);
    const packed = await buildCourseContext({
      course: course([document('large')]), question,
      readIndex: () => assert.fail('A deadline lookup must not scan reading contents'),
    });
    assert.match(packed.context, /Reading contents were not loaded/);
    assert.equal(packed.sources.length, 0);
  }
  for (const question of ['When is the essay due and how should I structure it?', 'Explain what is due to electromagnetic induction', 'Summarize the course']) {
    assert.equal(isCourseScheduleQuestion(question), false);
  }
});

test('course catalog supports metadata-only questions without implying remote content is read', async () => {
  const c = course(
    [],
    [
      { id: 'files:1', kind: 'files', title: 'Remote syllabus', moduleTitle: 'Getting started' },
      {
        id: 'assignments:1',
        kind: 'assignments',
        title: 'First exercise',
        assignment: { dueAt: '2026-10-02T10:00:00+02:00', status: 'submitted' },
      },
    ]
  );
  const packed = await buildCourseContext({
    course: c,
    readIndex: () => assert.fail('No file to read'),
  });
  assert.match(packed.context, /MATH204[\s\S]*Autumn 2026/);
  assert.match(packed.context, /Remote syllabus \| remote only; contents unavailable/);
  assert.match(packed.context, /module: Getting started/);
  assert.match(
    packed.context,
    /First exercise \| due: 2026-10-02T10:00:00\+02:00 \| submission: submitted/
  );
  assert.match(packed.context, /No readable excerpts/);
  assert.deepEqual(packed.sources, []);
});

test('question retrieval reaches later documents and pages while tolerating an unavailable index', async () => {
  const documents = Array.from({ length: 30 }, (_, index) => document(String(index)));
  const read = [];
  const packed = await buildCourseContext({
    course: course(documents),
    question: 'Explain the zebraquantum result',
    readIndex: async (doc) => {
      read.push(doc.id);
      if (doc.id === '0') throw new Error('Missing file');
      return {
        pages: [
          { number: 1, text: 'An introduction to this reading.' },
          { number: 2, text: 'Routine background.' },
          {
            number: 3,
            text:
              doc.id === '27'
                ? 'The zebraquantum result is exactly 41 units.'
                : 'Further background.',
          },
        ],
      };
    },
  });
  assert.equal(read.length, 30);
  assert.match(packed.context, /zebraquantum result is exactly 41 units/);
  assert.match(packed.context, /Unavailable saved text: Reading 0/);
  assert.ok(packed.sources.some((source) => source.documentID === '27' && source.page === 3));
  assert.ok(packed.context.length <= 48_000);
});

test('reading-only scope honors context exclusion and keeps its selected page', async () => {
  const selected = document('selected'),
    other = document('other');
  const packed = await buildCourseContext({
    course: course([selected, other]),
    question: 'Explain the proof',
    selectedDocument: selected,
    selectedPage: 3,
    includeCourse: false,
    includeMetadata: false,
    readIndex: async (doc) => {
      assert.equal(doc.id, 'selected');
      return {
        pages: [
          { number: 1, text: 'Introduction.' },
          { number: 3, text: 'The selected proof uses induction.' },
        ],
      };
    },
  });
  assert.match(packed.context, /selected proof uses induction/);
  assert.doesNotMatch(packed.context, /COURSE INFORMATION|Reading other/);
  assert.deepEqual(packed.sources, [
    { documentID: 'selected', title: 'Reading selected', page: 3 },
  ]);
});

test('large course context is bounded and transparently reports omitted catalog entries', async () => {
  const documents = Array.from({ length: 120 }, (_, index) => ({
    ...document(String(index)),
    title: `Reading ${index}: ` + 'Long title '.repeat(30),
  }));
  const c = course(documents);
  const metadata = courseMetadataContext(c, 4000);
  assert.ok(metadata.length <= 4000);
  assert.match(metadata, /additional catalog entries omitted/);
  const packed = await buildCourseContext({
    course: c,
    question: 'What does this course cover?',
    maxChars: 18_000,
    readIndex: async () => ({
      pages: [{ number: 1, text: 'Many facts about a subject. '.repeat(2000) }],
    }),
  });
  assert.ok(packed.context.length <= 18_000);
  assert.ok(packed.sources.length > 1);
  assert.ok(packed.sources.length <= 20);
});

test('course threads keep their scope when a citation opens a document', () => {
  assert.equal(
    courseContextScope(
      { documentID: null, assignmentID: null },
      { selectedDocumentID: 'citation' }
    ),
    'course'
  );
  assert.equal(courseContextScope({ documentID: 'reading', assignmentID: null }, {}), 'document');
  assert.equal(
    courseContextScope({ documentID: null, assignmentID: 'assignment' }, {}),
    'assignment'
  );
  assert.equal(courseContextScope(null, { selectedAssignmentID: 'assignment' }), 'assignment');
});

test('a specific assignment stays available when the catalog exceeds the metadata budget', () => {
  const assignments = Array.from({ length: 100 }, (_, index) => ({
    id: `assignments:${index}`,
    kind: 'assignments',
    title: index === 99 ? 'Capstone orbit project' : `Ordinary exercise ${index}`,
    assignment: { dueAt: '2026-12-03T14:00:00Z', status: 'not_submitted' },
  }));
  const context = courseMetadataContext(
    course([], assignments),
    2000,
    'When is the capstone orbit project due?'
  );
  assert.match(context, /Capstone orbit project \| due: 2026-12-03T14:00:00Z/);
  assert.match(context, /additional catalog entries omitted/);
  assert.ok(context.length <= 2000);
});

test('cancelling retrieval stops before reading saved course indexes', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    buildCourseContext({
      course: course([document('a')]),
      signal: controller.signal,
      readIndex: () => assert.fail('Cancelled work must not read a file'),
    }),
    { name: 'AbortError' }
  );
});
