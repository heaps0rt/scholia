import { PROVIDERS, mergeSettings, modelId, modelLabel, modelReasoning, normalizeSiteKey, providerById } from '../../../packages/core/src/providers.js';
import { sendRuntimeMessage as message } from './runtime-message.js';
import { formatUsageRemaining } from './usage.js';

const elements = Object.fromEntries([
  'settings-form', 'provider', 'language', 'explain-on-selection', 'include-context',
  'provider-name', 'vision-badge', 'model', 'model-list', 'endpoint', 'key-row',
  'api-key', 'key-hint', 'local-note', 'reveal-key', 'test', 'status',
  'reasoning-row', 'reasoning', 'fast-row', 'fast-mode', 'bridge-card', 'bridge-dot',
  'bridge-status', 'bridge-detail', 'bridge-start', 'bridge-copy', 'bridge-install',
  'site-access-mode', 'site-list-title', 'site-policy-copy', 'site-entry', 'site-add',
  'site-list', 'site-list-empty'
].map((id) => [id, document.getElementById(id)]));

let settings = mergeSettings();
let renderedProviderId = settings.provider;
let bridgeStatus = null;
let bridgeRequest = 0;

function showStatus(text, error = false) {
  elements.status.textContent = text;
  elements.status.classList.toggle('error', error);
}

function renderProviderOptions() {
  elements.provider.textContent = '';
  for (const provider of PROVIDERS) {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.name;
    elements.provider.append(option);
  }
}

function rememberVisibleProvider(providerId = renderedProviderId) {
  const provider = providerById(providerId);
  settings.models[provider.id] = elements.model.value.trim() || provider.defaultModel;
  settings.endpoints[provider.id] = elements.endpoint.value.trim() || provider.endpoint;
  settings.apiKeys[provider.id] = elements['api-key'].value.trim();
  if (!elements['reasoning-row'].hidden) settings.reasoningEfforts[provider.id] = elements.reasoning.value;
  settings.fastMode = elements['fast-mode'].checked;
  const model = settings.models[provider.id];
  if (!provider.models.some((entry) => modelId(entry) === model)) {
    settings.customModels[provider.id] = [...new Set([...(settings.customModels[provider.id] || []), model])];
  }
}

function renderReasoning(provider, model) {
  const config = modelReasoning(provider, model);
  elements['reasoning-row'].hidden = !config;
  elements.reasoning.textContent = '';
  if (config) {
    const current = config.efforts.includes(settings.reasoningEfforts[provider.id])
      ? settings.reasoningEfforts[provider.id]
      : config.default;
    for (const effort of config.efforts) {
      const option = document.createElement('option');
      option.value = effort;
      option.textContent = effort;
      option.selected = effort === current;
      elements.reasoning.append(option);
    }
  }
  elements['fast-row'].hidden = provider.id !== 'claudecode';
  elements['fast-mode'].checked = Boolean(settings.fastMode);
}

function renderProvider(providerId = elements.provider.value) {
  const provider = providerById(providerId);
  renderedProviderId = provider.id;
  elements['provider-name'].textContent = provider.name;
  elements['vision-badge'].textContent = provider.imageCapability === 'bridge-health' ? 'Bridge-reported vision' : provider.supportsImages ? 'Vision capable' : 'Text only';
  elements['vision-badge'].classList.toggle('no-vision', !provider.supportsImages);
  elements.model.value = settings.models[provider.id] || provider.defaultModel;
  elements.endpoint.value = settings.endpoints[provider.id] || provider.endpoint;
  elements['api-key'].value = settings.apiKeys[provider.id] || '';
  elements['api-key'].placeholder = provider.keyHint || 'No key required';
  elements['key-hint'].textContent = provider.keyRequired
    ? `Required by ${provider.name}. Saved only in extension-local storage.`
    : provider.id === 'opencode'
      ? 'Optional opencode server password. Sent as HTTP Basic auth with username “opencode”.'
      : 'Optional. Leave blank unless your local or custom endpoint requires a bearer token.';
  elements['local-note'].hidden = provider.keyRequired;
  elements['model-list'].textContent = '';
  const models = new Map();
  for (const entry of [...(provider.models || []), ...(settings.customModels[provider.id] || [])]) {
    if (!models.has(modelId(entry))) models.set(modelId(entry), modelLabel(entry));
  }
  for (const [model, label] of models) {
    const option = document.createElement('option');
    option.value = model;
    option.label = label;
    elements['model-list'].append(option);
  }
  renderReasoning(provider, elements.model.value);
  elements['bridge-card'].hidden = !provider.localBridge;
  if (provider.localBridge) refreshBridgeStatus();
  else bridgeStatus = null;
}

function renderAll() {
  elements.provider.value = settings.provider;
  elements.language.value = settings.language;
  elements['explain-on-selection'].checked = settings.explainOnSelection;
  elements['include-context'].checked = settings.includePageContext;
  elements['site-access-mode'].value = settings.siteAccessMode;
  renderProvider(settings.provider);
  renderSitePolicy();
}

function activeSiteList() {
  return settings.siteAccessMode === 'allowlist' ? settings.allowedSites : settings.disabledSites;
}

function renderSitePolicy() {
  const allowlist = settings.siteAccessMode === 'allowlist';
  const sites = activeSiteList();
  elements['site-list-title'].textContent = allowlist ? 'Whitelisted websites' : 'Blocked websites';
  elements['site-policy-copy'].textContent = allowlist
    ? 'Scholia stays inactive everywhere except the websites listed here. Add the current website quickly from the toolbar panel.'
    : 'Scholia runs everywhere except the websites listed here. Use ⊘ in the selection popup to block the current website.';
  elements['site-add'].textContent = allowlist ? 'Add to whitelist' : 'Block website';
  elements['site-list-empty'].textContent = allowlist
    ? 'No websites are whitelisted. Scholia is inactive everywhere.'
    : 'No websites are blocked. Scholia is enabled everywhere.';
  elements['site-list'].textContent = '';
  elements['site-list-empty'].hidden = sites.length > 0;
  for (const site of sites) {
    const row = document.createElement('div');
    row.className = 'site-row';
    const label = document.createElement('code');
    label.textContent = site;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quiet';
    button.textContent = allowlist ? 'Remove' : 'Enable';
    button.addEventListener('click', async () => {
      const listName = allowlist ? 'allowedSites' : 'disabledSites';
      const nextSettings = {
        ...settings,
        [listName]: settings[listName].filter((entry) => entry !== site)
      };
      try {
        settings = mergeSettings(await message({ type: 'SCHOLIA_SAVE_SETTINGS', settings: nextSettings }));
        renderSitePolicy();
      } catch (error) { showStatus(error.message, true); }
    });
    row.append(label, button);
    elements['site-list'].append(row);
  }
}

async function addSiteRule() {
  const site = normalizeSiteKey(elements['site-entry'].value);
  if (!site) {
    showStatus('Enter a valid hostname such as example.org.', true);
    return;
  }
  const listName = settings.siteAccessMode === 'allowlist' ? 'allowedSites' : 'disabledSites';
  const nextSettings = {
    ...settings,
    [listName]: [...new Set([...settings[listName], site])].sort()
  };
  try {
    settings = mergeSettings(await message({ type: 'SCHOLIA_SAVE_SETTINGS', settings: nextSettings }));
    elements['site-entry'].value = '';
    renderSitePolicy();
    showStatus('Website policy saved.');
  } catch (error) {
    showStatus(error.message, true);
  }
}

function paintBridgeStatus(status) {
  bridgeStatus = status;
  elements['bridge-dot'].className = `status-dot ${status.up == null ? 'is-checking' : status.up ? 'is-up' : 'is-down'}`;
  elements['bridge-status'].textContent = status.up == null
    ? `Checking ${status.label || 'local bridge'}…`
    : status.up ? `${status.label} is running` : `${status.label} is offline`;
  const usage = formatUsageRemaining(status.usage);
  elements['bridge-detail'].textContent = status.up
    ? [status.health?.version || status.health?.claudeVersion || '', usage, status.supportsImages ? 'images enabled' : 'text only'].filter(Boolean).join(' · ')
    : `Expected at ${status.base || settings.endpoints[renderedProviderId]}.`;
  elements['bridge-start'].textContent = status.up ? 'Check again' : 'Start bridge';
  elements['bridge-copy'].hidden = !status.command;
  elements['bridge-install'].hidden = !status.installCommand;
  if (renderedProviderId === 'claudecode' && status.up != null) {
    elements['vision-badge'].textContent = status.supportsImages ? 'Images enabled' : 'Text only';
    elements['vision-badge'].classList.toggle('no-vision', !status.supportsImages);
  }
}

async function refreshBridgeStatus() {
  const provider = providerById(renderedProviderId);
  if (!provider.localBridge) return;
  const request = ++bridgeRequest;
  paintBridgeStatus({ up: null, label: provider.localBridge.label, base: settings.endpoints[provider.id] });
  try {
    const result = await message({ type: 'SCHOLIA_BRIDGE_STATUS', provider: provider.id, includeUsage: true });
    if (request === bridgeRequest && renderedProviderId === provider.id) paintBridgeStatus(result);
  } catch (error) {
    if (request === bridgeRequest) paintBridgeStatus({ up: false, label: provider.localBridge.label, base: settings.endpoints[provider.id], error: error.message });
  }
}

function openBridge() {
  if (!bridgeStatus?.startUrl) return;
  if (bridgeStatus.up) {
    refreshBridgeStatus();
    return;
  }
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = bridgeStatus.startUrl;
  document.body.append(frame);
  setTimeout(() => frame.remove(), 1_500);
  setTimeout(refreshBridgeStatus, 1_300);
}

async function copyText(value) {
  if (!value) return;
  await navigator.clipboard.writeText(value);
  showStatus(`Copied: ${value}`);
}

function collect() {
  rememberVisibleProvider();
  settings.provider = elements.provider.value;
  settings.language = elements.language.value;
  settings.explainOnSelection = elements['explain-on-selection'].checked;
  settings.includePageContext = elements['include-context'].checked;
  settings.siteAccessMode = elements['site-access-mode'].value;
  return settings;
}

async function save() {
  settings = mergeSettings(await message({ type: 'SCHOLIA_SAVE_SETTINGS', settings: collect() }));
  showStatus('Saved. New explanations will use these settings.');
  if (providerById(settings.provider).localBridge) refreshBridgeStatus();
}

elements.provider.addEventListener('change', () => {
  rememberVisibleProvider();
  settings.provider = elements.provider.value;
  renderProvider(settings.provider);
  showStatus('');
});

elements['reveal-key'].addEventListener('click', () => {
  const reveal = elements['api-key'].type === 'password';
  elements['api-key'].type = reveal ? 'text' : 'password';
  elements['reveal-key'].textContent = reveal ? 'Hide' : 'Show';
});

elements.model.addEventListener('input', () => renderReasoning(providerById(renderedProviderId), elements.model.value.trim()));
elements['site-access-mode'].addEventListener('change', () => {
  settings.siteAccessMode = elements['site-access-mode'].value;
  renderSitePolicy();
});
elements['site-add'].addEventListener('click', addSiteRule);
elements['site-entry'].addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); addSiteRule(); }
});
elements['bridge-start'].addEventListener('click', openBridge);
elements['bridge-copy'].addEventListener('click', () => copyText(bridgeStatus?.command).catch((error) => showStatus(error.message, true)));
elements['bridge-install'].addEventListener('click', () => copyText(bridgeStatus?.installCommand).catch((error) => showStatus(error.message, true)));

elements['settings-form'].addEventListener('submit', async (event) => {
  event.preventDefault();
  showStatus('Saving…');
  try { await save(); } catch (error) { showStatus(error.message, true); }
});

elements.test.addEventListener('click', async () => {
  showStatus('Saving and testing…');
  elements.test.disabled = true;
  try {
    await save();
    const provider = providerById(settings.provider);
    const result = await message({ type: 'SCHOLIA_TEST_PROVIDER', provider: provider.id, model: settings.models[provider.id] });
    showStatus(`Connected to ${provider.name} · ${result.model}: ${result.text || 'response received'}`);
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    elements.test.disabled = false;
  }
});

async function boot() {
  renderProviderOptions();
  try {
    settings = mergeSettings(await message({ type: 'SCHOLIA_GET_SETTINGS' }));
    renderAll();
  } catch (error) {
    showStatus(error.message, true);
  }
}

boot();
