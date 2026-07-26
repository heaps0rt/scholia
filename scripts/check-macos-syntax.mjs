import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const macRoot = join(projectRoot, 'apps', 'macos');
const probe = spawnSync('swiftc', ['--version'], { encoding: 'utf8' });

if (probe.error?.code === 'ENOENT') {
  console.log('Swift compiler not installed; skipped macOS syntax parse.');
  process.exit(0);
}
if (probe.status !== 0) throw new Error(probe.stderr || 'Swift compiler probe failed.');

function swiftFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== '.build' && entry.name !== '.swiftpm') return swiftFiles(path);
    return entry.isFile() && entry.name.endsWith('.swift') ? [path] : [];
  });
}

const files = swiftFiles(macRoot);
for (const file of files) execFileSync('swiftc', ['-frontend', '-parse', file], { stdio: 'inherit' });
console.log(`Parsed ${files.length} macOS Swift files.`);
