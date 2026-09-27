import { escapeHtml as esc } from '../chrome/src/render.js';
import { submissionBadgeMarkup } from './assignments.js';

function materialRowMarkup(
  item,
  {
    compact = false,
    courseID = '',
    selectedID = '',
    selectedAssignmentID = '',
    busy = false,
    savedLabel = 'Saved offline',
  } = {}
) {
  const isAssignment = item.materialID?.startsWith('assignments:');
  const id = isAssignment ? item.materialID : item.documentID || item.materialID;
  const selected = isAssignment
    ? item.materialID === selectedAssignmentID
    : item.documentID && item.documentID === selectedID;
  const disabled =
    !isAssignment && !item.documentID && (busy || item.detail === 'Larger than 100 MB');
  let link = '';
  try {
    const url = new URL(item.sourceURL);
    if (url.protocol === 'https:') link = url.href;
  } catch {}
  return `<div class="material-row ${selected ? 'active' : ''}"><button class="${compact ? 'material-nav-item' : ''}" data-action="${isAssignment ? 'assignment' : item.documentID ? 'document' : 'material'}" data-id="${esc(id)}" data-course-id="${esc(courseID)}" ${disabled ? 'disabled' : ''}><span class="material-title"><strong>${esc(item.title)}</strong>${compact ? '' : `<small>${esc(item.detail)}</small>`}${isAssignment && item.requiresSubmission !== false ? submissionBadgeMarkup(item.submissionStatus) : ''}${item.badge ? `<small class="material-badge">${esc(item.badge)}</small>` : ''}</span><span class="cloud" title="${item.documentID ? esc(savedLabel) : 'Download on demand'}" aria-label="${item.documentID ? esc(savedLabel) : 'Download on demand'}">${item.documentID ? '▣' : '↓'}</span></button>${!compact && item.updateAvailable ? `<button class="material-update" data-action="material" data-id="${esc(item.materialID)}" ${busy ? 'disabled' : ''}>Update</button>` : ''}${!compact && link ? `<a href="${esc(link)}" target="_blank" rel="noreferrer" aria-label="Open ${esc(item.title)} in Canvas">↗</a>` : ''}</div>`;
}

export function materialGroupsMarkup(groups, options = {}) {
  const { compact = false, courseID = '', query = '', closed = new Set() } = options;
  const needle = query.trim().toLocaleLowerCase();
  const visible = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${group.title} ${item.title}`.toLocaleLowerCase().includes(needle)
      ),
    }))
    .filter((group) => group.items.length);
  if (!visible.length)
    return `<p class="material-empty">${needle ? 'No matching materials.' : 'Your course materials will appear here.'}</p>`;
  return visible
    .map((group) => {
      const key = `${courseID}:${group.id}`;
      return `<details class="material-group ${compact ? 'compact' : ''}" data-collapse-key="${esc(key)}" ${needle || (!closed.has(key) && (group.id !== 'assets' || closed.has(`open:${key}`))) ? 'open' : ''}><summary><span>${esc(group.title)}</span><small>${group.items.length}</small></summary>${compact ? '' : `<p class="group-basis">${esc(group.basis)}</p>`}${group.items.map((item) => materialRowMarkup(item, options)).join('')}</details>`;
    })
    .join('');
}

export function materialFilesMarkup(files, options = {}) {
  const needle = (options.query || '').trim().toLocaleLowerCase();
  const visible = files.filter((item) => item.title.toLocaleLowerCase().includes(needle));
  return `<div class="material-files" aria-label="All files"><p class="file-count">${visible.length} files</p>${visible.length ? visible.map((item) => materialRowMarkup(item, { ...options, compact: false })).join('') : `<p class="material-empty">${needle ? 'No matching files.' : 'No files in this workspace yet.'}</p>`}</div>`;
}

export function materialViewPicker(view) {
  const flat = view === 'files';
  return `<div class="tabs material-views" role="group" aria-label="Materials view"><button data-action="materialView" data-id="organized" class="${flat ? '' : 'active'}" aria-pressed="${!flat}">Organized</button><button data-action="materialView" data-id="files" class="${flat ? 'active' : ''}" aria-pressed="${flat}">All files</button></div>`;
}

export function materialsViewMarkup(groups, files, options = {}) {
  return `${options.picker === false ? '' : materialViewPicker(options.view)}${options.view === 'files' ? materialFilesMarkup(files, options) : materialGroupsMarkup(groups, options)}`;
}
