import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../apps/chrome/src/render.js';

test('renderer escapes raw model HTML', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> **safe**');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(html, /<strong>safe<\/strong>/);
});

test('renderer produces local KaTeX markup and code blocks', () => {
  const html = renderMarkdown('Energy is $E = mc^2$.\n\n```js\nconst x = 1;\n```');
  assert.match(html, /class="katex"/);
  assert.match(html, /data-copy-code/);
  assert.match(html, /const x = 1/);
});

test('renderer produces semantic, aligned tables inside a scroll container', () => {
  const html = renderMarkdown(`
| Concept | Meaning | Score |
| :--- | :---: | ---: |
| **Recall** | Retrieve without notes | 8 |
| Transfer | Use \`x | y\` safely | 13 |
| Cardinality | $|R|$ rows | 21 |
  `);

  assert.match(html, /class="scholia-table-wrap"/);
  assert.match(html, /<table><thead><tr>/);
  assert.match(html, /<th scope="col">Concept<\/th>/);
  assert.match(html, /<th scope="col" class="scholia-table-cell--center">Meaning<\/th>/);
  assert.match(html, /<td class="scholia-table-cell--right">13<\/td>/);
  assert.match(html, /<strong>Recall<\/strong>/);
  assert.match(html, /<code>x \| y<\/code>/);
  assert.match(html, /<td[^>]*><span class="katex"/);
  assert.match(html, /21<\/td>/);
});

test('renderer keeps escaped pipes in table cells and escapes raw table HTML', () => {
  const html = renderMarkdown('| Input | Output |\n| --- | --- |\n| a \\| b | <img src=x> |');

  assert.match(html, /<td>a \| b<\/td>/);
  assert.match(html, /<td>&lt;img src=x&gt;<\/td>/);
  assert.doesNotMatch(html, /<img/);
});

test('renderer does not treat ordinary pipe-separated prose as a table', () => {
  const html = renderMarkdown('alpha | beta\nthis is still prose');
  assert.equal(html, '<p>alpha | beta this is still prose</p>');
});

test('renderer keeps a math-heavy join table separate from following prose and SQL', () => {
  const html = renderMarkdown(`Her er join-typene med vanlige symboler.

| Join-type | Symbol | Eksempel | Betydning |
|---|---:|---|---|
| Natural join | $\\bowtie$ | $R \\bowtie S$ | Matcher attributter med samme navn |
| Theta join | $\\bowtie_\\theta$ | $R \\bowtie_{R.a>S.b} S$ | Join med en vilkårlig betingelse |

For eksempel:

\`\`\`sql
SELECT * FROM Employee JOIN Department;
\`\`\``);

  assert.match(html, /^<p>Her er join-typene/);
  assert.equal((html.match(/<table>/g) || []).length, 1);
  assert.match(html, /class="katex"/);
  assert.match(html, /<\/table><\/div><p>For eksempel:<\/p><div class="scholia-code">/);
  assert.match(html, /<span>sql<\/span>/);
});
