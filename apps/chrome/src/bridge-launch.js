export const BRIDGE_LAUNCH_COOLDOWN_MS = 30_000;

export function bridgeLaunchDecision(previous, startUrl, now = Date.now(), cooldownMs = BRIDGE_LAUNCH_COOLDOWN_MS) {
  const url = String(startUrl || '').trim();
  if (!url) return { allowed: false, retryAfterMs: 0, state: previous || null };
  const launchedAt = previous?.url === url && Number.isFinite(previous?.launchedAt)
    ? previous.launchedAt
    : Number.NEGATIVE_INFINITY;
  const retryAfterMs = Math.max(0, cooldownMs - (now - launchedAt));
  return retryAfterMs > 0
    ? { allowed: false, retryAfterMs, state: previous }
    : { allowed: true, retryAfterMs: 0, state: { url, launchedAt: now } };
}
