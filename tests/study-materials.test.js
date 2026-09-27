import test from 'node:test';
import assert from 'node:assert/strict';
import { materialGroupsMarkup, materialFilesMarkup, materialsViewMarkup } from '../apps/web/materials.js';

const groups = [{ id: 'module:1', title: 'Week 1', basis: 'Canvas module order', items: [
  { title: 'Lecture 2', documentID: 'saved', materialID: 'files:2', detail: '4 pages · Saved offline' },
  { title: 'Lecture 10', materialID: 'files:10', detail: 'Download to read', sourceURL: 'https://canvas.ntnu.no/courses/1/files/10' },
] }];

test('materials preserve server teaching order and saved versus remote actions', () => {
  const html = materialGroupsMarkup(groups, { courseID: 'c', selectedID: 'saved' });
  assert.ok(html.indexOf('Lecture 2') < html.indexOf('Lecture 10'));
  assert.match(html, /data-action="document" data-id="saved"/);
  assert.match(html, /data-action="material" data-id="files:10"/);
  assert.match(html, /Canvas module order/);
  assert.match(html, /class="material-row active"/);
});

test('assignment materials open their linked PDFs even when the instructions are saved offline', () => {
  for (const documentID of [undefined, 'saved-instructions']) {
    const assignments = [{ ...groups[0], items: [{ title: 'Exercise 9', materialID: 'assignments:9', documentID }] }];
    const html = materialGroupsMarkup(assignments, { compact: true, courseID: 'c', selectedAssignmentID: 'assignments:9', busy: true });
    assert.match(html, /data-action="assignment" data-id="assignments:9" data-course-id="c"/);
    assert.match(html, /class="material-row active"/);
    assert.doesNotMatch(html, /data-action="document"|disabled/);
  }
});

test('collapsed groups stay searchable and group names match all readings inside them', () => {
  const options = { courseID: 'c', closed: new Set(['c:module:1']) };
  assert.doesNotMatch(materialGroupsMarkup(groups, options), /data-collapse-key="c:module:1" open/);
  assert.match(materialGroupsMarkup(groups, { ...options, query: 'Week 1' }), /data-collapse-key="c:module:1" open/);
  assert.doesNotMatch(materialGroupsMarkup(groups, { query: 'Lecture 2' }), /Lecture 10/);
  assert.match(materialGroupsMarkup(groups, { query: 'missing' }), /No matching materials/);
});

test('material metadata cannot inject markup or executable links', () => {
  const html = materialGroupsMarkup([{ ...groups[0], title: '<script>', items: [{ title: '<img src=x>', materialID: '" onclick="evil()', sourceURL: 'javascript:evil()' }] }]);
  assert.doesNotMatch(html, /<script>|<img src=x>|href="javascript:/);
  assert.match(html, /&lt;img src=x&gt;/);
});


test('all files is an optional ungrouped view that includes remote files and course assets', () => {
  const files = [...groups[0].items, { title: 'icon-logo.png', materialID: 'files:asset', detail: 'Download to read' }];
  const normal = materialsViewMarkup(groups, files);
  assert.match(normal, /data-id="organized" class="active" aria-pressed="true"/);
  assert.match(normal, /<details class="material-group/);
  const flat = materialsViewMarkup(groups, files, { view: 'files', closed: new Set(['c:assets']), courseID: 'c' });
  assert.match(flat, /data-id="files" class="active" aria-pressed="true"/);
  assert.match(flat, /3 files/);
  assert.match(flat, /icon-logo.png/);
  assert.match(flat, /data-action="document" data-id="saved"/);
  assert.match(flat, /data-action="material" data-id="files:asset"/);
  assert.doesNotMatch(flat, /<details|Canvas module order/);
  assert.match(materialFilesMarkup(files, { query: '.png' }), /1 files/);
  assert.doesNotMatch(materialFilesMarkup(files, { query: '.png' }), /Lecture 2/);
  assert.match(materialFilesMarkup(files, { query: 'missing' }), /No matching files/);
  assert.match(materialFilesMarkup([]), /No files in this workspace/);
});

test('saved instructions and submitted assignments have independent indicators', () => {
  const html = materialGroupsMarkup([{ ...groups[0], items: [
    { title: 'Saved instructions', materialID: 'assignments:1', documentID: 'saved', submissionStatus: 'notSubmitted' },
    { title: 'Submitted exercise', materialID: 'assignments:2', submissionStatus: 'submitted' }
  ] }], { compact: true });
  assert.match(html, /Not handed in/);
  assert.match(html, /Saved offline/);
  assert.match(html, /class="submission-badge handed-in"/);
  assert.match(html, /Download on demand/);
});
