export function buildCodexExecArguments({ model, effort, fastMode = false, webSearch = false, imagePaths = [] }) {
  const argumentsList = [
    ...(webSearch ? ['--search'] : []),
    'exec',
    '-',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--skip-git-repo-check',
    '--ignore-rules',
    '--color',
    'never',
    '--sandbox',
    'read-only',
    '--model',
    model,
    '--config',
    `model_reasoning_effort="${effort}"`,
    '--config',
    'model_verbosity="low"',
    '--config',
    'model_reasoning_summary="auto"',
    '--config',
    'hide_agent_reasoning=false'
  ];
  if (fastMode) {
    argumentsList.push('--config', 'service_tier="fast"', '--enable', 'fast_mode');
  }
  if (imagePaths.length) argumentsList.push('--image', ...imagePaths);
  return argumentsList;
}
