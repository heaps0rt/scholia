# Scholia for macOS

The Mac app keeps documents, course materials, and tutor conversations in a
native workspace. PDF reading, OCR, indexing, and saved files work locally.
Questions require the provider or local model you select.

Requires macOS 14 or newer, Node.js 24 or newer, and Apple's developer tools.

## Build and install

From the repository root:

```sh
npm ci
npm run build:macos
npm run install:macos -- --launch
```

The build creates `dist/macos/Scholia.app`. The installer checks its signature,
replaces the Applications copy, and verifies the installed app before removing
the backup. For development, `npm run run:macos` runs the Swift package directly.
Services and launch at login need the packaged app.

If Command Line Tools reports a missing `SwiftUIMacros.StateMacro` plugin, set
`SDKROOT` to a compatible SDK installed on your Mac. For example, if available:

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
command for later updates.

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

1. Open Settings, choose a provider, and use **Test provider** with a model.
   Model pickers show tested models for the current endpoint and key.
2. Press Command-1 to open the workspace. Import a file with Command-O, drop a
   file onto the app, or connect Canvas.
3. Read and ask in the tutor pane. The [workspace guide](../../docs/STUDY_WORKSPACE.md)
   covers assignments, downloads, editing, and practice.

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
conversation. Selecting part of an answer opens a nested explanation; **Back**
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
