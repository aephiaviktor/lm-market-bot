'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyTrackedOrderTransition,
  findCertificateRedemptionRule,
  getCertificateSnapshotRules,
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

test('certificate snapshots include buy rules and collapse duplicate market locations', () => {
  const rules = [
    { side: 'buy', asset: 'Carbon:mint-carbon', starbase: 'MRZ-5' },
    { side: 'sell', asset: 'Carbon:mint-carbon', starbase: 'MRZ-5' },
    { side: 'buy', asset: 'Food:mint-food', starbase: 'MRZ-9' },
  ];

  assert.deepEqual(getCertificateSnapshotRules(rules), [rules[0], rules[2]]);
});

test('certificate redemption accepts a matching buy rule', () => {
  const rules = [
    { side: 'buy', asset: 'Carbon:mint-carbon', starbase: 'MRZ-5' },
    { side: 'sell', asset: 'Food:mint-food', starbase: 'MRZ-9' },
  ];

  assert.equal(findCertificateRedemptionRule(rules, 'Carbon:mint-carbon', 'MRZ-5'), rules[0]);
  assert.equal(findCertificateRedemptionRule(rules, 'Carbon:mint-carbon', 'MRZ-9'), undefined);
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

test('actual certificate snapshot shows buy-only Carbon without sell context and deduplicates mint', async () => {
  const { LmMarketBot } = require('../dist/bot');
  const { PublicKey } = require('@solana/web3.js');
  const { TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
  const bot = Object.create(LmMarketBot.prototype);
  bot.config = { assetRules: [
    { side: 'buy', asset: 'Carbon', starbase: 'MRZ-5' },
    { side: 'sell', asset: 'Carbon', starbase: 'MRZ-5' },
  ] };
  bot.wallet = { publicKey: new PublicKey('85BbUrMbPGDekp8mfSznWaSujHKaHrSgsTmiRfVr62Bo') };
  const mint = new PublicKey('4QngJjWuG5JX7fG3Koh1u4UJZ5J7Wq2z4xL7dCXW9os5');
  bot.resolveLocalMarketBuyContext = async () => ({ certificateResource: { mint } });
  bot.resolveLocalMarketSellContext = async () => { throw new Error('Display must not require cargo authority'); };
  bot.getWalletBalanceForMint = async (requested, name, options) => {
    assert.ok(requested.equals(mint));
    assert.ok(options.tokenProgramId.equals(TOKEN_2022_PROGRAM_ID));
    return 10000000;
  };
  const rows = await bot.buildCertificateSnapshot();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].balance, 10000000);
  assert.equal(rows[0].ruleAsset, 'Carbon');
  assert.equal(rows[0].certificateTokenAccount, 'Hkszun8pRXh9da7Agr5dmhCDfmGyncXwskQr4wZVUEmY');
});

test('actual redemption routes a buy rule while retaining cargo authority and balance gates', async () => {
  const { LmMarketBot } = require('../dist/bot');
  const bot = Object.create(LmMarketBot.prototype);
  bot.config = { assetRules: [{ side: 'buy', asset: 'Carbon', starbase: 'MRZ-5' }] };
  bot.resolveLocalMarketSellContext = async () => null;
  assert.equal((await bot.redeemCertificateForRule('Carbon', 'MRZ-5')).status, 'local_market_context_unavailable');
  assert.equal((await bot.redeemCertificateForRule('Carbon', 'MRZ-9')).status, 'rule_not_found');
  bot.resolveLocalMarketSellContext = async () => ({ certificateMint: {} });
  bot.getWalletBalanceForMint = async () => 0;
  assert.equal((await bot.redeemCertificateForRule('Carbon', 'MRZ-5')).status, 'no_certificates');
});
