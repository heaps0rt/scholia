#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMacUrlHandlerInstaller } from './lib/macos-url-handler.mjs';

const scripts = dirname(fileURLToPath(import.meta.url));

runMacUrlHandlerInstaller({
  scriptName: 'install-claude-handler.mjs',
  displayName: 'Scholia Claude Bridge',
  appName: 'ScholiaClaudeBridge.app',
  bundleId: 'app.scholia.claudecodebridge',
  scheme: 'claudecode',
  defaultPort: 8787,
  binary: 'claude',
  launcher: join(scripts, 'start-claude-bridge.command'),
  environmentFile: join(scripts, '.claude-bridge-env'),
  directCommand: 'node scripts/claude-code-bridge.mjs --port 8787',
  environment: ({ nodePath, binaryPath, port }) => ({
    BRIDGE_NODE: nodePath,
    BRIDGE_CLAUDE: binaryPath,
    BRIDGE_PORT: port
  })
});
