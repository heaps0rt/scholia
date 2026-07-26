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
    while (index < lines.length && lines[index].trim() && !isSpecialLine(lines[index].trim())) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    html.push(`<p>${protectInline(paragraph.join(' '))}</p>`);
  }

  return html.join('');
}
