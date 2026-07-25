'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBotConfig,
  getEditableConfigFromEnv,
  parseAssetRule,
  parseAssetRules,
} = require('../dist/bot');

const strategyRow = {
  starbase: 'MRZ-1',
  asset: 'Iron Ore',
  group: 'raw',
  refill: false,
  minQuantity: '10',
  maxQuantity: '20',
  minBuyPrice: '0.1',
  maxBuyPrice: '0.2',
  minSellPrice: '0.3',
  maxSellPrice: '0.4',
};

test('editable config defaults remain stable', () => {
  const config = getEditableConfigFromEnv({});
  assert.equal(config.FACTION, 'ONI');
  assert.equal(config.RPC_URL, 'https://api.mainnet-beta.solana.com');
  assert.equal(config.USE_RPC_LIMITER, 'false');
  assert.equal(config.CHECK_INTERVAL_MINUTES, '30');
  assert.equal(config.RELEVANT_BUY_ORDER_PCT, '10');
  assert.equal(config.RELEVANT_SELL_ORDER_PCT, '20');
});

test('strategy rows expand into bounded buy and sell rules', () => {
  assert.deepEqual(parseAssetRules([strategyRow]), [
    {
      starbase: 'MRZ-1',
      asset: 'Iron Ore',
      group: 'raw',
      side: 'buy',
      quantity: 20,
      limit: 20,
      price: 0.2,
      refill: false,
      minQuantity: 10,
      minPrice: 0.1,
      maxPrice: 0.2,
    },
    {
      starbase: 'MRZ-1',
      asset: 'Iron Ore',
      group: 'raw',
      side: 'sell',
      quantity: 10,
      limit: 20,
      price: 0.3,
      refill: false,
      minQuantity: 10,
      minPrice: 0.3,
      maxPrice: 0.4,
    },
  ]);
});

test('blank table rows are ignored while malformed runnable rows fail closed', () => {
  assert.deepEqual(parseAssetRules([{}, { asset: '', minQuantity: '1', maxQuantity: '2' }]), []);
  assert.throws(
    () => parseAssetRules([{ ...strategyRow, maxQuantity: '9' }]),
    /maxQuantity must be greater than or equal to minQuantity/,
  );
  assert.throws(
    () => parseAssetRules([{ ...strategyRow, minBuyPrice: '0.21' }]),
    /minBuyPrice must be less than or equal to maxBuyPrice/,
  );
  assert.throws(
    () => parseAssetRules([{ ...strategyRow, maxSellPrice: '0.29' }]),
    /maxSellPrice must be greater than or equal to minSellPrice/,
  );
  assert.throws(
    () => parseAssetRules([{ ...strategyRow, starbase: 'NOT-A-STARBASE' }]),
    /must be a known starbase/,
  );
});

test('legacy rows preserve order side, quantity, limit, and price', () => {
  assert.deepEqual(parseAssetRule({
    starbase: 'MRZ-1',
    asset: 'Iron Ore',
    group: 'raw',
    side: 'sell',
    quantity: '25',
    limit: '40',
    price: '0.005',
  }), {
    starbase: 'MRZ-1',
    asset: 'Iron Ore',
    group: 'raw',
    side: 'sell',
    quantity: 25,
    limit: 40,
    price: 0.005,
    refill: true,
    minQuantity: 25,
    minPrice: null,
    maxPrice: null,
  });
});

test('bot config validates required secret and numeric safety bounds', () => {
  assert.throws(() => buildBotConfig({ assetRules: [] }), /HOT_WALLET_SECRET env variable missing/);
  assert.throws(
    () => buildBotConfig({ HOT_WALLET_SECRET: '[1,2,3]', CHECK_INTERVAL_MINUTES: '0', assetRules: [] }),
    /CHECK_INTERVAL_MINUTES must be a positive integer/,
  );
  assert.throws(
    () => buildBotConfig({ HOT_WALLET_SECRET: '[1,2,3]', RELEVANT_BUY_ORDER_PCT: '101', assetRules: [] }),
    /positive percentage between 0 and 100/,
  );
});
