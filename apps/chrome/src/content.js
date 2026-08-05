import contentStyles from './content.css';
import { PROVIDERS, modelId, modelLabel, modelReasoning, providerById, siteIsEnabled } from '../../../packages/core/src/providers.js';
import { packPageContext, packParentContext, packSiteContext } from '../../../packages/core/src/context.js';
import { renderMarkdown } from './render.js';
import { sendRuntimeMessage as extensionMessage } from './runtime-message.js';
import { formatUsageRemaining } from './usage.js';
import { createHtmlElement } from './html-elements.js';
import { clipboardImageFile, normalizeImageFile } from './image-input.js';
import { isolateUiInputEvents } from './ui-event-boundary.js';
import { crawlSite, siteLinksFromDocument } from './site-context.js';
import {
  chainAtPoint,
  collapseWhitespace,
  cropScreenshot,
  currentSelectionCapture,
  currentSiteKey,
  decodeMathNode,
  directMathChildren,
  lastRangeRect,
  leafMathNodes,
  mathChain,
  mathContainer,
  resolvedPageMetadata,
  wrappedMath
} from './page-capture.js';

const HOST_ID = 'scholia-extension-root';

function boot() {
  const host = createHtmlElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;contain:layout style;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = createHtmlElement('style');
  style.textContent = contentStyles;
  shadow.append(style);
  document.documentElement.append(host);

  loadKatexStyles(shadow);
  const app = new ScholiaContent(shadow);
  app.mount();
}

async function loadKatexStyles(shadow) {
  try {
    const response = await fetch(chrome.runtime.getURL('vendor/katex/katex.min.css'));
    if (!response.ok) return;
    const style = createHtmlElement('style');
    style.textContent = await response.text();
    shadow.prepend(style);
  } catch {}
}

class ScholiaContent {
  constructor(shadow) {
    this.shadow = shadow;
    this.capture = null;
    this.pendingCapture = null;
    this.layers = [];
    this.mathState = null;
    this.settings = null;
    this.messages = [];
    this.streaming = false;
    this.requestId = '';
    this.port = null;
    this.toastTimer = null;
    this.selectionTimer = null;
    this.captureForConversation = false;
    this.captureReturnToModal = false;
    this.popoverInteracting = false;
    this.popoverInteractionTimer = null;
    this.multiSelection = [];
    this.multiAddMode = false;
    this.singleMathPick = null;
    this.highlightElements = [];
    this.bridgeStatus = null;
    this.bridgeStatusRequest = 0;
    this.bridgeWatchTimer = null;
    this.longPressTimer = null;
    this.justLongPressed = false;
    this.imageQuestionDraft = '';
    this.siteContextCache = new Map();
    this.lastPublishedSelection = '';
  }

  mount() {
    const template = createHtmlElement('template');
    template.innerHTML = `
      <section class="scholia-pill" data-pill hidden role="dialog" aria-label="Ask Scholia about this selection">
        <div class="scholia-pill__preview">
          <span class="scholia-pill__kind" data-pill-kind>Text</span>
          <span class="scholia-pill__preview-text" data-pill-preview></span>
          <button type="button" class="scholia-pill__add" data-add-symbol hidden title="Select several symbols">+ symbol</button>
          <span class="scholia-pill__math-tools" data-math-tools hidden>
            <button type="button" data-narrow title="Select a smaller math part">Narrower</button>
            <button type="button" data-wider title="Select a wider math part">Wider</button>
          </span>
          <button type="button" class="scholia-pill__site" data-disable-site title="Disable Scholia on this site" aria-label="Disable Scholia on this site"><span aria-hidden="true">⊘</span></button>
        </div>
        <div class="scholia-pill__row">
          <input data-pill-question aria-label="Ask about selection" placeholder="Ask about this…">
          <button type="button" class="scholia-primary" data-pill-send>Explain</button>
        </div>
      </section>
      <div class="scholia-backdrop" data-backdrop hidden>
        <div class="scholia-layer-stack" data-layer-stack aria-hidden="true"></div>
        <section class="scholia-modal" data-modal role="dialog" aria-modal="true" aria-label="Scholia explanation">
          <header class="scholia-header">
            <div class="scholia-brand"><span class="scholia-mark">S</span><span class="scholia-title">Scholia</span></div>
            <select class="scholia-model" data-model aria-label="AI model"></select>
            <select class="scholia-effort" data-effort hidden aria-label="Reasoning effort"></select>
            <button type="button" class="scholia-header-chip" data-fast hidden title="Claude Code fast mode" aria-pressed="false">⚡</button>
            <button type="button" class="scholia-header-chip scholia-bridge-pill" data-bridge hidden><span class="scholia-status-dot is-checking"></span><span data-bridge-label>checking</span></button>
            <button type="button" class="scholia-icon-button" data-settings title="Settings" aria-label="Settings">⚙</button>
            <button type="button" class="scholia-icon-button" data-disable-site title="Disable Scholia on this site" aria-label="Disable Scholia on this site">⊘</button>
            <button type="button" class="scholia-icon-button" data-close title="Close" aria-label="Close">×</button>
          </header>
          <div class="scholia-bridge-bar" data-bridge-bar hidden>
            <span class="scholia-status-dot is-down"></span>
            <span data-bridge-bar-text>Local bridge is not running.</span>
            <button type="button" data-bridge-start>Start bridge</button>
            <button type="button" data-bridge-copy>Copy command</button>
          </div>
          <div class="scholia-source" data-source hidden>
            <img data-source-image hidden alt="Captured screen region">
            <div class="scholia-source__body"><span class="scholia-source__label" data-source-label>Selected text</span><div class="scholia-source__text" data-source-text></div></div>
          </div>
          <main class="scholia-messages" data-messages><div class="scholia-empty"><strong>Ask in context</strong>Select text or capture a region, then Scholia will explain it here.</div></main>
          <footer class="scholia-composer">
            <div class="scholia-composer__box">
              <button type="button" class="scholia-icon-button" data-image title="Choose an image" aria-label="Choose an image">▧</button>
              <button type="button" class="scholia-icon-button" data-capture title="Capture another region" aria-label="Capture another region">▣</button>
              <textarea data-composer rows="1" placeholder="Ask a follow-up…" aria-label="Ask a follow-up"></textarea>
              <button type="button" class="scholia-primary scholia-send" data-send aria-label="Send">↑</button>
            </div>
            <div class="scholia-composer__hint">Enter to send · Shift+Enter for a new line</div>
            <input data-image-file type="file" accept="image/*" hidden>
          </footer>
        </section>
      </div>
      <div class="scholia-toast" data-toast hidden role="status"></div>
      <div class="scholia-capture" data-capture-layer hidden>
        <div class="scholia-capture__help">Drag over the region to explain · Escape to cancel</div>
        <div class="scholia-capture__rect" data-capture-rect hidden></div>
      </div>`;
    this.shadow.append(template.content);

    this.bindElements();
    this.bindEvents();
    this.refreshSettings();
  }

  bindElements() {
    const q = (selector) => this.shadow.querySelector(selector);
    this.els = {
      pill: q('[data-pill]'), pillKind: q('[data-pill-kind]'), pillPreview: q('[data-pill-preview]'),
      pillQuestion: q('[data-pill-question]'), pillSend: q('[data-pill-send]'), mathTools: q('[data-math-tools]'), addSymbol: q('[data-add-symbol]'),
      backdrop: q('[data-backdrop]'), layerStack: q('[data-layer-stack]'), modal: q('[data-modal]'), close: q('[data-close]'),
      model: q('[data-model]'), effort: q('[data-effort]'), fast: q('[data-fast]'),
      bridge: q('[data-bridge]'), bridgeLabel: q('[data-bridge-label]'), bridgeBar: q('[data-bridge-bar]'),
      bridgeBarText: q('[data-bridge-bar-text]'), source: q('[data-source]'),
      sourceLabel: q('[data-source-label]'), sourceText: q('[data-source-text]'), sourceImage: q('[data-source-image]'),
      messages: q('[data-messages]'), composer: q('[data-composer]'), send: q('[data-send]'), imageFile: q('[data-image-file]'),
      toast: q('[data-toast]'), captureLayer: q('[data-capture-layer]'), captureRect: q('[data-capture-rect]')
    };
    this.els.disableSiteButtons = [...this.shadow.querySelectorAll('[data-disable-site]')];
  }

  bindEvents() {
    const host = document.getElementById(HOST_ID);
    isolateUiInputEvents(this.shadow);
    document.addEventListener('pointerdown', (event) => {
      if (!this.els.pill.hidden && !event.composedPath().includes(host)) this.hidePill(false);
    }, true);
    this.shadow.addEventListener('pointerdown', (event) => {
      if (!this.els.pill.hidden && !event.target.closest?.('.scholia-pill')) this.hidePill(false);
    }, true);
    document.addEventListener('pointerup', (event) => {
      if (event.altKey || this.justLongPressed || this.popoverInteracting) return;
      clearTimeout(this.selectionTimer);
      this.selectionTimer = setTimeout(() => this.inspectSelection(), event.pointerType === 'touch' ? 250 : 35);
    }, true);
    const scheduleSelectionInspection = () => {
      if (this.popoverInteracting || this.mathState || this.multiSelection.length) return;
      clearTimeout(this.selectionTimer);
      this.selectionTimer = setTimeout(() => this.inspectSelection(), 280);
    };
    document.addEventListener('selectionchange', scheduleSelectionInspection, true);
    this.shadow.addEventListener('selectionchange', scheduleSelectionInspection, true);
    document.addEventListener('keyup', (event) => {
      if (event.key === 'Shift' || event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') this.inspectSelection();
    }, true);
    document.addEventListener('click', (event) => this.handleMathClick(event), true);
    this.shadow.addEventListener('click', (event) => this.handleMathClick(event), true);
    this.bindMathTouch();
    document.addEventListener('scroll', () => {
      if (!this.els.backdrop.hidden || !this.els.captureLayer.hidden) return;
      if (this.pendingCapture?.range && !this.els.pill.hidden) {
        this.paintRangeHighlight(this.pendingCapture.range);
        const rect = lastRangeRect(this.pendingCapture.range);
        if (rect) this.showPill(rect);
        return;
      }
      if (this.mathState || this.multiSelection.length) return;
      this.hidePill(false);
    }, { passive: true, capture: true });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!this.els.captureLayer.hidden) this.cancelCapture();
      else if (!this.els.backdrop.hidden) this.closeTopLayer();
      else this.hidePill(false);
    }, true);

    this.els.pill.addEventListener('pointerdown', () => this.markPopoverInteraction());
    this.els.pill.addEventListener('click', (event) => { this.markPopoverInteraction(); event.stopPropagation(); });
    this.els.pillSend.addEventListener('click', () => this.explainPill());
    this.els.pillQuestion.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); this.explainPill(); }
    });
    this.shadow.querySelector('[data-narrow]').addEventListener('click', () => this.updateMathDepth(-1));
    this.shadow.querySelector('[data-wider]').addEventListener('click', () => this.updateMathDepth(1));
    this.els.addSymbol.addEventListener('click', () => {
      this.multiAddMode = !this.multiAddMode;
      this.updateAddSymbolButton();
    });
    this.els.close.addEventListener('click', () => this.closeTopLayer());
    this.els.backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === this.els.backdrop) this.closeTopLayer();
    });
    this.shadow.querySelector('[data-settings]').addEventListener('click', () => extensionMessage({ type: 'SCHOLIA_OPEN_OPTIONS' }).catch((error) => this.toast(error.message)));
    for (const button of this.els.disableSiteButtons) button.addEventListener('click', () => this.disableCurrentSite());
    this.shadow.querySelector('[data-image]').addEventListener('click', () => this.openImagePicker(this.els.composer.value));
    this.shadow.querySelector('[data-capture]').addEventListener('click', () => this.startCapture(true));
    this.els.send.addEventListener('click', () => this.sendComposer());
    this.els.composer.addEventListener('input', () => this.resizeComposer());
    this.els.composer.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.sendComposer(); }
    });
    this.els.composer.addEventListener('paste', (event) => this.handleImagePaste(event));
    this.els.pillQuestion.addEventListener('paste', (event) => this.handleImagePaste(event));
    this.els.imageFile.addEventListener('change', () => {
      const [file] = this.els.imageFile.files || [];
      const question = this.imageQuestionDraft;
      this.useImageFile(file, { question }).catch((error) => this.toast(error.message || 'Could not read that image.')).finally(() => {
        this.els.imageFile.value = '';
        this.imageQuestionDraft = '';
      });
    });
    this.els.model.addEventListener('change', () => {
      this.updateModelControls();
      this.saveSelectedModel();
    });
    this.els.effort.addEventListener('change', () => this.saveSelectedModel());
    this.els.fast.addEventListener('click', () => {
      this.settings.fastMode = !this.settings.fastMode;
      this.updateModelControls();
      this.saveSelectedModel();
    });
    this.els.bridge.addEventListener('click', () => {
      if (this.bridgeStatus?.up) this.refreshBridgeStatus(true);
      else this.startBridge();
    });
    this.shadow.querySelector('[data-bridge-start]').addEventListener('click', () => this.startBridge());
    this.shadow.querySelector('[data-bridge-copy]').addEventListener('click', () => this.copyBridgeCommand());
    this.els.messages.addEventListener('click', (event) => this.copyCode(event));
    this.bindCaptureLayer();

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'SCHOLIA_EXPLAIN_CURRENT') {
        if (this.siteDisabled()) { this.toast(this.siteDisabledMessage()); sendResponse?.({ ok: true }); return; }
        const selected = currentSelectionCapture();
        if (!selected) this.toast('Select some text first.');
        else this.openAndAsk(selected, '').catch((error) => this.toast(error.message));
        sendResponse?.({ ok: true });
      } else if (message?.type === 'SCHOLIA_EXPLAIN_TEXT') {
        if (this.siteDisabled()) { sendResponse?.({ ok: true }); return; }
        const selected = currentSelectionCapture(message.text);
        if (selected) this.openAndAsk(selected, '').catch((error) => this.toast(error.message));
        sendResponse?.({ ok: true });
      } else if (message?.type === 'SCHOLIA_START_CAPTURE') {
        if (this.siteDisabled()) { this.toast(this.siteDisabledMessage()); sendResponse?.({ ok: true }); return; }
        this.startCapture(false);
        sendResponse?.({ ok: true });
      } else if (message?.type === 'SCHOLIA_GET_PAGE_CONTEXT') {
        if (this.siteDisabled()) {
          sendResponse?.({ ok: false, error: this.siteDisabledMessage() });
          return;
        }
        resolvedPageMetadata().then((metadata) => {
          const context = this.settings?.includePageContext !== false
            ? packPageContext(metadata.context, {
              outline: metadata.outline,
              selection: String(message.selection || ''),
              question: String(message.question || '')
            })
            : '';
          sendResponse?.({
            ok: true,
            value: {
              ...metadata,
              context,
              outline: '',
              rawContextCharacters: metadata.context.length,
              packedContextCharacters: context.length
            }
          });
        }).catch((error) => {
          sendResponse?.({ ok: false, error: error?.message || 'Scholia could not read this page.' });
        });
        return true;
      } else if (message?.type === 'SCHOLIA_GET_SITE_CONTEXT') {
        if (this.siteDisabled()) {
          sendResponse?.({ ok: false, error: this.siteDisabledMessage() });
          return;
        }
        this.getSiteContext({
          question: String(message.question || ''),
          selection: String(message.selection || '')
        }).then((value) => {
          sendResponse?.({ ok: true, value });
        }).catch((error) => {
          sendResponse?.({ ok: false, error: error?.message || 'Scholia could not read this site.' });
        });
        return true;
      }
      return undefined;
    });

    chrome.storage.onChanged.addListener((_changes, area) => {
      if (area === 'local') this.refreshSettings();
    });
  }

  async getSiteContext({ question = '', selection = '' } = {}) {
    const currentUrl = new URL(location.href);
    if (!['http:', 'https:'].includes(currentUrl.protocol)) {
      throw new Error('Entire-site context is available only on ordinary HTTP and HTTPS sites.');
    }
    const metadata = await resolvedPageMetadata();
    const cacheKey = currentUrl.origin;
    let cached = this.siteContextCache.get(cacheKey);
    if (!cached || Date.now() - cached.createdAt > 10 * 60_000) {
      const crawl = await crawlSite({
        startUrl: currentUrl.href,
        initialPage: {
          url: currentUrl.href,
          title: metadata.pageTitle,
          text: metadata.context,
          links: siteLinksFromDocument(document, currentUrl.href)
        }
      });
      if (!crawl.pages.length) throw new Error('No readable pages were found on this site.');
      cached = { createdAt: Date.now(), crawl };
      this.siteContextCache.set(cacheKey, cached);
    }

    const { crawl } = cached;
    const context = packSiteContext(crawl.pages, {
      question,
      selection,
      discoveredPages: crawl.discoveredPages,
      truncated: crawl.truncated
    });
    return {
      ...metadata,
      sourceKind: 'site',
      context,
      outline: '',
      rawContextCharacters: crawl.totalCharacters,
      packedContextCharacters: context.length,
      sitePageCount: crawl.pages.length,
      siteDiscoveredPages: crawl.discoveredPages,
      siteFailedPages: crawl.failedPages,
      siteTruncated: crawl.truncated,
      contextNotice: `Site-wide context from ${currentUrl.hostname}`
    };
  }

  async refreshSettings() {
    try {
      this.settings = await extensionMessage({ type: 'SCHOLIA_GET_PUBLIC_SETTINGS' });
      const allowlistMode = this.settings.siteAccessMode === 'allowlist';
      for (const button of this.els.disableSiteButtons) {
        const label = allowlistMode ? 'Remove this site from the whitelist' : 'Disable Scholia on this site';
        button.title = label;
        button.setAttribute('aria-label', label);
      }
      this.populateModels();
      if (this.siteDisabled()) {
        this.hidePill(false);
        if (!this.els.backdrop.hidden) this.closeModal();
      }
    } catch (error) {
      this.toast(error.message);
    }
  }

  siteDisabled() {
    if (!this.settings) return true;
    return !siteIsEnabled(this.settings, currentSiteKey());
  }

  siteDisabledMessage() {
    return this.settings?.siteAccessMode === 'allowlist'
      ? 'This site is not whitelisted. Add it from the extension panel.'
      : 'Scholia is disabled on this site. Re-enable it from the extension panel.';
  }

  liveSelection() {
    let shadowSelection = null;
    try { shadowSelection = this.shadow.getSelection?.() || null; } catch {}
    if (shadowSelection && !shadowSelection.isCollapsed && shadowSelection.rangeCount) return shadowSelection;
    return window.getSelection();
  }

  clearLiveSelection() {
    const selections = new Set();
    try { selections.add(window.getSelection()); } catch {}
    try { selections.add(this.shadow.getSelection?.()); } catch {}
    for (const selection of selections) {
      try { selection?.removeAllRanges(); } catch {}
    }
  }

  populateModels() {
    const select = this.els.model;
    const selectedProvider = this.settings?.provider || 'openai';
    const selectedModel = this.settings?.models?.[selectedProvider] || providerById(selectedProvider).defaultModel;
    select.textContent = '';
    for (const provider of PROVIDERS) {
      const group = createHtmlElement('optgroup');
      const configured = this.settings?.configuredProviders?.includes(provider.id);
      group.label = `${configured ? '●' : '○'} ${provider.name}`;
      const models = new Map();
      for (const entry of [...(provider.models || []), ...(this.settings?.customModels?.[provider.id] || []), this.settings?.models?.[provider.id]].filter(Boolean)) {
        const id = modelId(entry);
        if (id && !models.has(id)) models.set(id, modelLabel(entry));
      }
      for (const [model, label] of models) {
        const option = createHtmlElement('option');
        option.value = `${provider.id}::${model}`;
        option.textContent = label;
        option.selected = provider.id === selectedProvider && model === selectedModel;
        group.append(option);
      }
      select.append(group);
    }
    this.updateModelControls();
  }

  async saveSelectedModel() {
    const [provider, ...modelParts] = this.els.model.value.split('::');
    const model = modelParts.join('::');
    try {
      const reasoning = this.els.effort.hidden ? undefined : this.els.effort.value;
      this.settings = await extensionMessage({
        type: 'SCHOLIA_SAVE_MODEL', provider, model,
        reasoningEffort: reasoning,
        fastMode: this.settings?.fastMode
      });
      this.populateModels();
    } catch (error) { this.toast(error.message); }
  }

  updateModelControls() {
    const { provider: providerId, model } = this.selectedProviderModel();
    const provider = providerById(providerId);
    const reasoning = modelReasoning(provider, model);
    this.els.effort.hidden = !reasoning;
    if (reasoning) {
      const current = this.settings?.reasoningEfforts?.[provider.id];
      const selected = reasoning.efforts.includes(current) ? current : reasoning.default;
      this.els.effort.textContent = '';
      for (const effort of reasoning.efforts) {
        const option = createHtmlElement('option');
        option.value = effort;
        option.textContent = effort;
        option.selected = effort === selected;
        this.els.effort.append(option);
      }
      this.els.effort.title = `Reasoning effort: ${selected}`;
    }
    this.els.fast.hidden = provider.id !== 'claudecode';
    this.els.fast.classList.toggle('is-active', Boolean(this.settings?.fastMode));
    this.els.fast.setAttribute('aria-pressed', String(Boolean(this.settings?.fastMode)));
    this.els.bridge.hidden = !provider.localBridge;
    this.els.bridgeBar.hidden = true;
    if (provider.localBridge) this.refreshBridgeStatus(!this.els.backdrop.hidden);
    else this.bridgeStatus = null;
  }

  async refreshBridgeStatus(includeUsage = false) {
    const { provider } = this.selectedProviderModel();
    const definition = providerById(provider);
    if (!definition.localBridge) return;
    const request = ++this.bridgeStatusRequest;
    this.bridgeStatus = { up: null, label: definition.localBridge.label };
    this.paintBridgeStatus(this.bridgeStatus);
    try {
      const status = await extensionMessage({ type: 'SCHOLIA_BRIDGE_STATUS', provider, includeUsage });
      if (request !== this.bridgeStatusRequest || this.selectedProviderModel().provider !== provider) return;
      this.bridgeStatus = status;
      this.paintBridgeStatus(status);
    } catch (error) {
      if (request !== this.bridgeStatusRequest) return;
      this.bridgeStatus = { up: false, label: definition.localBridge.label, error: error.message };
      this.paintBridgeStatus(this.bridgeStatus);
    }
  }

  paintBridgeStatus(status) {
    const dot = this.els.bridge.querySelector('.scholia-status-dot');
    dot.className = `scholia-status-dot ${status.up == null ? 'is-checking' : status.up ? 'is-up' : 'is-down'}`;
    let label = status.up == null ? 'checking' : status.up ? 'running' : 'start';
    const remaining = formatUsageRemaining(status.usage);
    if (status.up && remaining) label = remaining;
    this.els.bridgeLabel.textContent = label;
    this.els.bridge.title = status.up ? `${status.label} is running` : `Start ${status.label || 'local bridge'}`;
    const showBar = !this.els.backdrop.hidden && status.up === false;
    this.els.bridgeBar.hidden = !showBar;
    this.els.bridgeBarText.textContent = `${status.label || 'Local bridge'} is not running.`;
  }

  startBridge() {
    const status = this.bridgeStatus;
    if (!status?.startUrl) { this.refreshBridgeStatus(true); return; }
    const frame = createHtmlElement('iframe');
    frame.hidden = true;
    frame.src = status.startUrl;
    document.documentElement.append(frame);
    setTimeout(() => frame.remove(), 1_500);
    clearInterval(this.bridgeWatchTimer);
    this.bridgeWatchTimer = setInterval(() => {
      this.refreshBridgeStatus(true);
      if (this.bridgeStatus?.up) clearInterval(this.bridgeWatchTimer);
    }, 1_200);
    setTimeout(() => clearInterval(this.bridgeWatchTimer), 25_000);
  }

  async copyBridgeCommand() {
    const command = this.bridgeStatus?.command;
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      this.toast(`Copied: ${command}`);
    } catch { this.toast(command, 6_000); }
  }

  async disableCurrentSite() {
    try {
      await extensionMessage({ type: 'SCHOLIA_SET_SITE_ENABLED', enabled: false });
      this.hidePill(false);
      this.closeModal();
      const message = this.settings?.siteAccessMode === 'allowlist'
        ? `${currentSiteKey()} was removed from the whitelist.`
        : `Scholia disabled on ${currentSiteKey()}. Re-enable it from the extension panel.`;
      this.toast(message, 5_000);
    } catch (error) { this.toast(error.message); }
  }

  decorateRecursiveCapture(capture, origin) {
    const bubble = origin?.closest?.('.scholia-message--assistant .scholia-bubble');
    if (!bubble || this.els.backdrop.hidden || !this.layers.length) return capture;
    const messageIndex = Number(bubble.closest('.scholia-message')?.dataset.messageIndex);
    const response = Number.isInteger(messageIndex) ? this.messages[messageIndex]?.content : bubble.innerText;
    const pageCapture = this.layers.at(-1)?.capture || this.capture;
    return {
      ...capture,
      context: pageCapture?.context || capture.context,
      outline: pageCapture?.outline || capture.outline,
      pageTitle: pageCapture?.pageTitle || capture.pageTitle,
      pageLanguage: pageCapture?.pageLanguage || capture.pageLanguage,
      url: pageCapture?.url || capture.url,
      packedContext: pageCapture?.packedContext,
      parentContext: packParentContext({
        ancestorContext: pageCapture?.parentContext,
        messages: Number.isInteger(messageIndex)
          ? this.messages.filter((_message, index) => index !== messageIndex)
          : this.messages,
        response: response || '',
        selection: capture.selection
      }),
      recursive: true
    };
  }

  inspectSelection() {
    if (!this.settings || this.siteDisabled() || this.popoverInteracting) return;
    const live = this.liveSelection();
    const selectedNode = live?.anchorNode?.nodeType === Node.ELEMENT_NODE ? live.anchorNode : live?.anchorNode?.parentElement;
    const selectedInsideResponse = Boolean(selectedNode
      && this.shadow.contains(selectedNode)
      && selectedNode.closest?.('.scholia-message--assistant .scholia-bubble'));
    if (selectedNode && this.shadow.contains(selectedNode) && !selectedInsideResponse) return;
    const selected = currentSelectionCapture('', live);
    if (!selected) {
      if (!selectedNode || !this.shadow.contains(selectedNode)) this.lastPublishedSelection = '';
      if (!this.els.backdrop.hidden) { this.hidePill(true); return; }
      if (!this.mathState && !this.multiSelection.length && !this.els.pill.contains(this.shadow.activeElement)) this.hidePill(false);
      return;
    }
    if (!selectedInsideResponse) this.publishPageSelection(selected);
    if (!this.settings.explainOnSelection) return;
    this.mathState = null;
    this.multiSelection = [];
    this.multiAddMode = false;
    this.singleMathPick = null;
    this.pendingCapture = this.decorateRecursiveCapture(selected, selectedNode);
    this.paintRangeHighlight(this.pendingCapture.range);
    this.showPill(this.pendingCapture.rect);
  }

  publishPageSelection(capture) {
    const selection = String(capture?.selection || '').trim();
    const signature = `${capture?.kind || 'text'}:${selection}`;
    if (!selection || signature === this.lastPublishedSelection) return;
    this.lastPublishedSelection = signature;
    extensionMessage({
      type: 'SCHOLIA_PAGE_SELECTION_CHANGED',
      selection,
      kind: capture?.kind || 'text'
    }).catch(() => {});
  }

  showPill(rect) {
    const pill = this.els.pill;
    const capture = this.pendingCapture;
    if (!capture) return;
    this.els.pillKind.textContent = capture.kind === 'latex' ? 'Math' : capture.kind === 'image' ? 'Image' : 'Text';
    this.els.pillPreview.textContent = collapseWhitespace(capture.preview || capture.selection).slice(0, 220);
    this.els.mathTools.hidden = !this.mathState?.chain?.length || this.multiSelection.length > 1;
    this.updateAddSymbolButton();

    const wasVisible = pill.classList.contains('is-visible');
    pill.hidden = false;
    const viewportPadding = 8;
    const gap = 8;
    const width = pill.offsetWidth;
    const height = pill.offsetHeight;
    const anchor = rect || { left: window.innerWidth / 2, right: window.innerWidth / 2, top: window.innerHeight / 2, bottom: window.innerHeight / 2, width: 0 };
    const anchorCenter = Math.max(viewportPadding, Math.min(window.innerWidth - viewportPadding, anchor.left + (anchor.width || 0) / 2));
    let left = anchorCenter - width / 2;
    left = Math.max(viewportPadding, Math.min(window.innerWidth - width - viewportPadding, left));

    const spaceAbove = anchor.top - viewportPadding;
    const spaceBelow = window.innerHeight - anchor.bottom - viewportPadding;
    const placeAbove = spaceBelow < height + gap && spaceAbove > spaceBelow;
    let top = placeAbove ? anchor.top - height - gap : anchor.bottom + gap;
    top = Math.max(viewportPadding, Math.min(window.innerHeight - height - viewportPadding, top));

    pill.dataset.placement = placeAbove ? 'above' : 'below';
    pill.style.setProperty('--scholia-pill-pointer-x', `${Math.max(16, Math.min(width - 16, anchorCenter - left))}px`);
    pill.style.left = `${left}px`;
    pill.style.top = `${top}px`;
    if (!wasVisible) requestAnimationFrame(() => pill.classList.add('is-visible'));
  }

  hidePill(keepHighlight = false) {
    this.els.pill.classList.remove('is-visible');
    setTimeout(() => { if (!this.els.pill.classList.contains('is-visible')) this.els.pill.hidden = true; }, 150);
    if (!keepHighlight) {
      this.clearHighlights();
      this.mathState = null;
      this.multiSelection = [];
      this.multiAddMode = false;
      this.singleMathPick = null;
      this.updateAddSymbolButton();
      this.pendingCapture = null;
    }
  }

  markPopoverInteraction() {
    this.popoverInteracting = true;
    clearTimeout(this.popoverInteractionTimer);
    this.popoverInteractionTimer = setTimeout(() => { this.popoverInteracting = false; }, 220);
  }

  clearHighlights() {
    for (const element of this.highlightElements) element.remove();
    this.highlightElements = [];
  }

  paintRects(rects, variant = 'math') {
    this.clearHighlights();
    for (const rect of rects) {
      if (!rect || (!rect.width && !rect.height)) continue;
      const element = createHtmlElement('div');
      element.className = `scholia-highlight scholia-highlight--${variant}`;
      Object.assign(element.style, {
        left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`
      });
      this.shadow.append(element);
      this.highlightElements.push(element);
    }
  }

  paintRangeHighlight(range) {
    try { this.paintRects([...range.getClientRects()], 'text'); } catch { this.clearHighlights(); }
  }

  paintMathNodes(nodes) {
    this.paintRects(nodes.map((node) => node?.getBoundingClientRect?.()).filter(Boolean));
  }

  updateAddSymbolButton() {
    const visible = Boolean(this.singleMathPick || this.multiSelection.length);
    this.els.addSymbol.hidden = !visible;
    if (!visible) return;
    this.els.addSymbol.classList.toggle('is-active', this.multiAddMode);
    this.els.addSymbol.textContent = this.multiAddMode ? 'Done' : `+ symbol${this.multiSelection.length > 1 ? ` (${this.multiSelection.length})` : ''}`;
  }

  updateMathDepth(change) {
    if (!this.mathState) return;
    const { chain, fullTex, container } = this.mathState;
    const maxDepth = chain.length;
    this.mathState.depth = Math.max(0, Math.min(maxDepth, this.mathState.depth + change));
    const whole = this.mathState.depth === maxDepth;
    const node = whole ? container : chain[this.mathState.depth];
    const fragment = whole ? '' : decodeMathNode(node);
    const description = whole || !fragment ? fullTex : this.describeMathSelection(container, node, fragment, fullTex);
    this.pendingCapture = { ...this.mathState.capture, selection: description, preview: fragment || fullTex, rect: node.getBoundingClientRect() };
    const rect = this.pendingCapture.rect;
    this.singleMathPick = whole ? null : { container, node, decoded: fragment };
    this.multiSelection = [];
    this.paintMathNodes([node]);
    this.shadow.querySelector('[data-narrow]').disabled = this.mathState.depth <= 0;
    this.shadow.querySelector('[data-wider]').disabled = this.mathState.depth >= maxDepth;
    this.showPill(rect);
  }

  describeMathSelection(container, node, decoded, fullTex) {
    const structural = {
      msup: ['the base of the power', 'the exponent'],
      msub: ['the base', 'the subscript'],
      msubsup: ['the base', 'the subscript', 'the exponent'],
      mfrac: ['the numerator', 'the denominator'],
      mroot: ['the radicand', 'the root index'],
      munder: ['', 'the lower limit'],
      mover: ['', 'the upper mark'],
      munderover: ['', 'the lower limit', 'the upper limit']
    };
    let role = '';
    let current = node;
    while (current && current !== container) {
      const parent = current.parentElement?.closest?.('g[data-mml-node]');
      if (!parent || !container.contains(parent)) break;
      const type = parent.getAttribute('data-mml-node');
      if (structural[type]) {
        const index = directMathChildren(parent).indexOf(current);
        role = structural[type][index] || '';
        break;
      }
      current = parent;
    }
    const matches = leafMathNodes(container).filter((candidate) => decodeMathNode(candidate) === decoded);
    const ordinal = matches.length > 1 ? matches.indexOf(node) + 1 : 0;
    const suffix = ordinal > 0 ? (ordinal % 10 === 1 && ordinal % 100 !== 11 ? 'st' : ordinal % 10 === 2 && ordinal % 100 !== 12 ? 'nd' : ordinal % 10 === 3 && ordinal % 100 !== 13 ? 'rd' : 'th') : '';
    const identity = ordinal > 0 ? `the ${ordinal}${suffix} "${decoded}"` : `the part "${decoded}"`;
    return `${identity}${role ? ` (${role})` : ''} within the full expression ${fullTex}`;
  }

  baseMathCapture(selection, preview, rect, origin) {
    const capture = { kind: 'latex', selection, preview, rect };
    return this.decorateRecursiveCapture(capture, origin);
  }

  selectWholeMath(container) {
    const fullTex = wrappedMath(container);
    if (!fullTex) return false;
    const rect = container.getBoundingClientRect();
    this.mathState = { container, chain: [], depth: 0, fullTex, capture: this.baseMathCapture(fullTex, fullTex, rect, container) };
    this.multiSelection = [];
    this.multiAddMode = false;
    this.singleMathPick = null;
    this.pendingCapture = this.mathState.capture;
    this.paintMathNodes([container]);
    this.showPill(rect);
    return true;
  }

  selectExactMath(container, node, chain = mathChain(container, node)) {
    const fullTex = wrappedMath(container);
    if (!fullTex || !node || !chain.length) return false;
    this.mathState = {
      container, chain, depth: 0, fullTex,
      capture: this.baseMathCapture(fullTex, fullTex, node.getBoundingClientRect(), container)
    };
    this.updateMathDepth(0);
    return true;
  }

  handleMathClick(event) {
    if (this.siteDisabled()) return;
    if (this.justLongPressed) {
      this.justLongPressed = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const container = mathContainer(event.target);
    if (!container || event.target?.closest?.('.scholia-math-source')) return;
    if ((event.altKey && event.shiftKey) || this.multiAddMode) {
      const chain = chainAtPoint(container, event.target, event.clientX, event.clientY);
      if (!chain.length) return;
      event.preventDefault();
      event.stopPropagation();
      this.clearLiveSelection();
      this.toggleMultiSymbol(container, chain[0]);
      return;
    }
    const selection = this.liveSelection();
    if (selection && !selection.isCollapsed) return;
    if (event.altKey) {
      const chain = chainAtPoint(container, event.target, event.clientX, event.clientY);
      if (chain.length) {
        event.preventDefault();
        event.stopPropagation();
        this.selectExactMath(container, chain[0], chain);
        return;
      }
    }
    this.selectWholeMath(container);
  }

  toggleMultiSymbol(container, node) {
    if (!this.multiSelection.length && this.singleMathPick?.node?.isConnected) {
      this.multiSelection.push(this.singleMathPick);
    }
    const index = this.multiSelection.findIndex((entry) => entry.node === node);
    if (index >= 0) this.multiSelection.splice(index, 1);
    else this.multiSelection.push({ container, node, decoded: decodeMathNode(node) || '(symbol)' });
    this.multiSelection = this.multiSelection.filter((entry) => entry.node?.isConnected);
    if (!this.multiSelection.length) { this.hidePill(false); return; }
    if (this.multiSelection.length === 1) {
      const only = this.multiSelection[0];
      this.selectExactMath(only.container, only.node, mathChain(only.container, only.node));
      this.multiAddMode = true;
      this.updateAddSymbolButton();
      return;
    }
    this.applyMultiSelection();
  }

  applyMultiSelection() {
    const groups = [];
    for (const entry of this.multiSelection) {
      let group = groups.find((candidate) => candidate.container === entry.container);
      if (!group) { group = { container: entry.container, entries: [] }; groups.push(group); }
      group.entries.push(entry);
    }
    const descriptions = groups.map((group) => {
      const symbols = group.entries.map((entry) => `"${entry.decoded}"`).join(', ');
      const full = wrappedMath(group.container);
      return full ? `${symbols} (in ${full})` : symbols;
    });
    const selection = `the symbols ${descriptions.join(' and ')}`;
    const preview = this.multiSelection.map((entry) => entry.decoded).join(', ');
    const last = this.multiSelection.at(-1).node;
    const rect = last.getBoundingClientRect();
    this.mathState = null;
    this.singleMathPick = null;
    this.pendingCapture = this.baseMathCapture(selection, preview, rect, last);
    this.paintMathNodes(this.multiSelection.map((entry) => entry.node));
    this.showPill(rect);
  }

  bindMathTouch() {
    let start = null;
    const cancel = () => {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
      start = null;
    };
    document.addEventListener('touchstart', (event) => {
      cancel();
      this.justLongPressed = false;
      if (this.siteDisabled() || event.touches?.length !== 1) return;
      const touch = event.touches[0];
      const container = mathContainer(touch.target);
      if (!container) return;
      start = { x: touch.clientX, y: touch.clientY, target: touch.target, container };
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        if (!start) return;
        const hit = document.elementFromPoint(start.x, start.y) || start.target;
        const activeContainer = mathContainer(hit) || start.container;
        const chain = chainAtPoint(activeContainer, hit, start.x, start.y);
        this.justLongPressed = true;
        setTimeout(() => { this.justLongPressed = false; }, 800);
        if (this.multiAddMode && chain.length) this.toggleMultiSymbol(activeContainer, chain[0]);
        else if (chain.length) this.selectExactMath(activeContainer, chain[0], chain);
        else this.selectWholeMath(activeContainer);
      }, 480);
    }, { passive: true, capture: true });
    document.addEventListener('touchmove', (event) => {
      if (!start || !this.longPressTimer) return;
      const touch = event.touches?.[0];
      if (!touch || Math.abs(touch.clientX - start.x) > 10 || Math.abs(touch.clientY - start.y) > 10) cancel();
    }, { passive: true, capture: true });
    document.addEventListener('touchend', cancel, { passive: true, capture: true });
    document.addEventListener('touchcancel', cancel, { passive: true, capture: true });
  }

  async explainPill() {
    if (!this.pendingCapture) return;
    const capture = this.pendingCapture;
    const question = this.els.pillQuestion.value.trim();
    this.els.pillQuestion.value = '';
    const previousLabel = this.els.pillSend.textContent;
    this.els.pillSend.disabled = true;
    this.els.pillSend.textContent = document.documentElement.dataset.scholiaPdfViewer === 'true' ? 'Reading PDF…' : 'Opening…';
    try {
      await this.openAndAsk(capture, question);
    } catch (error) {
      this.toast(error?.message || 'Scholia could not read this document.');
    } finally {
      this.els.pillSend.disabled = false;
      this.els.pillSend.textContent = previousLabel;
    }
  }

  async openAndAsk(capture, question) {
    const recursive = capture.recursive === true && !this.els.backdrop.hidden && this.layers.length > 0;
    if (!recursive && capture.context === undefined) capture = { ...await resolvedPageMetadata(), ...capture };
    if (recursive && this.streaming) this.cancelRequest();
    if (this.layers.length) {
      const currentLayer = this.layers.at(-1);
      currentLayer.scrollTop = this.els.messages.scrollTop;
      if (recursive) currentLayer.panel = this.snapshotActivePanel();
    }
    this.hidePill(!recursive);
    this.pendingCapture = null;
    if (!recursive) this.layers = [];
    const layer = { capture, messages: [], scrollTop: 0 };
    this.layers.push(layer);
    this.capture = capture;
    this.messages = layer.messages;
    this.renderSource();
    this.renderMessages();
    this.renderLayerStack();
    this.els.composer.placeholder = capture.kind === 'image' ? 'Ask about the captured region…' : 'Ask a follow-up…';
    this.els.backdrop.hidden = false;
    this.updateModelControls();
    this.clearLiveSelection();
    this.ask(question || (capture.kind === 'image' ? 'Explain what is shown in this region.' : 'Explain this.'));
  }

  renderSource() {
    const capture = this.capture;
    if (!capture) { this.els.source.hidden = true; return; }
    this.els.source.hidden = false;
    this.els.sourceLabel.textContent = capture.imageOrigin === 'pasted'
      ? 'Pasted image'
      : capture.imageOrigin === 'selected'
        ? 'Selected image'
        : capture.recursive
          ? capture.kind === 'latex' ? 'Mathematics selected from an explanation' : 'Selected from an explanation'
          : capture.kind === 'image' ? 'Captured region' : capture.kind === 'latex' ? 'Selected mathematics' : 'Selected text';
    this.els.sourceText.textContent = capture.kind === 'image' ? (capture.pageTitle || 'Visible page region') : capture.selection;
    this.els.sourceImage.hidden = !capture.imageDataUrl;
    if (capture.imageDataUrl) this.els.sourceImage.src = capture.imageDataUrl;
    else this.els.sourceImage.removeAttribute('src');
  }

  renderLayerStack() {
    this.els.layerStack.textContent = '';
    const behind = this.layers.slice(0, -1).slice(-4);
    behind.forEach((layer, index) => {
      const depth = behind.length - index;
      const panel = layer.panel;
      if (!panel) return;
      panel.style.setProperty('--scholia-layer-offset', `${depth * -12}px`);
      panel.style.setProperty('--scholia-layer-scale', String(1 - depth * 0.012));
      panel.style.setProperty('--scholia-layer-opacity', String(1 - depth * 0.08));
      panel.style.zIndex = String(index + 1);
      this.els.layerStack.append(panel);
      const messages = panel.querySelector('.scholia-messages');
      if (messages) messages.scrollTop = layer.scrollTop;
    });
    const layered = this.layers.length > 1;
    this.els.close.textContent = layered ? '←' : '×';
    this.els.close.title = layered ? 'Back to previous explanation' : 'Close';
    this.els.close.setAttribute('aria-label', this.els.close.title);
  }

  snapshotActivePanel() {
    const panel = this.els.modal.cloneNode(true);
    panel.classList.add('scholia-modal--layer');
    panel.removeAttribute('data-modal');
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('inert', '');
    return panel;
  }

  closeTopLayer() {
    if (this.layers.length <= 1) {
      this.closeModal();
      return;
    }
    if (this.streaming) this.cancelRequest();
    this.hidePill(false);
    this.layers.pop();
    const layer = this.layers.at(-1);
    this.capture = layer.capture;
    this.messages = layer.messages;
    this.els.composer.value = '';
    this.renderSource();
    this.renderMessages();
    this.els.messages.scrollTop = layer.scrollTop;
    this.renderLayerStack();
    this.updateModelControls();
    this.clearLiveSelection();
    this.els.close.focus();
  }

  closeModal() {
    if (this.streaming) this.cancelRequest();
    this.hidePill(false);
    this.layers = [];
    this.capture = null;
    this.messages = [];
    this.els.backdrop.hidden = true;
    this.renderLayerStack();
    this.els.bridgeBar.hidden = true;
    clearInterval(this.bridgeWatchTimer);
  }

  openImagePicker(question = '') {
    this.imageQuestionDraft = String(question || '');
    this.els.imageFile.click();
  }

  handleImagePaste(event) {
    const file = clipboardImageFile(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    this.useImageFile(file, { question: event.currentTarget?.value || '', pasted: true })
      .catch((error) => this.toast(error.message || 'Could not read that image.'));
  }

  async useImageFile(file, { question = '', pasted = false } = {}) {
    if (!file) return;
    const imageDataUrl = await normalizeImageFile(file);
    const metadata = await resolvedPageMetadata();
    const label = pasted ? 'Pasted image' : String(file.name || 'Selected image');
    const nextCapture = {
      kind: 'image',
      imageOrigin: pasted ? 'pasted' : 'selected',
      selection: '',
      preview: label,
      pageTitle: label,
      pageLanguage: metadata.pageLanguage || navigator.language,
      url: '',
      context: '',
      outline: [],
      imageDataUrl
    };
    this.showImageDraft(nextCapture, question);
  }

  showImageDraft(nextCapture, question = '') {
    if (this.streaming) this.cancelRequest();
    const replaceCurrent = !this.els.backdrop.hidden && this.layers.length > 0;
    this.hidePill(false);
    if (replaceCurrent) {
      this.messages.splice(0);
      const layer = this.layers.at(-1);
      layer.capture = nextCapture;
      layer.messages = this.messages;
    } else {
      this.layers = [];
      this.messages = [];
      this.layers.push({ capture: nextCapture, messages: this.messages, scrollTop: 0 });
    }
    this.capture = nextCapture;
    this.renderSource();
    this.renderMessages();
    this.renderLayerStack();
    this.els.composer.value = String(question || '');
    this.els.composer.placeholder = 'Ask about this image…';
    this.resizeComposer();
    this.els.backdrop.hidden = false;
    this.updateModelControls();
    this.clearLiveSelection();
    this.els.composer.focus();
    this.toast('Image ready. Add a question and send.');
  }

  sendComposer() {
    const question = this.els.composer.value.trim();
    if (!question || this.streaming) return;
    this.els.composer.value = '';
    this.resizeComposer();
    this.ask(question);
  }

  resizeComposer() {
    const textarea = this.els.composer;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 130)}px`;
  }

  selectedProviderModel() {
    const [provider, ...parts] = this.els.model.value.split('::');
    const providerId = provider || this.settings?.provider;
    return {
      provider: providerId,
      model: parts.join('::') || this.settings?.models?.[providerId],
      reasoningEffort: this.els.effort.hidden ? undefined : this.els.effort.value,
      fastMode: Boolean(this.settings?.fastMode)
    };
  }

  ask(question) {
    if (this.streaming || !this.capture) return;
    if (this.messages.at(-1)?.error) {
      this.messages.pop();
      if (this.messages.at(-1)?.role === 'user') this.messages.pop();
    }
    this.messages.push({ role: 'user', content: question });
    const assistant = { role: 'assistant', content: '', streaming: true, meta: '' };
    this.messages.push(assistant);
    this.streaming = true;
    this.renderMessages();

    const conversation = this.messages.filter((message) => !message.error).map(({ role, content }) => ({ role, content }));
    conversation.pop();
    if (this.settings?.includePageContext && this.capture.packedContext === undefined) {
      this.capture.packedContext = packPageContext(this.capture.context, {
        outline: this.capture.outline,
        selection: this.capture.preview || this.capture.selection,
        question
      });
    }
    const chosen = this.selectedProviderModel();
    this.requestId = crypto.randomUUID();
    const requestId = this.requestId;
    const port = chrome.runtime.connect({ name: 'scholia-chat' });
    this.port = port;

    port.onMessage.addListener((message) => {
      if (message.requestId !== requestId) return;
      if (message.type === 'token') {
        assistant.content += message.token || '';
        this.scheduleRender();
      } else if (message.type === 'done') {
        assistant.streaming = false;
        assistant.meta = `${providerById(message.provider).name} · ${message.model}`;
        this.streaming = false;
        this.renderMessages();
        port.disconnect();
        this.port = null;
      } else if (message.type === 'error') {
        assistant.streaming = false;
        assistant.error = true;
        assistant.content = message.error || 'The provider request failed.';
        this.streaming = false;
        this.renderMessages();
        if (providerById(chosen.provider).localBridge) this.refreshBridgeStatus(true);
        port.disconnect();
        this.port = null;
      } else if (message.type === 'cancelled') {
        assistant.streaming = false;
        const index = this.messages.indexOf(assistant);
        if (!assistant.content && index >= 0) this.messages.splice(index, 1);
        this.streaming = false;
        this.renderMessages();
      }
    });
    port.onDisconnect.addListener(() => {
      if (!this.streaming || this.requestId !== requestId) return;
      assistant.streaming = false;
      assistant.error = true;
      const detail = chrome.runtime.lastError?.message;
      assistant.content ||= detail ? `The Scholia service worker disconnected: ${detail}` : 'The connection to the Scholia service worker closed before the provider replied. Try again.';
      this.streaming = false;
      this.port = null;
      this.renderMessages();
    });

    port.postMessage({
      type: 'start', requestId,
      payload: {
        ...chosen,
        messages: conversation,
        kind: this.capture.kind,
        selection: this.capture.selection,
        context: this.settings?.includePageContext ? this.capture.packedContext : '',
        parentContext: this.capture.parentContext || '',
        pageTitle: this.capture.pageTitle,
        pageLanguage: this.capture.pageLanguage,
        url: this.capture.url,
        imageDataUrl: this.capture.imageDataUrl
      }
    });
  }

  cancelRequest() {
    try { this.port?.postMessage({ type: 'cancel', requestId: this.requestId }); } catch {}
    const assistant = this.messages.at(-1);
    if (assistant?.role === 'assistant' && assistant.streaming) assistant.streaming = false;
    this.streaming = false;
    this.port?.disconnect();
    this.port = null;
    this.renderMessages();
  }

  scheduleRender() {
    if (this.renderFrame) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.renderMessages();
    });
  }

  renderMessages() {
    const list = this.els.messages;
    if (!this.messages.length) {
      list.innerHTML = '<div class="scholia-empty"><strong>Ask in context</strong>Select text or capture a region, then Scholia will explain it here.</div>';
      return;
    }
    list.textContent = '';
    for (const [index, message] of this.messages.entries()) {
      const row = createHtmlElement('article');
      row.className = `scholia-message scholia-message--${message.role}${message.error ? ' scholia-message--error' : ''}`;
      row.dataset.messageIndex = String(index);
      const bubble = createHtmlElement('div');
      bubble.className = 'scholia-bubble';
      if (message.role === 'assistant' && !message.error) bubble.innerHTML = renderMarkdown(message.content) + (message.streaming ? '<span class="scholia-caret" aria-label="Writing"></span>' : '');
      else bubble.textContent = message.content;
      if (message.meta) {
        const meta = createHtmlElement('div');
        meta.className = 'scholia-meta';
        meta.textContent = message.meta;
        bubble.append(meta);
      }
      row.append(bubble);
      list.append(row);
    }
    list.scrollTop = list.scrollHeight;
  }

  async copyCode(event) {
    const button = event.target.closest?.('[data-copy-code]');
    if (!button) return;
    const code = button.closest('.scholia-code')?.querySelector('code')?.textContent || '';
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy'; }, 1000);
    } catch { this.toast('Could not copy this code block.'); }
  }

  bindCaptureLayer() {
    let start = null;
    let current = null;
    const layer = this.els.captureLayer;
    const box = this.els.captureRect;

    const update = () => {
      if (!start || !current) return;
      const left = Math.min(start.x, current.x);
      const top = Math.min(start.y, current.y);
      const width = Math.abs(current.x - start.x);
      const height = Math.abs(current.y - start.y);
      Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
      box.hidden = false;
    };

    layer.addEventListener('pointerdown', (event) => {
      start = { x: event.clientX, y: event.clientY };
      current = start;
      layer.setPointerCapture(event.pointerId);
      update();
    });
    layer.addEventListener('pointermove', (event) => {
      if (!start) return;
      current = { x: event.clientX, y: event.clientY };
      update();
    });
    layer.addEventListener('pointerup', async (event) => {
      if (!start) return;
      current = { x: event.clientX, y: event.clientY };
      const rect = {
        left: Math.min(start.x, current.x), top: Math.min(start.y, current.y),
        width: Math.abs(current.x - start.x), height: Math.abs(current.y - start.y)
      };
      start = null;
      current = null;
      box.hidden = true;
      if (rect.width < 16 || rect.height < 16) { this.cancelCapture(); return; }
      await this.finishCapture(rect);
    });
  }

  startCapture(forConversation) {
    if (this.siteDisabled()) { this.toast(this.siteDisabledMessage()); return; }
    if (this.streaming) this.cancelRequest();
    this.captureReturnToModal = !this.els.backdrop.hidden;
    this.captureForConversation = Boolean(forConversation && this.messages.length);
    this.els.backdrop.hidden = true;
    this.hidePill();
    this.els.captureLayer.hidden = false;
    this.els.captureRect.hidden = true;
  }

  cancelCapture() {
    this.els.captureLayer.hidden = true;
    this.els.captureRect.hidden = true;
    if (this.captureReturnToModal) this.els.backdrop.hidden = false;
    this.captureForConversation = false;
    this.captureReturnToModal = false;
  }

  async finishCapture(rect) {
    this.els.captureLayer.hidden = true;
    clearTimeout(this.toastTimer);
    this.els.toast.hidden = true;
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const screenshot = await extensionMessage({ type: 'SCHOLIA_CAPTURE_VISIBLE' });
      this.toast('Preparing the selected region…', 5000);
      const imageDataUrl = await cropScreenshot(screenshot, rect);
      const nextCapture = {
        kind: 'image', selection: '', preview: 'Captured screen region',
        ...await resolvedPageMetadata(), imageDataUrl, rect
      };
      if (this.captureForConversation) {
        this.capture = nextCapture;
        this.messages.splice(0);
        const layer = this.layers.at(-1);
        if (layer) {
          layer.capture = nextCapture;
          layer.messages = this.messages;
        }
        this.renderSource();
        this.renderMessages();
        this.renderLayerStack();
        this.els.backdrop.hidden = false;
        this.els.composer.placeholder = 'Ask about the captured region…';
        this.els.composer.focus();
      } else {
        await this.openAndAsk(nextCapture, 'Explain what is shown in this region.');
      }
    } catch (error) {
      this.toast(error.message || 'Could not capture this region.');
      if (this.captureReturnToModal) this.els.backdrop.hidden = false;
    } finally {
      this.captureForConversation = false;
      this.captureReturnToModal = false;
    }
  }

  toast(message, duration = 3200) {
    clearTimeout(this.toastTimer);
    this.els.toast.textContent = message;
    this.els.toast.hidden = false;
    this.toastTimer = setTimeout(() => { this.els.toast.hidden = true; }, duration);
  }
}

if (!document.getElementById(HOST_ID)) boot();
