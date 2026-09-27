# Scholia for macOS

Scholia is a native SwiftUI and AppKit study workspace with PDFKit, local Vision
OCR, Quick Look, a resizable tutor pane, and a menu-bar companion. It requires
macOS 14 or newer. Reading, indexing, navigation, and saved files work without a
web server. Provider requests still require the selected service or local model.

See the [workspace guide](../../docs/STUDY_WORKSPACE.md) for Canvas, assignments,
file views, document editing, and practice.

## Build and install

From the repository root, with Node.js 24 or newer and Apple's developer tools:

```sh
npm ci
npm run build:macos
npm run install:macos -- --launch
```

The build produces `dist/macos/Scholia.app`. The installer verifies the signature,
replaces the Applications copy, verifies it again, and discards the temporary
backup after a successful update. For quick source development, use
`npm run run:macos`; packaged builds are needed for Services and launch at login.

If the macOS 27 Command Line Tools report a missing
`SwiftUIMacros.StateMacro` plugin, select an installed working SDK:

```sh
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk npm run build:macos
```

### Signing and permissions

The build prefers Developer ID Application or Apple Development signing. On a
development Mac without either, it creates a persistent **Scholia Local Code
Signing** identity with a non-exportable private key. A stable designated
requirement lets Accessibility and Screen Recording grants survive later builds.
Public releases still need Developer ID signing and notarization.

An older ad-hoc installation needs a one-time migration:

```sh
npm run install:macos -- --migrate-permissions --launch
```

Grant permissions to the stable-signed copy once, then use the normal install
command for updates. `SCHOLIA_CODESIGN_IDENTITY` selects a certificate;
`SCHOLIA_AUTO_LOCAL_SIGNING=0` disables automatic local identity creation;
`SCHOLIA_REQUIRE_STABLE_SIGNING=1` rejects ad-hoc builds.

## First launch

1. Open Settings, choose a provider, and run **Test provider** for a model.
   Ordinary model pickers show tested models for the current endpoint and key.
2. Open the workspace with Command-1. Import files with Command-O or connect
   Canvas. Finder's Open With and file drops are supported.
3. Grant Accessibility if you want selection explanations or visible-window
   context. Grant Screen Recording for desktop region capture. Reading a
   document and capturing its PDF figure inside Scholia do not need those grants.

Only explicit **Request Access** controls open system permission prompts.
Settings refreshes status when you return from System Settings. Quick Ask,
clipboard input, and Services remain useful without Accessibility.

## Companion shortcuts

| Shortcut              | Action                                      |
| --------------------- | ------------------------------------------- |
| Command-1             | Open study workspace                        |
| Command-2             | Start and open the optional local website   |
| Command-[ / Command-] | Back / Forward in the workspace             |
| Command-Shift-Space   | Open temporary Quick Ask / Quick Chat       |
| Command-Shift-E       | Explain the current selection               |
| Command-Shift-S       | Capture a screen region                     |
| Command-Shift-P       | Toggle Selection Explain for the active app |

Global shortcuts can be changed in Settings. Selection Explain and region
capture have independent per-app switches, so either shortcut can be handed to
the Chrome extension. The menu-bar icon reflects the selection switch.

Quick Chat expands from a prompt into a temporary conversation. Return sends;
Shift-Return adds a line. Paste or attach an image, PDF, or text file for context.
**Move to saved chat** preserves the thread. Select part of an answer to open a
nested explanation, then use Back to return. Editing a sent question regenerates
the conversation from that point.

Quick Chat and saved chats offer **Compact**, **Full**, and **None** automatic
context. When enabled, sending a question reads bounded visible-window text via
Accessibility and ranks it locally. It does not continuously monitor windows.
None retains explicit selections and attachments while omitting surrounding
window context. Mail selection can draft a reply in Scholia; it never sends it
through the mail client.

Closing the workspace leaves the menu-bar companion running. Launch with
`--background` to start only the companion. Open Scholia windows share one Dock
identity; the Dock icon remains until quit after a window has been opened.

## Providers and local data

Provider keys and Canvas tokens use Keychain. Preferences use `UserDefaults`;
workspace documents and conversations use Application Support. See
[Privacy](../../docs/PRIVACY.md) for retention and capture details.

Hosted providers require HTTPS. Loopback HTTP is allowed for local providers.
The native app starts its bundled Codex or Claude Code bridge when selected,
reuses a healthy existing bridge, and stops only processes it owns. Node.js and
the chosen CLI must be installed. Ollama and opencode keep their own lifecycle.
GPT NTNU requires its personal API key and an NTNU network or VPN connection.

**Open in Browser** starts a loopback server on `127.0.0.1:8792` for this Mac's
workspace. The browser receives no raw provider or Canvas secrets. It requires
the app to remain running. The [hosted web service](../../docs/HOSTING.md) is a
separate deployment with separate account storage.

## Verification

```sh
npm run check
npm run smoke:macos:workspace -- --data-only
npm run smoke:macos:workspace -- --learning-only
npm run smoke:macos:workspace -- --assignments-preview --assignment-page-smoke
zsh scripts/smoke-macos-panels.sh
```

Smoke scripts accept `SDKROOT`. They link actual application code against
isolated libraries and deterministic fixtures. The panel check exercises
content changes and resizing without provider requests. Browser verification
uses Chromium. With full Xcode installed, `swift test --package-path apps/macos`
also runs the Swift package tests.
