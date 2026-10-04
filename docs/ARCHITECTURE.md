# Architecture

Scholia has a native Mac app, a Chrome extension, and a hosted web service.
`apps/web` is the browser workspace used by both the hosted service and the Mac
app's optional local server. The three libraries do not synchronize.

For the directory map and development commands, see [Contributing](../CONTRIBUTING.md).
For user-facing behavior, see the [workspace guide](STUDY_WORKSPACE.md).

## Shared contracts

`packages/core` contains JavaScript provider definitions, prompts, attachment
limits, and context ranking. The normalized explanation request is described by
[`explain-request.schema.json`](../packages/core/schemas/explain-request.schema.json).
Swift has native types for the same concepts.

Source material is labelled and delimited separately from user instructions.
Provider calls include a limited source snapshot, not the entire library.
Browser answers use bundled Markdown, syntax highlighting, and KaTeX. Native
answers use cmark-gfm and a selectable AppKit text view with local math rendering.
Both restrict links and avoid fetching model-authored remote images.

## Mac app

SwiftUI provides navigation and controls. AppKit owns windows, split panes,
text rendering, and desktop integration. PDFKit reads PDFs, Vision supplies OCR,
and Quick Look shows original document layouts. WebKit handles Canvas sign-in.
Opening the native workspace does not start a web server.

`StudyWorkspaceModel` owns navigation, courses, documents, threads, and drafts.
`StudyDocumentImporter` copies originals into the library and builds text
indexes. Native semantic search runs the bundled JavaScript ranker through
JavaScriptCore. Notebook cells, macros, and formulas are never executed.

Library snapshots use a serial queue that combines pending saves and flushes
at lifecycle boundaries. Back/Forward saves drafts before changing readings.
Document edits check their source revision and retain earlier versions.

Canvas catalogs metadata before downloading files. Materials have stable source
IDs, module positions, remote versions, and saved references. Refresh preserves
conversations and local edits. An incomplete refresh does not discard entries it
couldn't check. API requests stay on the Canvas origin; file redirects drop
Canvas credentials before reaching a storage host.

Frequent-course preloading is optional. It waits for repeated visits and idle
time, fetches a small batch, and pauses for active work, Low Power Mode, or
thermal pressure. Exact limits are in the [workspace guide](STUDY_WORKSPACE.md).

Keychain holds secrets; `UserDefaults` holds preferences. Documents, indexes,
revisions, reading history, and conversations live under
`~/Library/Application Support/Scholia/Study`. Practice uses a separate SQLite
event store, described in [Practice and review](PRACTICE.md).

The menu-bar companion reads selected or visible Accessibility text on demand,
skipping secure fields. Region capture crops only the area the user selects.
Quick Chat stays in memory until saved. Local CLI bridges start when needed;
Scholia stops only processes it owns.

## Local browser workspace

**Open in Browser** starts `StudyWebServer` on `127.0.0.1:8792`. The frontend uses
the native model, files, Canvas connection, provider settings, and learning
store. The app must stay running. Native and browser views share navigation.

The server requires a per-launch token, checks Host and Origin, rejects
cross-site requests, and disables caching. It does not send raw Keychain secrets
to the browser. PDF.js renders browser PDFs; indexing and provider calls remain
native operations.

Draft and page mutations carry their original destination and revision. Stale
writes are rejected. Browser drafts and practice outbox entries remain available
for recovery after a conflict.

## Hosted service

`apps/server/server.js` runs on Node.js 24 or newer. It serves the same frontend
with capability flags for hosted features. It needs no Mac process or loopback
bridge.

| Module                                | Responsibility                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `store.js`                            | SQLite accounts, password hashes, sessions, and credential encryption             |
| `workspaces.js`                       | Account-scoped state, serialized mutations, and document revisions                |
| `documents.js` / `document-worker.js` | Originals, text indexes, and extraction in worker threads                         |
| `canvas.js`                           | Account-specific Canvas access and the configured host allowlist                  |
| `network.js`                          | DNS validation, private-address rejection, download limits, and redirect handling |

Passwords use salted scrypt. Sessions store hashed tokens and expire after seven
days. Provider and Canvas credentials use AES-256-GCM with a server-held key.
The operator can read stored files and decrypt credentials.

API and file routes authenticate sessions and check ownership. Mutations require
a CSRF token. Host/Origin checks, HttpOnly cookies, login throttling, CSP, and
upload/worker limits add protection. Public origins require HTTPS.

The deployment model is one process with persistent local SQLite and file
storage. Each session has independent reading navigation. Hosted PDF extraction
uses PDF.js text extraction; native Vision OCR and the native practice store are
not available. See [Hosting](HOSTING.md) for configuration and backups.

## Chrome extension

The content script captures selections, accessible math, sanitized page
structure, and explicitly chosen images. It runs in an isolated world and never
receives provider keys. Page serialization omits scripts, handlers, live form
values, and Scholia controls. Local ranking limits the context sent to a model.

The service worker owns credentials, settings, provider requests, commands,
and tab capture. Secret settings are available only to extension-owned pages.
Responses stream over a long-lived port with cancellation. Cloud endpoints
require HTTPS; HTTP is limited to loopback providers.

Toolbar, side-panel, full-tab, and PDF chats share rendering and provider
contracts. Saved chats keep their source context when tabs change. Recursive
explanations retain parent context, and editing a message replaces later turns.
Small DOM and event helpers live together in `ui-primitives.js`.

PDF.js, decoders, workers, and fonts are bundled. Visible pages render before
background indexing. Indexes are cached by PDF fingerprint; local file handles
remain revocable. Canvas caches are scoped by host, account, and course.

## Verification

Unit and service tests cover contracts, account separation, CSRF, credentials,
revision conflicts, and context handling. Native smoke runners link application
code against temporary libraries and deterministic fixtures. Browser smoke
checks run in Chromium. [Contributing](../CONTRIBUTING.md) lists the commands and
explains which checks run in CI.
