import { escapeHtml as esc } from '../../chrome/src/render.js';
import '../styles/workspace-search.css';

export function highlightedSnippet(text, terms) {
  const spans = [];
  for (const term of terms) {
    if (!term) continue;
    let at = text.indexOf(term);
    while (at >= 0) {
      spans.push([at, at + term.length]);
      at = text.indexOf(term, at + term.length);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  let at = 0,
    html = '';
  for (const [start, end] of merged) {
    html += `${esc(text.slice(at, start))}<mark>${esc(text.slice(start, end))}</mark>`;
    at = end;
  }
  return html + esc(text.slice(at));
}

export function installWorkspaceSearch({ request, getState, onOpen, notify }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'workspace-search-dialog';
  dialog.id = 'workspace-search-dialog';
  dialog.setAttribute('aria-labelledby', 'workspace-search-title');
  dialog.innerHTML = `<div class="search-heading"><div><small>NEEDLE</small><h2 id="workspace-search-title">Find it in your library</h2></div><button type="button" class="search-close" aria-label="Close search">×</button></div>
    <label class="search-query-label" for="workspace-search-query">File name, words, or “exact phrase”</label>
    <input id="workspace-search-query" type="search" autocomplete="off" spellcheck="false" maxlength="512" placeholder='Try eigenvectors or "change of basis"'>
    <div class="search-filters"><label>Search in <select id="workspace-search-scope"></select></label><label>Look for <select id="workspace-search-mode"><option value="all">Names & contents</option><option value="files">File names</option><option value="content">Contents</option></select></label></div>
    <p class="search-status" role="status" aria-live="polite"></p><div class="search-results" aria-label="Search results"></div>
    <p class="search-help">Every word must match the same page or file name. Use double quotes for a phrase. Search reads saved text, including available OCR.</p>`;
  document.body.append(dialog);
  const $ = (selector) => dialog.querySelector(selector),
    input = $('#workspace-search-query');
  let generation = 0,
    timer,
    controller,
    results = [],
    opener;
  const invalidate = () => {
    generation++;
    clearTimeout(timer);
    controller?.abort();
  };
  const status = (text) => {
    $('.search-status').textContent = text;
  };
  async function run() {
    invalidate();
    const ticket = generation;
    results = [];
    $('.search-results').replaceChildren();
    if (!input.value.trim()) {
      status('Search one workspace or your entire library.');
      return;
    }
    controller = new AbortController();
    status('Searching… Preparing new files on the first search.');
    try {
      const params = new URLSearchParams({
        q: input.value,
        courseID: $('#workspace-search-scope').value,
        mode: $('#workspace-search-mode').value,
      });
      const result = await request(`/api/search?${params}`, undefined, controller.signal);
      if (ticket !== generation || !dialog.open) return;
      results = result.results;
      const { coverage } = result;
      const coverageText = `${coverage.contentFiles} of ${coverage.files} files have searchable text`;
      status(
        `${result.total ? `${result.total} matching ${result.total === 1 ? 'file' : 'files'}${result.total > results.length ? ` · showing ${results.length}` : ''}` : 'No matches'} · ${Math.round(result.totalMs)} ms · ${coverageText}.${coverage.remoteFiles ? ` ${coverage.remoteFiles} cloud materials are searchable by name; download them to search inside.` : ''}${coverage.unavailableFiles ? ` ${coverage.unavailableFiles} saved files have no readable text index.` : ''}`
      );
      $('.search-results').innerHTML = results
        .map(
          (hit, index) =>
            `<button class="search-result" type="button" data-hit="${index}"><span class="search-result-heading"><strong>${esc(hit.title)}</strong><small>${hit.page ? `${hit.kind === 'notebook' ? 'Cell' : ['code', 'office'].includes(hit.kind) ? 'Section' : 'Page'} ${hit.page}` : hit.documentID ? 'File name' : 'Cloud material'}</small></span><span class="search-result-location">${esc(hit.courseName)}${hit.fileName && hit.fileName !== hit.title ? ` · ${esc(hit.fileName)}` : ''}</span><span class="search-result-snippet">${highlightedSnippet(hit.snippet, result.terms)}</span></button>`
        )
        .join('');
    } catch (error) {
      if (ticket === generation && error.name !== 'AbortError') status(error.message);
    }
  }
  function open() {
    if (dialog.open) {
      input.focus();
      return;
    }
    const state = getState();
    if (!state) return;
    opener = document.activeElement;
    const courses = state.library.courses;
    $('#workspace-search-scope').innerHTML =
      `<option value="">All workspaces</option>${courses.map((c) => `<option value="${esc(c.id)}">${esc(c.code ? `${c.code} · ${c.name}` : c.name)}</option>`).join('')}`;
    $('#workspace-search-scope').value = state.showingLibrary
      ? ''
      : state.library.selectedCourseID || '';
    dialog.showModal();
    input.focus();
    input.select();
    void run();
  }
  input.addEventListener('input', () => {
    invalidate();
    results = [];
    $('.search-results').replaceChildren();
    status('Searching…');
    timer = setTimeout(run, 35);
  });
  for (const id of ['#workspace-search-scope', '#workspace-search-mode'])
    $(id).addEventListener('change', run);
  $('.search-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    invalidate();
    opener?.focus();
  });
  dialog.addEventListener('click', async (event) => {
    const hitButton = event.target.closest('[data-hit]');
    if (!hitButton) return;
    const hit = results[Number(hitButton.dataset.hit)];
    if (!hit) return;
    hitButton.disabled = true;
    try {
      await onOpen(hit);
      dialog.close();
    } catch (error) {
      notify(error.message);
      hitButton.disabled = false;
    }
  });
  dialog.addEventListener('keydown', (event) => {
    const buttons = [...dialog.querySelectorAll('[data-hit]')];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const position = buttons.indexOf(document.activeElement);
      const next =
        event.key === 'ArrowDown' ? Math.min(buttons.length - 1, position + 1) : position - 1;
      (buttons[next] || input).focus();
    } else if (event.key === 'Enter' && event.target === input) {
      event.preventDefault();
      if (buttons.length) buttons[0].click();
      else void run();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'k'
    ) {
      if (document.querySelector('dialog[open]') && !dialog.open) return;
      event.preventDefault();
      open();
    }
  });
  return { open };
}
