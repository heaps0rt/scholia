import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import {
  EventBus,
  PDFViewer,
  PDFLinkService,
  PDFFindController,
  ScrollMode,
  SpreadMode,
  DownloadManager,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import { escapeHtml as esc } from '../chrome/src/render.js';
import {
  findPdfMatches,
  findPdfSemanticMatches,
  buildPdfSemanticIndex,
} from '../chrome/src/pdf-search.js';
import { pdfPageNavigationTarget, normalizePdfPageInput } from '../chrome/src/pdf-view-mode.js';
import { pdfKeyboardAction, isPdfKeyboardControl } from '../chrome/src/pdf-keyboard.js';
import { capturePDFRegion } from './pdf-region.js';
import { preparePdfPrint } from '../chrome/src/pdf-print.js';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
const tool = (name, label, title = label) =>
  `<button type="button" data-pdf="${name}" title="${esc(title)}" aria-label="${esc(title)}">${label}</button>`;

export class StudyPDFReader {
  constructor({
    host,
    toolbar,
    document: item,
    token,
    request,
    onPage,
    onImage,
    onGuide,
    onChat,
    onSelection,
    notify,
    page = 1,
  }) {
    Object.assign(this, {
      host,
      toolbar,
      item,
      token,
      request,
      onPage,
      onImage,
      onGuide,
      onChat,
      onSelection,
      notify,
    });
    this.id = item.id;
    this.page = page;
    this.layout = 'continuous';
    this.matches = [];
    this.matchIndex = -1;
    this.abort = new AbortController();
    this.urls = [];
    this.ready = false;
    toolbar.innerHTML = `${tool('outline', '☷', 'Table of contents')}${tool('search', '⌕', 'Search PDF (⌘F)')}<select data-pdf-select="layout" aria-label="Page layout"><option value="continuous">Continuous</option><option value="page">Single page</option><option value="spread">Two-page spread</option></select><div class="tools">${tool('zoomOut', '−', 'Zoom out')}<select data-pdf-select="zoom" aria-label="PDF zoom"><option value="auto">Automatic</option><option value="page-fit">Fit page</option><option value="page-width" selected>Fit width</option>${[50, 75, 100, 125, 150, 200].map((n) => `<option value="${n / 100}">${n}%</option>`).join('')}</select>${tool('zoomIn', '+', 'Zoom in')}${tool('crop', '⌗', 'Select a figure')}${tool('download', '↓ Download', 'Download PDF')}${tool('chat', 'Chat', 'Show or hide tutor')}<details class="reader-more"><summary aria-label="More PDF controls" title="More PDF controls">•••</summary><div>${tool('guide', 'Guide me')}${tool('theme', 'Light / dark reader')}${tool('print', 'Print PDF (⌘P)')}${tool('original', 'Open original PDF')}<button data-action="upload">Choose file</button></div></details></div>`;
    host.classList.add('pdf-active');
    host.innerHTML = `<section class="pdf-search-bar" hidden><select aria-label="Search mode"><option value="exact">Exact</option><option value="semantic">Semantic</option></select><input type="search" placeholder="Find words or phrases…" aria-label="Search this PDF"><small role="status"></small>${tool('findPrevious', '↑', 'Previous result')}${tool('findNext', '↓', 'Next result')}${tool('closeSearch', '×', 'Close search')}</section><div class="pdf-reading-area"><aside class="pdf-outline-panel" hidden><strong>Contents</strong><nav></nav></aside><div class="study-pdf-stage"><div class="study-pdf-viewport" tabindex="0" aria-label="PDF pages"><div class="pdfViewer"></div></div></div></div>`;
    this.viewport = host.querySelector('.study-pdf-viewport');
    this.searchBar = host.querySelector('.pdf-search-bar');
    this.outline = host.querySelector('.pdf-outline-panel');
    this.bus = new EventBus();
    this.links = new PDFLinkService({
      eventBus: this.bus,
      externalLinkTarget: 2,
      externalLinkRel: 'noopener noreferrer',
    });
    this.find = new PDFFindController({ eventBus: this.bus, linkService: this.links });
    this.viewer = new PDFViewer({
      container: this.viewport,
      viewer: this.viewport.firstElementChild,
      eventBus: this.bus,
      linkService: this.links,
      findController: this.find,
      downloadManager: new DownloadManager(),
      annotationMode: pdfjs.AnnotationMode.ENABLE,
      maxCanvasPixels: 12_000_000,
      abortSignal: this.abort.signal,
    });
    this.links.setViewer(this.viewer);
    toolbar.querySelector('[data-pdf=download]').disabled = true;
    this.bus.on('pagesinit', () => {
      if (this.abort.signal.aborted) return;
      this.viewer.currentScaleValue = 'page-width';
      this.viewer.currentPageNumber = this.page;
      this.ready = true;
      toolbar.querySelector('[data-pdf=download]').disabled = false;
    });
    this.bus.on('pagechanging', ({ pageNumber }) => {
      if (!this.ready || this.page === pageNumber) return;
      this.page = pageNumber;
      this.clearCrop();
      clearTimeout(this.pageTimer);
      this.pageTimer = setTimeout(() => this.onPage(pageNumber), 180);
    });
    this.bus.on('scalechanging', ({ scale, presetValue }) => {
      const select = toolbar.querySelector('[data-pdf-select=zoom]');
      const value = presetValue || String(Math.round(scale * 100) / 100);
      select.querySelector('[data-custom]')?.remove();
      if (![...select.options].some((o) => o.value === value)) {
        const option = new Option(`${Math.round(scale * 100)}%`, value);
        option.dataset.custom = 'true';
        select.add(option);
      }
      select.value = value;
    });
    const events = { signal: this.abort.signal };
    const click = (event) => {
      const name = event.target.closest('[data-pdf]')?.dataset.pdf;
      if (!name) return;
      event.preventDefault();
      this.control(name).catch((error) => {
        if (error.name !== 'AbortError') this.notify(error.message);
      });
    };
    toolbar.addEventListener('click', click, events);
    host.addEventListener('click', click, events);
    this.viewport.addEventListener('mouseup', () => this.selectionPopup(), events);
    this.viewport.addEventListener('keyup', () => this.selectionPopup(), events);
    this.viewport.addEventListener('scroll', () => this.selectionBubble?.remove(), {
      ...events,
      passive: true,
    });
    window.document.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.selectionBubble?.contains(event.target)) this.selectionBubble?.remove();
      },
      events
    );
    toolbar.addEventListener(
      'change',
      (event) => {
        if (!this.ready) return;
        if (event.target.dataset.pdfSelect === 'zoom') this.setZoom(event.target.value);
        if (event.target.dataset.pdfSelect === 'layout') this.setLayout(event.target.value);
      },
      events
    );
    this.searchBar.addEventListener(
      'input',
      () => {
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(
          () => this.search().catch((e) => this.notify(e.message)),
          180
        );
      },
      events
    );
    this.searchBar
      .querySelector('select')
      .addEventListener('change', () => this.search().catch((e) => this.notify(e.message)), events);
    this.searchBar.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.moveMatch(event.shiftKey ? -1 : 1);
        }
        if (event.key === 'Escape') this.searchBar.hidden = true;
      },
      events
    );
    window.document.addEventListener('keydown', (event) => this.key(event), events);
    window.addEventListener(
      'afterprint',
      () => {
        this.printJob?.destroy();
        this.printJob = null;
      },
      events
    );
    this.resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => {
        const value = this.viewer.currentScaleValue;
        if (this.ready && ['auto', 'page-fit', 'page-width'].includes(value)) this.setZoom(value);
      });
    });
    this.resizeObserver.observe(this.viewport);
    this.loading = pdfjs.getDocument({
      url: `/api/document/${item.id}`,
      httpHeaders: { 'X-Scholia-Token': token },
      isEvalSupported: false,
      cMapUrl: '/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/standard_fonts/',
    });
    this.opened = this.open();
  }
  async open() {
    const pdf = await this.loading.promise;
    if (this.abort.signal.aborted) return;
    this.pdf = pdf;
    this.links.setDocument(pdf);
    this.viewer.setDocument(pdf);
    const outline = await pdf.getOutline();
    if (this.abort.signal.aborted) return;
    const append = (items, parent, depth = 0) => {
      for (const item of items) {
        const button = document.createElement('button');
        button.textContent = item.title || 'Untitled section';
        button.style.paddingLeft = `${12 + depth * 12}px`;
        button.addEventListener('click', () => {
          if (item.dest) this.links.goToDestination(item.dest);
        });
        parent.append(button);
        if (item.items?.length) append(item.items, parent, Math.min(8, depth + 1));
      }
    };
    const nav = this.outline.querySelector('nav');
    if (outline?.length) append(outline, nav);
    else {
      nav.innerHTML = '<p>No bookmarks in this PDF. Jump to a page below.</p>';
      for (let page = 1; page <= pdf.numPages; page++) {
        const b = document.createElement('button');
        b.textContent = `Page ${page}`;
        b.onclick = () => this.setPage(page, true);
        nav.append(b);
      }
    }
  }
  setPage(value, publish = false) {
    this.page = normalizePdfPageInput(value, this.item.pageCount, this.page);
    clearTimeout(this.pageTimer);
    if (this.ready && this.viewer.currentPageNumber !== this.page)
      this.viewer.currentPageNumber = this.page;
    if (publish) this.onPage(this.page);
  }
  navigate(direction) {
    this.setPage(
      pdfPageNavigationTarget(this.page, this.item.pageCount, direction, this.layout),
      true
    );
  }
  setLayout(layout) {
    const page = this.page;
    this.layout = layout;
    this.viewer.scrollMode = layout === 'page' ? ScrollMode.PAGE : ScrollMode.VERTICAL;
    this.viewer.spreadMode = layout === 'spread' ? SpreadMode.ODD : SpreadMode.NONE;
    this.setPage(page);
    this.clearCrop();
  }
  setZoom(value) {
    this.clearCrop();
    this.viewport.classList.toggle('fit-page', value === 'page-fit');
    const page = this.page;
    this.viewer.currentScaleValue = value;
    if (value === 'page-fit') this.viewer.scrollPageIntoView({ pageNumber: page });
    this.viewer.update();
  }
  zoom(direction) {
    this.setZoom(
      direction === 0
        ? 'page-width'
        : String(
            Math.max(0.25, Math.min(4, this.viewer.currentScale * (direction > 0 ? 1.2 : 1 / 1.2)))
          )
    );
  }
  async control(name) {
    if (name === 'chat') return this.onChat();
    if (name === 'guide') return this.onGuide();
    if (name === 'theme') {
      this.host.classList.toggle('pdf-dark');
      return;
    }
    if (name === 'outline') {
      this.outline.hidden = !this.outline.hidden;
      return;
    }
    if (name === 'search') {
      this.searchBar.hidden = !this.searchBar.hidden;
      if (!this.searchBar.hidden) this.searchBar.querySelector('input').focus();
      return;
    }
    if (name === 'closeSearch') {
      this.searchBar.hidden = true;
      return;
    }
    if (!this.ready) return;
    if (name === 'zoomIn' || name === 'zoomOut') return this.zoom(name === 'zoomIn' ? 1 : -1);
    if (name === 'findNext' || name === 'findPrevious')
      return this.moveMatch(name === 'findNext' ? 1 : -1);
    if (name === 'crop') return this.crop();
    if (name === 'download' || name === 'original') {
      const url = URL.createObjectURL(
        new Blob([await this.pdf.getData()], { type: 'application/pdf' })
      );
      this.urls.push(url);
      const a = document.createElement('a');
      a.href = url;
      if (name === 'download') a.download = this.item.fileName || `${this.item.title}.pdf`;
      else {
        a.target = '_blank';
        a.rel = 'noopener';
      }
      a.click();
      return;
    }
    if (name === 'print') {
      if (this.printPreparing) {
        this.printAbort?.abort();
        return;
      }
      this.printPreparing = true;
      this.printAbort = new AbortController();
      try {
        this.printJob?.destroy();
        this.printJob = await preparePdfPrint({
          pdfDocument: this.pdf,
          pdfjs,
          printContainer: document.querySelector('#study-print-pages'),
          signal: this.printAbort.signal,
          onProgress: (n, total) => {
            if (n % 10 === 0)
              this.notify(`Preparing print: ${n} / ${total}. Choose Print again to cancel.`);
          },
        });
        window.print();
      } finally {
        this.printPreparing = false;
      }
    }
  }
  async search() {
    const query = this.searchBar.querySelector('input').value.trim(),
      mode = this.searchBar.querySelector('select').value;
    const generation = (this.searchGeneration = (this.searchGeneration || 0) + 1);
    this.indexPromise ||= this.request(`/api/index/${this.id}`);
    const index = await this.indexPromise;
    if (generation !== this.searchGeneration || this.abort.signal.aborted) return;
    this.texts ||= index.pages.map((p) => p.text);
    if (mode === 'semantic') this.semanticIndex ||= buildPdfSemanticIndex(this.texts);
    this.matches = (
      mode === 'semantic'
        ? findPdfSemanticMatches(this.texts, query, this.semanticIndex)
        : findPdfMatches(this.texts, query)
    ).matches;
    this.matchIndex = -1;
    this.bus.dispatch('find', {
      source: this,
      type: '',
      query: mode === 'exact' ? query : '',
      phraseSearch: true,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: false,
      matchDiacritics: false,
    });
    this.moveMatch(1);
  }
  moveMatch(direction) {
    if (this.matches.length) {
      this.matchIndex =
        this.matchIndex < 0
          ? direction < 0
            ? this.matches.length - 1
            : 0
          : (this.matchIndex + direction + this.matches.length) % this.matches.length;
      this.setPage(this.matches[this.matchIndex].pageIndex + 1, true);
    }
    this.searchBar.querySelector('small').textContent = this.matches.length
      ? `${this.matchIndex + 1} / ${this.matches.length}`
      : 'No results';
  }
  crop() {
    if (this.cropOverlay) {
      this.clearCrop();
      return;
    }
    const page = this.viewer.getPageView(this.page - 1),
      canvas = page?.canvas;
    if (!canvas) {
      this.notify('Wait for this page to finish rendering.');
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'crop-overlay';
    page.div.append(overlay);
    this.cropOverlay = overlay;
    this.notify('Drag around a figure to attach it to your question. Esc cancels.');
    let start, box;
    const point = (event) => {
      const r = overlay.getBoundingClientRect();
      return [
        Math.max(0, Math.min(r.width, event.clientX - r.left)),
        Math.max(0, Math.min(r.height, event.clientY - r.top)),
      ];
    };
    overlay.onpointerdown = (event) => {
      start = point(event);
      box?.remove();
      box = document.createElement('div');
      box.className = 'crop-box';
      overlay.append(box);
      overlay.setPointerCapture(event.pointerId);
    };
    overlay.onpointermove = (event) => {
      if (!start) return;
      const [x, y] = point(event);
      Object.assign(box.style, {
        left: `${Math.min(x, start[0])}px`,
        top: `${Math.min(y, start[1])}px`,
        width: `${Math.abs(x - start[0])}px`,
        height: `${Math.abs(y - start[1])}px`,
      });
    };
    overlay.onpointerup = () => {
      if (box) {
        const selection = box.getBoundingClientRect();
        if (selection.width > 8 && selection.height > 8) {
          const data = capturePDFRegion(canvas, selection);
          if (data) {
            this.onPage(this.page);
            this.onImage(data);
          }
        }
      }
      this.clearCrop();
    };
  }
  clearCrop() {
    this.cropOverlay?.remove();
    this.cropOverlay = null;
  }
  selectionPopup() {
    if (this.cropOverlay) return;
    if (this.selectionBubble?.contains(document.activeElement)) return;
    this.selectionBubble?.remove();
    const selection = window.getSelection(),
      text = selection?.toString().trim();
    if (
      !text ||
      !selection.rangeCount ||
      !this.viewport.contains(selection.anchorNode) ||
      !this.viewport.contains(selection.focusNode)
    )
      return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width) return;
    const element =
      selection.anchorNode.nodeType === 1
        ? selection.anchorNode
        : selection.anchorNode.parentElement;
    const page = Number(element.closest('.page')?.dataset.pageNumber) || this.page;
    const bubble = document.createElement('div');
    bubble.className = 'pdf-selection-popup';
    bubble.setAttribute('role', 'dialog');
    bubble.setAttribute('aria-label', 'Ask about selected passage');
    bubble.innerHTML =
      '<blockquote></blockquote><button type="button" data-close aria-label="Close selection popup">×</button><form><input aria-label="Ask about selected passage" placeholder="Add a question (optional)" maxlength="16000"><button type="submit">Explain</button></form><div class="popup-actions"><small>Passage + context</small><button type="button" data-chat>Open in chat ↗</button></div>';
    bubble.querySelector('blockquote').textContent = text.slice(0, 240);
    bubble.style.left = `${Math.max(8, Math.min(window.innerWidth - 328, rect.left + rect.width / 2 - 160))}px`;
    bubble.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) event.preventDefault();
    });
    bubble.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = bubble.querySelector('input'),
        submit = bubble.querySelector('[type=submit]');
      if (submit.disabled) return;
      submit.disabled = true;
      try {
        const sent = await this.onSelection(text.slice(0, 16000), page, true, input.value);
        if (sent) {
          input.value = '';
          input.placeholder = 'Ask a follow-up…';
          submit.textContent = 'Send';
        }
      } catch (error) {
        this.notify(error.message);
      } finally {
        submit.disabled = false;
      }
    });
    bubble.querySelector('[data-chat]').addEventListener('click', async () => {
      try {
        if (await this.onSelection(text.slice(0, 16000), page, false, bubble.querySelector('input').value)) bubble.remove();
      } catch (error) { this.notify(error.message); }
    });
    bubble.querySelector('[data-close]').addEventListener('click', () => bubble.remove());
    bubble.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') bubble.remove();
    });
    document.body.append(bubble);
    const height = bubble.getBoundingClientRect().height;
    bubble.style.top = `${rect.bottom + height + 8 < window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - height - 6)}px`;
    this.selectionBubble = bubble;
  }
  key(event) {
    if (
      this.host.closest('[hidden]') ||
      document.querySelector('dialog[open]') ||
      isPdfKeyboardControl(event.target, event.key)
    )
      return;
    if ((event.metaKey || event.ctrlKey) && ['f', 'p'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      this.control(event.key.toLowerCase() === 'f' ? 'search' : 'print').catch((e) =>
        this.notify(e.message)
      );
      return;
    }
    if (event.key === 'Escape') {
      this.clearCrop();
      this.searchBar.hidden = true;
      return;
    }
    const command = pdfKeyboardAction(event, { viewportHeight: this.viewport.clientHeight });
    if (!command || !this.ready) return;
    event.preventDefault();
    if (command.type === 'zoom') this.zoom(command.direction);
    if (command.type === 'page') this.navigate(command.direction);
    if (command.type === 'edge')
      this.setPage(command.edge === 'start' ? 1 : this.item.pageCount, true);
    if (command.type === 'scroll') {
      if (this.layout === 'page' && Math.abs(command.top) > 56)
        this.navigate(Math.sign(command.top));
      else this.viewport.scrollBy({ top: command.top, left: command.left });
    }
  }
  destroy() {
    this.abort.abort();
    this.selectionBubble?.remove();
    this.printAbort?.abort();
    this.printJob?.destroy();
    clearTimeout(this.pageTimer);
    clearTimeout(this.searchTimer);
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.resizeFrame);
    this.viewer.setDocument(null);
    this.links.setDocument(null);
    this.loading.destroy();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.host.classList.remove('pdf-active', 'pdf-dark');
  }
}
