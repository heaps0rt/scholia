export const MAX_PROVIDER_REASONING_CHARACTERS = 24_000;

function textFromReasoningPart(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFromReasoningPart).filter(Boolean).join('');
  if (!value || typeof value !== 'object') return '';
  for (const key of ['text', 'thinking', 'summary', 'reasoning_content']) {
    if (typeof value[key] === 'string') return value[key];
  }
  return textFromReasoningPart(value.content);
}

export function boundedProviderReasoning(value) {
  const clean = String(value || '').trim();
  return clean ? clean.slice(0, MAX_PROVIDER_REASONING_CHARACTERS) : '';
}

export function reasoningDeltaFromProviderEvent(data, {
  protocol = 'openai',
  responseProtocol = protocol
} = {}) {
  if (responseProtocol === 'openai-responses'
      && data?.type === 'response.reasoning_summary_text.delta') {
    return typeof data.delta === 'string' ? data.delta : '';
  }
  if (protocol === 'anthropic'
      && data?.type === 'content_block_delta'
      && data?.delta?.type === 'thinking_delta') {
    return typeof data.delta.thinking === 'string' ? data.delta.thinking : '';
  }
  if (protocol === 'ollama') {
    return textFromReasoningPart(data?.message?.thinking ?? data?.thinking);
  }
  const delta = data?.choices?.[0]?.delta;
  if (!delta || typeof delta !== 'object') return '';
  for (const key of ['reasoning_content', 'reasoning', 'reasoning_details']) {
    const text = textFromReasoningPart(delta[key]);
    if (text) return text;
  }
  return '';
}

export function reasoningFromProviderResponse(data, {
  protocol = 'openai',
  responseProtocol = protocol
} = {}) {
  if (responseProtocol === 'openai-responses') {
    const summary = (data?.output || [])
      .filter((item) => item?.type === 'reasoning')
      .flatMap((item) => item.summary || [])
      .filter((part) => part?.type === 'summary_text' || typeof part?.text === 'string')
      .map(textFromReasoningPart)
      .filter(Boolean)
      .join('\n\n');
    return boundedProviderReasoning(summary);
  }
  if (protocol === 'anthropic') {
    return boundedProviderReasoning((data?.content || [])
      .filter((part) => part?.type === 'thinking')
      .map((part) => part.thinking || '')
      .filter(Boolean)
      .join('\n\n'));
  }
  if (protocol === 'ollama') {
    return boundedProviderReasoning(data?.message?.thinking ?? data?.thinking);
  }
  const message = data?.choices?.[0]?.message;
  if (!message || typeof message !== 'object') return '';
  for (const key of ['reasoning_content', 'reasoning', 'reasoning_details']) {
    const text = boundedProviderReasoning(textFromReasoningPart(message[key]));
    if (text) return text;
  }
  return '';
}

export function reasoningFromOpencodeResponse(data) {
  return boundedProviderReasoning((data?.parts || [])
    .filter((part) => part?.type === 'reasoning')
    .map(textFromReasoningPart)
    .filter(Boolean)
    .join('\n\n'));
}
