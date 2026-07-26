# Architecture

Scholia separates capture, reasoning, and presentation so native integrations
can feel native without drifting semantically.

```text
platform capture adapter
  ├─ selected text + nearby document context
  ├─ precise rendered-math selection + source notation
  └─ explicit screen-region image
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
- Option/Alt-click on MathJax walks `data-mml-node` ancestors. The user can move
  narrower or wider through a symbol/sub-expression before submitting it;
  plain click selects the whole formula and multi-select can combine symbols.
- Region capture first records coordinates, removes Scholia's overlay, then
  asks the service worker for `tabs.captureVisibleTab()`. Cropping and
  down-sampling happen locally in the content script.

The response popup lives in a closed Shadow DOM root so host-page CSS and most
page scripts cannot alter it accidentally. Markdown is escaped before limited
formatting is applied, and KaTeX runs with `trust: false`.

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

Codex CLI and Claude Code use the loopback OpenAI-compatible bridges in
`scripts/`; opencode uses its native create-session/send-message API. Health
checks and start commands are brokered by the worker, while launching a custom
URL scheme always requires an explicit click and the operating system's normal
external-app confirmation.

### Packaged code

Manifest V3 does not permit remotely hosted executable code. The build bundles
all JavaScript and packages KaTeX CSS/fonts under `vendor/katex`. Network URLs
inside the worker are data endpoints, not imported scripts.

## macOS boundaries

The native prototype uses:

- Accessibility APIs for selected text;
- SwiftUI for the menu-bar surface and explanation window;
- the same normalized capture kinds and prompt rules as the browser app.

It is deliberately not a web wrapper. Provider requests, credentials, and
screen-region capture will be added only with complete native permission and
security boundaries.
