const { app, BrowserWindow, ipcMain, Menu, dialog, powerSaveBlocker, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { buildWindowsTransactionalUpdateScript, buildWindowsUpdaterLauncher, compareVersions, normalizeVersion } = require('./update-policy');
const lockfile = require('proper-lockfile');
const {
  Connection,
  Keypair,
  PublicKey,
} = require('@solana/web3.js');
const bs58 = require('bs58');
const packageJson = require('../package.json');
const APP_VERSION = packageJson.version || 'unknown';

// ---------------------------------------------------------------------------
// Profile isolation — one codebase can run multiple local profiles.
// Launch with --profile <name>. The profile name is only a
// local label and is not hardcoded as a faction.
//
// Before app.disableHardwareAcceleration() we:
//   1. Read --profile from process.argv
//   2. Set app.setPath('userData') to ~/.config/lm-market-bot/profiles/<name>
//   3. Set app.setName() so taskbar/dock entries are distinct per profile
// ---------------------------------------------------------------------------
function getProfileName() {
  const args = process.argv.slice(1);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--profile' || arg === '--instance') {
      return String(args[i + 1] ?? '').trim();
    }
    if (arg.startsWith('--profile=')) {
      return arg.slice('--profile='.length).trim();
    }
    if (arg.startsWith('--instance=')) {
      return arg.slice('--instance='.length).trim();
    }
  }
  return '';
}

function sanitizeProfileName(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const BASE_USER_DATA = path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'lm-market-bot');
const _profileName = sanitizeProfileName(getProfileName());
const _instanceName = _profileName;
console.error('[LmMarketBot] profile from argv =', JSON.stringify(_profileName));
console.error('[LmMarketBot] HOME =', JSON.stringify(process.env.HOME));
if (_profileName) {
  app.setPath('userData', path.join(BASE_USER_DATA, 'profiles', _profileName));
  app.setName(`LM Market Bot - ${_profileName}`);
  if (typeof app.setDesktopName === 'function') {
    app.setDesktopName(`lm-market-bot-${_profileName}.desktop`);
  }
}

// TITLE_SUFFIX and APP_DISPLAY_NAME must be set synchronously so they are
// available to createWindow() and the installApplicationMenu() About dialog.
const TITLE_SUFFIX = _profileName ? ` - ${_profileName}` : '';
const WINDOW_TITLE = `LM Market Bot${TITLE_SUFFIX}`;
const APP_DISPLAY_NAME = WINDOW_TITLE;
const APP_USER_MODEL_ID = _profileName
  ? `com.aephia.lm-market-bot-${_profileName.toLowerCase()}`
  : 'com.aephia.lm-market-bot';

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

function getProfileKey(profileName) {
  const normalizedProfile = String(profileName || '').toUpperCase();
  if (normalizedProfile.includes('MUD')) return 'mud';
  if (normalizedProfile.includes('USTUR') || normalizedProfile.includes('UST')) return 'ustur';
  if (normalizedProfile.includes('ONI')) return 'oni';
  return '';
}

function getWindowIconPath() {
  const profileKey = getProfileKey(_profileName);
  if (profileKey) {
    return path.join(
      __dirname,
      'assets',
      process.platform === 'win32'
        ? `lm-market-bot-${profileKey}.ico`
        : `lm-market-bot-${profileKey}.png`,
    );
  }
  return path.join(
    __dirname,
    'assets',
    process.platform === 'win32' ? 'market_bot_icon.ico' : 'market_bot_icon.png',
  );
}

function isDedicatedProfileInstall() {
  if (!_profileName) return true;
  const appRootName = path.basename(getAppRoot()).toLowerCase();
  const profileSlug = _profileName.toLowerCase();
  return appRootName === `lm-market-bot-${profileSlug}`;
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

// Disable Chromium background throttling. LM Market Bot is a 24/7
// automation process and must remain responsive even when its window
// is covered, minimized, or otherwise inactive on Windows.
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

const { resolvePaths } = require('rpc_limiter');
const {
  readState: readRpcLimiterState,
  writeStateSync: writeRpcLimiterStateSync,
  bumpRevision: bumpRpcLimiterRevision,
} = require('rpc_limiter/dist/state');
const { LmMarketBot, buildBotConfig, getEditableConfigFromEnv, EDITABLE_CONFIG_KEYS } = require('../dist/bot');
const {
  isTrustedIpcEvent,
  validateAssetAndSide,
  validateAssetList,
  validateRedeemPayload,
  validateSettingsPayload,
} = require('./ipc-security-policy');
const {
  SENSITIVE_CONFIG_KEYS,
  getSensitiveConfigStatus,
  mergeSensitiveConfig,
  redactConfigForRenderer,
  splitSensitiveConfig,
} = require('./secret-storage-policy');
const {
  GM_MARKET_ASSET_REGISTRY,
  formatAssetRegistryResourceList,
  loadAssetRegistryForAephiaKey,
} = require('../dist/asset-registry');

let mainWindow = null;
let bot = null;
let botRunning = false;
const recentLogs = [];

function emitUpdateProgress(phase, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-progress', { phase, message });
  }
}

const AEPHIA_TOKEN_VALIDATE_URL = 'https://api.aephia.com/token/validate';
const AEPHIA_API_KEY_VALIDATION_BYPASS = false; // Re-enable Aephia token validation.
const GITHUB_REPO = 'aephiaviktor/lm-market-bot';
const GITHUB_MAIN_PACKAGE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json`;
const GITHUB_MAIN_ARCHIVE_URL = `https://github.com/${GITHUB_REPO}/archive/refs/heads/main.tar.gz`;
const RPC_LIMITER_UPDATED_BY = 'LM Market Bot';
console.error('[LmMarketBot] TITLE_SUFFIX =', JSON.stringify(TITLE_SUFFIX));
console.error('[LmMarketBot] APP_USER_MODEL_ID =', JSON.stringify(APP_USER_MODEL_ID));
console.error('[LmMarketBot] userData =', JSON.stringify(app.getPath('userData')));

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

function serializeCrashValue(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      code: value.code,
    };
  }
  if (value && typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }
  return value;
}

function logCrashEvent(type, details = {}) {
  const logPath = path.join(getAppRoot(), 'analysis', 'crash-events.jsonl');
  const event = {
    timestamp: new Date().toISOString(),
    app: APP_DISPLAY_NAME,
    appId: APP_USER_MODEL_ID,
    profile: _profileName || null,
    pid: process.pid,
    ppid: process.ppid,
    platform: process.platform,
    versions: {
      app: APP_VERSION,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    type,
    details: serializeCrashValue(details),
  };
  try {
    fsSync.mkdirSync(path.dirname(logPath), { recursive: true });
    fsSync.appendFileSync(logPath, `${JSON.stringify(event)}\n`, 'utf8');
  } catch (err) {
    console.error('[LmMarketBot] failed to write crash event:', err);
  }
  console.error('[LmMarketBot] crash event:', JSON.stringify({ type, details: event.details }));
}

function attachWindowCrashLogging(win) {
  if (!win || !win.webContents) return;
  win.webContents.on('render-process-gone', (_event, details) => {
    logCrashEvent('window-render-process-gone', {
      title: win.getTitle(),
      url: win.webContents.getURL(),
      details,
    });
  });
  win.webContents.on('unresponsive', () => {
    logCrashEvent('window-unresponsive', {
      title: win.getTitle(),
      url: win.webContents.getURL(),
    });
  });
}

function installCrashEventLogging() {
  process.on('uncaughtExceptionMonitor', (error) => {
    logCrashEvent('uncaughtExceptionMonitor', error);
  });
  process.on('unhandledRejection', (reason) => {
    logCrashEvent('unhandledRejection', reason);
  });
  process.on('exit', (code) => {
    logCrashEvent('process-exit', { code });
  });
  app.on('render-process-gone', (_event, webContents, details) => {
    logCrashEvent('app-render-process-gone', {
      id: webContents?.id,
      url: typeof webContents?.getURL === 'function' ? webContents.getURL() : '',
      details,
    });
  });
  app.on('child-process-gone', (_event, details) => {
    logCrashEvent('child-process-gone', details);
  });
  app.on('gpu-process-crashed', (_event, killed) => {
    logCrashEvent('gpu-process-crashed', { killed });
  });
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
  const remotePackage = await fetchGithubJson(`${GITHUB_MAIN_PACKAGE_URL}?t=${Date.now()}`);
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

async function sha256File(filePath) {
  const contents = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(contents).digest('hex');
}

async function launchWindowsTransactionalUpdater({ appRoot, stagedRoot, tempDir }) {
  const scriptPath = path.join(tempDir, 'finish-update.ps1');
  const launcherPath = path.join(tempDir, 'finish-update.vbs');
  const readyFile = path.join(tempDir, 'helper-ready');
  const script = buildWindowsTransactionalUpdateScript({
    appRoot,
    stagedRoot,
    parentPid: process.pid,
    taskName: `LM Market Bot ${_profileName}`,
    readyFile,
  });
  await fs.writeFile(scriptPath, script, 'utf8');
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  await fs.writeFile(launcherPath, buildWindowsUpdaterLauncher({ powershellPath: powershell, scriptPath }), 'utf8');
  const wscript = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
  const child = spawn(wscript, [launcherPath], {
    cwd: tempDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      await fs.access(readyFile);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('Windows update helper did not confirm startup; the current version is still running.');
}

async function downloadUpdateAndRestart() {
  if (!isDedicatedProfileInstall()) {
    throw new Error(
      `This ${APP_DISPLAY_NAME} instance is running from the shared app folder. ` +
        `Launch it from a dedicated folder named lm-market-bot-${_profileName} before updating.`,
    );
  }

  const latest = await getLatestGithubVersion();
  const currentVersion = await readPackageVersion();
  if (compareVersions(latest.version, currentVersion) <= 0) {
    return { updated: false, currentVersion, latestVersion: latest.version };
  }

  const appRoot = getAppRoot();
  const tempDir = await fs.mkdtemp(path.join(path.dirname(appRoot), '.lm-market-bot-update-'));
  const archivePath = path.join(tempDir, `${latest.branch || 'main'}.tar.gz`);
  emitUpdateProgress('downloading', `Downloading LM Market Bot v${latest.version}...`);
  await downloadFile(latest.tarballUrl, archivePath);
  const archiveSha256 = await sha256File(archivePath);
  emitUpdateProgress('extracting', 'Extracting and validating the downloaded release...');
  await runCommand('tar', ['-xzf', archivePath, '-C', tempDir], { cwd: tempDir });

  const entries = await fs.readdir(tempDir, { withFileTypes: true });
  const extracted = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('lm-market-bot-'));
  if (!extracted) throw new Error('Downloaded update archive did not contain the expected project folder.');

  const stagedRoot = path.join(tempDir, extracted.name);
  const stagedPackage = JSON.parse(await fs.readFile(path.join(stagedRoot, 'package.json'), 'utf8'));
  if (normalizeVersion(stagedPackage.version) !== normalizeVersion(latest.version)) {
    throw new Error(`Staged release version ${stagedPackage.version || 'unknown'} does not match ${latest.version}.`);
  }

  emitUpdateProgress('dependencies', 'Installing update dependencies — this can take several minutes...');
  await runCommand('npm', ['install', '--include=dev', '--no-audit', '--no-fund'], { cwd: stagedRoot });
  emitUpdateProgress('runtime', 'Validating the Electron runtime...');
  await runCommand('npm', ['run', 'ensure-electron-runtime'], { cwd: stagedRoot });
  emitUpdateProgress('building', 'Building and validating the updated application...');
  await runCommand('npm', ['run', 'build'], { cwd: stagedRoot });
  await fs.access(path.join(stagedRoot, 'dist'));
  if (process.platform === 'win32') {
    await fs.access(path.join(stagedRoot, 'node_modules', 'electron', 'dist', 'electron.exe'));
  }
  await fs.writeFile(path.join(stagedRoot, '.update-release.json'), JSON.stringify({
    version: latest.version,
    branch: latest.branch,
    archiveSha256,
    stagedAt: new Date().toISOString(),
  }, null, 2));

  if (botRunning) await stopBot();
  if (process.platform !== 'win32') throw new Error('Transactional in-app updates are supported only on Windows.');
  emitUpdateProgress('restarting', 'Update staged successfully. Restarting LM Market Bot...');
  await launchWindowsTransactionalUpdater({ appRoot, stagedRoot, tempDir });
  setTimeout(() => app.exit(0), 750);
  return { updated: true, currentVersion, latestVersion: latest.version, staged: true };
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

function getSettingsBackupPath() {
  return path.join(app.getPath('userData'), 'settings.previous.json');
}

function getSecretsPath() {
  return path.join(app.getPath('userData'), 'secrets.json');
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

function assertSecretEncryptionAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable on this system. Settings were not changed.');
  }
}

async function loadSecretSettings() {
  try {
    const parsed = JSON.parse(await fs.readFile(getSecretsPath(), 'utf8'));
    const secrets = {};
    for (const key of SENSITIVE_CONFIG_KEYS) {
      const encrypted = String(parsed?.[key] || '');
      secrets[key] = encrypted ? safeStorage.decryptString(Buffer.from(encrypted, 'base64')) : '';
    }
    return secrets;
  } catch (err) {
    if (err?.code === 'ENOENT') return {};
    throw new Error(`Secure settings could not be read: ${err?.message || String(err)}`);
  }
}

async function saveSecretSettings(secrets) {
  assertSecretEncryptionAvailable();
  const encrypted = {};
  for (const key of SENSITIVE_CONFIG_KEYS) {
    const value = String(secrets?.[key] ?? '');
    encrypted[key] = value ? safeStorage.encryptString(value).toString('base64') : '';
  }
  await writeJsonAtomic(getSecretsPath(), encrypted);
}

function normalizeAssetRules(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map((row) => {
    const isStrategyRow = ['minQuantity', 'maxQuantity', 'minBuyPrice', 'maxBuyPrice', 'minSellPrice', 'maxSellPrice']
      .some((field) => Object.prototype.hasOwnProperty.call(row || {}, field));
    const side = row?.side === 'buy' ? 'buy' : 'sell';
    const quantity = String(row?.quantity ?? '');
    const limit = String(row?.limit ?? '');
    const price = String(row?.price ?? '');

    return {
      starbase: String(row?.starbase ?? ''),
      asset: String(row?.asset ?? ''),
      side,
      quantity,
      limit,
      price,
      group: String(row?.group ?? ''),
      enabled: row?.enabled !== undefined
        ? row.enabled !== false && row.enabled !== 'false'
        : row?.refill !== false && row?.refill !== 'false',
      minQuantity: String(row?.minQuantity ?? (isStrategyRow ? '' : side === 'sell' ? quantity : '1')).replace(/[^\d-]/g, ''),
      maxQuantity: String(row?.maxQuantity ?? (isStrategyRow ? '' : limit || quantity)).replace(/[^\d-]/g, ''),
      minBuyPrice: String(row?.minBuyPrice ?? ''),
      maxBuyPrice: String(row?.maxBuyPrice ?? (isStrategyRow ? '' : side === 'buy' ? price : '')),
      minSellPrice: String(row?.minSellPrice ?? (isStrategyRow ? '' : side === 'sell' ? price : '')),
      maxSellPrice: String(row?.maxSellPrice ?? ''),
    };
  });
}

function parseBooleanSetting(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getRpcLimiterPaths() {
  return resolvePaths();
}

function buildProviderUrl(p) {
  const base = String(p?.rpcBaseUrl || '').trim();
  const apiKey = String(p?.apiKey || '').trim();
  if (!base) return '';
  if (!apiKey) return base;
  try {
    const url = new URL(base);
    url.searchParams.set('api-key', apiKey);
    return url.toString();
  } catch {
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}api-key=${encodeURIComponent(apiKey)}`;
  }
}

function getRpcLimiterStatus() {
  const paths = getRpcLimiterPaths();
  const state = readRpcLimiterState(paths.stateFile, Date.now());
  // Migration: pre-multi-provider state files stored rpcBaseUrl / apiKey
  // at the top level. Copy them into state.providers.main in memory so
  // existing configurations keep working without re-sending settings.
  if (!state.providers || (!state.providers.main?.rpcBaseUrl && !state.providers.fallback?.rpcBaseUrl)) {
    const legacyBase = String(state.rpcBaseUrl || '').trim();
    if (legacyBase) {
      state.providers = {
        main: { rpcBaseUrl: legacyBase, apiKey: String(state.apiKey || '').trim() },
        fallback: {},
      };
    }
  }
  const now = Date.now();
  const providers = state.providers || { main: {}, fallback: {} };
  const inCooldown = (p) => Boolean(p?.cooldownUntilMs && p.cooldownUntilMs > now);
  const available = (p) => Boolean(p?.rpcBaseUrl) && !inCooldown(p);

  const mainAvail = available(providers.main);
  const fallbackAvail = available(providers.fallback);
  let activeProvider = null;
  if (mainAvail && !fallbackAvail) activeProvider = 'main';
  else if (!mainAvail && fallbackAvail) activeProvider = 'fallback';

  return {
    path: paths.stateFile,
    enabled: Boolean(state.enabled),
    providers: {
      main: {
        url: buildProviderUrl(providers.main),
        cooldown: inCooldown(providers.main),
        cooldownUntil: providers.main?.cooldownUntilMs || null,
        failures: providers.main?.failures || 0,
      },
      fallback: {
        url: buildProviderUrl(providers.fallback),
        cooldown: inCooldown(providers.fallback),
        cooldownUntil: providers.fallback?.cooldownUntilMs || null,
        failures: providers.fallback?.failures || 0,
      },
    },
    activeProvider,
    buckets: state.buckets || {},
    updatedBy: state.updatedBy || '',
    updatedAt: state.updatedAt || '',
    revision: state.revision ?? 0,
  };
}

function parseRpcUrlForLimiter(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) {
    throw new Error('RPC URL is empty.');
  }

  const url = new URL(raw);
  const apiKey = url.searchParams.get('api-key') || '';
  url.searchParams.delete('api-key');
  const remainingQuery = url.searchParams.toString();
  const pathname = url.pathname === '/' ? '' : url.pathname;
  const rpcBaseUrl = `${url.origin}${pathname}${remainingQuery ? `?${remainingQuery}` : ''}`;

  return { rpcBaseUrl, apiKey };
}

function parsePositiveRate(value, fieldName) {
  const parsed = Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }
  return parsed;
}

async function withRpcLimiterLock(fn) {
  const paths = getRpcLimiterPaths();
  fsSync.mkdirSync(path.dirname(paths.lockfile), { recursive: true });
  if (!fsSync.existsSync(paths.lockfile)) {
    fsSync.writeFileSync(paths.lockfile, '');
  }

  const release = await lockfile.lock(paths.lockfile, {
    stale: 5000,
    retries: { retries: 50, minTimeout: 5, maxTimeout: 50, factor: 1.2 },
    realpath: false,
  });
  try {
    return fn(paths);
  } finally {
    await release().catch(() => undefined);
  }
}

async function sendSettingsToRpcLimiter(config) {
  const { rpcBaseUrl, apiKey } = parseRpcUrlForLimiter(config.RPC_URL);
  // The Main vs Fallback checkbox: unchecked (default) writes to 'main';
  // checked writes to 'fallback'. The user assigns the URL they just
  // pasted to one of the two provider slots.
  const role = parseBooleanSetting(config.RPC_LIMITER_PROVIDER_ROLE) ? 'fallback' : 'main';
  const rpcRequestsPerSecond = parsePositiveRate(config.RPC_REQUESTS_PER_SECOND, 'Requests / sec');
  const txPerSecond = parsePositiveRate(config.RPC_TX_SEND_RATE_LIMIT_PER_SECOND, 'sendTransaction / sec');
  const rpcIntervalMs = Math.max(1, Math.round(1000 / rpcRequestsPerSecond));
  const txIntervalMs = Math.max(1, Math.round(1000 / txPerSecond));

  await withRpcLimiterLock((paths) => {
    const state = readRpcLimiterState(paths.stateFile, Date.now());
    state.enabled = true;
    state.providers = state.providers || { main: {}, fallback: {} };
    state.providers[role] = {
      ...(state.providers[role] || {}),
      rpcBaseUrl,
      apiKey,
      // Reset health metrics on re-configuration.
      failures: 0,
      cooldownUntilMs: null,
    };
    state.buckets = state.buckets || {};
    state.buckets['rpc:shared'] = {
      ...(state.buckets['rpc:shared'] || { nextSlotMs: 0 }),
      intervalMs: rpcIntervalMs,
    };
    state.buckets['tx:shared'] = {
      ...(state.buckets['tx:shared'] || { nextSlotMs: 0 }),
      intervalMs: txIntervalMs,
    };
    state.updatedBy = RPC_LIMITER_UPDATED_BY;
    state.updatedAt = new Date().toISOString();
    bumpRpcLimiterRevision(state);
    writeRpcLimiterStateSync(paths.stateFile, state);
  });

  return getRpcLimiterStatus();
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
    const { publicConfig, sensitiveConfig: legacySecrets } = splitSensitiveConfig(parsed);
    const storedSecrets = await loadSecretSettings();
    const migratedSecrets = mergeSensitiveConfig(storedSecrets, legacySecrets);
    const hasLegacySecrets = SENSITIVE_CONFIG_KEYS.some((key) => String(legacySecrets[key] || '').trim());
    if (hasLegacySecrets) {
      await saveSecretSettings(migratedSecrets);
      await writeJsonAtomic(getSettingsPath(), publicConfig);
    }
    return { ...publicConfig, ...migratedSecrets };
  } catch (err) {
    if (err?.code === 'ENOENT') return { ...(await loadSecretSettings()) };
    throw err;
  }
}

async function saveLocalSettings(payload) {
  const current = await loadLocalSettings();
  const filtered = {};
  const sourceConfig = payload?.config && typeof payload.config === 'object' ? payload.config : payload;
  const submittedSecrets = {};

  for (const key of EDITABLE_CONFIG_KEYS) {
    if (SENSITIVE_CONFIG_KEYS.includes(key)) {
      submittedSecrets[key] = sourceConfig?.[key];
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(sourceConfig || {}, key)) {
      filtered[key] = String(sourceConfig[key] ?? '');
    } else if (Object.prototype.hasOwnProperty.call(current, key)) {
      filtered[key] = current[key];
    }
  }

  filtered.ASSET_RULE_ROWS = normalizeAssetRules(payload?.assetRules ?? current.ASSET_RULE_ROWS ?? []);
  const secrets = mergeSensitiveConfig(current, submittedSecrets);
  await saveSecretSettings(secrets);

  const settingsPath = getSettingsPath();
  try {
    await fs.copyFile(settingsPath, getSettingsBackupPath());
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      throw err;
    }
  }
  await writeJsonAtomic(settingsPath, filtered);
  return { ...filtered, ...secrets };
}

async function resolveSubmittedConfig(payload) {
  const effective = await getEffectiveEditableConfig();
  const source = payload?.config && typeof payload.config === 'object' ? payload.config : payload;
  return {
    ...effective,
    ...(source || {}),
    ...mergeSensitiveConfig(effective, source || {}),
  };
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
  const useRpcLimiter = parseBooleanSetting(editable.USE_RPC_LIMITER);
  const botConfig = { ...editable };

  if (useRpcLimiter) {
    const rpcLimiter = getRpcLimiterStatus();
    const mainUrl = rpcLimiter.providers?.main?.url;
    const fallbackUrl = rpcLimiter.providers?.fallback?.url;
    if (!mainUrl && !fallbackUrl) {
      throw new Error('Use RPC Limiter is enabled, but no RPC Limiter URLs are configured. Send settings to RPC Limiter first.');
    }
    // Main becomes the bot's primary URL, fallback becomes the per-call
    // failover target. If only one slot is configured, the other stays unset
    // and the bot falls back to its own (non-limiter) behaviour.
    if (mainUrl) botConfig.RPC_URL = mainUrl;
    if (fallbackUrl) botConfig.RPC_URL_FALLBACK = fallbackUrl;
  }

  return {
    ...botConfig,
    assetRules: normalizeAssetRules(localSettings.ASSET_RULE_ROWS ?? []),
  };
}

function getEmptyStatusSnapshot() {
  return {
    version: APP_VERSION,
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
    certificates: [],
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
  const iconPath = getWindowIconPath();
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    title: WINDOW_TITLE,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--lm-market-bot-version=${APP_VERSION}`],
      backgroundThrottling: false,
    },
  });

  if (typeof mainWindow.setIcon === 'function') {
    mainWindow.setIcon(iconPath);
  }
  attachWindowCrashLogging(mainWindow);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  // Keep the instance suffix even when renderer.html's <title> fires a
  // page-title-updated event after load.
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle(WINDOW_TITLE);
  });
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.setTitle(WINDOW_TITLE);
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

installCrashEventLogging();

function handleTrusted(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedIpcEvent(event, mainWindow?.webContents)) {
      throw new Error(`Rejected untrusted IPC request: ${channel}`);
    }
    return await handler(event, ...args);
  });
}

handleTrusted('logs:get', async () => recentLogs);

handleTrusted('settings:get', async () => {
  const config = await getEffectiveEditableConfig();
  const localSettings = await loadLocalSettings();
  return {
    config: redactConfigForRenderer(config),
    secureSettingsStatus: getSensitiveConfigStatus(config),
    running: botRunning,
    assetRules: normalizeAssetRules(localSettings.ASSET_RULE_ROWS ?? []),
    rpcLimiter: getRpcLimiterStatus(),
  };
});

handleTrusted('settings:save', async (_event, payload) => {
  const validated = validateSettingsPayload(payload, EDITABLE_CONFIG_KEYS);
  const saved = await saveLocalSettings(validated);
  const config = await getEffectiveEditableConfig();
  return {
    config: redactConfigForRenderer(config),
    secureSettingsStatus: getSensitiveConfigStatus(config),
    assetRules: normalizeAssetRules(saved.ASSET_RULE_ROWS),
    rpcLimiter: getRpcLimiterStatus(),
  };
});

handleTrusted('rpc-limiter:send-settings', async (_event, payload) => {
  const validated = validateSettingsPayload(payload, EDITABLE_CONFIG_KEYS, { allowAssetRules: false });
  const sourceConfig = await resolveSubmittedConfig(validated);
  return await sendSettingsToRpcLimiter(sourceConfig || {});
});

handleTrusted('rpc-limiter:get-status', async () => getRpcLimiterStatus());

handleTrusted('settings:derive-hot-wallet', async (_event, secret) => {
  try {
    return { ok: true, address: getHotWalletAddressFromSecret(secret) };
  } catch (err) {
    return { ok: false, address: '', error: err?.message || String(err) };
  }
});

handleTrusted('bot:start', async () => {
  await startBotFromSettings();
  return { running: botRunning };
});

handleTrusted('bot:stop', async () => {
  await stopBot();
  return { running: botRunning };
});

handleTrusted('bot:apply-running-settings', async (_event, payload) => {
  if (!bot || !botRunning) {
    return { ok: false, status: 'bot_not_running' };
  }

  const newConfig = await applyRunningSettingsToBot();
  const requestedAssets = validateAssetList(payload?.assets ?? []);

  if (!requestedAssets.length) {
    return { ok: true, status: 'config_applied', assets: [] };
  }

  return rerunAssetGroups(newConfig, requestedAssets);
});

handleTrusted('bot:cancel-order', async (_event, payload) => {
  const { asset, starbase, side } = validateAssetAndSide(payload);

  if (!bot || !botRunning) {
    logger.warn(`Cancel order requested for ${asset} [${side}] but bot is not running`);
    return { ok: false, status: 'bot_not_running', asset, side };
  }

  try {
    return await bot.cancelActiveOrderForRule(asset, starbase, side);
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

handleTrusted('bot:rerun-assets', async (_event, assets) => {
  if (!bot || !botRunning) {
    return { ok: false, status: 'bot_not_running' };
  }

  const newConfig = await applyRunningSettingsToBot();
  return rerunAssetGroups(newConfig, validateAssetList(assets));
});

handleTrusted('bot:redeem-certificate', async (_event, payload) => {
  const { asset, starbase } = validateRedeemPayload(payload);

  if (!bot || !botRunning) {
    logger.warn(`Redeem certificate requested for ${asset} at ${starbase || 'any starbase'} but bot is not running`);
    return { ok: false, status: 'bot_not_running', asset, starbase };
  }

  try {
    return await bot.redeemCertificateForRule(asset, starbase);
  } catch (err) {
    logger.error(`Redeem certificate failed for ${asset} at ${starbase || 'any starbase'}:`, err);
    return {
      ok: false,
      status: 'error',
      asset,
      starbase,
      message: err?.message || String(err),
    };
  }
});

handleTrusted('crew-deposit:status', async () => {
  if (!bot || !botRunning) {
    return {
      ok: true,
      ready: false,
      status: 'bot_not_running',
      batchSize: 6,
      availableCrew: null,
      message: 'Start the bot before depositing crew.',
    };
  }

  try {
    return await bot.getCrewDepositStatus();
  } catch (err) {
    logger.error('Crew deposit status failed:', err);
    return {
      ok: false,
      ready: false,
      status: 'error',
      batchSize: 6,
      availableCrew: null,
      message: err?.message || String(err),
    };
  }
});

handleTrusted('crew-deposit:run', async (_event, payload) => {
  const count = Math.max(0, Math.floor(Number(payload?.count) || 0));
  const batchSize = Math.max(1, Math.floor(Number(payload?.batchSize) || 6));

  if (!bot || !botRunning) {
    return {
      ok: false,
      status: 'bot_not_running',
      count,
      batchSize,
      message: 'Start the bot before depositing crew.',
    };
  }

  try {
    return await bot.depositCrewToGame(count, batchSize);
  } catch (err) {
    logger.error('Crew deposit failed:', err);
    return {
      ok: false,
      status: 'error',
      count,
      batchSize,
      message: err?.message || String(err),
    };
  }
});

handleTrusted('bot:status', async () => {
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

handleTrusted('updates:check', async () => {
  return await checkForUpdates();
});

handleTrusted('updates:download-and-restart', async () => {
  return await downloadUpdateAndRestart();
});

app.whenReady().then(async () => {
  const powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension')
  console.log(`[LM] prevent-app-suspension blocker=${powerSaveBlockerId} active=${powerSaveBlocker.isStarted(powerSaveBlockerId)}`)

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
