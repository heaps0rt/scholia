# Scholia

Select text, rendered mathematics, or a visible screen region and ask for an
explanation without leaving the source.

Scholia currently includes a production-buildable Chrome extension, shared
provider and prompt contracts, local CLI bridges, and a native macOS
foundation.

## Chrome extension

Node.js 20 or newer is required.

```sh
npm ci
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**,
and select `dist/chrome`.

- Select text to open the Explain popup.
- Explanations use page-wide context by default. Short pages are retained in
  full; long pages are indexed locally into a bounded outline, selection
  neighborhood, and relevant excerpts before a provider request is made.
- Click rendered math to select the full expression.
- Option/Alt-click math to select a symbol or sub-expression; use
  **Narrower**, **Wider**, or **+ symbol** to refine it.
- Select text or mathematics inside an answer to open a child explanation.
  Child explanations form a visible stack; Back returns to the parent answer.
- Press `Ctrl+Shift+S` (`Command+Shift+S` on macOS) to capture a visible region.
- Press ⊘ in the popup to disable Scholia on the current website. Re-enable it
  from the toolbar panel or settings page.
- Website access can instead use an allowlist, keeping Scholia inactive except
  on explicitly whitelisted hostnames.

Chrome does not allow content scripts on internal pages such as
`chrome://settings` or the Chrome Web Store.

## Providers and local bridges

Hosted providers use keys stored in `chrome.storage.local`; credentials remain
inside extension-owned settings and service-worker contexts and are never
exposed to page content. Local providers use loopback interfaces:

| Provider | Endpoint | Start command | macOS launcher installer |
| --- | --- | --- | --- |
| Claude Code | `127.0.0.1:8787` | `npm run bridge:claude` | `npm run bridge:install:claude` |
| Codex CLI | `127.0.0.1:8789` | `npm run bridge:codex` | `npm run bridge:install:codex` |
| opencode | `127.0.0.1:4096` | `opencode serve --port 4096` | `npm run bridge:install:opencode` |

The bundled Codex and Claude bridges accept the Chrome extension, localhost,
and `https://folk.ntnu.no` as browser origins, so one running bridge can serve
both integrations. When starting opencode manually for the website, add
`--cors https://folk.ntnu.no`.

Claude image input is disabled by default. Start its bridge with
`node scripts/claude-code-bridge.mjs --allow-images` to opt in.

## Repository layout

- `apps/chrome` — Manifest V3 extension sources and static assets.
- `apps/macos` — SwiftUI menu-bar application foundation.
- `packages/core` — provider definitions, prompt construction, and request
  schema.
- `scripts` — reproducible builds and optional local bridge tooling.
- `tests` — focused contract, protocol, streaming, and renderer tests.

## Development

```sh
npm run check       # syntax checks, Swift parsing, and tests
npm run build       # rebuild dist/chrome from a clean directory
npm run check:dist  # validate the packaged extension
```

Design boundaries are documented in [Architecture](docs/ARCHITECTURE.md) and
[Privacy and security](docs/PRIVACY.md).

## License

[MIT](LICENSE)
