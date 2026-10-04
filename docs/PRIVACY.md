# Scholia privacy policy

**Effective date:** 27 September 2026

**Documentation updated:** 4 October 2026

Scholia has no analytics, advertising, or telemetry. It handles the material you
choose to read or explain. Where that data is stored depends on the client:

| Client              | Storage and provider requests                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome extension    | Settings and history stay in extension storage. Questions go directly to your chosen provider.                                                                                |
| Mac app             | The library stays on your Mac; credentials use Keychain. Questions go directly to your chosen provider.                                                                       |
| Mac's local website | Shares the Mac app's library and provider connection over loopback.                                                                                                           |
| Hosted web          | Files, conversations, and credentials stay on the server you sign into. That server sends provider requests. Its operator can access the stored data and decrypt credentials. |

These libraries do not automatically synchronize. Hosted operators must supply
their own contact, backup, and retention details in addition to this policy.

## Data used for a question

Depending on the feature, a question can include:

- Your prompt, conversation turns, selected text or math, and selected parts of
  earlier answers.
- A page title and sanitized address, relevant page or PDF text, page numbers,
  readable image labels, and a sanitized DOM snapshot.
- A chosen or pasted image, an explicitly captured region, or a page visual
  requested with **Complete page**.
- Text from same-origin pages requested with **Entire site**.
- Extracted text from attached PDF, Office, text, or code files. Images are
  resized locally; raw document bytes are not sent as chat attachments.
- Relevant Canvas course excerpts or an imported ChatGPT memory/project snapshot
  when those context options are enabled.
- In supported mail readers, the conversation around a selected passage,
  including visible participants, dates, and attachment names. Attachment
  contents and unrelated inbox messages are not read for this feature.
- In the Mac companion, a limited amount of visible-window Accessibility text
  when automatic context is enabled.

Provider, model, language, endpoint, and access settings determine how the
request is sent. An API key is sent only to its configured endpoint.

Page snapshots omit scripts, styles, event handlers, live form values, Scholia
controls, and large inline data URLs. Provider source addresses omit URL query
parameters and fragments. Long sources are ranked locally and reduced to a
context pack. Compact extension context is about 6,000 characters; saved ChatGPT
context has a separate limit of about 4,000. Full allows a larger pack. **None**
omits automatic context while keeping explicit selections and attachments.

Selecting text alone does not contact a model. Asking a question, choosing
**Explain** or **Draft reply**, or submitting another explicit request does.
Scholia displays mail drafts in its own interface and never sends them through
the mail client.

## Providers and web search

The Mac app and extension send requests to the selected service directly. Hosted
web routes requests through its server. Provider policies, retention settings,
and terms apply to the content they receive. Local CLI tools may contact the
model service associated with your CLI login.

**Web search**, when enabled for a supported provider, asks that provider or the
Codex bridge to search for the current turn. Search queries can reach the
provider's search infrastructure or partners. The provider's search terms apply.

Native and extension content is not sent to project maintainers. The software
does not collect data for advertising, profiling, or model training. A hosted
operator can access its files, database, backups, and encryption key.

## Chrome extension

### Settings and history

Provider settings, keys, access rules, and imported ChatGPT snapshots are stored
in `chrome.storage.local` until changed, cleared, or removed by uninstalling.
This storage is not an operating-system keychain.

Saved chats include questions, answers, selected excerpts, a limited source pack,
sanitized source addresses, and size-limited images. Provider-returned reasoning
may be stored with an answer. History is limited to 24 recent chats and an
internal serialized-size budget. It does not retain raw PDF download addresses,
tab IDs, or oversized source images. Delete individual chats or use **Clear all**.

Selections and mail context may be held in `chrome.storage.session` for up to
ten minutes to reach the side panel. They are scoped to the originating tab and
cleared on submission, removal, navigation, or replacement in a PDF reader.
Same-site crawl results remain in content-script memory for up to ten minutes.
Session data disappears when the browser session ends.

### PDF and Canvas caches

PDF indexes are stored in extension IndexedDB by document fingerprint. They
contain no source URL or local filename. The cache holds up to 12 indexes within
a 60-million-character limit and evicts older entries.

On supported Chromium versions, a PDF stream is used once and not persisted.
Compatibility routes may keep an original address behind an opaque viewer token
in local storage: at most 256 records, expiring after 180 days of inactivity.
Signed query parameters can remain in that private record when needed to fetch
a file, but are removed from provider context.

A PDF chosen with Chromium's file picker may keep its filename and a revocable
file handle in IndexedDB so the reader can reopen it. This does not store a copy
of its bytes or expose its filesystem path. There are at most 32 handles, each
expiring after 180 days of inactivity. Chromium may ask for permission again.
Blob/data sources and the legacy file input last only for the session.

With automatic context enabled on a Canvas course page, Scholia uses the browser
session for read-only access to the syllabus, pages, assignments, modules, and
accessible files. It verifies access before reusing a cache. Text indexes are
separated by host, account, and course; up to eight courses are retained.
Refresh reconciles changed and removed content. **Clear index** removes the
current course cache. Only relevant excerpts and links reach the provider.
Automatic context can also include relevant readable open tabs. **None** omits
these automatic sources.

Clearing extension data or uninstalling removes these settings, histories, and
caches. It does not remove copies retained by a provider.

### Optional ChatGPT import

The extension reads selected text, an open settings/project dialog, or the
rendered memory manager when you request an import. **Get full memory from
ChatGPT** opens a separate Personalization tab, waits for the memory summary to
finish, and saves an editable local snapshot. It does not read cookies, call
private account endpoints, or enumerate chats or project files.

A Quick Chat refresh interval performs the same rendered-UI read in a temporary
tab, then closes it. Available intervals are every chat, 3 or 12 hours, or 1, 3,
or 7 days. Missed refreshes run in the background; the question uses the last
saved snapshot.

Imported context can be sent when explicitly enabled for a response explanation
or automatically on ChatGPT pages when that option is enabled. Global memory is
included; project text requires a matching project ID. Selecting a Quick Chat
refresh interval also includes the snapshot in new Quick Chats outside ChatGPT.
**Manual only** disables that Quick Chat refresh and inclusion. Clear the fields
in Settings to remove the snapshot. This text can reach a provider other than
OpenAI if that is your selected provider.

### Browser permissions

Website access supports selection controls, requested page/site/PDF context,
and visible-tab capture. Scholia does not collect browser history or take
background screenshots. Disable individual sites or choose allowlist mode.
**Entire site** and **Complete page** are explicit options; page capture restores
the original scroll position.

Clipboard-write permission supports Copy code buttons. It does not grant
clipboard-reading access. The extension does not collect form history, contacts,
location, or financial information. Canvas requests can use a browser session
without copying its cookies to providers or page content.

## Mac app and local website

Provider credentials and personal Canvas tokens use Keychain. Preferences use
`UserDefaults`, including per-app shortcut switches and application identifiers.
Quick Ask stays in memory unless you choose **Move to saved chat**. Saved chats
use a limited JSON history in Application Support and can be cleared in Scholia.

The study library lives under `~/Library/Application Support/Scholia/Study`.
It contains originals, indexes, reading positions, course catalogs, conversations,
drafts, edit revisions, and a separate practice event store. Practice records
include questions, attempts, assistance, feedback, concerns, and review dates.
Removing a workspace removes its library entry while retaining files and earlier
revisions for recovery. Close Scholia before clearing library files on disk.
Keychain credentials are separate and are not deleted with the library.

Canvas sign-in uses the app's WebKit data store; Scholia does not collect your
institutional password. Refresh reads course metadata and submission status.
Opening a material downloads it; bulk-download controls fetch more. Optional
frequent-course preloading may fetch a small batch after repeated visits and an
idle delay. It can be disabled. Hiding an assignment changes only Scholia's list.

### Desktop capture

Accessibility reads selected text and skips protected fields. The optional
selection pill checks after mouse-up in an enabled app. A Command-C fallback is
used only after an explicit explain action or a selection in Scholia's answer
when Accessibility cannot provide it. The previous clipboard is restored if
nothing else has written to it.

When visible-window context is enabled, sending a question performs one text
scan. It checks at most five candidate windows and sends at most three locally
ranked windows within a 6,000-character workspace budget and an 8,000-character
combined automatic-context budget. Full mode allows up to 24,000 characters;
**None** omits automatic text. Secure fields, password managers, minimized
windows, Scholia windows, and system surfaces are skipped. This scan does not
run between questions or take screenshots.

The scan prioritizes the previously active app and, for the first root Quick
Chat question, a visible ChatGPT desktop conversation when available. Browser
text may be matched to titles exposed by Accessibility. Source app and window
titles can accompany a selection. Recognized mail selections may include the
nearest loaded conversation, without opening attachments or scanning the inbox.

Screen capture starts only from the region command. The selected area is cropped
and resized locally. A region question may include visible text and a sanitized
address from the focused window. Local directory paths, URL credentials, query
parameters, and fragments are removed.

### Local website

**Open in Browser** starts a server on `127.0.0.1:8792` with a per-launch token,
Host/Origin validation, and cross-site request checks. It shares the Mac library
and works only while Scholia runs. Provider and Canvas secrets stay in the app.
Opening the native workspace alone does not start the server.

## Hosted accounts

The hosted server stores account email addresses, salted scrypt password hashes,
session records, files, indexes, conversations, source references, reading
history, drafts, edits, Canvas metadata, and provider settings. API access checks
account ownership. Separate sessions keep independent navigation.

Provider keys and Canvas tokens are encrypted with AES-256-GCM and a server-held
key. The operator can decrypt them and read document contents; this is not
end-to-end encryption.

Sessions use HttpOnly, SameSite=Strict cookies, with Secure on HTTPS, and expire
after seven days. The database stores hashes of session tokens. Sign-out revokes
the current session; a password reset revokes all sessions for that account.
Login attempts are limited by account and connection address. A proxy or hosting
platform may keep access logs under the operator's policy.

Browser preferences and drafts are scoped to the account. Signing out clears
session draft storage. Clearing browser data does not delete server data.
Previous document versions and backups may remain after edits or removal.
There is no self-service account deletion; contact the operator for file/account
deletion and backup retention. Contact the provider for provider-side deletion.

Hosted files need server access and are not an automatic browser offline copy.
Native desktop capture, Vision OCR, and the native practice store are not hosted
features. [Hosting](HOSTING.md) covers operator configuration and backups.

## Security and contact

Cloud provider requests require HTTPS; plain HTTP is limited to loopback.
Extension credentials stay in extension-owned settings and the service worker,
not content scripts. Answers render locally with unsafe links, executable HTML,
and remote answer images blocked. Math fonts and executable dependencies are
bundled. These controls do not guarantee the accuracy of a model's answer.

Scholia is a general-purpose reading tool, not directed to children under 13.
The project does not knowingly collect personal information from children.
Scholia's use of information received from Google APIs follows the Chrome Web
Store User Data Policy, including Limited Use requirements, for its user-facing
explanation features.

Material policy changes will be dated here and disclosed with the corresponding
extension update. Ask general questions in the
[issue tracker](https://github.com/heaps0rt/scholia/issues). Report sensitive
privacy or security issues privately through
[GitHub Security Advisories](https://github.com/heaps0rt/scholia/security/advisories/new).
