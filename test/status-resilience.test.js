'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildStatusFailureSnapshot,
} = require('../electron/status-snapshot-policy');

test('status enrichment failure preserves authoritative running state and last successful data', () => {
  const previous = {
    version: '0.2.90',
    running: true,
    wallet: 'wallet-address',
    solBalance: 1.25,
    openOrders: [{ id: 'order-1' }],
  };

  assert.deepEqual(buildStatusFailureSnapshot(previous, {
    running: true,
    version: '0.2.90',
    message: 'Lock file is already being held',
  }), {
    ...previous,
    running: true,
    version: '0.2.90',
    statusWarning: 'Status details temporarily unavailable; bot lifecycle is unaffected.',
  });
});

test('status enrichment failure never promotes a stopped bot from stale cached state', () => {
  const result = buildStatusFailureSnapshot({ running: true, wallet: 'wallet-address' }, {
    running: false,
    version: '0.2.90',
  });
  assert.equal(result.running, false);
  assert.equal(result.version, '0.2.90');
});

test('scheduled LM cycles recover from unexpected loop-level rejection', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/bot.ts'), 'utf8');
  assert.match(source, /private scheduleLoop\(delayMs: number\)/);
  assert.match(source, /Unexpected loop failure/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => \{\s*void this\.loop\(\);\s*\}, delay\)/);
});
