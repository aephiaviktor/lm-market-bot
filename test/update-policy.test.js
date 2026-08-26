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
const {
  buildSharedUpdateRequest,
  buildWindowsProfileRestartScript,
  getSharedUpdateRequestPath,
  listPendingProfiles,
  registerRuntime,
  sanitizeRuntimeProfile,
  writeSharedUpdateRequest,
} = require('../electron/shared-update-policy');

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

test('shared update request coordinates every active neutral runtime profile', () => {
  const request = buildSharedUpdateRequest({
    targetVersion: '0.2.98',
    installDirectory: 'C:\\Apps\\lm-market-bot',
    initiatorProfile: 'alpha',
    participants: [
      { profile: 'alpha', pid: 101 },
      { profile: 'beta', pid: 202 },
      { profile: 'alpha', pid: 303 },
    ],
    requestedAt: 'now',
  });
  assert.deepEqual(request, {
    schemaVersion: 1,
    targetVersion: '0.2.98',
    installDirectory: 'C:\\Apps\\lm-market-bot',
    initiatorProfile: 'alpha',
    participants: [
      { profile: 'alpha', pid: 101 },
      { profile: 'beta', pid: 202 },
    ],
    requestedAt: 'now',
  });
  assert.deepEqual(listPendingProfiles(request, [{ profile: 'beta', pid: 202 }]), ['alpha']);
  assert.equal(path.basename(getSharedUpdateRequestPath('/shared')), 'shared-update-request.json');
});

test('shared runtime and update state can replace stale files', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-shared-update-'));
  registerRuntime(runtimeDir, 'profile-a', 101, '/first');
  registerRuntime(runtimeDir, 'profile-a', 202, '/second');
  const first = buildSharedUpdateRequest({ targetVersion: '0.2.98', installDirectory: '/app', initiatorProfile: 'profile-a', participants: [{ profile: 'profile-a', pid: 202 }] });
  const second = buildSharedUpdateRequest({ targetVersion: '0.2.99', installDirectory: '/app', initiatorProfile: 'profile-a', participants: [{ profile: 'profile-a', pid: 202 }] });
  writeSharedUpdateRequest(runtimeDir, first);
  writeSharedUpdateRequest(runtimeDir, second);
  assert.equal(JSON.parse(fs.readFileSync(getSharedUpdateRequestPath(runtimeDir))).targetVersion, '0.2.99');
  fs.rmSync(runtimeDir, { recursive: true, force: true });
});

test('shared update profile values and restart task commands are injection-safe', () => {
  assert.equal(sanitizeRuntimeProfile(' profile-a '), 'profile-a');
  assert.throws(() => sanitizeRuntimeProfile("bad'; Stop-Computer"), /Invalid runtime profile/);
  const script = buildWindowsProfileRestartScript({
    parentPid: 321,
    executablePath: 'C:\\Apps\\lm-market-bot\\LM Market Bot.exe',
    targetVersion: '0.2.98',
    profiles: ['profile-a', 'profile-b'],
  });
  assert.match(script, /Wait-Process -Id 321/);
  assert.match(script, /ProductVersion/);
  assert.match(script, /LM Market Bot profile-a/);
  assert.match(script, /LM Market Bot profile-b/);
  assert.match(script, /schtasks\.exe \/Run \/TN/);
  assert.doesNotMatch(script, /exit 2/);
});
