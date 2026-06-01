import { Buffer } from 'buffer';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { GmClientService, Order, OrderSide } from '@staratlas/factory';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
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
const SAGE_PROGRAM_ID = new PublicKey('SAGE2HAwep459SNq61LHvjxPk4pLPEJLoMETef7f7EE');
const CARGO_PROGRAM_ID = new PublicKey('Cargo2VNTPPTi9c1vq1Jw5d3BWUNr18MjRtSupAghKEk');
const QUOTE_ATLAS_MINT = new PublicKey('ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx');
const QUOTE_USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const DEFAULT_IRON_ORE_MINT = 'FeorejFjRRAfusN9Fg3WjEZ1dRCf74o6xwT5vDt3R34J';

const ORDER_PRICE_EPSILON = 0.0000005;
const ORDER_PRICE_STEP = 0.000001;
const ORDER_PRICE_NUDGE = 0.00000001;
const MARKET_LEADER_CACHE_TTL_MS = 300000;
const STATUS_SNAPSHOT_CACHE_FLOOR_MS = 60000;
const STATUS_SNAPSHOT_CACHE_CEIL_MS = 300000;
const DEFAULT_RPC_REQUESTS_PER_SECOND = 10;
const DEFAULT_RPC_TX_SEND_RATE_LIMIT_PER_SECOND = 1;
const DEFAULT_CHAIN_STATUS_REFRESH_INTERVAL_MINUTES = 5;
const STARBASE_PLAYER_PROFILE_OFFSET = 9;
const STARBASE_PLAYER_STARBASE_OFFSET = 73;
const CARGO_POD_AUTHORITY_OFFSET = 41;
const CARGO_POD_TOKEN_CACHE_TTL_MS = 60000;
const RPC_RATE_LIMIT_RETRY_DELAYS_MS = [2000, 5000, 10000];
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

  constructor(private readonly getRequestsPerSecond: () => number) {}

  async wait(): Promise<void> {
    const next = this.queue.then(async () => {
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

async function callRpcWithRateLimitRetry<T>(
  label: string,
  invoke: () => Promise<T>,
  limiter: RpcRequestRateLimiter,
  logger: BotLogger,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      await limiter.wait();
      return await invoke();
    } catch (error) {
      const retryDelayMs = RPC_RATE_LIMIT_RETRY_DELAYS_MS[attempt];
      if (!isRpcRateLimitError(error) || retryDelayMs === undefined) {
        throw error;
      }

      logger.warn(
        `RPC rate limit for ${label}; retrying in ${retryDelayMs}ms (${attempt + 1}/${RPC_RATE_LIMIT_RETRY_DELAYS_MS.length}).`,
      );
      await sleep(retryDelayMs);
    }
  }
}

function createFailoverConnection(
  primaryUrl: string,
  fallbackUrl: string | undefined,
  logger: BotLogger,
  getRequestsPerSecond: () => number,
): Connection {
  const primary = new Connection(primaryUrl, { commitment: 'confirmed' });
  const fallback = fallbackUrl && fallbackUrl !== primaryUrl ? new Connection(fallbackUrl, { commitment: 'confirmed' }) : null;
  const limiter = new RpcRequestRateLimiter(getRequestsPerSecond);

  return new Proxy(primary, {
    get(target, prop, receiver) {
      const primaryValue = Reflect.get(target, prop, receiver);
      if (typeof primaryValue !== 'function') {
        return primaryValue;
      }

      const fallbackValue = fallback ? Reflect.get(fallback, prop, fallback) : null;

      return async (...args: unknown[]) => {
        try {
          return await callRpcWithRateLimitRetry(
            `Connection.${String(prop)}()`,
            () => primaryValue.apply(target, args),
            limiter,
            logger,
          );
        } catch (error) {
          if (!fallback || typeof fallbackValue !== 'function') {
            throw error;
          }
          logger.warn(`Primary RPC failed for Connection.${String(prop)}(), trying fallback RPC.`, error);
          return await callRpcWithRateLimitRetry(
            `fallback Connection.${String(prop)}()`,
            () => fallbackValue.apply(fallback, args),
            limiter,
            logger,
          );
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
};

export type AssetRuleConfig = {
  starbase: string;
  asset: string;
  group: AssetRegistryGroup;
  side: AssetRuleSide;
  quantity: number;
  limit: number | null;
  price: number;
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

type OrderSnapshot = {
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

type BotState = Record<string, ResourceOrderState>;

type CargoPodTokenBalanceCacheEntry = {
  expiresAt: number;
  balances: Map<string, number>;
};

type IndexedAssetRule = {
  index: number;
  rule: AssetRuleConfig;
};

type GroupedAssetRules = {
  asset: string;
  group: AssetRegistryGroup;
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
  ownerProfile: string;
  hotWalletSecret: string;
  minSellQuantity: number;
  minPrice: number;
  rpcRequestsPerSecond: number;
  rpcTxSendRateLimitPerSecond: number;
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

export type BotOpenOrderStatus = {
  id: string;
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
  tx?: string;
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
  running: boolean;
  wallet: string;
  solBalance: number;
  atlasBalance: number;
  usdcBalance: number;
  startedAt: string | null;
  lastCycleStartedAt: string | null;
  lastCycleCompletedAt: string | null;
  lastCycleDurationMs: number | null;
  trackedAssetCount: number;
  activeRuleCount: number;
  openOrders: BotOpenOrderStatus[];
  inventory: BotInventoryStatus[];
  recentActivity: BotRecentActivity[];
  ruleHealth: BotRuleHealthStatus[];
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
    CHAIN_STATUS_REFRESH_INTERVAL_MINUTES: input.CHAIN_STATUS_REFRESH_INTERVAL_MINUTES as string | undefined,
    CHECK_INTERVAL_MINUTES: input.CHECK_INTERVAL_MINUTES as string | undefined,
    RELEVANT_SELL_ORDER_PCT: input.RELEVANT_SELL_ORDER_PCT as string | undefined,
    RELEVANT_BUY_ORDER_PCT: input.RELEVANT_BUY_ORDER_PCT as string | undefined,
    RESOURCE_LIST: input.RESOURCE_LIST as string | undefined,
  });

  const minSellQuantity = parsePositiveInteger(editable.MIN_SELL_QUANTITY, 'MIN_SELL_QUANTITY');
  const minPrice = parsePositiveNumber(editable.MIN_PRICE, 'MIN_PRICE');
  const rpcRequestsPerSecond = parsePositiveNumber(editable.RPC_REQUESTS_PER_SECOND, 'RPC_REQUESTS_PER_SECOND');
  const rpcTxSendRateLimitPerSecond = parsePositiveNumber(
    editable.RPC_TX_SEND_RATE_LIMIT_PER_SECOND,
    'RPC_TX_SEND_RATE_LIMIT_PER_SECOND',
  );
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
    ownerProfile: editable.OWNER_PROFILE,
    hotWalletSecret: editable.HOT_WALLET_SECRET,
    minSellQuantity,
    minPrice,
    rpcRequestsPerSecond,
    rpcTxSendRateLimitPerSecond,
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

  return input
    .filter(isRunnableAssetRuleInput)
    .map((rule, index) => parseAssetRule(rule, index));
}

function isRunnableAssetRuleInput(rule: AssetRuleInput | null | undefined): rule is AssetRuleInput {
  return Boolean(
    String(rule?.asset ?? '').trim() &&
      String(rule?.quantity ?? '').trim() &&
      String(rule?.price ?? '').trim(),
  );
}

export function parseAssetRule(input: AssetRuleInput, index?: number): AssetRuleConfig {
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
  };
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
    const key = rule.group + '|' + normalizeAssetKey(rule.asset);
    const item = { index, rule };
    const existing = grouped.get(key);

    if (existing) {
      existing.rules.push(item);
    } else {
      grouped.set(key, {
        asset: rule.asset,
        group: rule.group,
        rules: [item],
      });
    }
  });

  return grouped;
}

function normalizeLoadedState(parsed: unknown, trackedResources: ResourceConfig[]): BotState {
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
  private readonly analysisPath: string;
  private readonly logFilePath: string;
  private readonly stateFilePath: string;
  private checkIntervalMs: number;

  private state: BotState = {};
  private running = false;
  private loopTimer: NodeJS.Timeout | null = null;
  private readonly recentlyCancelledOrderIds = new Set<string>();
  private startedAt: string | null = null;
  private lastCycleStartedAt: string | null = null;
  private lastCycleCompletedAt: string | null = null;
  private lastCycleDurationMs: number | null = null;
  private readonly passiveOpenOrdersCache = new Map<string, BotOpenOrderStatus[]>();
  private readonly marketLeaderCache = new Map<string, { expiresAt: number; bestBuyPrice: number | null; bestSellPrice: number | null }>();
  private readonly walletBalanceCache = new Map<string, number>();
  private readonly starbasePlayerCache = new Map<string, PublicKey | null>();
  private readonly cargoPodCache = new Map<string, PublicKey[]>();
  private readonly cargoPodTokenBalanceCache = new Map<string, CargoPodTokenBalanceCacheEntry>();
  private solBalanceCache: number | null = null;
  private statusSnapshotCache: { expiresAt: number; snapshot: BotStatusSnapshot } | null = null;
  private transactionSubmissionQueue: Promise<void> = Promise.resolve();
  private nextTransactionSubmitAtMs = 0;

  constructor(
    private readonly config: BotConfig,
    private readonly logger: BotLogger = defaultLogger,
  ) {
    const secretKeyBytes = decodeSecret(config.hotWalletSecret);
    this.wallet = secretKeyBytes.length === 32 ? Keypair.fromSeed(secretKeyBytes) : Keypair.fromSecretKey(secretKeyBytes);
    this.connection = createFailoverConnection(
      config.rpcUrl,
      config.rpcUrlFallback,
      this.logger,
      () => this.config.rpcRequestsPerSecond,
    );
    this.resourceListResources = parseResources(config.resourceList);
    this.legacyResources = [];
    this.trackedResources = parseRuleResources(config.assetRules);
    this.statusResources = this.trackedResources;
    this.analysisPath = path.resolve(process.cwd(), config.analysisDir);
    this.logFilePath = path.join(this.analysisPath, 'orders-log.jsonl');
    this.stateFilePath = path.join(this.analysisPath, 'bot-state.json');
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
    this.config.chainStatusRefreshIntervalMinutes = next.chainStatusRefreshIntervalMinutes;
    this.config.checkIntervalMinutes = next.checkIntervalMinutes;
    this.config.relevantSellOrderPct = next.relevantSellOrderPct;
    this.config.relevantBuyOrderPct = next.relevantBuyOrderPct;
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
    this.walletBalanceCache.clear();
    this.starbasePlayerCache.clear();
    this.cargoPodCache.clear();
    this.cargoPodTokenBalanceCache.clear();
    this.solBalanceCache = null;
    this.invalidateStatusSnapshotCache();
  }

  private invalidateMarketLeaderCacheForMint(mint: string) {
    this.marketLeaderCache.delete(mint);
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

    const solBalance = await this.getSolBalance({ refresh: true });
    const atlasBalance = await this.getWalletBalanceForMint(QUOTE_ATLAS_MINT, 'ATLAS', { refresh: true });
    const usdcBalance = await this.getWalletBalanceForMint(QUOTE_USDC_MINT, 'USDC', { refresh: true });

    const inventory = await this.buildInventorySnapshot();

    const openOrders = await this.buildOpenOrdersSnapshot();
    const recentActivity = await this.readRecentActivity(this.startedAt);
    const ruleHealth = this.buildRuleHealthSnapshot(openOrders);

    const snapshot = {
      running: this.running,
      wallet,
      solBalance,
      atlasBalance,
      usdcBalance,
      startedAt: this.startedAt,
      lastCycleStartedAt: this.lastCycleStartedAt,
      lastCycleCompletedAt: this.lastCycleCompletedAt,
      lastCycleDurationMs: this.lastCycleDurationMs,
      trackedAssetCount: this.trackedResources.length,
      activeRuleCount: this.config.assetRules.length,
      openOrders,
      inventory,
      recentActivity,
      ruleHealth,
    };

    this.statusSnapshotCache = {
      expiresAt: Date.now() + this.config.chainStatusRefreshIntervalMinutes * 60_000,
      snapshot,
    };

    return snapshot;
  }

  async cancelActiveOrderForRule(asset: string, side: AssetRuleSide): Promise<CancelOrderResult> {
    const normalizedSide = parseAssetRuleSide(side, 'cancelOrder.side');
    const resource = parseResourceEntry(asset, 'cancelOrder.asset');
    const cancelledIds = new Set<string>();

    try {
      const myOrdersRaw = await this.gm.getOpenOrdersForPlayerAndAsset(
        this.connection,
        this.wallet.publicKey,
        resource.mint,
        GM_PROGRAM_ID,
      );
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

      const refreshedOrdersRaw = await this.gm.getOpenOrdersForPlayerAndAsset(
        this.connection,
        this.wallet.publicKey,
        resource.mint,
        GM_PROGRAM_ID,
      );
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

  private async getStarbaseCargoPodBalance(rule: AssetRuleConfig, resource: ResourceConfig): Promise<number> {
    const cargoPods = await this.getStarbaseCargoPods(rule.starbase);
    if (cargoPods.length === 0) {
      return 0;
    }

    const mintKey = resource.mint.toBase58();
    let balance = 0;
    for (const cargoPod of cargoPods) {
      const tokenBalances = await this.getCargoPodTokenBalances(cargoPod);
      balance += tokenBalances.get(mintKey) ?? 0;
    }

    return balance;
  }

  private async getStarbaseCargoPods(starbaseName: string): Promise<PublicKey[]> {
    const starbasePlayer = await this.getStarbasePlayer(starbaseName);
    if (!starbasePlayer) {
      return [];
    }

    const cacheKey = starbasePlayer.toBase58();
    const cached = this.cargoPodCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const accounts = await this.connection.getProgramAccounts(CARGO_PROGRAM_ID, {
        commitment: 'confirmed',
        filters: [{ memcmp: { offset: CARGO_POD_AUTHORITY_OFFSET, bytes: starbasePlayer.toBase58() } }],
        dataSlice: { offset: 0, length: 0 },
      });
      const cargoPods = accounts.map((account) => account.pubkey);
      this.cargoPodCache.set(cacheKey, cargoPods);
      return cargoPods;
    } catch (err) {
      this.logger.warn(`Failed to resolve cargo pods for starbasePlayer ${starbasePlayer.toBase58()}`, err);
      return [];
    }
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
    if (this.starbasePlayerCache.has(cacheKey)) {
      return this.starbasePlayerCache.get(cacheKey) ?? null;
    }

    try {
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
      const starbasePlayer = accounts[0]?.pubkey ?? null;
      this.starbasePlayerCache.set(cacheKey, starbasePlayer);
      return starbasePlayer;
    } catch (err) {
      this.logger.warn(`Failed to resolve starbasePlayer for ${starbaseName}`, err);
      this.starbasePlayerCache.set(cacheKey, null);
      return null;
    }
  }

  private async getCargoPodTokenBalances(cargoPod: PublicKey): Promise<Map<string, number>> {
    const cacheKey = cargoPod.toBase58();
    const cached = this.cargoPodTokenBalanceCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.balances;
    }

    const balances = new Map<string, number>();
    try {
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(cargoPod, { programId: TOKEN_PROGRAM_ID });
      for (const tokenAccount of tokenAccounts.value) {
        const parsed = tokenAccount.account.data.parsed as {
          info?: { mint?: string; tokenAmount?: { uiAmount?: number | null; uiAmountString?: string; amount?: string; decimals?: number } };
        };
        const mint = parsed.info?.mint;
        if (!mint) {
          continue;
        }
        const tokenAmount = parsed.info?.tokenAmount;
        const amount = parseTokenAmount(tokenAmount);
        balances.set(mint, (balances.get(mint) ?? 0) + amount);
      }
    } catch (err) {
      this.logger.warn(`Failed to fetch cargo pod token balances for ${cacheKey}`, err);
    }

    this.cargoPodTokenBalanceCache.set(cacheKey, {
      expiresAt: Date.now() + CARGO_POD_TOKEN_CACHE_TTL_MS,
      balances,
    });
    return balances;
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
    this.invalidateStatusSnapshotCache();
    await fs.writeFile(this.stateFilePath, JSON.stringify(this.state, null, 2));
  }

  private async appendLog(event: Record<string, unknown>) {
    this.invalidateStatusSnapshotCache();
    const payload = { timestamp: new Date().toISOString(), ...event };
    await fs.appendFile(this.logFilePath, JSON.stringify(payload) + '\n', 'utf8');
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
    if (!options?.refresh && this.solBalanceCache != null) {
      return this.solBalanceCache;
    }

    try {
      const solLamports = await this.connection.getBalance(this.wallet.publicKey, 'confirmed');
      const solBalance = solLamports / 1e9;
      this.solBalanceCache = solBalance;
      return solBalance;
    } catch (err) {
      this.logger.warn('Failed to fetch SOL balance', err);
      return this.solBalanceCache ?? 0;
    }
  }

  private async getWalletBalanceForMint(
    mint: PublicKey,
    resourceName: string,
    options?: { refresh?: boolean },
  ): Promise<number> {
    const mintKey = mint.toBase58();
    if (!options?.refresh && this.walletBalanceCache.has(mintKey)) {
      return this.walletBalanceCache.get(mintKey) ?? 0;
    }

    const ata = await getAssociatedTokenAddress(mint, this.wallet.publicKey);
    try {
      const balance = await this.connection.getTokenAccountBalance(ata);
      const amount = Number(balance.value.amount ?? '0');
      const decimals = balance.value.decimals ?? 0;
      const normalized = amount / 10 ** decimals;
      this.walletBalanceCache.set(mintKey, normalized);
      return normalized;
    } catch (err) {
      const message = (err as Error).message ?? '';
      if (message.includes('could not find account')) {
        this.walletBalanceCache.set(mintKey, 0);
        return 0;
      }
      this.logger.warn(`Failed to fetch ${resourceName} balance`, err);
      return this.walletBalanceCache.get(mintKey) ?? 0;
    }
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
    const { signature, blockhash, lastValidBlockHeight } = await this.submitTransactionRateLimited(transaction, extraSigners);
    await this.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    return signature;
  }

  private async cancelOrder(order: Order, resource: ResourceConfig, side: AssetRuleSide, cancelledIds: Set<string>): Promise<string> {
    this.logger.info(`Cancelling ${side} order for ${resource.name} ${order.id} at ${order.uiPrice} ATLAS`);
    const { transaction, signers } = await this.gm.getCancelOrderTransaction(
      this.connection,
      new PublicKey(order.id),
      this.wallet.publicKey,
      GM_PROGRAM_ID,
    );
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

  private async placeOrder(
    resource: ResourceConfig,
    side: AssetRuleSide,
    targetPrice: number,
    quantity: number,
    cancelledIds: Set<string> = new Set<string>(),
    quoteMintOverride?: PublicKey,
  ) {
    const quoteMint = quoteMintOverride ?? getQuoteMintForResource(resource);
    const quoteSymbol = getQuoteSymbolForMint(quoteMint);
    this.logger.info(`Placing ${side} order for ${quantity} ${resource.name} @ ${targetPrice} ${quoteSymbol}`);
    const priceBn = await this.gm.getBnPriceForCurrency(this.connection, targetPrice, quoteMint, GM_PROGRAM_ID);
    const { transaction, signers } = await this.gm.getInitializeOrderTransaction(
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

    const refreshedOrdersRaw = await this.gm.getOpenOrdersForPlayerAndAsset(
      this.connection,
      this.wallet.publicKey,
      resource.mint,
      GM_PROGRAM_ID,
    );

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
      if (currentOrder) {
        const currentRemaining = getOrderRemainingQuantity(currentOrder);
        if (currentRemaining < meta.remaining) {
          const filledDelta = meta.remaining - currentRemaining;
          await this.appendLog({
            event: 'FILLED',
            side,
            resource: resource.name,
            mint: resource.mint.toBase58(),
            orderId,
            price: meta.price,
            quantity: meta.quantity,
            filledDelta,
            remaining: currentRemaining,
            message: `Filled +${filledDelta}. Remaining ${currentRemaining}/${meta.quantity ?? meta.remaining}`,
          });
        }
      }

      const wasCancelled =
        cancelledIds.has(orderId) || this.recentlyCancelledOrderIds.has(orderId);

      if (!currentIds.has(orderId) && !wasCancelled) {
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
  ): number {
    const externalSellOrders = allSellOrders
      .filter(
        (o) =>
          o.owner !== this.wallet.publicKey.toBase58() &&
          getOrderBookQuantity(o) >= minRelevantQuantity,
      )
      .sort((a, b) => a.uiPrice - b.uiPrice);

    if (externalSellOrders.length === 0) {
      return minPrice;
    }

    const bestSell = externalSellOrders[0];

    if (bestSell.uiPrice >= minPrice) {
      const undercutPrice = Math.max(0, bestSell.uiPrice - ORDER_PRICE_NUDGE);
      return Math.max(minPrice, roundDown(undercutPrice, 6));
    }

    const nextHigherSell = externalSellOrders.find((o) => o.uiPrice >= minPrice);

    if (nextHigherSell) {
      const undercutPrice = Math.max(0, nextHigherSell.uiPrice - ORDER_PRICE_NUDGE);
      return Math.max(minPrice, roundDown(undercutPrice, 6));
    }

    return minPrice;
  }

  private getTargetBuyPrice(
    allBuyOrders: Order[],
    maxBuyPrice: number,
    minRelevantQuantity: number,
    options?: { outbidPct?: number },
  ): number {
    const externalBuyOrders = allBuyOrders
      .filter(
        (o) =>
          o.owner !== this.wallet.publicKey.toBase58() &&
          getOrderBookQuantity(o) >= minRelevantQuantity,
      )
      .sort((a, b) => b.uiPrice - a.uiPrice);

    if (externalBuyOrders.length === 0) {
      return maxBuyPrice;
    }

    const bestBuy = externalBuyOrders[0];

    if (bestBuy.uiPrice < maxBuyPrice - ORDER_PRICE_EPSILON) {
      const improvedBid = options?.outbidPct ? bestBuy.uiPrice * (1 + options.outbidPct) : bestBuy.uiPrice + ORDER_PRICE_NUDGE;
      return Math.min(maxBuyPrice, roundUp(improvedBid, 6));
    }

    if (Math.abs(bestBuy.uiPrice - maxBuyPrice) < ORDER_PRICE_EPSILON) {
      const nextLowerBuy = externalBuyOrders.find((o) => o.uiPrice < maxBuyPrice - ORDER_PRICE_EPSILON);
      if (nextLowerBuy) {
        const improvedBid = options?.outbidPct ? nextLowerBuy.uiPrice * (1 + options.outbidPct) : nextLowerBuy.uiPrice + ORDER_PRICE_NUDGE;
        return Math.min(maxBuyPrice, roundUp(improvedBid, 6));
      }
      return maxBuyPrice;
    }

    const nextLowerBuy = externalBuyOrders.find((o) => o.uiPrice <= maxBuyPrice);

    if (nextLowerBuy) {
      const improvedBid = options?.outbidPct ? nextLowerBuy.uiPrice * (1 + options.outbidPct) : nextLowerBuy.uiPrice + ORDER_PRICE_NUDGE;
      return Math.min(maxBuyPrice, roundUp(improvedBid, 6));
    }

    return maxBuyPrice;
  }

  private async readMarketOrderSnapshot(resource: ResourceConfig): Promise<MarketOrderSnapshot> {
    const [allOrdersRaw, myOrdersRaw] = await Promise.all([
      this.gm.getOpenOrdersForAsset(this.connection, resource.mint, GM_PROGRAM_ID),
      this.gm.getOpenOrdersForPlayerAndAsset(this.connection, this.wallet.publicKey, resource.mint, GM_PROGRAM_ID),
    ]);

    return { allOrdersRaw, myOrdersRaw };
  }

  private async processSellRule(
    resource: ResourceConfig,
    minSellQuantity: number,
    minPrice: number,
    quoteMintOverride?: PublicKey,
    marketOrderSnapshot?: MarketOrderSnapshot,
    limit?: number | null,
  ) {
    this.logger.info(`[${new Date().toISOString()}] Checking ${resource.name} sell market...`);
    const cancelledIds = new Set<string>();
    const { allOrdersRaw, myOrdersRaw } = marketOrderSnapshot ?? (await this.readMarketOrderSnapshot(resource));

    const quoteMint = quoteMintOverride ?? getQuoteMintForResource(resource);
    const allOrders = allOrdersRaw.filter((o) => o.orderType === OrderSide.Sell && isOrderForQuoteMint(o, quoteMint));
    const myOrders = myOrdersRaw.filter((o) => o.orderType === OrderSide.Sell && isOrderForQuoteMint(o, quoteMint));
    const staleQuoteOrders = myOrdersRaw.filter((o) => o.orderType === OrderSide.Sell && !isOrderForQuoteMint(o, quoteMint));

    for (const staleOrder of staleQuoteOrders) {
      await this.cancelOrder(staleOrder, resource, 'sell', cancelledIds);
    }

    await this.detectFills(resource, 'sell', myOrders, cancelledIds);

    const walletBalance = await this.getWalletBalanceForMint(resource.mint, resource.name);
    const relevantSellQuantity = getRelevantOrderThreshold(minSellQuantity, this.config.relevantSellOrderPct);
    const targetPrice = this.getTargetSellPrice(allOrders, minPrice, relevantSellQuantity);

    this.logger.info(`${resource.name} balance: ${walletBalance}`);

    const sortedMyOrders = [...myOrders].sort((a, b) => a.uiPrice - b.uiPrice);
    const activeOrder = sortedMyOrders[0];
    for (let i = 1; i < sortedMyOrders.length; i++) {
      await this.cancelOrder(sortedMyOrders[i], resource, 'sell', cancelledIds);
    }

    if (!activeOrder) {
      if (walletBalance < minSellQuantity) {
        this.logger.info(`Insufficient ${resource.name} to place a new sell order. Skipping.`);
        await this.appendLog({
          event: 'SKIP_NO_INVENTORY',
          side: 'sell',
          resource: resource.name,
          mint: resource.mint.toBase58(),
          balance: walletBalance,
          minSellQuantity,
        });
        return;
      }

      const availableToSell = Math.floor(walletBalance);
      const quantityToSell = Math.min(availableToSell, limit ?? availableToSell);
      if (quantityToSell < minSellQuantity) {
        this.logger.info(
          `Available ${resource.name} sell quantity after limit is ${quantityToSell}, below minimum ${minSellQuantity}. Skipping.`,
        );
        return;
      }
      this.logger.info(`Planning to sell ${quantityToSell} ${resource.name} this cycle.`);
      await this.placeOrder(resource, 'sell', targetPrice, quantityToSell, cancelledIds, quoteMint);
      const postPlacementBalance = await this.syncPostPlacementWalletBalance(resource, 'sell');
      this.logger.info(`Stored sell wallet baseline for ${resource.name}: ${postPlacementBalance}`);
      return;
    }

    const activeQuantity = getOrderRemainingQuantity(activeOrder);
    const freeWalletQuantity = Math.max(0, Math.floor(walletBalance));
    const remainingSellAllowance = Math.max(0, (limit ?? Number.POSITIVE_INFINITY) - activeQuantity);
    const addableWalletQuantity = Math.min(freeWalletQuantity, remainingSellAllowance);
    const canTopUpToSellLimit =
      typeof limit === 'number' &&
      remainingSellAllowance > 0 &&
      freeWalletQuantity >= remainingSellAllowance;
    const shouldResizeForWallet = addableWalletQuantity >= minSellQuantity || canTopUpToSellLimit;
    const shouldResizeForLimit = typeof limit === 'number' && activeQuantity > limit;
    const priceDelta = Math.abs(activeOrder.uiPrice - targetPrice);
    const shouldReplaceForPrice = priceDelta >= ORDER_PRICE_EPSILON;

    if (shouldResizeForWallet || shouldResizeForLimit || shouldReplaceForPrice) {
      const nextQuantity = shouldResizeForLimit
        ? limit ?? activeQuantity
        : shouldResizeForWallet
          ? activeQuantity + addableWalletQuantity
          : activeQuantity;

      if (shouldResizeForLimit) {
        this.logger.info(
          `Sell limit for ${resource.name} is ${limit}. Resizing order from ${activeQuantity} to ${nextQuantity}.`,
        );
      } else if (shouldResizeForWallet) {
        this.logger.info(
          canTopUpToSellLimit
            ? `Sell free wallet balance for ${resource.name} is ${freeWalletQuantity}. Topping up order from ${activeQuantity} to sell limit ${nextQuantity}.`
            : `Sell free wallet balance for ${resource.name} is ${freeWalletQuantity}. Resizing order from ${activeQuantity} to ${nextQuantity}.`,
        );
      } else {
        this.logger.info(
          `Sell price moved for ${resource.name}. Replacing order at ${targetPrice} while keeping quantity ${activeQuantity}.`,
        );
      }

      await this.cancelOrder(activeOrder, resource, 'sell', cancelledIds);
      await this.placeOrder(resource, 'sell', targetPrice, nextQuantity, cancelledIds, quoteMint);
      const postPlacementBalance = await this.syncPostPlacementWalletBalance(resource, 'sell');
      this.logger.info(`Stored sell wallet baseline for ${resource.name}: ${postPlacementBalance}`);
      return;
    }

    this.logger.info(
      `Sell order ${activeOrder.id} already at target price (${activeOrder.uiPrice}) and free wallet balance (${freeWalletQuantity}) is below threshold or limit. Nothing to do.`,
    );
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
    const maxBuyPrice = rule.price;
    const inventoryBalance = await this.getWalletBalanceForMint(resource.mint, resource.name, { refresh: true });
    const remainingBuyAllowance = Math.max(0, Math.floor((rule.limit ?? Number.POSITIVE_INFINITY) - inventoryBalance));
    const targetQuantity = Math.min(maxBuyQuantity, remainingBuyAllowance);
    const relevantBuyQuantity = getRelevantOrderThreshold(Math.max(1, targetQuantity), this.config.relevantBuyOrderPct);
    const targetPrice =
      targetQuantity > 0
        ? this.getTargetBuyPrice(
            allOrders,
            maxBuyPrice,
            relevantBuyQuantity,
            isShipMarket ? { outbidPct: SHIP_BUY_OUTBID_PCT } : undefined,
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
    const hasRunnableSellRule = sellRules.length === 1;
    const hasRunnableBuyRule = buyRules.length === 1;
    const marketOrderSnapshot =
      hasRunnableSellRule || hasRunnableBuyRule ? await this.readMarketOrderSnapshot(resource) : undefined;

    if (sellRules.length > 1) {
      const ruleIndexes = sellRules.map((item) => item.index);
      const message = `Duplicate sell rules for ${resource.name}, skipping sell side`;
      this.logger.error(message);
      await this.appendLog({
        event: 'SKIP_DUPLICATE_SELL_RULES',
        asset,
        resource: resource.name,
        mint: resource.mint.toBase58(),
        ruleIndexes,
      });
    } else if (sellRules.length === 1) {
      const sellRule = sellRules[0];
      await this.processSellRule(resource, sellRule.rule.quantity, sellRule.rule.price, quoteMint, marketOrderSnapshot, sellRule.rule.limit);
    }

    if (buyRules.length > 1) {
      const ruleIndexes = buyRules.map((item) => item.index);
      const message = `Duplicate buy rules for ${resource.name}, skipping buy side`;
      this.logger.error(message);
      await this.appendLog({
        event: 'SKIP_DUPLICATE_BUY_RULES',
        asset,
        resource: resource.name,
        mint: resource.mint.toBase58(),
        ruleIndexes,
      });
    } else if (buyRules.length === 1) {
      const buyRule = buyRules[0];
      await this.processBuyRule(buyRule.rule, buyRule.index, resource, quoteMint, marketOrderSnapshot);
    }
  }

  private async runCycle() {
    this.walletBalanceCache.clear();
    this.solBalanceCache = null;
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

  private async buildOpenOrdersSnapshot(): Promise<BotOpenOrderStatus[]> {
    const result: BotOpenOrderStatus[] = [];
    const now = new Date().toISOString();
    const trackedMints = new Set(this.trackedResources.map((resource) => resource.mint.toBase58()));

    await Promise.all(
      this.statusResources.map(async (resource) => {
        const mintKey = resource.mint.toBase58();
        const isTracked = trackedMints.has(mintKey);

        try {
          let openOrders: BotOpenOrderStatus[] | null = null;

          if (!isTracked) {
            const cached = this.passiveOpenOrdersCache.get(mintKey);
            if (cached) {
              openOrders = cached.map((order) => ({ ...order }));
            }
          }

          if (!openOrders) {
            const myOrdersRaw = await this.gm.getOpenOrdersForPlayerAndAsset(
              this.connection,
              this.wallet.publicKey,
              resource.mint,
              GM_PROGRAM_ID,
            );

            openOrders = [];
            for (const order of myOrdersRaw) {
              const side = order.orderType === OrderSide.Buy ? 'buy' : order.orderType === OrderSide.Sell ? 'sell' : null;
              if (!side) {
                continue;
              }

              const quantity = getOrderTrackedQuantity(order);
              const remaining = getOrderRemainingQuantity(order);
              openOrders.push({
                id: order.id,
                asset: getResourceLabel(resource),
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

            if (!isTracked) {
              this.passiveOpenOrdersCache.set(mintKey, openOrders.map((order) => ({ ...order })));
            }
          }

          result.push(...openOrders);
        } catch (err) {
          this.logger.warn(`Failed to fetch open orders for ${resource.name}:`, err);
        }
      }),
    );

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

  private getRelevantBadgeThresholds(): Map<string, { buy: number; sell: number }> {
    const thresholds = new Map<string, { buy: number; sell: number }>();

    if (this.config.assetRules.length > 0) {
      const groupedRules = groupRulesByAsset(this.config.assetRules);
      for (const group of groupedRules.values()) {
        try {
          const resource = resolveResourceForRule(group.rules[0].rule);
          const mintKey = resource.mint.toBase58();
          const current = thresholds.get(mintKey) ?? { buy: 1, sell: 1 };

          const buyRule = group.rules.find((item) => item.rule.side === 'buy')?.rule;
          if (buyRule) {
            current.buy = getRelevantOrderThreshold(buyRule.quantity, this.config.relevantBuyOrderPct);
          }

          const sellRule = group.rules.find((item) => item.rule.side === 'sell')?.rule;
          if (sellRule) {
            current.sell = getRelevantOrderThreshold(sellRule.quantity, this.config.relevantSellOrderPct);
          }

          thresholds.set(mintKey, current);
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

  private async annotateMarketLeaders(orders: BotOpenOrderStatus[]): Promise<BotOpenOrderStatus[]> {
    if (orders.length === 0) {
      return orders;
    }

    const thresholds = this.getRelevantBadgeThresholds();
    const byMarket = new Map<string, BotOpenOrderStatus[]>();
    for (const order of orders) {
      const quoteMint = order.currency === 'USDC' ? QUOTE_USDC_MINT : QUOTE_ATLAS_MINT;
      const key = getMarketLeaderCacheKey(order.mint, quoteMint);
      const bucket = byMarket.get(key) ?? [];
      bucket.push(order);
      byMarket.set(key, bucket);
    }

    await Promise.all(
      Array.from(byMarket.entries()).map(async ([marketKey, mintOrders]) => {
        const [mint, quoteMintRaw] = marketKey.split(':');
        const quoteMint = new PublicKey(quoteMintRaw);
        try {
          let cached = this.marketLeaderCache.get(marketKey);
          if (!cached || Date.now() >= cached.expiresAt) {
            const marketOrders = await this.gm.getOpenOrdersForAsset(this.connection, new PublicKey(mint), GM_PROGRAM_ID);
            const threshold = thresholds.get(mint) ?? { buy: 1, sell: 1 };
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

            cached = {
              expiresAt: Date.now() + MARKET_LEADER_CACHE_TTL_MS,
              bestBuyPrice: buyOrders.length ? Math.max(...buyOrders.map((order) => order.uiPrice)) : null,
              bestSellPrice: sellOrders.length ? Math.min(...sellOrders.map((order) => order.uiPrice)) : null,
            };
            this.marketLeaderCache.set(marketKey, cached);
          }

          for (const order of mintOrders) {
            if (order.side === 'buy' && cached.bestBuyPrice !== null && Math.abs(order.price - cached.bestBuyPrice) < ORDER_PRICE_EPSILON) {
              order.marketLeader = 'hb';
            }

            if (order.side === 'sell' && cached.bestSellPrice !== null && Math.abs(order.price - cached.bestSellPrice) < ORDER_PRICE_EPSILON) {
              order.marketLeader = 'ba';
            }
          }
        } catch (err) {
          this.logger.warn(`Failed to annotate market leader for ${mint}:`, err);
        }
      }),
    );

    return orders;
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

    if (this.config.assetRules.length > 0) {
      const grouped = groupRulesByAsset(this.config.assetRules);
      const result: BotRuleHealthStatus[] = [];

      for (const group of grouped.values()) {
        const buyRules = group.rules.filter((item) => item.rule.side === 'buy');
        const sellRules = group.rules.filter((item) => item.rule.side === 'sell');

        if (buyRules.length > 1) {
          result.push({
            asset: group.asset,
            side: 'buy',
            configuredQuantity: null,
            configuredPrice: null,
            status: 'duplicate',
            note: `Duplicate buy rules (${buyRules.length})`,
          });
        } else if (buyRules.length === 1) {
          const rule = buyRules[0].rule;
          const openOrder = findActiveOrder(group.asset, 'buy');
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
            note: openOrder ? 'Buy order currently tracked' : 'No active buy order tracked',
          });
        }

        if (sellRules.length > 1) {
          result.push({
            asset: group.asset,
            side: 'sell',
            configuredQuantity: null,
            configuredPrice: null,
            status: 'duplicate',
            note: `Duplicate sell rules (${sellRules.length})`,
          });
        } else if (sellRules.length === 1) {
          const rule = sellRules[0].rule;
          const openOrder = findActiveOrder(group.asset, 'sell');
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
            note: openOrder ? 'Sell order currently tracked' : 'No active sell order tracked',
          });
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

    try {
      await this.runCycle();
    } catch (err) {
      this.logger.error('Cycle failed:', err);
      await this.appendLog({ event: 'ERROR', message: (err as Error).message });
    }

    const end = Date.now();
    this.lastCycleCompletedAt = new Date(end).toISOString();
    this.lastCycleDurationMs = end - start;

    if (!this.running) {
      return;
    }

    const elapsed = end - start;
    const delay = Math.max(0, this.checkIntervalMs - elapsed);
    this.loopTimer = setTimeout(() => {
      void this.loop();
    }, delay);
  }
}
