# Chrome Web Store copy

The upload bundle is `dist/scholia-chrome-0.1.0.zip` after running
`npm run package:chrome`. Use `screenshot-explain.png`, `promo-small.png`, and
`apps/chrome/assets/icon-128.png` for the listing.

**Name:** Scholia — Select & Explain

**Summary:** Select text, precise math, or a screen region and get a contextual
AI explanation.

**Single purpose:** Explain content the user chooses from the current page,
image, or PDF through an AI provider selected by the user.

## Description

Scholia keeps difficult material and its explanation side by side.

Select a paragraph or rendered equation to ask about it in place. Open the side
panel for a longer conversation with the current page, attach an image, capture
part of the visible tab, or read a PDF with page-numbered context.

Long pages are indexed locally and reduced to relevant excerpts before a
request is sent. Site-wide reading runs only when you explicitly enable it for
a question. There is no Scholia backend, advertising, analytics, or telemetry;
requests go directly to the provider you configure.

## Review notes

- `activeTab` handles explicit selections and visible-region capture.
- `contextMenus` adds the two user-invoked explain actions.
- `storage` holds settings, credentials, site rules, and short-lived selection
  handoff between extension surfaces.
- `sidePanel` hosts page and PDF conversations.
- `<all_urls>` makes selection available on ordinary pages and lets an explicit
  request read the current page, fetch its PDF, or crawl same-origin links.

Privacy policy:
`https://github.com/heaps0rt/scholia/blob/main/docs/PRIVACY.md`
