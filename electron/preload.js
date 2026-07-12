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
  saveHardwareWalletRecipient: (payload) => ipcRenderer.invoke('hardware-transfer:save-recipient', payload),
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
