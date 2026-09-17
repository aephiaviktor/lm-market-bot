'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLimiterMetricsShutdown, LIMITER_METRICS_SHUTDOWN_MAX_MS } = require('../dist/limiter-metrics-shutdown');
const { RpcRequestRateLimiter } = require('../dist/bot');

function fakeLimiter({ flushRejects = false, closeRejects = false, hang = false } = {}) {
  const calls = { waited: 0, flushed: 0, closed: 0 };
  const limiter = {
    async wait() {
      calls.waited += 1;
      return { provider: 'main' };
    },
    async flushMetrics(deadlineAtMs) {
      assert.ok(deadlineAtMs >= Date.now() - 1);
      calls.flushed += 1;
      if (hang) return new Promise(() => {});
      if (flushRejects) throw new Error('flush failed');
      return true;
    },
    async closeMetrics(deadlineAtMs) {
      assert.ok(deadlineAtMs >= Date.now() - 1);
      calls.closed += 1;
      if (hang) return new Promise(() => {});
      if (closeRejects) throw new Error('close failed');
    },
  };
  return { limiter, calls };
}

function loggerWithWarnings() {
  const warnings = [];
  return {
    logger: {
      info() {},
      warn(message, ...rest) { warnings.push(String(message)); },
      error() {},
    },
    warnings,
  };
}

function makeRateLimiter(limiter) {
  const { logger } = loggerWithWarnings();
  return new RpcRequestRateLimiter(
    () => 1000,
    logger,
    () => true,
    'LM Market Bot',
    'default',
    { sharedLimiter: limiter },
  );
}

test('normal quit requests one bounded shutdown for the shared limiter', async () => {
  const { limiter, calls } = fakeLimiter();
  const rateLimiter = makeRateLimiter(limiter);
  await rateLimiter.closeSharedLimiterMetrics(Date.now() + 2000);
  assert.equal(calls.flushed, 1);
  assert.equal(calls.closed, 1);
  assert.equal(calls.waited, 0);
});

test('a second quit event does not start another shutdown', async () => {
  const { limiter, calls } = fakeLimiter();
  const rateLimiter = makeRateLimiter(limiter);
  const first = rateLimiter.closeSharedLimiterMetrics(Date.now() + 2000);
  const second = rateLimiter.closeSharedLimiterMetrics(Date.now() + 2000);
  await Promise.all([first, second]);
  assert.equal(calls.flushed, 1);
  assert.equal(calls.closed, 1);
});

test('a failed metrics close still allows quitting', async () => {
  const { limiter } = fakeLimiter({ closeRejects: true });
  const { logger, warnings } = loggerWithWarnings();
  const shutdown = createLimiterMetricsShutdown(logger);
  await assert.doesNotReject(shutdown.close(limiter, Date.now() + 2000));
  assert.ok(warnings.some((w) => w.includes('closeMetrics failed')), 'warning logged');
});

test('the deadline path still allows quitting (bounded by max wait)', async () => {
  const { limiter, calls } = fakeLimiter({ hang: true });
  const { logger } = loggerWithWarnings();
  const shutdown = createLimiterMetricsShutdown(logger, { maxWaitMs: 60 });
  const startedMs = Date.now();
  await assert.doesNotReject(shutdown.close(limiter, Date.now() + 60));
  assert.ok(Date.now() - startedMs <= 500, 'shutdown returned within the bounded window');
  assert.equal(calls.flushed, 1);
});

test('no metrics lifecycle action runs during startup or ordinary RPC calls', async () => {
  const { limiter, calls } = fakeLimiter();
  const rateLimiter = makeRateLimiter(limiter);
  const result = await rateLimiter.waitForProvider('getBalance', 'rpc:shared', 'getBalance');
  assert.deepEqual(result, { provider: 'main' });
  assert.equal(calls.waited, 1);
  assert.equal(calls.flushed, 0);
  assert.equal(calls.closed, 0);
  // Close is only requested by the explicit shutdown path.
  await rateLimiter.closeSharedLimiterMetrics(Date.now() + 2000);
  assert.equal(calls.flushed, 1);
  assert.equal(calls.closed, 1);
});

test('helper never delays more than LIMITER_METRICS_SHUTDOWN_MAX_MS by default', async () => {
  assert.equal(LIMITER_METRICS_SHUTDOWN_MAX_MS, 2000);
  const { limiter } = fakeLimiter({ hang: true });
  const { logger } = loggerWithWarnings();
  const shutdown = createLimiterMetricsShutdown(logger);
  const startedMs = Date.now();
  await assert.doesNotReject(shutdown.close(limiter, Date.now() + 10_000));
  assert.ok(Date.now() - startedMs <= 3500, 'default deadline enforced');
});