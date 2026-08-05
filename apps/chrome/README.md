# Chrome extension

The Chrome app is built from `apps/chrome` plus `packages/core`.

```sh
npm install
npm run build
```

Load `dist/chrome` as an unpacked extension. Do not load `apps/chrome`
directly: the production directory contains bundled JavaScript and local KaTeX
assets required by Manifest V3.

Each local build stamps `dist/chrome/manifest.json` with a fresh Chrome-valid
version that Brave and Chrome display directly, so rebuild before reloading the
unpacked extension. Release builds can set an explicit version with
`SCHOLIA_EXTENSION_VERSION=1.2.3 npm run build`.

## Gestures

- Toolbar side panel: ask questions grounded in the current page or complete
  PDF, then continue the conversation without leaving the source.
- A text selection on the source page is mirrored into the side panel as both
  the active source excerpt and a removable composer attachment. If a chat is
  already underway, the selection is attached to the next turn without
  changing the chat's fixed source context.
- Select text inside a side-panel assistant response to open an anchored
  Explain prompt. Submitting it opens a separate explanation window with its
  own follow-ups instead of inserting a turn into the original chat. User query
  bubbles expose **Edit**; saving an edit discards later turns and regenerates
  the answer from the changed query.
- The side-panel **Entire site** toggle explicitly follows same-origin links,
  reads up to 48 HTML pages, and searches the resulting local index for each
  initial question. The packed context remains fixed for follow-ups.
- Select text: use the small Explain pill; click anywhere outside it to dismiss.
- Open a PDF: Scholia routes it to a selectable extension-owned view. Mark text
  to show the ordinary Explain pill in place; **Chat with PDF** opens the side
  panel with locally extracted, page-numbered context. **Chrome view** returns
  to the built-in viewer when needed.
- Click MathJax: select its whole source expression.
- Option/Alt-click MathJax: choose the exact symbol, then use Narrower/Wider.
- Shift+Alt-click, or press **+ symbol**, to select several math symbols.
- Select text or mathematics inside an assistant answer to explain it in a new
  layer. Parent explanations remain fully rendered behind the active panel and
  available as context; Back returns to the previous layer.
- Press ⊘ in the popup to disable Scholia for that website; re-enable it from
  the toolbar panel.
- Settings can switch website access to allowlist mode; the toolbar then adds
  or removes the current website from the whitelist.
- `Command+Shift+E` / `Ctrl+Shift+E`: explain the current selection.
- `Command+Shift+S` / `Ctrl+Shift+S`: capture a visible region.
- Use the image button in either composer to choose a local image, or paste an
  image directly into the question field. Scholia opens it as a new image-
  grounded conversation and keeps any question already typed.
- Toolbar icon: open the launcher side panel.

Chrome blocks content scripts on internal pages such as `chrome://settings`,
the Chrome Web Store, and its built-in PDF viewer. PDFs are handled in Scholia's
own selectable viewer and side panel. Region capture covers the visible page
viewport, not content currently scrolled off-screen.

For local `file://` PDFs, enable **Allow access to file URLs** on Scholia's
extension details page, or use **Choose PDF file** when the panel asks. PDF text
extraction, page mapping, and relevance ranking all happen locally; only the
bounded context pack is included in a provider request.

## Provider protocols

The worker has dedicated wire handling for Anthropic, Ollama, Cohere, and the
native opencode session API. Its OpenAI-compatible path is used by OpenAI,
OpenRouter, Groq, Together, Mistral, custom endpoints, and the local Codex and
Claude Code bridges. Local bridge health, usage, Codex image support, and
optional Claude image support are discovered over loopback. A provider may change model availability
independently of Scholia; settings therefore allow an exact model ID and
endpoint override.
