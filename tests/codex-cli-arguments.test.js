import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexExecArguments } from '../scripts/lib/codex-cli-arguments.mjs';

test('Codex Fast mode selects the fast service tier for an ephemeral read-only execution', () => {
  const args = buildCodexExecArguments({
    model: 'gpt-5.6-sol',
    effort: 'medium',
    fastMode: true
  });
  assert.deepEqual(args.slice(-4), ['--config', 'service_tier="fast"', '--enable', 'fast_mode']);
  assert.ok(args.includes('model_reasoning_effort="medium"'));
  assert.ok(args.includes('model_verbosity="low"'));
  assert.ok(args.includes('model_reasoning_summary="auto"'));
  assert.ok(args.includes('hide_agent_reasoning=false'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('read-only'));
});

test('Codex standard mode does not force a service tier and retains image arguments', () => {
  const args = buildCodexExecArguments({
    model: 'gpt-5.5',
    effort: 'high',
    imagePaths: ['/tmp/example.png']
  });
  assert.equal(args.some((argument) => argument.includes('service_tier')), false);
  assert.deepEqual(args.slice(-2), ['--image', '/tmp/example.png']);
});

test('Codex web search uses the top-level live-search flag before exec', () => {
  const args = buildCodexExecArguments({
    model: 'gpt-5.6-sol',
    effort: 'high',
    webSearch: true
  });
  assert.deepEqual(args.slice(0, 2), ['--search', 'exec']);
});
