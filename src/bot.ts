import { Buffer } from 'buffer';
import {
  Connection,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
  TransactionInstruction,
  type BlockhashWithExpiryBlockHeight,
  type Commitment,
  type GetLatestBlockhashConfig,
  type RpcResponseAndContext,
} from '@solana/web3.js';
import { AnchorProvider, BN, Program, Wallet } from '@staratlas/anchor';
import { CargoType, CARGO_IDL, type CargoIDLProgram } from '@staratlas/cargo';
import { keypairToAsyncSigner } from '@staratlas/data-source';
import { GmClientService, Order, OrderSide } from '@staratlas/factory';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getExtraAccountMetaAddress,
  getTransferHook,
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
} from '@solana/spl-token';
import { PROFILE_FACTION_IDL, ProfileFactionAccount, type ProfileFactionIDLProgram } from '@staratlas/profile-faction';
import {
  findCertificateMintAddress,
  SAGE_IDL,
  SagePermissions,
  SagePlayerProfile,
  Starbase,
  StarbasePlayer,
  type CrewTransferInput,
  type SageIDLProgram,
} from '@staratlas/sage';
import { CREW_IDL, CrewConfig, type CrewIDLProgram } from '@staratlas/crew';
import { PLAYER_PROFILE_IDL, PlayerProfile, type PlayerProfileIDLProgram } from '@staratlas/player-profile';
import { RpcLimiter } from 'rpc_limiter';
import bs58 from 'bs58';
import fs from 'fs/promises';
import path from 'path';
import {
  GM_MARKET_ASSET_REGISTRY,
  formatAssetRegistryResourceList,
  findAssetRegistryEntryForGroupAndName,
  type AssetRegistryGroup,
} from './asset-registry';
import { findStarbaseRegistryEntry, normalizeStarbaseRegistryName } from './starbase-registry';

const GM_PROGRAM_ID = new PublicKey('traderDnaR5w6Tcoi3NFm53i48FTDNbGjBSZwWXDRrg');
const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey('ComputeBudget111111111111111111111111111111');
const SAGE_PROGRAM_ID = new PublicKey('SAGE2HAwep459SNq61LHvjxPk4pLPEJLoMETef7f7EE');
const PLAYER_PROFILE_PROGRAM_ID = new PublicKey('pprofELXjL5Kck7Jn5hCpwAL82DpTkSYBENzahVtbc9');
const CARGO_PROGRAM_ID = new PublicKey('Cargo2VNTPPTi9c1vq1Jw5d3BWUNr18MjRtSupAghKEk');
const PROFILE_FACTION_PROGRAM_ID = new PublicKey('pFACSRuobDmvfMKq1bAzwj27t6d2GJhSCHb1VcfnRmq');
const CREW_PROGRAM_ID = new PublicKey('CREWiq8qbxvo4SKkAFpVnc6t7CRQC4tAAscsNAENXgrJ');
const SAGE_MARKET_HOOK_PROGRAM_ID = new PublicKey('hooKwBRKyzBqxVZFQVpLMKGexhmc6ZNaRAbwWi8uMok');
const CARGO_STATS_DEFINITION = new PublicKey('CSTatsVpHbvZmwHbCjZKVfYQT5JXfsXccXufhEcwCqTg');
const QUOTE_ATLAS_MINT = new PublicKey('ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx');
const QUOTE_USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const DEFAULT_IRON_ORE_MINT = 'FeorejFjRRAfusN9Fg3WjEZ1dRCf74o6xwT5vDt3R34J';

const ORDER_PRICE_EPSILON = 0.0000005;
const ORDER_PRICE_STEP = 0.000001;
const ORDER_PRICE_NUDGE = 0.00000001;
const MARKET_LEADER_CACHE_TTL_MS = 600000;
const OPEN_ORDERS_CACHE_TTL_MS = 60000;
const STATUS_SNAPSHOT_CACHE_FLOOR_MS = 120000;
const STATUS_SNAPSHOT_CACHE_CEIL_MS = 600000;
const FAST_CYCLE_INTERVAL_MS = 10 * 60_000;
const SLOW_CYCLE_INTERVAL_MS = 60 * 60_000;
const RPC_ACCOUNT_INFO_CACHE_TTL_MS = 60000;
const RPC_LATEST_BLOCKHASH_REUSE_MS = 45000;
const RPC_RENT_EXEMPTION_CACHE_TTL_MS = 3600000;
const RPC_METHOD_COUNTER_LOG_INTERVAL_MS = 300000;
// Keep this as a runtime require so TypeScript keeps emitting dist/bot.js.
const packageJson = require('../package.json') as { version?: string };
const APP_VERSION = packageJson.version || 'unknown';
const DEFAULT_RPC_REQUESTS_PER_SECOND = 10;
const MAX_RPC_REQUESTS_PER_SECOND = 10;
const DEFAULT_RPC_TX_SEND_RATE_LIMIT_PER_SECOND = 1;
const DEFAULT_CHAIN_STATUS_REFRESH_INTERVAL_MINUTES = 10;
const STARBASE_PLAYER_PROFILE_OFFSET = 9;
const STARBASE_PLAYER_STARBASE_OFFSET = 73;
const CARGO_POD_AUTHORITY_OFFSET = 41;
const SOL_BALANCE_CACHE_TTL_MS = 120000;
const WALLET_TOKEN_BALANCE_CACHE_TTL_MS = 120000;
const STARBASE_PLAYER_CACHE_TTL_MS = 3600000;
const CARGO_POD_LIST_CACHE_TTL_MS = 3600000;
const CARGO_POD_TOKEN_CACHE_TTL_MS = 600000;
const LOCAL_MARKET_SELL_CONTEXT_CACHE_TTL_MS = 600000;
const CREW_DEPOSIT_BATCH_SIZE = 6;
const CREW_DEPOSIT_COMPUTE_UNIT_LIMIT = 1_400_000;
const CREW_ASSET_DISCOVERY_PAGE_LIMIT = 1000;
const CREW_ASSET_DISCOVERY_MAX_PAGES = 10;
const RPC_RATE_LIMIT_RETRY_DELAYS_MS = [20000, 60000, 180000];
const RPC_TRANSIENT_TRANSPORT_RETRY_DELAYS_MS = [5000];
const RPC_LIMITER_SLOW_WAIT_LOG_MS = 100;
const RPC_LIMITER_WAIT_LOG_THROTTLE_MS = 60000;
const SHIP_BUY_OUTBID_PCT = 0.005;
const SHIP_PART_SUFFIX = ' (ship parts)';
const SHIP_START_NAME = 'Busan Pulse';
const SHIP_END_NAME = 'Rainbow Phi';
const SHIP_REGISTRY_START_INDEX = GM_MARKET_ASSET_REGISTRY.findIndex((entry) => entry.name === SHIP_START_NAME);
const SHIP_REGISTRY_END_INDEX = GM_MARKET_ASSET_REGISTRY.findIndex((entry) => entry.name === SHIP_END_NAME);
const SHIP_MINTS = new Set(
  SHIP_REGISTRY_START_INDEX >= 0 && SHIP_REGISTRY_END_INDEX >= SHIP_REGISTRY_START_INDEX
    ? GM_MARKET_ASSET_REGISTRY.slice(SHIP_REGISTRY_START_INDEX, SHIP_REGISTRY_END_INDEX + 1).map((entry) => entry.mint)
    : [],
);

class RpcRequestRateLimiter {
  private queue: Promise<void> = Promise.resolve();
  private nextRequestAtMs = 0;
  private readonly sharedLimiter = new RpcLimiter();
  private readonly lastSharedWaitLogAtMs = new Map<string, number>();

  constructor(
    private readonly getRequestsPerSecond: () => number,
    private readonly logger: BotLogger,
    private readonly useSharedLimiter: () => boolean,
    private readonly metricsApp: string,
    private readonly metricsProfile: string = 'default',
  ) {}

  async wait(label: string, bucketName: 'rpc:shared' | 'tx:shared' = 'rpc:shared', method: string = label): Promise<void> {
    const next = this.queue.then(async () => {
      if (this.useSharedLimiter()) {
        const sharedStartedAt = Date.now();
        const waitOptions = {
          label,
          metrics: {
            app: this.metricsApp,
            profile: this.metricsProfile,
            method,
          },
        };
        await this.sharedLimiter.wait(bucketName, waitOptions);
        const sharedWaitMs = Date.now() - sharedStartedAt;
        const logKey = `${bucketName}:${label}`;
        const lastLoggedAt = this.lastSharedWaitLogAtMs.get(logKey) ?? 0;
        const now = Date.now();
        if (sharedWaitMs > RPC_LIMITER_SLOW_WAIT_LOG_MS && now - lastLoggedAt >= RPC_LIMITER_WAIT_LOG_THROTTLE_MS) {
          const prefix = bucketName === 'tx:shared' ? 'TX limiter' : 'RPC limiter';
          this.logger.info(`${prefix} waiting for ${label}.`);
          this.lastSharedWaitLogAtMs.set(logKey, now);
        }
      }

      const requestsPerSecond = Math.max(0.000001, this.getRequestsPerSecond());
      const waitMs = Math.max(0, this.nextRequestAtMs - Date.now());
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      this.nextRequestAtMs = Date.now() + 1000 / requestsPerSecond;
    });

    this.queue = next.then(
      () => undefined,
      () => undefined,
    );

    await next;
  }

  penalize(waitMs: number) {
    this.nextRequestAtMs = Math.max(this.nextRequestAtMs, Date.now() + waitMs);
  }
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.trim();
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isRpcRateLimitError(error: unknown): boolean {
  const text = getErrorText(error).toLowerCase();
  return text.includes('429') || text.includes('too many requests') || text.includes('rate limit');
}

function isTransientRpcTransportError(error: unknown): boolean {
  const text = getErrorText(error).toLowerCase();
  return (
    text.includes('fetch failed') ||
    text.includes('network error') ||
    text.includes('socket hang up') ||
    text.includes('econnreset') ||
    text.includes('econnrefused') ||
    text.includes('etimedout') ||
    text.includes('timeout') ||
    text.includes('und_err_connect_timeout') ||
    text.includes('und_err_headers_timeout') ||
    text.includes('und_err_socket') ||
    text.includes('terminated')
  );
}

async function getSendTransactionLogs(error: unknown, connection: Connection): Promise<string[] | null> {
  if (error instanceof SendTransactionError) {
    try {
      return await error.getLogs(connection);
    } catch {
      return error.logs ?? error.transactionError.logs ?? null;
    }
  }

  const maybeGetLogs = (error as { getLogs?: unknown } | null)?.getLogs;
  if (typeof maybeGetLogs === 'function') {
    try {
      const logs = await maybeGetLogs.call(error, connection);
      return Array.isArray(logs) ? logs.map(String) : null;
    } catch {
      return null;
    }
  }

  return null;
}

async function callRpcWithRateLimitRetry<T>(
  label: string,
  invoke: () => Promise<T>,
  limiter: RpcRequestRateLimiter,
  logger: BotLogger,
  bucketName: 'rpc:shared' | 'tx:shared' = 'rpc:shared',
  method: string = label,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      await limiter.wait(label, bucketName, method);
      return await invoke();
    } catch (error) {
      const isRateLimit = isRpcRateLimitError(error);
      const isTransientTransport = isTransientRpcTransportError(error);
      const retryDelaysMs = isRateLimit ? RPC_RATE_LIMIT_RETRY_DELAYS_MS : RPC_TRANSIENT_TRANSPORT_RETRY_DELAYS_MS;
      const retryDelayMs = retryDelaysMs[attempt];
      if ((!isRateLimit && !isTransientTransport) || retryDelayMs === undefined) {
        throw error;
      }

      if (isRateLimit) {
        logger.warn(
          `RPC rate limit for ${label}; retrying in ${retryDelayMs}ms (${attempt + 1}/${retryDelaysMs.length}).`,
        );
        limiter.penalize(retryDelayMs);
      } else {
        logger.warn(
          `Transient RPC transport failure for ${label}; retrying in ${retryDelayMs}ms ` +
            `(${attempt + 1}/${retryDelaysMs.length}).`,
          error,
        );
      }
      await sleep(retryDelayMs);
    }
  }
}

function createFailoverConnection(
  primaryUrl: string,
  fallbackUrl: string | undefined,
  logger: BotLogger,
  getRequestsPerSecond: () => number,
  useSharedLimiter: () => boolean,
  metricsProfile: string,
  recordRpcMethodCounters?: (snapshot: RpcMethodCounterSnapshot) => void,
): Connection {
  const connectionConfig = { commitment: 'confirmed' as const, disableRetryOnRateLimit: true };
  const primary = new Connection(primaryUrl, connectionConfig);
  const fallback = fallbackUrl && fallbackUrl !== primaryUrl ? new Connection(fallbackUrl, connectionConfig) : null;
  const limiter = new RpcRequestRateLimiter(getRequestsPerSecond, logger, useSharedLimiter, 'LM Market Bot', metricsProfile);
  const rpcReadCache = new Map<string, { expiresAt: number; value: unknown }>();
  type LatestBlockhashContextResult = RpcResponseAndContext<BlockhashWithExpiryBlockHeight>;
  const latestBlockhashCache = new Map<string, { expiresAt: number; result: LatestBlockhashContextResult }>();
  const latestBlockhashInFlight = new Map<string, Promise<LatestBlockhashContextResult>>();
  const rpcMethodCounters = new Map<string, RpcMethodCounter>();
  const rpcIntervalMethodCounters = new Map<string, RpcMethodCounter>();
  const rpcCounterStartedAtMs = Date.now();
  let lastRpcMethodCounterResetAtMs = rpcCounterStartedAtMs;
  let lastRpcMethodCounterLogAtMs = 0;

  const getRpcMethodCounter = (counters: Map<string, RpcMethodCounter>, method: string): RpcMethodCounter => {
    const existing = counters.get(method);
    if (existing) {
      return existing;
    }
    const next = { network: 0, fallback: 0, cache: 0, joined: 0 };
    counters.set(method, next);
    return next;
  };

  const formatRpcMethodCounters = (counters: Map<string, RpcMethodCounter>): string[] => {
    return [...counters.entries()]
      .filter(([, counter]) => counter.network || counter.fallback || counter.cache || counter.joined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, counter]) => {
        return `${name}: net=${counter.network}, fallback=${counter.fallback}, cache=${counter.cache}, joined=${counter.joined}`;
      });
  };

  const snapshotRpcMethodCounters = (counters: Map<string, RpcMethodCounter>): Record<string, RpcMethodCounter> => {
    return Object.fromEntries(
      [...counters.entries()]
        .filter(([, counter]) => counter.network || counter.fallback || counter.cache || counter.joined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, counter]) => [
          name,
          {
            network: counter.network,
            fallback: counter.fallback,
            cache: counter.cache,
            joined: counter.joined,
          },
        ]),
    );
  };

  const clearRpcMethodCounters = (counters: Map<string, RpcMethodCounter>): void => {
    for (const counter of counters.values()) {
      counter.network = 0;
      counter.fallback = 0;
      counter.cache = 0;
      counter.joined = 0;
    }
  };

  const logRpcMethodCounters = (now: number): void => {
    const intervalParts = formatRpcMethodCounters(rpcIntervalMethodCounters);
    const totalParts = formatRpcMethodCounters(rpcMethodCounters);
    if (!intervalParts.length && !totalParts.length) {
      return;
    }
    const intervalSeconds = Math.max(1, Math.round((now - lastRpcMethodCounterResetAtMs) / 1000));
    const uptimeSeconds = Math.max(1, Math.round((now - rpcCounterStartedAtMs) / 1000));
    const snapshot: RpcMethodCounterSnapshot = {
      version: APP_VERSION,
      profile: metricsProfile,
      pid: process.pid,
      timestamp: new Date(now).toISOString(),
      intervalSeconds,
      uptimeSeconds,
      interval: snapshotRpcMethodCounters(rpcIntervalMethodCounters),
      total: snapshotRpcMethodCounters(rpcMethodCounters),
    };
    logger.info(
      `RPC method counters v${APP_VERSION} profile=${metricsProfile} pid=${process.pid} ` +
        `interval=${intervalSeconds}s uptime=${uptimeSeconds}s | interval ${intervalParts.join(' | ')} | total ${totalParts.join(' | ')}`,
    );
    recordRpcMethodCounters?.(snapshot);
    clearRpcMethodCounters(rpcIntervalMethodCounters);
    lastRpcMethodCounterResetAtMs = now;
  };

  const countRpcMethod = (method: string, field: RpcCounterField): void => {
    getRpcMethodCounter(rpcMethodCounters, method)[field] += 1;
    getRpcMethodCounter(rpcIntervalMethodCounters, method)[field] += 1;
    const now = Date.now();
    if (now - lastRpcMethodCounterLogAtMs < RPC_METHOD_COUNTER_LOG_INTERVAL_MS) {
      return;
    }
    lastRpcMethodCounterLogAtMs = now;
    logRpcMethodCounters(now);
  };

  const getLatestBlockhashConfig = (arg: unknown): { commitment: Commitment | 'default'; minContextSlot?: number } => {
    if (typeof arg === 'string') {
      return { commitment: arg as Commitment };
    }
    if (arg && typeof arg === 'object') {
      const config = arg as GetLatestBlockhashConfig;
      return {
        commitment: config.commitment ?? 'default',
        minContextSlot: typeof config.minContextSlot === 'number' ? config.minContextSlot : undefined,
      };
    }
    return { commitment: 'default' };
  };

  const getLatestBlockhashCacheKey = (args: unknown[]): string => {
    const config = getLatestBlockhashConfig(args[0]);
    return `commitment:${String(config.commitment)}`;
  };

  const isLatestBlockhashUsable = (cached: { expiresAt: number; result: LatestBlockhashContextResult }, args: unknown[]): boolean => {
    if (cached.expiresAt <= Date.now()) {
      return false;
    }
    const minContextSlot = getLatestBlockhashConfig(args[0]).minContextSlot;
    return minContextSlot === undefined || cached.result.context.slot >= minContextSlot;
  };

  const fetchLatestBlockhashContext = async (args: unknown[]): Promise<LatestBlockhashContextResult> => {
    const label = 'Connection.getLatestBlockhashAndContext()';
    try {
      const result = await callRpcWithRateLimitRetry(
        label,
        () => primary.getLatestBlockhashAndContext(args[0] as Commitment | GetLatestBlockhashConfig | undefined),
        limiter,
        logger,
        'rpc:shared',
        'getLatestBlockhash',
      );
      countRpcMethod('getLatestBlockhash.network', 'network');
      return result;
    } catch (error) {
      if (!fallback) {
        throw error;
      }
      logger.warn('Primary RPC failed for Connection.getLatestBlockhashAndContext(), trying fallback RPC.', error);
      const result = await callRpcWithRateLimitRetry(
        'fallback Connection.getLatestBlockhashAndContext()',
        () => fallback.getLatestBlockhashAndContext(args[0] as Commitment | GetLatestBlockhashConfig | undefined),
        limiter,
        logger,
        'rpc:shared',
        'getLatestBlockhash',
      );
      countRpcMethod('getLatestBlockhash.network', 'fallback');
      return result;
    }
  };

  const readLatestBlockhash = async (
    method: 'getLatestBlockhash' | 'getLatestBlockhashAndContext',
    args: unknown[],
  ): Promise<BlockhashWithExpiryBlockHeight | LatestBlockhashContextResult> => {
    const selectResult = (result: LatestBlockhashContextResult): BlockhashWithExpiryBlockHeight | LatestBlockhashContextResult => {
      return method === 'getLatestBlockhash' ? result.value : result;
    };
    const key = getLatestBlockhashCacheKey(args);
    const cached = latestBlockhashCache.get(key);
    if (cached && isLatestBlockhashUsable(cached, args)) {
      countRpcMethod(method, 'cache');
      return selectResult(cached.result);
    }
    if (cached) {
      latestBlockhashCache.delete(key);
    }

    const existing = latestBlockhashInFlight.get(key);
    if (existing) {
      countRpcMethod(method, 'joined');
      const result = await existing;
      if (!isLatestBlockhashUsable({ expiresAt: Date.now() + RPC_LATEST_BLOCKHASH_REUSE_MS, result }, args)) {
        return await readLatestBlockhash(method, args);
      }
      return selectResult(result);
    }

    const next = fetchLatestBlockhashContext(args)
      .then((result) => {
        latestBlockhashCache.set(key, { expiresAt: Date.now() + RPC_LATEST_BLOCKHASH_REUSE_MS, result });
        return result;
      })
      .finally(() => {
        latestBlockhashInFlight.delete(key);
      });
    latestBlockhashInFlight.set(key, next);
    const result = await next;
    return selectResult(result);
  };

  const getCacheKey = (method: string, args: unknown[]): string | null => {
    if (method === 'getMinimumBalanceForRentExemption') {
      return `${method}:${String(args[0] ?? '')}:${String(args[1] ?? 'default')}`;
    }
    if (method === 'getAccountInfo' || method === 'getParsedAccountInfo') {
      const pubkey = args[0] as { toBase58?: () => string; toString?: () => string } | undefined;
      const pubkeyText = typeof pubkey?.toBase58 === 'function' ? pubkey.toBase58() : pubkey?.toString?.();
      if (!pubkeyText) {
        return null;
      }
      return `${method}:${pubkeyText}:${String(args[1] ?? 'default')}`;
    }
    return null;
  };

  const readCachedRpcValue = (method: string, args: unknown[]): unknown | undefined => {
    const key = getCacheKey(method, args);
    if (!key) {
      return undefined;
    }
    const cached = rpcReadCache.get(key);
    if (!cached || cached.expiresAt <= Date.now()) {
      rpcReadCache.delete(key);
      return undefined;
    }
    return cached.value;
  };

  const writeCachedRpcValue = (method: string, args: unknown[], value: unknown): void => {
    const key = getCacheKey(method, args);
    if (!key) {
      return;
    }

    let ttlMs = 0;
    let shouldCache = false;
    if (method === 'getMinimumBalanceForRentExemption') {
      ttlMs = RPC_RENT_EXEMPTION_CACHE_TTL_MS;
      shouldCache = typeof value === 'number';
    } else if (method === 'getAccountInfo') {
      ttlMs = RPC_ACCOUNT_INFO_CACHE_TTL_MS;
      shouldCache = value != null;
    } else if (method === 'getParsedAccountInfo') {
      const parsed = value as { value?: unknown } | null;
      ttlMs = RPC_ACCOUNT_INFO_CACHE_TTL_MS;
      shouldCache = parsed?.value != null;
    }

    if (shouldCache) {
      rpcReadCache.set(key, { expiresAt: Date.now() + ttlMs, value });
    }
  };

  return new Proxy(primary, {
    get(target, prop, receiver) {
      const primaryValue = Reflect.get(target, prop, receiver);
      if (typeof primaryValue !== 'function') {
        return primaryValue;
      }

      const fallbackValue = fallback ? Reflect.get(fallback, prop, fallback) : null;

      return async (...args: unknown[]) => {
        const method = String(prop);
        if (method === 'getLatestBlockhash' || method === 'getLatestBlockhashAndContext') {
          return await readLatestBlockhash(method, args);
        }
        const cached = readCachedRpcValue(method, args);
        if (cached !== undefined) {
          countRpcMethod(method, 'cache');
          return cached;
        }
        const label = `Connection.${String(prop)}()`;
        const bucketName = prop === 'sendRawTransaction' ? 'tx:shared' : 'rpc:shared';
        try {
          const result = await callRpcWithRateLimitRetry(
            label,
            () => primaryValue.apply(target, args),
            limiter,
            logger,
            bucketName,
            method,
          );
          countRpcMethod(method, 'network');
          writeCachedRpcValue(method, args, result);
          return result;
        } catch (error) {
          if (!fallback || typeof fallbackValue !== 'function') {
            throw error;
          }
          logger.warn(`Primary RPC failed for Connection.${String(prop)}(), trying fallback RPC.`, error);
          const result = await callRpcWithRateLimitRetry(
            `fallback Connection.${String(prop)}()`,
            () => fallbackValue.apply(fallback, args),
            limiter,
            logger,
            bucketName,
            method,
          );
          countRpcMethod(method, 'fallback');
          writeCachedRpcValue(method, args, result);
          return result;
        }
      };
    },
  }) as Connection;
}

export type AssetRuleSide = 'buy' | 'sell';

export type AssetRuleInput = {
  starbase?: string | null;
  asset?: string | null;
  group?: string | null;
  side?: string | null;
  quantity?: string | number | null;
  limit?: string | number | null;
  price?: string | number | null;
  refill?: boolean | string | number | null;
  minQuantity?: string | number | null;
  maxQuantity?: string | number | null;
  minBuyPrice?: string | number | null;
  maxBuyPrice?: string | number | null;
  minSellPrice?: string | number | null;
  maxSellPrice?: string | number | null;
};

export type AssetRuleConfig = {
  starbase: string;
  asset: string;
  group: AssetRegistryGroup;
  side: AssetRuleSide;
  quantity: number;
  limit: number | null;
  price: number;
  refill: boolean;
  minQuantity: number;
  minPrice: number | null;
  maxPrice: number | null;
};

export type BotInputConfig = {
  AEPHIA_API_KEY?: string;
  FACTION?: string;
  OWNER_WALLET?: string;
  OWNER_PROFILE?: string;
  RPC_URL?: string;
  RPC_URL_FALLBACK?: string;
  HOT_WALLET_SECRET?: string;
  MIN_SELL_QUANTITY?: string | number;
  MIN_PRICE?: string | number;
  RPC_REQUESTS_PER_SECOND?: string | number;
  RPC_TX_SEND_RATE_LIMIT_PER_SECOND?: string | number;
  USE_RPC_LIMITER?: string | number | boolean;
  useRpcLimiter?: string | number | boolean;
  CHAIN_STATUS_REFRESH_INTERVAL_MINUTES?: string | number;
  CHECK_INTERVAL_MINUTES?: string | number;
  RELEVANT_SELL_ORDER_PCT?: string | number;
  RELEVANT_BUY_ORDER_PCT?: string | number;
  RESOURCE_LIST?: string;
  ANALYSIS_DIR?: string;
  assetRules?: AssetRuleInput[] | null;
};

type ResourceConfig = {
  name: string;
  mint: PublicKey;
};

type MarketOrderSnapshot = {
  allOrdersRaw: Order[];
  myOrdersRaw: Order[];
};

type MarketOrderSnapshotCacheEntry = {
  expiresAt: number;
  promise: Promise<MarketOrderSnapshot>;
};

type MarketLeaderCacheEntry = {
  expiresAt: number;
  bestBuyPrice: number | null;
  bestSellPrice: number | null;
};

type MarketLeaderThresholdsCacheEntry = {
  expiresAt: number;
  promise: Promise<Map<string, { buy: number; sell: number }>>;
};

type MyOpenOrdersCacheEntry = {
  expiresAt: number;
  promise: Promise<Order[]>;
};

type OpenOrderReadOptions = {
  refresh?: boolean;
};

type OpenOrderStatusTarget = {
  resource: ResourceConfig;
  displayResource: ResourceConfig;
  starbase: string;
  sideFilter?: AssetRuleSide;
  ruleIndex?: number;
  passiveCache: boolean;
};

type DesiredBuyOrder = {
  rule: AssetRuleConfig;
  ruleIndex: number;
  targetPrice: number;
  targetQuantity: number;
  maxBuyPrice: number;
  quoteSymbol: 'ATLAS' | 'USDC';
};

type DesiredSellOrder = {
  rule: AssetRuleConfig;
  ruleIndex: number;
  targetPrice: number;
  targetQuantity: number;
  minSellQuantity: number;
  refillEnabled: boolean;
  quoteSymbol: 'ATLAS' | 'USDC';
};

export type OrderSnapshot = {
  price: number;
  remaining: number;
  quantity?: number;
  updatedAt?: string;
};

type ResourceSideOrderState = {
  openOrders: Record<string, OrderSnapshot>;
  lastWalletBalance?: number;
};

type ResourceOrderState = {
  buy: ResourceSideOrderState;
  sell: ResourceSideOrderState;
};

export type BotState = Record<string, ResourceOrderState>;

export type TrackedOrderTransition =
  | { kind: 'partial-fill'; filledDelta: number; remaining: number }
  | { kind: 'full-fill'; filledDelta: number; remaining: 0 }
  | null;

export function classifyTrackedOrderTransition(
  previous: OrderSnapshot,
  currentRemaining: number | null,
  wasCancelled: boolean,
): TrackedOrderTransition {
  if (currentRemaining !== null) {
    if (currentRemaining < previous.remaining) {
      return {
        kind: 'partial-fill',
        filledDelta: previous.remaining - currentRemaining,
        remaining: currentRemaining,
      };
    }
    return null;
  }

  if (wasCancelled) return null;
  return {
    kind: 'full-fill',
    filledDelta: previous.remaining,
    remaining: 0,
  };
}

type CargoPodTokenAccountInfo = {
  cargoPod: PublicKey;
  tokenAccount: PublicKey;
  balance: number;
};

type CargoPodTokenInventoryCacheEntry = {
  expiresAt: number;
  promise: Promise<Map<string, CargoPodTokenAccountInfo>>;
};

type ExpiringPromiseCacheEntry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

type LocalMarketSellContextCacheEntry = {
  expiresAt: number;
  context: LocalMarketSellContext | null;
};

type LocalMarketSellContext = {
  rawResource: ResourceConfig;
  certificateResource: ResourceConfig;
  starbase: PublicKey;
  starbasePlayer: PublicKey;
  cargoPod: PublicKey;
  cargoTokenAccount: PublicKey;
  starbaseCargoTokenAccount: PublicKey;
  cargoType: PublicKey;
  certificateMint: PublicKey;
  certificateTokenAccount: PublicKey;
  gameId: PublicKey;
  gameState: PublicKey;
  profileFaction: PublicKey;
  profileKeyIndex: number;
};

type CrewDepositContext = {
  targetStarbaseName: string;
  crewOwner: PublicKey;
  starbase: PublicKey;
  starbasePlayer: PublicKey;
  gameId: PublicKey;
  profileFaction: PublicKey;
  crewProgramConfig: PublicKey;
  allowedMerkleTrees: Set<string>;
  collectionMint: PublicKey;
};

type DasAsset = {
  id?: string;
  burnt?: boolean;
  compression?: {
    compressed?: boolean;
    data_hash?: string;
    creator_hash?: string;
    tree?: string;
    leaf_id?: number;
  };
  grouping?: Array<{ group_key?: string; group_value?: string }>;
  ownership?: {
    owner?: string;
    delegate?: string | null;
    delegated?: boolean;
  };
  content?: {
    metadata?: {
      name?: string;
    };
  };
};

type DasAssetList = {
  total?: number;
  limit?: number;
  page?: number;
  items?: DasAsset[];
};

type DasAssetProof = {
  root?: string;
  proof?: string[];
  node_index?: number;
  leaf?: string;
  tree_id?: string;
};

type CrewAssetCandidate = {
  id: string;
  name: string;
  merkleTree: PublicKey;
  dataHash: PublicKey;
  creatorHash: PublicKey;
  leafIndex: number;
};

type CrewAssetWithProof = CrewAssetCandidate & {
  root: PublicKey;
  proof: PublicKey[];
};

type IndexedAssetRule = {
  index: number;
  rule: AssetRuleConfig;
};

type GroupedAssetRules = {
  asset: string;
  group: AssetRegistryGroup;
  starbase: string;
  rules: IndexedAssetRule[];
};

export type CancelOrderResult =
  | {
      ok: true;
      status: 'cancelled';
      asset: string;
      side: AssetRuleSide;
      orderId: string;
      tx: string;
    }
  | {
      ok: true;
      status: 'no_active_order';
      asset: string;
      side: AssetRuleSide;
    }
  | {
      ok: false;
      status: 'error';
      asset: string;
      side: AssetRuleSide;
      message: string;
    };

export type BotConfig = {
  rpcUrl: string;
  rpcUrlFallback?: string;
  faction: string;
  ownerWallet: string;
  ownerProfile: string;
  hotWalletSecret: string;
  minSellQuantity: number;
  minPrice: number;
  rpcRequestsPerSecond: number;
  rpcTxSendRateLimitPerSecond: number;
  useRpcLimiter: boolean;
  chainStatusRefreshIntervalMinutes: number;
  checkIntervalMinutes: number;
  relevantSellOrderPct: number;
  relevantBuyOrderPct: number;
  resourceList: string;
  analysisDir: string;
  assetRules: AssetRuleConfig[];
};

export type BotLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type RpcCounterField = 'network' | 'fallback' | 'cache' | 'joined';
type RpcMethodCounter = Record<RpcCounterField, number>;
type RpcMethodCounterSnapshot = {
  version: string;
  profile: string;
  pid: number;
  timestamp: string;
  intervalSeconds: number;
  uptimeSeconds: number;
  interval: Record<string, RpcMethodCounter>;
  total: Record<string, RpcMethodCounter>;
};

export type BotOpenOrderStatus = {
  id: string;
  starbase: string;
  asset: string;
  mint: string;
  side: AssetRuleSide;
  price: number;
  quantity: number | null;
  remaining: number;
  partiallyFilled: boolean;
  updatedAt?: string;
  marketLeader?: 'hb' | 'ba';
  currency?: string;
};

export type BotInventoryStatus = {
  starbase: string;
  asset: string;
  mint: string;
  balance: number;
  source: 'starbase-cargo-pod';
};

export type BotCertificateStatus = {
  starbase: string;
  asset: string;
  ruleAsset: string;
  rawMint: string;
  certificateMint: string;
  certificateTokenAccount: string;
  balance: number;
};

export type BotRecentActivity = {
  timestamp: string;
  event: string;
  side?: AssetRuleSide;
  asset?: string;
  resource?: string;
  message?: string;
  price?: number;
  quantity?: number;
  remaining?: number;
  rulesChecked?: number;
  changes?: number;
  skips?: number;
  errors?: number;
  nextDelayMinutes?: number;
  tx?: string;
};

type CycleStats = {
  rulesChecked: number;
  loggedEvents: number;
  changes: number;
  skips: number;
  errors: number;
  retryableSkips: number;
};

export type BotRuleHealthStatus = {
  asset: string;
  side: AssetRuleSide;
  configuredQuantity: number | null;
  configuredPrice: number | null;
  status: 'active' | 'idle' | 'duplicate';
  openOrderId?: string;
  openOrderPrice?: number;
  openOrderRemaining?: number;
  partiallyFilled?: boolean;
  note?: string;
};

export type BotStatusSnapshot = {
  version: string;
  running: boolean;
  wallet: string;
  solBalance: number;
  atlasBalance: number;
  usdcBalance: number;
  startedAt: string | null;
  lastCycleStartedAt: string | null;
  lastCycleCompletedAt: string | null;
  lastCycleDurationMs: number | null;
  nextCycleDelayMinutes: number | null;
  trackedAssetCount: number;
  activeRuleCount: number;
  openOrders: BotOpenOrderStatus[];
  inventory: BotInventoryStatus[];
  certificates: BotCertificateStatus[];
  recentActivity: BotRecentActivity[];
  ruleHealth: BotRuleHealthStatus[];
};

export type CrewDepositStatus = {
  ok: boolean;
  ready: boolean;
  status: string;
  batchSize: number;
  availableCrew: number | null;
  message?: string;
};

const defaultLogger: BotLogger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

export const EDITABLE_CONFIG_KEYS = [
  'AEPHIA_API_KEY',
  'FACTION',
  'OWNER_WALLET',
  'OWNER_PROFILE',
  'RPC_URL',
  'RPC_URL_FALLBACK',
  'HOT_WALLET_SECRET',
  'MIN_SELL_QUANTITY',
  'MIN_PRICE',
  'RPC_REQUESTS_PER_SECOND',
  'RPC_TX_SEND_RATE_LIMIT_PER_SECOND',
  'USE_RPC_LIMITER',
  'CHAIN_STATUS_REFRESH_INTERVAL_MINUTES',
  'CHECK_INTERVAL_MINUTES',
  'RELEVANT_SELL_ORDER_PCT',
  'RELEVANT_BUY_ORDER_PCT',
  'RESOURCE_LIST',
] as const;

export type EditableConfig = Record<(typeof EDITABLE_CONFIG_KEYS)[number], string>;

export function getEditableConfigFromEnv(env: Partial<Record<string, string | undefined>> = {}): EditableConfig {
  return {
    AEPHIA_API_KEY: env.AEPHIA_API_KEY ?? '',
    FACTION: env.FACTION ?? 'ONI',
    OWNER_WALLET: env.OWNER_WALLET ?? '',
    OWNER_PROFILE: env.OWNER_PROFILE ?? '',
    RPC_URL: env.RPC_URL ?? 'https://api.mainnet-beta.solana.com',
    RPC_URL_FALLBACK: env.RPC_URL_FALLBACK ?? '',
    HOT_WALLET_SECRET: env.HOT_WALLET_SECRET ?? '',
    MIN_SELL_QUANTITY: env.MIN_SELL_QUANTITY ?? '1000000',
    MIN_PRICE: env.MIN_PRICE ?? '0.00085',
    RPC_REQUESTS_PER_SECOND: env.RPC_REQUESTS_PER_SECOND ?? String(DEFAULT_RPC_REQUESTS_PER_SECOND),
    RPC_TX_SEND_RATE_LIMIT_PER_SECOND: env.RPC_TX_SEND_RATE_LIMIT_PER_SECOND ?? String(DEFAULT_RPC_TX_SEND_RATE_LIMIT_PER_SECOND),
    USE_RPC_LIMITER: env.USE_RPC_LIMITER ?? 'false',
    CHAIN_STATUS_REFRESH_INTERVAL_MINUTES:
      env.CHAIN_STATUS_REFRESH_INTERVAL_MINUTES ?? String(DEFAULT_CHAIN_STATUS_REFRESH_INTERVAL_MINUTES),
    CHECK_INTERVAL_MINUTES: env.CHECK_INTERVAL_MINUTES ?? '30',
    RELEVANT_SELL_ORDER_PCT: env.RELEVANT_SELL_ORDER_PCT ?? '20',
    RELEVANT_BUY_ORDER_PCT: env.RELEVANT_BUY_ORDER_PCT ?? '10',
    RESOURCE_LIST: env.RESOURCE_LIST ?? formatAssetRegistryResourceList(),
  };
}

export function buildBotConfig(input: BotInputConfig): BotConfig {
  const editable = getEditableConfigFromEnv({
    AEPHIA_API_KEY: input.AEPHIA_API_KEY as string | undefined,
    FACTION: input.FACTION as string | undefined,
    OWNER_WALLET: input.OWNER_WALLET as string | undefined,
    OWNER_PROFILE: input.OWNER_PROFILE as string | undefined,
    RPC_URL: input.RPC_URL as string | undefined,
    RPC_URL_FALLBACK: input.RPC_URL_FALLBACK as string | undefined,
    HOT_WALLET_SECRET: input.HOT_WALLET_SECRET as string | undefined,
    MIN_SELL_QUANTITY: input.MIN_SELL_QUANTITY as string | undefined,
    MIN_PRICE: input.MIN_PRICE as string | undefined,
    RPC_REQUESTS_PER_SECOND: input.RPC_REQUESTS_PER_SECOND as string | undefined,
    RPC_TX_SEND_RATE_LIMIT_PER_SECOND: input.RPC_TX_SEND_RATE_LIMIT_PER_SECOND as string | undefined,
    USE_RPC_LIMITER: String(input.useRpcLimiter ?? input.USE_RPC_LIMITER ?? ''),
    CHAIN_STATUS_REFRESH_INTERVAL_MINUTES: input.CHAIN_STATUS_REFRESH_INTERVAL_MINUTES as string | undefined,
    CHECK_INTERVAL_MINUTES: input.CHECK_INTERVAL_MINUTES as string | undefined,
    RELEVANT_SELL_ORDER_PCT: input.RELEVANT_SELL_ORDER_PCT as string | undefined,
    RELEVANT_BUY_ORDER_PCT: input.RELEVANT_BUY_ORDER_PCT as string | undefined,
    RESOURCE_LIST: input.RESOURCE_LIST as string | undefined,
  });

  const minSellQuantity = parsePositiveInteger(editable.MIN_SELL_QUANTITY, 'MIN_SELL_QUANTITY');
  const minPrice = parsePositiveNumber(editable.MIN_PRICE, 'MIN_PRICE');
  const rpcRequestsPerSecond = Math.min(
    parsePositiveNumber(editable.RPC_REQUESTS_PER_SECOND, 'RPC_REQUESTS_PER_SECOND'),
    MAX_RPC_REQUESTS_PER_SECOND,
  );
  const rpcTxSendRateLimitPerSecond = parsePositiveNumber(
    editable.RPC_TX_SEND_RATE_LIMIT_PER_SECOND,
    'RPC_TX_SEND_RATE_LIMIT_PER_SECOND',
  );
  const useRpcLimiter = parseBoolean(editable.USE_RPC_LIMITER);
  const chainStatusRefreshIntervalMinutes = parsePositiveNumber(
    editable.CHAIN_STATUS_REFRESH_INTERVAL_MINUTES,
    'CHAIN_STATUS_REFRESH_INTERVAL_MINUTES',
  );
  const checkIntervalMinutes = parsePositiveInteger(editable.CHECK_INTERVAL_MINUTES, 'CHECK_INTERVAL_MINUTES');
  const relevantSellOrderPct = parsePositivePercentage(editable.RELEVANT_SELL_ORDER_PCT, 'RELEVANT_SELL_ORDER_PCT');
  const relevantBuyOrderPct = parsePositivePercentage(editable.RELEVANT_BUY_ORDER_PCT, 'RELEVANT_BUY_ORDER_PCT');
  const assetRules = parseAssetRules(input.assetRules);

  if (!editable.HOT_WALLET_SECRET) {
    throw new Error('HOT_WALLET_SECRET env variable missing');
  }

  return {
    rpcUrl: editable.RPC_URL,
    rpcUrlFallback: editable.RPC_URL_FALLBACK || undefined,
    faction: editable.FACTION,
    ownerWallet: editable.OWNER_WALLET,
    ownerProfile: editable.OWNER_PROFILE,
    hotWalletSecret: editable.HOT_WALLET_SECRET,
    minSellQuantity,
    minPrice,
    rpcRequestsPerSecond,
    rpcTxSendRateLimitPerSecond,
    useRpcLimiter,
    chainStatusRefreshIntervalMinutes,
    checkIntervalMinutes,
    relevantSellOrderPct,
    relevantBuyOrderPct,
    resourceList: editable.RESOURCE_LIST,
    analysisDir: input.ANALYSIS_DIR || 'analysis',
    assetRules,
  };
}

function parsePositiveInteger(value: string | number, fieldName: string): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return parsed;
}

function parsePositiveNumber(value: string | number, fieldName: string): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be set to a positive number`);
  }

  return parsed;
}

function parseBoolean(value: string | number | boolean | null | undefined): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parsePositivePercentage(value: string | number, fieldName: string): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
    throw new Error(`${fieldName} must be a positive percentage between 0 and 100`);
  }

  return parsed;
}

export function parseAssetRules(input?: AssetRuleInput[] | null): AssetRuleConfig[] {
  if (!input || input.length === 0) {
    return [];
  }

  return input.flatMap((rule, index) => {
    if (!isRunnableAssetRuleInput(rule)) {
      return [];
    }
    return parseAssetRuleInput(rule, index);
  });
}

function isRunnableAssetRuleInput(rule: AssetRuleInput | null | undefined): rule is AssetRuleInput {
  if (!String(rule?.asset ?? '').trim()) {
    return false;
  }

  if (isStrategyAssetRuleInput(rule)) {
    return Boolean(String(rule?.minQuantity ?? '').trim() && String(rule?.maxQuantity ?? '').trim());
  }

  return Boolean(
    String(rule?.quantity ?? '').trim() &&
      String(rule?.price ?? '').trim(),
  );
}

function isStrategyAssetRuleInput(input: AssetRuleInput | null | undefined): boolean {
  return (
    Object.prototype.hasOwnProperty.call(input || {}, 'minQuantity') ||
    Object.prototype.hasOwnProperty.call(input || {}, 'maxQuantity') ||
    Object.prototype.hasOwnProperty.call(input || {}, 'minBuyPrice') ||
    Object.prototype.hasOwnProperty.call(input || {}, 'maxBuyPrice') ||
    Object.prototype.hasOwnProperty.call(input || {}, 'minSellPrice') ||
    Object.prototype.hasOwnProperty.call(input || {}, 'maxSellPrice')
  );
}

function parseAssetRuleInput(input: AssetRuleInput, index?: number): AssetRuleConfig[] {
  if (isStrategyAssetRuleInput(input)) {
    return parseStrategyAssetRule(input, index);
  }
  return [parseLegacyAssetRule(input, index)];
}

export function parseAssetRule(input: AssetRuleInput, index?: number): AssetRuleConfig {
  return parseAssetRuleInput(input, index)[0];
}

function parseLegacyAssetRule(input: AssetRuleInput, index?: number): AssetRuleConfig {
  const label = typeof index === 'number' ? 'assetRules[' + index + ']' : 'assetRule';

  const starbase = parseStarbaseName(input.starbase, label + '.starbase');
  const asset = parseNonEmptyString(input.asset, label + '.asset');
  const group = normalizeAssetRuleGroup(input.group, asset);
  const side = parseAssetRuleSide(input.side, label + '.side');
  const quantity = parseRuleQuantity(input.quantity, label + '.quantity');
  const limit = parseOptionalRuleLimit(input.limit, label + '.limit');
  const price = parseRulePrice(input.price, label + '.price');

  return {
    starbase,
    asset,
    group,
    side,
    quantity,
    limit,
    price,
    refill: true,
    minQuantity: side === 'buy' ? 1 : quantity,
    minPrice: null,
    maxPrice: null,
  };
}

function parseStrategyAssetRule(input: AssetRuleInput, index?: number): AssetRuleConfig[] {
  const label = typeof index === 'number' ? 'assetRules[' + index + ']' : 'assetRule';
  const starbase = parseStarbaseName(input.starbase, label + '.starbase');
  const asset = parseNonEmptyString(input.asset, label + '.asset');
  const group = normalizeAssetRuleGroup(input.group, asset);
  const minQuantity = parseRuleQuantity(input.minQuantity, label + '.minQuantity');
  const maxQuantity = parseRuleQuantity(input.maxQuantity, label + '.maxQuantity');
  if (maxQuantity < minQuantity) {
    throw new Error(`${label}.maxQuantity must be greater than or equal to minQuantity`);
  }

  const refill = parseOptionalBoolean(input.refill, true);
  const minBuyPrice = parseOptionalRulePrice(input.minBuyPrice, label + '.minBuyPrice');
  const maxBuyPrice = parseOptionalRulePrice(input.maxBuyPrice, label + '.maxBuyPrice');
  const minSellPrice = parseOptionalRulePrice(input.minSellPrice, label + '.minSellPrice');
  const maxSellPrice = parseOptionalRulePrice(input.maxSellPrice, label + '.maxSellPrice');
  const rules: AssetRuleConfig[] = [];

  if (maxBuyPrice !== null) {
    if (minBuyPrice !== null && minBuyPrice > maxBuyPrice) {
      throw new Error(`${label}.minBuyPrice must be less than or equal to maxBuyPrice`);
    }
    rules.push({
      starbase,
      asset,
      group,
      side: 'buy',
      quantity: maxQuantity,
      limit: maxQuantity,
      price: maxBuyPrice,
      refill,
      minQuantity,
      minPrice: minBuyPrice,
      maxPrice: maxBuyPrice,
    });
  }

  if (minSellPrice !== null) {
    if (maxSellPrice !== null && maxSellPrice < minSellPrice) {
      throw new Error(`${label}.maxSellPrice must be greater than or equal to minSellPrice`);
    }
    rules.push({
      starbase,
      asset,
      group,
      side: 'sell',
      quantity: minQuantity,
      limit: maxQuantity,
      price: minSellPrice,
      refill,
      minQuantity,
      minPrice: minSellPrice,
      maxPrice: maxSellPrice,
    });
  }

  if (rules.length === 0) {
    throw new Error(`${label} must define Max Buy Price or Min Sell Price`);
  }

  return rules;
}

function parseAssetRuleSide(value: string | null | undefined, fieldName: string): AssetRuleSide {
  const normalized = parseNonEmptyString(value, fieldName).toLowerCase();

  if (normalized !== 'buy' && normalized !== 'sell') {
    throw new Error(`${fieldName} must be either "buy" or "sell"`);
  }

  return normalized;
}

function parseStarbaseName(value: string | null | undefined, fieldName: string): string {
  const normalized = normalizeStarbaseRegistryName(parseNonEmptyString(value, fieldName));
  if (!findStarbaseRegistryEntry(normalized)) {
    throw new Error(`${fieldName} must be a known starbase`);
  }

  return normalized;
}

function parseRuleQuantity(value: string | number | null | undefined, fieldName: string): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return parsed;
}

function parseOptionalRuleLimit(value: string | number | null | undefined, fieldName: string): number | null {
  if (value === null || typeof value === 'undefined' || String(value).trim() === '') {
    return null;
  }

  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be blank or a positive integer`);
  }

  return parsed;
}

function parseOptionalRulePrice(value: string | number | null | undefined, fieldName: string): number | null {
  if (value === null || typeof value === 'undefined' || String(value).trim() === '') {
    return null;
  }

  return parseRulePrice(value, fieldName);
}

function parseRulePrice(value: string | number | null | undefined, fieldName: string): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }

  return parsed;
}

function parseOptionalBoolean(value: boolean | string | number | null | undefined, fallback: boolean): boolean {
  if (typeof value === 'undefined' || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['false', '0', 'off', 'no', 'unchecked'].includes(normalized)) {
    return false;
  }
  if (['true', '1', 'on', 'yes', 'checked'].includes(normalized)) {
    return true;
  }
  return fallback;
}

function parseNonEmptyString(value: string | null | undefined, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return trimmed;
}

function resolveResourceForRule(rule: AssetRuleConfig): ResourceConfig {
  const assetName = String(rule.asset ?? '').split(':').map((part) => part.trim())[0];
  const groupedMatch = findAssetRegistryEntryForGroupAndName(rule.group, assetName);
  if (groupedMatch) {
    return {
      name: groupedMatch.name,
      mint: new PublicKey(groupedMatch.mint),
    };
  }

  return parseResourceEntry(rule.asset, 'assetRules.asset(' + rule.asset + ')');
}
function parseResourceEntry(entry: string, fieldName: string): ResourceConfig {
  const trimmed = entry.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  const [rawName, rawMint] = trimmed.split(':').map((part) => part.trim());
  const mintString = rawMint ?? rawName;
  if (!mintString) {
    throw new Error(`Invalid ${fieldName} entry: ${entry}`);
  }

  const name = rawMint ? rawName || mintString : mintString;
  return { name, mint: new PublicKey(mintString) };
}

function parseRuleResources(assetRules: AssetRuleConfig[]): ResourceConfig[] {
  const seen = new Set<string>();
  const resources: ResourceConfig[] = [];

  for (let i = 0; i < assetRules.length; i++) {
    const resource = resolveResourceForRule(assetRules[i]);
    const mintKey = resource.mint.toBase58();
    if (seen.has(mintKey)) {
      continue;
    }
    seen.add(mintKey);
    resources.push(resource);
  }

  return resources;
}

function mergeResources(...groups: ResourceConfig[][]): ResourceConfig[] {
  const seen = new Set<string>();
  const resources: ResourceConfig[] = [];

  for (const group of groups) {
    for (const resource of group) {
      const mintKey = resource.mint.toBase58();
      if (seen.has(mintKey)) {
        continue;
      }
      seen.add(mintKey);
      resources.push(resource);
    }
  }

  return resources;
}

function parseResources(resourceList: string): ResourceConfig[] {
  const resources = resourceList
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => parseResourceEntry(entry, 'RESOURCE_LIST'));

  if (resources.length === 0) {
    throw new Error('RESOURCE_LIST must define at least one resource');
  }

  return resources;
}

function decodeSecret(secret: string): Uint8Array {
  const trimmed = secret.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return Uint8Array.from(parsed);
      }
      throw new Error('HOT_WALLET_SECRET JSON value must be an array');
    } catch (err) {
      throw new Error(`Failed to parse HOT_WALLET_SECRET JSON: ${(err as Error).message}`);
    }
  }

  const hexLike = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  if (/^[0-9a-fA-F]+$/.test(hexLike)) {
    if (hexLike.length % 2 !== 0) {
      throw new Error('HOT_WALLET_SECRET hex value must have an even length');
    }
    return Uint8Array.from(Buffer.from(hexLike, 'hex'));
  }

  return bs58.decode(trimmed);
}

function getQuoteMintForResource(resource: ResourceConfig): PublicKey {
  const isShipMarket =
   SHIP_MINTS.has(resource.mint.toBase58()) || resource.name.endsWith(SHIP_PART_SUFFIX) || resource.name === SHIP_START_NAME || resource.name === SHIP_END_NAME;
  return isShipMarket ? QUOTE_USDC_MINT : QUOTE_ATLAS_MINT;
}

function getQuoteMintForRule(rule: AssetRuleConfig, resource?: ResourceConfig): PublicKey {
  if (rule.group === 'ships' || rule.group === 'ship-parts') {
    return QUOTE_USDC_MINT;
  }

  return resource ? getQuoteMintForResource(resource) : QUOTE_ATLAS_MINT;
}

function getQuoteSymbolForMint(quoteMint: PublicKey): 'ATLAS' | 'USDC' {
  return quoteMint.equals(QUOTE_USDC_MINT) ? 'USDC' : 'ATLAS';
}

function isOrderForQuoteMint(order: Order, quoteMint: PublicKey): boolean {
  return order.currencyMint === quoteMint.toBase58();
}

function getMarketLeaderCacheKey(mint: string, quoteMint: PublicKey): string {
  return `${mint}:${quoteMint.toBase58()}`;
}

function createEmptySideState(): ResourceSideOrderState {
  return { openOrders: {} };
}

function ensureResourceState(state: BotState, mintKey: string): ResourceOrderState {
  if (!state[mintKey]) {
    state[mintKey] = {
      buy: createEmptySideState(),
      sell: createEmptySideState(),
    };
  }

  if (!state[mintKey].buy) {
    state[mintKey].buy = createEmptySideState();
  }

  if (!state[mintKey].sell) {
    state[mintKey].sell = createEmptySideState();
  }

  return state[mintKey];
}

function getSideOrderType(side: AssetRuleSide): OrderSide {
  return side === 'buy' ? OrderSide.Buy : OrderSide.Sell;
}

function getSideState(resourceState: ResourceOrderState, side: AssetRuleSide): ResourceSideOrderState {
  return side === 'buy' ? resourceState.buy : resourceState.sell;
}

function roundDown(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.floor(value * factor) / factor;
}

function roundUp(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.ceil(value * factor) / factor;
}

function clampPrice(value: number, minPrice?: number | null, maxPrice?: number | null): number {
  let next = value;
  if (typeof minPrice === 'number') {
    next = Math.max(next, minPrice);
  }
  if (typeof maxPrice === 'number') {
    next = Math.min(next, maxPrice);
  }
  return next;
}

function sortOrdersForSide(side: AssetRuleSide, orders: Order[]): Order[] {
  return [...orders].sort((a, b) => (side === 'buy' ? b.uiPrice - a.uiPrice : a.uiPrice - b.uiPrice));
}

function normalizeAssetKey(asset: string): string {
  const trimmed = asset.trim();
  const [name, mint] = trimmed.split(':').map((part) => part.trim());

  if (!mint) {
    return trimmed.toLowerCase();
  }

  return `${name.toLowerCase()}:${mint}`;
}

function normalizeStarbaseName(starbase: string): string {
  return String(starbase ?? '').trim().replace(/_/g, '-').toUpperCase();
}

function getStarbaseSortRank(starbase: string): number {
  const normalized = normalizeStarbaseName(starbase);
  const match = normalized.match(/^([A-Z]+)-(\d+)$/);
  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }

  const [, prefix, rawNumber] = match;
  const zoneRank = prefix === 'MUD' || prefix === 'ONI' || prefix === 'UST' ? 1000 : prefix === 'MRZ' ? 2000 : 3000;
  return zoneRank + Number(rawNumber);
}

function compareStarbaseLabels(a: string, b: string): number {
  const rankA = getStarbaseSortRank(a);
  const rankB = getStarbaseSortRank(b);
  if (rankA !== rankB) {
    return rankA - rankB;
  }
  return normalizeStarbaseName(a).localeCompare(normalizeStarbaseName(b), undefined, { numeric: true });
}

function groupRulesByAsset(rules: AssetRuleConfig[]): Map<string, GroupedAssetRules> {
  const grouped = new Map<string, GroupedAssetRules>();

  rules.forEach((rule, index) => {
    const key =
      rule.group +
      '|' +
      normalizeStarbaseName(rule.starbase) +
      '|' +
      normalizeAssetKey(rule.asset);
    const item = { index, rule };
    const existing = grouped.get(key);

    if (existing) {
      existing.rules.push(item);
    } else {
      grouped.set(key, {
        asset: rule.asset,
        group: rule.group,
        starbase: normalizeStarbaseName(rule.starbase),
        rules: [item],
      });
    }
  });

  return grouped;
}

export function normalizeLoadedState(parsed: unknown, trackedResources: ResourceConfig[]): BotState {
  if (!parsed || typeof parsed !== 'object') {
    return {};
  }

  const maybeLegacy = parsed as { openOrders?: Record<string, OrderSnapshot> };
  if (
    maybeLegacy.openOrders &&
    typeof maybeLegacy.openOrders === 'object' &&
    trackedResources.length > 0 &&
    !trackedResources.some((resource) => resource.mint.toBase58() in (parsed as Record<string, unknown>))
  ) {
    const legacyKey = trackedResources[0].mint.toBase58();
    return {
      [legacyKey]: {
        buy: createEmptySideState(),
        sell: {
          openOrders: maybeLegacy.openOrders,
        },
      },
    };
  }

  const normalized: BotState = {};
  for (const [mintKey, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') {
      continue;
    }

    const candidate = value as Partial<ResourceOrderState> & {
      openOrders?: Record<string, OrderSnapshot>;
      lastWalletBalance?: number;
    };

    if (candidate.buy || candidate.sell) {
      normalized[mintKey] = {
        buy:
          candidate.buy && typeof candidate.buy === 'object'
            ? {
                openOrders:
                  typeof candidate.buy.openOrders === 'object' && candidate.buy.openOrders
                    ? candidate.buy.openOrders
                    : {},
                lastWalletBalance:
                  typeof candidate.buy.lastWalletBalance === 'number' ? candidate.buy.lastWalletBalance : undefined,
              }
            : createEmptySideState(),
        sell:
          candidate.sell && typeof candidate.sell === 'object'
            ? {
                openOrders:
                  typeof candidate.sell.openOrders === 'object' && candidate.sell.openOrders
                    ? candidate.sell.openOrders
                    : {},
                lastWalletBalance:
                  typeof candidate.sell.lastWalletBalance === 'number' ? candidate.sell.lastWalletBalance : undefined,
              }
            : createEmptySideState(),
      };
      continue;
    }

    if (candidate.openOrders && typeof candidate.openOrders === 'object') {
      normalized[mintKey] = {
        buy: createEmptySideState(),
        sell: {
          openOrders: candidate.openOrders,
          lastWalletBalance:
            typeof candidate.lastWalletBalance === 'number' ? candidate.lastWalletBalance : undefined,
        },
      };
    }
  }

  return normalized;
}

function getOrderRemainingQuantity(order: Order): number {
  return Math.max(0, Math.floor(Number((order as any).orderQtyRemaining ?? 0)));
}

function getOrderTrackedQuantity(order: Order): number {
  const candidateValues = [
    (order as any).orderOriginationQty,
    (order as any).orderQty,
    (order as any).uiOrderQty,
    (order as any).quantity,
    (order as any).size,
    (order as any).orderQtyRemaining,
  ];

  for (const value of candidateValues) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.max(0, Math.floor(parsed));
    }
  }

  return getOrderRemainingQuantity(order);
}

function getOrderBookQuantity(order: Order): number {
  const candidateValues = [
    (order as any).orderQtyRemaining,
    (order as any).orderQty,
    (order as any).uiOrderQty,
    (order as any).quantity,
    (order as any).size,
  ];

  for (const value of candidateValues) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.max(0, Math.floor(parsed));
    }
  }

  return 0;
}

function getRelevantOrderThreshold(quantity: number, pct: number): number {
  return Math.max(1, Math.ceil(quantity * (pct / 100)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProgramIdlWithoutEvents(idl: unknown): any {
  return { ...(idl as Record<string, unknown>), events: [] };
}

function getResourceLabel(resource: ResourceConfig): string {
  return resource.name || resource.mint.toBase58();
}

function parseTokenAmount(tokenAmount?: {
  uiAmount?: number | null;
  uiAmountString?: string;
  amount?: string;
  decimals?: number;
}): number {
  if (!tokenAmount) {
    return 0;
  }

  if (typeof tokenAmount.uiAmountString === 'string' && tokenAmount.uiAmountString.trim()) {
    const parsed = Number.parseFloat(tokenAmount.uiAmountString);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (typeof tokenAmount.uiAmount === 'number' && Number.isFinite(tokenAmount.uiAmount)) {
    return tokenAmount.uiAmount;
  }

  const rawAmount = Number(tokenAmount.amount ?? '0');
  const decimals = tokenAmount.decimals ?? 0;
  return Number.isFinite(rawAmount) ? rawAmount / 10 ** decimals : 0;
}

function normalizeAssetRuleGroup(value: string | null | undefined, asset: string): AssetRegistryGroup {
  const normalized = String(value ?? '').trim();
  if (normalized === 'raw' || normalized === 'components' || normalized === 'ships' || normalized === 'ship-parts') {
    return normalized;
  }

  if (asset.endsWith(' (ship parts)')) {
    return 'ship-parts';
  }

  return 'raw';
}

export class LmMarketBot {
  private legacyResources: ResourceConfig[];
  private trackedResources: ResourceConfig[];
  private resourceListResources: ResourceConfig[];
  private statusResources: ResourceConfig[];
  private readonly connection: Connection;
  private readonly wallet: Keypair;
  private readonly gm = new GmClientService();
  private readonly sageProgram: SageIDLProgram & { account: any };
  private readonly cargoProgram: CargoIDLProgram;
  private readonly crewProgram: CrewIDLProgram;
  private readonly profileFactionProgram: ProfileFactionIDLProgram;
  private readonly playerProfileProgram: PlayerProfileIDLProgram;
  private readonly analysisPath: string;
  private readonly logFilePath: string;
  private readonly stateFilePath: string;
  private readonly rpcCounterFilePath: string;
  private checkIntervalMs: number;

  private state: BotState = {};
  private running = false;
  private loopTimer: NodeJS.Timeout | null = null;
  private readonly recentlyCancelledOrderIds = new Set<string>();
  private startedAt: string | null = null;
  private lastCycleStartedAt: string | null = null;
  private lastCycleCompletedAt: string | null = null;
  private lastCycleDurationMs: number | null = null;
  private nextCycleDelayMinutes: number | null = null;
  private readonly passiveOpenOrdersCache = new Map<string, BotOpenOrderStatus[]>();
  private readonly marketLeaderCache = new Map<string, MarketLeaderCacheEntry>();
  private marketLeaderThresholdsCache: MarketLeaderThresholdsCacheEntry | null = null;
  private readonly marketOrderSnapshotCache = new Map<string, MarketOrderSnapshotCacheEntry>();
  private readonly myOpenOrdersCache = new Map<string, MyOpenOrdersCacheEntry>();
  private readonly walletBalanceCache = new Map<string, ExpiringPromiseCacheEntry<number>>();
  private readonly localMarketSellContextCache = new Map<string, LocalMarketSellContextCacheEntry>();
  private readonly starbasePlayerCache = new Map<string, ExpiringPromiseCacheEntry<PublicKey | null>>();
  private readonly cargoPodCache = new Map<string, ExpiringPromiseCacheEntry<PublicKey[]>>();
  private readonly cargoPodTokenInventoryCache = new Map<string, CargoPodTokenInventoryCacheEntry>();
  private solBalanceCache: ExpiringPromiseCacheEntry<number> | null = null;
  private statusSnapshotCache: { expiresAt: number; snapshot: BotStatusSnapshot } | null = null;
  private currentCycleStats: CycleStats | null = null;
  private consecutiveNoChangeCycles = 0;
  private transactionSubmissionQueue: Promise<void> = Promise.resolve();
  private nextTransactionSubmitAtMs = 0;

  constructor(
    private readonly config: BotConfig,
    private readonly logger: BotLogger = defaultLogger,
  ) {
    const secretKeyBytes = decodeSecret(config.hotWalletSecret);
    this.wallet = secretKeyBytes.length === 32 ? Keypair.fromSeed(secretKeyBytes) : Keypair.fromSecretKey(secretKeyBytes);
    this.analysisPath = path.resolve(process.cwd(), config.analysisDir);
    this.logFilePath = path.join(this.analysisPath, 'orders-log.jsonl');
    this.stateFilePath = path.join(this.analysisPath, 'bot-state.json');
    this.rpcCounterFilePath = path.join(this.analysisPath, 'rpc-method-counters.jsonl');
    this.connection = createFailoverConnection(
      config.rpcUrl,
      config.rpcUrlFallback,
      this.logger,
      () => this.config.rpcRequestsPerSecond,
      () => this.config.useRpcLimiter,
      this.config.faction,
      (snapshot) => {
        void this.appendRpcCounterSnapshot(snapshot);
      },
    );
    const provider = new AnchorProvider(this.connection, new Wallet(this.wallet), AnchorProvider.defaultOptions());
    this.sageProgram = new Program(
      getProgramIdlWithoutEvents(SAGE_IDL),
      SAGE_PROGRAM_ID,
      provider,
    ) as unknown as SageIDLProgram & { account: any };
    this.cargoProgram = new Program(
      getProgramIdlWithoutEvents(CARGO_IDL),
      CARGO_PROGRAM_ID,
      provider,
    ) as unknown as CargoIDLProgram;
    this.crewProgram = new Program(
      getProgramIdlWithoutEvents(CREW_IDL),
      CREW_PROGRAM_ID,
      provider,
    ) as unknown as CrewIDLProgram;
    this.profileFactionProgram = new Program(
      getProgramIdlWithoutEvents(PROFILE_FACTION_IDL),
      PROFILE_FACTION_PROGRAM_ID,
      provider,
    ) as unknown as ProfileFactionIDLProgram;
    this.playerProfileProgram = new Program(
      getProgramIdlWithoutEvents(PLAYER_PROFILE_IDL),
      PLAYER_PROFILE_PROGRAM_ID,
      provider,
    ) as unknown as PlayerProfileIDLProgram;
    this.resourceListResources = parseResources(config.resourceList);
    this.legacyResources = [];
    this.trackedResources = parseRuleResources(config.assetRules);
    this.statusResources = this.trackedResources;
    this.checkIntervalMs = config.checkIntervalMinutes * 60 * 1000;
  }

  isRunning(): boolean {
    return this.running;
  }

  applyConfigUpdates(next: BotConfig) {
    this.config.minSellQuantity = next.minSellQuantity;
    this.config.minPrice = next.minPrice;
    this.config.rpcRequestsPerSecond = next.rpcRequestsPerSecond;
    this.config.rpcTxSendRateLimitPerSecond = next.rpcTxSendRateLimitPerSecond;
    this.config.useRpcLimiter = next.useRpcLimiter;
    this.config.chainStatusRefreshIntervalMinutes = next.chainStatusRefreshIntervalMinutes;
    this.config.checkIntervalMinutes = next.checkIntervalMinutes;
    this.config.relevantSellOrderPct = next.relevantSellOrderPct;
    this.config.relevantBuyOrderPct = next.relevantBuyOrderPct;
    this.config.ownerWallet = next.ownerWallet;
    this.config.ownerProfile = next.ownerProfile;
    this.config.resourceList = next.resourceList;
    this.config.analysisDir = next.analysisDir;
    this.config.assetRules = next.assetRules;

    this.resourceListResources = parseResources(this.config.resourceList);
    this.legacyResources = [];
    this.trackedResources = parseRuleResources(this.config.assetRules);
    this.statusResources = this.trackedResources;
    this.checkIntervalMs = this.config.checkIntervalMinutes * 60 * 1000;
    this.passiveOpenOrdersCache.clear();
    this.marketLeaderCache.clear();
    this.marketLeaderThresholdsCache = null;
    this.marketOrderSnapshotCache.clear();
    this.myOpenOrdersCache.clear();
    this.walletBalanceCache.clear();
    this.localMarketSellContextCache.clear();
    this.starbasePlayerCache.clear();
    this.cargoPodCache.clear();
    this.cargoPodTokenInventoryCache.clear();
    this.solBalanceCache = null;
    this.invalidateStatusSnapshotCache();
  }

  private invalidateMarketLeaderCacheForMint(mint: string) {
    for (const key of this.marketLeaderCache.keys()) {
      if (key === mint || key.startsWith(`${mint}:`)) {
        this.marketLeaderCache.delete(key);
      }
    }
    this.marketOrderSnapshotCache.delete(mint);
    this.myOpenOrdersCache.delete(mint);
    this.statusSnapshotCache = null;
  }

  private invalidateStatusSnapshotCache() {
    this.statusSnapshotCache = null;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    await this.ensureAnalysisFiles();
    this.state = await this.loadState();
    this.running = true;
    this.startedAt = new Date().toISOString();
    this.invalidateStatusSnapshotCache();
    await this.appendLog({ event: 'START', message: `Bot started for wallet ${this.wallet.publicKey.toBase58()}` });

    this.logger.info(`Hot wallet: ${this.wallet.publicKey.toBase58()}`);

    if (this.config.assetRules.length > 0) {
      const assets = this.config.assetRules.map((rule) => `${rule.asset} [${rule.side}]`).join(', ');
      this.logger.info(
        `Monitoring ${assets} every ${this.config.checkIntervalMinutes} minutes using row-based asset rules.`,
      );
    } else {
      this.logger.info(
        `No asset rules configured. LM Market Bot will not scan markets until at least one asset rule is added.`,
      );
    }

    await this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.invalidateStatusSnapshotCache();
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
  }

  async getStatusSnapshot(): Promise<BotStatusSnapshot> {
    if (this.statusSnapshotCache && Date.now() < this.statusSnapshotCache.expiresAt) {
      return this.statusSnapshotCache.snapshot;
    }

    const wallet = this.wallet.publicKey.toBase58();

    const solBalance = await this.getSolBalance();
    const atlasBalance = await this.getWalletBalanceForMint(QUOTE_ATLAS_MINT, 'ATLAS');
    const usdcBalance = await this.getWalletBalanceForMint(QUOTE_USDC_MINT, 'USDC');

    const inventory = await this.buildInventorySnapshot();
    const certificates = await this.buildCertificateSnapshot();

    const openOrders = await this.buildOpenOrdersSnapshot();
    const recentActivity = await this.readRecentActivity(this.startedAt);
    const ruleHealth = this.buildRuleHealthSnapshot(openOrders);

    const snapshot = {
      version: APP_VERSION,
      running: this.running,
      wallet,
      solBalance,
      atlasBalance,
      usdcBalance,
      startedAt: this.startedAt,
      lastCycleStartedAt: this.lastCycleStartedAt,
      lastCycleCompletedAt: this.lastCycleCompletedAt,
      lastCycleDurationMs: this.lastCycleDurationMs,
      nextCycleDelayMinutes: this.nextCycleDelayMinutes,
      trackedAssetCount: this.trackedResources.length,
      activeRuleCount: this.config.assetRules.length,
      openOrders,
      inventory,
      certificates,
      recentActivity,
      ruleHealth,
    };

    const configuredTtlMs = this.config.chainStatusRefreshIntervalMinutes * 60_000;
    const ttlMs = Math.min(
      STATUS_SNAPSHOT_CACHE_CEIL_MS,
      Math.max(STATUS_SNAPSHOT_CACHE_FLOOR_MS, configuredTtlMs),
    );
    this.statusSnapshotCache = {
      expiresAt: Date.now() + ttlMs,
      snapshot,
    };

    return snapshot;
  }

  async cancelActiveOrderForRule(asset: string, side: AssetRuleSide): Promise<CancelOrderResult> {
    const normalizedSide = parseAssetRuleSide(side, 'cancelOrder.side');
    const resource = parseResourceEntry(asset, 'cancelOrder.asset');
    const cancelledIds = new Set<string>();

    try {
      const myOrdersRaw = await this.readMyOpenOrdersForResource(resource, { refresh: true });
      const myOrders = myOrdersRaw.filter((o) => o.orderType === getSideOrderType(normalizedSide));
      const activeOrder = sortOrdersForSide(normalizedSide, myOrders)[0];

      if (!activeOrder) {
        this.logger.info(`No active ${normalizedSide} order found for ${resource.name}.`);
        await this.appendLog({
          event: 'CANCEL_NO_ACTIVE_ORDER',
          side: normalizedSide,
          asset,
          resource: resource.name,
          mint: resource.mint.toBase58(),
        });
        return { ok: true, status: 'no_active_order', asset, side: normalizedSide };
      }

      const tx = await this.cancelOrder(activeOrder, resource, normalizedSide, cancelledIds);

      this.invalidateMarketLeaderCacheForMint(resource.mint.toBase58());
      const refreshedOrdersRaw = await this.readMyOpenOrdersForResource(resource, { refresh: true });
      const refreshedOrders = refreshedOrdersRaw.filter((o) => o.orderType === getSideOrderType(normalizedSide));
      await this.detectFills(resource, normalizedSide, refreshedOrders, cancelledIds);

      this.logger.info(`Cancelled active ${normalizedSide} order for ${resource.name}: ${activeOrder.id}`);
      await this.appendLog({
        event: 'CANCEL_ACTIVE_ORDER',
        side: normalizedSide,
        asset,
        resource: resource.name,
        mint: resource.mint.toBase58(),
        orderId: activeOrder.id,
        tx,
      });

      return { ok: true, status: 'cancelled', asset, side: normalizedSide, orderId: activeOrder.id, tx };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Failed to cancel active ${normalizedSide} order for ${resource.name}:`, err);
      await this.appendLog({
        event: 'CANCEL_FAILED',
        side: normalizedSide,
        asset,
        resource: resource.name,
        mint: resource.mint.toBase58(),
        message,
      });
      return { ok: false, status: 'error', asset, side: normalizedSide, message };
    }
  }

  private async buildInventorySnapshot(): Promise<BotInventoryStatus[]> {
    const seen = new Set<string>();
    const rows: BotInventoryStatus[] = [];

    for (const rule of this.config.assetRules) {
      const resource = resolveResourceForRule(rule);
      const starbase = rule.starbase;
      const key = `${starbase}|${resource.mint.toBase58()}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      rows.push({
        starbase,
        asset: getResourceLabel(resource),
        mint: resource.mint.toBase58(),
        balance: await this.getStarbaseCargoPodBalance(rule, resource),
        source: 'starbase-cargo-pod',
      });
    }

    return rows.sort((a, b) => {
      const starbaseCompare = compareStarbaseLabels(a.starbase, b.starbase);
      if (starbaseCompare !== 0) {
        return starbaseCompare;
      }
      return a.asset.localeCompare(b.asset, undefined, { numeric: true });
    });
  }

  private async buildCertificateSnapshot(): Promise<BotCertificateStatus[]> {
    const seen = new Set<string>();
    const rows: BotCertificateStatus[] = [];

    for (const rule of this.config.assetRules) {
      if (rule.side !== 'sell') {
        continue;
      }

      const rawResource = resolveResourceForRule(rule);
      const context = await this.resolveLocalMarketSellContext(rule, rawResource);
      if (!context) {
        continue;
      }

      const certificateMint = context.certificateMint.toBase58();
      if (seen.has(certificateMint)) {
        continue;
      }
      seen.add(certificateMint);

      rows.push({
        starbase: rule.starbase,
        asset: getResourceLabel(rawResource),
        ruleAsset: rule.asset,
        rawMint: rawResource.mint.toBase58(),
        certificateMint,
        certificateTokenAccount: context.certificateTokenAccount.toBase58(),
        balance: await this.getWalletBalanceForMint(context.certificateMint, rawResource.name, {
          tokenProgramId: TOKEN_2022_PROGRAM_ID,
        }),
      });
    }

    return rows.sort((a, b) => {
      const starbaseCompare = compareStarbaseLabels(a.starbase, b.starbase);
      if (starbaseCompare !== 0) {
        return starbaseCompare;
      }
      return a.asset.localeCompare(b.asset, undefined, { numeric: true });
    });
  }

  private async getStarbaseCargoPodBalance(rule: AssetRuleConfig, resource: ResourceConfig): Promise<number> {
    const cargoPods = await this.getStarbaseCargoPods(rule.starbase);
    if (cargoPods.length === 0) {
      return 0;
    }

    const mintKey = resource.mint.toBase58();
    let balance = 0;
    for (const cargoPod of cargoPods) {
      const inventory = await this.getCargoPodTokenInventory(cargoPod);
      balance += inventory.get(mintKey)?.balance ?? 0;
    }

    return balance;
  }

  private async getStarbaseCargoPodTokenAccount(
    rule: AssetRuleConfig,
    resource: ResourceConfig,
  ): Promise<{ cargoPod: PublicKey; tokenAccount: PublicKey; balance: number } | null> {
    const cargoPods = await this.getStarbaseCargoPods(rule.starbase);
    const mintKey = resource.mint.toBase58();

    for (const cargoPod of cargoPods) {
      const inventory = await this.getCargoPodTokenInventory(cargoPod);
      const account = inventory.get(mintKey) ?? null;
      if (account) {
        return account;
      }
    }

    return null;
  }

  private async getCargoPodTokenInventory(cargoPod: PublicKey): Promise<Map<string, CargoPodTokenAccountInfo>> {
    const cacheKey = cargoPod.toBase58();
    const cached = this.cargoPodTokenInventoryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.promise;
    }

    const promise = (async () => {
      const inventory = new Map<string, CargoPodTokenAccountInfo>();
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(cargoPod, { programId: TOKEN_PROGRAM_ID });
      for (const tokenAccount of tokenAccounts.value) {
        const parsed = tokenAccount.account.data.parsed as {
          info?: { mint?: string; tokenAmount?: { uiAmount?: number | null; uiAmountString?: string; amount?: string; decimals?: number } };
        };
        const info = parsed.info;
        const mint = info?.mint;
        if (!mint) {
          continue;
        }

        const amount = parseTokenAmount(info.tokenAmount);
        const existing = inventory.get(mint);
        inventory.set(mint, {
          cargoPod,
          tokenAccount: existing && existing.balance > 0 ? existing.tokenAccount : tokenAccount.pubkey,
          balance: (existing?.balance ?? 0) + amount,
        });
      }
      return inventory;
    })().catch((err) => {
      this.cargoPodTokenInventoryCache.delete(cacheKey);
      this.logger.warn(`Failed to fetch cargo pod token inventory for ${cacheKey}`, err);
      throw err;
    });

    this.cargoPodTokenInventoryCache.set(cacheKey, {
      expiresAt: Date.now() + CARGO_POD_TOKEN_CACHE_TTL_MS,
      promise,
    });
    return promise;
  }

  private async resolveOwnerProfileKeyIndex(): Promise<number | null> {
    const profile = new PublicKey(this.config.ownerProfile.trim());
    const profileAccount = await this.connection.getAccountInfo(profile, 'confirmed');
    if (!profileAccount || !profileAccount.owner.equals(PLAYER_PROFILE_PROGRAM_ID)) {
      this.logger.warn('OWNER_PROFILE is not a valid Player Profile account; cannot mint local-market certificates.');
      return null;
    }

    const decodedProfile = PlayerProfile.decodeData(
      { accountId: profile, accountInfo: profileAccount },
      this.playerProfileProgram,
    );
    if (decodedProfile.type !== 'ok') {
      this.logger.warn('Failed to decode OWNER_PROFILE account; cannot mint local-market certificates.');
      return null;
    }
    const matchingIndex = decodedProfile.data.profileKeys.findIndex(
      (profileKey) => profileKey.key.equals(this.wallet.publicKey) && profileKey.scope.equals(SAGE_PROGRAM_ID),
    );
    if (matchingIndex < 0) {
      this.logger.warn('Hot wallet is not an authorized key on OWNER_PROFILE; cannot mint local-market certificates.');
      return null;
    }

    const profileKey = decodedProfile.data.profileKeys[matchingIndex];
    const permissions = SagePermissions.fromPermissions(profileKey.permissions);
    if (!permissions.addRemoveCargo) {
      this.logger.warn(
        'Hot wallet OWNER_PROFILE SAGE key is missing addRemoveCargo permission; cannot mint local-market certificates.',
      );
      return null;
    }

    return matchingIndex;
  }

  private async resolveOwnerManageCrewProfileKeyIndex(): Promise<number | null> {
    const profile = new PublicKey(this.config.ownerProfile.trim());
    const profileAccount = await this.connection.getAccountInfo(profile, 'confirmed');
    if (!profileAccount || !profileAccount.owner.equals(PLAYER_PROFILE_PROGRAM_ID)) {
      this.logger.warn('OWNER_PROFILE is not a valid Player Profile account; cannot deposit crew.');
      return null;
    }

    const decodedProfile = PlayerProfile.decodeData(
      { accountId: profile, accountInfo: profileAccount },
      this.playerProfileProgram,
    );
    if (decodedProfile.type !== 'ok') {
      this.logger.warn('Failed to decode OWNER_PROFILE account; cannot deposit crew.');
      return null;
    }

    const matchingIndex = decodedProfile.data.profileKeys.findIndex(
      (profileKey) => profileKey.key.equals(this.wallet.publicKey) && profileKey.scope.equals(SAGE_PROGRAM_ID),
    );
    if (matchingIndex < 0) {
      this.logger.warn('Hot wallet is not an authorized SAGE key on OWNER_PROFILE; cannot deposit crew.');
      return null;
    }

    const profileKey = decodedProfile.data.profileKeys[matchingIndex];
    const permissions = SagePermissions.fromPermissions(profileKey.permissions);
    if (!permissions.manageCrew) {
      this.logger.warn('Hot wallet OWNER_PROFILE SAGE key is missing manageCrew permission; cannot deposit crew.');
      return null;
    }

    return matchingIndex;
  }

  private getCrewDepositTargetStarbaseName(): string | null {
    const faction = String(this.config.faction || '').trim().toUpperCase();
    if (faction === 'USTUR') {
      return 'UST-1';
    }
    if (faction === 'MUD' || faction === 'ONI') {
      return `${faction}-1`;
    }
    return null;
  }

  private getCrewDepositOwnerWallet(): PublicKey | null {
    const ownerWallet = this.config.ownerWallet.trim();
    if (!ownerWallet) {
      this.logger.warn('OWNER_WALLET is not configured; cannot discover crew cNFTs for deposit.');
      return null;
    }
    try {
      return new PublicKey(ownerWallet);
    } catch {
      this.logger.warn('OWNER_WALLET is not a valid public key; cannot discover crew cNFTs for deposit.');
      return null;
    }
  }

  private async callDasRpc<T>(method: string, params: unknown): Promise<T> {
    const urls = [this.config.rpcUrl, this.config.rpcUrlFallback].filter((url): url is string => Boolean(url && url.trim()));
    let lastError: unknown = null;

    for (const url of urls) {
      for (let attempt = 0; ; attempt++) {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: Date.now(),
              method,
              params,
            }),
          });
          const text = await response.text();
          let payload: { result?: T; error?: { message?: string; code?: number }; [key: string]: unknown } = {};
          try {
            payload = text ? JSON.parse(text) : {};
          } catch {
            throw new Error(`DAS ${method} returned non-JSON response: ${text.slice(0, 160)}`);
          }

          if (!response.ok || payload.error) {
            const message = payload.error?.message || response.statusText || `HTTP ${response.status}`;
            throw new Error(`DAS ${method} failed: ${message}`);
          }
          if (!Object.prototype.hasOwnProperty.call(payload, 'result')) {
            throw new Error(`DAS ${method} response did not include result.`);
          }
          return payload.result as T;
        } catch (error) {
          lastError = error;
          const isRateLimit = isRpcRateLimitError(error);
          const isTransientTransport = isTransientRpcTransportError(error);
          const retryDelaysMs = isRateLimit ? RPC_RATE_LIMIT_RETRY_DELAYS_MS : RPC_TRANSIENT_TRANSPORT_RETRY_DELAYS_MS;
          const retryDelayMs = retryDelaysMs[attempt];
          if ((!isRateLimit && !isTransientTransport) || retryDelayMs === undefined) {
            break;
          }
          this.logger.warn(`DAS ${method} failed; retrying in ${retryDelayMs}ms.`, error);
          await sleep(retryDelayMs);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`DAS ${method} failed.`);
  }

  private parseCrewAssetCandidate(asset: DasAsset, context: CrewDepositContext): CrewAssetCandidate | null {
    const id = String(asset.id || '').trim();
    const owner = String(asset.ownership?.owner || '').trim();
    const collection = asset.grouping?.find((group) => group.group_key === 'collection')?.group_value;
    const compression = asset.compression;
    if (
      !id ||
      asset.burnt ||
      owner !== context.crewOwner.toBase58() ||
      !compression?.compressed ||
      collection !== context.collectionMint.toBase58()
    ) {
      return null;
    }

    const tree = String(compression.tree || '').trim();
    if (!context.allowedMerkleTrees.has(tree)) {
      return null;
    }
    if (!compression.data_hash || !compression.creator_hash || typeof compression.leaf_id !== 'number') {
      return null;
    }

    try {
      return {
        id,
        name: String(asset.content?.metadata?.name || 'Crew'),
        merkleTree: new PublicKey(tree),
        dataHash: new PublicKey(compression.data_hash),
        creatorHash: new PublicKey(compression.creator_hash),
        leafIndex: compression.leaf_id,
      };
    } catch {
      return null;
    }
  }

  private async resolveCrewDepositContext(): Promise<CrewDepositContext | null> {
    const targetStarbaseName = this.getCrewDepositTargetStarbaseName();
    const starbaseEntry = targetStarbaseName ? findStarbaseRegistryEntry(targetStarbaseName) : null;
    if (!targetStarbaseName || !starbaseEntry) {
      this.logger.warn(`Cannot resolve CSS starbase for faction ${this.config.faction}.`);
      return null;
    }

    const crewOwner = this.getCrewDepositOwnerWallet();
    if (!crewOwner) {
      return null;
    }

    const starbasePlayer = await this.getStarbasePlayer(targetStarbaseName);
    if (!starbasePlayer) {
      this.logger.warn(`Cannot resolve starbase player for ${targetStarbaseName}; cannot deposit crew.`);
      return null;
    }

    const starbase = new PublicKey(starbaseEntry.publicKey);
    const starbaseAccount = await this.sageProgram.account.starbase.fetch(starbase);
    const gameId = starbaseAccount.gameId as PublicKey;
    const profileFaction = ProfileFactionAccount.findAddress(
      this.profileFactionProgram,
      new PublicKey(this.config.ownerProfile),
    )[0];
    const crewProgramConfig = CrewConfig.findAddress(this.crewProgram)[0];
    const crewConfigAccount = await this.connection.getAccountInfo(crewProgramConfig, 'confirmed');
    if (!crewConfigAccount || !crewConfigAccount.owner.equals(CREW_PROGRAM_ID)) {
      this.logger.warn(`Crew config ${crewProgramConfig.toBase58()} is missing or invalid; cannot deposit crew.`);
      return null;
    }

    const decodedCrewConfig = CrewConfig.decodeData(
      { accountId: crewProgramConfig, accountInfo: crewConfigAccount },
      this.crewProgram,
    );
    if (decodedCrewConfig.type !== 'ok') {
      this.logger.warn(`Failed to decode crew config ${crewProgramConfig.toBase58()}; cannot deposit crew.`);
      return null;
    }

    return {
      targetStarbaseName,
      crewOwner,
      starbase,
      starbasePlayer,
      gameId,
      profileFaction,
      crewProgramConfig,
      allowedMerkleTrees: new Set(decodedCrewConfig.data.merkleTrees.map((tree) => tree.toBase58())),
      collectionMint: decodedCrewConfig.data.data.collectionMint,
    };
  }

  private async discoverOwnedCrewAssets(context: CrewDepositContext): Promise<CrewAssetCandidate[]> {
    const assets: CrewAssetCandidate[] = [];
    const ownerAddress = context.crewOwner.toBase58();
    let useSearchAssets = true;
    for (let page = 1; page <= CREW_ASSET_DISCOVERY_MAX_PAGES; page++) {
      let result: DasAssetList;
      if (useSearchAssets) {
        try {
          result = await this.callDasRpc<DasAssetList>('searchAssets', {
            ownerAddress,
            ownerType: 'single',
            grouping: ['collection', context.collectionMint.toBase58()],
            compressed: true,
            burnt: false,
            limit: CREW_ASSET_DISCOVERY_PAGE_LIMIT,
            page,
          });
        } catch (error) {
          this.logger.warn('DAS searchAssets failed; falling back to getAssetsByOwner for crew discovery.', error);
          useSearchAssets = false;
          result = await this.callDasRpc<DasAssetList>('getAssetsByOwner', {
            ownerAddress,
            limit: CREW_ASSET_DISCOVERY_PAGE_LIMIT,
            page,
          });
        }
      } else {
        result = await this.callDasRpc<DasAssetList>('getAssetsByOwner', {
          ownerAddress,
          limit: CREW_ASSET_DISCOVERY_PAGE_LIMIT,
          page,
        });
      }
      const items = Array.isArray(result.items) ? result.items : [];
      for (const item of items) {
        const parsed = this.parseCrewAssetCandidate(item, context);
        if (parsed) {
          assets.push(parsed);
        }
      }
      if (items.length < CREW_ASSET_DISCOVERY_PAGE_LIMIT) {
        break;
      }
    }
    return assets;
  }

  private async fetchCrewAssetProofs(assets: CrewAssetCandidate[]): Promise<CrewAssetWithProof[]> {
    if (!assets.length) {
      return [];
    }

    let proofMap: Record<string, DasAssetProof> | DasAssetProof[] | null = null;
    try {
      proofMap = await this.callDasRpc<Record<string, DasAssetProof> | DasAssetProof[]>(
        'getAssetProofs',
        [assets.map((asset) => asset.id)],
      );
    } catch (error) {
      this.logger.warn('DAS getAssetProofs batch call failed; falling back to getAssetProof per crew asset.', error);
    }

    const withProof: CrewAssetWithProof[] = [];
    for (let index = 0; index < assets.length; index++) {
      const asset = assets[index];
      const proof =
        (Array.isArray(proofMap) ? proofMap[index] : proofMap?.[asset.id]) ??
        (await this.callDasRpc<DasAssetProof>('getAssetProof', [asset.id]));
      const root = proof.root;
      const proofTree = proof.tree_id;
      if (!root || !proofTree || !Array.isArray(proof.proof)) {
        throw new Error(`DAS proof for crew asset ${asset.id} is missing root/tree/proof.`);
      }
      if (proofTree !== asset.merkleTree.toBase58()) {
        throw new Error(`DAS proof tree mismatch for crew asset ${asset.id}.`);
      }
      withProof.push({
        ...asset,
        root: new PublicKey(root),
        proof: proof.proof.map((key) => new PublicKey(key)),
      });
    }
    return withProof;
  }

  private crewAssetToTransferInput(asset: CrewAssetWithProof): CrewTransferInput {
    return {
      merkleTree: asset.merkleTree,
      root: asset.root,
      dataHash: asset.dataHash,
      creatorHash: asset.creatorHash,
      leafIndex: asset.leafIndex,
      proof: asset.proof,
    };
  }

  async getCrewDepositStatus(): Promise<CrewDepositStatus> {
    if ((await this.resolveOwnerManageCrewProfileKeyIndex()) === null) {
      return {
        ok: true,
        ready: false,
        status: 'missing_manage_crew_permission',
        batchSize: CREW_DEPOSIT_BATCH_SIZE,
        availableCrew: null,
        message: 'Hot wallet is not ready to deposit crew. Check OWNER_PROFILE SAGE manageCrew permission.',
      };
    }

    const context = await this.resolveCrewDepositContext();
    if (!context) {
      return {
        ok: true,
        ready: false,
        status: 'crew_context_unavailable',
        batchSize: CREW_DEPOSIT_BATCH_SIZE,
        availableCrew: null,
        message: 'Could not resolve CSS starbase, starbase player, or crew config for crew deposits.',
      };
    }

    let crewAssets: CrewAssetCandidate[];
    try {
      crewAssets = await this.discoverOwnedCrewAssets(context);
    } catch (error) {
      this.logger.warn('Failed to discover configured owner-wallet crew cNFTs.', error);
      return {
        ok: true,
        ready: false,
        status: 'crew_discovery_failed',
        batchSize: CREW_DEPOSIT_BATCH_SIZE,
        availableCrew: null,
        message: `Could not discover crew cNFTs through the configured RPC. ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (!context.crewOwner.equals(this.wallet.publicKey)) {
      return {
        ok: true,
        ready: false,
        status: 'crew_owner_signature_required',
        batchSize: CREW_DEPOSIT_BATCH_SIZE,
        availableCrew: crewAssets.length,
        message:
          `Found ${crewAssets.length} owner-wallet crew cNFT(s), but Deposit Crew requires the crew owner signature. ` +
          'Hot-wallet-only deposit is unavailable while OWNER_WALLET differs from the hot wallet.',
      };
    }

    return {
      ok: true,
      ready: crewAssets.length > 0,
      status: crewAssets.length > 0 ? 'ready' : 'no_available_crew',
      batchSize: CREW_DEPOSIT_BATCH_SIZE,
      availableCrew: crewAssets.length,
      message:
        crewAssets.length > 0
          ? `Ready to deposit owner-wallet crew to ${context.targetStarbaseName}.`
          : `No owner-wallet crew cNFTs found for ${context.targetStarbaseName}.`,
    };
  }

  async depositCrewToGame(
    count: number,
    batchSize = CREW_DEPOSIT_BATCH_SIZE,
  ): Promise<{ ok: boolean; status: string; count: number; batchSize: number; deposited?: number; transactions?: string[]; message?: string }> {
    const normalizedCount = Math.max(0, Math.floor(Number(count) || 0));
    const normalizedBatchSize = CREW_DEPOSIT_BATCH_SIZE;
    if (normalizedCount <= 0) {
      return {
        ok: false,
        status: 'invalid_count',
        count: normalizedCount,
        batchSize: normalizedBatchSize,
        message: 'Crew count must be greater than 0.',
      };
    }
    if (Number(batchSize) !== CREW_DEPOSIT_BATCH_SIZE) {
      this.logger.info(`Deposit Crew requested batch size ${batchSize}; using fixed batch size ${CREW_DEPOSIT_BATCH_SIZE}.`);
    }

    if ((await this.resolveOwnerManageCrewProfileKeyIndex()) === null) {
      return {
        ok: false,
        status: 'missing_manage_crew_permission',
        count: normalizedCount,
        batchSize: normalizedBatchSize,
        deposited: 0,
        message: 'Hot wallet is not ready to deposit crew. Check OWNER_PROFILE SAGE manageCrew permission.',
      };
    }

    const context = await this.resolveCrewDepositContext();
    if (!context) {
      return {
        ok: false,
        status: 'crew_context_unavailable',
        count: normalizedCount,
        batchSize: normalizedBatchSize,
        deposited: 0,
        message: 'Could not resolve CSS starbase, starbase player, or crew config for crew deposits.',
      };
    }
    if (!context.crewOwner.equals(this.wallet.publicKey)) {
      return {
        ok: false,
        status: 'crew_owner_signature_required',
        count: normalizedCount,
        batchSize: normalizedBatchSize,
        deposited: 0,
        message:
          'Deposit Crew requires the crew owner signature. Hot-wallet-only deposit is unavailable while OWNER_WALLET differs from the hot wallet.',
      };
    }

    const initialCrewAssets = await this.discoverOwnedCrewAssets(context);
    if (initialCrewAssets.length < normalizedCount) {
      return {
        ok: false,
        status: 'insufficient_crew',
        count: normalizedCount,
        batchSize: normalizedBatchSize,
        deposited: 0,
        message: `Only ${initialCrewAssets.length} owner-wallet crew cNFT(s) are available.`,
      };
    }

    const transactions: string[] = [];
    let deposited = 0;
    while (deposited < normalizedCount) {
      const remaining = normalizedCount - deposited;
      const crewAssets = await this.discoverOwnedCrewAssets(context);
      const batchAssets = crewAssets.slice(0, Math.min(normalizedBatchSize, remaining));
      if (!batchAssets.length) {
        throw new Error(`No crew cNFTs remained available after depositing ${deposited}/${normalizedCount}.`);
      }

      const assetsWithProof = await this.fetchCrewAssetProofs(batchAssets);
      const transaction = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: CREW_DEPOSIT_COMPUTE_UNIT_LIMIT }),
      );
      const addCrew = await SagePlayerProfile.addCrewToGame(
        this.sageProgram,
        new PublicKey(this.config.ownerProfile),
        context.profileFaction,
        keypairToAsyncSigner(this.wallet),
        context.starbasePlayer,
        context.starbase,
        context.crewProgramConfig,
        context.gameId,
        {
          items: assetsWithProof.map((asset) => this.crewAssetToTransferInput(asset)),
        },
      )(keypairToAsyncSigner(this.wallet));

      for (const item of Array.isArray(addCrew) ? addCrew : [addCrew]) {
        transaction.add(item.instruction);
      }

      this.logger.info(
        `Depositing ${assetsWithProof.length} crew to ${context.targetStarbaseName} ` +
          `(${deposited + assetsWithProof.length}/${normalizedCount}).`,
      );
      const signature = await this.signAndSend(transaction);
      transactions.push(signature);
      deposited += assetsWithProof.length;

      await this.appendLog({
        event: 'DEPOSIT_CREW',
        starbase: context.targetStarbaseName,
        count: assetsWithProof.length,
        crew: assetsWithProof.map((asset) => ({ id: asset.id, name: asset.name, leafIndex: asset.leafIndex })),
        tx: signature,
      });
    }

    return {
      ok: true,
      status: 'deposited',
      count: normalizedCount,
      batchSize: normalizedBatchSize,
      deposited,
      transactions,
      message: `Deposited ${deposited} crew to ${context.targetStarbaseName} in ${transactions.length} transaction(s).`,
    };
  }

  private async getStarbaseCargoPods(starbaseName: string): Promise<PublicKey[]> {
    const starbasePlayer = await this.getStarbasePlayer(starbaseName);
    if (!starbasePlayer) {
      return [];
    }

    const cacheKey = starbasePlayer.toBase58();
    const cached = this.cargoPodCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.promise;
    }

    const promise = (async () => {
      const accounts = await this.connection.getProgramAccounts(CARGO_PROGRAM_ID, {
        commitment: 'confirmed',
        filters: [{ memcmp: { offset: CARGO_POD_AUTHORITY_OFFSET, bytes: starbasePlayer.toBase58() } }],
        dataSlice: { offset: 0, length: 0 },
      });
      return accounts.map((account) => account.pubkey);
    })().catch((err) => {
      this.logger.warn(`Failed to resolve cargo pods for starbasePlayer ${starbasePlayer.toBase58()}`, err);
      return [];
    });

    this.cargoPodCache.set(cacheKey, {
      expiresAt: Date.now() + CARGO_POD_LIST_CACHE_TTL_MS,
      promise,
    });
    return promise;
  }

  private async getStarbasePlayer(starbaseName: string): Promise<PublicKey | null> {
    const starbase = findStarbaseRegistryEntry(starbaseName);
    if (!starbase) {
      return null;
    }

    const ownerProfile = this.config.ownerProfile.trim();
    if (!ownerProfile) {
      this.logger.warn('OWNER_PROFILE is not configured; cannot resolve starbase cargo pod inventory.');
      return null;
    }

    const cacheKey = `${ownerProfile}:${starbase.publicKey}`;
    const cached = this.starbasePlayerCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.promise;
    }

    const promise = (async () => {
      const ownerProfileKey = new PublicKey(ownerProfile);
      const starbaseKey = new PublicKey(starbase.publicKey);
      const accounts = await this.connection.getProgramAccounts(SAGE_PROGRAM_ID, {
        commitment: 'confirmed',
        filters: [
          { memcmp: { offset: STARBASE_PLAYER_PROFILE_OFFSET, bytes: ownerProfileKey.toBase58() } },
          { memcmp: { offset: STARBASE_PLAYER_STARBASE_OFFSET, bytes: starbaseKey.toBase58() } },
        ],
        dataSlice: { offset: 0, length: 0 },
      });
      return accounts[0]?.pubkey ?? null;
    })().catch((err) => {
      this.logger.warn(`Failed to resolve starbasePlayer for ${starbaseName}`, err);
      return null;
    });

    this.starbasePlayerCache.set(cacheKey, {
      expiresAt: Date.now() + STARBASE_PLAYER_CACHE_TTL_MS,
      promise,
    });
    return promise;
  }

  private async resolveLocalMarketSellContext(
    rule: AssetRuleConfig,
    rawResource: ResourceConfig,
  ): Promise<LocalMarketSellContext | null> {
    const cacheKey = `${rule.starbase}:${rawResource.mint.toBase58()}`;
    const cached = this.localMarketSellContextCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.context;
    }

    const starbaseEntry = findStarbaseRegistryEntry(rule.starbase);
    const starbasePlayer = await this.getStarbasePlayer(rule.starbase);
    const cargoToken = await this.getStarbaseCargoPodTokenAccount(rule, rawResource);
    if (!starbaseEntry || !starbasePlayer || !cargoToken) {
      this.localMarketSellContextCache.set(cacheKey, this.makeLocalMarketSellContextEntry(null));
      return null;
    }

    const starbase = new PublicKey(starbaseEntry.publicKey);
    const starbaseAccount = await this.sageProgram.account.starbase.fetch(starbase);
    const gameId = starbaseAccount.gameId as PublicKey;
    const gameAccount = await this.sageProgram.account.game.fetch(gameId);
    const gameState = gameAccount.gameState as PublicKey;
    const certificateMint = findCertificateMintAddress(
      this.sageProgram,
      starbase,
      rawResource.mint,
      Number(starbaseAccount.seqId),
    )[0];
    const cargoType = CargoType.findAddress(this.cargoProgram, CARGO_STATS_DEFINITION, rawResource.mint, 0)[0];
    const certificateTokenAccount = await getAssociatedTokenAddress(
      certificateMint,
      this.wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const starbaseCargoTokenAccount = await getAssociatedTokenAddress(rawResource.mint, starbase, true);
    const profileFaction = ProfileFactionAccount.findAddress(
      this.profileFactionProgram,
      new PublicKey(this.config.ownerProfile),
    )[0];
    const profileFactionAccount = await this.connection.getAccountInfo(profileFaction, 'confirmed');
    if (!profileFactionAccount || !profileFactionAccount.owner.equals(PROFILE_FACTION_PROGRAM_ID)) {
      const owner = profileFactionAccount?.owner.toBase58() ?? 'missing';
      this.logger.warn(
        `OWNER_PROFILE faction account ${profileFaction.toBase58()} is ${owner}; expected ${PROFILE_FACTION_PROGRAM_ID.toBase58()}. Cannot mint local-market certificates.`,
      );
      this.localMarketSellContextCache.set(cacheKey, this.makeLocalMarketSellContextEntry(null));
      return null;
    }
    const profileKeyIndex = await this.resolveOwnerProfileKeyIndex();
    if (profileKeyIndex === null) {
      this.localMarketSellContextCache.set(cacheKey, this.makeLocalMarketSellContextEntry(null));
      return null;
    }

    const context: LocalMarketSellContext = {
      rawResource,
      certificateResource: {
        name: rawResource.name,
        mint: certificateMint,
      },
      starbase,
      starbasePlayer,
      cargoPod: cargoToken.cargoPod,
      cargoTokenAccount: cargoToken.tokenAccount,
      starbaseCargoTokenAccount,
      cargoType,
      certificateMint,
      certificateTokenAccount,
      gameId,
      gameState,
      profileFaction,
      profileKeyIndex,
    };
    this.localMarketSellContextCache.set(cacheKey, this.makeLocalMarketSellContextEntry(context));
    return context;
  }

  private makeLocalMarketSellContextEntry(
    context: LocalMarketSellContext | null,
  ): LocalMarketSellContextCacheEntry {
    return {
      expiresAt: Date.now() + LOCAL_MARKET_SELL_CONTEXT_CACHE_TTL_MS,
      context,
    };
  }

  private async ensureCertificateMint(context: LocalMarketSellContext): Promise<void> {
    const certificateMintAccount = await this.connection.getAccountInfo(context.certificateMint, 'confirmed');
    if (certificateMintAccount) {
      return;
    }

    this.logger.info(`Creating local-market certificate mint for ${context.rawResource.name} at ${context.starbase.toBase58()}.`);
    const transaction = new Transaction();
    const createCertificateMint = await Starbase.createCertificateMint(
      this.sageProgram,
      SAGE_MARKET_HOOK_PROGRAM_ID,
      context.starbase,
      context.rawResource.mint,
      context.certificateMint,
      context.cargoType,
      context.gameId,
    )(keypairToAsyncSigner(this.wallet));

    for (const item of Array.isArray(createCertificateMint) ? createCertificateMint : [createCertificateMint]) {
      transaction.add(item.instruction);
    }

    await this.signAndSend(transaction);
  }

  private async mintLocalMarketCertificates(context: LocalMarketSellContext, quantity: number): Promise<void> {
    if (quantity <= 0) {
      return;
    }

    await this.ensureCertificateMint(context);

    const transaction = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        this.wallet.publicKey,
        context.certificateTokenAccount,
        this.wallet.publicKey,
        context.certificateMint,
        TOKEN_2022_PROGRAM_ID,
      ),
    );

    const mintCertificate = await StarbasePlayer.mintCertificate(
      this.sageProgram,
      this.cargoProgram,
      context.starbasePlayer,
      keypairToAsyncSigner(this.wallet),
      new PublicKey(this.config.ownerProfile),
      context.profileFaction,
      context.starbase,
      context.cargoPod,
      context.cargoType,
      CARGO_STATS_DEFINITION,
      context.certificateTokenAccount,
      context.certificateMint,
      context.cargoTokenAccount,
      context.starbaseCargoTokenAccount,
      context.rawResource.mint,
      context.gameId,
      context.gameState,
      {
        amount: new BN(quantity),
        keyIndex: context.profileKeyIndex,
      },
    )(keypairToAsyncSigner(this.wallet));

    for (const item of Array.isArray(mintCertificate) ? mintCertificate : [mintCertificate]) {
      transaction.add(item.instruction);
    }

    const sig = await this.signAndSend(transaction);
    this.walletBalanceCache.delete(`${context.certificateMint.toBase58()}:${TOKEN_2022_PROGRAM_ID.toBase58()}`);
    this.cargoPodTokenInventoryCache.delete(context.cargoPod.toBase58());

    await this.appendLog({
      event: 'MINT_CERTIFICATES',
      side: 'sell',
      resource: context.rawResource.name,
      mint: context.rawResource.mint.toBase58(),
      certificateMint: context.certificateMint.toBase58(),
      quantity,
      tx: sig,
    });
  }

  private async ensureAnalysisFiles() {
    await fs.mkdir(this.analysisPath, { recursive: true });

    try {
      await fs.access(this.logFilePath);
    } catch {
      await fs.writeFile(this.logFilePath, '', 'utf8');
    }

    try {
      await fs.access(this.stateFilePath);
    } catch {
      await fs.writeFile(this.stateFilePath, JSON.stringify({}, null, 2));
    }

    try {
      await fs.access(this.rpcCounterFilePath);
    } catch {
      await fs.writeFile(this.rpcCounterFilePath, '', 'utf8');
    }
  }

  private async appendRpcCounterSnapshot(snapshot: RpcMethodCounterSnapshot): Promise<void> {
    try {
      await fs.mkdir(this.analysisPath, { recursive: true });
      await fs.appendFile(this.rpcCounterFilePath, `${JSON.stringify(snapshot)}\n`, 'utf8');
    } catch (err) {
      this.logger.warn('Failed to write RPC method counter snapshot:', err);
    }
  }

  private async loadState(): Promise<BotState> {
    try {
      const raw = await fs.readFile(this.stateFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      return normalizeLoadedState(parsed, this.trackedResources);
    } catch {
      if (this.trackedResources.length === 0) {
        return {};
      }

      const legacyKey = this.trackedResources[0].mint.toBase58();
      return {
        [legacyKey]: {
          buy: createEmptySideState(),
          sell: createEmptySideState(),
        },
      };
    }
  }

  private async saveState() {
    await fs.writeFile(this.stateFilePath, JSON.stringify(this.state, null, 2));
  }

  private async appendLog(event: Record<string, unknown>) {
    const payload = { timestamp: new Date().toISOString(), ...event };
    await fs.appendFile(this.logFilePath, JSON.stringify(payload) + '\n', 'utf8');
    this.trackCycleLogEvent(event);
  }

  private trackCycleLogEvent(event: Record<string, unknown>) {
    if (!this.currentCycleStats) {
      return;
    }

    const eventName = String(event.event ?? '');
    if (eventName === 'CYCLE_OK' || eventName === 'NO_CHANGES') {
      return;
    }

    this.currentCycleStats.loggedEvents += 1;
    if (eventName === 'ERROR' || eventName.endsWith('_FAILED')) {
      this.currentCycleStats.errors += 1;
      return;
    }

    if (
      eventName === 'PLACE' ||
      eventName === 'CANCEL' ||
      eventName === 'CANCEL_ACTIVE_ORDER' ||
      eventName === 'MINT_CERTIFICATES' ||
      eventName === 'REDEEM_CERTIFICATES' ||
      eventName === 'FILLED'
    ) {
      this.currentCycleStats.changes += 1;
      return;
    }

    if (eventName.startsWith('SKIP_') || eventName.includes('_SKIP_') || eventName.startsWith('CANCEL_NO_')) {
      this.currentCycleStats.skips += 1;
      if (event.retryable === true || eventName === 'SKIP_LOCAL_MARKET_CONTEXT') {
        this.currentCycleStats.retryableSkips += 1;
      }
    }
  }

  private async setLastWalletBalance(resource: ResourceConfig, side: AssetRuleSide, balance: number) {
    const mintKey = resource.mint.toBase58();
    const resourceState = ensureResourceState(this.state, mintKey);
    const sideState = getSideState(resourceState, side);
    sideState.lastWalletBalance = balance;
    await this.saveState();
  }

  private getLastWalletBalance(resource: ResourceConfig, side: AssetRuleSide): number | undefined {
    const mintKey = resource.mint.toBase58();
    const resourceState = ensureResourceState(this.state, mintKey);
    const sideState = getSideState(resourceState, side);
    return sideState.lastWalletBalance;
  }

  private async syncPostPlacementWalletBalance(resource: ResourceConfig, side: AssetRuleSide) {
    const quoteMint = getQuoteMintForResource(resource);
    const balanceMint = side === 'sell' ? resource.mint : quoteMint;
    const balanceName = side === 'sell' ? resource.name : getQuoteSymbolForMint(quoteMint);
    const balance = await this.getWalletBalanceForMint(balanceMint, balanceName, { refresh: true });
    await this.setLastWalletBalance(resource, side, balance);
    return balance;
  }

  private async getSolBalance(options?: { refresh?: boolean }): Promise<number> {
    const cached = this.solBalanceCache;
    if (!options?.refresh && cached && cached.expiresAt > Date.now()) {
      return cached.promise;
    }

    const fallback = cached?.promise;
    const promise = (async () => {
      try {
        const solLamports = await this.connection.getBalance(this.wallet.publicKey, 'confirmed');
        return solLamports / 1e9;
      } catch (err) {
        this.logger.warn('Failed to fetch SOL balance', err);
        return fallback ? await fallback.catch(() => 0) : 0;
      }
    })();

    this.solBalanceCache = {
      expiresAt: Date.now() + SOL_BALANCE_CACHE_TTL_MS,
      promise,
    };
    return promise;
  }

  private async getWalletBalanceForMint(
    mint: PublicKey,
    resourceName: string,
    options?: { refresh?: boolean; tokenProgramId?: PublicKey },
  ): Promise<number> {
    const tokenProgramId = options?.tokenProgramId ?? TOKEN_PROGRAM_ID;
    const mintKey = `${mint.toBase58()}:${tokenProgramId.toBase58()}`;
    const cached = this.walletBalanceCache.get(mintKey);
    if (!options?.refresh && cached && cached.expiresAt > Date.now()) {
      return cached.promise;
    }

    const ata = await getAssociatedTokenAddress(mint, this.wallet.publicKey, false, tokenProgramId);
    const fallback = cached?.promise;
    const promise = (async () => {
      try {
        const balance = await this.connection.getTokenAccountBalance(ata);
        const amount = Number(balance.value.amount ?? '0');
        const decimals = balance.value.decimals ?? 0;
        return amount / 10 ** decimals;
      } catch (err) {
        const message = (err as Error).message ?? '';
        if (message.includes('could not find account')) {
          return 0;
        }
        this.logger.warn(`Failed to fetch ${resourceName} balance`, err);
        return fallback ? await fallback.catch(() => 0) : 0;
      }
    })();

    this.walletBalanceCache.set(mintKey, {
      expiresAt: Date.now() + WALLET_TOKEN_BALANCE_CACHE_TTL_MS,
      promise,
    });
    return promise;
  }

  private async submitTransactionRateLimited(
    transaction: Transaction,
    extraSigners: Keypair[] = [],
  ): Promise<{ signature: string; blockhash: string; lastValidBlockHeight: number }> {
    const submit = this.transactionSubmissionQueue.then(async () => {
      const waitMs = Math.max(0, this.nextTransactionSubmitAtMs - Date.now());
      if (waitMs > 0) {
        this.logger.info(`RPC tx rate limit: waiting ${waitMs}ms before next transaction submission.`);
        await sleep(waitMs);
      }

      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = this.wallet.publicKey;
      const signers = [...extraSigners, this.wallet];
      transaction.partialSign(...signers);

      try {
        const signature = await this.connection.sendRawTransaction(transaction.serialize());
        return { signature, blockhash, lastValidBlockHeight };
      } catch (error) {
        const logs = await getSendTransactionLogs(error, this.connection);
        if (logs?.length) {
          this.logger.error(`Solana transaction failed before confirmation. Full transaction logs:\n${logs.join('\n')}`);
        } else {
          this.logger.error('Solana transaction failed before confirmation and no transaction logs were available.');
        }
        throw error;
      } finally {
        this.nextTransactionSubmitAtMs = Date.now() + 1000 / this.config.rpcTxSendRateLimitPerSecond;
      }
    });

    this.transactionSubmissionQueue = submit.then(
      () => undefined,
      () => undefined,
    );

    return await submit;
  }

  private async signAndSend(transaction: Transaction, extraSigners: Keypair[] = []): Promise<string> {
    await this.normalizeAssociatedTokenAccountInstructions(transaction);
    const { signature, blockhash, lastValidBlockHeight } = await this.submitTransactionRateLimited(transaction, extraSigners);
    const confirmation = await this.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    if (confirmation.value.err) {
      throw new Error(`Transaction ${signature} failed during confirmation: ${JSON.stringify(confirmation.value.err)}`);
    }
    return signature;
  }

  private async normalizeAssociatedTokenAccountInstructions(transaction: Transaction): Promise<void> {
    for (const instruction of transaction.instructions) {
      if (!instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) || instruction.keys.length < 6) {
        continue;
      }

      const ataKey = instruction.keys[1];
      const owner = instruction.keys[2]?.pubkey;
      const mint = instruction.keys[3]?.pubkey;
      const tokenProgramKey = instruction.keys[5];
      if (!ataKey || !owner || !mint || !tokenProgramKey) {
        continue;
      }

      const mintAccount = await this.connection.getAccountInfo(mint, 'confirmed');
      if (!mintAccount?.owner.equals(TOKEN_2022_PROGRAM_ID)) {
        continue;
      }

      const expectedAta = await getAssociatedTokenAddress(
        mint,
        owner,
        true,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      let changed = false;

      if (!ataKey.pubkey.equals(expectedAta)) {
        instruction.keys[1] = {
          ...ataKey,
          pubkey: expectedAta,
        };
        changed = true;
      }

      if (!tokenProgramKey.pubkey.equals(TOKEN_2022_PROGRAM_ID)) {
        instruction.keys[5] = {
          ...tokenProgramKey,
          pubkey: TOKEN_2022_PROGRAM_ID,
        };
        changed = true;
      }

      if (changed) {
        this.logger.info(`Using Token-2022 ATA ${expectedAta.toBase58()} for ${mint.toBase58()}.`);
      }
    }
  }

  private async cancelOrder(order: Order, resource: ResourceConfig, side: AssetRuleSide, cancelledIds: Set<string>): Promise<string> {
    this.logger.info(`Cancelling ${side} order for ${resource.name} ${order.id} at ${order.uiPrice} ATLAS`);

    const depositMintAccount = await this.connection.getAccountInfo(resource.mint, 'confirmed');
    const isToken2022SellCancel = side === 'sell' && depositMintAccount?.owner.equals(TOKEN_2022_PROGRAM_ID);

    const { transaction, signers } = await this.gm.getCancelOrderTransaction(
      this.connection,
      new PublicKey(order.id),
      this.wallet.publicKey,
      GM_PROGRAM_ID,
    );
    const cancelInstruction = transaction.instructions[transaction.instructions.length - 1];

    if (isToken2022SellCancel) {
      const initializerDepositTokenAccount = await getAssociatedTokenAddress(
        resource.mint,
        this.wallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      this.insertInstructionAfterComputeBudget(
        transaction,
        createAssociatedTokenAccountIdempotentInstruction(
          this.wallet.publicKey,
          initializerDepositTokenAccount,
          this.wallet.publicKey,
          resource.mint,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
      await this.addToken2022TransferHookAccountsForGmCancel(resource.mint, cancelInstruction);
    } else {
      const cancelDepositMint = side === 'sell' ? resource.mint : getQuoteMintForResource(resource);
      await this.addToken2022TransferHookAccountsForGmInstruction(
        cancelDepositMint,
        cancelInstruction,
        'cancel',
      );
    }
    const sig = await this.signAndSend(transaction, signers);

    this.invalidateMarketLeaderCacheForMint(resource.mint.toBase58());
    cancelledIds.add(order.id);
    this.recentlyCancelledOrderIds.add(order.id);

    await this.appendLog({
      event: 'CANCEL',
      side,
      resource: resource.name,
      mint: resource.mint.toBase58(),
      orderId: order.id,
      tx: sig,
      price: order.uiPrice,
      remaining: order.orderQtyRemaining,
    });
    return sig;
  }

  private insertInstructionAfterComputeBudget(transaction: Transaction, instruction: TransactionInstruction): void {
    const insertAt = transaction.instructions.findIndex((candidate) => !candidate.programId.equals(COMPUTE_BUDGET_PROGRAM_ID));
    transaction.instructions.splice(insertAt >= 0 ? insertAt : transaction.instructions.length, 0, instruction);
  }

  private async getInitializeSellOrderTransaction(
    depositMint: PublicKey,
    receiveMint: PublicKey,
    quantity: number,
    price: unknown,
    initializerDepositTokenAccount: PublicKey,
  ): Promise<{ transaction: Transaction; signers: Keypair[] }> {
    const { createInitializeSellOrderInstruction } = require('@staratlas/factory/dist/marketplace/instruction_builders/createOrder');
    const { ixSet } = await createInitializeSellOrderInstruction({
      connection: this.connection,
      initializerMainAccount: this.wallet.publicKey,
      initializerDepositTokenAccount,
      price,
      originationQty: quantity,
      depositMint,
      receiveMint,
      programId: GM_PROGRAM_ID,
    });

    const sellInstruction = ixSet.instructions[ixSet.instructions.length - 1];
    await this.addToken2022TransferHookAccountsForGmInstruction(
      depositMint,
      sellInstruction,
      'sell order',
    );

    const transaction = new Transaction();
    for (const instruction of ixSet.instructions) {
      transaction.add(instruction);
    }

    return { transaction, signers: ixSet.signers };
  }

  private async addToken2022TransferHookAccountsForGmInstruction(
    depositMint: PublicKey,
    instruction: Transaction['instructions'][number],
    actionLabel: string,
  ): Promise<void> {
    const mintAccount = await this.connection.getAccountInfo(depositMint, 'confirmed');
    if (!mintAccount || !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      return;
    }

    // Do NOT swap the base `tokenProgram` account slot — the GM trader program
    // expects the classic SPL Token program there even for Token-2022 deposit
    // mints. Token-2022 belongs in the remaining-account tail below.
    // (See v0.1.20 commit 1052c5b; v0.2.25 re-added the swap and broke sells.)

    const mint = unpackMint(depositMint, mintAccount, TOKEN_2022_PROGRAM_ID);
    const transferHook = getTransferHook(mint);
    if (!transferHook) {
      return;
    }

    const keyCountBefore = instruction.keys.length;
    const extraAccountMetaList = await getExtraAccountMetaAddress(depositMint, transferHook.programId);

    for (const pubkey of [
      extraAccountMetaList,
      transferHook.programId,
      TOKEN_2022_PROGRAM_ID,
      new PublicKey('Sysvar1nstructions1111111111111111111111111'),
    ]) {
      if (!instruction.keys.some((key) => key.pubkey.equals(pubkey))) {
        instruction.keys.push({ pubkey, isSigner: false, isWritable: false });
      }
    }

    const addedKeyCount = instruction.keys.length - keyCountBefore;
    if (addedKeyCount > 0) {
      this.logger.info(
        `Added ${addedKeyCount} Token-2022 transfer-hook account(s) for ${depositMint.toBase58()} ${actionLabel}.`,
      );
    }
  }

  private async addToken2022TransferHookAccountsForGmCancel(
    depositMint: PublicKey,
    instruction: Transaction['instructions'][number],
  ): Promise<void> {
    const mintAccount = await this.connection.getAccountInfo(depositMint, 'confirmed');
    if (!mintAccount || !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      return;
    }

    const mint = unpackMint(depositMint, mintAccount, TOKEN_2022_PROGRAM_ID);
    const transferHook = getTransferHook(mint);
    if (!transferHook) {
      return;
    }

    const beforeTokenProgramRemoval = instruction.keys.length;
    instruction.keys = instruction.keys.filter((key) => !key.pubkey.equals(TOKEN_PROGRAM_ID));
    const removedClassicTokenProgram = beforeTokenProgramRemoval - instruction.keys.length;

    const keyCountBefore = instruction.keys.length;
    const extraAccountMetaList = await getExtraAccountMetaAddress(depositMint, transferHook.programId);

    for (const pubkey of [
      extraAccountMetaList,
      transferHook.programId,
      TOKEN_2022_PROGRAM_ID,
      new PublicKey('Sysvar1nstructions1111111111111111111111111'),
    ]) {
      if (!instruction.keys.some((key) => key.pubkey.equals(pubkey))) {
        instruction.keys.push({ pubkey, isSigner: false, isWritable: false });
      }
    }

    const addedKeyCount = instruction.keys.length - keyCountBefore;
    if (removedClassicTokenProgram > 0 || addedKeyCount > 0) {
      this.logger.info(
        `Prepared Token-2022 transfer-hook accounts for ${depositMint.toBase58()} cancel ` +
          `(removed ${removedClassicTokenProgram} classic token program account(s), added ${addedKeyCount} account(s)).`,
      );
    }
  }

  private async placeOrder(
    resource: ResourceConfig,
    side: AssetRuleSide,
    targetPrice: number,
    quantity: number,
    cancelledIds: Set<string> = new Set<string>(),
    quoteMintOverride?: PublicKey,
    sellDepositTokenAccount?: PublicKey,
  ) {
    const quoteMint = quoteMintOverride ?? getQuoteMintForResource(resource);
    const quoteSymbol = getQuoteSymbolForMint(quoteMint);
    this.logger.info(`Placing ${side} order for ${quantity} ${resource.name} @ ${targetPrice} ${quoteSymbol}`);
    const priceBn = await this.gm.getBnPriceForCurrency(this.connection, targetPrice, quoteMint, GM_PROGRAM_ID);
    const { transaction, signers } =
      side === 'sell' && sellDepositTokenAccount
        ? await this.getInitializeSellOrderTransaction(resource.mint, quoteMint, quantity, priceBn, sellDepositTokenAccount)
        : await this.gm.getInitializeOrderTransaction(
            this.connection,
            this.wallet.publicKey,
            resource.mint,
            quoteMint,
            quantity,
            priceBn,
            GM_PROGRAM_ID,
            getSideOrderType(side),
          );

    const sig = await this.signAndSend(transaction, signers);

    this.invalidateMarketLeaderCacheForMint(resource.mint.toBase58());

    await this.appendLog({
      event: 'PLACE',
      side,
      resource: resource.name,
      mint: resource.mint.toBase58(),
      tx: sig,
      price: targetPrice,
      quantity,
      currency: quoteSymbol,
    });

    const refreshedOrdersRaw = await this.readMyOpenOrdersForResource(resource, { refresh: true });

    const refreshedOrders = refreshedOrdersRaw.filter(
      (o) => o.orderType === getSideOrderType(side) && isOrderForQuoteMint(o, quoteMint),
    );

    await this.detectFills(resource, side, refreshedOrders, cancelledIds);
  }

  private async detectFills(
    resource: ResourceConfig,
    side: AssetRuleSide,
    currentOrders: Order[],
    cancelledIds: Set<string>,
  ) {
    const mintKey = resource.mint.toBase58();
    const resourceState = ensureResourceState(this.state, mintKey);
    const sideState = getSideState(resourceState, side);
    const currentById = new Map(currentOrders.map((order) => [order.id, order]));
    const currentIds = new Set(currentById.keys());

    for (const [orderId, meta] of Object.entries(sideState.openOrders)) {
      const currentOrder = currentById.get(orderId);
      const wasCancelled =
        cancelledIds.has(orderId) || this.recentlyCancelledOrderIds.has(orderId);
      const transition = classifyTrackedOrderTransition(
        meta,
        currentOrder ? getOrderRemainingQuantity(currentOrder) : null,
        wasCancelled,
      );

      if (transition?.kind === 'partial-fill') {
        await this.appendLog({
          event: 'FILLED',
          side,
          resource: resource.name,
          mint: resource.mint.toBase58(),
          orderId,
          price: meta.price,
          quantity: meta.quantity,
          filledDelta: transition.filledDelta,
          remaining: transition.remaining,
          message: `Filled +${transition.filledDelta}. Remaining ${transition.remaining}/${meta.quantity ?? meta.remaining}`,
        });
      }

      if (transition?.kind === 'full-fill') {
        await this.appendLog({
          event: 'FILLED',
          side,
          resource: resource.name,
          mint: resource.mint.toBase58(),
          orderId,
          price: meta.price,
          quantity: meta.quantity,
          remaining: 0,
          message: `Order fully filled (${meta.quantity ?? meta.remaining}/${meta.quantity ?? meta.remaining}).`,
        });
      }
    }

    const nextSideState: ResourceSideOrderState = {
      openOrders: {},
      lastWalletBalance: sideState.lastWalletBalance,
    };

    const now = new Date().toISOString();

    for (const order of currentOrders) {
      nextSideState.openOrders[order.id] = {
        price: order.uiPrice,
        remaining: getOrderRemainingQuantity(order),
        quantity: getOrderTrackedQuantity(order),
        updatedAt: now,
      };
    }

    if (side === 'buy') {
      resourceState.buy = nextSideState;
    } else {
      resourceState.sell = nextSideState;
    }

    this.state[mintKey] = resourceState;
    await this.saveState();

    for (const orderId of Object.keys(sideState.openOrders)) {
      if (!currentIds.has(orderId)) {
        this.recentlyCancelledOrderIds.delete(orderId);
      }
    }
  }

  private getTargetSellPrice(
    allSellOrders: Order[],
    minPrice: number,
    minRelevantQuantity: number,
    maxPrice?: number | null,
  ): number {
    const externalSellOrders = allSellOrders
      .filter(
        (o) =>
          o.owner !== this.wallet.publicKey.toBase58() &&
          getOrderBookQuantity(o) >= minRelevantQuantity,
      )
      .sort((a, b) => a.uiPrice - b.uiPrice);

    if (externalSellOrders.length === 0) {
      return clampPrice(maxPrice ?? minPrice, minPrice, maxPrice ?? minPrice);
    }

    const bestSell = externalSellOrders[0];

    if (bestSell.uiPrice >= minPrice) {
      const undercutPrice = Math.max(0, bestSell.uiPrice - ORDER_PRICE_NUDGE);
      return clampPrice(Math.max(minPrice, roundDown(undercutPrice, 6)), minPrice, maxPrice);
    }

    const nextHigherSell = externalSellOrders.find((o) => o.uiPrice >= minPrice);

    if (nextHigherSell) {
      const undercutPrice = Math.max(0, nextHigherSell.uiPrice - ORDER_PRICE_NUDGE);
      return clampPrice(Math.max(minPrice, roundDown(undercutPrice, 6)), minPrice, maxPrice);
    }

    return clampPrice(maxPrice ?? minPrice, minPrice, maxPrice ?? minPrice);
  }

  private getTargetBuyPrice(
    allBuyOrders: Order[],
    maxBuyPrice: number,
    minRelevantQuantity: number,
    options?: { outbidPct?: number; minPrice?: number | null },
  ): number {
    const externalBuyOrders = allBuyOrders
      .filter(
        (o) =>
          o.owner !== this.wallet.publicKey.toBase58() &&
          getOrderBookQuantity(o) >= minRelevantQuantity,
      )
      .sort((a, b) => b.uiPrice - a.uiPrice);

    if (externalBuyOrders.length === 0) {
      return clampPrice(options?.minPrice ?? maxBuyPrice, options?.minPrice ?? null, maxBuyPrice);
    }

    const bestBuy = externalBuyOrders[0];

    if (bestBuy.uiPrice < maxBuyPrice - ORDER_PRICE_EPSILON) {
      const improvedBid = options?.outbidPct ? bestBuy.uiPrice * (1 + options.outbidPct) : bestBuy.uiPrice + ORDER_PRICE_NUDGE;
      return clampPrice(Math.min(maxBuyPrice, roundUp(improvedBid, 6)), options?.minPrice ?? null, maxBuyPrice);
    }

    if (Math.abs(bestBuy.uiPrice - maxBuyPrice) < ORDER_PRICE_EPSILON) {
      const nextLowerBuy = externalBuyOrders.find((o) => o.uiPrice < maxBuyPrice - ORDER_PRICE_EPSILON);
      if (nextLowerBuy) {
        const improvedBid = options?.outbidPct ? nextLowerBuy.uiPrice * (1 + options.outbidPct) : nextLowerBuy.uiPrice + ORDER_PRICE_NUDGE;
        return clampPrice(Math.min(maxBuyPrice, roundUp(improvedBid, 6)), options?.minPrice ?? null, maxBuyPrice);
      }
      return clampPrice(maxBuyPrice, options?.minPrice ?? null, maxBuyPrice);
    }

    const nextLowerBuy = externalBuyOrders.find((o) => o.uiPrice <= maxBuyPrice);

    if (nextLowerBuy) {
      const improvedBid = options?.outbidPct ? nextLowerBuy.uiPrice * (1 + options.outbidPct) : nextLowerBuy.uiPrice + ORDER_PRICE_NUDGE;
      return clampPrice(Math.min(maxBuyPrice, roundUp(improvedBid, 6)), options?.minPrice ?? null, maxBuyPrice);
    }

    return clampPrice(options?.minPrice ?? maxBuyPrice, options?.minPrice ?? null, maxBuyPrice);
  }

  private async readMyOpenOrdersForResource(
    resource: ResourceConfig,
    options: OpenOrderReadOptions = {},
  ): Promise<Order[]> {
    const mintKey = resource.mint.toBase58();
    const cached = this.myOpenOrdersCache.get(mintKey);
    if (!options.refresh && cached && cached.expiresAt > Date.now()) {
      return cached.promise;
    }

    const promise = this.gm
      .getOpenOrdersForPlayerAndAsset(this.connection, this.wallet.publicKey, resource.mint, GM_PROGRAM_ID)
      .catch((error) => {
        this.myOpenOrdersCache.delete(mintKey);
        throw error;
      });

    this.myOpenOrdersCache.set(mintKey, {
      expiresAt: Date.now() + OPEN_ORDERS_CACHE_TTL_MS,
      promise,
    });

    return promise;
  }

  private async readMarketOrderSnapshot(
    resource: ResourceConfig,
    options: OpenOrderReadOptions = {},
  ): Promise<MarketOrderSnapshot> {
    const mintKey = resource.mint.toBase58();
    const cached = this.marketOrderSnapshotCache.get(mintKey);
    if (!options.refresh && cached && cached.expiresAt > Date.now()) {
      return cached.promise;
    }

    const promise = (async () => {
      const allOrdersRaw = await this.gm.getOpenOrdersForAsset(this.connection, resource.mint, GM_PROGRAM_ID);
      const myOrdersRaw = await this.readMyOpenOrdersForResource(resource, options);
      try {
        await this.cacheMarketLeadersFromOrders(resource.mint, allOrdersRaw);
      } catch (error) {
        this.logger.warn(`Failed to cache market leader data for ${resource.name}:`, error);
      }
      return { allOrdersRaw, myOrdersRaw };
    })().catch((error) => {
      this.marketOrderSnapshotCache.delete(mintKey);
      throw error;
    });

    this.marketOrderSnapshotCache.set(mintKey, {
      expiresAt: Date.now() + OPEN_ORDERS_CACHE_TTL_MS,
      promise,
    });

    return promise;
  }

  private async processSellRule(
    resource: ResourceConfig,
    minSellQuantity: number,
    minPrice: number,
    quoteMintOverride?: PublicKey,
    marketOrderSnapshot?: MarketOrderSnapshot,
    limit?: number | null,
    rule?: AssetRuleConfig,
  ) {
    this.logger.info(`[${new Date().toISOString()}] Checking ${resource.name} sell market...`);
    const cancelledIds = new Set<string>();
    const localMarketContext = rule ? await this.resolveLocalMarketSellContext(rule, resource) : null;
    const sellResource = localMarketContext?.certificateResource ?? resource;
    const sellDepositTokenAccount = localMarketContext?.certificateTokenAccount;
    const { allOrdersRaw, myOrdersRaw } =
      marketOrderSnapshot && sellResource.mint.equals(resource.mint)
        ? marketOrderSnapshot
        : await this.readMarketOrderSnapshot(sellResource);

    const quoteMint = quoteMintOverride ?? getQuoteMintForResource(sellResource);
    const allOrders = allOrdersRaw.filter((o) => o.orderType === OrderSide.Sell && isOrderForQuoteMint(o, quoteMint));
    const myOrders = myOrdersRaw.filter((o) => o.orderType === OrderSide.Sell && isOrderForQuoteMint(o, quoteMint));
    const staleQuoteOrders = myOrdersRaw.filter((o) => o.orderType === OrderSide.Sell && !isOrderForQuoteMint(o, quoteMint));

    for (const staleOrder of staleQuoteOrders) {
      await this.cancelOrder(staleOrder, sellResource, 'sell', cancelledIds);
    }

    await this.detectFills(sellResource, 'sell', myOrders, cancelledIds);

    const walletSellBalance = await this.getWalletBalanceForMint(sellResource.mint, sellResource.name, {
      tokenProgramId: localMarketContext ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    });
    const cargoSellBalance = rule ? await this.getStarbaseCargoPodBalance(rule, resource) : null;
    const relevantSellQuantity = getRelevantOrderThreshold(minSellQuantity, this.config.relevantSellOrderPct);
    const targetPrice = this.getTargetSellPrice(allOrders, minPrice, relevantSellQuantity, rule?.maxPrice);
    const refillEnabled = rule?.refill !== false;

    this.logger.info(`${resource.name} wallet sell availability: ${walletSellBalance}`);
    if (cargoSellBalance !== null) {
      this.logger.info(`${resource.name} starbase cargo inventory: ${cargoSellBalance}`);
    }

    if (rule && !localMarketContext && (cargoSellBalance ?? 0) > 0) {
      this.logger.warn(
        `${resource.name} starbase cargo inventory exists (${cargoSellBalance}) but local-market sell context is unavailable. ` +
          'Skipping this cycle and retrying later.',
      );
      await this.appendLog({
        event: 'SKIP_LOCAL_MARKET_CONTEXT',
        side: 'sell',
        asset: rule.asset,
        resource: resource.name,
        mint: resource.mint.toBase58(),
        balance: walletSellBalance,
        cargoBalance: cargoSellBalance,
        minSellQuantity,
        inventorySource: 'starbase-cargo-pod',
        retryable: true,
        message:
          'Starbase cargo exists, but the bot could not resolve the certificate/local-market context needed to mint and sell it.',
      });
      return;
    }

    const sortedMyOrders = [...myOrders].sort((a, b) => {
      const priceCompare = a.uiPrice - b.uiPrice;
      if (Math.abs(priceCompare) >= ORDER_PRICE_EPSILON) {
        return priceCompare;
      }
      return a.id.localeCompare(b.id);
    });
    const activeOrder = sortedMyOrders[0];

    if (!activeOrder) {
      if (!refillEnabled) {
        this.logger.info(`Refill disabled for ${resource.name} sell rule and no active order exists. Skipping new sell order.`);
        await this.appendLog({
          event: 'SKIP_REFILL_DISABLED',
          side: 'sell',
          asset: rule?.asset,
          resource: sellResource.name,
          mint: sellResource.mint.toBase58(),
          balance: walletSellBalance,
          cargoBalance: cargoSellBalance ?? undefined,
          minSellQuantity,
          inventorySource: localMarketContext ? 'starbase-cargo-pod' : 'wallet',
          message: 'Refill is disabled for this sell rule, so the bot will not create a new sell order.',
        });
        return;
      }

      const availableToSell = Math.min(
        Math.floor(walletSellBalance + (localMarketContext ? cargoSellBalance ?? 0 : 0)),
        limit ?? Number.POSITIVE_INFINITY,
      );
      if (availableToSell < minSellQuantity) {
        this.logger.info(`Insufficient ${resource.name} local-market sell inventory. Skipping.`);
        await this.appendLog({
          event: 'SKIP_NO_INVENTORY',
          side: 'sell',
          asset: rule?.asset,
          resource: sellResource.name,
          mint: sellResource.mint.toBase58(),
          balance: walletSellBalance,
          cargoBalance: cargoSellBalance ?? undefined,
          minSellQuantity,
          inventorySource: localMarketContext ? 'starbase-cargo-pod' : 'wallet',
        });
        return;
      }

      const quantityToSell = Math.min(availableToSell, limit ?? availableToSell);
      if (quantityToSell < minSellQuantity) {
        this.logger.info(
          `Available ${resource.name} sell quantity after limit is ${quantityToSell}, below minimum ${minSellQuantity}. Skipping.`,
        );
        return;
      }
      if (localMarketContext && walletSellBalance < quantityToSell) {
        const certificateQuantity = quantityToSell - Math.floor(walletSellBalance);
        this.logger.info(`Minting ${certificateQuantity} ${resource.name} local-market certificates before selling.`);
        await this.mintLocalMarketCertificates(localMarketContext, certificateQuantity);
      }
      this.logger.info(`Planning to sell ${quantityToSell} ${resource.name} this cycle.`);
      await this.placeOrder(sellResource, 'sell', targetPrice, quantityToSell, cancelledIds, quoteMint, sellDepositTokenAccount);
      const postPlacementBalance = await this.getWalletBalanceForMint(sellResource.mint, sellResource.name, {
        refresh: true,
        tokenProgramId: localMarketContext ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      });
      await this.setLastWalletBalance(sellResource, 'sell', postPlacementBalance);
      this.logger.info(`Stored sell wallet baseline for ${resource.name}: ${postPlacementBalance}`);
      return;
    }

    const activeQuantity = sortedMyOrders.reduce((sum, order) => sum + getOrderRemainingQuantity(order), 0);
    const walletAvailableQuantity = Math.max(0, Math.floor(walletSellBalance));
    const freeAvailableQuantity = Math.max(
      0,
      Math.floor(walletSellBalance + (localMarketContext ? cargoSellBalance ?? 0 : 0)),
    );
    const remainingSellAllowance = Math.max(0, (limit ?? Number.POSITIVE_INFINITY) - activeQuantity);
    const addableAvailableQuantity = Math.min(freeAvailableQuantity, remainingSellAllowance);
    const canTopUpToSellLimit =
      typeof limit === 'number' &&
      remainingSellAllowance > 0 &&
      freeAvailableQuantity >= remainingSellAllowance;
    const shouldResizeForAvailableInventory = refillEnabled && (addableAvailableQuantity >= minSellQuantity || canTopUpToSellLimit);
    const shouldResizeForLimit = typeof limit === 'number' && activeQuantity > limit;
    const shouldResizeToConfiguredLimit =
      typeof limit === 'number' &&
      activeQuantity < limit &&
      shouldResizeForAvailableInventory &&
      addableAvailableQuantity > 0;
    const shouldReplaceForPrice = sortedMyOrders.some((order) => Math.abs(order.uiPrice - targetPrice) >= ORDER_PRICE_EPSILON);
    const shouldConsolidateOrders = sortedMyOrders.length > 1;
    const canTopUpWithoutCancelling =
      shouldResizeForAvailableInventory && !shouldResizeForLimit && !shouldResizeToConfiguredLimit;

    if (canTopUpWithoutCancelling) {
      const topUpQuantity = addableAvailableQuantity;
      if (topUpQuantity <= 0) {
        this.logger.info(`No free ${resource.name} sell quantity is available for top-up. Nothing to do.`);
        return;
      }

      this.logger.info(
        canTopUpToSellLimit
          ? `Sell wallet inventory for ${resource.name} is ${freeAvailableQuantity}. Placing top-up order for ${topUpQuantity} to reach sell limit ${activeQuantity + topUpQuantity}.`
          : `Sell wallet inventory for ${resource.name} is ${freeAvailableQuantity}. Placing additional sell order for ${topUpQuantity}.`,
      );
      if (shouldReplaceForPrice || shouldConsolidateOrders) {
        this.logger.info(
          `Leaving existing ${resource.name} sell order(s) unchanged this cycle and placing an additive top-up order.`,
        );
      }

      if (localMarketContext && walletAvailableQuantity < topUpQuantity) {
        const certificateQuantity = topUpQuantity - walletAvailableQuantity;
        this.logger.info(`Minting ${certificateQuantity} ${resource.name} local-market certificates before top-up sell order.`);
        await this.mintLocalMarketCertificates(localMarketContext, certificateQuantity);
      }

      await this.placeOrder(sellResource, 'sell', targetPrice, topUpQuantity, cancelledIds, quoteMint, sellDepositTokenAccount);
      const postPlacementBalance = await this.getWalletBalanceForMint(sellResource.mint, sellResource.name, {
        refresh: true,
        tokenProgramId: localMarketContext ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      });
      await this.setLastWalletBalance(sellResource, 'sell', postPlacementBalance);
      this.logger.info(`Stored sell wallet baseline for ${resource.name}: ${postPlacementBalance}`);
      return;
    }

    if (shouldResizeForLimit || shouldResizeToConfiguredLimit || shouldReplaceForPrice || shouldConsolidateOrders) {
      const nextQuantity = shouldResizeForLimit
        ? limit ?? activeQuantity
        : shouldResizeForAvailableInventory
          ? activeQuantity + addableAvailableQuantity
          : activeQuantity;

      if (shouldResizeForLimit) {
        this.logger.info(
          `Sell limit for ${resource.name} is ${limit}. Resizing order from ${activeQuantity} to ${nextQuantity}.`,
        );
      } else if (shouldResizeForAvailableInventory) {
        this.logger.info(
          canTopUpToSellLimit
            ? `Sell wallet inventory for ${resource.name} is ${freeAvailableQuantity}. Topping up order from ${activeQuantity} to sell limit ${nextQuantity}.`
            : `Sell wallet inventory for ${resource.name} is ${freeAvailableQuantity}. Resizing order from ${activeQuantity} to ${nextQuantity}.`,
        );
      } else if (shouldReplaceForPrice) {
        this.logger.info(
          `Sell price moved for ${resource.name}. Replacing ${sortedMyOrders.length} order(s) at ${targetPrice} while keeping total quantity ${activeQuantity}.`,
        );
      } else {
        this.logger.info(
          `Consolidating ${sortedMyOrders.length} ${resource.name} sell orders into one order with total quantity ${activeQuantity}.`,
        );
      }

      let skippedCancel = false;
      for (const order of sortedMyOrders) {
        const cancelTx = await this.cancelOrder(order, sellResource, 'sell', cancelledIds);
        if (!cancelTx) {
          skippedCancel = true;
        }
      }

      if (skippedCancel) {
        this.logger.warn(
          `Cannot replace ${resource.name} sell order(s): at least one Token-2022 cancel was skipped, ` +
            `so the existing order quantity is still locked in the market vault.`,
        );
        await this.appendLog({
          event: 'REPLACE_SKIP_UNCANCELLED_TOKEN_2022',
          side: 'sell',
          asset: rule?.asset,
          resource: sellResource.name,
          mint: sellResource.mint.toBase58(),
          targetPrice,
          nextQuantity,
          activeQuantity,
          walletAvailableQuantity,
          freeAvailableQuantity,
          orderIds: sortedMyOrders.map((order) => order.id),
          message: 'Skipped replacement because Token-2022 cancel did not release the existing order quantity.',
        });
        return;
      }

      if (localMarketContext && shouldResizeForAvailableInventory && walletAvailableQuantity < addableAvailableQuantity) {
        const certificateQuantity = addableAvailableQuantity - walletAvailableQuantity;
        this.logger.info(`Minting ${certificateQuantity} ${resource.name} local-market certificates before resizing sell order.`);
        await this.mintLocalMarketCertificates(localMarketContext, certificateQuantity);
      }

      await this.placeOrder(sellResource, 'sell', targetPrice, nextQuantity, cancelledIds, quoteMint, sellDepositTokenAccount);
      const postPlacementBalance = await this.getWalletBalanceForMint(sellResource.mint, sellResource.name, {
        refresh: true,
        tokenProgramId: localMarketContext ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
      });
      await this.setLastWalletBalance(sellResource, 'sell', postPlacementBalance);
      this.logger.info(`Stored sell wallet baseline for ${resource.name}: ${postPlacementBalance}`);
      return;
    }

    this.logger.info(
      `Sell order ${activeOrder.id} already at target price (${activeOrder.uiPrice}) and total active quantity (${activeQuantity}) plus wallet inventory (${freeAvailableQuantity}) is below threshold or limit. Nothing to do.`,
    );
  }

  private async processSellRules(
    rules: Array<{ index: number; rule: AssetRuleConfig }>,
    resource: ResourceConfig,
    quoteMintOverride?: PublicKey,
  ) {
    this.logger.info(`[${new Date().toISOString()}] Checking ${resource.name} sell market for ${rules.length} rules...`);
    const cancelledIds = new Set<string>();
    const firstRule = rules[0].rule;
    const localMarketContext = await this.resolveLocalMarketSellContext(firstRule, resource);
    const sellResource = localMarketContext?.certificateResource ?? resource;
    const sellDepositTokenAccount = localMarketContext?.certificateTokenAccount;
    const { allOrdersRaw, myOrdersRaw } = await this.readMarketOrderSnapshot(sellResource);

    const quoteMint = quoteMintOverride ?? getQuoteMintForResource(sellResource);
    const quoteSymbol = getQuoteSymbolForMint(quoteMint);
    const allOrders = allOrdersRaw.filter((o) => o.orderType === OrderSide.Sell && isOrderForQuoteMint(o, quoteMint));
    const myOrders = myOrdersRaw.filter((o) => o.orderType === OrderSide.Sell && isOrderForQuoteMint(o, quoteMint));
    const staleQuoteOrders = myOrdersRaw.filter((o) => o.orderType === OrderSide.Sell && !isOrderForQuoteMint(o, quoteMint));

    for (const staleOrder of staleQuoteOrders) {
      await this.cancelOrder(staleOrder, sellResource, 'sell', cancelledIds);
    }

    await this.detectFills(sellResource, 'sell', myOrders, cancelledIds);

    let walletAvailableQuantity = Math.max(
      0,
      Math.floor(
        await this.getWalletBalanceForMint(sellResource.mint, sellResource.name, {
          tokenProgramId: localMarketContext ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
        }),
      ),
    );
    let cargoAvailableQuantity = Math.max(0, Math.floor((await this.getStarbaseCargoPodBalance(firstRule, resource)) ?? 0));

    this.logger.info(`${resource.name} wallet sell availability: ${walletAvailableQuantity}`);
    if (localMarketContext) {
      this.logger.info(`${resource.name} starbase cargo inventory: ${cargoAvailableQuantity}`);
    } else if (cargoAvailableQuantity > 0) {
      this.logger.warn(
        `${resource.name} starbase cargo inventory exists (${cargoAvailableQuantity}) but local-market sell context is unavailable. ` +
          'Skipping this cycle and retrying later.',
      );
      await this.appendLog({
        event: 'SKIP_LOCAL_MARKET_CONTEXT',
        side: 'sell',
        asset: firstRule.asset,
        resource: resource.name,
        mint: resource.mint.toBase58(),
        cargoBalance: cargoAvailableQuantity,
        inventorySource: 'starbase-cargo-pod',
        retryable: true,
        message:
          'Starbase cargo exists, but the bot could not resolve the certificate/local-market context needed to mint and sell it.',
      });
      return;
    }

    const desiredOrders: DesiredSellOrder[] = rules.map(({ index, rule }) => {
      const minSellQuantity = rule.quantity;
      const targetQuantity = Math.floor(rule.limit ?? rule.quantity);
      const relevantSellQuantity = getRelevantOrderThreshold(minSellQuantity, this.config.relevantSellOrderPct);
      const targetPrice =
        targetQuantity >= minSellQuantity
          ? this.getTargetSellPrice(allOrders, rule.price, relevantSellQuantity, rule.maxPrice)
          : rule.price;

      return {
        rule,
        ruleIndex: index,
        targetPrice,
        targetQuantity,
        minSellQuantity,
        refillEnabled: rule.refill !== false,
        quoteSymbol,
      };
    });

    const activeOrders = [...myOrders].sort((a, b) => {
      const priceCompare = a.uiPrice - b.uiPrice;
      if (Math.abs(priceCompare) >= ORDER_PRICE_EPSILON) {
        return priceCompare;
      }
      const quantityCompare = getOrderRemainingQuantity(a) - getOrderRemainingQuantity(b);
      if (quantityCompare !== 0) {
        return quantityCompare;
      }
      return a.id.localeCompare(b.id);
    });
    const matchedOrderIds = new Set<string>();
    const matches = new Map<number, Order>();

    const findBestMatch = (desired: DesiredSellOrder): Order | undefined => {
      const candidates = activeOrders.filter((order) => !matchedOrderIds.has(order.id));
      if (candidates.length === 0) {
        return undefined;
      }

      const exactMatch = candidates.find(
        (order) =>
          Math.abs(order.uiPrice - desired.targetPrice) < ORDER_PRICE_EPSILON &&
          getOrderRemainingQuantity(order) === desired.targetQuantity,
      );
      if (exactMatch) {
        return exactMatch;
      }

      return candidates.sort((a, b) => {
        const aPriceDelta = Math.abs(a.uiPrice - desired.targetPrice);
        const bPriceDelta = Math.abs(b.uiPrice - desired.targetPrice);
        if (Math.abs(aPriceDelta - bPriceDelta) >= ORDER_PRICE_EPSILON) {
          return aPriceDelta - bPriceDelta;
        }
        return (
          Math.abs(getOrderRemainingQuantity(a) - desired.targetQuantity) -
          Math.abs(getOrderRemainingQuantity(b) - desired.targetQuantity)
        );
      })[0];
    };

    for (const desired of desiredOrders) {
      if (desired.targetQuantity < desired.minSellQuantity) {
        continue;
      }
      const match = findBestMatch(desired);
      if (match) {
        matchedOrderIds.add(match.id);
        matches.set(desired.ruleIndex, match);
      }
    }

    this.logger.info(`Planning ${desiredOrders.length} sell order(s) for ${resource.name}.`);

    for (const order of activeOrders) {
      if (matchedOrderIds.has(order.id)) {
        continue;
      }

      const releasedQuantity = getOrderRemainingQuantity(order);
      this.logger.info(`Cancelling extra sell order ${order.id} for ${resource.name}.`);
      const cancelTx = await this.cancelOrder(order, sellResource, 'sell', cancelledIds);
      if (cancelTx) {
        walletAvailableQuantity += releasedQuantity;
      }
    }

    for (const desired of desiredOrders) {
      const activeOrder = matches.get(desired.ruleIndex);

      if (desired.targetQuantity < desired.minSellQuantity) {
        this.logger.info(
          `Sell rule ${desired.ruleIndex} for ${resource.name} is below minimum quantity ${desired.minSellQuantity}.`,
        );
        if (activeOrder) {
          const releasedQuantity = getOrderRemainingQuantity(activeOrder);
          const cancelTx = await this.cancelOrder(activeOrder, sellResource, 'sell', cancelledIds);
          if (cancelTx) {
            walletAvailableQuantity += releasedQuantity;
          }
        }
        continue;
      }

      this.logger.info(
        `Rule ${desired.ruleIndex}: sell ${desired.targetQuantity} ${resource.name} at min ${desired.rule.price} ${desired.quoteSymbol} (target ${desired.targetPrice}).`,
      );

      const activeQuantity = activeOrder ? getOrderRemainingQuantity(activeOrder) : 0;
      const priceDelta = activeOrder ? Math.abs(activeOrder.uiPrice - desired.targetPrice) : Number.POSITIVE_INFINITY;
      const quantityChanged = activeQuantity !== desired.targetQuantity;
      const nextQuantity =
        desired.refillEnabled || activeQuantity > desired.targetQuantity ? desired.targetQuantity : activeQuantity;

      if (activeOrder && !quantityChanged && priceDelta < ORDER_PRICE_EPSILON) {
        this.logger.info(
          `Sell order ${activeOrder.id} already matches rule ${desired.ruleIndex} at ${activeOrder.uiPrice} and quantity ${activeQuantity}.`,
        );
        continue;
      }

      if (!desired.refillEnabled && !activeOrder) {
        this.logger.info(
          `Refill disabled for sell rule ${desired.ruleIndex} and no active order exists. Skipping new sell order.`,
        );
        await this.appendLog({
          event: 'SKIP_REFILL_DISABLED',
          side: 'sell',
          ruleIndex: desired.ruleIndex,
          asset: desired.rule.asset,
          resource: sellResource.name,
          mint: sellResource.mint.toBase58(),
          balance: walletAvailableQuantity,
          cargoBalance: cargoAvailableQuantity,
          minSellQuantity: desired.minSellQuantity,
          quantity: desired.targetQuantity,
          inventorySource: localMarketContext ? 'starbase-cargo-pod' : 'wallet',
          message: 'Refill is disabled for this sell rule, so the bot will not create a new sell order.',
        });
        continue;
      }

      if (!desired.refillEnabled && activeOrder && activeQuantity < desired.targetQuantity && priceDelta < ORDER_PRICE_EPSILON) {
        this.logger.info(
          `Sell order ${activeOrder.id} already matches rule ${desired.ruleIndex} price and refill is disabled, ` +
            `so keeping existing quantity ${activeQuantity} instead of topping up to ${desired.targetQuantity}.`,
        );
        continue;
      }

      if (activeOrder) {
        this.logger.info(
          `Replacing sell order ${activeOrder.id} for rule ${desired.ruleIndex} with ` +
            `${nextQuantity} ${resource.name} @ ${desired.targetPrice}.`,
        );
        const cancelTx = await this.cancelOrder(activeOrder, sellResource, 'sell', cancelledIds);
        if (!cancelTx) {
          await this.appendLog({
            event: 'REPLACE_SKIP_UNCANCELLED_TOKEN_2022',
            side: 'sell',
            ruleIndex: desired.ruleIndex,
            asset: desired.rule.asset,
            resource: sellResource.name,
            mint: sellResource.mint.toBase58(),
            targetPrice: desired.targetPrice,
            nextQuantity,
            activeQuantity,
            walletAvailableQuantity,
            orderIds: [activeOrder.id],
            message: 'Skipped replacement because cancel did not release the existing order quantity.',
          });
          continue;
        }
        walletAvailableQuantity += activeQuantity;
      }

      const totalAvailableQuantity = walletAvailableQuantity + (localMarketContext ? cargoAvailableQuantity : 0);
      if (totalAvailableQuantity < nextQuantity) {
        this.logger.info(
          `Insufficient ${resource.name} inventory to place sell order for rule ${desired.ruleIndex}: ` +
            `${nextQuantity} needed, ${totalAvailableQuantity} available.`,
        );
        await this.appendLog({
          event: 'SKIP_NO_INVENTORY',
          side: 'sell',
          ruleIndex: desired.ruleIndex,
          asset: desired.rule.asset,
          resource: sellResource.name,
          mint: sellResource.mint.toBase58(),
          balance: walletAvailableQuantity,
          cargoBalance: cargoAvailableQuantity,
          minSellQuantity: desired.minSellQuantity,
          quantity: nextQuantity,
          inventorySource: localMarketContext ? 'starbase-cargo-pod' : 'wallet',
        });
        continue;
      }

      if (localMarketContext && walletAvailableQuantity < nextQuantity) {
        const certificateQuantity = nextQuantity - walletAvailableQuantity;
        this.logger.info(`Minting ${certificateQuantity} ${resource.name} local-market certificates before sell order.`);
        await this.mintLocalMarketCertificates(localMarketContext, certificateQuantity);
        walletAvailableQuantity += certificateQuantity;
        cargoAvailableQuantity = Math.max(0, cargoAvailableQuantity - certificateQuantity);
      }

      await this.placeOrder(sellResource, 'sell', desired.targetPrice, nextQuantity, cancelledIds, quoteMint, sellDepositTokenAccount);
      walletAvailableQuantity = Math.max(0, walletAvailableQuantity - nextQuantity);
    }

    const postPlacementBalance = await this.getWalletBalanceForMint(sellResource.mint, sellResource.name, {
      refresh: true,
      tokenProgramId: localMarketContext ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
    });
    await this.setLastWalletBalance(sellResource, 'sell', postPlacementBalance);
    this.logger.info(`Stored sell wallet baseline for ${resource.name}: ${postPlacementBalance}`);
  }

  private async processBuyRule(
    rule: AssetRuleConfig,
    index: number,
    resource: ResourceConfig,
    quoteMintOverride?: PublicKey,
    marketOrderSnapshot?: MarketOrderSnapshot,
  ) {
    this.logger.info(`[${new Date().toISOString()}] Checking ${resource.name} buy market...`);
    const cancelledIds = new Set<string>();
    const { allOrdersRaw, myOrdersRaw } = marketOrderSnapshot ?? (await this.readMarketOrderSnapshot(resource));

    const quoteMint = quoteMintOverride ?? getQuoteMintForResource(resource);
    const quoteSymbol = getQuoteSymbolForMint(quoteMint);
    const isShipMarket = quoteMint.equals(QUOTE_USDC_MINT);
    const allOrders = allOrdersRaw.filter((o) => o.orderType === OrderSide.Buy && isOrderForQuoteMint(o, quoteMint));
    const myOrders = myOrdersRaw.filter((o) => o.orderType === OrderSide.Buy && isOrderForQuoteMint(o, quoteMint));
    const staleQuoteOrders = myOrdersRaw.filter((o) => o.orderType === OrderSide.Buy && !isOrderForQuoteMint(o, quoteMint));

    for (const staleOrder of staleQuoteOrders) {
      await this.cancelOrder(staleOrder, resource, 'buy', cancelledIds);
    }

    await this.detectFills(resource, 'buy', myOrders, cancelledIds);

    const maxBuyQuantity = rule.quantity;
    const minBuyQuantity = rule.minQuantity;
    const maxBuyPrice = rule.price;
    const inventoryBalance = await this.getWalletBalanceForMint(resource.mint, resource.name);
    const remainingBuyAllowance = Math.max(0, Math.floor((rule.limit ?? Number.POSITIVE_INFINITY) - inventoryBalance));
    const possibleTargetQuantity = Math.min(maxBuyQuantity, remainingBuyAllowance);
    const targetQuantity = possibleTargetQuantity >= minBuyQuantity ? possibleTargetQuantity : 0;
    const relevantBuyQuantity = getRelevantOrderThreshold(Math.max(1, targetQuantity), this.config.relevantBuyOrderPct);
    const targetPrice =
      targetQuantity > 0
        ? this.getTargetBuyPrice(
            allOrders,
            maxBuyPrice,
            relevantBuyQuantity,
            { ...(isShipMarket ? { outbidPct: SHIP_BUY_OUTBID_PCT } : {}), minPrice: rule.minPrice },
          )
        : maxBuyPrice;

    const sortedMyOrders = [...myOrders].sort((a, b) => b.uiPrice - a.uiPrice);
    const activeOrder = sortedMyOrders[0];
    for (let i = 1; i < sortedMyOrders.length; i++) {
      await this.cancelOrder(sortedMyOrders[i], resource, 'buy', cancelledIds);
    }

    const quoteBalance = await this.getWalletBalanceForMint(quoteMint, quoteSymbol);
    this.logger.info(`${quoteSymbol} balance: ${quoteBalance}`);
    this.logger.info(`${resource.name} inventory balance: ${inventoryBalance}`);
    this.logger.info(
      `Planning to buy up to ${targetQuantity} ${resource.name} at max ${maxBuyPrice} ${quoteSymbol} (target ${targetPrice}).`,
    );

    if (!activeOrder) {
      if (targetQuantity <= 0) {
        this.logger.info(
          `Buy limit reached for ${resource.name}. Inventory ${inventoryBalance} is at or above limit ${rule.limit}. Skipping.`,
        );
        return;
      }

      const requiredQuote = targetQuantity * targetPrice;
      if (quoteBalance < requiredQuote) {
        this.logger.info(
          `Insufficient ${quoteSymbol} to place buy order for ${targetQuantity} ${resource.name} @ ${targetPrice}. Skipping.`,
        );
        await this.appendLog({
          event: 'SKIP_NO_FUNDS',
          side: 'buy',
          ruleIndex: index,
          asset: rule.asset,
          resource: resource.name,
          mint: resource.mint.toBase58(),
          quoteCurrency: quoteSymbol,
          quoteBalance,
          requiredQuote,
          quantity: targetQuantity,
          price: targetPrice,
        });
        return;
      }

      await this.placeOrder(resource, 'buy', targetPrice, targetQuantity, cancelledIds, quoteMint);
      return;
    }

    const activeQuantity = getOrderRemainingQuantity(activeOrder);
    const priceDelta = Math.abs(activeOrder.uiPrice - targetPrice);
    const quantityChanged = activeQuantity !== targetQuantity;

    if (targetQuantity <= 0) {
      this.logger.info(
        `Buy limit reached for ${resource.name}. Cancelling active buy order ${activeOrder.id} with remaining quantity ${activeQuantity}.`,
      );
      await this.cancelOrder(activeOrder, resource, 'buy', cancelledIds);
      return;
    }

    if (!quantityChanged && priceDelta < ORDER_PRICE_EPSILON) {
      this.logger.info(
        `Buy order ${activeOrder.id} already at target price (${activeOrder.uiPrice}) and quantity (${activeQuantity}). Nothing to do.`,
      );
      return;
    }

    const releasableQuoteFromActiveOrder = activeOrder.uiPrice * activeQuantity;
    const quoteAvailableAfterCancel = quoteBalance + releasableQuoteFromActiveOrder;
    const requiredQuote = targetQuantity * targetPrice;

    if (quoteAvailableAfterCancel < requiredQuote) {
      this.logger.info(
        `Insufficient ${quoteSymbol} to replace buy order for ${targetQuantity} ${resource.name} @ ${targetPrice}. Skipping.`,
      );
      await this.appendLog({
        event: 'SKIP_NO_FUNDS',
        side: 'buy',
        ruleIndex: index,
        asset: rule.asset,
        resource: resource.name,
        mint: resource.mint.toBase58(),
        quoteCurrency: quoteSymbol,
        quoteBalance,
        releasableQuoteFromActiveOrder,
        quoteAvailableAfterCancel,
        requiredQuote,
        quantity: targetQuantity,
        price: targetPrice,
      });
      return;
    }

    if (quantityChanged) {
      this.logger.info(
        `Buy target quantity changed for ${resource.name}. Replacing order from ${activeQuantity} to ${targetQuantity} at ${targetPrice}.`,
      );
    } else {
      this.logger.info(
        `Buy price moved for ${resource.name}. Replacing order at ${targetPrice} while keeping quantity ${activeQuantity}.`,
      );
    }

    await this.cancelOrder(activeOrder, resource, 'buy', cancelledIds);
    await this.placeOrder(resource, 'buy', targetPrice, targetQuantity, new Set<string>(), quoteMint);
  }

  private async processBuyRules(
    rules: Array<{ index: number; rule: AssetRuleConfig }>,
    resource: ResourceConfig,
    quoteMintOverride?: PublicKey,
    marketOrderSnapshot?: MarketOrderSnapshot,
  ) {
    this.logger.info(`[${new Date().toISOString()}] Checking ${resource.name} buy market for ${rules.length} rules...`);
    const cancelledIds = new Set<string>();
    const { allOrdersRaw, myOrdersRaw } = marketOrderSnapshot ?? (await this.readMarketOrderSnapshot(resource));

    const quoteMint = quoteMintOverride ?? getQuoteMintForResource(resource);
    const quoteSymbol = getQuoteSymbolForMint(quoteMint);
    const isShipMarket = quoteMint.equals(QUOTE_USDC_MINT);
    const allOrders = allOrdersRaw.filter((o) => o.orderType === OrderSide.Buy && isOrderForQuoteMint(o, quoteMint));
    const myOrders = myOrdersRaw.filter((o) => o.orderType === OrderSide.Buy && isOrderForQuoteMint(o, quoteMint));
    const staleQuoteOrders = myOrdersRaw.filter((o) => o.orderType === OrderSide.Buy && !isOrderForQuoteMint(o, quoteMint));

    for (const staleOrder of staleQuoteOrders) {
      await this.cancelOrder(staleOrder, resource, 'buy', cancelledIds);
    }

    await this.detectFills(resource, 'buy', myOrders, cancelledIds);

    const inventoryBalance = await this.getWalletBalanceForMint(resource.mint, resource.name);
    const desiredOrders: DesiredBuyOrder[] = [];

    for (const { index, rule } of rules) {
      const maxBuyQuantity = rule.quantity;
      const minBuyQuantity = rule.minQuantity;
      const maxBuyPrice = rule.price;
      const remainingBuyAllowance = Math.max(0, Math.floor((rule.limit ?? Number.POSITIVE_INFINITY) - inventoryBalance));
      const possibleTargetQuantity = Math.min(maxBuyQuantity, remainingBuyAllowance);
      const targetQuantity = possibleTargetQuantity >= minBuyQuantity ? possibleTargetQuantity : 0;
      const relevantBuyQuantity = getRelevantOrderThreshold(Math.max(1, targetQuantity), this.config.relevantBuyOrderPct);
      const targetPrice =
        targetQuantity > 0
          ? this.getTargetBuyPrice(
              allOrders,
              maxBuyPrice,
              relevantBuyQuantity,
              { ...(isShipMarket ? { outbidPct: SHIP_BUY_OUTBID_PCT } : {}), minPrice: rule.minPrice },
            )
          : maxBuyPrice;

      desiredOrders.push({
        rule,
        ruleIndex: index,
        targetPrice,
        targetQuantity,
        maxBuyPrice,
        quoteSymbol,
      });
    }

    const activeOrders = [...myOrders].sort((a, b) => {
      const priceCompare = b.uiPrice - a.uiPrice;
      if (Math.abs(priceCompare) >= ORDER_PRICE_EPSILON) {
        return priceCompare;
      }
      return a.id.localeCompare(b.id);
    });
    const matchedOrderIds = new Set<string>();
    const matches = new Map<number, Order>();

    const findBestMatch = (desired: DesiredBuyOrder): Order | undefined => {
      const candidates = activeOrders.filter((order) => !matchedOrderIds.has(order.id));
      if (candidates.length === 0) {
        return undefined;
      }

      const exactMatch = candidates.find(
        (order) =>
          Math.abs(order.uiPrice - desired.targetPrice) < ORDER_PRICE_EPSILON &&
          getOrderRemainingQuantity(order) === desired.targetQuantity,
      );
      if (exactMatch) {
        return exactMatch;
      }

      return candidates.sort((a, b) => {
        const aPriceDelta = Math.abs(a.uiPrice - desired.targetPrice);
        const bPriceDelta = Math.abs(b.uiPrice - desired.targetPrice);
        if (Math.abs(aPriceDelta - bPriceDelta) >= ORDER_PRICE_EPSILON) {
          return aPriceDelta - bPriceDelta;
        }
        return Math.abs(getOrderRemainingQuantity(a) - desired.targetQuantity) -
          Math.abs(getOrderRemainingQuantity(b) - desired.targetQuantity);
      })[0];
    };

    for (const desired of desiredOrders) {
      if (desired.targetQuantity <= 0) {
        continue;
      }
      const match = findBestMatch(desired);
      if (match) {
        matchedOrderIds.add(match.id);
        matches.set(desired.ruleIndex, match);
      }
    }

    let quoteBalance = await this.getWalletBalanceForMint(quoteMint, quoteSymbol);
    this.logger.info(`${quoteSymbol} balance: ${quoteBalance}`);
    this.logger.info(`${resource.name} inventory balance: ${inventoryBalance}`);
    this.logger.info(`Planning ${desiredOrders.length} buy order(s) for ${resource.name}.`);

    for (const order of activeOrders) {
      if (matchedOrderIds.has(order.id)) {
        continue;
      }

      this.logger.info(`Cancelling extra buy order ${order.id} for ${resource.name}.`);
      await this.cancelOrder(order, resource, 'buy', cancelledIds);
      quoteBalance += order.uiPrice * getOrderRemainingQuantity(order);
    }

    for (const desired of desiredOrders) {
      const activeOrder = matches.get(desired.ruleIndex);

      if (desired.targetQuantity <= 0) {
        this.logger.info(
          `Buy limit reached for ${resource.name} rule ${desired.ruleIndex}. Inventory ${inventoryBalance} is at or above limit ${desired.rule.limit}.`,
        );
        if (activeOrder) {
          await this.cancelOrder(activeOrder, resource, 'buy', cancelledIds);
          quoteBalance += activeOrder.uiPrice * getOrderRemainingQuantity(activeOrder);
        }
        continue;
      }

      this.logger.info(
        `Rule ${desired.ruleIndex}: buy up to ${desired.targetQuantity} ${resource.name} at max ${desired.maxBuyPrice} ${quoteSymbol} (target ${desired.targetPrice}).`,
      );

      const activeQuantity = activeOrder ? getOrderRemainingQuantity(activeOrder) : 0;
      const priceDelta = activeOrder ? Math.abs(activeOrder.uiPrice - desired.targetPrice) : Number.POSITIVE_INFINITY;
      const quantityChanged = activeQuantity !== desired.targetQuantity;

      if (activeOrder && !quantityChanged && priceDelta < ORDER_PRICE_EPSILON) {
        this.logger.info(
          `Buy order ${activeOrder.id} already matches rule ${desired.ruleIndex} at ${activeOrder.uiPrice} and quantity ${activeQuantity}.`,
        );
        continue;
      }

      const releasableQuoteFromActiveOrder = activeOrder ? activeOrder.uiPrice * activeQuantity : 0;
      const requiredQuote = desired.targetQuantity * desired.targetPrice;
      const quoteAvailableAfterCancel = quoteBalance + releasableQuoteFromActiveOrder;

      if (quoteAvailableAfterCancel < requiredQuote) {
        this.logger.info(
          `Insufficient ${quoteSymbol} to place buy order for rule ${desired.ruleIndex}: ` +
            `${desired.targetQuantity} ${resource.name} @ ${desired.targetPrice}. Skipping.`,
        );
        await this.appendLog({
          event: 'SKIP_NO_FUNDS',
          side: 'buy',
          ruleIndex: desired.ruleIndex,
          asset: desired.rule.asset,
          resource: resource.name,
          mint: resource.mint.toBase58(),
          quoteCurrency: quoteSymbol,
          quoteBalance,
          releasableQuoteFromActiveOrder,
          quoteAvailableAfterCancel,
          requiredQuote,
          quantity: desired.targetQuantity,
          price: desired.targetPrice,
        });
        continue;
      }

      if (activeOrder) {
        this.logger.info(
          `Replacing buy order ${activeOrder.id} for rule ${desired.ruleIndex} with ` +
            `${desired.targetQuantity} ${resource.name} @ ${desired.targetPrice}.`,
        );
        await this.cancelOrder(activeOrder, resource, 'buy', cancelledIds);
        quoteBalance += releasableQuoteFromActiveOrder;
      }

      await this.placeOrder(resource, 'buy', desired.targetPrice, desired.targetQuantity, cancelledIds, quoteMint);
      quoteBalance -= requiredQuote;
    }
  }

  private async processLegacyResource(resource: ResourceConfig) {
    await this.processSellRule(resource, this.config.minSellQuantity, this.config.minPrice);
  }

  private async processAssetRuleGroup(group: GroupedAssetRules) {
    const asset = group.asset;
    const rules = group.rules;

    let resource: ResourceConfig;
    try {
      resource = resolveResourceForRule(rules[0].rule);
    } catch (err) {
      this.logger.error(`Cycle failed for asset ${asset}:`, err);
      await this.appendLog({
        event: 'ERROR',
        asset,
        message: (err as Error).message,
      });
      return;
    }

    const sellRules = rules.filter((item) => item.rule.side === 'sell');
    const buyRules = rules.filter((item) => item.rule.side === 'buy');
    const quoteMint = group.group === 'ships' || group.group === 'ship-parts' ? QUOTE_USDC_MINT : getQuoteMintForResource(resource);
    const hasRunnableBuyRule = buyRules.length > 0;
    const marketOrderSnapshot = hasRunnableBuyRule ? await this.readMarketOrderSnapshot(resource) : undefined;

    if (sellRules.length > 1) {
      await this.processSellRules(sellRules, resource, quoteMint);
    } else if (sellRules.length === 1) {
      const sellRule = sellRules[0];
      await this.processSellRule(
        resource,
        sellRule.rule.quantity,
        sellRule.rule.price,
        quoteMint,
        marketOrderSnapshot,
        sellRule.rule.limit,
        sellRule.rule,
      );
    }

    if (buyRules.length > 1) {
      await this.processBuyRules(buyRules, resource, quoteMint, marketOrderSnapshot);
    } else if (buyRules.length === 1) {
      const buyRule = buyRules[0];
      await this.processBuyRule(buyRule.rule, buyRule.index, resource, quoteMint, marketOrderSnapshot);
    }
  }

  private async runCycle() {
    this.passiveOpenOrdersCache.clear();

    if (this.config.assetRules.length > 0) {
      const groupedRules = groupRulesByAsset(this.config.assetRules);

      for (const group of groupedRules.values()) {
        try {
          await this.processAssetRuleGroup(group);
        } catch (err) {
          let mint: string | undefined;
          let resourceName: string | undefined;

          try {
            const parsed = resolveResourceForRule(group.rules[0].rule);
            mint = parsed.mint.toBase58();
            resourceName = parsed.name;
          } catch {
            mint = undefined;
            resourceName = undefined;
          }

          this.logger.error(`Cycle failed for asset ${group.asset}:`, err);
          await this.appendLog({
            event: 'ERROR',
            asset: group.asset,
            resource: resourceName,
            mint,
            ruleIndexes: group.rules.map((item) => item.index),
            message: (err as Error).message,
          });
          continue;
        }
      }
      return;
    }

    for (const resource of this.legacyResources) {
      try {
        await this.processLegacyResource(resource);
      } catch (err) {
        this.logger.error(`Cycle failed for ${resource.name}:`, err);
        await this.appendLog({
          event: 'ERROR',
          resource: resource.name,
          mint: resource.mint.toBase58(),
          message: (err as Error).message,
        });
      }
    }
  }

  private getNextCycleDelayMs(stats: CycleStats): number {
    const baseDelayMs = this.checkIntervalMs;
    const hasUrgentFollowUp = stats.changes > 0 || stats.errors > 0 || stats.retryableSkips > 0;
    if (hasUrgentFollowUp) {
      return Math.min(baseDelayMs, FAST_CYCLE_INTERVAL_MS);
    }

    const cleanNoChange = stats.loggedEvents === 0 && stats.changes === 0 && stats.skips === 0 && stats.errors === 0;
    if (cleanNoChange) {
      this.consecutiveNoChangeCycles += 1;
      return this.consecutiveNoChangeCycles >= 1 ? Math.max(baseDelayMs, SLOW_CYCLE_INTERVAL_MS) : baseDelayMs;
    }

    this.consecutiveNoChangeCycles = 0;
    return baseDelayMs;
  }

  private async appendCycleCompletionLog(stats: CycleStats, nextDelayMs: number, durationMs: number) {
    const cleanNoChange = stats.loggedEvents === 0 && stats.changes === 0 && stats.skips === 0 && stats.errors === 0;
    const nextDelayMinutes = Math.max(1, Math.round(nextDelayMs / 60_000));

    await this.appendLog({
      event: cleanNoChange ? 'NO_CHANGES' : 'CYCLE_OK',
      rulesChecked: stats.rulesChecked,
      changes: stats.changes,
      skips: stats.skips,
      errors: stats.errors,
      retryableSkips: stats.retryableSkips,
      durationMs,
      nextDelayMinutes,
      message: cleanNoChange
        ? `No order changes. Next check in ${nextDelayMinutes}m.`
        : `Cycle completed. Next check in ${nextDelayMinutes}m.`,
    });
  }

  private async buildOpenOrdersSnapshot(): Promise<BotOpenOrderStatus[]> {
    const result: BotOpenOrderStatus[] = [];
    const now = new Date().toISOString();
    const targets = await this.buildOpenOrderStatusTargets();

    for (const target of targets) {
      const resource = target.resource;
      const mintKey = resource.mint.toBase58();

      try {
        let openOrders: BotOpenOrderStatus[] | null = null;

        if (target.passiveCache) {
          const cached = this.passiveOpenOrdersCache.get(this.getOpenOrderTargetCacheKey(target));
          if (cached) {
            openOrders = cached.map((order) => ({ ...order }));
          }
        }

        if (!openOrders) {
          const myOrdersRaw = await this.readMyOpenOrdersForResource(resource);

          openOrders = [];
          for (const order of myOrdersRaw) {
            const side = order.orderType === OrderSide.Buy ? 'buy' : order.orderType === OrderSide.Sell ? 'sell' : null;
            if (!side) {
              continue;
            }
            if (target.sideFilter && side !== target.sideFilter) {
              continue;
            }

            const quantity = getOrderTrackedQuantity(order);
            const remaining = getOrderRemainingQuantity(order);
            openOrders.push({
              id: order.id,
              starbase: target.starbase,
              asset: getResourceLabel(target.displayResource),
              mint: mintKey,
              side,
              price: order.uiPrice,
              quantity,
              remaining,
              partiallyFilled: quantity !== null ? remaining < quantity : false,
              updatedAt: now,
              currency: order.currencyMint === QUOTE_USDC_MINT.toBase58() ? 'USDC' : 'ATLAS',
            });
          }

          if (target.passiveCache) {
            this.passiveOpenOrdersCache.set(this.getOpenOrderTargetCacheKey(target), openOrders.map((order) => ({ ...order })));
          }
        }

        result.push(...openOrders);
      } catch (err) {
        this.logger.warn(`Failed to fetch open orders for ${resource.name}:`, err);
      }
    }

    const assetOrder = new Map<string, number>();
    for (let i = 0; i < this.config.assetRules.length; i++) {
      const asset = this.config.assetRules[i].asset;
      if (!assetOrder.has(asset)) {
        assetOrder.set(asset, i);
      }
    }

    const sorted = result.sort((a, b) => {
      const aOrder = assetOrder.get(a.asset) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = assetOrder.get(b.asset) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }

      if (a.side !== b.side) {
        return a.side === 'buy' ? -1 : 1;
      }

      return a.id.localeCompare(b.id);
    });

    return await this.annotateMarketLeaders(sorted);
  }

  private getOpenOrderTargetCacheKey(target: OpenOrderStatusTarget): string {
    return `${target.starbase}:${target.resource.mint.toBase58()}:${target.sideFilter ?? 'all'}:${target.ruleIndex ?? 'resource'}`;
  }

  private async buildOpenOrderStatusTargets(): Promise<OpenOrderStatusTarget[]> {
    if (this.config.assetRules.length === 0) {
      return this.statusResources.map((resource) => ({
        resource,
        displayResource: resource,
        starbase: '',
        passiveCache: false,
      }));
    }

    const targets: OpenOrderStatusTarget[] = [];
    const seen = new Set<string>();

    for (let index = 0; index < this.config.assetRules.length; index++) {
      const rule = this.config.assetRules[index];
      const rawResource = resolveResourceForRule(rule);
      let queryResource = rawResource;

      if (rule.side === 'sell') {
        const context = await this.resolveLocalMarketSellContext(rule, rawResource);
        queryResource = context?.certificateResource ?? rawResource;
      }

      const key = `${normalizeStarbaseName(rule.starbase)}:${queryResource.mint.toBase58()}:${rule.side}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      targets.push({
        resource: queryResource,
        displayResource: rawResource,
        starbase: normalizeStarbaseName(rule.starbase),
        sideFilter: rule.side,
        ruleIndex: index,
        passiveCache: false,
      });
    }

    return targets;
  }

  private async getRelevantBadgeThresholds(): Promise<Map<string, { buy: number; sell: number }>> {
    const thresholds = new Map<string, { buy: number; sell: number }>();

    if (this.config.assetRules.length > 0) {
      const groupedRules = groupRulesByAsset(this.config.assetRules);
      for (const group of groupedRules.values()) {
        try {
          const resource = resolveResourceForRule(group.rules[0].rule);

          const buyRule = group.rules.find((item) => item.rule.side === 'buy')?.rule;
          if (buyRule) {
            const mintKey = resource.mint.toBase58();
            const current = thresholds.get(mintKey) ?? { buy: 1, sell: 1 };
            current.buy = getRelevantOrderThreshold(buyRule.quantity, this.config.relevantBuyOrderPct);
            thresholds.set(mintKey, current);
          }

          const sellRules = group.rules.filter((item) => item.rule.side === 'sell');
          for (const { rule: sellRule } of sellRules) {
            const sellContext = await this.resolveLocalMarketSellContext(sellRule, resource);
            const mintKey = (sellContext?.certificateResource ?? resource).mint.toBase58();
            const current = thresholds.get(mintKey) ?? { buy: 1, sell: 1 };
            const sellThreshold = getRelevantOrderThreshold(sellRule.quantity, this.config.relevantSellOrderPct);
            current.sell = current.sell === 1 ? sellThreshold : Math.min(current.sell, sellThreshold);
            thresholds.set(mintKey, current);
          }
        } catch {
          continue;
        }
      }

      return thresholds;
    }

    for (const resource of this.legacyResources) {
      thresholds.set(resource.mint.toBase58(), {
        buy: 1,
        sell: getRelevantOrderThreshold(this.config.minSellQuantity, this.config.relevantSellOrderPct),
      });
    }

    return thresholds;
  }

  private async getCachedRelevantBadgeThresholds(): Promise<Map<string, { buy: number; sell: number }>> {
    if (this.marketLeaderThresholdsCache && Date.now() < this.marketLeaderThresholdsCache.expiresAt) {
      return this.marketLeaderThresholdsCache.promise;
    }

    const promise = this.getRelevantBadgeThresholds().catch((error) => {
      this.marketLeaderThresholdsCache = null;
      throw error;
    });
    this.marketLeaderThresholdsCache = {
      expiresAt: Date.now() + MARKET_LEADER_CACHE_TTL_MS,
      promise,
    };

    return promise;
  }

  private async cacheMarketLeadersFromOrders(mint: PublicKey, marketOrders: Order[]): Promise<void> {
    const mintKey = mint.toBase58();
    const thresholds = await this.getCachedRelevantBadgeThresholds();
    const threshold = thresholds.get(mintKey) ?? { buy: 1, sell: 1 };

    for (const quoteMint of [QUOTE_ATLAS_MINT, QUOTE_USDC_MINT]) {
      const buyOrders = marketOrders.filter(
        (order) =>
          order.orderType === OrderSide.Buy &&
          isOrderForQuoteMint(order, quoteMint) &&
          getOrderBookQuantity(order) >= threshold.buy,
      );
      const sellOrders = marketOrders.filter(
        (order) =>
          order.orderType === OrderSide.Sell &&
          isOrderForQuoteMint(order, quoteMint) &&
          getOrderBookQuantity(order) >= threshold.sell,
      );

      this.marketLeaderCache.set(getMarketLeaderCacheKey(mintKey, quoteMint), {
        expiresAt: Date.now() + Math.max(MARKET_LEADER_CACHE_TTL_MS, this.checkIntervalMs + STATUS_SNAPSHOT_CACHE_CEIL_MS),
        bestBuyPrice: buyOrders.length ? Math.max(...buyOrders.map((order) => order.uiPrice)) : null,
        bestSellPrice: sellOrders.length ? Math.min(...sellOrders.map((order) => order.uiPrice)) : null,
      });
    }
  }

  private async annotateMarketLeaders(orders: BotOpenOrderStatus[]): Promise<BotOpenOrderStatus[]> {
    if (orders.length === 0) {
      return orders;
    }

    const byMarket = new Map<string, BotOpenOrderStatus[]>();
    for (const order of orders) {
      const quoteMint = order.currency === 'USDC' ? QUOTE_USDC_MINT : QUOTE_ATLAS_MINT;
      const key = getMarketLeaderCacheKey(order.mint, quoteMint);
      const bucket = byMarket.get(key) ?? [];
      bucket.push(order);
      byMarket.set(key, bucket);
    }

    for (const [marketKey, mintOrders] of byMarket.entries()) {
      const cached = this.marketLeaderCache.get(marketKey);
      if (!cached || Date.now() >= cached.expiresAt) {
        const visibleBuyPrices = mintOrders.filter((order) => order.side === 'buy').map((order) => order.price);
        const visibleSellPrices = mintOrders.filter((order) => order.side === 'sell').map((order) => order.price);
        const visibleBestBuyPrice = visibleBuyPrices.length ? Math.max(...visibleBuyPrices) : null;
        const visibleBestSellPrice = visibleSellPrices.length ? Math.min(...visibleSellPrices) : null;

        for (const order of mintOrders) {
          if (
            order.side === 'buy' &&
            visibleBestBuyPrice !== null &&
            Math.abs(order.price - visibleBestBuyPrice) < ORDER_PRICE_EPSILON
          ) {
            order.marketLeader = 'hb';
          }

          if (
            order.side === 'sell' &&
            visibleBestSellPrice !== null &&
            Math.abs(order.price - visibleBestSellPrice) < ORDER_PRICE_EPSILON
          ) {
            order.marketLeader = 'ba';
          }
        }
        continue;
      }

      for (const order of mintOrders) {
        if (order.side === 'buy' && cached.bestBuyPrice !== null && Math.abs(order.price - cached.bestBuyPrice) < ORDER_PRICE_EPSILON) {
          order.marketLeader = 'hb';
        }

        if (order.side === 'sell' && cached.bestSellPrice !== null && Math.abs(order.price - cached.bestSellPrice) < ORDER_PRICE_EPSILON) {
          order.marketLeader = 'ba';
        }
      }
    }

    return orders;
  }

  async redeemCertificateForRule(
    asset: string,
    starbase?: string,
  ): Promise<{ ok: boolean; status: string; asset: string; starbase?: string; quantity?: number; tx?: string; message?: string }> {
    const normalizedAsset = String(asset || '').trim();
    const normalizedStarbase = String(starbase || '').trim();
    if (!normalizedAsset) {
      return { ok: false, status: 'invalid_request', asset: normalizedAsset, starbase: normalizedStarbase };
    }

    const rule = this.config.assetRules.find((candidate) => {
      if (candidate.side !== 'sell' || candidate.asset !== normalizedAsset) {
        return false;
      }
      return !normalizedStarbase || candidate.starbase === normalizedStarbase;
    });

    if (!rule) {
      return { ok: false, status: 'rule_not_found', asset: normalizedAsset, starbase: normalizedStarbase };
    }

    const rawResource = resolveResourceForRule(rule);
    const context = await this.resolveLocalMarketSellContext(rule, rawResource);
    if (!context) {
      return { ok: false, status: 'local_market_context_unavailable', asset: normalizedAsset, starbase: rule.starbase };
    }

    const quantity = Math.floor(
      await this.getWalletBalanceForMint(context.certificateMint, rawResource.name, {
        refresh: true,
        tokenProgramId: TOKEN_2022_PROGRAM_ID,
      }),
    );
    if (quantity <= 0) {
      return { ok: false, status: 'no_certificates', asset: normalizedAsset, starbase: rule.starbase, quantity: 0 };
    }

    this.logger.info(`Redeeming ${quantity} ${rawResource.name} local-market certificate(s) back to ${rule.starbase} cargo.`);
    const transaction = new Transaction();
    const redeemCertificate = await StarbasePlayer.redeemCertificate(
      this.sageProgram,
      this.cargoProgram,
      context.starbasePlayer,
      keypairToAsyncSigner(this.wallet),
      new PublicKey(this.config.ownerProfile),
      context.profileFaction,
      'funder',
      context.starbase,
      context.cargoPod,
      context.cargoType,
      CARGO_STATS_DEFINITION,
      context.certificateTokenAccount,
      keypairToAsyncSigner(this.wallet),
      context.certificateMint,
      context.starbaseCargoTokenAccount,
      context.cargoTokenAccount,
      context.rawResource.mint,
      context.gameId,
      context.gameState,
      {
        amount: new BN(quantity),
        keyIndex: context.profileKeyIndex,
      },
    )(keypairToAsyncSigner(this.wallet));

    for (const item of Array.isArray(redeemCertificate) ? redeemCertificate : [redeemCertificate]) {
      transaction.add(item.instruction);
    }

    const tx = await this.signAndSend(transaction);
    this.walletBalanceCache.delete(`${context.certificateMint.toBase58()}:${TOKEN_2022_PROGRAM_ID.toBase58()}`);
    this.cargoPodTokenInventoryCache.delete(context.cargoPod.toBase58());
    this.invalidateStatusSnapshotCache();

    await this.appendLog({
      event: 'REDEEM_CERTIFICATES',
      side: 'sell',
      resource: context.rawResource.name,
      mint: context.rawResource.mint.toBase58(),
      certificateMint: context.certificateMint.toBase58(),
      quantity,
      tx,
    });

    return { ok: true, status: 'redeemed', asset: normalizedAsset, starbase: rule.starbase, quantity, tx };
  }

  private async readRecentActivity(sinceTimestamp?: string | null): Promise<BotRecentActivity[]> {
    try {
      const raw = await fs.readFile(this.logFilePath, 'utf8');
      const lines = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      const sinceMs = sinceTimestamp ? new Date(sinceTimestamp).getTime() : Number.NaN;
      const result: BotRecentActivity[] = [];

      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(lines[i]) as Record<string, unknown>;
          const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toISOString();
          const timestampMs = new Date(timestamp).getTime();

          if (Number.isFinite(sinceMs) && Number.isFinite(timestampMs) && timestampMs < sinceMs) {
            continue;
          }

          result.push({
            timestamp,
            event: typeof parsed.event === 'string' ? parsed.event : 'LOG',
            side: parsed.side === 'buy' || parsed.side === 'sell' ? parsed.side : undefined,
            asset: typeof parsed.asset === 'string' ? parsed.asset : undefined,
            resource: typeof parsed.resource === 'string' ? parsed.resource : undefined,
            message: typeof parsed.message === 'string' ? parsed.message : undefined,
            price: typeof parsed.price === 'number' ? parsed.price : undefined,
            quantity: typeof parsed.quantity === 'number' ? parsed.quantity : undefined,
            remaining: typeof parsed.remaining === 'number' ? parsed.remaining : undefined,
            tx: typeof parsed.tx === 'string' ? parsed.tx : undefined,
          });
        } catch {
          continue;
        }
      }

      return result;
    } catch {
      return [];
    }
  }

  private buildRuleHealthSnapshot(openOrders: BotOpenOrderStatus[]): BotRuleHealthStatus[] {

    const findActiveOrder = (asset: string, side: AssetRuleSide): BotOpenOrderStatus | undefined =>
      openOrders.find((order) => normalizeAssetKey(order.asset) === normalizeAssetKey(asset) && order.side === side);
    const consumeBestOrder = (
      candidates: BotOpenOrderStatus[],
      rule: AssetRuleConfig,
    ): BotOpenOrderStatus | undefined => {
      if (candidates.length === 0) {
        return undefined;
      }

      let bestIndex = 0;
      let bestScore = Number.POSITIVE_INFINITY;

      candidates.forEach((order, index) => {
        const score =
          Math.abs((order.price ?? 0) - rule.price) +
          Math.abs((order.remaining ?? 0) - rule.quantity) / Math.max(1, rule.quantity);
        if (score < bestScore) {
          bestIndex = index;
          bestScore = score;
        }
      });

      return candidates.splice(bestIndex, 1)[0];
    };

    if (this.config.assetRules.length > 0) {
      const grouped = groupRulesByAsset(this.config.assetRules);
      const result: BotRuleHealthStatus[] = [];

      for (const group of grouped.values()) {
        const buyRules = group.rules.filter((item) => item.rule.side === 'buy');
        const sellRules = group.rules.filter((item) => item.rule.side === 'sell');

        if (buyRules.length > 0) {
          const availableBuyOrders = openOrders
            .filter((order) => normalizeAssetKey(order.asset) === normalizeAssetKey(group.asset) && order.side === 'buy')
            .sort((a, b) => b.price - a.price);

          for (const item of buyRules) {
            const rule = item.rule;
            const openOrder = consumeBestOrder(availableBuyOrders, rule);
            const note =
              buyRules.length > 1
                ? openOrder
                  ? `Buy rule ${item.index} currently tracked`
                  : `No active buy order tracked for rule ${item.index}`
                : openOrder
                  ? 'Buy order currently tracked'
                  : 'No active buy order tracked';

            result.push({
              asset: group.asset,
              side: 'buy',
              configuredQuantity: rule.quantity,
              configuredPrice: rule.price,
              status: openOrder ? 'active' : 'idle',
              openOrderId: openOrder?.id,
              openOrderPrice: openOrder?.price,
              openOrderRemaining: openOrder?.remaining,
              partiallyFilled: openOrder?.partiallyFilled,
              note,
            });
          }
        }

        if (sellRules.length > 0) {
          const availableSellOrders = openOrders
            .filter((order) => normalizeAssetKey(order.asset) === normalizeAssetKey(group.asset) && order.side === 'sell')
            .sort((a, b) => a.price - b.price);

          for (const item of sellRules) {
            const rule = item.rule;
            const openOrder =
              sellRules.length > 1
                ? consumeBestOrder(availableSellOrders, rule)
                : findActiveOrder(group.asset, 'sell');
            const note =
              sellRules.length > 1
                ? openOrder
                  ? `Sell rule ${item.index} currently tracked`
                  : `No active sell order tracked for rule ${item.index}`
                : openOrder
                  ? 'Sell order currently tracked'
                  : 'No active sell order tracked';

            result.push({
              asset: group.asset,
              side: 'sell',
              configuredQuantity: rule.quantity,
              configuredPrice: rule.price,
              status: openOrder ? 'active' : 'idle',
              openOrderId: openOrder?.id,
              openOrderPrice: openOrder?.price,
              openOrderRemaining: openOrder?.remaining,
              partiallyFilled: openOrder?.partiallyFilled,
              note,
            });
          }
        }
      }

      return result;
    }

    return this.trackedResources.map((resource) => {
      const asset = getResourceLabel(resource);
      const openOrder = openOrders.find((order) => order.mint === resource.mint.toBase58() && order.side === 'sell');

      return {
        asset,
        side: 'sell' as AssetRuleSide,
        configuredQuantity: this.config.minSellQuantity,
        configuredPrice: this.config.minPrice,
        status: openOrder ? 'active' : 'idle',
        openOrderId: openOrder?.id,
        openOrderPrice: openOrder?.price,
        openOrderRemaining: openOrder?.remaining,
        partiallyFilled: openOrder?.partiallyFilled,
        note: openOrder ? 'Legacy sell rule currently tracked' : 'No active legacy sell order tracked',
      };
    });
  }

  private async loop(): Promise<void> {
    if (!this.running) {
      return;
    }

    const start = Date.now();
    this.lastCycleStartedAt = new Date(start).toISOString();
    const stats: CycleStats = {
      rulesChecked: this.config.assetRules.length > 0 ? this.config.assetRules.length : this.legacyResources.length,
      loggedEvents: 0,
      changes: 0,
      skips: 0,
      errors: 0,
      retryableSkips: 0,
    };
    this.currentCycleStats = stats;

    try {
      await this.runCycle();
    } catch (err) {
      this.logger.error('Cycle failed:', err);
      await this.appendLog({ event: 'ERROR', message: (err as Error).message });
    } finally {
      this.currentCycleStats = null;
    }

    const end = Date.now();
    this.lastCycleCompletedAt = new Date(end).toISOString();
    this.lastCycleDurationMs = end - start;
    const nextDelayMs = this.getNextCycleDelayMs(stats);
    this.nextCycleDelayMinutes = Math.max(1, Math.round(nextDelayMs / 60_000));
    await this.appendCycleCompletionLog(stats, nextDelayMs, this.lastCycleDurationMs);
    this.invalidateStatusSnapshotCache();

    if (!this.running) {
      return;
    }

    const elapsed = end - start;
    const delay = Math.max(0, nextDelayMs - elapsed);
    this.loopTimer = setTimeout(() => {
      void this.loop();
    }, delay);
  }
}
