import { modelReasoning, providerById, mergeSettings } from '../../../packages/core/src/providers.js';
import { initialUserPrompt, normalizeLanguage, sanitizeConversation, systemPrompt } from '../../../packages/core/src/prompt.js';

const opencodeSessions = new Map();

function endpointBase(endpoint) {
  const clean = String(endpoint || '').trim().replace(/\/+$/, '');
  return clean.replace(/\/v1\/chat\/completions$/i, '');
}

function endpointPort(endpoint, fallback) {
  try { return Number(new URL(endpoint).port) || fallback; } catch { return fallback; }
}

function basicAuthorization(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function bridgeHeaders(provider, settings) {
  const key = String(settings.apiKeys[provider.id] || '').trim();
  if (!key) return {};
  if (provider.protocol === 'opencode') return { authorization: basicAuthorization('opencode', key) };
  return { authorization: `Bearer ${key}` };
}

function bridgeInstructions(provider, endpoint) {
  const bridge = provider.localBridge;
  const fallbackPort = bridge.port;
  const port = endpointPort(endpoint, fallbackPort);
  let startUrl = `${bridge.startScheme}://start`;
  if (bridge.startPortParameter) startUrl += `?${bridge.startPortParameter}=${port}`;
  const command = `${bridge.command} --port ${port}`;
  const installCommand = bridge.installCommand ? `${bridge.installCommand} --port ${port}` : '';
  return { startUrl, command, installCommand, port };
}

export async function checkBridgeStatus(providerId, rawSettings, options = {}) {
  const settings = mergeSettings(rawSettings);
  const provider = providerById(providerId);
  if (!provider.localBridge) throw new Error(`${provider.name} does not use a local bridge.`);
  const endpoint = String(settings.endpoints[provider.id] || provider.endpoint).trim();
  const base = endpointBase(endpoint);
  const instructions = bridgeInstructions(provider, endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 1_800);
  const abortFromParent = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', abortFromParent, { once: true });
  }

  try {
    const response = await fetch(`${base}${provider.localBridge.healthPath}`, {
      method: 'GET',
      cache: 'no-store',
      headers: bridgeHeaders(provider, settings),
      signal: controller.signal
    });
    if (!response.ok) {
      return { up: false, provider: provider.id, label: provider.localBridge.label, base, ...instructions, error: `HTTP ${response.status}` };
    }
    const health = await response.json();
    const up = Boolean(health?.[provider.localBridge.healthField]);
    let usage = null;
    if (up && options.includeUsage && provider.localBridge.usagePath) {
      try {
        const usageResponse = await fetch(`${base}${provider.localBridge.usagePath}`, {
          method: 'GET', cache: 'no-store', headers: bridgeHeaders(provider, settings), signal: controller.signal
        });
        if (usageResponse.ok) usage = await usageResponse.json();
      } catch {}
    }
    return {
      up, provider: provider.id, label: provider.localBridge.label, base, health, usage,
      supportsImages: provider.supportsImages || Boolean(health?.images), ...instructions
    };
  } catch (error) {
    return {
      up: false, provider: provider.id, label: provider.localBridge.label, base, ...instructions,
      error: error?.name === 'AbortError' ? 'Connection timed out' : (error?.message || 'Bridge is unreachable')
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromParent);
  }
}

function imageParts(dataUrl) {
  if (!dataUrl) return null;
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) throw new Error('The captured image could not be encoded.');
  return { mediaType: match[1], base64: match[2].replace(/\s/g, '') };
}

function preparedConversation(payload, settings) {
  const language = normalizeLanguage(settings.language, payload.pageLanguage);
  const conversation = sanitizeConversation(payload.messages);
  if (!conversation.length || conversation[0].role !== 'user') {
    throw new Error('Nothing was provided to explain.');
  }

  const first = conversation[0];
  conversation[0] = {
    role: 'user',
    content: initialUserPrompt({
      question: first.content,
      selection: payload.selection,
      context: settings.includePageContext ? payload.context : '',
      pageTitle: payload.pageTitle,
      url: payload.url,
      kind: payload.kind,
      language
    })
  };

  return { language, conversation, image: imageParts(payload.imageDataUrl) };
}

function openAiMessages(prepared) {
  return [
    { role: 'system', content: systemPrompt(prepared.language) },
    ...prepared.conversation.map((message, index) => {
      if (index !== 0 || !prepared.image) return message;
      return {
        role: 'user',
        content: [
          { type: 'text', text: message.content },
          { type: 'image_url', image_url: { url: `data:${prepared.image.mediaType};base64,${prepared.image.base64}` } }
        ]
      };
    })
  ];
}

function anthropicMessages(prepared) {
  return prepared.conversation.map((message, index) => {
    if (index !== 0 || !prepared.image) return message;
    return {
      role: 'user',
      content: [
        { type: 'text', text: message.content },
        {
          type: 'image',
          source: { type: 'base64', media_type: prepared.image.mediaType, data: prepared.image.base64 }
        }
      ]
    };
  });
}

function ollamaMessages(prepared) {
  return [
    { role: 'system', content: systemPrompt(prepared.language) },
    ...prepared.conversation.map((message, index) => ({
      ...message,
      ...(index === 0 && prepared.image ? { images: [prepared.image.base64] } : {})
    }))
  ];
}

export function buildProviderRequest(payload, rawSettings) {
  const settings = mergeSettings(rawSettings);
  const providerId = payload.provider || settings.provider;
  const provider = providerById(providerId);
  const model = payload.model || settings.models[provider.id] || provider.defaultModel;
  const endpoint = String(settings.endpoints[provider.id] || provider.endpoint).trim();
  const key = String(settings.apiKeys[provider.id] || '').trim();
  const prepared = preparedConversation(payload, settings);

  if (!endpoint) throw new Error(`Set an endpoint for ${provider.name} in Scholia settings.`);
  if (provider.keyRequired && !key) throw new Error(`Add your ${provider.name} API key in Scholia settings.`);
  if (prepared.image && !provider.supportsImages && !payload.bridgeSupportsImages) {
    throw new Error(`${provider.name} cannot receive images. Choose a vision-capable provider.`);
  }

  const headers = { 'content-type': 'application/json' };
  let body;

  if (provider.protocol === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    body = {
      model,
      max_tokens: 1400,
      stream: true,
      system: systemPrompt(prepared.language),
      messages: anthropicMessages(prepared)
    };
  } else if (provider.protocol === 'ollama') {
    if (key) headers.authorization = `Bearer ${key}`;
    body = { model, stream: true, messages: ollamaMessages(prepared), options: { temperature: 0.25 } };
  } else if (provider.protocol === 'opencode') {
    return { provider, model, url: endpointBase(endpoint), prepared, key, fetchOptions: null };
  } else if (provider.protocol === 'cohere') {
    headers.authorization = `Bearer ${key}`;
    body = { model, stream: true, messages: openAiMessages(prepared), temperature: 0.25 };
  } else {
    if (key) headers.authorization = `Bearer ${key}`;
    body = {
      model,
      stream: true,
      messages: openAiMessages(prepared),
      temperature: 0.25
    };
    if (provider.id === 'claudecode' || provider.id === 'codex') {
      const reasoning = modelReasoning(provider, model);
      const effort = String(payload.reasoningEffort || settings.reasoningEfforts[provider.id] || reasoning?.default || '');
      if (reasoning?.efforts?.includes(effort)) body.reasoning_effort = effort;
    }
    if (provider.id === 'claudecode' && (payload.fastMode ?? settings.fastMode)) body.fast_mode = true;
  }

  return {
    provider,
    model,
    url: endpoint,
    fetchOptions: { method: 'POST', headers, body: JSON.stringify(body) }
  };
}

function responseError(response, raw) {
  let detail = raw;
  try {
    const parsed = JSON.parse(raw);
    detail = parsed.error?.message || parsed.message || raw;
  } catch {}
  const suffix = detail ? `: ${String(detail).slice(0, 500)}` : '';
  return new Error(`${response.status} ${response.statusText || 'Provider request failed'}${suffix}`);
}

function textFromOpenAiEvent(data) {
  const delta = data?.choices?.[0]?.delta?.content;
  if (typeof delta === 'string') return delta;
  if (Array.isArray(delta)) return delta.map((part) => part?.text || '').join('');
  return '';
}

function textFromAnthropicEvent(data) {
  if (data?.type === 'content_block_delta' && data?.delta?.type === 'text_delta') return data.delta.text || '';
  return '';
}

function textFromCohereEvent(data) {
  if (data?.type === 'content-delta') return data?.delta?.message?.content?.text || '';
  return '';
}

function textFromJsonResponse(provider, data) {
  if (provider.protocol === 'anthropic') {
    return (data?.content || []).map((part) => part?.text || '').join('');
  }
  if (provider.protocol === 'ollama') return data?.message?.content || data?.response || '';
  if (provider.protocol === 'cohere') return (data?.message?.content || []).map((part) => part?.text || '').join('');
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : (content || []).map((part) => part?.text || '').join('');
}

async function consumeSse(response, provider, onToken) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let complete = '';

  const processBlock = (block) => {
    const dataLines = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim());
    if (!dataLines.length) return;
    const raw = dataLines.join('\n');
    if (raw === '[DONE]') return;
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    if (data?.type === 'error' || data?.error) {
      throw new Error(data?.error?.message || data?.message || 'The provider stream reported an error.');
    }
    const token = provider.protocol === 'anthropic'
      ? textFromAnthropicEvent(data)
      : provider.protocol === 'cohere'
        ? textFromCohereEvent(data)
        : textFromOpenAiEvent(data);
    if (token) {
      complete += token;
      onToken(token);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';

    for (const block of blocks) processBlock(block);

    if (done) {
      if (buffer.trim()) processBlock(buffer);
      break;
    }
  }

  return complete;
}

async function consumeNdjson(response, onToken) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let complete = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let data;
      try { data = JSON.parse(line); } catch { continue; }
      const token = data?.message?.content || data?.response || '';
      if (token) {
        complete += token;
        onToken(token);
      }
    }
    if (done) break;
  }

  if (buffer.trim()) {
    try {
      const data = JSON.parse(buffer);
      const token = data?.message?.content || data?.response || '';
      if (token) { complete += token; onToken(token); }
    } catch {}
  }
  return complete;
}

function opencodeModel(model) {
  const separator = model.indexOf('/');
  if (separator < 0) return { providerID: '', modelID: model };
  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) };
}

function opencodeTranscript(prepared) {
  return [
    { role: 'system', content: systemPrompt(prepared.language) },
    ...prepared.conversation
  ].map((message) => {
    const role = message.role === 'assistant' ? 'Assistant' : message.role === 'system' ? 'System' : 'User';
    const content = typeof message.content === 'string'
      ? message.content
      : (message.content || []).map((part) => part?.type === 'text' ? part.text : '').filter(Boolean).join(' ');
    return `${role}:\n${content}`;
  }).join('\n\n');
}

function opencodeText(data) {
  const parts = Array.isArray(data?.parts) ? data.parts : [];
  const typed = parts.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('');
  if (typed) return typed;
  return parts.filter((part) => part?.type !== 'reasoning' && typeof part?.text === 'string').map((part) => part.text).join('');
}

function opencodeError(data) {
  const error = data?.info?.error;
  if (!error) return null;
  return new Error(`opencode: ${error?.data?.message || error?.message || error?.name || 'the model returned an error'}`);
}

function opencodeRelayFallback(model) {
  const separator = model.indexOf('/');
  if (separator < 0) return `opencode-go/${model}`;
  const prefix = model.slice(0, separator);
  if (prefix === 'opencode-go' || prefix === 'openrouter') return null;
  return `opencode-go/${model.slice(separator + 1)}`;
}

async function runOpencode(request, onToken, signal) {
  const { provider, prepared, model, url: base, key } = request;
  const headers = key ? { authorization: basicAuthorization('opencode', key) } : {};
  const cacheKey = `${base}\n${key ? 'authenticated' : 'anonymous'}`;
  let sessionId = opencodeSessions.get(cacheKey) || '';

  async function requestJson(path, init = {}) {
    let response;
    try {
      response = await fetch(`${base}${path}`, {
        ...init,
        headers: { ...(init.headers || {}), ...headers },
        signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new Error(`${provider.localBridge.label} is not reachable at ${base}. Start it and try again.`);
    }
    if (!response.ok) throw responseError(response, await response.text());
    return response.json();
  }

  async function session() {
    if (sessionId) return sessionId;
    const data = await requestJson('/session', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    });
    sessionId = String(data?.id || '');
    if (!sessionId) throw new Error('opencode did not return a session id.');
    opencodeSessions.set(cacheKey, sessionId);
    return sessionId;
  }

  const parts = [{ type: 'text', text: opencodeTranscript(prepared) }];
  if (prepared.image) {
    const extension = prepared.image.mediaType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    parts.push({
      type: 'file',
      mime: prepared.image.mediaType,
      url: `data:${prepared.image.mediaType};base64,${prepared.image.base64}`,
      filename: `scholia-capture.${extension}`
    });
  }

  async function send(id, chosenModel) {
    return requestJson(`/session/${encodeURIComponent(id)}/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: opencodeModel(chosenModel), parts })
    });
  }

  const rewritten = opencodeRelayFallback(model);
  const primary = rewritten || model;
  const fallback = rewritten ? model : '';
  async function attempt(id) {
    try {
      const data = await send(id, primary);
      if (opencodeError(data) && fallback) return send(id, fallback);
      return data;
    } catch (error) {
      if (!fallback) throw error;
      return send(id, fallback);
    }
  }

  let data;
  try {
    data = await attempt(await session());
  } catch (error) {
    if (sessionId && /session|404/i.test(error?.message || '')) {
      opencodeSessions.delete(cacheKey);
      sessionId = '';
      data = await attempt(await session());
    } else {
      throw error;
    }
  }
  const providerError = opencodeError(data);
  if (providerError) throw providerError;
  const text = opencodeText(data);
  if (!text.trim()) throw new Error('opencode returned an empty response. Try a different model.');
  onToken(text);
  return { text, provider: provider.id, model };
}

export async function runCompletion(payload, settings, onToken = () => {}, signal) {
  const merged = mergeSettings(settings);
  const provider = providerById(payload.provider || merged.provider);
  let effectivePayload = payload;
  if (payload.imageDataUrl && provider.imageCapability === 'bridge-health') {
    const status = await checkBridgeStatus(provider.id, merged, { signal });
    if (!status.up) throw new Error(`${provider.localBridge.label} is offline. Start it before sending this image.`);
    if (!status.supportsImages) throw new Error(`Restart ${provider.localBridge.label} with --allow-images to send screen captures.`);
    effectivePayload = { ...payload, bridgeSupportsImages: true };
  }
  const request = buildProviderRequest(effectivePayload, merged);
  if (request.provider.protocol === 'opencode') return runOpencode(request, onToken, signal);

  let response;
  try {
    response = await fetch(request.url, { ...request.fetchOptions, signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    if (request.provider.localBridge) {
      throw new Error(`${request.provider.localBridge.label} is not reachable. Start it and try again.`);
    }
    throw error;
  }
  if (!response.ok) throw responseError(response, await response.text());

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const text = textFromJsonResponse(request.provider, await response.json());
    if (!text.trim()) throw new Error(`${request.provider.name} returned an empty response.`);
    if (text) onToken(text);
    return { text, provider: request.provider.id, model: request.model };
  }

  const text = request.provider.protocol === 'ollama'
    ? await consumeNdjson(response, onToken)
    : await consumeSse(response, request.provider, onToken);

  if (!text.trim()) throw new Error(`${request.provider.name} returned an empty response.`);
  return { text, provider: request.provider.id, model: request.model };
}
