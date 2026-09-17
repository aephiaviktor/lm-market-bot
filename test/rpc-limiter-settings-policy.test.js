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

test('unchanged provider settings preserve quota-exhaustion timestamps', () => {
  const state = stateFixture();
  state.providers.main.quotaExhaustedUntilMs = 5_000_000;
  state.providers.fallback.quotaExhaustedUntilMs = 6_000_000;

  // Re-applying the identical main identity (as ordinary startup/settings
  // synchronisation would) must never clear quota state.
  applyRpcLimiterSettings(state, {
    providerRole: 'main',
    rpcUrl: 'https://main.invalid/?api-key=main-secret',
    rpcRequestsPerSecond: '10',
    txRequestsPerSecond: '2',
  });
  assert.equal(state.providers.main.quotaExhaustedUntilMs, 5_000_000);

  applyRpcLimiterSettings(state, {
    providerRole: 'fallback',
    rpcUrl: 'https://fallback.invalid/?api-key=fallback-secret',
    rpcRequestsPerSecond: '10',
    txRequestsPerSecond: '2',
  });
  assert.equal(state.providers.fallback.quotaExhaustedUntilMs, 6_000_000);
  assert.equal(state.providers.main.quotaExhaustedUntilMs, 5_000_000);
});

test('main provider identity change clears main quota state only', () => {
  const state = stateFixture();
  state.providers.main.quotaExhaustedUntilMs = 5_000_000;
  state.providers.fallback.quotaExhaustedUntilMs = 6_000_000;

  applyRpcLimiterSettings(state, {
    providerRole: 'main',
    rpcUrl: 'https://new-main.invalid/?api-key=main-secret',
    rpcRequestsPerSecond: '10',
    txRequestsPerSecond: '2',
  });

  assert.equal(state.providers.main.quotaExhaustedUntilMs, null);
  assert.equal(state.providers.fallback.quotaExhaustedUntilMs, 6_000_000);
});

test('fallback provider credential change clears fallback quota state only', () => {
  const state = stateFixture();
  state.providers.main.quotaExhaustedUntilMs = 5_000_000;
  state.providers.fallback.quotaExhaustedUntilMs = 6_000_000;

  // Same endpoint, rotated credential: an identity change for fallback only.
  applyRpcLimiterSettings(state, {
    providerRole: 'fallback',
    rpcUrl: 'https://fallback.invalid/?api-key=rotated-key',
    rpcRequestsPerSecond: '10',
    txRequestsPerSecond: '2',
  });

  assert.equal(state.providers.fallback.quotaExhaustedUntilMs, null);
  assert.equal(state.providers.fallback.rpcBaseUrl, 'https://fallback.invalid');
  assert.equal(state.providers.fallback.apiKey, 'rotated-key');
  assert.equal(state.providers.main.quotaExhaustedUntilMs, 5_000_000);
});

test('rate-limit-only changes preserve quota-exhaustion timestamps', () => {
  const state = stateFixture();
  state.providers.main.quotaExhaustedUntilMs = 5_000_000;
  state.providers.fallback.quotaExhaustedUntilMs = 6_000_000;

  applyRpcLimiterSettings(state, {
    providerRole: 'main',
    rpcUrl: 'https://main.invalid/?api-key=main-secret',
    rpcRequestsPerSecond: '20',
    txRequestsPerSecond: '5',
  });

  assert.equal(state.providers.main.quotaExhaustedUntilMs, 5_000_000);
  assert.equal(state.buckets['rpc:shared'].intervalMs, 50);
  assert.equal(state.buckets['tx:shared'].intervalMs, 200);
  assert.equal(state.providers.fallback.quotaExhaustedUntilMs, 6_000_000);
});

test('cooldown/failures still reset on apply while revision and locking fields stay untouched by the policy', () => {
  const state = stateFixture();
  state.providers.main.quotaExhaustedUntilMs = 5_000_000;
  state.providers.main.cooldownUntilMs = 123_456;
  state.providers.main.failures = 9;
  const revisionBefore = state.revision;
  const roundRobinBefore = state.providersRoundRobinCounter;
  const exclusiveBefore = structuredClone(state.exclusive);
  const fallbackBefore = structuredClone(state.providers.fallback);

  applyRpcLimiterSettings(state, {
    providerRole: 'main',
    rpcUrl: 'https://main.invalid/?api-key=main-secret',
    rpcRequestsPerSecond: '10',
    txRequestsPerSecond: '2',
  });

  // Existing behaviour: submitting settings clears the provider's transient
  // cooldown and failure count (unchanged).
  assert.equal(state.providers.main.cooldownUntilMs, null);
  assert.equal(state.providers.main.failures, 0);
  // Quota knowledge survives unchanged-identity applies: only the limiter
  // writes it.
  assert.equal(state.providers.main.quotaExhaustedUntilMs, 5_000_000);
  // Locking and revision bookkeeping live in the apply path
  // (withRpcLimiterLock + bumpRpcLimiterRevision), never in the policy.
  assert.equal(state.revision, revisionBefore);
  assert.equal(state.providersRoundRobinCounter, roundRobinBefore);
  assert.deepEqual(state.exclusive, exclusiveBefore);
  assert.deepEqual(state.providers.fallback, fallbackBefore);
});

test('settings application never returns or copies credentials into diagnostics or IPC payloads', () => {
  const state = stateFixture();
  const secret = 's3cr3t-api-key-value';

  const result = applyRpcLimiterSettings(state, {
    providerRole: 'main',
    rpcUrl: `https://main.invalid/?api-key=${secret}`,
    rpcRequestsPerSecond: '10',
    txRequestsPerSecond: '2',
  });

  // The IPC-facing operation result carries only role/action.
  assert.deepEqual(result, { role: 'main', action: 'updated' });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('api-key'), false);
  // The credential exists only in the limiter-state slot it was submitted to.
  assert.equal(state.providers.main.apiKey, secret);
  assert.equal(state.providers.fallback.apiKey, 'fallback-secret');
  // Non-secret state surfaces (buckets, shared fields) must not contain it.
  assert.equal(JSON.stringify(state.buckets).includes(secret), false);

  // Re-applying identical settings (startup sync) keeps secrets confined too.
  const result2 = applyRpcLimiterSettings(state, {
    providerRole: 'main',
    rpcUrl: `https://main.invalid/?api-key=${secret}`,
    rpcRequestsPerSecond: '10',
    txRequestsPerSecond: '2',
  });
  assert.deepEqual(result2, { role: 'main', action: 'updated' });
  assert.equal(JSON.stringify(result2).includes(secret), false);
});
