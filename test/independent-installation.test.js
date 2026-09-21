'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { installationIdentity, resolveInstallationProfile, updateFeed } = require('../electron/installation-policy');
const { buildConfiguration } = require('../scripts/independent-build-config');

test('each installation has distinct installer, executable, artifact, channel and updater cache identities', () => {
  const configs = ['MUD','ONI','USTUR'].map(buildConfiguration);
  for (const key of ['appId','productName','artifactName']) assert.equal(new Set(configs.map(c=>c[key])).size,3);
  assert.equal(new Set(configs.map(c=>c.win.executableName)).size,3);
  assert.equal(new Set(configs.map(c=>c.publish[0].channel)).size,3);
  assert.equal(new Set(['MUD','ONI','USTUR'].map(p=>installationIdentity(p).cache)).size,3);
  for (const c of configs) assert.equal(c.extraMetadata.installationProfile, c.extraMetadata.installationProfile.toUpperCase());
});
test('embedded profile survives no-argument restart and rejects a different runtime profile', () => {
  assert.equal(resolveInstallationProfile('MUD',''),'MUD');
  assert.equal(resolveInstallationProfile('MUD','mud'),'MUD');
  assert.throws(()=>resolveInstallationProfile('MUD','ONI'),/different profile/);
  assert.throws(()=>installationIdentity('../MUD'),/Invalid/);
  assert.equal(resolveInstallationProfile('', 'ONI'),'ONI');
});
test('feed pins the selected version and profile without falling back to shared metadata', () => {
  assert.deepEqual(updateFeed('ONI','0.3.3'), {provider:'generic',url:'https://github.com/aephiaviktor/lm-market-bot/releases/download/v0.3.3/',channel:'oni'});
  assert.throws(()=>updateFeed('MUD','../evil'),/Invalid/);
});
test('runtime uses single-profile update with native installer relaunch, no cross-profile helper', () => {
  const s=fs.readFileSync(require.resolve('../electron/main'),'utf8');
  assert.doesNotMatch(s,/buildSharedUpdateRequest|startSharedUpdateMonitor|launchPostInstallProfileRestart|restartScheduledProfileTasks/);
  assert.match(s,/requestSingleInstanceLock/);
  assert.match(s,/autoUpdater\.quitAndInstall\(true, true\)/);
  assert.match(s,/autoUpdater\.setFeedURL\(updateFeed/);
});
test('builder configuration validates and uses actual builder cache naming', async () => {
  const { validateConfiguration } = require('app-builder-lib/out/util/config/config');
  const { AppInfo } = require('app-builder-lib/out/appInfo');
  for (const profile of ['MUD','ONI','USTUR']) {
    const config = buildConfiguration(profile);
    await validateConfiguration(config, null);
    const info = new AppInfo({ config, metadata: { ...require('../package.json'), ...config.extraMetadata }, platformSpecificBuildOptions: config.win });
    assert.equal(info.updaterCacheDirName, installationIdentity(profile).cache);
    assert.equal(info.productFilename, `LM Market Bot ${profile}`);
  }
});
test('supervisor cannot default to shared executable and holds a per-profile mutex', () => {
  const s=fs.readFileSync(require.resolve('../scripts/lm-market-bot-supervisor.ps1'),'utf8');
  assert.match(s,/Mandatory = \$true\)\]\[string\]\$AppDir/);
  assert.match(s,/LM Market Bot \$Profile\.exe/);
  assert.match(s,/LMMarketBotSupervisor-\$Profile/);
  assert.doesNotMatch(s,/Join-Path \$SharedData 'update-maintenance/);
});
test('Windows runtime model ID matches the dedicated installer identity', () => {
  const s=fs.readFileSync(require.resolve('../electron/main'),'utf8');
  assert.match(s,/installationIdentity\(packageJson\.installationProfile\)\.appId/);
});
test('effective builder configuration does not inherit incompatible shared GitHub provider keys',async()=>{
 const { getConfig,validateConfiguration }=require('app-builder-lib/out/util/config/config');
 const config=await getConfig(require('node:path').join(__dirname,'..'),null,buildConfiguration('MUD'));
 await validateConfiguration(config,null);
 assert.deepEqual(config.publish,[{provider:'generic',url:'https://github.com/aephiaviktor/lm-market-bot/releases/latest/download/',channel:'mud'}]);
});
