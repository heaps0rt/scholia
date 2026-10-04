import { escapeHtml as esc } from '../../chrome/src/render.js';
import { analyzeExamCollisions, compareExamDates, normalizeExamPlan } from '../../../packages/core/src/exam-planner.js';

export function installExamRecommendation({ getState, recommend, apply }) {
  const element = document.createElement('section');
  element.className = 'exam-recommendation';
  element.setAttribute('aria-labelledby', 'exam-recommendation-title');
  element.innerHTML = `<h2 id="exam-recommendation-title">A plan that fits you</h2>
    <label for="exam-interests">Your interests and study goals</label>
    <p>Tell me what interests you, what you want to use it for, and how many courses you want to take. Mention any courses you must keep.</p>
    <textarea id="exam-interests" rows="5" maxlength="4000" placeholder="For example: I enjoy programming and physics, want to build robots, and would like three useful courses."></textarea>
    <p class="exam-help exam-recommendation-model"></p>
    <div class="exam-recommendation-actions"><button type="button" data-recommend="generate">Recommend exams</button><button type="button" data-recommend="cancel" hidden>Cancel</button></div>
    <p class="exam-recommendation-status" role="status" aria-live="polite"></p><div class="exam-recommendation-result"></div>`;
  const $ = (selector) => element.querySelector(selector);
  const input = $('#exam-interests'), status = $('.exam-recommendation-status'), output = $('.exam-recommendation-result');
  let controller = null, generation = 0, baseline = null, result = null;
  const exams = () => getState()?.library.examPlan || [];
  const signature = () => JSON.stringify(exams());
  function controls() {
    input.disabled = Boolean(controller);
    $('[data-recommend=generate]').disabled = Boolean(controller) || !input.value.trim() || !exams().length;
    $('[data-recommend=generate]').textContent = controller ? 'Finding a selection…' : 'Recommend exams';
    $('[data-recommend=cancel]').hidden = !controller;
  }
  function clear() { result = null; output.replaceChildren(); }
  function cancel() {
    generation++;
    controller?.abort(); controller = null;
    controls();
  }
  function refresh() {
    $('.exam-recommendation-model').textContent = `Uses ${getState()?.modelID || 'your selected model'}, your interests, exam dates and course titles. Review the suggestion before applying it.`;
    if (baseline !== null && baseline !== signature()) {
      cancel(); clear(); baseline = null;
      status.textContent = 'Your plan changed. Request a fresh recommendation.';
    }
    controls();
  }
  input.addEventListener('input', () => { clear(); status.textContent = ''; controls(); });
  $('[data-recommend=cancel]').addEventListener('click', () => { cancel(); status.textContent = 'Recommendation canceled.'; });
  $('[data-recommend=generate]').addEventListener('click', async () => {
    if (controller || !input.value.trim() || !exams().length) return;
    clear(); baseline = signature();
    const requestExams = JSON.parse(baseline), ticket = ++generation;
    controller = new AbortController(); controls();
    status.classList.remove('error'); status.textContent = 'Considering your interests and checking every exam component…';
    try {
      const response = await recommend({ exams: requestExams, interests: input.value }, controller.signal);
      if (ticket !== generation) return;
      if (baseline !== signature()) throw new Error('Your plan changed. Request a fresh recommendation.');
      result = response;
      const selected = new Set(result.selectedExamIDs);
      const checked = normalizeExamPlan(requestExams).filter((exam) => selected.has(exam.id)).map((exam) => ({ ...exam, selected: true }));
      if (checked.length !== selected.size || checked.some((exam) => !exam.flexible && (!exam.date || !exam.startTime || !exam.endTime)) || analyzeExamCollisions(checked).collisions.length)
        throw new Error('The suggested exams could not be verified. Request a fresh recommendation.');
      status.textContent = result.choices.length ? `${result.choices.length} courses · ${selected.size} exams · no fixed-time clashes` : 'No complete selection found. Review the details below or adjust your goals.';
      output.innerHTML = result.choices.map((choice) => {
        const rows = checked.filter((exam) => (exam.courseCode.replace(/[\s-]+/g, '').toUpperCase() || exam.courseName.toLowerCase()) === choice.courseKey).sort(compareExamDates);
        return `<article><h3>${esc(choice.courseCode || choice.courseName)}${choice.courseCode && choice.courseName ? ` · ${esc(choice.courseName)}` : ''}</h3><p>${esc(choice.reason)}</p><ul>${rows.map((exam) => `<li>${esc(exam.date)} · ${esc(exam.startTime)}–${esc(exam.endTime)} · ${esc(exam.component)}${exam.endDate ? ` · ends ${esc(exam.endDate)}` : ''}${exam.flexible ? ' · Flexible timing: arrange with professor' : ''}</li>`).join('')}</ul></article>`;
      }).join('') + (result.excluded.length ? `<details><summary>Why other courses were left out</summary>${result.excluded.map((choice) => `<p><strong>${esc(choice.courseCode || choice.courseName)}:</strong> ${esc(choice.reason)}</p>`).join('')}</details>` : '')
        + (selected.size ? '<button type="button" class="primary" data-recommend="apply">Use this selection</button><p class="exam-help">Replaces your current exam selection. You can undo this afterwards.</p>' : '');
    } catch (error) {
      if (ticket !== generation) return;
      clear(); status.classList.add('error'); status.textContent = error.message;
    } finally {
      if (ticket === generation) { controller = null; controls(); }
    }
  });
  output.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-recommend=apply]') || !result) return;
    if (baseline !== signature()) { refresh(); return; }
    const ids = new Set(result.selectedExamIDs);
    await apply(exams().map((exam) => ({ ...exam, selected: ids.has(exam.id) })));
  });
  refresh();
  return { element, refresh, cancel };
}
