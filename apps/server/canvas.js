import { setTimeout as delay } from 'node:timers/promises';
import { DOMParser } from 'linkedom';
import { remoteRequest } from './network.js';
export const htmlText = (html) => {
  const doc = new DOMParser().parseFromString(
    `<html><body>${html || ''}</body></html>`,
    'text/html'
  );
  doc.querySelectorAll('script,style,iframe').forEach((node) => node.remove());
  doc
    .querySelectorAll('p,div,li,br,h1,h2,h3,tr')
    .forEach((node) => node.appendChild(doc.createTextNode('\n')));
  return doc.body.textContent.trim();
};
export function assignmentDetails(record, origin, courseID) {
  const submission = record.submission || {},
    workflow = submission.workflow_state;
  const status = submission.excused
    ? 'excused'
    : workflow === 'graded' && !submission.missing
      ? 'graded'
      : submission.submitted_at || ['submitted', 'pending_review'].includes(workflow)
        ? 'submitted'
        : workflow === 'unsubmitted' || submission.missing
          ? 'notSubmitted'
          : 'unknown';
  const linkedFileIDs = [];
  const doc = new DOMParser().parseFromString(
    `<html>${record.description || ''}</html>`,
    'text/html'
  );
  for (const node of doc.querySelectorAll('[href],[src],[data-api-endpoint]'))
    for (const attribute of ['href', 'src', 'data-api-endpoint']) {
      try {
        const url = new URL(node.getAttribute(attribute), origin);
        const match = url.pathname.match(
          /^\/(?:api\/v1\/)?(?:courses\/(\d+)\/)?files\/(\d+)(?:\/(?:download|preview))?\/?$/
        );
        if (
          url.origin === origin &&
          match &&
          (!match[1] || Number(match[1]) === Number(courseID)) &&
          !linkedFileIDs.includes(match[2])
        )
          linkedFileIDs.push(match[2]);
      } catch {}
    }
  return {
    dueAt: record.due_at || null,
    unlockAt: record.unlock_at || null,
    lockAt: record.lock_at || null,
    submissionTypes: record.submission_types || [],
    status,
    missing: !!submission.missing,
    locked: !!record.locked_for_user,
    linkedFileIDs,
  };
}
export class Canvas {
  constructor(origin, token, { hosts = ['canvas.ntnu.no'], request = remoteRequest, signal } = {}) {
    const url = new URL(origin);
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      !hosts.includes(url.hostname)
    )
      throw new Error('This Canvas host is not enabled on the server.');
    this.origin = url.origin;
    this.token = token;
    this.request = request;
    this.signal = signal;
  }
  async api(path, attempt = 0) {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin || !url.pathname.startsWith('/api/v1/'))
      throw new Error('Invalid Canvas API address.');
    const result = await this.request(url, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
      limit: 8_000_000,
      signal: this.signal,
    });
    if (result.status === 429 && attempt < 2) {
      const wait = Math.min(60, Math.max(1, Number(result.headers['retry-after']) || 2 ** attempt));
      await delay(wait * 1000, undefined, { signal: this.signal });
      return this.api(path, attempt + 1);
    }
    if (result.status < 200 || result.status >= 300)
      throw new Error(
        result.status === 401
          ? 'Your Canvas token has expired. Reconnect Canvas.'
          : `Canvas returned HTTP ${result.status}.`
      );
    return { value: JSON.parse(result.data), headers: result.headers };
  }
  async list(path) {
    let next = new URL(path, this.origin);
    next.searchParams.set('per_page', '100');
    const originalPath = next.pathname,
      seen = new Set(),
      items = [];
    while (next) {
      if (
        seen.has(next.href) ||
        seen.size >= 50 ||
        next.origin !== this.origin ||
        next.pathname !== originalPath
      )
        throw new Error('Invalid Canvas pagination.');
      seen.add(next.href);
      const { value, headers } = await this.api(next.href);
      if (!Array.isArray(value)) throw new Error('Canvas returned an invalid list.');
      items.push(...value);
      const match = String(headers.link || '').match(/<([^>]+)>;\s*rel="?next"?/);
      next = match ? new URL(match[1], next) : null;
    }
    return items;
  }
  async account() {
    return (await this.api('/api/v1/users/self/profile')).value;
  }
  async courses() {
    return this.list('/api/v1/courses?include[]=term');
  }
  reference(kind, item, courseID) {
    const remoteID = String(kind === 'pages' ? item.url : item.id);
    const fileName = kind === 'files' ? item.filename || item.display_name : undefined;
    return {
      id: `${kind}:${remoteID}`,
      kind,
      remoteID,
      title: item.name || item.title || item.display_name || fileName || remoteID,
      fileName,
      sourceURL: `${this.origin}/courses/${courseID}/${kind}/${encodeURIComponent(remoteID)}`,
      version:
        String(item.updated_at || item.modified_at || '') +
        (kind === 'assignments' ? `|due:${item.due_at || 'none'}` : ''),
      byteCount: item.size,
      ...(kind === 'assignments'
        ? { assignment: assignmentDetails(item, this.origin, courseID) }
        : {}),
    };
  }
  async catalog(course) {
    const previous = course.canvasMaterials || [],
      items = [],
      warnings = [],
      complete = new Set();
    for (const kind of ['files', 'pages', 'assignments']) {
      try {
        const records = await this.list(
          `/api/v1/courses/${course.canvasID}/${kind}${kind === 'assignments' ? '?include[]=submission' : ''}`
        );
        for (const item of records)
          if (
            item.published !== false &&
            !item.hidden_for_user &&
            (kind === 'assignments' || !item.locked_for_user)
          )
            items.push(this.reference(kind, item, course.canvasID));
        complete.add(kind);
      } catch (error) {
        this.signal?.throwIfAborted();
        warnings.push(`${kind}: ${error.message}`);
      }
    }
    try {
      for (const module of await this.list(`/api/v1/courses/${course.canvasID}/modules`)) {
        for (const entry of await this.list(
          `/api/v1/courses/${course.canvasID}/modules/${module.id}/items`
        )) {
          const kind = { File: 'files', Assignment: 'assignments', Page: 'pages' }[entry.type];
          if (!kind || entry.published === false) continue;
          const id = `${kind}:${kind === 'pages' ? entry.page_url : entry.content_id}`;
          let ref = items.find((item) => item.id === id);
          if (!ref) {
            try {
              ref = this.reference(
                kind,
                (
                  await this.api(
                    `/api/v1/courses/${course.canvasID}/${kind}/${encodeURIComponent(kind === 'pages' ? entry.page_url : entry.content_id)}${kind === 'assignments' ? '?include[]=submission' : ''}`
                  )
                ).value,
                course.canvasID
              );
              items.push(ref);
            } catch {
              continue;
            }
          }
          if (!ref.moduleID)
            Object.assign(ref, {
              moduleID: module.id,
              moduleTitle: module.name,
              modulePosition: module.position,
              moduleItemPosition: entry.position,
            });
        }
      }
    } catch (error) {
      this.signal?.throwIfAborted();
      warnings.push(`modules: ${error.message}`);
    }
    for (const item of previous)
      if (!complete.has(item.kind) && !items.some((ref) => ref.id === item.id)) items.push(item);
    const before = new Map(previous.map((item) => [item.id, item]));
    return {
      items,
      warnings,
      changes: {
        added: items.filter((i) => !before.has(i.id)).map((i) => i.id),
        updated: items
          .filter((i) => before.has(i.id) && JSON.stringify(i) !== JSON.stringify(before.get(i.id)))
          .map((i) => i.id),
        removed: previous
          .filter((i) => complete.has(i.kind) && !items.some((r) => r.id === i.id))
          .map((i) => i.id),
      },
    };
  }
  async material(ref, course) {
    const item = (
      await this.api(
        `/api/v1/courses/${course.canvasID}/${ref.kind}/${encodeURIComponent(ref.remoteID)}${ref.kind === 'assignments' ? '?include[]=submission' : ''}`
      )
    ).value;
    if (item.locked_for_user || item.hidden_for_user || item.published === false)
      throw new Error('Locked in Canvas.');
    const reference = this.reference(ref.kind, item, course.canvasID);
    if (ref.kind !== 'files')
      return {
        reference,
        name: `${reference.title}.md`,
        data: Buffer.from(htmlText(item.description || item.body)),
      };
    const url = new URL(item.url);
    const result = await this.request(url, {
      redirects: true,
      signal: this.signal,
      headers: url.origin === this.origin ? { Authorization: `Bearer ${this.token}` } : {},
      limit: 100_000_000,
    });
    if (result.status < 200 || result.status >= 300)
      throw new Error(`Download returned HTTP ${result.status}.`);
    return { reference, name: reference.fileName, data: result.data };
  }
}
