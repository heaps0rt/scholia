# Chrome extension

The Chrome app is built from `apps/chrome` plus `packages/core`.

```sh
npm install
npm run build
```

Load `dist/chrome` as an unpacked extension. Do not load `apps/chrome`
directly: the production directory contains bundled JavaScript and local KaTeX
assets required by Manifest V3.

## Gestures

- Select text: use the small Explain pill.
- Click MathJax: select its whole source expression.
- Option/Alt-click MathJax: choose the exact symbol, then use Narrower/Wider.
- Shift+Alt-click, or press **+ symbol**, to select several math symbols.
- Press ⊘ in the popup to disable Scholia for that website; re-enable it from
  the toolbar panel.
- `Command+Shift+E` / `Ctrl+Shift+E`: explain the current selection.
- `Command+Shift+S` / `Ctrl+Shift+S`: capture a visible region.
- Toolbar icon: open the launcher side panel.

Chrome blocks content scripts on internal pages such as `chrome://settings` and
the Chrome Web Store. Region capture covers the visible page viewport, not
content currently scrolled off-screen.

## Provider protocols

The worker has dedicated wire handling for Anthropic, Ollama, Cohere, and the
native opencode session API. Its OpenAI-compatible path is used by OpenAI,
OpenRouter, Groq, Together, Mistral, custom endpoints, and the local Codex and
Claude Code bridges. Local bridge health, usage, and optional Claude image
support are discovered over loopback. A provider may change model availability
independently of Scholia; settings therefore allow an exact model ID and
endpoint override.
