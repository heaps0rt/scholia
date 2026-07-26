export const SETTINGS_KEY = 'scholia.settings.v1';
const DEFAULT_PROVIDER_ID = 'openai';

const CLAUDE_REASONING_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
const CODEX_REASONING_EFFORTS = Object.freeze(['minimal', 'low', 'medium', 'high', 'xhigh']);

function reasoningModel(id, label, efforts, defaultEffort) {
  return { id, label, reasoning: { efforts, default: defaultEffort } };
}

export const PROVIDERS = Object.freeze([
  {
    id: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    keyRequired: true,
    keyHint: 'sk-ant-…',
    supportsImages: true,
    defaultModel: 'claude-sonnet-4-6',
    models: [
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001'
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'openai',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    keyRequired: true,
    keyHint: 'sk-…',
    supportsImages: true,
    defaultModel: 'gpt-5-mini',
    models: ['gpt-5.5', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini', 'o3', 'o4-mini']
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    keyRequired: true,
    keyHint: 'sk-or-…',
    supportsImages: true,
    defaultModel: 'anthropic/claude-sonnet-4.6',
    models: [
      'anthropic/claude-opus-4.8',
      'anthropic/claude-sonnet-4.6',
      'openai/gpt-5.5',
      'openai/gpt-5-mini',
      'openai/gpt-oss-20b:free',
      'google/gemini-3.5-flash',
      'google/gemini-2.5-pro',
      'deepseek/deepseek-v4-pro'
    ]
  },
  {
    id: 'groq',
    name: 'Groq',
    protocol: 'openai',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    keyRequired: true,
    keyHint: 'gsk_…',
    supportsImages: true,
    defaultModel: 'meta-llama/llama-4-maverick-17b-128e-instruct',
    models: [
      'meta-llama/llama-4-maverick-17b-128e-instruct',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'llama-3.3-70b-versatile',
      'openai/gpt-oss-120b'
    ]
  },
  {
    id: 'together',
    name: 'Together AI',
    protocol: 'openai',
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    keyRequired: true,
    keyHint: 'Together API key',
    supportsImages: true,
    defaultModel: 'deepseek-ai/DeepSeek-V3.1',
    models: [
      'deepseek-ai/DeepSeek-V3.1',
      'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
      'Qwen/Qwen3-235B-A22B-Instruct-2507-tput'
    ]
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    protocol: 'openai',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    keyRequired: true,
    keyHint: 'Mistral API key',
    supportsImages: true,
    defaultModel: 'mistral-large-latest',
    models: ['magistral-medium-latest', 'mistral-large-latest', 'mistral-small-latest', 'codestral-latest']
  },
  {
    id: 'cohere',
    name: 'Cohere',
    protocol: 'cohere',
    endpoint: 'https://api.cohere.com/v2/chat',
    keyRequired: true,
    keyHint: 'Cohere API key',
    supportsImages: false,
    defaultModel: 'command-a-03-2025',
    models: ['command-a-03-2025', 'command-r-plus-08-2024', 'command-r-08-2024']
  },
  {
    id: 'claudecode',
    name: 'Claude Code (local)',
    protocol: 'openai',
    endpoint: 'http://127.0.0.1:8787/v1/chat/completions',
    keyRequired: false,
    keyHint: 'Optional bridge bearer token',
    supportsImages: false,
    imageCapability: 'bridge-health',
    defaultModel: 'sonnet',
    models: [
      reasoningModel('fable', 'Fable 5 (Claude Code)', CLAUDE_REASONING_EFFORTS, 'high'),
      reasoningModel('opus', 'Opus 4.8 (Claude Code)', CLAUDE_REASONING_EFFORTS, 'high'),
      reasoningModel('sonnet', 'Sonnet 4.6 (Claude Code)', CLAUDE_REASONING_EFFORTS, 'high'),
      reasoningModel('haiku', 'Haiku 4.5 (Claude Code)', CLAUDE_REASONING_EFFORTS, 'medium')
    ],
    localBridge: {
      label: 'Claude Code bridge',
      port: 8787,
      healthPath: '/health',
      usagePath: '/v1/usage',
      healthField: 'ok',
      startScheme: 'claudecode',
      startPortParameter: 'port',
      command: 'node scripts/claude-code-bridge.mjs',
      installCommand: 'node scripts/install-claude-handler.mjs'
    }
  },
  {
    id: 'codex',
    name: 'Codex CLI (local)',
    protocol: 'openai',
    endpoint: 'http://127.0.0.1:8789/v1/chat/completions',
    keyRequired: false,
    keyHint: 'Optional bridge bearer token',
    supportsImages: false,
    defaultModel: 'gpt-5.5',
    models: [
      reasoningModel('gpt-5.5', 'GPT-5.5', CODEX_REASONING_EFFORTS, 'high'),
      reasoningModel('gpt-5.6-sol', 'GPT-5.6 Sol', ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'medium'),
      reasoningModel('gpt-5.6-terra', 'GPT-5.6 Terra', CODEX_REASONING_EFFORTS, 'high'),
      reasoningModel('gpt-5.6-luna', 'GPT-5.6 Luna', ['minimal', 'low', 'medium', 'high'], 'medium'),
      reasoningModel('gpt-5.4', 'GPT-5.4', CODEX_REASONING_EFFORTS, 'high'),
      reasoningModel('gpt-5.4-mini', 'GPT-5.4 Mini', ['minimal', 'low', 'medium', 'high'], 'medium')
    ],
    localBridge: {
      label: 'Codex bridge',
      port: 8789,
      healthPath: '/health',
      usagePath: '/v1/usage',
      healthField: 'ok',
      startScheme: 'codexbridge',
      command: 'node scripts/codex-bridge.mjs',
      installCommand: 'node scripts/install-codex-handler.mjs'
    }
  },
  {
    id: 'opencode',
    name: 'opencode (local server)',
    protocol: 'opencode',
    endpoint: 'http://127.0.0.1:4096',
    keyRequired: false,
    keyHint: 'Optional opencode server password',
    supportsImages: true,
    defaultModel: 'opencode-go/deepseek-v4-pro',
    models: [
      { id: 'opencode-go/deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      { id: 'opencode-go/qwen3.7-max', label: 'Qwen3.7 Max' },
      { id: 'opencode-go/minimax-m3', label: 'MiniMax M3' },
      { id: 'opencode-go/glm-5.2', label: 'GLM 5.2' },
      { id: 'opencode-go/kimi-k2.7-code', label: 'Kimi K2.7 Code' },
      { id: 'opencode-go/kimi-k2.6', label: 'Kimi K2.6' },
      { id: 'opencode-go/minimax-m2.7', label: 'MiniMax M2.7' },
      { id: 'opencode-go/glm-5.1', label: 'GLM 5.1' },
      { id: 'opencode-go/deepseek-v4-flash', label: 'DeepSeek V4 Flash' }
    ],
    localBridge: {
      label: 'opencode server',
      port: 4096,
      healthPath: '/global/health',
      healthField: 'healthy',
      startScheme: 'opencode',
      command: 'opencode serve',
      installCommand: 'node scripts/install-opencode-handler.mjs'
    }
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    protocol: 'ollama',
    endpoint: 'http://127.0.0.1:11434/api/chat',
    keyRequired: false,
    keyHint: '',
    supportsImages: true,
    defaultModel: 'qwen3:8b',
    models: ['qwen3:8b', 'gemma3:12b', 'llama3.2-vision:11b', 'llama3.2:3b']
  },
  {
    id: 'custom',
    name: 'Custom compatible endpoint',
    protocol: 'openai',
    endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
    keyRequired: false,
    keyHint: 'Optional bearer token',
    supportsImages: true,
    defaultModel: 'default',
    models: ['default']
  }
]);

export const DEFAULT_SETTINGS = Object.freeze({
  provider: DEFAULT_PROVIDER_ID,
  language: 'auto',
  models: Object.fromEntries(PROVIDERS.map((provider) => [provider.id, provider.defaultModel])),
  endpoints: Object.fromEntries(PROVIDERS.map((provider) => [provider.id, provider.endpoint])),
  apiKeys: {},
  customModels: {},
  reasoningEfforts: {
    claudecode: 'high',
    codex: 'high'
  },
  fastMode: false,
  includePageContext: true,
  explainOnSelection: true,
  disabledSites: []
});

const PROVIDERS_BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export function providerById(id) {
  return PROVIDERS_BY_ID.get(id) || PROVIDERS_BY_ID.get(DEFAULT_PROVIDER_ID);
}

export function modelId(model) {
  return typeof model === 'string' ? model : String(model?.id || '');
}

export function modelLabel(model) {
  return typeof model === 'string' ? model : String(model?.label || model?.id || '');
}

export function modelDefinition(providerOrId, id) {
  const provider = typeof providerOrId === 'string' ? providerById(providerOrId) : providerOrId;
  return provider?.models?.find((model) => modelId(model) === id) || null;
}

export function modelReasoning(providerOrId, id) {
  return modelDefinition(providerOrId, id)?.reasoning || null;
}

export function mergeSettings(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const provider = providerById(source.provider || DEFAULT_SETTINGS.provider);
  const models = {};
  const endpoints = {};
  const apiKeys = {};
  const customModels = {};
  const reasoningEfforts = {};

  for (const definition of PROVIDERS) {
    const selectedModel = String(source.models?.[definition.id] || definition.defaultModel).trim();
    models[definition.id] = selectedModel && selectedModel.length <= 200
      ? selectedModel
      : definition.defaultModel;
    endpoints[definition.id] = String(source.endpoints?.[definition.id] ?? definition.endpoint)
      .trim()
      .slice(0, 2_048);
    const key = String(source.apiKeys?.[definition.id] || '').trim();
    if (key) apiKeys[definition.id] = key;
    const custom = Array.isArray(source.customModels?.[definition.id])
      ? source.customModels[definition.id]
        .map((model) => String(model).trim())
        .filter((model) => model && model.length <= 200)
      : [];
    if (custom.length) customModels[definition.id] = [...new Set(custom)];

    const reasoning = modelReasoning(definition, models[definition.id]);
    if (reasoning) {
      const requested = String(source.reasoningEfforts?.[definition.id] || '');
      reasoningEfforts[definition.id] = reasoning.efforts.includes(requested)
        ? requested
        : reasoning.default;
    }
  }

  const disabledSource = Array.isArray(source.disabledSites)
    ? source.disabledSites
    : Array.isArray(source.disabledHosts) ? source.disabledHosts : [];
  return {
    provider: provider.id,
    language: ['auto', 'en', 'no'].includes(source.language) ? source.language : DEFAULT_SETTINGS.language,
    models,
    endpoints,
    apiKeys,
    customModels,
    reasoningEfforts,
    fastMode: source.fastMode === true,
    includePageContext: source.includePageContext !== false,
    explainOnSelection: source.explainOnSelection !== false,
    disabledSites: [...new Set(disabledSource
      .map((site) => String(site).trim().toLowerCase())
      .filter(Boolean))]
  };
}

export function publicSettings(settings) {
  const merged = mergeSettings(settings);
  return {
    provider: merged.provider,
    language: merged.language,
    models: merged.models,
    customModels: merged.customModels,
    reasoningEfforts: merged.reasoningEfforts,
    fastMode: merged.fastMode,
    includePageContext: merged.includePageContext,
    explainOnSelection: merged.explainOnSelection,
    disabledSites: merged.disabledSites,
    configuredProviders: PROVIDERS.filter((provider) => !provider.keyRequired || Boolean(merged.apiKeys[provider.id])).map((provider) => provider.id)
  };
}
