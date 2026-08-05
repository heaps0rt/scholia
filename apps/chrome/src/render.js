import katex from 'katex';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMath(tex, displayMode) {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      output: 'htmlAndMathml'
    });
  } catch {
    const fence = displayMode ? '$$' : '$';
    return `<code class="scholia-math-source">${escapeHtml(fence + tex + fence)}</code>`;
  }
}

function protectInline(source) {
  const tokens = [];
  const token = (html) => {
    const id = `\uE000${tokens.length}\uE001`;
    tokens.push(html);
    return id;
  };

  let text = source.replace(/`([^`\n]+)`/g, (_match, code) => token(`<code>${escapeHtml(code)}</code>`));
  text = text.replace(/\$([^$\n]+)\$/g, (_match, tex) => token(renderMath(tex, false)));
  text = text.replace(/\\([\\`*_[\]{}()#+\-.!|>])/g, (_match, character) => token(escapeHtml(character)));
  text = escapeHtml(text);
  text = text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return text.replace(/\uE000(\d+)\uE001/g, (_match, index) => tokens[Number(index)] || '');
}

function blockTokens(markdown) {
  const blocks = [];
  const token = (html) => {
    const id = `@@SCHOLIA_BLOCK_${blocks.length}@@`;
    blocks.push(html);
    return `\n${id}\n`;
  };

  let source = markdown.replace(/```([^\n`]*)\n([\s\S]*?)(?:```|$)/g, (_match, language, code) => {
    const label = escapeHtml(language.trim() || 'text');
    const safe = escapeHtml(code.replace(/\n$/, ''));
    return token(`<div class="scholia-code"><div class="scholia-code__bar"><span>${label}</span><button type="button" data-copy-code>Copy</button></div><pre><code>${safe}</code></pre></div>`);
  });

  source = source.replace(/\$\$([\s\S]*?)\$\$/g, (_match, tex) => token(`<div class="scholia-display-math">${renderMath(tex.trim(), true)}</div>`));
  return { source, blocks };
}

function hasTablePipe(line) {
  let codeFenceLength = 0;
  let mathFenceLength = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '\\') {
      index += 1;
      continue;
    }
    if (line[index] === '`') {
      let runLength = 1;
      while (line[index + runLength] === '`') runLength += 1;
      if (!codeFenceLength) codeFenceLength = runLength;
      else if (codeFenceLength === runLength) codeFenceLength = 0;
      index += runLength - 1;
      continue;
    }
    if (line[index] === '$' && !codeFenceLength) {
      let runLength = 1;
      while (line[index + runLength] === '$') runLength += 1;
      if (!mathFenceLength) mathFenceLength = runLength;
      else if (mathFenceLength === runLength) mathFenceLength = 0;
      index += runLength - 1;
      continue;
    }
    if (line[index] === '|' && !codeFenceLength && !mathFenceLength) return true;
  }
  return false;
}

function splitTableRow(line) {
  let source = String(line || '').trim();
  if (!hasTablePipe(source)) return null;
  if (source.startsWith('|')) source = source.slice(1);

  let trailingPipe = false;
  for (let index = source.length - 1, slashes = 0; index >= 0; index -= 1) {
    if (/\s/.test(source[index])) continue;
    if (source[index] !== '|') break;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) slashes += 1;
    trailingPipe = slashes % 2 === 0;
    if (trailingPipe) source = source.slice(0, index);
    break;
  }

  const cells = [];
  let cell = '';
  let codeFenceLength = 0;
  let mathFenceLength = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\' && index + 1 < source.length) {
      cell += character + source[index + 1];
      index += 1;
      continue;
    }
    if (character === '`') {
      let runLength = 1;
      while (source[index + runLength] === '`') runLength += 1;
      if (!codeFenceLength) codeFenceLength = runLength;
      else if (codeFenceLength === runLength) codeFenceLength = 0;
      cell += '`'.repeat(runLength);
      index += runLength - 1;
      continue;
    }
    if (character === '$' && !codeFenceLength) {
      let runLength = 1;
      while (source[index + runLength] === '$') runLength += 1;
      if (!mathFenceLength) mathFenceLength = runLength;
      else if (mathFenceLength === runLength) mathFenceLength = 0;
      cell += '$'.repeat(runLength);
      index += runLength - 1;
      continue;
    }
    if (character === '|' && !codeFenceLength && !mathFenceLength) {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function tableAlignment(cell) {
  const delimiter = cell.replace(/\s/g, '');
  if (!/^:?-{3,}:?$/.test(delimiter)) return null;
  if (delimiter.startsWith(':') && delimiter.endsWith(':')) return 'center';
  if (delimiter.endsWith(':')) return 'right';
  return 'left';
}

function tableAt(lines, index) {
  if (index + 1 >= lines.length) return null;
  const header = splitTableRow(lines[index]);
  const delimiter = splitTableRow(lines[index + 1]);
  if (!header?.length || !delimiter || delimiter.length !== header.length) return null;
  const alignments = delimiter.map(tableAlignment);
  if (alignments.some((alignment) => alignment === null)) return null;

  const rows = [];
  let cursor = index + 2;
  while (cursor < lines.length && lines[cursor].trim()) {
    const cells = splitTableRow(lines[cursor]);
    if (!cells) break;
    rows.push(Array.from({ length: header.length }, (_unused, cellIndex) => cells[cellIndex] || ''));
    cursor += 1;
  }

  const cellClass = (alignment) => alignment === 'left' ? '' : ` class="scholia-table-cell--${alignment}"`;
  const heading = header.map((cell, cellIndex) => `<th scope="col"${cellClass(alignments[cellIndex])}>${protectInline(cell)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((cell, cellIndex) => `<td${cellClass(alignments[cellIndex])}>${protectInline(cell)}</td>`).join('')}</tr>`).join('');
  return {
    html: `<div class="scholia-table-wrap" role="region" aria-label="Scrollable table" tabindex="0"><table><thead><tr>${heading}</tr></thead>${body ? `<tbody>${body}</tbody>` : ''}</table></div>`,
    nextIndex: cursor
  };
}

function isSpecialLine(line) {
  return /^@@SCHOLIA_BLOCK_\d+@@$/.test(line)
    || /^#{1,6}\s+/.test(line)
    || /^>\s?/.test(line)
    || /^[-*+]\s+/.test(line)
    || /^\d+[.)]\s+/.test(line)
    || /^---+$/.test(line.trim());
}

export function renderMarkdown(value) {
  const normalized = String(value || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return '';
  const { source, blocks } = blockTokens(normalized);
  const lines = source.split('\n');
  const html = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) { index += 1; continue; }

    const placeholder = /^@@SCHOLIA_BLOCK_(\d+)@@$/.exec(trimmed);
    if (placeholder) {
      html.push(blocks[Number(placeholder[1])] || '');
      index += 1;
      continue;
    }

    const table = tableAt(lines, index);
    if (table) {
      html.push(table.html);
      index = table.nextIndex;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6);
      html.push(`<h${level}>${protectInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      html.push('<hr>');
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quote.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      html.push(`<blockquote>${protectInline(quote.join(' '))}</blockquote>`);
      continue;
    }

    const unordered = /^[-*+]\s+/.test(trimmed);
    const ordered = /^\d+[.)]\s+/.test(trimmed);
    if (unordered || ordered) {
      const tag = ordered ? 'ol' : 'ul';
      const items = [];
      const matcher = ordered ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/;
      while (index < lines.length) {
        const item = matcher.exec(lines[index].trim());
        if (!item) break;
        items.push(`<li>${protectInline(item[1])}</li>`);
        index += 1;
      }
      html.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    const paragraph = [trimmed];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isSpecialLine(lines[index].trim()) && !tableAt(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    html.push(`<p>${protectInline(paragraph.join(' '))}</p>`);
  }

  return html.join('');
}
