'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  isTrustedIpcEvent,
  validateAssetAndSide,
  validateAssetList,
  validateAssetsPayload,
  validateRedeemPayload,
  validateSettingsPayload,
} = require('../electron/ipc-security-policy');

const editableKeys = ['RPC_URL', 'HOT_WALLET_SECRET', 'CHECK_INTERVAL_MINUTES'];

test('IPC trusts only the main frame of the active application webContents', () => {
  const mainFrame = {};
  const webContents = { mainFrame };
  assert.equal(isTrustedIpcEvent({ sender: webContents, senderFrame: mainFrame }, webContents), true);
  assert.equal(isTrustedIpcEvent({ sender: webContents, senderFrame: {} }, webContents), false);
  assert.equal(isTrustedIpcEvent({ sender: {}, senderFrame: mainFrame }, webContents), false);
  assert.equal(isTrustedIpcEvent({}, webContents), false);
});

test('settings IPC accepts bounded known config and LM asset-rule fields', () => {
  const payload = {
    config: { RPC_URL: 'https://rpc.example', CHECK_INTERVAL_MINUTES: '5' },
    assetRules: [{ asset: 'Iron Ore', starbase: 'MRZ-1', refill: true, minQuantity: '1' }],
  };
  assert.deepEqual(validateSettingsPayload(payload, editableKeys), payload);
});

test('settings IPC rejects unknown fields, oversized values, and oversized arrays', () => {
  assert.throws(
    () => validateSettingsPayload({ config: { UNKNOWN: 'x' } }, editableKeys),
    /Unknown settings field: UNKNOWN/,
  );
  assert.throws(
    () => validateSettingsPayload({ config: { RPC_URL: 'x'.repeat(4097) } }, editableKeys),
    /RPC_URL is too long/,
  );
  assert.throws(
    () => validateSettingsPayload({ config: {}, assetRules: Array.from({ length: 251 }, () => ({})) }, editableKeys),
    /assetRules exceeds 250 entries/,
  );
  assert.throws(
    () => validateSettingsPayload({ config: {}, surprise: true }, editableKeys),
    /Unknown settings payload field: surprise/,
  );
});

test('order cancellation requires an exact asset and side', () => {
  assert.deepEqual(validateAssetAndSide({ asset: 'Iron Ore', side: 'buy' }), {
    asset: 'Iron Ore',
    side: 'buy',
  });
  assert.throws(() => validateAssetAndSide({ asset: '', side: 'buy' }), /asset is required/);
  assert.throws(() => validateAssetAndSide({ asset: 'Iron', side: 'hold' }), /side must be buy or sell/);
});

test('asset reruns accept only a bounded string array', () => {
  assert.deepEqual(validateAssetList([' Iron Ore ', 'Copper']), ['Iron Ore', 'Copper']);
  assert.throws(() => validateAssetList('Iron Ore'), /assets must be an array/);
  assert.throws(() => validateAssetList(Array.from({ length: 251 }, () => 'Iron')), /assets exceeds 250 entries/);
  assert.deepEqual(validateAssetsPayload({ assets: ['Iron'] }), { assets: ['Iron'] });
  assert.throws(() => validateAssetsPayload({ assets: [], extra: true }), /Unknown assets payload field: extra/);
});

test('certificate redemption accepts only bounded asset and starbase fields', () => {
  assert.deepEqual(validateRedeemPayload({ asset: 'Iron Ore', starbase: 'MRZ-1' }), {
    asset: 'Iron Ore',
    starbase: 'MRZ-1',
  });
  assert.throws(() => validateRedeemPayload({ asset: '', starbase: '' }), /asset is required/);
  assert.throws(() => validateRedeemPayload({ asset: 'Iron', starbase: '', extra: true }), /Unknown redeem-certificate field/);
});

test('renderer CSP permits only packaged scripts and styles', () => {
  const html = fs.readFileSync(path.join(__dirname, '../electron/renderer.html'), 'utf8');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'self'; script-src 'self'; style-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /script-src[^;]*'unsafe-inline'/);
});

test('application window blocks renderer navigation and new windows', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  assert.match(main, /sandbox: true/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(main, /on\('will-navigate', \(event\) => event\.preventDefault\(\)\)/);
});
