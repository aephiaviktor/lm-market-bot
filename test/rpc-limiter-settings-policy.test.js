'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyRpcLimiterSettings,
  parseRpcLimiterUrl,
  resolveLimiterConnectionUrls,
  resolveProviderRole,
} = require('../electron/rpc-limiter-settings-policy');

function stateFixture() {
  return {
    version: 2,
    enabled: true,
    rpcBaseUrl: 'https://legacy.invalid',
    apiKey: 'legacy-secret',
    providers: {
      main: { rpcBaseUrl: 'https://main.invalid', apiKey: 'main-secret', failures: 2, cooldownUntilMs: 100 },
      fallback: { rpcBaseUrl: 'https://fallback.invalid', apiKey: 'fallback-secret', failures: 1, cooldownUntilMs: 200 },
    },
    providersRoundRobinCounter: 7,
    buckets: {
      'rpc:shared': { nextSlotMs: 1234, intervalMs: 250 },
      'tx:shared': { nextSlotMs: 5678, intervalMs: 1000 },
    },
    limits: { failureThreshold: 3 },
    exclusive: { bucket: 'fleet:aggressive' },
    revision: 9,
  };
}

test('only the literal fallback role selects fallback', () => {
  assert.equal(resolveProviderRole('fallback'), 'fallback');
  for (const value of [undefined, null, '', 'main', 'true', true, false, 'unexpected']) {
    assert.equal(resolveProviderRole(value), 'main');
  }
});

test('RPC URL parsing trims input and separates api-key without exposing it in the base URL', () => {
  assert.deepEqual(parseRpcLimiterUrl(' https://rpc.invalid/path?api-key=secret&region=eu '), {
    rpcBaseUrl: 'https://rpc.invalid/path?region=eu',
    apiKey: 'secret',
  });
});

test('provider updates preserve the other provider and unrelated shared state', () => {
  const state = stateFixture();
  const beforeFallback = structuredClone(state.providers.fallback);
  const beforeExclusive = structuredClone(state.exclusive);

  const result = applyRpcLimiterSettings(state, {
    providerRole: 'main',
    rpcUrl: 'https://replacement.invalid/?api-key=new-secret',
    rpcRequestsPerSecond: '8',
    txRequestsPerSecond: '2',
  });

  assert.equal(result.action, 'updated');
  assert.equal(state.providers.main.rpcBaseUrl, 'https://replacement.invalid');
  assert.equal(state.providers.main.apiKey, 'new-secret');
  assert.equal(state.providers.main.failures, 0);
  assert.equal(state.providers.main.cooldownUntilMs, null);
  assert.deepEqual(state.providers.fallback, beforeFallback);
  assert.equal(state.buckets['rpc:shared'].intervalMs, 125);
  assert.equal(state.buckets['rpc:shared'].nextSlotMs, 1234);
  assert.equal(state.buckets['tx:shared'].intervalMs, 500);
  assert.deepEqual(state.exclusive, beforeExclusive);
  assert.equal(state.enabled, true);
});

test('empty and whitespace-only input clear only the selected slot without validating rates', () => {
  for (const rpcUrl of ['', '   \n  ']) {
    const state = stateFixture();
    const beforeMain = structuredClone(state.providers.main);
    const beforeBuckets = structuredClone(state.buckets);

    const result = applyRpcLimiterSettings(state, {
      providerRole: 'fallback',
      rpcUrl,
      rpcRequestsPerSecond: 'not-a-rate',
      txRequestsPerSecond: '',
    });

    assert.deepEqual(result, { role: 'fallback', action: 'cleared' });
    assert.deepEqual(state.providers.fallback, {});
    assert.deepEqual(state.providers.main, beforeMain);
    assert.deepEqual(state.buckets, beforeBuckets);
    assert.equal(state.enabled, true);
  }
});

test('clearing Main removes legacy fields and disables state when it was the final provider', () => {
  const state = stateFixture();
  state.providers.fallback = {};

  applyRpcLimiterSettings(state, { providerRole: 'main', rpcUrl: '' });

  assert.deepEqual(state.providers.main, {});
  assert.equal(Object.hasOwn(state, 'rpcBaseUrl'), false);
  assert.equal(Object.hasOwn(state, 'apiKey'), false);
  assert.equal(state.enabled, false);
});

test('malformed non-empty URLs fail without mutating state', () => {
  const state = stateFixture();
  const before = structuredClone(state);

  assert.throws(() => applyRpcLimiterSettings(state, {
    providerRole: 'fallback',
    rpcUrl: 'not a URL',
    rpcRequestsPerSecond: '10',
    txRequestsPerSecond: '1',
  }));
  assert.deepEqual(state, before);
});

test('limiter transport supports Main-only, Fallback-only, both, and fails closed with neither', () => {
  assert.deepEqual(resolveLimiterConnectionUrls({
    main: { url: 'https://main.invalid' }, fallback: {},
  }), { rpcUrl: 'https://main.invalid', rpcUrlFallback: '' });
  assert.deepEqual(resolveLimiterConnectionUrls({
    main: {}, fallback: { url: 'https://fallback.invalid' },
  }), { rpcUrl: 'https://fallback.invalid', rpcUrlFallback: '' });
  assert.deepEqual(resolveLimiterConnectionUrls({
    main: { url: 'https://main.invalid' }, fallback: { url: 'https://fallback.invalid' },
  }), { rpcUrl: 'https://main.invalid', rpcUrlFallback: 'https://fallback.invalid' });
  assert.throws(() => resolveLimiterConnectionUrls({ main: {}, fallback: {} }), /no RPC Limiter URLs are configured/);
});
