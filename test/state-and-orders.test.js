'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyTrackedOrderTransition,
  normalizeLoadedState,
} = require('../dist/bot');

const snapshot = { price: 0.25, remaining: 100, quantity: 100, updatedAt: '2026-07-25T12:00:00.000Z' };

test('tracked order transitions classify partial and full fills', () => {
  assert.deepEqual(classifyTrackedOrderTransition(snapshot, 60, false), {
    kind: 'partial-fill',
    filledDelta: 40,
    remaining: 60,
  });
  assert.deepEqual(classifyTrackedOrderTransition(snapshot, null, false), {
    kind: 'full-fill',
    filledDelta: 100,
    remaining: 0,
  });
});

test('tracked order transitions suppress cancellations and unchanged quantities', () => {
  assert.equal(classifyTrackedOrderTransition(snapshot, null, true), null);
  assert.equal(classifyTrackedOrderTransition(snapshot, 100, false), null);
  assert.equal(classifyTrackedOrderTransition(snapshot, 120, false), null);
});

test('legacy flat order state migrates into the first tracked resource sell side', () => {
  const mint = 'So11111111111111111111111111111111111111112';
  const migrated = normalizeLoadedState(
    { openOrders: { orderA: snapshot }, lastWalletBalance: 42 },
    [{ mint: { toBase58: () => mint } }],
  );
  assert.deepEqual(migrated, {
    [mint]: {
      buy: { openOrders: {} },
      sell: { openOrders: { orderA: snapshot } },
    },
  });
});

test('per-resource flat state migrates to sell while modern side state is preserved', () => {
  const migrated = normalizeLoadedState({
    mintA: { openOrders: { orderA: snapshot }, lastWalletBalance: 42 },
    mintB: {
      buy: { openOrders: { orderB: snapshot }, lastWalletBalance: 5 },
      sell: { openOrders: {} },
    },
    malformed: 'ignore me',
  }, []);

  assert.deepEqual(migrated, {
    mintA: {
      buy: { openOrders: {} },
      sell: { openOrders: { orderA: snapshot }, lastWalletBalance: 42 },
    },
    mintB: {
      buy: { openOrders: { orderB: snapshot }, lastWalletBalance: 5 },
      sell: { openOrders: {}, lastWalletBalance: undefined },
    },
  });
});
