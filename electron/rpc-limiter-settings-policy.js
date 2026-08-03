'use strict';

function resolveProviderRole(value) {
  return value === 'fallback' ? 'fallback' : 'main';
}

function parsePositiveRate(value, fieldName) {
  const parsed = Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }
  return parsed;
}

function parseRpcLimiterUrl(rawValue) {
  const url = new URL(String(rawValue ?? '').trim());
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('RPC URL must use http or https.');
  }
  const apiKey = url.searchParams.get('api-key') || '';
  url.searchParams.delete('api-key');
  const remainingQuery = url.searchParams.toString();
  const pathname = url.pathname === '/' ? '' : url.pathname;
  return {
    rpcBaseUrl: `${url.origin}${pathname}${remainingQuery ? `?${remainingQuery}` : ''}`,
    apiKey,
  };
}

function ensureProviders(state) {
  state.providers = state.providers && typeof state.providers === 'object'
    ? state.providers
    : {};
  state.providers.main = state.providers.main && typeof state.providers.main === 'object'
    ? state.providers.main
    : {};
  state.providers.fallback = state.providers.fallback && typeof state.providers.fallback === 'object'
    ? state.providers.fallback
    : {};
}

function resolveLimiterConnectionUrls(providers) {
  const mainUrl = String(providers?.main?.url ?? '').trim();
  const fallbackUrl = String(providers?.fallback?.url ?? '').trim();
  if (!mainUrl && !fallbackUrl) {
    throw new Error('Use RPC Limiter is enabled, but no RPC Limiter URLs are configured. Send settings to RPC Limiter first.');
  }
  return {
    rpcUrl: mainUrl || fallbackUrl,
    rpcUrlFallback: mainUrl && fallbackUrl ? fallbackUrl : '',
  };
}

function applyRpcLimiterSettings(state, input) {
  const role = resolveProviderRole(input?.providerRole);
  const rawRpcUrl = String(input?.rpcUrl ?? '').trim();
  const clearing = rawRpcUrl.length === 0;

  let parsedUrl;
  let rpcIntervalMs;
  let txIntervalMs;
  if (!clearing) {
    parsedUrl = parseRpcLimiterUrl(rawRpcUrl);
    const rpcRequestsPerSecond = parsePositiveRate(input?.rpcRequestsPerSecond, 'Requests / sec');
    const txRequestsPerSecond = parsePositiveRate(input?.txRequestsPerSecond, 'sendTransaction / sec');
    rpcIntervalMs = Math.max(1, Math.round(1000 / rpcRequestsPerSecond));
    txIntervalMs = Math.max(1, Math.round(1000 / txRequestsPerSecond));
  }

  ensureProviders(state);
  if (clearing) {
    state.providers[role] = {};
    if (role === 'main') {
      delete state.rpcBaseUrl;
      delete state.apiKey;
    }
    state.enabled = Boolean(
      state.providers.main?.rpcBaseUrl
      || state.providers.fallback?.rpcBaseUrl,
    );
    return { role, action: 'cleared' };
  }

  state.providers[role] = {
    ...state.providers[role],
    ...parsedUrl,
    failures: 0,
    cooldownUntilMs: null,
  };
  state.buckets = state.buckets && typeof state.buckets === 'object' ? state.buckets : {};
  state.buckets['rpc:shared'] = {
    ...(state.buckets['rpc:shared'] || { nextSlotMs: 0 }),
    intervalMs: rpcIntervalMs,
  };
  state.buckets['tx:shared'] = {
    ...(state.buckets['tx:shared'] || { nextSlotMs: 0 }),
    intervalMs: txIntervalMs,
  };
  state.enabled = true;
  return { role, action: 'updated' };
}

module.exports = {
  applyRpcLimiterSettings,
  parsePositiveRate,
  parseRpcLimiterUrl,
  resolveLimiterConnectionUrls,
  resolveProviderRole,
};
