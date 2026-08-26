const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.join(__dirname, '..');

test('LM Market Bot uses packaged GitHub Release updates rather than main-branch source archives', () => {
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  assert.match(main, /require\('electron-updater'\)/);
  assert.match(main, /releases\/latest/);
  assert.match(main, /autoUpdater\.checkForUpdates\(\)/);
  assert.match(main, /autoUpdater\.downloadUpdate\(\)/);
  assert.match(main, /autoUpdater\.quitAndInstall\(true, true\)/);
  assert.doesNotMatch(main, /raw\.githubusercontent\.com/);
  assert.doesNotMatch(main, /archive\/refs\/heads\/main\.tar\.gz/);
});

test('one neutral Windows package serves every runtime profile', () => {
  const p = require('../package.json');
  assert.equal(p.build.appId, 'com.aephia.lm-market-bot');
  assert.equal(p.build.productName, 'LM Market Bot');
  assert.equal(p.build.artifactName, 'LM-Market-Bot-Setup-${version}.${ext}');
  assert.equal(p.build.nsis.oneClick, true);
  assert.ok(p.dependencies['electron-updater']);
  assert.ok(p.devDependencies.electron);
  assert.ok(p.devDependencies['electron-builder']);
  const serialized = JSON.stringify(p.build);
  assert.doesNotMatch(serialized, /MUD|ONI|USTUR/i);

  const workflow = fs.readFileSync(path.join(root, '.github/workflows/windows-release.yml'), 'utf8');
  assert.match(workflow, /push:\s*\n\s*tags:/);
  assert.match(workflow, /npm run dist:win/);
  assert.match(workflow, /LM-Market-Bot-Setup-\$version\.exe/);
  assert.match(workflow, /latest\.yml/);
  assert.doesNotMatch(workflow, /MUD|ONI|USTUR/i);
});

test('packaged profiles use isolated persistent data and generic folder-derived identity', () => {
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  assert.match(main, /path\.join\(app\.getPath\('appData'\), 'lm-market-bot'\)/);
  assert.match(main, /profiles', _profileName/);
  assert.match(main, /inferPackagedProfileName/);
  assert.match(main, /lm-market-bot-/);
  assert.doesNotMatch(main, /Release updates are available.*MUD|Release updates are available.*ONI|Release updates are available.*USTUR/);
});
