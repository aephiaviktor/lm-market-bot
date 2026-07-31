const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the retired Send Tokens feature is absent from the Electron app', () => {
  const files = [
    'electron/main.js',
    'electron/preload.js',
    'electron/renderer.js',
    'electron/renderer.html',
    'electron/renderer.css',
  ];
  const source = files.map((file) => read(file)).join('\n');

  assert.doesNotMatch(source, /Send Tokens/i);
  assert.doesNotMatch(source, /hardware-transfer/);
  assert.doesNotMatch(source, /batch-token-transfer/);
  assert.doesNotMatch(source, /HardwareWalletTransfer|BatchTokenTransfer/);
});

test('Ledger transfer-only dependencies are removed', () => {
  const packageJson = JSON.parse(read('package.json'));

  assert.equal(packageJson.dependencies['@ledgerhq/hw-app-solana'], undefined);
  assert.equal(packageJson.dependencies['@ledgerhq/hw-transport-node-hid'], undefined);
});
