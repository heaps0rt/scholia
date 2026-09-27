#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMacUrlHandlerInstaller } from './lib/macos-url-handler.mjs';

const scripts = dirname(fileURLToPath(import.meta.url));

runMacUrlHandlerInstaller({
  scriptName: 'install-codex-handler.mjs',
  displayName: 'Scholia Codex Bridge',
  appName: 'Scholia Codex Bridge.app',
  bundleId: 'app.scholia.codexbridge',
  scheme: 'scholia-codex',
  defaultPort: 8789,
  binary: 'codex',
  launcher: join(scripts, 'start-codex-bridge.command'),
  environmentFile: join(scripts, '.codex-bridge-env'),
  directCommand: 'node scripts/codex-bridge.mjs --port 8789',
  environment: ({ nodePath, binaryPath, port }) => ({
    NODE: nodePath,
    CODEX: binaryPath,
    PORT: port
  })
});
