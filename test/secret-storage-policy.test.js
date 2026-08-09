'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  REDACTED_VALUE,
  getSensitiveConfigStatus,
  mergeSensitiveConfig,
  redactConfigForRenderer,
  splitSensitiveConfig,
} = require('../electron/secret-storage-policy');

test('sensitive settings are split out of public settings', () => {
  const { publicConfig, sensitiveConfig } = splitSensitiveConfig({
    RPC_URL: 'https://rpc.example/?api-key=secret',
    HOT_WALLET_SECRET: '[1,2,3]',
    FACTION: 'MUD',
  });
  assert.deepEqual(publicConfig, { FACTION: 'MUD' });
  assert.deepEqual(sensitiveConfig, {
    RPC_URL: 'https://rpc.example/?api-key=secret',
    HOT_WALLET_SECRET: '[1,2,3]',
  });
});

test('renderer config redacts sensitive values but preserves status', () => {
  const config = {
    RPC_URL: 'https://rpc.example/?api-key=secret',
    HOT_WALLET_SECRET: '[1,2,3]',
    FACTION: 'MUD',
  };
  assert.deepEqual(redactConfigForRenderer(config), {
    RPC_URL: '',
    HOT_WALLET_SECRET: '',
    FACTION: 'MUD',
  });
  assert.equal(getSensitiveConfigStatus(config).RPC_URL, true);
  assert.equal(getSensitiveConfigStatus(config).RPC_URL_FALLBACK, false);
});

test('empty or redacted sensitive submissions keep the previous secret', () => {
  assert.deepEqual(
    mergeSensitiveConfig(
      { RPC_URL: 'previous', HOT_WALLET_SECRET: 'old' },
      { RPC_URL: '', HOT_WALLET_SECRET: REDACTED_VALUE },
    ),
    { AEPHIA_API_KEY: '', RPC_URL: 'previous', RPC_URL_FALLBACK: '', HOT_WALLET_SECRET: 'old' },
  );
});

test('RPC Limiter updates preserve explicit slot selection and blank clearing input', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '../electron/renderer.js'), 'utf8');
  assert.match(renderer, /sendSettingsToRpcLimiter\(\{[\s\S]*?rpcUrl:\s*config\.RPC_URL,[\s\S]*?rpcRequestsPerSecond:\s*config\.RPC_REQUESTS_PER_SECOND,[\s\S]*?txRequestsPerSecond:\s*config\.RPC_TX_SEND_RATE_LIMIT_PER_SECOND,[\s\S]*?providerRole,[\s\S]*?\}\)/);
  assert.doesNotMatch(renderer, /sendSettingsToRpcLimiter\(\{ config:/);
  assert.doesNotMatch(main, /sendSettingsToRpcLimiter\(await resolveSubmittedConfig/);
  assert.match(main, /sendSettingsToRpcLimiter\(validated\)/);
});
