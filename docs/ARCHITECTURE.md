# Architecture

Scholia separates capture, reasoning, and presentation so native integrations
can feel native without drifting semantically.

```text
platform capture adapter
  ├─ selected text + adaptive page-wide context
  ├─ precise rendered-math selection + source notation
  ├─ explicit screen-region image
  └─ explicitly chosen or clipboard-pasted image
                │
                ▼
       normalized explain request
                │
                ▼
     platform-owned provider runtime
       (credentials never cross into page content)
                │
                ▼
        streaming explanation UI
```

The normalized shape is documented in
`packages/core/schemas/explain-request.schema.json`. JavaScript prompt and
provider contracts live in `packages/core/src`; other platforms implement the
same concepts in their native language.

## Chrome boundaries

### Content script

`apps/chrome/src/content.js` runs in Chrome's isolated content-script world and
owns the in-page UI. Capture and math extraction live in `page-capture.js`.
Neither module receives API keys.

The content script supports three capture adapters:

- Text selection clones the selected DOM fragment and replaces accessible
  MathJax/KaTeX/MathML nodes with source-like `$...$` notation.
- Page context starts with the complete rendered body text. Pages that fit the
  context budget are retained verbatim. Longer pages are segmented and ranked
  locally against the selection and initial question; the provider receives a
  bounded pack containing a whole-page heading map, the selection neighborhood,
  and the strongest excerpts from across the document.
- Option/Alt-click on MathJax walks `data-mml-node` ancestors. The user can move
  narrower or wider through a symbol/sub-expression before submitting it;
  plain click selects the whole formula and multi-select can combine symbols.
- Region capture first records coordinates, removes Scholia's overlay, then
  asks the service worker for `tabs.captureVisibleTab()`. Cropping and
  down-sampling happen locally in the content script.

The response popup lives in a closed Shadow DOM root so host-page CSS and most
page scripts cannot alter it accidentally. Markdown is escaped before limited
formatting is applied, and KaTeX runs with `trust: false`.

Assistant answers remain selectable. A selection inside an answer opens a new
layer over the current explanation. Every parent remains fully rendered as an
inert panel behind the active window and is restored by Back. The child request
receives a bounded parent-context pack with the complete relevant answer region,
recent parent turns, and a compact trace of earlier layers.

### Side panel and PDF adapter

The extension-owned side panel can begin a conversation without a text
selection. For ordinary web pages it requests a context pack from the content
script, using the same page-title, rendered-text, outline, and local ranking
pipeline as an in-page explanation. The packed context is fixed for that chat,
so switching tabs does not silently change the conversation's source.

Explicit page selections are briefly mirrored through `chrome.storage.session`
so an already-open side panel—and a panel opened just after selection—can show
the excerpt in its source card and composer. In an existing conversation the
excerpt is scoped only to the next turn, preserving the original context pack.
Selecting assistant text in the panel creates the same kind of bounded,
delimited context inside a separate explanation window. That child window has
its own transcript and follow-up composer, leaving the original sidebar chat
unchanged behind it. Editing a main-chat user turn truncates the later
transcript and resubmits from that point.

When the user explicitly enables **Entire site**, the active content script
performs a bounded breadth-first crawl of same-origin HTML links. It strips
scripts, navigation, forms, and hidden content from fetched documents, reads at
most 48 pages / 1.2 million text characters over three link levels, and caches
the corpus locally for ten minutes. A site map plus question-ranked excerpts is
packed into the ordinary 24,000-character model context budget. Cross-origin,
download, sign-out, deletion, and unsubscribe links are never followed.

Chrome's built-in PDF viewer does not accept Scholia's content script. The
service worker therefore routes detected PDFs to an extension-owned PDF.js
viewer with a canvas and selectable text layer. The standard content UI runs on
that text layer, so pointer selection opens the same Explain pill as an ordinary
page. A one-click **Chrome view** action bypasses routing when the native viewer
is preferred. Existing built-in-viewer context-menu events still fall back to
the side panel.

The viewer and panel fetch the PDF under the extension's existing host
permission and extract text locally. Each page receives an explicit marker, and
a page map plus the selected passage and question are passed to the shared
context packer. The original address is held behind an opaque session token;
signed URL query data is kept for the local fetch but removed from both the
viewer address and the URL sent to a provider.

Local, authenticated, generated, password-protected, or scanned PDFs may not
yield downloadable text. The panel offers an explicit file chooser and a
visible-page image fallback. Region cropping and 1800-pixel down-sampling occur
inside the panel before provider submission.

Both the side-panel and in-page composers accept an explicitly selected local
image or an image pasted from the clipboard. The browser decodes it, flattens
transparency, and limits its longest edge to 1800 pixels before it becomes the
source for a new conversation. The Codex loopback bridge materializes the
base64 request block in a private temporary directory, passes the path to
`codex exec --image`, and removes it when that process exits.

### Service worker

`apps/chrome/src/service-worker.js` owns:

- `chrome.storage.local` settings and credentials;
- provider requests and streaming parsers;
- tab capture;
- commands, context menus, and side-panel coordination.

Only public settings—provider/model names and UI preferences—are returned to a
content script. Full settings can be requested only when the message sender is
an extension-owned URL.

The long-lived chat port keeps a Manifest V3 service worker alive while an
answer streams and gives the popup an explicit cancellation path. A heartbeat
keeps slow local/free models alive before their first streamed token.

The packed page context is fixed for the life of an explanation conversation,
placed before the selected excerpt and question, and reused on follow-ups. This
keeps the model's grounding stable and gives prefix-caching providers a stable
request prefix while recent conversation turns remain bounded.

Codex CLI and Claude Code use the loopback OpenAI-compatible bridges in
`scripts/`; opencode uses its native create-session/send-message API. Health
checks and start commands are brokered by the worker, while launching a custom
URL scheme always requires an explicit click and the operating system's normal
external-app confirmation.

### Packaged code

Manifest V3 does not permit remotely hosted executable code. The build bundles
all JavaScript and packages KaTeX CSS/fonts under `vendor/katex` and PDF.js,
its worker, character maps, and standard fonts under `vendor/pdfjs`. Network
URLs inside the worker are data endpoints, not imported scripts.

## macOS boundaries

The native prototype uses:

- Accessibility APIs for selected text;
- SwiftUI for the menu-bar surface and explanation window;
- the same normalized capture kinds and prompt rules as the browser app.

It is deliberately not a web wrapper. Provider requests, credentials, and
screen-region capture will be added only with complete native permission and
security boundaries.
