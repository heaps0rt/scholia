import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHostedServer } from '../apps/server/server.js';
import { chromiumSession } from './lib/chromium.mjs';

const root = await mkdtemp(join(tmpdir(), 'scholia-exam-browser-'));
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
let recommendationCalls = 0;
const origin = `http://127.0.0.1:${port}`,
  app = createHostedServer({ root, origin, complete: async (payload) => {
    assert.match(payload.messages[0].content, /Robotics and practical programming/);
    if (++recommendationCalls === 1) throw new Error('Fixture provider unavailable');
    return { text: JSON.stringify({ courseLimit: 3, rankedCourses: [
      { courseKey: 'TDT4100', reason: 'Programming supports your robotics projects.' },
      { courseKey: 'TMA4100', reason: 'Calculus helps with modelling and control.' },
      { courseKey: 'TFE4146', reason: 'Sensors connect software with the physical world.' },
      { courseKey: 'TEST1000', reason: 'Independent study gives you room to apply your interests.' },
    ] }) };
  } });
let browser;
try {
  const user = await app.store.createUser('exams@example.com', 'correct horse battery staple');
  const fixtureAccount = app.workspaces.account(user.id);
  fixtureAccount.library.courses = [
    ['programming', 'TDT4100-26H', 'Object-oriented programming'],
    ['calculus', 'TMA4100', 'Calculus'],
    ['sensors', 'TFE4146', 'Sensors'],
    ['independent', 'TEST1000', 'Independent study'],
  ].map(([id, code, name]) => ({ id, code, name, documents: [], threads: [] }));
  app.store.save(fixtureAccount);
  await new Promise((resolve) => app.server.listen(port, '127.0.0.1', resolve));
  browser = await chromiumSession();
  const { evaluate, until, click, send } = browser;
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1460,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: origin });
  await until('document.querySelector("#sign-in") && document.readyState === "complete"');
  await evaluate(
    `document.querySelector('[name=email]').value='exams@example.com'; document.querySelector('[name=password]').value='correct horse battery staple'; document.querySelector('#sign-in').requestSubmit()`
  );
  await until('document.querySelector(".study-dashboard")');
  await click('.exam-dashboard');
  await until('!document.querySelector("#exam-planner").hidden');
  assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'), 0);
  await click('[data-schedule-action=edit]');
  await click('.exam-import summary');
  const input = async (selector, value) =>
    evaluate(
      `{ const input = document.querySelector(${JSON.stringify(selector)}); input.value=${JSON.stringify(value)}; input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true})); }`
    );
  const text =
    'TDT4100 Object-oriented programming\nMidterm 14.10.2026 09:00–11:00\nFinal exam 10.12.2026 09:00–13:00\nTMA4100 Calculus\nFinal exam 10.12.2026 12:00–16:00\nTFE4146 Sensors\nFinal exam 10.12.2026';
  await input('#exam-import-text', text);
  await click('[data-exam-action=preview]');
  await until('document.querySelectorAll(".exam-preview .exam-row").length === 4');
  assert.equal(
    app.workspaces.account(user.id).library.examPlan,
    undefined,
    'Preview never persists raw import or candidates'
  );
  assert.equal(await evaluate('document.querySelector("#exam-import-text").value'), '');
  await click('[data-exam-action=accept]');
  assert.equal(await evaluate('document.querySelector("#exam-order").value'), 'date');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".exam-groups [data-exam-field=date]")].map(input => input.value)'),
    ['2026-10-14', '2026-12-10', '2026-12-10', '2026-12-10']);
  await input('#exam-order', 'course');
  assert.equal(await evaluate('document.querySelectorAll(".exam-course").length'), 3);
  assert.equal(
    await evaluate('document.querySelector(".exam-course").querySelectorAll(".exam-row").length'),
    2
  );
  await evaluate(
    `for (let i = 0; i < 4; i++) document.querySelectorAll('.exam-groups [data-exam-field=selected]')[i].click()`
  );
  assert.equal(await evaluate('document.querySelectorAll(".exam-status.collision").length'), 2);
  assert.equal(await evaluate('document.querySelectorAll(".exam-status.possible").length'), 1);
  assert.equal(await evaluate('document.querySelectorAll(".exam-status.clear").length'), 1);
  await click('[data-exam-action=save]');
  await until('document.querySelector(".exam-feedback").textContent === "Your plan is saved."');
  assert.equal(
    app.store.account(user.id).library.examPlan.filter((exam) => exam.selected).length,
    4
  );
  await input('#exam-import-text', text);
  await click('[data-exam-action=preview]');
  await click('[data-exam-action=accept]');
  assert.equal(
    await evaluate('document.querySelectorAll(".exam-groups .exam-row").length'),
    4,
    'Repeat import deduplicates'
  );
  assert.equal(
    await evaluate('document.querySelectorAll(".exam-groups input:checked").length'),
    4,
    'Repeat import retains intent'
  );
  await click('[data-exam-action=add]');
  assert.equal(
    await evaluate('document.activeElement.dataset.examField'),
    'courseCode',
    await evaluate('document.querySelector(".exam-feedback").textContent')
  );
  await input('.exam-groups [data-exam-field=courseCode][value=""]', 'TEST1000');
  const rowID = await evaluate(
    `[...document.querySelectorAll('[data-exam-field=courseCode]')].find(input => input.value === 'TEST1000').closest('[data-exam-id]').dataset.examId`
  );
  const row = `.exam-groups [data-exam-id="${rowID}"]`;
  await evaluate(
    `document.querySelector(${JSON.stringify(`${row} [data-exam-field=courseCode]`)}).focus()`
  );
  await send('Input.insertText', { text: 'A' });
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  });
  assert.equal(
    await evaluate('document.activeElement.dataset.examField'),
    'courseName',
    'Tab should advance to the next exam field after regrouping'
  );
  await input(`${row} [data-exam-field=courseCode]`, 'TEST1000');
  await input(
    `${row} [data-exam-field=courseName]`,
    '<img src=x onerror="window.examInjected=true">'
  );
  await input(`${row} [data-exam-field=date]`, '2026-12-12');
  await click(`${row} [data-exam-field=selected]`);
  assert.equal(await evaluate('!!window.examInjected'), false);
  assert.equal(await evaluate('document.querySelectorAll(".exam-groups img").length'), 0);
  assert.equal(
    await evaluate(`document.querySelector(${JSON.stringify(`${row} .exam-status`)}).textContent`),
    'Check date / time'
  );
  await click('[data-exam-action=save]');
  await until('document.querySelector(".exam-feedback").textContent === "Your plan is saved."');
  await click('.exam-import summary');
  await mkdir(resolve('dist/verification'), { recursive: true });
  await browser.screenshot(resolve('dist/verification/exam-planner-desktop.png'));
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await browser.screenshot(resolve('dist/verification/exam-planner-mobile.png'));
  assert.equal(
    await evaluate(
      'document.querySelector("#exam-planner-editor").scrollWidth <= document.querySelector("#exam-planner-editor").clientWidth + 1'
    ),
    true
  );
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
  // A concurrently saved native/browser edit must not be overwritten by this draft.
  app.workspaces.account(user.id).library.examPlan[0].selected = false;
  await click(`${row} [data-exam-field=selected]`);
  await click('[data-exam-action=save]');
  await until('document.querySelector(".exam-feedback").classList.contains("error")');
  assert.match(
    await evaluate('document.querySelector(".exam-feedback").textContent'),
    /changed elsewhere/
  );
  assert.equal(app.workspaces.account(user.id).library.examPlan[0].selected, false);
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(`${row} [data-exam-field=selected]`)}).checked`
    ),
    false,
    'Failed save retains the draft'
  );
  await click('[data-exam-action=reload]');
  await until('document.querySelector(".exam-feedback").textContent === "Your plan is saved."');
  await click('[data-exam-action=close]');
  assert.equal(await evaluate('document.querySelectorAll(".exam-schedule-row").length'), 4);
  // Use readable fixture labels for visual verification after the escaping test.
  fixtureAccount.library.examPlan[0].selected = true;
  const independent = fixtureAccount.library.examPlan.find(
    (exam) => exam.courseCode === 'TEST1000'
  );
  Object.assign(independent, {
    courseName: 'Independent study',
    startTime: '09:00',
    endTime: '11:00',
  });
  await send('Page.navigate', { url: `${origin}/?exam-view=fixture#exams` });
  await until(
    'document.querySelector("#exam-planner") && !document.querySelector("#exam-planner").hidden'
  );
  assert.equal(await evaluate('document.querySelector("#exam-planner-editor").hidden'), true);
  assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'), 0);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1460,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until('document.querySelector(".exam-favorites button")');
  await until('document.querySelector(".exam-schedule-feedback").textContent.includes("Saved.")');
  await input('#exam-interests', 'Robotics and practical programming; suggest useful courses for building robots.');
  await click('[data-recommend=generate]');
  await until('document.querySelector(".exam-recommendation-status").textContent.includes("Fixture provider unavailable")');
  assert.equal(await evaluate('document.querySelector("[data-recommend=generate]").disabled'), false);
  await click('[data-recommend=generate]');
  await until('document.querySelector("[data-recommend=apply]")');
  assert.equal(fixtureAccount.library.examPlan.filter((exam) => exam.selected).length, 5, 'Recommendations leave current selections unchanged');
  assert.match(await evaluate('document.querySelector(".exam-recommendation-status").textContent'), /2 courses.*3 exams.*no fixed-time clashes/);
  assert.match(await evaluate('document.querySelector(".exam-recommendation-result").textContent'), /Clashes.*missing/s);
  await browser.screenshot(resolve('dist/verification/exam-recommendation-desktop.png'));
  await click('[data-recommend=apply]');
  await until('document.querySelector(".exam-schedule-feedback").textContent.includes("Saved.")');
  assert.equal(fixtureAccount.library.examPlan.filter((exam) => exam.selected).length, 3);
  assert.equal(fixtureAccount.library.examPlan.find((exam) => exam.courseCode === 'TMA4100').selected, false);
  assert.equal(fixtureAccount.library.examPlan.find((exam) => exam.courseCode === 'TFE4146').selected, false);
  await click('[data-schedule-action=undo]');
  await until('document.querySelector(".exam-schedule-feedback").textContent.includes("Saved.")');
  assert.equal(fixtureAccount.library.examPlan.filter((exam) => exam.selected).length, 5);
  assert.match(await evaluate('document.querySelector("#exam-interests").value'), /Robotics/);
  assert.equal(
    fixtureAccount.library.courses.find((course) => course.id === 'independent').favorite,
    true
  );
  assert.equal(
    !!fixtureAccount.library.courses.find((course) => course.id === 'programming').favorite,
    false
  );
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });
  await evaluate('new Promise(resolve => setTimeout(resolve, 200))');
  await browser.screenshot(resolve('dist/verification/exam-schedule-desktop.png'));
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  });
  await evaluate('new Promise(resolve => setTimeout(resolve, 200))');
  await browser.screenshot(resolve('dist/verification/exam-schedule-dark.png'));
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await evaluate('new Promise(resolve => setTimeout(resolve, 200))');
  await browser.screenshot(resolve('dist/verification/exam-schedule-mobile.png'));
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true);
  const sensorsID = fixtureAccount.library.examPlan.find((exam) => exam.courseCode === 'TFE4146').id;
  const timingAndIntent = () => fixtureAccount.library.examPlan.map(
    ({ id, date, endDate, startTime, endTime, selected }) => ({ id, date, endDate, startTime, endTime, selected })
  );
  const beforeFlexible = timingAndIntent();
  await click(`.exam-comparison.possible [data-schedule-action=flexible][data-exam-id="${sensorsID}"][data-flexible=true]`);
  await until('document.querySelector(".exam-schedule-feedback").textContent.includes("Saved.")');
  assert.deepEqual(timingAndIntent(), beforeFlexible, 'Flexible override keeps both courses selected and every date/time unchanged');
  assert.equal(fixtureAccount.library.examPlan.find((exam) => exam.id === sensorsID).flexible, true);
  assert.equal(await evaluate('document.querySelectorAll(".exam-comparison.possible").length'), 0);
  await send('Page.navigate', { url: `${origin}/?flexible-persistence=fixture#exams` });
  await until(`document.querySelector('[data-schedule-action=flexible][data-exam-id="${sensorsID}"][data-flexible=false]')`);
  assert.match(await evaluate('document.querySelector(".exam-schedule-row.flexible").textContent'), /Date kept for reference.*arrange with professor/s);
  assert.deepEqual(timingAndIntent(), beforeFlexible, 'Flexible timing survives reload without dropping either course');
  await click(`[data-schedule-action=flexible][data-exam-id="${sensorsID}"][data-flexible=false]`);
  await until('document.querySelector(".exam-schedule-feedback").textContent.includes("Saved.")');
  assert.equal(fixtureAccount.library.examPlan.find((exam) => exam.id === sensorsID).flexible, false);
  assert.ok(await evaluate('document.querySelector(".exam-comparison.possible") !== null'), 'Restoring fixed timing restores the possible overlap');
  await click('.exam-comparison.possible [data-schedule-action=choose]');
  await until('document.querySelector(".exam-schedule-feedback").textContent.includes("Saved.")');
  const afterChoice = app.workspaces.account(user.id).library.examPlan;
  assert.equal(afterChoice.find((exam) => exam.courseCode === 'TFE4146').selected, false);
  await click('[data-schedule-action=undo]');
  await until('document.querySelector(".exam-schedule-feedback").textContent.includes("Saved.")');
  assert.equal(
    app.workspaces.account(user.id).library.examPlan.find((exam) => exam.courseCode === 'TFE4146')
      .selected,
    true
  );
  await click('.exam-comparison.collision [data-keep][data-drop]');
  await until('document.querySelector(".exam-schedule-feedback").textContent.includes("Saved.")');
  await click('.exam-comparison.possible [data-keep][data-drop]');
  await until('!document.querySelector(".exam-comparison")');
  assert.equal(
    fixtureAccount.library.courses.find((course) => course.id === 'programming').favorite,
    true
  );
  assert.equal(
    !!fixtureAccount.library.courses.find((course) => course.id === 'calculus').favorite,
    false
  );
  await click('[data-schedule-action=undo]');
  await until('document.querySelector(".exam-comparison")');
  assert.equal(
    fixtureAccount.library.courses.find((course) => course.id === 'programming').favorite,
    false
  );
  const selectedIDs = () => fixtureAccount.library.examPlan.filter((exam) => exam.selected).map((exam) => exam.id).sort();
  const beforeBulk = selectedIDs();
  await click('.exam-course-selection summary');
  await click('.exam-course-selection [data-schedule-action=clearAll]');
  await until('document.querySelector(".exam-schedule-feedback").textContent.includes("Saved.")');
  assert.deepEqual(selectedIDs(), [], 'Clear selection clears every course component');
  assert.equal(await evaluate('document.querySelectorAll(".exam-schedule-row").length'), 0);
  assert.equal(await evaluate('document.querySelector(".exam-course-selection").open'), true);
  assert.equal(await evaluate('document.querySelector("[data-schedule-action=clearAll]").disabled'), true);
  await click('[data-schedule-action=undo]');
  await until('document.querySelector(".exam-schedule-feedback").textContent.includes("Saved.")');
  assert.deepEqual(selectedIDs(), beforeBulk, 'Undo restores the previous course selection');
  await click('.exam-course-selection [data-schedule-action=clearAll]');
  await until('document.querySelector(".exam-schedule-feedback").textContent.includes("Saved.")');
  await click('.exam-course-selection [data-schedule-action=selectAll]');
  await until('document.querySelector(".exam-schedule-feedback").textContent.includes("Saved.")');
  assert.equal(selectedIDs().length, fixtureAccount.library.examPlan.length);
  assert.equal(fixtureAccount.library.examPlan.filter((exam) => exam.courseCode === 'TDT4100' && exam.selected).length, 2, 'Select all includes both midterm and final exam for a course');
  assert.equal(await evaluate('document.querySelector("[data-schedule-action=selectAll]").disabled'), true);
  assert.equal(await evaluate('document.querySelector(".exam-course-selection").open'), true, 'Bulk actions retain the open course selection');
  await click('[data-schedule-action=undo]');
  await until('document.querySelector(".exam-schedule-feedback").textContent.includes("Saved.")');
  assert.deepEqual(selectedIDs(), [], 'Undo Select all restores the cleared plan');
  await click('.exam-course-selection [data-schedule-action=selectAll]');
  await until('document.querySelector(".exam-schedule-feedback").textContent.includes("Saved.")');
  await click('[data-schedule-action=edit]');
  const oralRow = `.exam-groups [data-exam-id="${sensorsID}"]`;
  await input(`${oralRow} [data-exam-field=component]`, 'Oral exam');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(`${oralRow} [data-exam-field=flexible]`)}).checked`), true, 'Changing the component to Oral exam defaults to flexible timing');
  assert.match(await evaluate(`document.querySelector(${JSON.stringify(`${oralRow} .exam-status`)}).textContent`), /Flexible/);
  await click('[data-exam-action=save]');
  await until('document.querySelector(".exam-feedback").textContent === "Your plan is saved."');
  assert.equal(fixtureAccount.library.examPlan.find((exam) => exam.id === sensorsID).flexible, true);
  await send('Page.navigate', { url: `${origin}/?oral-default=fixture#exams` });
  await until(`document.querySelector('[data-schedule-action=flexible][data-exam-id="${sensorsID}"][data-flexible=false]')`);
  await click('[data-schedule-action=edit]');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(`${oralRow} [data-exam-field=flexible]`)}).checked`), true);
  await click(`${oralRow} [data-exam-field=flexible]`);
  await click('[data-exam-action=save]');
  await until('document.querySelector(".exam-feedback").textContent === "Your plan is saved."');
  assert.equal(fixtureAccount.library.examPlan.find((exam) => exam.id === sensorsID).flexible, false);
  await send('Page.navigate', { url: `${origin}/?oral-fixed-override=fixture#exams` });
  await until('document.querySelector(".exam-comparison.possible")');
  await click('[data-schedule-action=edit]');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(`${oralRow} [data-exam-field=component]`)}).value`), 'Oral exam');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(`${oralRow} [data-exam-field=flexible]`)}).checked`), false, 'Explicit fixed timing for an oral survives saving and reload');
  assert.deepEqual(browser.errors, []);
  console.log(
    'Exam planner Chromium smoke passed: flexible overlap override/restore, oral defaults and fixed override persistence, Select all/Clear selection/Undo, chronological sorting, recommendation retry/apply/undo, import review, grouping, intent, collisions, duplicate safety, manual editing, persistence, stale save, mobile and deep link.'
  );
} finally {
  await browser?.close();
  await app.close();
  await rm(root, { recursive: true, force: true });
}
