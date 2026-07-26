import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSettings, modelId, modelLabel, providerById, publicSettings } from '../packages/core/src/providers.js';

test('per-site disable settings are normalized and exposed without secrets', () => {
  const settings = mergeSettings({
    disabledSites: ['Example.ORG', 'example.org', ' docs.example.org '],
    apiKeys: { openai: 'secret' }
  });
  assert.deepEqual(settings.disabledSites, ['example.org', 'docs.example.org']);
  const visible = publicSettings(settings);
  assert.deepEqual(visible.disabledSites, settings.disabledSites);
  assert.equal('apiKeys' in visible, false);

  const recovered = mergeSettings({ provider: 'unknown', disabledSites: 'example.org' });
  assert.equal(recovered.provider, 'openai');
  assert.deepEqual(recovered.disabledSites, []);
});

test('structured local model entries retain ids and friendly labels', () => {
  const model = providerById('codex').models[1];
  assert.equal(modelId(model), 'gpt-5.6-sol');
  assert.equal(modelLabel(model), 'GPT-5.6 Sol');
});
