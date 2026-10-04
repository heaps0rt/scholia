# Scholia

Read a document and ask questions beside it. Scholia combines a reader, a tutor
conversation, and a library of course materials. You choose the AI provider.

| Client           | What it does                                                                            | Setup                              |
| ---------------- | --------------------------------------------------------------------------------------- | ---------------------------------- |
| macOS            | Native reader, Canvas courses, local OCR, practice and review, and a menu-bar companion | [Mac app](apps/macos/README.md)    |
| Web              | Browser workspace served by the Mac app or an independent account server                | [Hosting](docs/HOSTING.md)         |
| Chrome extension | Explain selections, mathematics, pages, and PDFs as you browse                          | [Extension](apps/chrome/README.md) |

Use **Search files** to find saved passages, **Exam dates** to plan a schedule,
and **Practice course** to work through downloaded material.

The Mac app and its local website share a library. Hosted accounts and the
extension have separate storage; there is no automatic sync between them.

## Quick start

Install Node.js 24 or newer (see `.nvmrc`), then run these commands from the
repository root:

```sh
npm ci
```

**macOS** requires macOS 14 or newer and Apple's developer tools:

```sh
npm run update:macos
```

You can also double-click [Update Scholia.command](Update%20Scholia.command).
Updates build the current checkout and keep your saved data.

Choose a provider in Settings, test a model, and import a file or connect Canvas.
The [Mac guide](apps/macos/README.md) covers signing and permissions.

**Hosted web:**

```sh
npm run build:web
npm run web:user -- --email you@example.com
npm run start:web
```

Enter a password when prompted, then open `http://127.0.0.1:3000`.
For deployment, follow the [hosting guide](docs/HOSTING.md).

**Chrome extension:**

```sh
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**,
and select `dist/chrome`. Set up a provider in the extension's settings.

## Guides

- [Study workspace](docs/STUDY_WORKSPACE.md): reading, Canvas, assignments, and editing.
- [Search](docs/SEARCH.md): find filenames and passages across workspaces.
- [Practice and review](docs/PRACTICE.md): questions, feedback, and review scheduling.
- [Extension guide](apps/chrome/README.md): shortcuts, PDF reading, providers, and releases.
- [Architecture](docs/ARCHITECTURE.md): code layout and runtime boundaries.
- [Contributing](CONTRIBUTING.md): development commands, tests, and pull requests.
- [Privacy](docs/PRIVACY.md): what is stored and what reaches a provider.

Scholia has no analytics or telemetry. The Mac app and extension send requests
to your selected provider. Hosted web sends them through your server, whose
operator can access stored files, conversations, and credentials.

## Development

```sh
npm run check          # JavaScript tests and JS, JSON, and Swift syntax checks
npm run build:web      # dist/web
npm run package:chrome # validated extension ZIP in dist/
```

Browser tests use Chromium. Build output and private data are ignored by Git.
See [Contributing](CONTRIBUTING.md) for the full verification commands.

[MIT license](LICENSE)
