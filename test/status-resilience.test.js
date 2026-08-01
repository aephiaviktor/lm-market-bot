'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildAuthoritativeStatusSnapshot,
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

test('successful enriched snapshots also use the authoritative main-process lifecycle state', () => {
  assert.deepEqual(
    buildAuthoritativeStatusSnapshot({ running: false, wallet: 'wallet-address' }, true),
    { running: true, wallet: 'wallet-address' },
  );
  assert.deepEqual(
    buildAuthoritativeStatusSnapshot({ running: true, wallet: 'wallet-address' }, false),
    { running: false, wallet: 'wallet-address' },
  );
});

test('renderer lifecycle events refresh the canonical snapshot instead of racing it', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../electron/renderer.js'), 'utf8');
  const listener = renderer.match(/window\.botApi\.onStatus\(\([^)]*\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(listener, 'status listener exists');
  assert.doesNotMatch(listener[1], /setRunning/);
  assert.match(listener[1], /refreshBotStatus/);
});

test('scheduled LM cycles recover from unexpected loop-level rejection', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/bot.ts'), 'utf8');
  assert.match(source, /private scheduleLoop\(delayMs: number\)/);
  assert.match(source, /Unexpected loop failure/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => \{\s*void this\.loop\(\);\s*\}, delay\)/);
});
