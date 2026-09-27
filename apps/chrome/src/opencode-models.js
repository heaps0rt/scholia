import { isRetiredModelId } from '../../../packages/core/src/providers.js';

const MAX_MODELS = 2_000;
const REASONING_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

function catalogRoot(payload) {
  if (payload?.data && !Array.isArray(payload.data) && typeof payload.data === 'object') return payload.data;
  return payload;
}

function catalogProviders(payload) {
  const root = catalogRoot(payload);
  if (Array.isArray(root)) return root;
  if (Array.isArray(root?.all)) return root.all;
  if (Array.isArray(root?.providers)) return root.providers;
  return [];
}

function providerIsUsable(provider, connected, hasConnectedList) {
  if (!provider || provider.enabled === false) return false;
  const id = String(provider.id || '').trim();
  if (!id) return false;
  if (!hasConnectedList) return true;
  return connected.has(id)
    || id === 'opencode'
    || id === 'opencode-go';
}

function modelValues(provider) {
  if (Array.isArray(provider?.models)) return provider.models;
  if (provider?.models && typeof provider.models === 'object') {
    return Object.keys(provider.models).sort().map((key) => {
      const model = provider.models[key];
      if (!model || typeof model !== 'object' || Array.isArray(model)) return null;
      return { ...model, id: model.id || model.modelID || key };
    }).filter(Boolean);
  }
  return [];
}

function reasoningDefinition(model) {
  if (!model?.variants || typeof model.variants !== 'object') return null;
  const raw = Array.isArray(model.variants)
    ? model.variants.map((variant) => typeof variant === 'string' ? variant : variant?.id)
    : Object.keys(model.variants);
  const efforts = [...new Set(raw
    .map((effort) => String(effort || '').trim())
    .filter((effort) => effort && effort.length <= 40))]
    .sort((left, right) => {
      const leftIndex = REASONING_ORDER.indexOf(left);
      const rightIndex = REASONING_ORDER.indexOf(right);
      const normalizedLeft = leftIndex < 0 ? REASONING_ORDER.length : leftIndex;
      const normalizedRight = rightIndex < 0 ? REASONING_ORDER.length : rightIndex;
      return normalizedLeft - normalizedRight || left.localeCompare(right);
    });
  if (!efforts.length) return null;
  return { efforts, default: efforts.includes('medium') ? 'medium' : efforts[0] };
}

function booleanImageCapability(value) {
  if (Array.isArray(value)) {
    const normalized = value.filter((entry) => typeof entry === 'string').map((entry) => entry.toLowerCase());
    return normalized.length ? normalized.includes('image') : null;
  }
  if (!value || typeof value !== 'object') return null;
  if (typeof value.image === 'boolean') return value.image;
  return value.input == null ? null : booleanImageCapability(value.input);
}

function imageSupport(model) {
  const capabilities = model?.capabilities && typeof model.capabilities === 'object'
    ? model.capabilities
    : null;
  const capabilityInput = booleanImageCapability(capabilities?.input);
  if (capabilityInput !== null) return capabilityInput;
  if (typeof capabilities?.attachment === 'boolean') return capabilities.attachment;
  const modalities = booleanImageCapability(model?.modalities);
  if (modalities !== null) return modalities;
  const modalityInput = booleanImageCapability(model?.modalities?.input);
  if (modalityInput !== null) return modalityInput;
  return booleanImageCapability(model?.input);
}

export function modelsFromOpencodeCatalog(payload) {
  const root = catalogRoot(payload);
  const connectedValues = Array.isArray(root?.connected) ? root.connected : null;
  const connected = new Set((connectedValues || []).map((id) => String(id || '').trim()).filter(Boolean));
  const models = new Map();

  for (const provider of catalogProviders(root)) {
    if (!providerIsUsable(provider, connected, connectedValues !== null)) continue;
    const providerId = String(provider.id || '').trim();
    const providerName = String(provider.name || providerId).trim();
    for (const model of modelValues(provider)) {
      if (!model || model.enabled === false) continue;
      const modelId = String(model.id || model.modelID || '').trim();
      if (!modelId || modelId.length > 200) continue;
      const id = modelId.startsWith(`${providerId}/`) ? modelId : `${providerId}/${modelId}`;
      if (id.length > 200 || models.has(id) || isRetiredModelId('opencode', id)) continue;
      const name = String(model.name || model.label || modelId).trim();
      const definition = {
        id,
        label: providerName && providerName !== providerId ? `${name} · ${providerName}` : name
      };
      const reasoning = reasoningDefinition(model);
      if (reasoning) definition.reasoning = reasoning;
      const supportsImages = imageSupport(model);
      if (supportsImages !== null) definition.supportsImages = supportsImages;
      models.set(id, definition);
      if (models.size >= MAX_MODELS) return [...models.values()];
    }
  }
  return [...models.values()];
}

export async function fetchOpencodeModels({ baseUrl, headers = {}, fetchImpl = fetch, signal }) {
  let lastError = null;
  for (const path of ['/provider', '/config/providers']) {
    try {
      const response = await fetchImpl(`${String(baseUrl || '').replace(/\/+$/, '')}${path}`, {
        method: 'GET', cache: 'no-store', headers, signal
      });
      if (!response.ok) {
        lastError = new Error(`OpenCode model catalog returned HTTP ${response.status}.`);
        continue;
      }
      const models = modelsFromOpencodeCatalog(await response.json());
      if (models.length) return { models, path };
      lastError = new Error('OpenCode did not report any usable models.');
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      lastError = error;
    }
  }
  throw lastError || new Error('OpenCode model discovery is unavailable.');
}
