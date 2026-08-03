'use strict';

const MAX_ASSETS = 250;
const MAX_ASSET_LENGTH = 128;
const MAX_DEFAULT_CONFIG_LENGTH = 512;
const MAX_URL_LENGTH = 4096;
const MAX_SECRET_LENGTH = 50_000;
const MAX_RESOURCE_LIST_LENGTH = 100_000;
const ASSET_RULE_KEYS = new Set([
  'asset', 'starbase', 'side', 'quantity', 'limit', 'price', 'group', 'enabled', 'refill',
  'minQuantity', 'maxQuantity', 'minBuyPrice', 'maxBuyPrice', 'minSellPrice', 'maxSellPrice',
]);

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function assertKnownKeys(value, allowedKeys, label) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new TypeError(`Unknown ${label} field: ${key}`);
  }
}

function configValueLimit(key) {
  if (key === 'RESOURCE_LIST') return MAX_RESOURCE_LIST_LENGTH;
  if (key === 'HOT_WALLET_SECRET' || key === 'AEPHIA_API_KEY') return MAX_SECRET_LENGTH;
  if (key === 'RPC_URL' || key === 'RPC_URL_FALLBACK') return MAX_URL_LENGTH;
  return MAX_DEFAULT_CONFIG_LENGTH;
}

function validateAssetRule(row, index) {
  assertPlainObject(row, `assetRules[${index}]`);
  assertKnownKeys(row, ASSET_RULE_KEYS, `assetRules[${index}]`);
  const validated = {};
  for (const [key, value] of Object.entries(row)) {
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new TypeError(`assetRules[${index}].${key} has an invalid type.`);
    }
    if (String(value).length > 256) throw new RangeError(`assetRules[${index}].${key} is too long.`);
    validated[key] = value;
  }
  return validated;
}

function validateSettingsPayload(payload, editableConfigKeys, options = {}) {
  assertPlainObject(payload, 'settings payload');
  const allowedPayloadKeys = new Set(options.allowAssetRules === false ? ['config'] : ['config', 'assetRules']);
  if (options.allowProviderRole === true) allowedPayloadKeys.add('providerRole');
  assertKnownKeys(payload, allowedPayloadKeys, 'settings payload');
  const config = payload.config ?? {};
  assertPlainObject(config, 'config');
  const allowedConfigKeys = new Set(editableConfigKeys);
  assertKnownKeys(config, allowedConfigKeys, 'settings');

  const validatedConfig = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string') throw new TypeError(`${key} must be a string.`);
    if (value.length > configValueLimit(key)) throw new RangeError(`${key} is too long.`);
    validatedConfig[key] = value;
  }

  const validated = { config: validatedConfig };
  if (options.allowProviderRole === true && Object.prototype.hasOwnProperty.call(payload, 'providerRole')) {
    if (typeof payload.providerRole !== 'string') throw new TypeError('providerRole must be a string.');
    if (payload.providerRole.length > 32) throw new RangeError('providerRole is too long.');
    validated.providerRole = payload.providerRole;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'assetRules')) {
    if (!Array.isArray(payload.assetRules)) throw new TypeError('assetRules must be an array.');
    if (payload.assetRules.length > MAX_ASSETS) throw new RangeError(`assetRules exceeds ${MAX_ASSETS} entries.`);
    validated.assetRules = payload.assetRules.map(validateAssetRule);
  }
  return validated;
}

function validateAssetAndSide(payload) {
  assertPlainObject(payload, 'cancel-order payload');
  assertKnownKeys(payload, new Set(['asset', 'starbase', 'side']), 'cancel-order');
  const asset = typeof payload.asset === 'string' ? payload.asset.trim() : '';
  const starbase = typeof payload.starbase === 'string' ? payload.starbase.trim() : '';
  if (!asset) throw new TypeError('asset is required.');
  if (!starbase) throw new TypeError('starbase is required.');
  if (asset.length > MAX_ASSET_LENGTH) throw new RangeError('asset is too long.');
  if (payload.side !== 'buy' && payload.side !== 'sell') throw new TypeError('side must be buy or sell.');
  return { asset, starbase, side: payload.side };
}

function validateAssetList(assets) {
  if (!Array.isArray(assets)) throw new TypeError('assets must be an array.');
  if (assets.length > MAX_ASSETS) throw new RangeError(`assets exceeds ${MAX_ASSETS} entries.`);
  return assets.map((asset) => {
    if (typeof asset !== 'string') throw new TypeError('asset must be a string.');
    const normalized = asset.trim();
    if (!normalized) throw new TypeError('asset is required.');
    if (normalized.length > MAX_ASSET_LENGTH) throw new RangeError('asset is too long.');
    return normalized;
  });
}

function validateAssetsPayload(payload) {
  assertPlainObject(payload, 'assets payload');
  assertKnownKeys(payload, new Set(['assets']), 'assets payload');
  return { assets: validateAssetList(payload.assets ?? []) };
}

function validateRedeemPayload(payload) {
  assertPlainObject(payload, 'redeem-certificate payload');
  assertKnownKeys(payload, new Set(['asset', 'starbase']), 'redeem-certificate');
  const asset = typeof payload.asset === 'string' ? payload.asset.trim() : '';
  const starbase = typeof payload.starbase === 'string' ? payload.starbase.trim() : '';
  if (!asset) throw new TypeError('asset is required.');
  if (asset.length > MAX_ASSET_LENGTH || starbase.length > MAX_ASSET_LENGTH) {
    throw new RangeError('redeem-certificate field is too long.');
  }
  return { asset, starbase };
}

function isTrustedIpcEvent(event, expectedWebContents) {
  return Boolean(
    expectedWebContents
    && event?.sender === expectedWebContents
    && event?.senderFrame === expectedWebContents.mainFrame,
  );
}

module.exports = {
  isTrustedIpcEvent,
  validateAssetAndSide,
  validateAssetList,
  validateAssetsPayload,
  validateRedeemPayload,
  validateSettingsPayload,
};
