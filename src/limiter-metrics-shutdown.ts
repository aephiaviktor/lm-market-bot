/**
 * Bounded, idempotent shutdown for the shared rpc_limiter metrics worker.
 *
 * The real RpcLimiter is owned by RpcRequestRateLimiter; the Electron main
 * process reaches it through the bot's stop() path (before-quit → stopBot()).
 * This helper safely closes the metrics worker without ever delaying
 * application shutdown beyond a fixed absolute deadline (2 seconds by
 * default) and without recursing or double-closing on repeated quit events.
 */

export const LIMITER_METRICS_SHUTDOWN_MAX_MS = 2000;

export interface LimiterMetricsCloseable {
  flushMetrics?: (deadlineAtMs: number) => Promise<boolean>;
  closeMetrics?: (deadlineAtMs: number) => Promise<void>;
}

interface LoggerLike {
  warn?: (message: string) => void;
}

export interface LimiterMetricsShutdown {
  /**
   * Close the limiter's metrics worker once. Subsequent calls are no-ops and
   * return the same in-flight promise. Never rejects.
   */
  close(limiter: LimiterMetricsCloseable | null | undefined, deadlineAtMs?: number): Promise<void>;
  /** True once a shutdown has been requested (or is running). */
  hasRun(): boolean;
}

interface LimiterMetricsShutdownOptions {
  /** Maximum time the shutdown may take. Defaults to 2 seconds. */
  maxWaitMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export function createLimiterMetricsShutdown(
  logger: LoggerLike | null | undefined,
  options: LimiterMetricsShutdownOptions = {},
): LimiterMetricsShutdown {
  const maxWaitMs = options.maxWaitMs ?? LIMITER_METRICS_SHUTDOWN_MAX_MS;
  const now = options.now ?? (() => Date.now());
  let shutdownPromise: Promise<void> | null = null;

  function warn(message: string): void {
    try {
      logger?.warn?.(message);
    } catch {
      // Diagnostics must never fail shutdown.
    }
  }

  function bounded(promise: Promise<unknown>, deadlineAtMs: number, step: string): Promise<void> {
    return new Promise((resolve) => {
      const remainingMs = Math.max(0, deadlineAtMs - now());
      const timer = setTimeout(() => {
        warn(`Shared limiter metrics ${step} exceeded shutdown deadline; continuing.`);
        resolve();
      }, remainingMs);
      Promise.resolve(promise).then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        () => {
          clearTimeout(timer);
          warn(`Shared limiter metrics ${step} failed (non-fatal); continuing.`);
          resolve();
        },
      );
    });
  }

  function close(limiter: LimiterMetricsCloseable | null | undefined, deadlineAtMs?: number): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    const effectiveDeadlineAtMs = Math.min(
      deadlineAtMs ?? Number.POSITIVE_INFINITY,
      now() + maxWaitMs,
    );
    shutdownPromise = (async () => {
      try {
        if (!limiter) return;
        if (typeof limiter.flushMetrics === 'function') {
          await bounded(limiter.flushMetrics(effectiveDeadlineAtMs), effectiveDeadlineAtMs, 'flushMetrics');
        }
        if (typeof limiter.closeMetrics === 'function') {
          await bounded(limiter.closeMetrics(effectiveDeadlineAtMs), effectiveDeadlineAtMs, 'closeMetrics');
        }
      } catch {
        warn('Shared limiter metrics shutdown failed (non-fatal); continuing.');
      }
    })();
    return shutdownPromise;
  }

  return { close, hasRun: () => shutdownPromise !== null };
}