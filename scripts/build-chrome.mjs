import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chromeRoot = join(projectRoot, 'apps', 'chrome');
const sourceRoot = join(chromeRoot, 'src');
const outputRoot = join(projectRoot, 'dist', 'chrome');

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const shared = {
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ['chrome114'],
  legalComments: 'none',
  logLevel: 'info'
};

await build({
  ...shared,
  entryPoints: [join(sourceRoot, 'content.js')],
  outfile: join(outputRoot, 'content.js'),
  format: 'iife',
  loader: { '.css': 'text' }
});

await build({
  ...shared,
  entryPoints: [join(sourceRoot, 'service-worker.js')],
  outfile: join(outputRoot, 'service-worker.js'),
  format: 'esm'
});

await Promise.all([
  build({
    ...shared,
    entryPoints: [join(sourceRoot, 'options.js')],
    outfile: join(outputRoot, 'options.js'),
    format: 'esm'
  }),
  build({
    ...shared,
    entryPoints: [join(sourceRoot, 'panel.js')],
    outfile: join(outputRoot, 'panel.js'),
    format: 'esm'
  })
]);

for (const file of ['manifest.json', 'options.html', 'options.css', 'panel.html', 'panel.css']) {
  await cp(join(chromeRoot, file), join(outputRoot, file));
}
await cp(join(chromeRoot, 'assets'), join(outputRoot, 'assets'), { recursive: true });
await cp(join(projectRoot, 'LICENSE'), join(outputRoot, 'LICENSE'));

const katexRoot = join(projectRoot, 'node_modules', 'katex', 'dist');
const katexOutput = join(outputRoot, 'vendor', 'katex');
await mkdir(katexOutput, { recursive: true });
await cp(join(katexRoot, 'katex.min.css'), join(katexOutput, 'katex.min.css'));
await cp(join(katexRoot, 'fonts'), join(katexOutput, 'fonts'), { recursive: true });
await cp(join(projectRoot, 'node_modules', 'katex', 'LICENSE'), join(katexOutput, 'LICENSE'));

const manifestPath = join(outputRoot, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.version = process.env.SCHOLIA_EXTENSION_VERSION || manifest.version;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Chrome extension built at ${outputRoot}`);
