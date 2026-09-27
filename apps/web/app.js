import { StudyPDFReader } from './pdf-reader.js';
import { StudyNotebookReader } from './notebook-reader.js';
import { StudyDocumentEditor, canEditDocument } from './document-editor.js';
import { renderMarkdown, escapeHtml as esc } from '../chrome/src/render.js';
import {
  courseLibraryMarkup,
  courseDisplayName,
  courseLibraryRenderKey,
  catalogChangeSummary,
} from './course-library.js';
import { installHostedAccount } from './hosted-account.js';
import { installTutorResize } from './workspace-resize.js';
import { materialGroupsMarkup, materialsViewMarkup, materialViewPicker } from './materials.js';
import { assignmentsMarkup, selectedAssignment, assignmentPageMarkup } from './assignments.js';
import {
  teachingModes,
  studyPrompt,
  appendStudyPrompt,
  recentReadings,
  continueReadingMarkup,
  readerRenderKey,
  studyPollDelay,
  studyRenderKey,
} from './study-session.js';
import { StudyConversation } from './study-conversation.js';
import { StudyPractice } from './practice.js';
import './style.css';
import './dashboard.css';
import './assignment-page.css';

const $ = (selector) => document.querySelector(selector);
installTutorResize($('#workspace'), $('#tutor-divider'));
const hosted = !!document.querySelector('meta[name="scholia-hosted"]');
const accountID = document.querySelector('meta[name="scholia-account"]')?.content || 'local';
const preferenceKey = (name) => (hosted ? `${name}:${accountID}` : name);
const token = $('meta[name="scholia-token"]').content;
const conversation = new StudyConversation($('#messages'));
let state,
  lastLayout = '',
  lastNavigation = '',
  lastMessages = '',
  lastModels = '';
let lastAssignment = '';
let closedSections;
try {
  closedSections = new Set(
    JSON.parse(localStorage.getItem(preferenceKey('scholia.collapsedSections')) || '[]')
  );
} catch {
  closedSections = new Set();
}
function persistSections() {
  try {
    localStorage.setItem(
      preferenceKey('scholia.collapsedSections'),
      JSON.stringify([...closedSections])
    );
  } catch {}
}
let materialViews;
try {
  materialViews =
    JSON.parse(localStorage.getItem(preferenceKey('scholia.materialViews')) || '{}') || {};
} catch {
  materialViews = {};
}
function selectMaterialView(view) {
  materialViews[course().id] = view === 'files' ? 'files' : 'organized';
  try {
    localStorage.setItem(preferenceKey('scholia.materialViews'), JSON.stringify(materialViews));
  } catch {}
  renderMaterials();
}
let courseQuery = '',
  materialQuery = '',
  selectedText = '',
  imageData = null;
let includeCompletedAssignments = false;
let agendaQuery = '',
  agendaFilter = 'due';
let pdfReader,
  notebookReader,
  readerGeneration = 0,
  readerURLs = [];
let documentEditor;
const editDocuments = new Map();
let actionQueue = Promise.resolve(),
  draftTimer,
  toastTimer,
  pollActive = false,
  revision = 0,
  pendingActions = 0;
let draftDirty = false,
  previousContext = '',
  localError = '',
  draftOwner = null,
  draftRecovered = false;
const ownDraftUpdates = new Map();
function latestOwnOwner(owner) {
  const seen = new Set();
  while (owner && ownDraftUpdates.has(studyRenderKey(owner)) && !seen.has(studyRenderKey(owner))) {
    const key = studyRenderKey(owner);
    seen.add(key);
    owner = ownDraftUpdates.get(key);
  }
  return owner;
}
let pollTimer,
  pollFailed = false,
  sendPending = false;
let lastComposerText, lastComposerWidth;
const course = () =>
  state?.library.courses.find((item) => item.id === state.library.selectedCourseID);
const doc = () => course()?.documents.find((item) => item.id === state.library.selectedDocumentID);
const practice = new StudyPractice({
  dialog: $('#practice-dialog'),
  request,
  getState: () => state,
  getSelection: () => selectedText,
  notify,
  onSource: async (question) => {
    await navigate('course', { id: question.source.courseID });
    await navigate('source', { id: question.source.documentID, page: question.source.page });
  },
  onExplain: async (question) => {
    await navigate('course', { id: question.source.courseID });
    await navigate('source', { id: question.source.documentID, page: question.source.page });
    await navigate('newThread');
    $('#question').value =
      `Explain this practice question with a worked example:\n${question.prompt}\n\nReference solution:\n${question.referenceAnswer || ''}`;
    draftDirty = true;
    draftOwner = state.draftOwner;
    persistBrowserDraft();
    await saveDraft('Explain');
  },
});
function persistBrowserDraft() {
  try {
    if (draftDirty)
      sessionStorage.setItem(
        preferenceKey('scholia.study.draft'),
        JSON.stringify({ ...draftValues(), owner: draftOwner })
      );
    else sessionStorage.removeItem(preferenceKey('scholia.study.draft'));
  } catch {
    notify('Could not keep a browser recovery copy. Keep this tab open until your draft is saved.');
  }
}

const remoteMaterials = (item) =>
  (item.canvasMaterials || []).filter(
    (material) => !item.documents.some((document) => document.sourceKey === material.id)
  );
const button = (label, action, id = '', cls = '') =>
  `<button class="${cls}" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
const safeURL = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? esc(url.href) : '';
  } catch {
    return '';
  }
};
const courseURL = (item) =>
  item.canvasID ? safeURL(`${item.canvasOrigin}/courses/${item.canvasID}`) : '';

async function request(path, payload, signal) {
  const response = await fetch(path, {
    method: payload ? 'POST' : 'GET',
    headers: {
      'X-Scholia-Token': token,
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
    signal,
  });
  if (hosted && response.status === 401) {
    location.replace('/login');
    throw new Error('Sign in to continue.');
  }
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error || `Scholia returned ${response.status}.`), {
      status: response.status,
    });
  return result;
}
function notify(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('#toast').hidden = true;
  }, 6000);
}
function action(actionName, values = {}) {
  revision++;
  pendingActions++;
  const owned = ['draft', 'send', 'page'].includes(actionName);
  if (owned && !values.owner)
    values = {
      ...values,
      owner: ['draft', 'send'].includes(actionName)
        ? draftOwner || state.draftOwner
        : state.draftOwner,
    };
  const job = actionQueue
    .catch(() => {})
    .then(async () => {
      const owner = owned ? latestOwnOwner(values.owner) : undefined;
      const next = await request('/api/action', {
        action: actionName,
        ...values,
        ...(owned ? { owner } : {}),
      });
      $('#connection-error').hidden = true;
      if (owned) {
        if (studyRenderKey(latestOwnOwner(draftOwner)) === studyRenderKey(owner))
          draftOwner = next.draftOwner;
        if (studyRenderKey(owner) !== studyRenderKey(next.draftOwner)) {
          ownDraftUpdates.delete(studyRenderKey(next.draftOwner));
          ownDraftUpdates.set(studyRenderKey(owner), next.draftOwner);
        }
        if (ownDraftUpdates.size > 100) ownDraftUpdates.delete(ownDraftUpdates.keys().next().value);
      }
      update(next);
      schedulePoll();
      return next;
    });
  job
    .finally(() => {
      pendingActions--;
    })
    .catch(() => {});
  actionQueue = job.catch((error) => {
    notify(error.message);
  });
  return job;
}
async function poll() {
  clearTimeout(pollTimer);
  if (pendingActions || pollActive || (document.hidden && state)) {
    schedulePoll();
    return;
  }
  pollActive = true;
  const before = revision;
  try {
    const next = await request('/api/state', null, AbortSignal.timeout(6000));
    if (revision === before) update(next);
    $('#connection-error').hidden = true;
    pollFailed = false;
  } catch (error) {
    pollFailed = true;
    $('#connection-error').hidden = false;
    $('#connection-error').textContent = hosted
      ? 'The server is unavailable. Retrying… Your draft is kept in this tab.'
      : 'The Mac connection is unavailable. Keep Scholia running, then reopen this website from its Open in Browser menu.';
  } finally {
    pollActive = false;
    schedulePoll();
  }
}
function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, studyPollDelay(state, document.hidden, pollFailed));
}
const updateAccount = installHostedAccount({ request, notify, update });
function update(next) {
  state = next;
  if (!draftRecovered) {
    draftRecovered = true;
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(preferenceKey('scholia.study.draft')) || 'null'
      );
      if (saved?.owner && (saved.text || saved.image)) {
        $('#question').value = saved.text || '';
        imageData = saved.image || null;
        selectedText = saved.selection || '';
        draftOwner = saved.owner;
        draftDirty = true;
      }
    } catch {}
  }
  if (!draftDirty) draftOwner = state.draftOwner;
  $('#review-due').textContent = `Review due${state.reviewDue ? ` (${state.reviewDue})` : ''}`;
  $('#practice-this').hidden = state.showingLibrary || !course();
  const context = `${state.library.selectedCourseID}:${state.library.selectedDocumentID}:${state.library.selectedThreadID}`;
  if (context !== previousContext) {
    // Native navigation takes effect in this view too; unsaved browser typing is
    // sent before browser-initiated navigation by navigate().
    if (!draftDirty) {
      $('#question').value = state.draft;
      imageData = state.draftImage || null;
    }
    if (!draftDirty) selectedText = '';
    previousContext = context;
  }
  if (!draftDirty && document.activeElement !== $('#question')) {
    $('#question').value = state.draft;
    imageData = state.draftImage || null;
  }
  const navigation = studyRenderKey([
    state.library.courses.map((c) => [c.id, c.name, c.code, c.favorite, c.documents.length]),
    state.showingLibrary
      ? null
      : [state.materialGroups, course()?.threads.map((t) => [t.id, t.title])],
    state.library.selectedCourseID,
    state.library.selectedDocumentID,
    state.library.selectedAssignmentID,
    state.library.selectedThreadID,
    state.showingLibrary,
    state.busy,
  ]);
  if (navigation !== lastNavigation) {
    renderNavigation();
    lastNavigation = navigation;
  }
  $('#library').hidden = !state.showingLibrary;
  $('#workspace').hidden = state.showingLibrary;
  $('#add-document').hidden = state.showingLibrary;
  const assignment = state.showingLibrary ? null : selectedAssignment(state);
  const assignmentKey = studyRenderKey([
    assignment,
    state.assignmentText,
    state.assignmentPDFs,
    state.assignmentNotice,
    state.busy,
    doc()?.sourceKey,
  ]);
  if (assignmentKey !== lastAssignment) {
    const sameAssignment =
      $('#assignment-page').dataset.assignment === `${course()?.id}:${assignment?.id}`;
    const expanded = $('.assignment-instructions')?.open;
    $('#assignment-page').innerHTML = assignment ? assignmentPageMarkup(state) : '';
    $('#assignment-page').dataset.assignment = `${course()?.id}:${assignment?.id}`;
    if (sameAssignment && expanded !== undefined && $('.assignment-instructions'))
      $('.assignment-instructions').open = expanded;
    lastAssignment = assignmentKey;
  }
  $('#assignment-page').hidden = !assignment;
  $('#assignment-page').classList.toggle('without-pdf', !!assignment && !doc());
  for (const id of ['reader-content', 'reader-toolbar', 'reader-footer'])
    $(`#${id}`).hidden = !!assignment && !doc();
  if (state.showingLibrary && pdfReader) {
    pdfReader.destroy();
    pdfReader = null;
  }
  if (state.showingLibrary && notebookReader) {
    notebookReader.destroy();
    notebookReader = null;
  }
  if (state.showingLibrary && documentEditor) {
    documentEditor.destroy();
    documentEditor = null;
  }
  const layout = state.showingLibrary ? courseLibraryRenderKey(state) : readerRenderKey(state);
  // Chat bodies aren't part of course() in the API: streaming doesn't recreate the PDF.
  if (layout !== lastLayout) {
    if (state.showingLibrary) renderLibrary();
    else renderReader().catch((error) => notify(error.message));
    lastLayout = layout;
  }
  const title = state.showingLibrary
    ? 'Dashboard'
    : course()?.code || course()?.name || 'Your study space';
  $('#breadcrumb').innerHTML =
    `${button(esc(title), state.showingLibrary ? 'library' : 'materials')}${assignment ? `<span>›</span>${esc(assignment.title)}` : doc() && !state.showingLibrary ? `<span>›</span>${esc(doc().title)}` : ''}`;
  const messages = studyRenderKey([
    state.messages,
    state.sources,
    state.streaming,
    state.library.selectedThreadID,
  ]);
  if (messages !== lastMessages) {
    renderMessages();
    lastMessages = messages;
  }
  const models = studyRenderKey([state.models, state.providerID, state.modelID]);
  if (models !== lastModels) {
    const groups = new Map();
    for (const model of state.models) {
      if (!groups.has(model.provider)) groups.set(model.provider, []);
      groups.get(model.provider).push(model);
    }
    $('#model-picker').innerHTML = [...groups]
      .map(
        ([provider, models]) =>
          `<optgroup label="${esc(provider)}">${models.map((model) => `<option value="${esc(JSON.stringify([model.providerID, model.id]))}" ${model.id === state.modelID && model.providerID === state.providerID ? 'selected' : ''}>${esc(model.label)}</option>`).join('')}</optgroup>`
      )
      .join('');
    if (!state.models.length)
      $('#model-picker').innerHTML = '<option>Set up a model in the Mac app</option>';
    if (
      state.models.length &&
      !state.models.some((m) => m.id === state.modelID && m.providerID === state.providerID)
    )
      $('#model-picker').insertAdjacentHTML(
        'afterbegin',
        '<option selected disabled>Choose a verified model</option>'
      );
    lastModels = models;
  }
  document.querySelectorAll('[data-mode]').forEach((el) => {
    el.classList.toggle('active', el.dataset.mode === state.mode);
    el.setAttribute('aria-pressed', el.dataset.mode === state.mode);
    el.disabled = sendPending || state.streaming;
  });
  $('#mode-description').textContent =
    teachingModes.find((item) => item.mode === state.mode)?.summary || '';
  $('#include-course').checked = state.includeCourse;
  $('#context-label').textContent =
    doc()?.kind === 'notebook'
      ? `Cell ${state.page} + full notebook context`
      : doc()
        ? `${['code', 'office'].includes(doc().kind) ? 'Section' : 'Page'} ${state.page} + document context`
        : 'Downloaded course materials';
  $('#context-summary').textContent = state.context || '';
  $('#canvas-account').textContent = state.library.canvasUserName || 'Bring your courses along';
  updateAccount(state);
  $('#canvas-origin').value =
    document.activeElement === $('#canvas-origin')
      ? $('#canvas-origin').value
      : state.library.canvasOrigin;
  $('#canvas-notices').innerHTML = [state.status, ...state.warnings]
    .filter(Boolean)
    .map((line) => `<p>${esc(line)}</p>`)
    .join('');
  $('#status').hidden = !state.status;
  $('#status').classList.toggle('busy', state.busy);
  $('#status').innerHTML = state.status
    ? `<span>${esc(state.status)}</span>${state.busy ? button('Stop', 'cancelSync') : ''}${state.warnings.length ? button(`${state.warnings.length} notices`, 'canvas') : ''}`
    : '';
  document.querySelectorAll('#canvas-dialog [data-action^=connect]').forEach((el) => {
    el.disabled = state.busy;
  });
  if (state.error && state.error !== localError) notify(state.error);
  localError = state.error || '';
  renderComposer();
}
function renderNavigation() {
  const searchFocused = document.activeElement?.id === 'sidebar-material-search';
  const caret = searchFocused
    ? [document.activeElement.selectionStart, document.activeElement.selectionEnd]
    : null;
  $('#course-count').textContent = state.library.courses.length;
  $('#course-count').hidden = !state.showingLibrary;
  $('#workspace-heading').hidden = !state.showingLibrary;
  $('#workspace-heading').innerHTML =
    `${button(`${closedSections.has('workspaces') ? '›' : '⌄'} YOUR WORKSPACES`, 'collapseWorkspaces', '', 'section-toggle')}${button('+', 'create')}`;
  $('#workspace-heading .section-toggle').setAttribute(
    'aria-expanded',
    !closedSections.has('workspaces')
  );
  $('#course-nav').hidden = state.showingLibrary && closedSections.has('workspaces');
  $('.nav-all').classList.toggle('workspace-back', !state.showingLibrary);
  $('.nav-all > span:first-child').textContent = state.showingLibrary ? '▦' : '←';
  const sorted = [...state.library.courses].sort(
    (a, b) => Number(!!b.favorite) - Number(!!a.favorite) || a.name.localeCompare(b.name)
  );
  const visible = sorted.slice(0, 7);
  if (course() && !visible.some((c) => c.id === course().id)) visible.push(course());
  $('#course-nav').innerHTML = visible
    .map(
      (c) =>
        `<button class="course-nav-item ${course()?.id === c.id && !state.showingLibrary ? 'active' : ''}" data-action="course" data-id="${c.id}"><span>${c.favorite ? '★' : '▤'}</span><span><strong>${esc(c.code || c.name)}</strong><small>${esc(c.code ? courseDisplayName(c) : `${c.documents.length} documents`)}</small></span></button>`
    )
    .join('');
  if (sorted.length > 7)
    $('#course-nav').insertAdjacentHTML(
      'beforeend',
      button(`Browse all ${sorted.length} courses`, 'library', '', 'thread-nav-item')
    );
  if (!state.showingLibrary && course()) {
    $('#course-nav').innerHTML =
      `<div class="workspace-identity"><span class="eyebrow">${esc(course().code || 'YOUR WORKSPACE')}</span><h2>${esc(courseDisplayName(course()))}</h2><small>${esc(course().term || 'Your own pace')}</small>${button('Course overview', 'materials', '', 'workspace-overview')}</div>`;
  }
  $('#material-nav').innerHTML =
    !state.showingLibrary && course()
      ? `<div class="section-label">${button(`${closedSections.has('materials') ? '›' : '⌄'} MATERIALS`, 'collapseMaterials', '', 'section-toggle')}${button('+', 'upload')}</div>${closedSections.has('materials') ? '' : `<input id="sidebar-material-search" class="sidebar-material-search" placeholder="Find a reading…" aria-label="Find a course material" value="${esc(materialQuery)}">${materialGroupsMarkup(state.materialGroups || [], { compact: true, savedLabel: hosted ? 'Saved to your account' : 'Saved offline', courseID: course().id, selectedID: doc()?.id, selectedAssignmentID: state.library.selectedAssignmentID, query: materialQuery, closed: closedSections, busy: state.busy })}`}`
      : '';
  $('#material-nav .section-toggle')?.setAttribute(
    'aria-expanded',
    !closedSections.has('materials')
  );
  $('#thread-nav').innerHTML =
    !state.showingLibrary && course()?.threads.length
      ? `<div class="section-label">CONVERSATIONS ${button('+', 'newThread')}</div>${[
          ...course().threads,
        ]
          .reverse()
          .map(
            (thread) =>
              `<button class="thread-nav-item ${thread.id === state.library.selectedThreadID ? 'active' : ''}" ${thread.id === state.library.selectedThreadID ? 'aria-current="true"' : ''} data-action="thread" data-id="${thread.id}">◌ &nbsp; ${esc(thread.title)}</button>`
          )
          .join('')}`
      : '';
  if (searchFocused && $('#sidebar-material-search')) {
    $('#sidebar-material-search').focus({ preventScroll: true });
    $('#sidebar-material-search').setSelectionRange(...caret);
  }
}
function renderLibrary() {
  const focused = [
    'course-search',
    'assignment-search',
    'workspace-filter',
    'semester-picker',
    'agenda-filter',
  ].includes(document.activeElement?.id)
    ? document.activeElement
    : null;
  const selection =
    focused?.tagName === 'INPUT' ? [focused.selectionStart, focused.selectionEnd] : null;
  const scroll = ['.workspace-scroll', '.agenda-scroll'].map((selector) => [
    selector,
    $(selector)?.scrollTop || 0,
  ]);
  $('#library').innerHTML = courseLibraryMarkup(state, courseQuery, {
    query: agendaQuery,
    filter: agendaFilter,
  });
  for (const [selector, top] of scroll) if ($(selector)) $(selector).scrollTop = top;
  if (focused && $(`#${focused.id}`)) {
    $(`#${focused.id}`).focus({ preventScroll: true });
    if (selection) $(`#${focused.id}`).setSelectionRange(...selection);
  }
}

async function renderReader() {
  const generation = ++readerGeneration;
  const item = doc(),
    c = course();
  const savedLabel = hosted ? 'Saved to your account' : 'Saved offline';
  if (!c) return;
  const edit = editDocuments.get(item?.id);
  if (documentEditor && (documentEditor.id !== item?.id || !edit)) {
    documentEditor.destroy();
    documentEditor = null;
  }
  if (
    pdfReader &&
    (pdfReader.id !== item?.id ||
      pdfReader.item.addedAt !== item?.addedAt ||
      pdfReader.item.sourceVersion !== item?.sourceVersion)
  ) {
    pdfReader.destroy();
    pdfReader = null;
  }
  if (
    notebookReader &&
    (notebookReader.id !== item?.id ||
      notebookReader.item.addedAt !== item?.addedAt ||
      notebookReader.item.sourceVersion !== item?.sourceVersion)
  ) {
    notebookReader.destroy();
    notebookReader = null;
  }
  if (!item && selectedAssignment(state)) {
    $('#reader-content').replaceChildren();
    return;
  }
  if (edit) {
    if (pdfReader) {
      pdfReader.destroy();
      pdfReader = null;
    }
    if (notebookReader) {
      notebookReader.destroy();
      notebookReader = null;
    }
    for (const url of readerURLs) URL.revokeObjectURL(url);
    readerURLs = [];
    $('#reader-content').classList.remove('pdf-active', 'pdf-dark');
    $('#reader-toolbar').innerHTML =
      `<span class="eyebrow">EDIT ${item.kind === 'notebook' ? 'NOTEBOOK' : 'DOCUMENT'}</span><div class="tools"><small>Saved locally</small>${button('Cancel', 'cancelDocumentEdit')}${button(edit.busy ? 'Saving…' : 'Save changes', 'saveDocument', '', 'primary')}</div>`;
    $('#reader-footer').innerHTML =
      `<span>${edit.dirty ? 'Unsaved changes' : hosted ? 'Editing account copy' : 'Editing local copy'}</span><span>${item.kind === 'notebook' ? 'Saved outputs are not rerun · ' : ''}Save to update tutor context</span>`;
    if (!documentEditor)
      documentEditor = new StudyDocumentEditor({
        host: $('#reader-content'),
        record: edit,
        onSave: () => saveDocument().catch((e) => notify(e.message)),
        onChange: () => {
          $('#reader-footer > span').textContent = 'Unsaved changes';
        },
      });
    documentEditor.setBusy(edit.busy);
    $('#reader-toolbar [data-action=cancelDocumentEdit]').disabled = edit.busy;
    $('#reader-toolbar [data-action=saveDocument]').disabled = edit.busy;
    return;
  }
  const sections = ['code', 'notebook', 'office'].includes(item?.kind);
  $('#reader-footer').innerHTML =
    item?.kind === 'notebook'
      ? `<span>${item.pageCount} cells · ${savedLabel}</span><span>Scroll to read</span>`
      : item
        ? `<span>${item.kind === 'preview' ? `Original file · ${savedLabel}` : `${item.pageCount} ${sections ? 'sections' : 'pages'} indexed · ${savedLabel}`}</span><div><button data-action="previous" aria-label="Previous page" title="Previous page" ${state.page <= 1 ? 'disabled' : ''}>‹</button><input id="page-input" type="number" aria-label="${sections ? 'Section' : 'Page'} number" min="1" max="${item.pageCount}" value="${state.page}"> / ${item.pageCount} <button data-action="next" aria-label="Next page" title="Next page" ${state.page >= item.pageCount ? 'disabled' : ''}>›</button></div>`
        : `<span>${c.documents.length} ${hosted ? 'saved files' : 'saved offline'}</span><span>Downloaded readings inform your tutor</span>`;
  if (item?.kind === 'pdf') {
    if (pdfReader) {
      pdfReader.setPage(state.page);
      return;
    }
    pdfReader = new StudyPDFReader({
      host: $('#reader-content'),
      toolbar: $('#reader-toolbar'),
      document: item,
      token,
      request,
      page: state.page,
      onPage: (page) => {
        action('page', { page }).catch(() => {});
      },
      onImage: (data) => {
        imageData = data;
        selectedText = '';
        draftDirty = true;
        renderComposer();
        saveDraft().catch(() => {});
      },
      onSelection: (...args) => explainSelection(...args, item.id),
      onChat: toggleChat,
      onGuide: async () => {
        $('.workspace').classList.remove('chat-hidden');
        await saveDraft();
        await action('draft', { ...draftValues(), mode: 'Guide me' });
        $('#question').focus();
      },
      notify,
    });
    await pdfReader.opened;
    return;
  }
  if (notebookReader) {
    notebookReader.setPage(state.page);
    return;
  }
  for (const url of readerURLs) URL.revokeObjectURL(url);
  readerURLs = [];
  $('#reader-content').classList.remove('pdf-active', 'pdf-dark');
  $('#reader-toolbar').innerHTML = item
    ? `<span class="eyebrow">${esc({ text: 'READING', image: 'IMAGE', code: 'SOURCE CODE', notebook: 'NOTEBOOK', office: 'OFFICE DOCUMENT', preview: 'ORIGINAL FILE' }[item.kind] || 'READING')}</span><div class="tools">${canEditDocument(item) ? button('Edit', 'editDocument') : ''}${button('Download', 'downloadOriginal')}${item.kind === 'office' || item.kind === 'preview' ? button('Original layout ↗', 'native') : ''}${button('Chat', 'toggleChat')}${button('Materials', 'materials')}</div>`
    : `<span class="eyebrow">COURSE MATERIALS</span><div class="tools">${button('＋ Add', 'upload')}</div>`;
  if (!item) {
    renderMaterials();
    return;
  }
  const notice = item.contentNotice
    ? `<p class="document-notice">${esc(item.contentNotice.replace('Use Original layout', 'Open Original layout in the Mac app'))}</p>`
    : '';
  if (item.kind === 'notebook') {
    notebookReader = new StudyNotebookReader({
      host: $('#reader-content'),
      document: item,
      token,
      request,
      page: state.page,
      onPage: (page) => action('page', { page }).catch(() => {}),
      onImage: async (blob, page) => {
        await action('page', { page });
        await attach(blob);
      },
      notify,
    });
    await notebookReader.opened;
    if (generation === readerGeneration && notice)
      $('#reader-content').insertAdjacentHTML('afterbegin', notice);
    return;
  }
  if (['text', 'code', 'office'].includes(item.kind)) {
    if (state.loadingDocument) {
      $('#reader-content').innerHTML =
        '<div class="reader-loading" role="status">Opening your reading…</div>';
      return;
    }
    $('#reader-content').innerHTML =
      `${notice}<article class="paper ${item.kind === 'code' ? 'source-code' : ''}">${renderMarkdown(state.pageText || '*This section has no saved text.*')}<div class="embedded-images"></div></article>`;
    if (item.kind === 'office') {
      const index = await request(`/api/index/${item.id}`);
      if (generation !== readerGeneration) return;
      for (const name of index.pages.find((p) => p.number === state.page)?.images || []) {
        const response = await fetch(`/api/image/${item.id}/${encodeURIComponent(name)}`, {
          headers: { 'X-Scholia-Token': token },
        });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (generation !== readerGeneration) return;
        const url = URL.createObjectURL(blob);
        readerURLs.push(url);
        const figure = window.document.createElement('figure');
        figure.innerHTML = `<img src="${url}" alt="Embedded document image">${button('Ask about this image', 'askImage', url)}`;
        $('.embedded-images').append(figure);
      }
    }
    return;
  }
  if (item.kind === 'preview') {
    $('#reader-content').innerHTML =
      `${notice}<article class="paper original-file"><span class="eyebrow">SAVED ORIGINAL</span><h2>${esc(item.title)}</h2><p>Open this file’s preview inside the Mac app, or download the original.</p>${button('Preview in Scholia ↗', 'native')}${button('Download original', 'downloadOriginal')}</article>`;
    return;
  }
  if (item.kind === 'image') {
    const blob = await (
      await fetch(`/api/document/${item.id}`, { headers: { 'X-Scholia-Token': token } })
    ).blob();
    if (generation !== readerGeneration) return;
    const url = URL.createObjectURL(blob);
    readerURLs.push(url);
    $('#reader-content').innerHTML =
      `<img class="document-image" alt="${esc(item.title)}" src="${url}">`;
  }
}
async function explainSelection(text, page, explain, question = '', documentID = doc()?.id) {
  if (explain && state.streaming) {
    notify('Wait for the current answer to finish, then ask your follow-up.');
    return false;
  }
  const saved = $('#question').value,
    savedImage = imageData;
  if (draftDirty) await saveDraft();
  if (doc()?.id !== documentID) throw new Error('The document changed. Select the passage again.');
  await action('page', { page });
  if (doc()?.id !== documentID) throw new Error('The document changed. Select the passage again.');
  selectedText = text;
  $('.workspace').classList.remove('chat-hidden');
  if (explain) {
    await action('send', {
      text:
        question.trim() ||
        'Explain the selected passage clearly, using its context in the document.',
      selection: text,
      mode: 'Explain',
      clearImage: true,
    });
    $('#question').value = saved;
    imageData = savedImage;
    selectedText = '';
    draftDirty = !!saved || !!savedImage;
    if (draftDirty) await saveDraft();
  }
  if (!explain && question.trim()) {
    $('#question').value = [$('#question').value, question.trim()].filter(Boolean).join('\n\n');
    draftDirty = true;
  }
  renderComposer();
  if (!explain) $('#question').focus();
  return explain;
}
async function beginDocumentEdit() {
  const item = doc();
  if (!canEditDocument(item) || editDocuments.has(item.id)) return;
  const draft = await request(`/api/edit/${item.id}`);
  if (!editDocuments.has(item.id)) editDocuments.set(item.id, { draft, dirty: false, busy: false });
  if (doc()?.id === item.id && !state.showingLibrary) await renderReader();
}
async function saveDocument() {
  const id = doc()?.id,
    edit = editDocuments.get(id);
  if (!edit || edit.busy) return;
  edit.busy = true;
  await renderReader();
  try {
    await action('saveDocument', { edit: edit.draft });
    editDocuments.delete(id);
    notify('Changes saved locally. Your tutor now has the updated document.');
  } finally {
    edit.busy = false;
    if (doc()?.id === id && !state.showingLibrary) await renderReader();
  }
}
function toggleChat() {
  $('.workspace').classList.toggle('chat-hidden');
}
async function downloadOriginal() {
  const item = doc();
  if (!item) return;
  const response = await fetch(`/api/document/${item.id}`, {
    headers: { 'X-Scholia-Token': token },
  });
  if (!response.ok) throw new Error('The original file is unavailable.');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = item.fileName || item.title;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function renderMaterials() {
  const c = course();
  if (!c) return;
  $('#reader-content').innerHTML =
    `<div class="course-materials"><span class="eyebrow">${esc(c.code || 'YOUR WORKSPACE')}</span><h2>${esc(courseDisplayName(c))}</h2><p>${c.canvasID ? (hosted ? 'Open a reading to save it to your private account and include it in your tutor’s course context.' : 'Open a reading to download it. Once saved, it’s available offline and included in your tutor’s course context.') : 'A home for your readings and the questions they spark. Add documents, notebooks, or code to get started.'}</p>
    <div class="course-tools">${c.canvasID ? `${button(c.catalogUpdatedAt ? 'Check for changes' : 'Index materials', 'index', c.id)}${button('Download all', 'downloadAll', c.id)}<a href="${courseURL(c)}" target="_blank" rel="noreferrer">Open Canvas ↗</a>` : button('＋ Add documents', 'upload', '', 'primary')}</div>
    ${catalogChangeSummary(c.catalogChanges) ? `<p class="material-changes">Latest check: ${esc(catalogChangeSummary(c.catalogChanges))}</p>` : ''}
    ${materialViewPicker(materialViews[c.id])}
    ${c.canvasID && materialViews[c.id] !== 'files' ? assignmentsMarkup([c], { query: materialQuery, includeCompleted: includeCompletedAssignments, showCourse: false, busy: state.busy }) : ''}
    ${!materialQuery && materialViews[c.id] !== 'files' ? continueReadingMarkup(recentReadings([c], 1)) : ''}<input class="material-search" id="material-search" placeholder="Search materials…" aria-label="Search materials" value="${esc(materialQuery)}">${materialsViewMarkup(state.materialGroups || [], state.materialFiles || [], { savedLabel: hosted ? 'Saved to your account' : 'Saved offline', view: materialViews[c.id], picker: false, courseID: c.id, query: materialQuery, closed: closedSections, busy: state.busy })}</div>`;
}
function renderMessages() {
  conversation.render(state);
  updateLatestAnswer();
}
function updateLatestAnswer() {
  const box = $('#messages');
  $('#latest-answer').hidden =
    !state?.messages.length || box.scrollHeight - box.scrollTop - box.clientHeight < 100;
}
function renderComposer() {
  const question = $('#question'),
    width = question.clientWidth;
  if (width && (question.value !== lastComposerText || width !== lastComposerWidth)) {
    question.style.height = 'auto';
    question.style.height = `${Math.max(65, Math.min(180, question.scrollHeight))}px`;
    lastComposerText = question.value;
    lastComposerWidth = width;
  }
  $('#edit-notice').hidden = !state.editing;
  $('#send').textContent = state.streaming ? '■' : '↑';
  $('#send').setAttribute('aria-label', state.streaming ? 'Stop answer' : 'Send question');
  $('#send').disabled =
    sendPending ||
    (!state.streaming &&
      (state.loadingDocument || !course() || (!$('#question').value.trim() && !imageData)));
  $('#question-image').hidden = !imageData;
  $('#question-image').innerHTML = imageData
    ? `<img alt="Attached question image" src="data:image/jpeg;base64,${imageData}"><span>Image attached</span>${button('×', 'removeImage')}`
    : '';
  const conflict =
    draftDirty && draftOwner && studyRenderKey(draftOwner) !== studyRenderKey(state.draftOwner);
  $('#draft-conflict').hidden = !conflict;
  $('#selection-note').hidden = !selectedText;
  $('#selection-note').innerHTML = selectedText
    ? `<span><strong>Selected passage</strong><q>${esc(selectedText.slice(0, 180))}${selectedText.length > 180 ? '…' : ''}</q></span><button data-action="clearSelection" aria-label="Remove selected passage" title="Remove selected passage">×</button>`
    : '';
}
async function prepareStudyPrompt(mode) {
  if (!course() || sendPending || state.streaming) return;
  if (mode === 'Practice' && !hosted) {
    await saveDraft('Practice');
    await practice.open('setup');
    return;
  }
  $('#question').value = appendStudyPrompt($('#question').value, studyPrompt(mode, doc()));
  draftDirty = true;
  $('.workspace').classList.remove('chat-hidden');
  $('#question').focus();
  renderComposer();
  await saveDraft(mode);
}
function draftValues() {
  return {
    text: $('#question').value,
    mode: state.mode,
    selection: selectedText,
    ...(imageData ? { image: imageData } : { clearImage: true }),
  };
}
async function saveDraft(mode = state?.mode) {
  clearTimeout(draftTimer);
  if (!state || !course() || sendPending) return;
  const values = { ...draftValues(), mode };
  persistBrowserDraft();
  await action('draft', values);
  const current = draftValues();
  if (
    current.text === values.text &&
    current.image === values.image &&
    current.selection === values.selection
  )
    draftDirty = false;
  persistBrowserDraft();
  renderComposer();
}
async function navigate(name, values = {}) {
  if (draftDirty) {
    if (studyRenderKey(draftOwner) === studyRenderKey(state.draftOwner)) await saveDraft();
    else persistBrowserDraft();
  }
  if (!draftDirty) selectedText = '';
  materialQuery = '';
  await action(name, values);
  $('.app').classList.remove('sidebar-open');
}
async function send() {
  if (sendPending) return;
  if (state.streaming) return action('stop');
  if (state.loadingDocument) {
    notify('Your reading is opening. Your question is saved here.');
    return;
  }
  if (!$('#question').value.trim() && !imageData) return;
  clearTimeout(draftTimer);
  const values = draftValues();
  const sentImage = imageData,
    previousMessageIDs = new Set(state.messages.map((message) => message.id));
  sendPending = true;
  draftDirty = true;
  renderComposer();
  try {
    await action('send', values);
    if (
      state.messages.some(
        (message) => message.role === 'user' && !previousMessageIDs.has(message.id)
      )
    ) {
      if ($('#question').value === values.text) $('#question').value = '';
      if (imageData === sentImage) imageData = null;
      draftDirty = !!$('#question').value || !!imageData;
      selectedText = '';
    }
  } finally {
    sendPending = false;
    persistBrowserDraft();
    renderComposer();
    if (draftDirty) {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => saveDraft().catch(() => {}), 600);
    }
  }
}
async function attach(file) {
  if (!file?.type.startsWith('image/')) return;
  if (file.size > 25_000_000) throw new Error('Choose an image smaller than 25 MB.');
  const bitmap = await createImageBitmap(file),
    scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(bitmap.width * scale);
  canvas.height = Math.ceil(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  imageData = canvas.toDataURL('image/jpeg', 0.87).split(',')[1];
  draftDirty = true;
  renderComposer();
  await saveDraft();
}
async function importFiles(files) {
  if (!course()) {
    notify('Open or create a course before adding documents.');
    return;
  }
  for (const file of files) {
    if (file.size > 100_000_000) {
      notify(`${file.name} exceeds 100 MB.`);
      continue;
    }
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await action('import', { name: file.name, data });
    while (state.busy) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await poll();
    }
  }
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest(
    '[data-action],[data-study-prompt],[data-mode],[data-source]'
  );
  if (!target) return;
  event.preventDefault();
  try {
    if (target.dataset.studyPrompt) {
      await prepareStudyPrompt(target.dataset.studyPrompt);
      return;
    }
    if (target.dataset.mode === 'Practice') {
      await prepareStudyPrompt('Practice');
      return;
    }
    if (target.dataset.mode) {
      await saveDraft();
      await action('draft', { ...draftValues(), mode: target.dataset.mode });
      return;
    }
    if (target.dataset.source) {
      await navigate('source', { id: target.dataset.source, page: Number(target.dataset.page) });
      return;
    }
    const name = target.dataset.action,
      id = target.dataset.id;
    if (
      ['library', 'course', 'document', 'thread', 'materials', 'newThread', 'resume'].includes(name)
    ) {
      await navigate(name, { id });
      return;
    }
    switch (name) {
      case 'practiceThis':
        await saveDraft();
        await practice.open('setup');
        break;
      case 'reviewDue':
        await practice.open('review');
        break;
      case 'copyDraft':
        await navigator.clipboard.writeText($('#question').value);
        notify('Recovered draft copied.');
        break;
      case 'loadCurrentDraft':
        clearTimeout(draftTimer);
        draftDirty = false;
        draftOwner = state.draftOwner;
        $('#question').value = state.draft;
        imageData = state.draftImage || null;
        selectedText = '';
        persistBrowserDraft();
        renderComposer();
        break;
      case 'collapseWorkspaces':
      case 'collapseMaterials': {
        const key = name === 'collapseWorkspaces' ? 'workspaces' : 'materials';
        if (closedSections.has(key)) closedSections.delete(key);
        else closedSections.add(key);
        persistSections();
        renderNavigation();
        break;
      }
      case 'create':
        $('#create-dialog').showModal();
        $('#create-form input').focus();
        break;
      case 'closeCreate':
        $('#create-dialog').close();
        break;
      case 'canvas':
        $('#canvas-dialog').showModal();
        break;
      case 'sidebar':
        $('.app').classList.toggle('sidebar-open');
        break;
      case 'all':
      case 'favorites':
      case 'semesters':
      case 'assignments':
        await action('libraryView', { id: name });
        break;
      case 'materialView':
        selectMaterialView(id);
        break;
      case 'agendaHandedIn':
        agendaFilter = 'handedIn';
        renderLibrary();
        break;
      case 'assignmentFilter':
        includeCompletedAssignments = id === 'all';
        if (state.showingLibrary) renderLibrary();
        else renderMaterials();
        break;
      case 'assignmentVisibility':
        await action(name, {
          id,
          courseID: target.dataset.courseId,
          enabled: target.dataset.hidden === 'true',
        });
        break;
      case 'assignment':
        await navigate(name, { id, courseID: target.dataset.courseId });
        break;
      case 'assignmentPDF':
        if (!state.busy)
          await navigate(name, {
            id,
            courseID: target.dataset.courseId,
            assignmentID: target.dataset.assignmentId,
          });
        break;
      case 'semester':
        await action('semester', { id });
        $('#library').scrollTop = 0;
        break;
      case 'upload':
        $('#document-upload').click();
        break;
      case 'attach':
        $('#image-upload').click();
        break;
      case 'removeImage':
        imageData = null;
        draftDirty = true;
        await saveDraft();
        renderComposer();
        break;
      case 'clearSelection':
        selectedText = '';
        window.getSelection()?.removeAllRanges();
        draftDirty = true;
        renderComposer();
        await saveDraft();
        break;
      case 'copy':
        await navigator.clipboard.writeText(state.messages.find((m) => m.id === id)?.content || '');
        notify('Copied.');
        break;
      case 'cancelEdit':
        await action('cancelEdit');
        draftDirty = false;
        $('#question').value = '';
        imageData = null;
        renderComposer();
        break;
      case 'edit':
        await action('edit', { id });
        draftDirty = false;
        $('#question').value = state.draft;
        imageData = state.draftImage || null;
        $('#question').focus();
        renderComposer();
        break;
      case 'connect':
      case 'connectToken':
        await action('connect', {
          origin: $('#canvas-origin').value,
          enabled: $('input[name=sync-mode]:checked').value === 'all',
          ...(name === 'connectToken' ? { token: $('#canvas-token').value } : {}),
        });
        $('#canvas-token').value = '';
        break;
      case 'previous':
        if (pdfReader) pdfReader.navigate(-1);
        else await action('page', { page: state.page - 1 });
        break;
      case 'next':
        if (pdfReader) pdfReader.navigate(1);
        else await action('page', { page: state.page + 1 });
        break;
      case 'toggleChat':
        toggleChat();
        break;
      case 'latestAnswer':
        $('#messages').scrollTop = $('#messages').scrollHeight;
        break;
      case 'downloadOriginal':
        await downloadOriginal();
        break;
      case 'editDocument':
        await beginDocumentEdit();
        break;
      case 'saveDocument':
        await saveDocument();
        break;
      case 'cancelDocumentEdit':
        if (!editDocuments.get(doc()?.id)?.busy) {
          editDocuments.delete(doc()?.id);
          await renderReader();
        }
        break;
      case 'askImage':
        await attach(await (await fetch(id)).blob());
        break;
      case 'material':
        if (state.busy) notify('Wait for the current download, or stop it first.');
        else await navigate(name, { id });
        break;
      default:
        await action(name, id ? { id } : {});
    }
  } catch (error) {
    notify(error.message);
  }
});
$('#create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    await navigate('create', { name: form.get('name'), code: form.get('code') });
    $('#create-dialog').close();
    event.target.reset();
  } catch {}
});
$('#composer').addEventListener('submit', (event) => {
  event.preventDefault();
  send().catch(() => {});
});
$('#question').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send().catch(() => {});
  }
});
$('#messages').addEventListener('scroll', updateLatestAnswer, { passive: true });
$('#question').addEventListener('input', () => {
  draftDirty = true;
  persistBrowserDraft();
  renderComposer();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => saveDraft().catch(() => {}), 600);
});
$('#question').addEventListener('paste', (event) => {
  const image = [...event.clipboardData.files].find((f) => f.type.startsWith('image/'));
  if (image) {
    event.preventDefault();
    attach(image).catch((e) => notify(e.message));
  }
});
$('#model-picker').addEventListener('change', (event) => {
  try {
    const [providerID, id] = JSON.parse(event.target.value);
    action('model', { providerID, id }).catch(() => {});
  } catch {}
});
$('#include-course').addEventListener('change', (event) =>
  action('context', { enabled: event.target.checked }).catch(() => {})
);
$('#document-upload').addEventListener('change', (event) => {
  importFiles([...event.target.files]).catch((e) => notify(e.message));
  event.target.value = '';
});
$('#image-upload').addEventListener('change', (event) => {
  attach(event.target.files[0]).catch((e) => notify(e.message));
  event.target.value = '';
});
$('#reader-content').addEventListener('dragover', (event) => event.preventDefault());
$('#reader-content').addEventListener('drop', (event) => {
  event.preventDefault();
  importFiles([...event.dataTransfer.files]).catch((e) => notify(e.message));
});
$('#reader-content').addEventListener('mouseup', () => {
  const selection = window.getSelection();
  if (selection?.anchorNode && $('#reader-content').contains(selection.anchorNode)) {
    selectedText = selection.toString().slice(0, 16000);
    renderComposer();
  }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'assignment-search') {
    agendaQuery = event.target.value;
    renderLibrary();
  }
  if (event.target.id === 'course-search') {
    const position = event.target.selectionStart;
    courseQuery = event.target.value;
    renderLibrary();
    $('#course-search').focus();
    $('#course-search').setSelectionRange(position, position);
  }
  if (['material-search', 'sidebar-material-search'].includes(event.target.id)) {
    const id = event.target.id,
      position = event.target.selectionStart;
    materialQuery = event.target.value;
    if (!doc()) renderMaterials();
    renderNavigation();
    $(`#${id}`).focus({ preventScroll: true });
    $(`#${id}`).setSelectionRange(position, position);
  }
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'workspace-filter')
    action('libraryView', { id: event.target.value }).catch(() => {});
  if (event.target.id === 'agenda-filter') {
    agendaFilter = event.target.value;
    renderLibrary();
  }
  if (event.target.id === 'semester-picker')
    action('semester', { id: event.target.value }).catch(() => {});
  if (event.target.id === 'page-input')
    action('page', { page: Number(event.target.value) || 1 }).catch(() => {});
  if (event.target.name === 'sync-mode')
    $('#canvas-dialog [data-action=connect]').textContent =
      event.target.value === 'all' ? 'Download everything' : 'Index all courses';
});
document.addEventListener(
  'toggle',
  (event) => {
    const key = event.target.dataset?.collapseKey;
    if (!key || !event.target.isConnected || materialQuery) return;
    if (event.target.open) {
      closedSections.delete(key);
      closedSections.add(`open:${key}`);
    } else {
      closedSections.add(key);
      closedSections.delete(`open:${key}`);
    }
    persistSections();
  },
  true
);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) poll();
});
window.addEventListener('beforeunload', (event) => {
  if (draftDirty || [...editDocuments.values()].some((edit) => edit.dirty || edit.busy)) {
    event.preventDefault();
    event.returnValue = '';
  }
});
await poll();
