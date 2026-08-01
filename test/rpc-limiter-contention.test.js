'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RpcRequestRateLimiter,
  isRpcLimiterLockContentionError,
} = require('../dist/bot');

test('shared limiter serializes concurrent waits and retries transient lock contention', async () => {
  let activeWaits = 0;
  let maxActiveWaits = 0;
  let attempts = 0;
  const sharedLimiter = {
    async wait() {
      attempts += 1;
      activeWaits += 1;
      maxActiveWaits = Math.max(maxActiveWaits, activeWaits);
      await new Promise((resolve) => setImmediate(resolve));
      activeWaits -= 1;
      if (attempts === 1) {
        const error = new Error('Lock file is already being held');
        error.code = 'ELOCKED';
        throw error;
      }
      return { provider: 'main' };
    },
  };
  const limiter = new RpcRequestRateLimiter(
    () => 1000,
    { info() {}, warn() {}, error() {} },
    () => true,
    'LM Market Bot',
    'MUD',
    { sharedLimiter, lockRetryDelaysMs: [0], sleepFn: async () => {} },
  );

  const results = await Promise.all([
    limiter.waitForProvider('status-orders'),
    limiter.waitForProvider('status-inventory'),
  ]);

  assert.equal(maxActiveWaits, 1);
  assert.equal(attempts, 3);
  assert.deepEqual(results, [{ provider: 'main' }, { provider: 'main' }]);
});

test('shared limiter lock classification does not retry unrelated RPC failures', () => {
  const locked = new Error('Lock file is already being held');
  locked.code = 'ELOCKED';
  assert.equal(isRpcLimiterLockContentionError(locked), true);
  assert.equal(isRpcLimiterLockContentionError(new Error('RPC timeout')), false);
});
