'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { updateFeed } = require('../electron/installation-policy');
function fixture({ downloadFails = false, embedded = 'MUD' } = {}) {
  const events = [];
  const autoUpdater = {
    setFeedURL: feed => events.push(['feed', feed.channel]),
    on() {}, off() {},
    async checkForUpdates() { return { updateInfo: { version: '0.3.3' } }; },
    async downloadUpdate() { events.push('download'); if (downloadFails) throw Error('Download failed'); },
    quitAndInstall: (...args) => events.push(['install', ...args]),
  };
  const source = fs.readFileSync(require.resolve('../electron/main'), 'utf8');
  const fn = source.slice(source.indexOf('async function downloadUpdateAndRestart()'), source.indexOf('\nfunction getAephiaApiKey'));
  const context = vm.createContext({ app: { isPackaged: true, getPath: () => '/profiles/MUD' }, _profileName: 'MUD', packageJson: { installationProfile: embedded },
    process: { execPath: '/MUD/bot.exe' }, autoUpdater, updateFeed,
    checkForUpdates: async () => ({ updateAvailable: true, latestVersion: '0.3.3', currentVersion: '0.3.2' }),
    getPackagedInstallDirectory: () => '/MUD', emitUpdateProgress() {}, botRunning: true,
    stopBot: async () => events.push('stop-MUD'), writeUpdateRestartRequest: r => events.push(['marker', r.runtimeDir]),
    setTimeout: fn => fn(),
  });
  vm.runInContext(fn, context);
  return { events, run: () => context.downloadUpdateAndRestart() };
}
test('independent update downloads before stopping only its bot, then requests installer relaunch', async () => {
  const { events, run } = fixture();
  assert.equal((await run()).updated, true);
  assert.deepEqual(events, [['feed','mud'],'download','stop-MUD',['marker','/profiles/MUD'],['install',true,true]]);
});
test('download failure leaves the running bot untouched', async () => {
  const { events, run } = fixture({ downloadFails: true });
  await assert.rejects(run(), /Download failed/);
  assert.deepEqual(events, [['feed','mud'],'download']);
});
test('legacy shared package refuses independent update without stopping anything', async () => {
  const { events, run } = fixture({ embedded: '' });
  await assert.rejects(run(), /legacy shared package/);
  assert.deepEqual(events, []);
});
