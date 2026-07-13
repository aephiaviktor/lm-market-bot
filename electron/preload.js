const { contextBridge, ipcRenderer } = require('electron');

function getAppVersion() {
  const prefix = '--lm-market-bot-version=';
  const arg = process.argv.find((entry) => String(entry || '').startsWith(prefix));
  return arg ? arg.slice(prefix.length) : 'unknown';
}

contextBridge.exposeInMainWorld('botApi', {
  appVersion: getAppVersion(),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  getLogs: () => ipcRenderer.invoke('logs:get'),
  saveSettings: (config) => ipcRenderer.invoke('settings:save', config),
  sendSettingsToRpcLimiter: (payload) => ipcRenderer.invoke('rpc-limiter:send-settings', payload),
  getRpcLimiterStatus: () => ipcRenderer.invoke('rpc-limiter:get-status'),
  deriveHotWallet: (secret) => ipcRenderer.invoke('settings:derive-hot-wallet', secret),
  startBot: () => ipcRenderer.invoke('bot:start'),
  stopBot: () => ipcRenderer.invoke('bot:stop'),
  applyRunningSettings: (payload) => ipcRenderer.invoke('bot:apply-running-settings', payload),
  cancelOrder: (payload) => ipcRenderer.invoke('bot:cancel-order', payload),
  redeemCertificate: (payload) => ipcRenderer.invoke('bot:redeem-certificate', payload),
  getCrewDepositStatus: () => ipcRenderer.invoke('crew-deposit:status'),
  depositCrew: (payload) => ipcRenderer.invoke('crew-deposit:run', payload),
  getHardwareWalletTransferState: () => ipcRenderer.invoke('hardware-transfer:state'),
  refreshHardwareWalletBalances: () => ipcRenderer.invoke('hardware-transfer:balances'),
  sendHardwareWalletToken: (payload) => ipcRenderer.invoke('hardware-transfer:send', payload),
  createHardwareWalletTransferPayload: (payload) => ipcRenderer.invoke('hardware-transfer:create-payload', payload),
  signHardwareWalletTransferPayload: (payload) => ipcRenderer.invoke('hardware-transfer:sign-payload', payload),
  broadcastHardwareWalletTransferPayload: (payload) => ipcRenderer.invoke('hardware-transfer:broadcast-payload', payload),
  saveHardwareWalletRecipient: (payload) => ipcRenderer.invoke('hardware-transfer:save-recipient', payload),
  onHardwareWalletTransferProgress: (handler) => {
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on('hardware-transfer:progress', wrapped);
    return () => ipcRenderer.removeListener('hardware-transfer:progress', wrapped);
  },
  getBatchTokenTransferState: () => ipcRenderer.invoke('batch-token-transfer:state'),
  refreshBatchTokenTransferBalances: () => ipcRenderer.invoke('batch-token-transfer:balances'),
  sendBatchTokenTransfer: (payload) => ipcRenderer.invoke('batch-token-transfer:send', payload),
  saveBatchTokenTransferRecipient: (payload) => ipcRenderer.invoke('batch-token-transfer:save-recipient', payload),
  onBatchTokenTransferProgress: (handler) => {
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on('batch-token-transfer:progress', wrapped);
    return () => ipcRenderer.removeListener('batch-token-transfer:progress', wrapped);
  },
  getBotStatus: () => ipcRenderer.invoke('bot:status'),
  rerunAssets: (assets) => ipcRenderer.invoke('bot:rerun-assets', assets),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdateAndRestart: () => ipcRenderer.invoke('updates:download-and-restart'),
  onLog: (handler) => {
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on('bot-log', wrapped);
    return () => ipcRenderer.removeListener('bot-log', wrapped);
  },
  onStatus: (handler) => {
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on('bot-status', wrapped);
    return () => ipcRenderer.removeListener('bot-status', wrapped);
  },
});
