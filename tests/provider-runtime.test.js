import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, mergeSettings } from '../packages/core/src/providers.js';
import { buildProviderRequest, checkBridgeStatus, runCompletion } from '../apps/chrome/src/provider-runtime.js';

const basePayload = {
  messages: [{ role: 'user', content: 'Explain this.' }],
  selection: '$x^2$',
  kind: 'latex',
  pageLanguage: 'en'
};

test('OpenAI-compatible request keeps the system prompt outside page content', () => {
  const settings = mergeSettings({ apiKeys: { openai: 'secret' } });
  const request = buildProviderRequest({
    ...basePayload,
    provider: 'openai',
    model: 'gpt-5-mini',
    parentContext: 'The parent answer defined the variable.'
  }, settings);
  const body = JSON.parse(request.fetchOptions.body);
  assert.equal(request.fetchOptions.headers.authorization, 'Bearer secret');
  assert.equal(body.messages[0].role, 'system');
  assert.match(body.messages[1].content, /<scholia-selection>/);
  assert.match(body.messages[1].content, /<scholia-parent-context>/);
  assert.equal(body.stream, true);
});

test('Anthropic image request uses base64 source blocks', () => {
  const settings = mergeSettings({ apiKeys: { anthropic: 'secret' } });
  const request = buildProviderRequest({
    ...basePayload,
    provider: 'anthropic',
    imageDataUrl: 'data:image/png;base64,aGVsbG8='
  }, settings);
  const body = JSON.parse(request.fetchOptions.body);
  assert.equal(body.messages[0].content[1].type, 'image');
  assert.equal(body.messages[0].content[1].source.media_type, 'image/png');
});

test('missing hosted-provider key fails before network access', () => {
  assert.throws(() => buildProviderRequest({ ...basePayload, provider: 'openai' }, DEFAULT_SETTINGS), /Add your OpenAI API key/);
});

test('text-only provider rejects screenshots', () => {
  const settings = mergeSettings({ apiKeys: { cohere: 'secret' } });
  assert.throws(() => buildProviderRequest({
    ...basePayload,
    provider: 'cohere',
    imageDataUrl: 'data:image/jpeg;base64,aGVsbG8='
  }, settings), /cannot receive images/);
});

test('OpenAI-compatible SSE is assembled token by token', async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n'
  ];
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    }
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });

  try {
    const tokens = [];
    const settings = mergeSettings({ apiKeys: { openai: 'secret' } });
    const result = await runCompletion({ ...basePayload, provider: 'openai' }, settings, (token) => tokens.push(token));
    assert.equal(result.text, 'Hello');
    assert.deepEqual(tokens, ['Hel', 'lo']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Ollama NDJSON stream is assembled', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    '{"message":{"content":"Local "}}\n{"message":{"content":"answer"},"done":true}\n',
    { status: 200, headers: { 'content-type': 'application/x-ndjson' } }
  );

  try {
    const settings = mergeSettings({ provider: 'ollama' });
    const result = await runCompletion({ ...basePayload, provider: 'ollama' }, settings);
    assert.equal(result.text, 'Local answer');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Codex bridge receives the selected model and raw reasoning effort', () => {
  const settings = mergeSettings({
    provider: 'codex',
    models: { codex: 'gpt-5.6-sol' },
    reasoningEfforts: { codex: 'ultra' }
  });
  const request = buildProviderRequest({ ...basePayload, provider: 'codex', model: 'gpt-5.6-sol' }, settings);
  const body = JSON.parse(request.fetchOptions.body);
  assert.equal(request.url, 'http://127.0.0.1:8789/v1/chat/completions');
  assert.equal(body.model, 'gpt-5.6-sol');
  assert.equal(body.reasoning_effort, 'ultra');
  assert.equal(request.fetchOptions.headers.authorization, undefined);
});

test('Claude Code bridge receives fast mode and a supported reasoning effort', () => {
  const settings = mergeSettings({ provider: 'claudecode', fastMode: true, reasoningEfforts: { claudecode: 'xhigh' } });
  const request = buildProviderRequest({ ...basePayload, provider: 'claudecode', model: 'sonnet' }, settings);
  const body = JSON.parse(request.fetchOptions.body);
  assert.equal(body.reasoning_effort, 'xhigh');
  assert.equal(body.fast_mode, true);
});

test('OpenRouter keeps an exact custom free-model id', () => {
  const settings = mergeSettings({ apiKeys: { openrouter: 'secret' } });
  const request = buildProviderRequest({ ...basePayload, provider: 'openrouter', model: 'openai/gpt-oss-20b:free' }, settings);
  assert.equal(JSON.parse(request.fetchOptions.body).model, 'openai/gpt-oss-20b:free');
});

test('opencode creates a native session and sends image file parts', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/session')) return Response.json({ id: 'session-test' });
    return Response.json({ parts: [{ type: 'reasoning', text: 'hidden' }, { type: 'text', text: 'Visible answer' }] });
  };
  try {
    const settings = mergeSettings({ provider: 'opencode', endpoints: { opencode: 'http://127.0.0.1:4196' } });
    const result = await runCompletion({
      ...basePayload,
      provider: 'opencode',
      imageDataUrl: 'data:image/png;base64,aGVsbG8='
    }, settings);
    assert.equal(result.text, 'Visible answer');
    assert.equal(requests[0].url, 'http://127.0.0.1:4196/session');
    const messageBody = JSON.parse(requests[1].options.body);
    assert.deepEqual(messageBody.model, { providerID: 'opencode-go', modelID: 'deepseek-v4-pro' });
    assert.equal(messageBody.parts[1].type, 'file');
    assert.equal(messageBody.parts[1].mime, 'image/png');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bridge health uses the folk-compatible health endpoint and capability response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'http://127.0.0.1:8787/health');
    return Response.json({ ok: true, service: 'claude-code-bridge', images: true });
  };
  try {
    const status = await checkBridgeStatus('claudecode', mergeSettings());
    assert.equal(status.up, true);
    assert.equal(status.supportsImages, true);
    assert.equal(status.startUrl, 'claudecode://start?port=8787');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
