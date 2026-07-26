#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMacUrlHandlerInstaller } from './lib/macos-url-handler.mjs';

const scripts = dirname(fileURLToPath(import.meta.url));

runMacUrlHandlerInstaller({
  scriptName: 'install-opencode-handler.mjs',
  displayName: 'Scholia opencode Launcher',
  appName: 'ScholiaOpencodeLauncher.app',
  bundleId: 'app.scholia.opencodelauncher',
  scheme: 'opencode',
  defaultPort: 4096,
  binary: 'opencode',
  launcher: join(scripts, 'start-opencode.command'),
  environmentFile: join(scripts, '.opencode-env'),
  directCommand: 'opencode serve --port 4096',
  environment: ({ binaryPath, port }) => ({
    OPENCODE_BIN: binaryPath,
    OPENCODE_PORT: port
  })
});
