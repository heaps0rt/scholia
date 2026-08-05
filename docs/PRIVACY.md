# Scholia privacy policy

**Effective date:** 5 August 2026

Scholia explains material that you choose from a web page, PDF, screenshot, or
image. The project does not operate a server and does not include analytics,
advertising, or telemetry. Data is processed on your device and, when you ask a
question, sent directly to the AI provider or endpoint you configured.

## Data Scholia handles

Depending on the feature you use, Scholia may handle:

- selected text or mathematical notation;
- your question, recent conversation turns, and selected answer text used for a
  follow-up explanation;
- the title and address of the current page, with URL query parameters and
  fragments removed before provider submission;
- rendered page text, locally built headings, and relevant excerpts when
  page-wide context is enabled;
- same-origin page text when you explicitly enable **Entire site** for a
  question;
- PDF text and page numbers extracted locally from a document you opened or
  chose;
- a visible-tab region, visible-page fallback, or image you explicitly chose or
  pasted;
- provider, model, language, endpoint, and per-site access settings;
- provider API keys or local-endpoint credentials; and
- the current site's hostname when you add it to an allowlist or blocklist.

Scholia does not read Chrome browsing history, cookies, form history, contacts,
location, or financial information.

## How data is used

Data is used only to provide the explanation or contextual conversation you
request, remember your extension settings, enforce your site access choices,
and keep an active conversation grounded in the source you chose.

Long pages, sites, and PDFs are indexed on the device. The extension sends a
bounded context pack rather than the complete local index. Screenshots and
chosen images are resized on the device before submission.

## When data leaves the device

Scholia sends a provider request only after an explicit action such as asking a
question, choosing **Explain**, starting a capture, or submitting a follow-up.
That request goes directly to the provider or compatible endpoint selected in
Settings. Supported hosted choices include Anthropic, OpenAI, OpenRouter, Groq,
Together AI, Mistral AI, and Cohere. You can instead choose Ollama, a local CLI
bridge, opencode, or a custom compatible endpoint.

The selected provider receives the question and the source material required
for that explanation. An API key is sent only to its configured endpoint for
authentication. The provider's own privacy policy, retention settings, and
service terms apply. Local CLI tools may contact the model service associated
with your local login.

The Scholia project does not receive, sell, rent, or use this data for
advertising, profiling, creditworthiness, or model training. It does not allow
project maintainers or other humans to read your content.

## Storage and retention

Provider settings, API keys, and site access rules are stored in
`chrome.storage.local` until you change them, clear the extension's data, or
uninstall Scholia. Chrome extension storage is not an operating-system
keychain; use a dedicated, revocable provider key with a spending limit.

The latest page selection may be placed in `chrome.storage.session` for up to
ten minutes so the side panel can receive it. It is scoped to the originating
tab and removed when submitted or cleared. Conversations stay in extension
memory while their UI is open. A same-site crawl stays in content-script memory
for up to ten minutes. Session data disappears when the browser session ends.

Scholia has no account database or backend copy to retain or delete. Uninstall
the extension or clear its extension data in Chrome to remove locally stored
settings. Provider-side deletion requests must be made to the provider you
selected.

## Browser access and user controls

Scholia requests access to websites because its single purpose is to explain
content on the page you are reading. It uses that access for selection UI,
explicit page context, user-initiated PDF reading, explicit same-site context,
and visible-tab capture. It does not passively collect a browsing history or
take background screenshots.

You can disable Scholia on individual sites or switch to allowlist mode, which
keeps it inactive everywhere except the hostnames you approve. Site-wide
reading is off until you enable **Entire site** for a question. Page-wide
context can also be disabled in Settings.

## Security

Hosted provider traffic uses HTTPS. Unencrypted HTTP is allowed only for
loopback endpoints on the same device. Provider credentials remain in
extension-owned settings and service-worker contexts; they are never inserted
into page content or sent to content scripts.

Model output is HTML-escaped before a small Markdown and KaTeX subset is
rendered. Remote executable code is not loaded. These measures reduce risk but
cannot make an external provider, model response, or untrusted page infallible.
Do not use Scholia as the sole authority for safety-critical decisions.

## Children

Scholia is a general-purpose reading tool and is not directed to children under
13. The project does not knowingly collect personal information from children.

## Limited Use

Scholia's use of information received from Google APIs adheres to the Chrome Web
Store User Data Policy, including the Limited Use requirements. Data access is
limited to providing the extension's user-facing explanation features.

## Changes and contact

Material changes to this policy will be dated here and disclosed with the
corresponding extension update. Questions may be opened in the repository's
[issue tracker](https://github.com/heaps0rt/scholia/issues). Report security or
sensitive privacy problems privately through
[GitHub Security Advisories](https://github.com/heaps0rt/scholia/security/advisories/new).
