import { escapeHtml as esc } from '../chrome/src/render.js';

// Native JSON object keys have no ordering guarantee. Equivalent responses must
// produce the same render key, or idle polling would disturb text selections.
export function studyRenderKey(value) {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]])
        )
      : item
  );
}

export const teachingModes = [
  {
    mode: 'Explain',
    title: 'Explain the key idea',
    summary: 'Build intuition with clear explanations and examples.',
  },
  {
    mode: 'Guide me',
    title: 'Work through an example',
    summary: 'Work it out with one hint at a time.',
  },
  {
    mode: 'Practice',
    title: 'Check my understanding',
    summary: 'Try a question, then get feedback on your answer.',
  },
];

export function studyPrompt(mode, document) {
  const scope = !document
    ? 'the downloaded course materials'
    : document.kind === 'notebook'
      ? 'this notebook cell'
      : ['code', 'office'].includes(document.kind)
        ? 'this section'
        : 'this page';
  if (mode === 'Guide me')
    return `Help me work through an example from ${scope}, one step at a time. Start with a hint and wait for my attempt.`;
  if (mode === 'Practice')
    return `Ask me one question to test my understanding of ${scope}. Wait for my answer before giving feedback or a solution.`;
  return `Explain the key idea in ${scope}, with an intuitive example.`;
}

export function appendStudyPrompt(draft, prompt) {
  if (!draft.trim()) return prompt;
  return draft.includes(prompt) ? draft : `${draft}\n\n${prompt}`;
}

export function recentReadings(courses, limit = 3) {
  return courses
    .flatMap((course) =>
      course.documents
        .filter((document) => Number.isFinite(document.lastOpenedAt))
        .map((document) => ({ course, document }))
    )
    .sort(
      (a, b) =>
        b.document.lastOpenedAt - a.document.lastOpenedAt ||
        a.document.id.localeCompare(b.document.id)
    )
    .slice(0, Math.max(0, limit));
}

export function readingPosition(document) {
  const count = Math.max(1, document.pageCount || 1),
    page = Math.min(count, Math.max(1, document.lastPage || 1));
  const unit =
    document.kind === 'notebook'
      ? 'Cell'
      : ['code', 'office'].includes(document.kind)
        ? 'Section'
        : 'Page';
  return `${unit} ${page} of ${count}`;
}

export function continueReadingMarkup(readings) {
  if (!readings.length) return '';
  return `<section class="continue-reading" aria-label="Continue reading"><div class="continue-heading"><h2>Continue reading</h2><span>Your place is saved</span></div>
    <div class="recent-readings">${readings
      .map(
        ({
          course,
          document,
        }) => `<button class="recent-reading" data-action="resume" data-id="${esc(document.id)}" aria-label="Resume ${esc(document.title)}, ${esc(readingPosition(document).toLowerCase())}">
      <span class="recent-course">${esc(course.code || course.name)}<span aria-hidden="true">↗</span></span>
      <strong>${esc(document.title)}</strong><span class="recent-position">${esc(readingPosition(document))}</span>
    </button>`
      )
      .join('')}</div></section>`;
}

// Reading surfaces depend on their content, not on chat drafts, tokens, or last-open times.
export function readerRenderKey(state) {
  const course = state.library.courses.find((c) => c.id === state.library.selectedCourseID);
  const document = course?.documents.find((d) => d.id === state.library.selectedDocumentID);
  if (!document)
    return studyRenderKey([
      false,
      course?.id,
      course?.name,
      course?.code,
      course?.canvasID,
      course?.catalogUpdatedAt,
      course?.catalogChanges,
      course?.hiddenAssignmentIDs,
      course?.documents,
      state.materialGroups,
      state.materialFiles,
      state.busy,
      state.library.selectedAssignmentID,
      course?.canvasID
        ? [
            course.canvasMaterials?.filter((m) => m.kind === 'assignments'),
            Math.floor(Date.now() / 60000),
          ]
        : null,
    ]);
  const { lastOpenedAt, lastPage, ...content } = document;
  return studyRenderKey([
    false,
    course.id,
    content,
    state.page,
    state.pageText,
    !!state.loadingDocument,
  ]);
}

export function studyPollDelay(state, hidden = false, failed = false) {
  if (hidden) return 15000;
  if (failed) return 6000;
  if (state?.loadingDocument) return 450;
  return state?.streaming ? 650 : state?.busy ? 1200 : 3500;
}
