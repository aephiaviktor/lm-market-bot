'use strict';

const SENSITIVE_CONFIG_KEYS = Object.freeze([
  'AEPHIA_API_KEY',
  'RPC_URL',
  'RPC_URL_FALLBACK',
  'HOT_WALLET_SECRET',
]);
const REDACTED_VALUE = '••••••••';
const sensitiveKeySet = new Set(SENSITIVE_CONFIG_KEYS);

function splitSensitiveConfig(config = {}) {
  const publicConfig = {};
  const sensitiveConfig = {};
  for (const [key, value] of Object.entries(config || {})) {
    if (sensitiveKeySet.has(key)) sensitiveConfig[key] = String(value ?? '');
    else publicConfig[key] = value;
  }
  return { publicConfig, sensitiveConfig };
}

function redactConfigForRenderer(config = {}) {
  const redacted = { ...config };
  for (const key of SENSITIVE_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(redacted, key)) redacted[key] = '';
  }
  return redacted;
}

function getSensitiveConfigStatus(config = {}) {
  return Object.fromEntries(
    SENSITIVE_CONFIG_KEYS.map((key) => [key, Boolean(String(config[key] ?? '').trim())]),
  );
}

function mergeSensitiveConfig(stored = {}, submitted = {}) {
  const merged = {};
  for (const key of SENSITIVE_CONFIG_KEYS) {
    const previous = String(stored[key] ?? '');
    const next = String(submitted[key] ?? '');
    merged[key] = !next.trim() || next === REDACTED_VALUE ? previous : next;
  }
  return merged;
}

module.exports = {
  REDACTED_VALUE,
  SENSITIVE_CONFIG_KEYS,
  getSensitiveConfigStatus,
  mergeSensitiveConfig,
  redactConfigForRenderer,
  splitSensitiveConfig,
};
