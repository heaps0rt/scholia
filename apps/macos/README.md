# Scholia for macOS

The Mac app keeps documents, course materials, and tutor conversations in a
native workspace. PDF reading, OCR, indexing, and saved files work locally.
Questions require the provider or local model you select.

Requires macOS 14 or newer, Node.js 24 or newer, and Apple's developer tools.

## Install and update

From the repository root:

```sh
npm run update:macos
```

Or double-click [Update Scholia.command](../../Update%20Scholia.command). It
installs dependencies, builds, installs in Applications, and opens Scholia. Later,
use **Scholia → Update Scholia…**. A Terminal window shows progress.

Updates use the current checkout, including local edits; update your checkout
first to get changes from GitHub. Keep the source folder on your Mac. If you move
it, run its updater once to reconnect the app. Saved data and credentials survive
app replacement; a failed replacement restores the previous app.

Local updates use incremental debug builds. For an optimized build, use
`npm run update:macos -- --release`. `npm run build:macos` only builds the bundle;
`npm run install:macos -- --skip-build --launch` installs an existing build.
`npm run run:macos` runs the Swift package directly. Services and launch at login
need the packaged app. `npm run update:macos -- --help` lists installer options.

The build uses the installed 26.5 SDK when newer Command Line Tools lack the
`SwiftUIMacros.StateMacro` plugin. To choose an SDK explicitly:

```sh
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk npm run build:macos
```

## Signing and permissions

The build prefers Developer ID Application or Apple Development signing. If
neither is available, it creates a persistent **Scholia Local Code Signing**
identity with a non-exportable private key. Stable signing keeps Accessibility
and Screen Recording grants valid across updates. Public distribution still
requires Developer ID signing and notarization.

For a one-time migration from an ad-hoc installation:

```sh
npm run install:macos -- --migrate-permissions --launch
```

Grant permissions to that installed copy once, then use the normal install
command for later updates. Keychain approval is separate: locally signed builds
can prompt again after their code changes. Apple Development or Developer ID
signing provides a stable team identity for that check. Resetting privacy grants
does not fix Keychain prompts. See [Apple's client-identity implementation](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/clientid.cpp).

| Variable                           | Effect                                       |
| ---------------------------------- | -------------------------------------------- |
| `SCHOLIA_CODESIGN_IDENTITY`        | Select a signing certificate                 |
| `SCHOLIA_AUTO_LOCAL_SIGNING=0`     | Disable automatic local certificate creation |
| `SCHOLIA_REQUIRE_STABLE_SIGNING=1` | Reject an ad-hoc build                       |

Accessibility enables selection explanations and visible-window context.
Screen Recording enables desktop region capture. Neither is needed to read a
document or capture a PDF figure inside Scholia. Use **Request Access** in
Settings, then return after granting the permission. Quick Ask, clipboard input,
and Services can be used without Accessibility.

## First launch

1. Save the provider connection in Settings. Open **Browse & test…** or a model
   picker to search the catalog and test a model. **Verified** models can be
   selected. Tests use a short text request and apply to the endpoint and key;
   they do not change your active model.
2. Press Command-1 to open the workspace. Import a file with Command-O, drop a
   file onto the app, or connect Canvas.
3. Read and ask in the tutor pane. The [workspace guide](../../docs/STUDY_WORKSPACE.md)
   covers assignments, downloads, editing, and practice.

## Files in chat

Give a chat a path, or ask it to find a file in a folder. File tools can read PDFs,
Office documents, text/code, and supported images. Broad searches skip hidden
files, bundles, and build/dependency directories; exact paths remain available.
If a search is incomplete, narrow the folder.

**Settings → Privacy → Local files** controls these tools. **Allow file access**
is on by default. **Allow write access** is off by default and permits creating
folders and creating/editing text or code. Replacing an existing file requires a
complete read; a file changed since that read is not overwritten. Turning access
off also blocks later operations in an answer already running.

Read content reaches your selected provider. macOS folder permissions still
apply. The local website shares these chat permissions; hosted accounts and the
extension cannot use them to access your Mac. Classification, practice generation,
and connection tests do not receive file tools.

## Menu-bar companion

| Shortcut              | Action                                      |
| --------------------- | ------------------------------------------- |
| Command-1             | Open the workspace                          |
| Command-2             | Start and open the local website            |
| Command-[ / Command-] | Back / Forward                              |
| Command-Shift-Space   | Open temporary Quick Ask / Quick Chat       |
| Command-Shift-E       | Explain the current selection               |
| Command-Shift-S       | Capture a screen region                     |
| Command-Shift-P       | Toggle Selection Explain for the active app |

Change global shortcuts in Settings. Selection Explain and region capture have
separate per-app switches; use them when the Chrome extension should handle a
browser shortcut. The menu-bar icon reflects the selection switch.

Quick Chat starts as a temporary prompt. Return sends; Shift-Return adds a line.
Attach an image, PDF, or text file for context. **Move to saved chat** keeps the
conversation. You can draft the next question while an answer streams.
**Activity** shows source reads, attachment preparation, and provider-reported
tools or searches; it is retained with saved chats. Selecting part of an answer opens a nested explanation; **Back**
returns to the parent. Editing a sent question regenerates later turns.

**Compact**, **Full**, and **None** control automatic context. When enabled,
sending a question reads a limited amount of visible-window text through
Accessibility and ranks it locally. **None** keeps explicit selections and
attachments but omits surrounding window text. Mail selection can produce a
reply draft inside Scholia; it never sends mail.

Closing the workspace leaves the companion running. `--background` starts only
the companion. Once a window has opened, the Dock icon remains until you quit.

## Providers and storage

Provider keys and Canvas tokens are in Keychain. Preferences use `UserDefaults`;
the study library is under `~/Library/Application Support/Scholia/Study`.
See [Privacy](../../docs/PRIVACY.md) for retention and capture details.

Cloud endpoints require HTTPS; loopback HTTP is allowed for local providers.
The app can start its bundled Codex or Claude Code bridge, reuse a healthy
existing bridge, and stop a bridge it started. Install Node.js and the chosen
CLI first. Ollama and opencode manage their own processes. GPT NTNU requires a
personal API key and an NTNU network or VPN connection.

**Open in Browser** serves this Mac's workspace at `127.0.0.1:8792` while Scholia
is running. The browser receives no raw provider or Canvas credentials.
The [hosted service](../../docs/HOSTING.md) is a separate deployment with its own
accounts and files.

## Development

See [Contributing](../../CONTRIBUTING.md) for tests and smoke checks. Native smoke
scripts accept `SDKROOT`, use temporary libraries, and make no live provider
requests. Browser verification uses Chromium. Full Xcode is needed for the Swift
package's XCTest suite.
