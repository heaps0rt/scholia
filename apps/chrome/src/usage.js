function remainingPercent(usedPercent) {
  const used = Number(usedPercent);
  return Number.isFinite(used) ? `${Math.max(0, 100 - used)}% left` : '';
}

export function formatUsageRemaining(usage) {
  const limits = usage?.rateLimits || Object.values(usage?.rateLimitsByLimitId || {})[0];
  const windows = [limits?.primary, limits?.secondary].filter(Boolean);
  if (windows.length) {
    return windows.map((window) => remainingPercent(window.usedPercent)).filter(Boolean).join(' · ');
  }
  return remainingPercent(usage?.session?.percent);
}
