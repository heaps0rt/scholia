# Privacy and security model

Scholia has no hosted relay, analytics, or telemetry in this repository.

## Data that can leave the device

Only after a user gesture, the configured AI provider may receive:

- the selected text or mathematical expression;
- the user's question and prior turns in the open Scholia conversation;
- nearby page text, when **Include nearby page text** is enabled;
- the selected screenshot region, for a vision-capable provider;
- the page title and URL without query parameters or fragments, as source
  context.

The provider's own data policy then applies. Local Ollama and loopback bridges
keep browser-to-runtime traffic on the configured local endpoint. Codex CLI,
Claude Code, and opencode may themselves contact the model service associated
with the user's local login.

## Chrome credential boundary

API keys are stored in `chrome.storage.local` and read by the service worker.
They are not sent to content scripts, inserted into page DOM, or stored in a
site's localStorage. Chrome extension storage is still not an OS keychain; use
a dedicated, revocable key with a spending limit.

The extension needs broad host access because its core purpose is to work on
arbitrary pages and because `captureVisibleTab` requires host access (or a
temporary `activeTab` grant). Scholia does not perform passive browsing-history
collection or background screenshots.

Per-site disable state stores only a hostname (for example `example.org`) in
extension-local settings. When disabled, Scholia does not open selection or
capture UI on that site; the toolbar panel remains available to re-enable it.

## Capture guarantees

- Text is read only from the current explicit selection.
- A screenshot is requested only after the user starts region-capture mode and
  finishes a drag.
- Only the selected rectangle is retained by the popup and sent to the chosen
  provider.
- Capture overlays are removed for two animation frames before Chrome takes the
  image.
- Images are down-sampled to a maximum edge of 1800 pixels before submission.

## Content safety

Web-page context is placed inside explicit reference delimiters and the system
prompt tells the model never to treat it as instructions. Model Markdown is
HTML-escaped. The renderer supports a small formatting subset and invokes
KaTeX with trusted commands disabled.

These measures reduce prompt-injection and rendering risk; they cannot make an
untrusted model or provider infallible. Scholia should not be used as the sole
authority for medical, legal, financial, or safety-critical decisions.

## macOS

The native app will use Keychain for keys and request Accessibility and Screen
Recording permissions separately, at the moment each capability is invoked.
