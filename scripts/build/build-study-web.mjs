import { build } from 'esbuild';
import { mkdir, copyFile, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'dist/web');
await mkdir(output, { recursive: true });
await build({
  entryPoints: [resolve(root, 'apps/web/app.js')],
  outdir: output,
  bundle: true,
  format: 'esm',
  target: ['safari17', 'chrome120'],
  minify: true,
  legalComments: 'eof',
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.svg': 'file', '.gif': 'file' },
});
await build({
  entryPoints: [resolve(root, 'apps/chrome/src/pdf/pdf-search.js')],
  outfile: resolve(output, 'pdf-search.js'),
  bundle: true,
  format: 'iife',
  globalName: 'ScholiaDocumentSearch',
  target: 'safari17',
  minify: true,
});
await build({
  entryPoints: [resolve(root, 'packages/core/src/code-highlight.js')],
  outfile: resolve(output, 'code-highlight.js'),
  bundle: true,
  format: 'iife',
  globalName: 'ScholiaCodeHighlight',
  target: 'safari17',
  minify: true,
  legalComments: 'eof',
});
await Promise.all([
  copyFile(resolve(root, 'apps/web/index.html'), resolve(output, 'index.html')),
  copyFile(resolve(root, 'apps/chrome/assets/icon.svg'), resolve(output, 'icon.svg')),
  copyFile(
    resolve(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),
    resolve(output, 'pdf.worker.mjs')
  ),
  cp(resolve(root, 'node_modules/pdfjs-dist/cmaps'), resolve(output, 'cmaps'), { recursive: true }),
  cp(resolve(root, 'node_modules/pdfjs-dist/standard_fonts'), resolve(output, 'standard_fonts'), {
    recursive: true,
  }),
]);
console.log(
  'Built Scholia website in dist/web for the hosted server and Mac app’s Open in Browser (⌘2).'
);
