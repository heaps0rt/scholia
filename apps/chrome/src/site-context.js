const DEFAULT_MAX_PAGES = 48;
const DEFAULT_MAX_SITE_CHARS = 1_200_000;
const DEFAULT_MAX_PAGE_CHARS = 120_000;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_CRAWL_TIME_MS = 30_000;
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const NON_HTML_EXTENSION = /\.(?:7z|avi|avif|bmp|css|csv|docx?|eot|epub|gif|gz|ico|jpe?g|js|json|map|mkv|mov|mp3|mp4|odp|ods|odt|ogg|ogv|pdf|png|pptx?|rar|rss|svg|tar|tiff?|tsv|txt|wav|webm|webp|woff2?|xlsx?|xml|zip)$/i;
const DANGEROUS_PATH = /(?:^|\/)(?:delete|destroy|log-?out|remove|sign-?out|unsubscribe)(?:\/|$)/i;

function normalizeInline(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function canonicalSiteUrl(value, siteUrl) {
  try {
    const site = new URL(siteUrl);
    const url = new URL(String(value || ''), site);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== site.origin) return '';
    url.username = '';
    url.password = '';
    url.hash = '';
    url.search = '';
    if (DANGEROUS_PATH.test(url.pathname) || NON_HTML_EXTENSION.test(url.pathname)) return '';
    if (/\/index\.html?$/i.test(url.pathname)) url.pathname = url.pathname.replace(/index\.html?$/i, '');
    return url.href;
  } catch {
    return '';
  }
}

export function siteLinksFromDocument(documentValue, siteUrl) {
  const links = [];
  const seen = new Set();
  for (const anchor of documentValue?.querySelectorAll?.('a[href]') || []) {
    if (String(anchor.rel || '').toLowerCase().split(/\s+/).includes('nofollow')) continue;
    const url = canonicalSiteUrl(anchor.getAttribute('href'), siteUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push(url);
  }
  return links;
}

function structuredDocumentText(root) {
  const lines = [];
  for (const element of root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,pre,blockquote,li,dt,dd,th,td,figcaption')) {
    const text = normalizeInline(element.textContent);
    if (!text || text === lines.at(-1)) continue;
    const heading = /^H[1-6]$/.test(element.tagName) ? `${'#'.repeat(Number(element.tagName[1]))} ` : '';
    lines.push(`${heading}${text}`);
  }
  return lines.join('\n');
}

export function parseSiteHtml(html, url) {
  const parser = new DOMParser();
  const documentValue = parser.parseFromString(String(html || ''), 'text/html');
  const links = siteLinksFromDocument(documentValue, url);
  for (const element of documentValue.querySelectorAll(
    'script,style,noscript,template,svg,canvas,nav,footer,form,dialog,[hidden],[aria-hidden="true"]'
  )) element.remove();
  const root = documentValue.querySelector('main,article,[role="main"]') || documentValue.body;
  const title = normalizeInline(documentValue.querySelector('h1')?.textContent || documentValue.title || url);
  const structured = root ? structuredDocumentText(root) : '';
  const fallback = normalizeInline(root?.textContent || '');
  return { url, title, text: structured || fallback, links };
}

async function limitedResponseText(response) {
  const declared = Number(response.headers.get('content-length')) || 0;
  if (declared > MAX_HTML_BYTES) return '';
  if (!response.body?.getReader) {
    const text = await response.text();
    return text.length <= MAX_HTML_BYTES ? text : '';
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_HTML_BYTES) {
      await reader.cancel();
      return '';
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

export async function fetchSitePage(url, { signal, timeoutMs = 8_000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'default',
      credentials: 'same-origin',
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) return null;
    const finalUrl = canonicalSiteUrl(response.url || url, url);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!finalUrl || (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml'))) return null;
    const html = await limitedResponseText(response);
    return html ? parseSiteHtml(html, finalUrl) : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function crawlSite({
  startUrl,
  initialPage,
  fetchPage = fetchSitePage,
  signal,
  maxPages = DEFAULT_MAX_PAGES,
  maxCharacters = DEFAULT_MAX_SITE_CHARS,
  maxPageCharacters = DEFAULT_MAX_PAGE_CHARS,
  maxDepth = DEFAULT_MAX_DEPTH,
  concurrency = DEFAULT_CONCURRENCY,
  maxDurationMs = DEFAULT_CRAWL_TIME_MS
} = {}) {
  const start = canonicalSiteUrl(startUrl, startUrl);
  if (!start) throw new Error('Site-wide context is available only on HTTP and HTTPS pages.');
  const site = new URL(start);
  const root = `${site.origin}/`;
  const queue = [];
  const queued = new Set();
  const enqueue = (value, depth) => {
    const url = canonicalSiteUrl(value, start);
    if (!url || queued.has(url) || depth > maxDepth) return;
    queued.add(url);
    queue.push({ url, depth });
  };
  enqueue(start, 0);
  enqueue(root, 0);
  for (const link of initialPage?.links || []) enqueue(link, 1);

  const pages = [];
  let totalCharacters = 0;
  let failedPages = 0;
  let truncated = false;
  const startedAt = Date.now();
  const initialUrl = canonicalSiteUrl(initialPage?.url, start);

  while (queue.length && pages.length < maxPages && totalCharacters < maxCharacters) {
    if (signal?.aborted) throw new DOMException('Site crawl cancelled.', 'AbortError');
    if (Date.now() - startedAt >= maxDurationMs) { truncated = true; break; }
    const room = maxPages - pages.length;
    const batch = queue.splice(0, Math.min(Math.max(1, concurrency), room));
    const results = await Promise.all(batch.map(async ({ url, depth }) => {
      if (initialUrl === url && initialPage?.text) return { page: { ...initialPage, url }, depth };
      return { page: await fetchPage(url, { signal }), depth };
    }));

    for (const { page, depth } of results) {
      if (!page?.text) { failedPages += 1; continue; }
      const canonical = canonicalSiteUrl(page.url, start);
      if (!canonical) { failedPages += 1; continue; }
      const remaining = maxCharacters - totalCharacters;
      const text = String(page.text).slice(0, Math.min(maxPageCharacters, remaining)).trim();
      if (!text) continue;
      pages.push({ url: canonical, title: normalizeInline(page.title || canonical), text });
      totalCharacters += text.length;
      if (String(page.text).length > text.length) truncated = true;
      if (depth < maxDepth) for (const link of page.links || []) enqueue(link, depth + 1);
      if (pages.length >= maxPages || totalCharacters >= maxCharacters) break;
    }
  }

  if (queue.length) truncated = true;
  return {
    pages,
    totalCharacters,
    discoveredPages: queued.size,
    failedPages,
    truncated
  };
}
