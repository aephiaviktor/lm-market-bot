const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { spawn } = require('child_process');
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');
const packageJson = require('../package.json');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

const { LmMarketBot, buildBotConfig, getEditableConfigFromEnv, EDITABLE_CONFIG_KEYS } = require('../dist/bot');
const { formatAssetRegistryResourceList, loadAssetRegistryForAephiaKey } = require('../dist/asset-registry');

let mainWindow = null;
let bot = null;
let botRunning = false;
const recentLogs = [];

const AEPHIA_TOKEN_VALIDATE_URL = 'https://api.aephia.com/token/validate';
const AEPHIA_API_KEY_VALIDATION_BYPASS = false; // Re-enable Aephia token validation.
const GITHUB_REPO = 'aephiaviktor/lm-market-bot';
const GITHUB_MAIN_PACKAGE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json`;
const GITHUB_MAIN_ARCHIVE_URL = `https://github.com/${GITHUB_REPO}/archive/refs/heads/main.tar.gz`;
const APP_DISPLAY_NAME = 'LM Market Bot';

function installApplicationMenu() {
  const appVersion = packageJson.version || 'unknown';
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow || undefined, {
              type: 'info',
              title: `About ${APP_DISPLAY_NAME}`,
              message: `${APP_DISPLAY_NAME} v${appVersion}`,
              detail: `Electron ${process.versions.electron}\nChrome ${process.versions.chrome}\nNode ${process.versions.node}`,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);
}

function getAppRoot() {
  return path.resolve(__dirname, '..');
}

function decodeWalletSecret(secret) {
  const trimmed = String(secret || '').trim();
  if (!trimmed) {
    throw new Error('Hot wallet secret is empty.');
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error('Hot wallet secret JSON value must be an array.');
    }
    return Uint8Array.from(parsed);
  }

  const hexLike = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  if (/^[0-9a-fA-F]+$/.test(hexLike)) {
    if (hexLike.length % 2 !== 0) {
      throw new Error('Hot wallet secret hex value must have an even length.');
    }
    return Uint8Array.from(Buffer.from(hexLike, 'hex'));
  }

  return (bs58.decode || bs58.default.decode)(trimmed);
}

function getHotWalletAddressFromSecret(secret) {
  return Keypair.fromSecretKey(decodeWalletSecret(secret)).publicKey.toBase58();
}

async function readPackageVersion() {
  const raw = await fs.readFile(path.join(getAppRoot(), 'package.json'), 'utf8');
  return JSON.parse(raw).version;
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function compareVersions(a, b) {
  const left = normalizeVersion(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = normalizeVersion(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    if ((left[i] || 0) > (right[i] || 0)) return 1;
    if ((left[i] || 0) < (right[i] || 0)) return -1;
  }
  return 0;
}

async function fetchGithubJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'lm-market-bot-updater',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub request failed: HTTP ${response.status}`);
  }
  return await response.json();
}

async function getLatestGithubVersion() {
  const remotePackage = await fetchGithubJson(GITHUB_MAIN_PACKAGE_URL);
  const version = normalizeVersion(remotePackage?.version);

  if (!version) {
    throw new Error('No package version found on GitHub main.');
  }

  return {
    version,
    branch: 'main',
    url: `https://github.com/${GITHUB_REPO}/tree/main`,
    tarballUrl: GITHUB_MAIN_ARCHIVE_URL,
  };
}

async function checkForUpdates() {
  const currentVersion = await readPackageVersion();
  const latest = await getLatestGithubVersion();
  return {
    currentVersion,
    latestVersion: latest.version,
    latestBranch: latest.branch,
    updateAvailable: compareVersions(latest.version, currentVersion) > 0,
    releaseUrl: latest.url,
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || getAppRoot(),
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}: ${output.slice(-2000)}`));
      }
    });
  });
}

async function downloadFile(url, targetPath) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'lm-market-bot-updater' },
  });
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(targetPath, buffer);
}

async function downloadUpdateAndRestart() {
  const latest = await getLatestGithubVersion();
  const currentVersion = await readPackageVersion();
  if (compareVersions(latest.version, currentVersion) <= 0) {
    return { updated: false, currentVersion, latestVersion: latest.version };
  }

  if (botRunning) {
    await stopBot();
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lm-market-bot-update-'));
  const archivePath = path.join(tempDir, `${latest.branch || 'main'}.tar.gz`);
  await downloadFile(latest.tarballUrl, archivePath);
  await runCommand('tar', ['-xzf', archivePath, '-C', tempDir], { cwd: tempDir });

  const entries = await fs.readdir(tempDir, { withFileTypes: true });
  const extracted = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('lm-market-bot-'));
  if (!extracted) {
    throw new Error('Downloaded update archive did not contain the expected project folder.');
  }

  const extractedRoot = path.join(tempDir, extracted.name);
  await fs.cp(extractedRoot, getAppRoot(), {
    recursive: true,
    force: true,
    filter: (source) => {
      const rel = path.relative(extractedRoot, source);
      return !rel.startsWith('.git') && !rel.startsWith('node_modules') && !rel.startsWith('analysis');
    },
  });

  await runCommand('npm', ['install'], { cwd: getAppRoot() });
  await runCommand('npm', ['run', 'build'], { cwd: getAppRoot() });

  app.relaunch();
  app.exit(0);
  return { updated: true, currentVersion, latestVersion: latest.version };
}

function getAephiaApiKey(config) {
  return String(config?.AEPHIA_API_KEY || '').trim();
}

async function validateAephiaApiKeyOrThrow(config) {
  if (AEPHIA_API_KEY_VALIDATION_BYPASS) {
    return { bypassed: true };
  }

  const token = getAephiaApiKey(config);
  if (!token) {
    throw new Error('No valid Aephia API Key configured. Do the following steps to get your Aephia API Key:\n1) Apply to join Aephia at https://play.staratlas.com/dac/explore/4rrcD3WZaFhrXtZenLt18YNR24Uc3jQrT6iwxNNAuWkY/\n2) Become a verified Aephian by registering in AstralPass.\n3) Claim your Aephia API token in our Discord with the command /api-token.');
  }

  let response;
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


function formatLogChunk(args) {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return arg.stack || arg.message;
      }
      if (typeof arg === 'string') {
        return arg;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

function broadcast(channel, payload) {
  if (channel === 'bot-log') {
    recentLogs.push(payload);
    while (recentLogs.length > 200) recentLogs.shift();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

const logger = {
  info: (...args) => {
    const message = formatLogChunk(args);
    console.log(message);
    broadcast('bot-log', { timestamp: new Date().toISOString(), level: 'INFO', message });
  },
  warn: (...args) => {
    const message = formatLogChunk(args);
    console.warn(message);
    broadcast('bot-log', { timestamp: new Date().toISOString(), level: 'WARN', message });
  },
  error: (...args) => {
    const message = formatLogChunk(args);
    console.error(message);
    broadcast('bot-log', { timestamp: new Date().toISOString(), level: 'ERROR', message });
  },
};

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function normalizeAssetRules(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map((row) => ({
    asset: String(row?.asset ?? ''),
    side: row?.side === 'buy' ? 'buy' : 'sell',
    quantity: String(row?.quantity ?? ''),
    limit: String(row?.limit ?? ''),
    price: String(row?.price ?? ''),
    group: String(row?.group ?? ''),
  }));
}

async function loadManagedAssetRegistryOrThrow(config) {
  await validateAephiaApiKeyOrThrow(config);
  const assetRegistry = await loadAssetRegistryForAephiaKey(getAephiaApiKey(config));
  return formatAssetRegistryResourceList(assetRegistry);
}

async function tryLoadManagedAssetRegistry(config) {
  try {
    return await loadManagedAssetRegistryOrThrow(config);
  } catch {
    return '';
  }
}

async function loadLocalSettings() {
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

async function saveLocalSettings(payload) {
  const current = await loadLocalSettings();
  const filtered = {};

  for (const key of EDITABLE_CONFIG_KEYS) {
    const sourceConfig = payload?.config && typeof payload.config === 'object' ? payload.config : payload;
    if (Object.prototype.hasOwnProperty.call(sourceConfig || {}, key)) {
      filtered[key] = String(sourceConfig[key] ?? '');
    } else if (Object.prototype.hasOwnProperty.call(current, key)) {
      filtered[key] = current[key];
    }
  }

  filtered.ASSET_RULE_ROWS = normalizeAssetRules(payload?.assetRules ?? current.ASSET_RULE_ROWS ?? []);

  await fs.mkdir(path.dirname(getSettingsPath()), { recursive: true });
  await fs.writeFile(getSettingsPath(), JSON.stringify(filtered, null, 2), 'utf8');
  return filtered;
}

async function getEffectiveEditableConfig(options = {}) {
  const defaults = getEditableConfigFromEnv({});
  const localSettings = await loadLocalSettings();
  const config = {
    ...defaults,
    ...localSettings,
  };

  for (const key of EDITABLE_CONFIG_KEYS) {
    if (typeof config[key] === 'string' && !config[key].trim()) {
      config[key] = defaults[key];
    }
  }

  config.RESOURCE_LIST = options.requireAssetRegistry
    ? await loadManagedAssetRegistryOrThrow(config)
    : await tryLoadManagedAssetRegistry(config);

  return config;
}

async function getEffectiveBotInputConfig(options = {}) {
  const editable = await getEffectiveEditableConfig(options);
  const localSettings = await loadLocalSettings();

  return {
    ...editable,
    assetRules: normalizeAssetRules(localSettings.ASSET_RULE_ROWS ?? []),
  };
}

function getEmptyStatusSnapshot() {
  return {
    running: false,
    wallet: '—',
    solBalance: 0,
    atlasBalance: 0,
    startedAt: null,
    lastCycleStartedAt: null,
    lastCycleCompletedAt: null,
    lastCycleDurationMs: null,
    trackedAssetCount: 0,
    activeRuleCount: 0,
    openOrders: [],
    inventory: [],
    recentActivity: [],
    ruleHealth: [],
  };
}

async function startBotFromSettings() {
  if (botRunning) {
    return;
  }

  const configInput = await getEffectiveBotInputConfig({ requireAssetRegistry: true });
  const config = buildBotConfig(configInput);
  bot = new LmMarketBot(config, logger);
  botRunning = true;
  broadcast('bot-status', { running: true });

  try {
    await bot.start();
  } catch (err) {
    logger.error('Bot exited with error:', err);
    botRunning = false;
    bot = null;
    broadcast('bot-status', { running: false });
    throw err;
  }
}

async function stopBot() {
  if (!bot || !botRunning) {
    return;
  }
  await bot.stop();
  botRunning = false;
  bot = null;
  broadcast('bot-status', { running: false });
}

async function applyRunningSettingsToBot() {
  if (!bot || !botRunning) {
    return null;
  }

  const configInput = await getEffectiveBotInputConfig({ requireAssetRegistry: true });
  const newConfig = buildBotConfig(configInput);

  if (typeof bot.applyConfigUpdates === 'function') {
    bot.applyConfigUpdates(newConfig);
  } else if (bot.config && typeof bot.config === 'object') {
    Object.assign(bot.config, newConfig);
  }

  return newConfig;
}

async function rerunAssetGroups(newConfig, assets) {
  if (!bot || !botRunning) {
    return { ok: false, status: 'bot_not_running' };
  }

  const requestedAssets = Array.isArray(assets)
    ? assets.map((asset) => String(asset || '').trim()).filter(Boolean)
    : [];

  if (!requestedAssets.length) {
    return { ok: false, status: 'no_assets' };
  }

  const requestedKeys = new Set(requestedAssets.map((asset) => asset.toLowerCase()));
  const grouped = new Map();
  newConfig.assetRules.forEach((rule, index) => {
    const bucket = grouped.get(rule.asset) || [];
    bucket.push({ index, rule });
    grouped.set(rule.asset, bucket);
  });

  for (const [asset, rules] of grouped.entries()) {
    if (!requestedKeys.has(String(asset).toLowerCase())) {
      continue;
    }
    await bot.processAssetRuleGroup({ asset, rules });
  }

  if (typeof bot.invalidateStatusSnapshotCache === 'function') {
    bot.invalidateStatusSnapshotCache();
  }

  return { ok: true, status: 'rerun_triggered', assets: requestedAssets };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    icon: path.join(__dirname, 'assets', 'market_bot_icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

ipcMain.handle('logs:get', async () => recentLogs);

ipcMain.handle('settings:get', async () => {
  const config = await getEffectiveEditableConfig();
  const localSettings = await loadLocalSettings();
  return {
    config,
    running: botRunning,
    assetRules: normalizeAssetRules(localSettings.ASSET_RULE_ROWS ?? []),
  };
});

ipcMain.handle('settings:save', async (_event, payload) => {
  const saved = await saveLocalSettings(payload || {});
  const config = await getEffectiveEditableConfig();
  return {
    config,
    assetRules: normalizeAssetRules(saved.ASSET_RULE_ROWS),
  };
});

ipcMain.handle('settings:derive-hot-wallet', async (_event, secret) => {
  try {
    return { ok: true, address: getHotWalletAddressFromSecret(secret) };
  } catch (err) {
    return { ok: false, address: '', error: err?.message || String(err) };
  }
});

ipcMain.handle('bot:start', async () => {
  await startBotFromSettings();
  return { running: botRunning };
});

ipcMain.handle('bot:stop', async () => {
  await stopBot();
  return { running: botRunning };
});

ipcMain.handle('bot:apply-running-settings', async (_event, payload) => {
  if (!bot || !botRunning) {
    return { ok: false, status: 'bot_not_running' };
  }

  const newConfig = await applyRunningSettingsToBot();
  const requestedAssets = Array.isArray(payload?.assets)
    ? payload.assets.map((asset) => String(asset || '').trim()).filter(Boolean)
    : [];

  if (!requestedAssets.length) {
    return { ok: true, status: 'config_applied', assets: [] };
  }

  return rerunAssetGroups(newConfig, requestedAssets);
});

ipcMain.handle('bot:cancel-order', async (_event, payload) => {
  const asset = String(payload?.asset ?? '').trim();
  const side = payload?.side === 'buy' ? 'buy' : 'sell';

  if (!asset) {
    logger.error('Cancel order failed: asset is required');
    return { ok: false, status: 'invalid_request', asset, side };
  }

  if (!bot || !botRunning) {
    logger.warn(`Cancel order requested for ${asset} [${side}] but bot is not running`);
    return { ok: false, status: 'bot_not_running', asset, side };
  }

  try {
    return await bot.cancelActiveOrderForRule(asset, side);
  } catch (err) {
    logger.error(`Cancel order failed for ${asset} [${side}]:`, err);
    return {
      ok: false,
      status: 'error',
      asset,
      side,
      message: err?.message || String(err),
    };
  }
});

ipcMain.handle('bot:rerun-assets', async (_event, assets) => {
  if (!bot || !botRunning) {
    return { ok: false, status: 'bot_not_running' };
  }

  const newConfig = await applyRunningSettingsToBot();
  return rerunAssetGroups(newConfig, assets);
});

ipcMain.handle('bot:status', async () => {
  if (!bot) {
    return getEmptyStatusSnapshot();
  }

  try {
    return await bot.getStatusSnapshot();
  } catch (err) {
    logger.error('Failed to fetch bot status snapshot:', err);
    return getEmptyStatusSnapshot();
  }
});

ipcMain.handle('updates:check', async () => {
  return await checkForUpdates();
});

ipcMain.handle('updates:download-and-restart', async () => {
  return await downloadUpdateAndRestart();
});

app.whenReady().then(async () => {
  installApplicationMenu();
  createWindow();

  try {
    await startBotFromSettings();
  } catch (err) {
    logger.warn(`LM Market Bot auto-start blocked: ${err?.message || String(err)}`);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', async (event) => {
  if (botRunning) {
    event.preventDefault();
    try {
      await stopBot();
    } finally {
      app.exit(0);
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
