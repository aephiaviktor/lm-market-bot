'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const {
  buildUpdateRestartRequest,
  consumeSatisfiedUpdateRestartRequest,
  getPackagedInstallDirectory,
  getUpdateRestartRequestPath,
} = require('../electron/update-restart-policy');

test('packaged install directory is derived without any faction assumption', () => {
  assert.equal(getPackagedInstallDirectory('C:\\Apps\\lm-market-bot-alpha\\LM Market Bot.exe'), 'C:\\Apps\\lm-market-bot-alpha');
  assert.equal(getPackagedInstallDirectory('/opt/lm-market-bot-alpha/lm-market-bot'), '/opt/lm-market-bot-alpha');
});

test('restart request records generic target version and install directory', () => {
  assert.deepEqual(buildUpdateRestartRequest({ targetVersion: '0.2.97', installDirectory: 'C:\\Apps\\lm-market-bot-alpha', requestedAt: 'now' }), {
    targetVersion: '0.2.97', installDirectory: 'C:\\Apps\\lm-market-bot-alpha', requestedAt: 'now',
  });
  assert.equal(path.basename(getUpdateRestartRequestPath('/runtime/profile-a')), 'update-restart-requested.json');
});

test('satisfied restart request is profile-directory scoped', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-update-'));
  const requestPath = getUpdateRestartRequestPath(runtimeDir);
  fs.writeFileSync(requestPath, JSON.stringify(buildUpdateRestartRequest({ targetVersion: '0.2.97', installDirectory: '/apps/lm-market-bot-alpha' })));
  assert.equal(consumeSatisfiedUpdateRestartRequest({ runtimeDir, currentVersion: '0.2.97', installDirectory: '/apps/lm-market-bot-beta' }), false);
  assert.equal(fs.existsSync(requestPath), true);
  assert.equal(consumeSatisfiedUpdateRestartRequest({ runtimeDir, currentVersion: '0.2.97', installDirectory: '/apps/lm-market-bot-alpha' }), true);
  assert.equal(fs.existsSync(requestPath), false);
  fs.rmSync(runtimeDir, { recursive: true, force: true });
});
