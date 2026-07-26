import { access, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(projectRoot, 'dist', 'chrome');
const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));

if (manifest.manifest_version !== 3) throw new Error('Chrome build is not Manifest V3.');

const required = [
  manifest.background?.service_worker,
  manifest.options_page,
  manifest.side_panel?.default_path,
  ...manifest.content_scripts.flatMap((entry) => entry.js || []),
  ...Object.values(manifest.icons || {}),
  'options.js', 'options.css', 'panel.js', 'panel.css',
  'vendor/katex/katex.min.css', 'vendor/katex/LICENSE'
].filter(Boolean);

for (const relative of required) await access(join(dist, relative));

for (const htmlFile of [manifest.options_page, manifest.side_panel.default_path]) {
  const html = await readFile(join(dist, htmlFile), 'utf8');
  const remoteScript = /<script[^>]+src=["']https?:\/\//i.exec(html);
  if (remoteScript) throw new Error(`${htmlFile} loads remotely hosted code.`);
  if (/\son\w+\s*=/.test(html)) throw new Error(`${htmlFile} contains an inline event handler.`);
}

for (const jsFile of ['content.js', 'service-worker.js', 'options.js', 'panel.js']) {
  const source = await readFile(join(dist, jsFile), 'utf8');
  if (/\b(?:eval|Function)\s*\(/.test(source)) throw new Error(`${jsFile} contains dynamic code execution.`);
  if (/\bimport\s*\(\s*["']https?:\/\//.test(source)) throw new Error(`${jsFile} imports remote code.`);
}

const fonts = await readdir(join(dist, 'vendor', 'katex', 'fonts'));
if (!fonts.some((name) => name.endsWith('.woff2'))) throw new Error('KaTeX fonts were not packaged.');

async function sizeOf(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    total += entry.isDirectory() ? await sizeOf(path) : (await stat(path)).size;
  }
  return total;
}

const bytes = await sizeOf(dist);
console.log(`Chrome package smoke check passed (${(bytes / 1024 / 1024).toFixed(2)} MiB).`);
