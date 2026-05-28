import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { buildBotConfig, LmMarketBot, BotInputConfig } from './bot';
import { formatAssetRegistryResourceList, loadAssetRegistryForAephiaKey } from './asset-registry';


const AEPHIA_TOKEN_VALIDATE_URL = 'https://api.aephia.com/token/validate';
const AEPHIA_API_KEY_VALIDATION_BYPASS = false; // Re-enable Aephia token validation.

function getAephiaApiKey(config: Record<string, unknown>) {
  return String(config?.AEPHIA_API_KEY || '').trim();
}

async function validateAephiaApiKeyOrThrow(config: Record<string, unknown>) {
  const token = getAephiaApiKey(config);
  if (!token) {
    throw new Error('No valid Aephia API Key configured. Do the following steps to get your Aephia API Key:\n1) Apply to join Aephia at https://play.staratlas.com/dac/explore/4rrcD3WZaFhrXtZenLt18YNR24Uc3jQrT6iwxNNAuWkY/\n2) Become a verified Aephian by registering in AstralPass.\n3) Claim your Aephia API token in our Discord with the command /api-token.');
  }

  let response: Response;
  try {
    response = await fetch(AEPHIA_TOKEN_VALIDATE_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error('Aephia token service/network unavailable. Temporary service problem; token was not marked invalid.');
  }

  if (response.status === 204) return;
  if (response.status === 401) {
    throw new Error('No valid Aephia API Key configured. Refresh/reclaim your Aephia API Key. Do the following steps to get your Aephia API Key:\n1) Apply to join Aephia at https://play.staratlas.com/dac/explore/4rrcD3WZaFhrXtZenLt18YNR24Uc3jQrT6iwxNNAuWkY/\n2) Become a verified Aephian by registering in AstralPass.\n3) Claim your Aephia API token in our Discord with the command /api-token.');
  }
  if (response.status === 405) {
    throw new Error('Aephia token validation method rejected. Bot must use GET /token/validate.');
  }
  if (response.status >= 500) {
    throw new Error('Aephia token service unavailable. Temporary service problem; token was not marked invalid.');
  }
  throw new Error(`Unexpected Aephia token validation response: HTTP ${response.status}`);
}

async function loadGlobalSettings(): Promise<Record<string, unknown>> {
  const settingsPath = join(homedir(), '.config', 'lm-market-bot', 'settings.json');
  const raw = await readFile(settingsPath, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

async function main() {
  const settings = await loadGlobalSettings();
  await validateAephiaApiKeyOrThrow(settings);
  const assetRegistry = await loadAssetRegistryForAephiaKey(getAephiaApiKey(settings));
  const config = buildBotConfig({
    ...settings,
    RESOURCE_LIST: formatAssetRegistryResourceList(assetRegistry),
    assetRules: settings.ASSET_RULE_ROWS,
  } as BotInputConfig);
  const bot = new LmMarketBot(config);
  await bot.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
