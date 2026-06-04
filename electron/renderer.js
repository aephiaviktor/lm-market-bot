const fields = [
  'FACTION',
  'AEPHIA_API_KEY',
  'RPC_URL',
  'HOT_WALLET_SECRET',
  'OWNER_WALLET',
  'OWNER_PROFILE',
  'RPC_REQUESTS_PER_SECOND',
  'RPC_TX_SEND_RATE_LIMIT_PER_SECOND',
  'CHAIN_STATUS_REFRESH_INTERVAL_MINUTES',
  'CHECK_INTERVAL_MINUTES',
  'RELEVANT_BUY_ORDER_PCT',
  'RELEVANT_SELL_ORDER_PCT',
];

const STATUS_POLL_MS = 60000;
const AUTO_RERUN_COOLDOWN_MS = 120000;
const APP_VERSION = '0.2.14';
const FULL_RESTART_CONFIG_KEYS = new Set([
  'AEPHIA_API_KEY',
  'FACTION',
  'OWNER_WALLET',
  'OWNER_PROFILE',
  'RPC_URL',
  'RPC_URL_FALLBACK',
  'HOT_WALLET_SECRET',
  'RESOURCE_LIST',
]);
const RERUN_ALL_ASSETS_CONFIG_KEYS = new Set([
  'MIN_SELL_QUANTITY',
  'MIN_PRICE',
  'RELEVANT_SELL_ORDER_PCT',
  'RELEVANT_BUY_ORDER_PCT',
]);

const form = document.getElementById('config-form');
const logsEl = document.getElementById('logs');
const saveBtn = document.getElementById('save-btn');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const updateBtn = document.getElementById('update-btn');
const updateModal = document.getElementById('update-modal');
const updateCurrentVersionEl = document.getElementById('update-current-version');
const updateLatestVersionEl = document.getElementById('update-latest-version');
const updateMessageEl = document.getElementById('update-message');
const updateConfirmBtn = document.getElementById('update-confirm-btn');
const updateCancelBtn = document.getElementById('update-cancel-btn');
const addRuleRowBtn = document.getElementById('add-rule-row-btn');
const toggleSensitiveBtn = document.getElementById('toggle-sensitive-btn');
const assetRulesBody = document.getElementById('asset-rules-body');
const displayHotWalletAddress = document.getElementById('display-hot-wallet-address');
const displayManagedWallet = document.getElementById('display-managed-wallet');
const displayPlayerProfile = document.getElementById('display-player-profile');
let assetRegistryResourceList = '';
const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
const assetRuleTabButtons = Array.from(document.querySelectorAll('.asset-rule-tab'));

const runningPillEl = document.getElementById('running-pill');
const walletAddressEl = document.getElementById('wallet-address');
const solBalanceEl = document.getElementById('sol-balance');
const atlasBalanceEl = document.getElementById('atlas-balance');
const usdcBalanceEl = document.getElementById('usdc-balance');
const botRuntimeEl = document.getElementById('bot-runtime');
const lastCycleAtEl = document.getElementById('last-cycle-at');
const nextCycleInEl = document.getElementById('next-cycle-in');

const openOrdersCountEl = document.getElementById('open-orders-count');
const openOrdersListEl = document.getElementById('open-orders-list');
const inventoryCountEl = document.getElementById('inventory-count');
const inventoryListEl = document.getElementById('inventory-list');
const certificatesCountEl = document.getElementById('certificates-count');
const certificatesListEl = document.getElementById('certificates-list');
const recentActivityCountEl = document.getElementById('recent-activity-count');
const recentActivityListEl = document.getElementById('recent-activity-list');

let sensitiveVisible = false;
let assetRuleRows = [];
let statusPollHandle = null;
let lastSavedConfig = null;
let lastSavedAssetRules = [];
let lastUiRefreshAtMs = null;
let lastUpdateCheckCycleCompletedAt = null;
let previousAssetSignals = new Map();
const assetLastRerunAtMs = new Map();
let rerunInFlight = false;
let activeAssetRuleGroup = 'raw';
let availableUpdate = null;
let updateCheckInFlight = false;
let updateCheckPromise = null;

const RAW_MATERIAL_START = 'Arco';
const RAW_MATERIAL_END = 'Titanium Ore';
const COMPONENT_START = 'Ammo';
const COMPONENT_END = 'Toolkits';
const ASSET_RULE_GROUPS = new Set(['raw', 'components']);
const STARBASES_BY_FACTION = {
  MUD: ['MUD-1', 'MUD-2', 'MUD-3', 'MUD-4', 'MUD-5', 'MRZ-1', 'MRZ-2', 'MRZ-3', 'MRZ-4', 'MRZ-5', 'MRZ-6', 'MRZ-7', 'MRZ-8', 'MRZ-9', 'MRZ-10', 'MRZ-11', 'MRZ-12'],
  ONI: ['ONI-1', 'ONI-2', 'ONI-3', 'ONI-4', 'ONI-5', 'MRZ-13', 'MRZ-14', 'MRZ-18', 'MRZ-19', 'MRZ-20', 'MRZ-24', 'MRZ-25', 'MRZ-26', 'MRZ-29', 'MRZ-30', 'MRZ-31', 'MRZ-36'],
  USTUR: ['UST-1', 'UST-2', 'UST-3', 'UST-4', 'UST-5', 'MRZ-15', 'MRZ-16', 'MRZ-17', 'MRZ-21', 'MRZ-22', 'MRZ-23', 'MRZ-27', 'MRZ-28', 'MRZ-32', 'MRZ-33', 'MRZ-34', 'MRZ-35'],
};

function shortKey(value) {
  const text = String(value ?? '').trim();
  return text.length > 14 ? `${text.slice(0, 6)}...${text.slice(-6)}` : text;
}

function setDisplayKey(element, value) {
  const text = String(value ?? '').trim();
  element.textContent = text ? shortKey(text) : '—';
  element.title = text;
}

function setRunning(running) {
  startBtn.disabled = running;
  stopBtn.disabled = !running;

  runningPillEl.textContent = running ? 'Running' : 'Stopped';
  runningPillEl.classList.toggle('running', running);
  runningPillEl.classList.toggle('stopped', !running);
}

function setUpdateModalOpen(open) {
  updateModal.hidden = !open;
}

function renderUpdateButtonState(result, error = null) {
  const updateAvailable = Boolean(result?.updateAvailable);
  updateBtn.classList.toggle('update-available', updateAvailable);
  updateBtn.title = updateAvailable
    ? `Update available: v${result.latestVersion}`
    : error
      ? 'Update check failed'
      : 'Check for updates';
}

function renderUpdateModalState(result, error = null) {
  updateCurrentVersionEl.textContent = `v${result?.currentVersion || APP_VERSION}`;
  updateLatestVersionEl.textContent = result?.latestVersion ? `v${result.latestVersion}` : 'Unknown';
  updateConfirmBtn.disabled = !result?.updateAvailable;

  if (error) {
    updateLatestVersionEl.textContent = 'Unavailable';
    updateMessageEl.textContent = `Update check failed: ${error?.message || String(error)}`;
    return;
  }

  if (result?.updateAvailable) {
    updateMessageEl.textContent = `A newer LM Market Bot version is available on GitHub.`;
    updateConfirmBtn.textContent = `Update to v${result.latestVersion}`;
    return;
  }

  updateMessageEl.textContent = 'LM Market Bot is already up to date.';
  updateConfirmBtn.textContent = 'Update';
}

async function openUpdateDialog() {
  const cachedUpdate = availableUpdate;
  if (!cachedUpdate?.updateAvailable) {
    availableUpdate = null;
  }
  updateCurrentVersionEl.textContent = `v${APP_VERSION}`;
  updateLatestVersionEl.textContent = cachedUpdate?.latestVersion ? `v${cachedUpdate.latestVersion}` : 'Checking...';
  updateMessageEl.textContent = cachedUpdate?.updateAvailable
    ? 'A newer LM Market Bot version is available on GitHub.'
    : 'Checking GitHub for the latest version...';
  updateConfirmBtn.textContent = 'Update';
  updateConfirmBtn.disabled = true;
  updateCancelBtn.disabled = false;
  setUpdateModalOpen(true);

  try {
    availableUpdate = await checkForUpdatesAndRenderButton();
    renderUpdateModalState(availableUpdate);
  } catch (err) {
    availableUpdate = null;
    renderUpdateModalState(null, err);
    appendLog(`[${new Date().toISOString()}] [ERROR] Update check failed: ${err?.message || String(err)}`);
  }
}

async function checkForUpdatesAndRenderButton() {
  if (updateCheckInFlight) {
    return updateCheckPromise || availableUpdate;
  }

  updateCheckInFlight = true;
  updateCheckPromise = window.botApi.checkForUpdates();
  try {
    const result = await updateCheckPromise;
    availableUpdate = result;
    renderUpdateButtonState(result);
    return result;
  } catch (err) {
    renderUpdateButtonState(null, err);
    throw err;
  } finally {
    updateCheckInFlight = false;
    updateCheckPromise = null;
  }
}

function maybeCheckForUpdatesAfterCycle(snapshot) {
  const completedAt = snapshot?.lastCycleCompletedAt || null;
  if (!completedAt || completedAt === lastUpdateCheckCycleCompletedAt) {
    return;
  }

  lastUpdateCheckCycleCompletedAt = completedAt;
  void checkForUpdatesAndRenderButton().catch((err) => {
    appendLog(`[${new Date().toISOString()}] [WARN] Update check failed: ${err?.message || String(err)}`);
  });
}

function setSensitiveVisible(visible) {
  sensitiveVisible = visible;
  form.classList.toggle('sensitive-hidden', !visible);
  toggleSensitiveBtn.textContent = visible ? 'Hide Sensitive Fields' : 'Show Sensitive Fields';
}

function setActiveTab(tabName) {
  const nextTab = tabName === 'setup' ? 'setup' : 'asset-rules';
  for (const button of tabButtons) {
    button.classList.toggle('active', nextTab === 'setup');
    button.setAttribute('aria-selected', String(nextTab === 'setup'));
    if (button.id === 'tab-setup') {
      button.textContent = nextTab === 'setup' ? 'Asset Rules' : 'Settings';
      button.dataset.tab = nextTab === 'setup' ? 'asset-rules' : 'setup';
    }
  }

  for (const panel of tabPanels) {
    panel.classList.toggle('active', panel.dataset.panel === nextTab);
  }
}

function parseResources(rawValue) {
  return String(rawValue ?? '')
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, mint] = entry.split(':').map((part) => part.trim());
      return {
        value: name ? `${name}:${mint ?? ''}` : entry,
        label: name || entry,
      };
    })
    .filter((entry) => entry.value && entry.label);
}

function getAllResourceOptions() {
  return parseResources(assetRegistryResourceList);
}

function getAssetLabel(asset) {
  return getAllResourceOptions().find((option) => option.value === asset)?.label ?? '';
}

function sliceOptionsByNameRange(options, startName, endName) {
  const startIndex = options.findIndex((option) => option.label === startName);
  const endIndex = options.findIndex((option) => option.label === endName);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return [];
  }
  return options.slice(startIndex, endIndex + 1);
}

function getResourceOptions(group = activeAssetRuleGroup) {
  const options = getAllResourceOptions();
  if (group === 'components') {
    return sliceOptionsByNameRange(options, COMPONENT_START, COMPONENT_END);
  }
  return sliceOptionsByNameRange(options, RAW_MATERIAL_START, RAW_MATERIAL_END);
}

function getAssetRuleGroupForAsset(asset) {
  const components = new Set(getResourceOptions('components').map((option) => option.value));
  if (components.has(asset)) {
    return 'components';
  }
  return 'raw';
}

function getSelectedFaction() {
  const value = String(form?.elements?.namedItem('FACTION')?.value ?? '').trim();
  return Object.prototype.hasOwnProperty.call(STARBASES_BY_FACTION, value) ? value : 'ONI';
}

function normalizeStarbaseValue(value) {
  return String(value ?? '').trim().replace(/_/g, '-').toUpperCase();
}

function getStarbaseOptionsForFaction(faction = getSelectedFaction()) {
  return STARBASES_BY_FACTION[faction] ?? STARBASES_BY_FACTION.ONI;
}

function getStarbaseRank(starbase, faction = getSelectedFaction()) {
  const normalized = normalizeStarbaseValue(starbase);
  const list = getStarbaseOptionsForFaction(faction);
  const index = list.indexOf(normalized);
  if (index >= 0) {
    return index;
  }

  const match = normalized.match(/^([A-Z]+)-(\d+)$/);
  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }

  const [, prefix, rawNumber] = match;
  const zoneRank = prefix === faction || (faction === 'USTUR' && prefix === 'UST') ? 1000 : prefix === 'MRZ' ? 2000 : 3000;
  return zoneRank + Number(rawNumber);
}

function compareStarbaseLabels(a, b) {
  const rankA = getStarbaseRank(a);
  const rankB = getStarbaseRank(b);
  if (rankA !== rankB) {
    return rankA - rankB;
  }
  return normalizeStarbaseValue(a).localeCompare(normalizeStarbaseValue(b), undefined, { numeric: true });
}

function getAssetRuleGroupForRow(row) {
  const group = String(row?.group ?? '').trim();
  if (ASSET_RULE_GROUPS.has(group)) {
    return group;
  }
  return getAssetRuleGroupForAsset(row?.asset);
}

function buildDefaultAssetRuleRows(group = null) {
  return [];
}

function ensureAssetRuleRows() {
  assetRuleRows = normalizeAssetRuleRows(assetRuleRows);
}

function syncRowsWithResources() {
  assetRuleRows = normalizeAssetRuleRows(assetRuleRows);
}

function normalizeAssetRuleRows(rows) {
  const starbaseOptions = getStarbaseOptionsForFaction();
  const validStarbases = new Set(starbaseOptions);
  const fallbackStarbase = starbaseOptions[0] ?? '';

  return (Array.isArray(rows) ? rows : []).map((row) => {
    const group = getAssetRuleGroupForRow(row);
    const groupOptions = getResourceOptions(group);
    const validValues = new Set(groupOptions.map((option) => option.value));
    const asset = String(row?.asset ?? '').trim();
    const starbase = normalizeStarbaseValue(row?.starbase);
    const normalizedStarbase = validStarbases.has(starbase) ? starbase : fallbackStarbase;
    const isStrategyRow = ['minQuantity', 'maxQuantity', 'minBuyPrice', 'maxBuyPrice', 'minSellPrice', 'maxSellPrice']
      .some((field) => Object.prototype.hasOwnProperty.call(row || {}, field));
    const legacySide = row?.side === 'buy' ? 'buy' : 'sell';
    const legacyQuantity = String(row?.quantity ?? '').trim();
    const legacyLimit = String(row?.limit ?? '').trim();
    const legacyPrice = String(row?.price ?? '').trim();
    const normalized = {
      starbase: normalizedStarbase,
      group,
      asset: validValues.has(asset) ? asset : '',
      refill: row?.refill === false || row?.refill === 'false' ? false : true,
      minQuantity: String(row?.minQuantity ?? (isStrategyRow ? '' : legacySide === 'sell' ? legacyQuantity : '1')).trim(),
      maxQuantity: String(row?.maxQuantity ?? (isStrategyRow ? '' : legacyLimit || legacyQuantity)).trim(),
      minBuyPrice: String(row?.minBuyPrice ?? (isStrategyRow ? '' : legacySide === 'buy' ? '' : '')).trim(),
      maxBuyPrice: String(row?.maxBuyPrice ?? (isStrategyRow ? '' : legacySide === 'buy' ? legacyPrice : '')).trim(),
      minSellPrice: String(row?.minSellPrice ?? (isStrategyRow ? '' : legacySide === 'sell' ? legacyPrice : '')).trim(),
      maxSellPrice: String(row?.maxSellPrice ?? '').trim(),
    };

    if (validValues.has(asset)) {
      return normalized;
    }

    return normalized;
  });
}

function renderAssetRuleRows() {
  syncRowsWithResources();
  const allOptions = getAllResourceOptions();
  const options = getResourceOptions(activeAssetRuleGroup);
  const starbaseOptions = getStarbaseOptionsForFaction();
  const visibleRows = assetRuleRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => getAssetRuleGroupForRow(row) === activeAssetRuleGroup)
    .sort((a, b) => {
      const starbaseComparison = compareStarbaseLabels(a.row.starbase, b.row.starbase);
      if (starbaseComparison !== 0) {
        return starbaseComparison;
      }
      const assetA = getAssetLabel(a.row.asset) || a.row.asset || '';
      const assetB = getAssetLabel(b.row.asset) || b.row.asset || '';
      return assetA.localeCompare(assetB, undefined, { numeric: true });
    });

  assetRulesBody.innerHTML = '';
  addRuleRowBtn.disabled = options.length === 0 || starbaseOptions.length === 0;
  const emptyColspan = 10;

  if (!allOptions.length) {
    assetRulesBody.innerHTML = `<tr><td colspan="${emptyColspan}" class="empty-state">Asset registry unavailable. Save a valid Aephia API Key in Settings to load the managed asset list.</td></tr>`;
    return;
  }

  if (!options.length) {
    assetRulesBody.innerHTML = `<tr><td colspan="${emptyColspan}" class="empty-state">No assets available for this group.</td></tr>`;
    return;
  }

  if (!starbaseOptions.length) {
    assetRulesBody.innerHTML = `<tr><td colspan="${emptyColspan}" class="empty-state">No starbases configured for this faction.</td></tr>`;
    return;
  }

  if (!visibleRows.length) {
    const groupLabel = activeAssetRuleGroup === 'components' ? 'component' : 'raw material';
    assetRulesBody.innerHTML = `<tr><td colspan="${emptyColspan}" class="empty-state">No ${groupLabel} rules yet. Use + Add Row.</td></tr>`;
    return;
  }

  visibleRows.forEach(({ row, index }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="refill-cell">
        <input data-index="${index}" data-field="refill" type="checkbox" />
      </td>
      <td>
        <select data-index="${index}" data-field="starbase"></select>
      </td>
      <td>
        <select data-index="${index}" data-field="asset"></select>
      </td>
      <td>
        <div class="cell-stack compact-cell">
          <input data-index="${index}" data-field="minQuantity" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" />
          <span class="cell-hint">Min order</span>
        </div>
      </td>
      <td>
        <div class="cell-stack compact-cell">
          <input data-index="${index}" data-field="maxQuantity" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" />
          <span class="cell-hint">Max active</span>
        </div>
      </td>
      <td>
        <div class="cell-stack price-cell">
          <input data-index="${index}" data-field="minBuyPrice" type="number" min="0" step="0.000001" inputmode="decimal" />
          <span class="cell-hint">ATLAS</span>
        </div>
      </td>
      <td>
        <div class="cell-stack price-cell">
          <input data-index="${index}" data-field="maxBuyPrice" type="number" min="0" step="0.000001" inputmode="decimal" />
          <span class="cell-hint">ATLAS</span>
        </div>
      </td>
      <td>
        <div class="cell-stack price-cell">
          <input data-index="${index}" data-field="minSellPrice" type="number" min="0" step="0.000001" inputmode="decimal" />
          <span class="cell-hint">ATLAS</span>
        </div>
      </td>
      <td>
        <div class="cell-stack price-cell">
          <input data-index="${index}" data-field="maxSellPrice" type="number" min="0" step="0.000001" inputmode="decimal" />
          <span class="cell-hint">ATLAS</span>
        </div>
      </td>
      <td class="remove-cell">
        <div class="cell-stack">
          <button type="button" class="cancel-order-btn" data-index="${index}">Cancel Order</button>
          <button type="button" class="remove-row-btn" data-index="${index}">Remove</button>
        </div>
      </td>
    `;

    const starbaseSelect = tr.querySelector('[data-field="starbase"]');
    const assetSelect = tr.querySelector('[data-field="asset"]');
    const refillInput = tr.querySelector('[data-field="refill"]');
    const fieldsByName = {
      minQuantity: tr.querySelector('[data-field="minQuantity"]'),
      maxQuantity: tr.querySelector('[data-field="maxQuantity"]'),
      minBuyPrice: tr.querySelector('[data-field="minBuyPrice"]'),
      maxBuyPrice: tr.querySelector('[data-field="maxBuyPrice"]'),
      minSellPrice: tr.querySelector('[data-field="minSellPrice"]'),
      maxSellPrice: tr.querySelector('[data-field="maxSellPrice"]'),
    };

    for (const starbase of starbaseOptions) {
      const opt = document.createElement('option');
      opt.value = starbase;
      opt.textContent = starbase;
      starbaseSelect.appendChild(opt);
    }

    const emptyAssetOption = document.createElement('option');
    emptyAssetOption.value = '';
    emptyAssetOption.textContent = 'Select asset...';
    assetSelect.appendChild(emptyAssetOption);

    for (const option of options) {
      const opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.label;
      assetSelect.appendChild(opt);
    }

    starbaseSelect.value = starbaseOptions.includes(row.starbase) ? row.starbase : starbaseOptions[0];
    assetSelect.value = options.some((option) => option.value === row.asset) ? row.asset : '';
    refillInput.checked = row.refill !== false;
    const formattedIntegerFields = new Set(['minQuantity', 'maxQuantity']);
    for (const [field, input] of Object.entries(fieldsByName)) {
      input.value = formattedIntegerFields.has(field)
        ? formatIntegerWithSeparators(row[field] ?? '')
        : row[field] ?? '';
    }

    starbaseSelect.addEventListener('change', (event) => {
      assetRuleRows[index].starbase = event.target.value;
      renderAssetRuleRows();
    });

    assetSelect.addEventListener('change', (event) => {
      assetRuleRows[index].asset = event.target.value;
      renderAssetRuleRows();
    });

    refillInput.addEventListener('change', (event) => {
      assetRuleRows[index].refill = event.target.checked;
    });

    for (const [field, input] of Object.entries(fieldsByName)) {
      input.addEventListener('input', (event) => {
        if (formattedIntegerFields.has(field)) {
          const raw = event.target.value;
          const cursor = event.target.selectionStart ?? raw.length;
          const digitsBeforeCursor = raw.slice(0, cursor).replace(/[^\d-]/g, '').length;
          const stripped = stripIntegerSeparators(raw);
          assetRuleRows[index][field] = stripped;
          const formatted = formatIntegerWithSeparators(stripped);
          if (formatted !== raw) {
            event.target.value = formatted;
            let newCursor = 0;
            let digitsSeen = 0;
            for (let i = 0; i < formatted.length; i++) {
              if (digitsSeen >= digitsBeforeCursor) {
                newCursor = i;
                break;
              }
              if (/\d/.test(formatted[i])) {
                digitsSeen++;
              }
              newCursor = i + 1;
            }
            try {
              event.target.setSelectionRange(newCursor, newCursor);
            } catch {
              // ignore: number/text inputs do not support setSelectionRange in some contexts
            }
          }
          return;
        }
        assetRuleRows[index][field] = event.target.value;
      });

      if (formattedIntegerFields.has(field)) {
        input.addEventListener('change', (event) => {
          const stripped = stripIntegerSeparators(event.target.value);
          assetRuleRows[index][field] = stripped;
          event.target.value = formatIntegerWithSeparators(stripped);
        });
      }
    }

    const cancelOrderBtn = tr.querySelector('.cancel-order-btn');
    cancelOrderBtn.addEventListener('click', async () => {
      const rowSnapshot = {
        asset: assetRuleRows[index]?.asset ?? '',
        starbase: assetRuleRows[index]?.starbase ?? '',
      };

      if (!rowSnapshot.asset) {
        appendLog(`[${new Date().toISOString()}] [WARN] Select an asset before cancelling an order.`);
        return;
      }

      const activeSides = [];
      if (String(assetRuleRows[index]?.maxBuyPrice ?? '').trim()) activeSides.push('buy');
      if (String(assetRuleRows[index]?.minSellPrice ?? '').trim()) activeSides.push('sell');
      const sidesToCancel = activeSides.length ? activeSides : ['buy', 'sell'];

      cancelOrderBtn.disabled = true;
      try {
        for (const side of sidesToCancel) {
          const result = await window.botApi.cancelOrder({ ...rowSnapshot, side });
          const status = result?.status ?? 'unknown';
          appendLog(`[${new Date().toISOString()}] [INFO] Cancel order ${status} for ${rowSnapshot.asset} [${side}]`);
        }
        await refreshBotStatus();
      } catch (err) {
        appendLog(`[${new Date().toISOString()}] [ERROR] ${err?.message || String(err)}`);
      } finally {
        cancelOrderBtn.disabled = false;
      }
    });

    tr.querySelector('.remove-row-btn').addEventListener('click', () => {
      assetRuleRows.splice(index, 1);
      renderAssetRuleRows();
    });

    assetRulesBody.appendChild(tr);
  });
}

function readFormConfig() {
  const data = {};
  for (const key of fields) {
    const element = form.elements.namedItem(key);
    data[key] = element ? String(element.value ?? '').trim() : '';
  }
  return data;
}

function writeFormConfig(config) {
  assetRegistryResourceList = String(config?.RESOURCE_LIST ?? '');
  for (const key of fields) {
    const element = form.elements.namedItem(key);
    if (element) {
      element.value = config[key] ?? '';
    }
  }
  void updateDisplayAccounts();
}

async function updateDisplayAccounts() {
  const managedWallet = form.elements.namedItem('OWNER_WALLET')?.value ?? '';
  const playerProfile = form.elements.namedItem('OWNER_PROFILE')?.value ?? '';
  const hotWalletSecret = form.elements.namedItem('HOT_WALLET_SECRET')?.value ?? '';

  setDisplayKey(displayManagedWallet, managedWallet);
  setDisplayKey(displayPlayerProfile, playerProfile);

  if (!String(hotWalletSecret).trim()) {
    setDisplayKey(displayHotWalletAddress, '');
    return;
  }

  const result = await window.botApi.deriveHotWallet(hotWalletSecret);
  if (result?.ok && result.address) {
    setDisplayKey(displayHotWalletAddress, result.address);
  } else {
    displayHotWalletAddress.textContent = 'Invalid secret';
    displayHotWalletAddress.title = result?.error || '';
  }
}

function appendLog(line) {
  logsEl.textContent += `${line}\n`;
  logsEl.scrollTop = logsEl.scrollHeight;
}

function formatNumber(value, maximumFractionDigits = 6) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
}

function formatIntegerWithSeparators(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value).trim();
  if (!text) {
    return '';
  }
  const digitsOnly = text.replace(/[^\d-]/g, '');
  if (!digitsOnly || digitsOnly === '-') {
    return '';
  }
  const negative = digitsOnly.startsWith('-');
  const unsigned = negative ? digitsOnly.slice(1) : digitsOnly;
  if (!/^\d+$/.test(unsigned)) {
    return '';
  }
  const grouped = new Intl.NumberFormat(undefined, { useGrouping: true }).format(Number(unsigned));
  return negative ? `-${grouped}` : grouped;
}

function stripIntegerSeparators(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value).trim();
  if (!text) {
    return '';
  }
  return text.replace(/[^\d-]/g, '');
}

function formatTimestamp(value) {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString();
}

function formatRelativeDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    return '—';
  }

  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }

  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

function formatRuntime(startedAt, running) {
  const versionSuffix = ` | v${APP_VERSION}`;

  if (!running || !startedAt) {
    return `Stopped${versionSuffix}`;
  }

  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) {
    return `Running${versionSuffix}`;
  }

  const elapsed = Date.now() - start.getTime();
  return `Running for ${formatRelativeDuration(elapsed)}${versionSuffix}`;
}

function shortenWallet(value) {
  if (!value || typeof value !== 'string' || value === '—') {
    return '—';
  }
  if (value.length <= 14) {
    return value;
  }
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function setListCount(element, count) {
  element.textContent = String(count ?? 0);
}

function getAssetRuleOrderMap() {
  const orderMap = new Map();
  assetRuleRows.forEach((row, index) => {
    const asset = String(row?.asset || '').split(':')[0]?.trim();
    if (asset && !orderMap.has(asset)) {
      orderMap.set(asset, index);
    }
  });
  return orderMap;
}

function sortByAssetRuleOrder(items, assetGetter) {
  const orderMap = getAssetRuleOrderMap();
  return [...items].sort((a, b) => {
    const assetA = String(assetGetter(a) || '').trim();
    const assetB = String(assetGetter(b) || '').trim();
    const indexA = orderMap.has(assetA) ? orderMap.get(assetA) : Number.MAX_SAFE_INTEGER;
    const indexB = orderMap.has(assetB) ? orderMap.get(assetB) : Number.MAX_SAFE_INTEGER;

    if (indexA !== indexB) {
      return indexA - indexB;
    }

    return assetA.localeCompare(assetB);
  });
}

function renderOpenOrders(orders) {
  openOrdersListEl.innerHTML = '';
  setListCount(openOrdersCountEl, orders.length);

  if (!orders.length) {
    openOrdersListEl.innerHTML = '<div class="empty-state">No open orders</div>';
    return;
  }

  const sortedOrders = sortByAssetRuleOrder(orders, (order) => order?.asset);
  sortedOrders.sort((a, b) => {
    const starbaseComparison = compareStarbaseLabels(a?.starbase, b?.starbase);
    if (starbaseComparison !== 0) {
      return starbaseComparison;
    }
    return 0;
  });

  for (const order of sortedOrders) {
    const item = document.createElement('div');
    item.className = 'status-item order-item';

    const hasOriginalQuantity = typeof order.quantity === 'number' && Number.isFinite(order.quantity);
    const isPartiallyFilled =
      hasOriginalQuantity &&
      typeof order.remaining === 'number' &&
      Number.isFinite(order.remaining) &&
      order.remaining < order.quantity;
    const qtyLabel = isPartiallyFilled ? 'Remaining / Size' : 'Qty';
    const qtyText = isPartiallyFilled
      ? `${formatNumber(order.remaining, 0)} / ${formatNumber(order.quantity, 0)}`
      : formatNumber(order.remaining, 0);

    item.innerHTML = `
      <div class="status-item-top">
        <div class="order-left">
          <span class="inventory-starbase order-starbase">${order.starbase || '—'}</span>
          <span class="order-asset">${order.asset || 'Unknown Asset'}</span>
          <span class="badge ${order.side === 'buy' ? 'buy' : 'sell'}">${order.side}</span>
          ${order.marketLeader === 'hb' ? '<span class="badge leader">BB</span>' : ''}
          ${order.marketLeader === 'ba' ? '<span class="badge leader">BA</span>' : ''}
          ${order.partiallyFilled ? '<span class="badge partial">Partial</span>' : ''}
        </div>
        <div class="order-right">
          <span class="order-metric">
            <span class="order-metric-label">Price</span>
            <span>${formatNumber(order.price, 6)} ${order.currency || ''}</span>
          </span>
          <span class="order-metric">
            <span class="order-metric-label">${qtyLabel}</span>
            <span>${qtyText}</span>
          </span>
        </div>
      </div>
    `;

    openOrdersListEl.appendChild(item);
  }
}

function renderInventory(items) {
  inventoryListEl.innerHTML = '';
  const visibleItems = (Array.isArray(items) ? items : []).filter(
    (item) => typeof item?.balance === 'number' && Number.isFinite(item.balance) && item.balance > 0,
  );
  setListCount(inventoryCountEl, visibleItems.length);

  if (!visibleItems.length) {
    inventoryListEl.innerHTML = '<div class="empty-state">All tracked cargo pod inventory is 0</div>';
    return;
  }

  const sortedItems = [...visibleItems].sort((a, b) => {
    const starbaseComparison = compareStarbaseLabels(a?.starbase, b?.starbase);
    if (starbaseComparison !== 0) {
      return starbaseComparison;
    }
    return String(a?.asset || '').localeCompare(String(b?.asset || ''), undefined, { numeric: true });
  });

  for (const itemData of sortedItems) {
    const item = document.createElement('div');
    item.className = 'status-item inventory-item';

    item.innerHTML = `
      <div class="status-item-top">
        <div class="inventory-left">
          <span class="inventory-starbase">${itemData.starbase || '—'}</span>
          <span class="inventory-asset">${itemData.asset || itemData.mint || 'Unknown Asset'}</span>
        </div>
        <div class="inventory-right">
          <span class="inventory-metric">
            <span class="inventory-metric-label">Balance</span>
            <span>${formatNumber(itemData.balance, 6)}</span>
          </span>
        </div>
      </div>
    `;

    inventoryListEl.appendChild(item);
  }
}

function renderCertificates(items) {
  certificatesListEl.innerHTML = '';
  const visibleItems = (Array.isArray(items) ? items : []).filter(
    (item) => typeof item?.balance === 'number' && Number.isFinite(item.balance) && item.balance > 0,
  );
  setListCount(certificatesCountEl, visibleItems.length);

  if (!visibleItems.length) {
    certificatesListEl.innerHTML = '<div class="empty-state">No wallet certificates</div>';
    return;
  }

  const sortedItems = [...visibleItems].sort((a, b) => {
    const starbaseComparison = compareStarbaseLabels(a?.starbase, b?.starbase);
    if (starbaseComparison !== 0) {
      return starbaseComparison;
    }
    return String(a?.asset || '').localeCompare(String(b?.asset || ''), undefined, { numeric: true });
  });

  sortedItems.forEach((itemData, index) => {
    const item = document.createElement('div');
    item.className = 'status-item certificate-item';

    item.innerHTML = `
      <div class="status-item-top">
        <div class="inventory-left">
          <span class="inventory-starbase">${itemData.starbase || '—'}</span>
          <span class="inventory-asset">${itemData.asset || itemData.rawMint || 'Unknown Asset'} Certificate</span>
        </div>
        <div class="inventory-right">
          <span class="inventory-metric">
            <span class="inventory-metric-label">Balance</span>
            <span>${formatNumber(itemData.balance, 0)}</span>
          </span>
          <button type="button" class="redeem-certificate-btn" data-index="${index}">Redeem</button>
        </div>
      </div>
      <div class="status-item-row">
        <span class="status-item-subtle">Mint</span>
        <span class="status-item-value" title="${itemData.certificateMint || ''}">${shortenWallet(itemData.certificateMint || '—')}</span>
      </div>
    `;

    const button = item.querySelector('.redeem-certificate-btn');
    button.addEventListener('click', async () => {
      button.disabled = true;
      const asset = String(itemData.ruleAsset || itemData.asset || '').trim();
      const starbase = String(itemData.starbase || '').trim();
      appendLog(`[${new Date().toISOString()}] [INFO] Redeeming ${asset} certificate balance at ${starbase}...`);
      try {
        const result = await window.botApi.redeemCertificate({ asset, starbase });
        const status = result?.status ?? 'unknown';
        appendLog(`[${new Date().toISOString()}] [INFO] Redeem certificate ${status} for ${asset} at ${starbase}`);
        await refreshBotStatus();
      } catch (err) {
        appendLog(`[${new Date().toISOString()}] [ERROR] Redeem certificate failed: ${err?.message || String(err)}`);
      } finally {
        button.disabled = false;
      }
    });

    certificatesListEl.appendChild(item);
  });
}

function getActivityTitle(entry) {
  if (entry.event === 'START') {
    return 'Bot Start';
  }
  if (entry.event === 'FILLED') {
    return ['FILLED', entry.resource || entry.asset || ''].filter(Boolean).join(' · ');
  }
  return [entry.event, entry.resource || entry.asset || ''].filter(Boolean).join(' · ');
}

function getActivityTone(entry) {
  if (entry.event === 'FILLED') {
    return 'filled';
  }
  if (entry.event === 'START') {
    return 'start';
  }
  return 'default';
}

function getActivityBadge(entry) {
  if (entry.event === 'FILLED') {
    return '<span class="badge activity-badge filled">FILLED</span>';
  }
  if (entry.event === 'START') {
    return '<span class="badge activity-badge start">START</span>';
  }
  return '';
}

function renderRecentActivity(items) {
  recentActivityListEl.innerHTML = '';
  setListCount(recentActivityCountEl, items.length);

  if (!items.length) {
    recentActivityListEl.innerHTML = '<div class="empty-state">No recent activity</div>';
    return;
  }

  for (const entry of items) {
    const tone = getActivityTone(entry);
    const item = document.createElement('div');
    item.className = `status-item activity-item activity-item-${tone}`;

    const title = getActivityTitle(entry);
    const badge = getActivityBadge(entry);

    const details = [];
    if (entry.side) {
      details.push(entry.side);
    }
    if (typeof entry.price === 'number') {
      details.push(`P ${formatNumber(entry.price, 6)}`);
    }
    if (typeof entry.quantity === 'number') {
      details.push(`Q ${formatNumber(entry.quantity, 0)}`);
    }
    if (typeof entry.remaining === 'number') {
      details.push(`R ${formatNumber(entry.remaining, 0)}`);
    }
    if (entry.message) {
      details.push(entry.message);
    }

    item.innerHTML = `
      <div class="status-item-top">
        <div class="activity-left">
          <span class="activity-title">${title || 'Activity'}</span>
          ${badge}
        </div>
        <div class="activity-right">
          <span class="activity-metric">
            <span class="activity-metric-label">At</span>
            <span>${formatTimestamp(entry.timestamp)}</span>
          </span>
        </div>
      </div>
      <div class="status-item-row">
        <span class="status-item-subtle">Details</span>
        <span class="status-item-value">${details.join(' · ') || '—'}</span>
      </div>
    `;

    recentActivityListEl.appendChild(item);
  }
}

function collectAssetSignals(snapshot) {
  const signal = new Map();

  const inventory = Array.isArray(snapshot?.inventory) ? snapshot.inventory : [];
  for (const item of inventory) {
    const asset = String(item?.asset || '').trim();
    if (!asset) continue;
    const signalKey = `${String(item?.starbase || '').trim()}|${asset}`;
    const prev = signal.get(signalKey) || { inventoryBalance: null, openRemaining: 0, openCount: 0, asset };
    prev.inventoryBalance = typeof item?.balance === 'number' ? item.balance : null;
    signal.set(signalKey, prev);
  }

  const openOrders = Array.isArray(snapshot?.openOrders) ? snapshot.openOrders : [];
  for (const order of openOrders) {
    const asset = String(order?.asset || '').trim();
    if (!asset) continue;
    const signalKey = `|${asset}`;
    const prev = signal.get(signalKey) || { inventoryBalance: null, openRemaining: 0, openCount: 0, asset };
    prev.openCount += 1;
    if (typeof order?.remaining === 'number' && Number.isFinite(order.remaining)) {
      prev.openRemaining += order.remaining;
    }
    signal.set(signalKey, prev);
  }

  return signal;
}

async function maybeAutoRerunFromStatus(snapshot, running) {
  const nextSignals = collectAssetSignals(snapshot);

  if (!running || rerunInFlight) {
    previousAssetSignals = nextSignals;
    return;
  }

  const now = Date.now();
  const touched = new Set();

  for (const [signalKey, next] of nextSignals.entries()) {
    const prev = previousAssetSignals.get(signalKey);
    if (!prev) continue;

    const inventoryChanged =
      typeof prev.inventoryBalance === 'number' &&
      typeof next.inventoryBalance === 'number' &&
      Math.abs(prev.inventoryBalance - next.inventoryBalance) > 0.0000001;
    const openRemainingChanged = Math.abs((prev.openRemaining || 0) - (next.openRemaining || 0)) > 0;
    const openCountChanged = (prev.openCount || 0) !== (next.openCount || 0);

    if (inventoryChanged || openRemainingChanged || openCountChanged) {
      const asset = next.asset || signalKey.split('|').pop();
      const lastAt = assetLastRerunAtMs.get(asset) || 0;
      if (now - lastAt >= AUTO_RERUN_COOLDOWN_MS) {
        touched.add(asset);
      }
    }
  }

  previousAssetSignals = nextSignals;
  if (!touched.size) return;

  rerunInFlight = true;
  const assets = Array.from(touched);
  try {
    appendLog(`[${new Date().toISOString()}] [INFO] Detected live asset changes, rerunning: ${assets.join(', ')}`);
    const result = await window.botApi.rerunAssets(assets);
    if (result?.ok) {
      const stamp = Date.now();
      assets.forEach((asset) => assetLastRerunAtMs.set(asset, stamp));
    }
  } catch (err) {
    appendLog(`[${new Date().toISOString()}] [WARN] Auto-rerun failed: ${err?.message || String(err)}`);
  } finally {
    rerunInFlight = false;
  }
}

function renderStatusSnapshot(snapshot) {
  const running = Boolean(snapshot?.running);
  setRunning(running);
  lastUiRefreshAtMs = Date.now();

  walletAddressEl.textContent = shortenWallet(snapshot?.wallet || '—');
  walletAddressEl.title = snapshot?.wallet || '—';

  solBalanceEl.textContent = formatNumber(snapshot?.solBalance, 6);
  atlasBalanceEl.textContent = formatNumber(snapshot?.atlasBalance, 2);
  usdcBalanceEl.textContent = formatNumber(snapshot?.usdcBalance, 2);
  botRuntimeEl.textContent = formatRuntime(
    snapshot?.startedAt,
    running,
    snapshot?.lastCycleCompletedAt || snapshot?.lastCycleStartedAt
  );

  lastCycleAtEl.textContent = formatTimestamp(snapshot?.lastCycleCompletedAt || snapshot?.lastCycleStartedAt);

  if (nextCycleInEl) {
    const intervalMinutes = Number(
      form?.elements?.namedItem('CHECK_INTERVAL_MINUTES')?.value ?? snapshot?.checkIntervalMinutes ?? NaN
    );
    const baseAt = snapshot?.lastCycleStartedAt || snapshot?.lastCycleCompletedAt || snapshot?.startedAt;
    const baseMs = baseAt ? new Date(baseAt).getTime() : Number.NaN;

    if (Number.isFinite(intervalMinutes) && intervalMinutes > 0 && Number.isFinite(baseMs)) {
      const nextCycleAt = baseMs + intervalMinutes * 60 * 1000;
      const msRemaining = Math.max(0, nextCycleAt - Date.now());
      nextCycleInEl.textContent = formatRelativeDuration(msRemaining);
    } else {
      nextCycleInEl.textContent = '—';
    }
  }

  renderOpenOrders(Array.isArray(snapshot?.openOrders) ? snapshot.openOrders : []);
  renderInventory(Array.isArray(snapshot?.inventory) ? snapshot.inventory : []);
  renderCertificates(Array.isArray(snapshot?.certificates) ? snapshot.certificates : []);
  renderRecentActivity(Array.isArray(snapshot?.recentActivity) ? snapshot.recentActivity : []);

  maybeCheckForUpdatesAfterCycle(snapshot);
  void maybeAutoRerunFromStatus(snapshot, running);
}

async function refreshBotStatus() {
  try {
    const snapshot = await window.botApi.getBotStatus();
    renderStatusSnapshot(snapshot || {});
  } catch (err) {
    appendLog(`[${new Date().toISOString()}] [ERROR] Failed to fetch bot status: ${err?.message || String(err)}`);
  }
}

function startStatusPolling() {
  stopStatusPolling();
  statusPollHandle = window.setInterval(() => {
    void refreshBotStatus();
  }, STATUS_POLL_MS);
}

function stopStatusPolling() {
  if (statusPollHandle) {
    window.clearInterval(statusPollHandle);
    statusPollHandle = null;
  }
}

function normalizeAssetRulesForDiff(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      starbase: normalizeStarbaseValue(row?.starbase),
      group: String(row?.group ?? '').trim(),
      asset: String(row?.asset ?? '').trim(),
      refill: row?.refill === false || row?.refill === 'false' ? '0' : '1',
      minQuantity: String(row?.minQuantity ?? '').replace(/[^\d-]/g, '').trim(),
      maxQuantity: String(row?.maxQuantity ?? '').replace(/[^\d-]/g, '').trim(),
      minBuyPrice: String(row?.minBuyPrice ?? '').trim(),
      maxBuyPrice: String(row?.maxBuyPrice ?? '').trim(),
      minSellPrice: String(row?.minSellPrice ?? '').trim(),
      maxSellPrice: String(row?.maxSellPrice ?? '').trim(),
    }))
    .filter((row) => row.asset)
    .sort((a, b) => {
      const starbaseComparison = compareStarbaseLabels(a.starbase, b.starbase);
      if (starbaseComparison !== 0) {
        return starbaseComparison;
      }
      return `${a.group}|${a.asset}`.localeCompare(`${b.group}|${b.asset}`);
    });
}

function getChangedAssets(previousRows, nextRows) {
  const prevMap = new Map(
    normalizeAssetRulesForDiff(previousRows).map((row) => [
      `${row.starbase}|${row.group}|${row.asset}`,
      `${row.refill}|${row.minQuantity}|${row.maxQuantity}|${row.minBuyPrice}|${row.maxBuyPrice}|${row.minSellPrice}|${row.maxSellPrice}`,
    ])
  );
  const nextMap = new Map(
    normalizeAssetRulesForDiff(nextRows).map((row) => [
      `${row.starbase}|${row.group}|${row.asset}`,
      `${row.refill}|${row.minQuantity}|${row.maxQuantity}|${row.minBuyPrice}|${row.maxBuyPrice}|${row.minSellPrice}|${row.maxSellPrice}`,
    ])
  );

  const touched = new Set();
  const keys = new Set([...prevMap.keys(), ...nextMap.keys()]);
  for (const key of keys) {
    if (prevMap.get(key) !== nextMap.get(key)) {
      touched.add(key.split('|')[2]);
    }
  }
  return Array.from(touched);
}

function getChangedConfigKeys(previousConfig, nextConfig) {
  const keys = new Set([
    ...Object.keys(previousConfig || {}),
    ...Object.keys(nextConfig || {}),
  ]);
  const changed = [];

  for (const key of keys) {
    if (String(previousConfig?.[key] ?? '') !== String(nextConfig?.[key] ?? '')) {
      changed.push(key);
    }
  }

  return changed;
}

function getConfiguredAssets(rows) {
  return Array.from(
    new Set(
      normalizeAssetRulesForDiff(rows)
        .map((row) => row.asset)
        .filter(Boolean)
    )
  );
}

async function saveAllSettings() {
  const payload = {
    config: readFormConfig(),
    assetRules: assetRuleRows,
  };
  const result = await window.botApi.saveSettings(payload);
  assetRuleRows = Array.isArray(result.assetRules) ? normalizeAssetRuleRows(result.assetRules) : assetRuleRows;
  return result;
}

async function boot() {
  const state = await window.botApi.getSettings();
  writeFormConfig(state.config);
  assetRuleRows = Array.isArray(state.assetRules) ? normalizeAssetRuleRows(state.assetRules) : buildDefaultAssetRuleRows();
  ensureAssetRuleRows();
  renderAssetRuleRows();
  lastSavedConfig = { ...(state.config || {}) };
  lastSavedAssetRules = normalizeAssetRulesForDiff(assetRuleRows);
  setRunning(Boolean(state.running));
  setSensitiveVisible(false);
  setActiveTab('asset-rules');

  const renderLogEntry = (entry) => {
    appendLog(`[${entry.timestamp}] [${entry.level}] ${entry.message}`);

    const message = String(entry?.message || '');
    const shouldRefreshNow =
      message.includes('Placing ') ||
      message.includes('Cancelling ') ||
      message.includes('Cancelled ') ||
      message.includes('FILLED') ||
      message.includes('PLACE') ||
      message.includes('CANCEL');

    if (shouldRefreshNow) {
      void refreshBotStatus();
    }
  };

  const existingLogs = typeof window.botApi.getLogs === 'function' ? await window.botApi.getLogs() : [];
  for (const entry of existingLogs || []) renderLogEntry(entry);
  window.botApi.onLog(renderLogEntry);

  window.botApi.onStatus((entry) => {
    setRunning(Boolean(entry.running));
    void refreshBotStatus();
  });

  await refreshBotStatus();
  startStatusPolling();
  void checkForUpdatesAndRenderButton().catch((err) => {
    appendLog(`[${new Date().toISOString()}] [WARN] Update check failed: ${err?.message || String(err)}`);
  });
}

saveBtn.addEventListener('click', async () => {
  const previousConfig = { ...(lastSavedConfig || {}) };
  const previousRules = [...lastSavedAssetRules];

  const result = await saveAllSettings();
  renderAssetRuleRows();
  appendLog(`[${new Date().toISOString()}] [INFO] Settings saved`);

  const currentConfig = { ...(result?.config || readFormConfig()) };
  const currentRules = normalizeAssetRulesForDiff(assetRuleRows);

  const changedConfigKeys = getChangedConfigKeys(previousConfig, currentConfig);
  const needsRestart = changedConfigKeys.some((key) => FULL_RESTART_CONFIG_KEYS.has(key));
  const rerunAllAssets = changedConfigKeys.some((key) => RERUN_ALL_ASSETS_CONFIG_KEYS.has(key));
  const changedAssets = getChangedAssets(previousRules, currentRules);

  const wasRunning = startBtn.disabled;
  if (wasRunning) {
    if (needsRestart) {
      appendLog(`[${new Date().toISOString()}] [INFO] Restarting bot to apply settings immediately...`);
      await window.botApi.stopBot();
      await window.botApi.startBot();
    } else {
      const assetsToRerun = rerunAllAssets ? getConfiguredAssets(currentRules) : changedAssets;
      const changedConfigLabel = changedConfigKeys.length ? changedConfigKeys.join(', ') : 'none';

      if (assetsToRerun.length > 0) {
        appendLog(
          `[${new Date().toISOString()}] [INFO] Applying settings without full restart; rerunning assets: ${assetsToRerun.join(', ')}`
        );
      } else {
        appendLog(
          `[${new Date().toISOString()}] [INFO] Applying settings without full restart; changed config: ${changedConfigLabel}`
        );
      }

      const applied = await window.botApi.applyRunningSettings({ assets: assetsToRerun });
      if (!applied?.ok) {
        appendLog(`[${new Date().toISOString()}] [WARN] Running settings apply failed; falling back to restart.`);
        await window.botApi.stopBot();
        await window.botApi.startBot();
      }
    }
  }

  lastSavedConfig = currentConfig;
  lastSavedAssetRules = currentRules;
  await refreshBotStatus();
});

startBtn.addEventListener('click', async () => {
  const result = await saveAllSettings();
  renderAssetRuleRows();
  lastSavedConfig = { ...(result?.config || readFormConfig()) };
  lastSavedAssetRules = normalizeAssetRulesForDiff(assetRuleRows);
  await window.botApi.startBot();
  await refreshBotStatus();
});

stopBtn.addEventListener('click', async () => {
  await window.botApi.stopBot();
  await refreshBotStatus();
});

updateBtn.addEventListener('click', () => {
  void openUpdateDialog();
});

updateCancelBtn.addEventListener('click', () => {
  setUpdateModalOpen(false);
});

updateModal.addEventListener('click', (event) => {
  if (event.target === updateModal) {
    setUpdateModalOpen(false);
  }
});

updateConfirmBtn.addEventListener('click', async () => {
  if (!availableUpdate?.updateAvailable) return;
  updateConfirmBtn.disabled = true;
  updateCancelBtn.disabled = true;
  updateMessageEl.textContent = `Downloading LM Market Bot v${availableUpdate.latestVersion} and restarting...`;
  appendLog(
    `[${new Date().toISOString()}] [INFO] Downloading LM Market Bot v${availableUpdate.latestVersion} and restarting...`,
  );
  try {
    await window.botApi.downloadUpdateAndRestart();
  } catch (err) {
    updateCancelBtn.disabled = false;
    renderUpdateModalState(availableUpdate, err);
    appendLog(`[${new Date().toISOString()}] [ERROR] Update failed: ${err?.message || String(err)}`);
  }
});

addRuleRowBtn.addEventListener('click', () => {
  const firstStarbase = getStarbaseOptionsForFaction()[0];
  if (!getResourceOptions(activeAssetRuleGroup).length || !firstStarbase) {
    appendLog(`[${new Date().toISOString()}] [WARN] Asset registry unavailable. Save a valid Aephia API Key first.`);
    return;
  }
  assetRuleRows.push({
    starbase: firstStarbase,
    group: activeAssetRuleGroup,
    asset: '',
    refill: true,
    minQuantity: '',
    maxQuantity: '',
    minBuyPrice: '',
    maxBuyPrice: '',
    minSellPrice: '',
    maxSellPrice: '',
  });
  renderAssetRuleRows();
});

toggleSensitiveBtn.addEventListener('click', () => {
  setSensitiveVisible(!sensitiveVisible);
});

for (const key of ['HOT_WALLET_SECRET', 'OWNER_WALLET', 'OWNER_PROFILE']) {
  form.elements.namedItem(key)?.addEventListener('input', () => {
    void updateDisplayAccounts();
  });
}

form.elements.namedItem('FACTION')?.addEventListener('change', () => {
  assetRuleRows = normalizeAssetRuleRows(assetRuleRows);
  renderAssetRuleRows();
});

for (const button of tabButtons) {
  button.addEventListener('click', () => {
    setActiveTab(button.dataset.tab);
  });
}

for (const button of assetRuleTabButtons) {
  button.addEventListener('click', () => {
    activeAssetRuleGroup = button.dataset.assetRuleGroup === 'components'
      ? button.dataset.assetRuleGroup
      : 'raw';
    for (const tabButton of assetRuleTabButtons) {
      const active = tabButton.dataset.assetRuleGroup === activeAssetRuleGroup;
      tabButton.classList.toggle('active', active);
      tabButton.setAttribute('aria-selected', String(active));
    }
    renderAssetRuleRows();
  });
}

window.addEventListener('beforeunload', () => {
  stopStatusPolling();
});

boot().catch((err) => {
  appendLog(`[${new Date().toISOString()}] [ERROR] ${err?.message || String(err)}`);
});
