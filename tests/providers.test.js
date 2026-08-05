import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeSettings,
  modelId,
  modelLabel,
  modelReasoning,
  normalizeSiteKey,
  providerById,
  publicSettings,
  siteIsEnabled
} from '../packages/core/src/providers.js';

test('website access policies are normalized and exposed without secrets', () => {
  const settings = mergeSettings({
    disabledSites: ['Example.ORG', 'example.org', ' docs.example.org '],
    allowedSites: ['https://Learn.Example.org/path', 'learn.example.org'],
    siteAccessMode: 'allowlist',
    apiKeys: { openai: 'secret' }
  });
  assert.deepEqual(settings.disabledSites, ['docs.example.org', 'example.org']);
  assert.deepEqual(settings.allowedSites, ['learn.example.org']);
  assert.equal(siteIsEnabled(settings, 'https://learn.example.org/topic'), true);
  assert.equal(siteIsEnabled(settings, 'example.org'), false);
  const visible = publicSettings(settings);
  assert.deepEqual(visible.disabledSites, settings.disabledSites);
  assert.deepEqual(visible.allowedSites, settings.allowedSites);
  assert.equal(visible.siteAccessMode, 'allowlist');
  assert.equal('apiKeys' in visible, false);
  assert.equal(normalizeSiteKey('localhost:4173'), 'localhost');

  const recovered = mergeSettings({ provider: 'unknown', disabledSites: 'example.org' });
  assert.equal(recovered.provider, 'openai');
  assert.equal(recovered.siteAccessMode, 'blocklist');
  assert.deepEqual(recovered.disabledSites, []);
});

test('structured local model entries retain ids and friendly labels', () => {
  const model = providerById('codex').models[1];
  assert.equal(modelId(model), 'gpt-5.6-sol');
  assert.equal(modelLabel(model), 'GPT-5.6 Sol');
});

test('Codex local models expose and retain max reasoning effort', () => {
  assert.equal(modelReasoning('codex', 'gpt-5.5').efforts.includes('max'), true);
  assert.equal(modelReasoning('codex', 'gpt-5.6-terra').efforts.includes('max'), true);
  assert.equal(modelReasoning('codex', 'gpt-5.6-luna').efforts.includes('max'), true);

  const settings = mergeSettings({
    provider: 'codex',
    models: { codex: 'gpt-5.6-luna' },
    reasoningEfforts: { codex: 'max' }
  });
  assert.equal(settings.reasoningEfforts.codex, 'max');
});
