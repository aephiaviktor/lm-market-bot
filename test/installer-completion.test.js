const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildWindowsProfileRestartScript } = require('../electron/shared-update-policy');

test('installer completion is required before releasing maintenance or restarting profiles', () => {
  const script = buildWindowsProfileRestartScript({ parentPid: 123, executablePath: 'C:\\app\\LM Market Bot.exe', targetVersion: '0.3.2', profiles: ['MUD'], handoffDirectory: 'C:\\handoff', maintenancePath: 'C:\\maintenance.json', token: 'nonce' });
  assert.match(script, /installer-complete.txt/);
  assert.match(script, /Installer completion timeout/);
  assert.match(script, /Installer is still running/);
  assert.ok(script.indexOf('Installer completion verified') < script.indexOf('Remove-Item -LiteralPath $maintenance'));
});

test('legacy completion hook is retained for reference but not packaged as an installer hook', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.build.nsis.include, undefined);
  const hook = fs.readFileSync(path.join(__dirname, '../electron/installer.nsh'), 'utf8');
  assert.match(hook, /!macro customInstall/);
  assert.match(hook, /GetCurrentProcessId/);
  assert.match(hook, /LM_UPDATE_HANDOFF_DIR/);
  assert.match(hook, /FileWriteUTF16LE/);
  assert.match(hook, /Rename/);
});
