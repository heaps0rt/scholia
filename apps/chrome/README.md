# Chrome extension

Scholia explains selected text, mathematics, images, pages, and PDFs using the
provider you configure. Conversations and settings stay in extension storage.

## Install from source

From the repository root, using Node.js 24 or newer:

```sh
npm ci
npm run build
```

In `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**,
and select `dist/chrome`. Open Scholia's settings to choose a provider.
`apps/chrome` is source code; it cannot be loaded directly.

Rebuild and reload the extension after changes. Local builds receive a fresh
Chrome-valid version. For a specific version:

```sh
SCHOLIA_EXTENSION_VERSION=1.2.3 npm run build
```

## Selections and chat

Select text and click **Explain**. Click a MathJax expression to select its
source, or Alt-click to choose a symbol and adjust it with **Narrower/Wider**.
Shift-Alt-click or **+ symbol** adds more symbols. LaTeX selections in Overleaf's
editor also work.

The toolbar icon opens Quick Chat, saved chats, and capture controls. **Open
sidebar** opens a conversation beside the page. **Home** keeps the current chat;
**New chat** starts another. Expand a completed sidebar chat into a full tab, or
use **Move to chat ↗** to keep an explanation and its drafted follow-up.

Select part of an answer to ask for another explanation. Each layer keeps its
own conversation; **Back** returns to the previous one. **Edit** on a sent
question replaces that question and regenerates the later conversation.

Enter sends a message; Shift-Enter adds a line. Use the chat search button or
Command/Ctrl-F to find messages, then Enter or Shift-Enter to move through hits.
Saved chats can be reopened or deleted from the toolbar or sidebar. History
holds up to 24 recent chats subject to a storage-size limit.

| Shortcut             | Action                                   |
| -------------------- | ---------------------------------------- |
| Command/Ctrl-Shift-E | Explain the current selection            |
| Command/Ctrl-Shift-S | Capture a visible region                 |
| Command/Ctrl-Shift-K | Toggle a fresh Quick Chat in the sidebar |

Remap shortcuts at `chrome://extensions/shortcuts`. If the Mac app is installed,
its per-app switches let you give the extension control of selection and region
shortcuts in your browser.

## Source context

A chat keeps the source it started with. Selecting another passage during a
conversation attaches it to the next turn without replacing that source.

- **Compact** ranks relevant page, PDF, course, or site text locally and sends
  about 6,000 characters of automatic context.
- **Full** includes articles and short PDFs up to 120,000 extracted source
  characters, with page boundaries. Larger sources use excerpts. Saved chats
  retain that context.
- **None** omits automatic context and keeps your conversation and attachments.

**Complete page** scrolls to load content, gathers readable text and a bounded
page visual, then restores your position. Very long pages may be sampled.
**Entire site** follows up to 48 same-origin HTML pages and ranks their text for
the first question. Follow-ups keep the resulting source pack.

Page capture removes scripts, event handlers, live form values, and Scholia's
controls. In supported webmail readers, **Draft reply** uses the conversation
around your selection. It writes a draft in Scholia; you send it yourself.

**Web search** is available with supported OpenAI, Anthropic, OpenRouter, and
Codex configurations. It uses the selected provider's search tool for that turn.
Answers render Markdown, highlighted code, and math locally. Raw HTML, unsafe
links, and remote images in answers are blocked. Provider-returned reasoning,
when present, appears in a separate collapsed panel.

### Files and Canvas

Use the paperclip, drag files into a composer, or paste them. Supported inputs
include PDFs, images, Office documents, and readable text/code. Limits are six
files, one image, 25 MB per file, 24,000 extracted characters per document, and
48,000 per turn. Partial extraction is labelled. Saved messages retain the
extracted text and supported images, not raw document bytes.

On a signed-in Canvas course page, **Index / refresh course** reads the syllabus,
pages, assignments, and accessible files, including module files. New questions
reuse the index and check for changes after 15 minutes. **Clear index** deletes
that course's cache; **None** skips automatic course context.

Indexes are separated by Canvas host, account, and course. The cache holds up to
eight courses, with 300 sources and two million text characters per course.
Access is checked before reuse. Locked or unsupported files make the index
partial. Only relevant excerpts and source links reach the provider.

### Optional ChatGPT context

Settings can import a memory or project snapshot from a signed-in ChatGPT tab.
**Get full memory from ChatGPT** opens a separate Personalization tab and reads
the rendered memory manager. The snapshot remains editable in Settings.
Scholia does not read cookies or private ChatGPT account endpoints.

Imported memory can be included automatically on ChatGPT pages; project context
is included only for a matching project. Response explanations also offer an
explicit inclusion toggle. Quick Chat can refresh and include memory every
chat, every 3 or 12 hours, or every 1, 3, or 7 days. **Manual only** disables that
Quick Chat refresh and inclusion. A missed scheduled refresh runs in the
background while the question uses the last saved snapshot.

Imported text can reach a provider other than OpenAI if that is the provider you
choose. See [Privacy](../../docs/PRIVACY.md) for storage and transmission details.

## PDFs

Open a PDF in the browser, or choose **Open a PDF file or address** in the
toolbar. Scholia resolves common repository preview links to their raw download
and checks the PDF signature before opening it. **Open original page** remains
available if the document cannot be fetched.

The reader supports selection explanations, **Chat with PDF**, exact and locally
ranked semantic search, bookmarks, printing, and continuous, single-page, or
spread layouts. Each PDF tab keeps its own selections and conversation. The
viewer's light/dark setting leaves PDF page colors unchanged.

Use Left/Right to change pages, Page Up/Down or Space/Shift-Space to scroll,
Home/End for document edges, and Command/Ctrl with +, −, or 0 for zoom.
Command/Ctrl-P prepares all pages and opens browser print preview.

On Chromium 151 and newer, supported MIME handling keeps the original PDF
address in the address bar. Older builds use an extension-owned reader URL.
**Chrome view** returns to the built-in viewer; **Open Scholia PDF view** restores
Scholia's reader. For local `file://` navigation, enable **Allow access to file
URLs** in the extension's details, or choose the file in Scholia's picker.

A file chosen through Chromium's picker can retain a revocable file handle so
it can reopen after a restart. Blob/data URLs and the fallback file input last
only for that session. PDF text indexes are cached locally by document
fingerprint. Documents up to 1 GB are accepted, but large files can take time to
index and render. PDF.js, its workers, fonts, and image decoders are bundled.

Sparse PDF pages and attachments use bundled English/Norwegian OCR. It processes
up to 50 sparse pages per document with a 30-second limit per recognition job.
Recovered text keeps its page numbers and joins the local search/context cache.
Skipped or unreadable pages are reported; the original PDF is unchanged.

**Exam planner** opens the study website configured in extension settings. Start
**Open in Browser** in the Mac app first when using its local website.

Region capture covers the visible page or PDF viewport. Drag to select an area
or press Escape to cancel. Browser internal pages and the Web Store restrict
extension access.

## Providers and site access

Settings supports cloud APIs, Ollama, custom compatible endpoints, and local
Codex, Claude Code, and opencode services. GPT NTNU needs a personal API key and
an NTNU network or VPN connection. Fast mode uses the selected CLI's setting.
Model catalogs can be searched; an exact-ID field is available for unlisted
models.

To install a macOS URL handler for a local bridge:

```sh
npm run bridge:install:codex
npm run bridge:install:claude
npm run bridge:install:opencode
```

Each accepts `-- --port N` or `-- --uninstall`. Node.js and the chosen CLI must
be installed. To start Codex or Claude directly, use `npm run bridge:codex` or
`npm run bridge:claude`; opencode uses `opencode serve --port 4096`.

Disable Scholia for a site from the popup or toolbar. Allowlist mode keeps it
inactive except on the hostnames you choose.

## Testing and release

Browser verification uses Chromium. After building:

```sh
node scripts/smoke-chromium-region.mjs
node scripts/smoke-chromium-history.mjs
npm run smoke:chromium:recursion
```

For a Web Store package:

```sh
npm run check
npm run package:chrome
```

Upload `dist/scholia-chrome-<version>.zip`. Packaging uses the version in
`package.json`, checks manifest entries and bundled dependencies, rejects remote
or dynamically evaluated code, and verifies that the manifest is at the ZIP
root. Update `package.json`, the lockfile, and the source manifest together when
bumping the release version.

The listing's single purpose is to explain user-selected text, mathematics,
images, regions, pages, and PDFs with the user's chosen provider. Suggested
short description: “Select text, math, or a screen region and get a contextual
AI explanation.”

| Permission       | Use                                                                           |
| ---------------- | ----------------------------------------------------------------------------- |
| `activeTab`      | User-requested page reading and region capture                                |
| `offscreen`      | Bundled local OCR for scanned PDFs, including attachments on restricted pages |
| `alarms`         | Optional scheduled ChatGPT memory refresh                                     |
| `contextMenus`   | Explain and Capture commands                                                  |
| `clipboardWrite` | Copy code buttons                                                             |
| `scripting`      | Connect the ChatGPT context probe to an already-open tab                      |
| `storage`        | Settings, credentials, access rules, and saved chats                          |
| `sidePanel`      | Contextual chat beside the page                                               |
| `<all_urls>`     | Selection controls, requested page/PDF/site context, and provider requests    |

Before submitting, publish the [privacy policy](../../docs/PRIVACY.md), complete
the store's privacy questionnaire to match extension behavior, provide toolbar
and sidebar screenshots, and check the support URL. The extension has no
analytics, advertising, or project-operated content backend. The separately
hosted web app has a different data path, documented in the same policy.
