'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWindowsTransactionalUpdateScript, buildWindowsUpdaterLauncher, compareVersions, normalizeVersion } = require('../electron/update-policy');

test('version policy compares normalized versions', () => {
  assert.equal(normalizeVersion(' v0.2.76 '), '0.2.76');
  assert.equal(compareVersions('0.2.76', '0.2.75'), 1);
  assert.equal(compareVersions('0.2.75', '0.2.75'), 0);
});

test('transactional updater waits, swaps, restarts, and rolls back on failure', () => {
  const script = buildWindowsTransactionalUpdateScript({
    appRoot: "C:\\Apps\\lm-market-bot-MUD's",
    stagedRoot: 'C:\\Apps\\.stage\\release',
    parentPid: 4321,
    taskName: 'LM Market Bot MUD',
    readyFile: 'C:\\Apps\\.stage\\helper-ready',
  });
  assert.ok(script.indexOf('Wait-Process') < script.indexOf('Move-Item -Path $appRoot'));
  assert.match(script, /\.update-release\.json/);
  assert.match(script, /ConvertFrom-Json/);
  assert.match(script, /\$reuseDependencies/);
  assert.match(script, /\[System\.IO\.Directory\]::Delete\(\$stagedNodeModules\)/);
  assert.match(script, /Move-Item -Path \$backupNodeModules -Destination \$stagedNodeModules/);
  assert.match(script, /Move-Item -Path \$activeNodeModules -Destination \$backupNodeModules/);
  assert.match(script, /node_modules\\electron\\dist\\electron\.exe/);
  assert.match(script, /Staged Electron executable is missing/);
  assert.ok(script.indexOf('Staged Electron executable is missing') < script.indexOf('Move-Item -Path $appRoot'));
  assert.match(script, /AddSeconds\(30\)/);
  assert.match(script, /Start-Sleep -Milliseconds 500/);
  assert.match(script, /\.rollback/);
  assert.match(script, /Move-Item -Path \$backupRoot -Destination \$appRoot/);
  assert.match(script, /schtasks\.exe \/Run \/TN \$taskName/);
  assert.match(script, /LM Market Bot MUD/);
  assert.match(script, /MUD''s/);
  assert.ok(script.indexOf('Set-Content -Path $readyFile') < script.indexOf('Wait-Process'));
});

test('updater stages development dependencies and validates the Electron runtime', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '../electron/main.js'), 'utf8');
  assert.match(main, /\['install', '--include=dev', '--no-audit', '--no-fund'\]/);
  assert.match(main, /\['run', 'ensure-electron-runtime'\]/);
  assert.match(main, /stagedRoot, 'node_modules', 'electron', 'dist', 'electron\.exe'/);
  const packageJson = require('../package.json');
  assert.match(packageJson.dependencies.electron, /^\^42\./);
  assert.equal(packageJson.devDependencies?.electron, undefined);
  assert.equal(packageJson.scripts['ensure-electron-runtime'], 'node node_modules/electron/install.js');
  assert.equal(packageJson.scripts.postinstall, 'npm run ensure-electron-runtime');
  assert.match(main, /canReuseInstalledDependencies/);
  assert.match(main, /fs\.symlink\(/);
  assert.match(main, /'junction'/);
  assert.match(main, /reuseDependencies/);
});

test('Windows updater launcher starts PowerShell asynchronously through WScript', () => {
  const launcher = buildWindowsUpdaterLauncher({
    powershellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    scriptPath: 'C:\\Apps\\stage with spaces\\finish-update.ps1',
  });
  assert.match(launcher, /WScript\.Shell/);
  assert.match(launcher, /, 0, False\)/);
  assert.match(launcher, /-File/);
  assert.match(launcher, /stage with spaces/);
});

test('transactional updater rejects invalid process and task identity', () => {
  assert.throws(() => buildWindowsTransactionalUpdateScript({ appRoot: 'x', stagedRoot: 'y', parentPid: 0, taskName: 'x', readyFile: 'z' }), /positive/);
  assert.throws(() => buildWindowsTransactionalUpdateScript({ appRoot: 'x', stagedRoot: 'y', parentPid: 1, taskName: '', readyFile: 'z' }), /task name/);
  assert.throws(() => buildWindowsTransactionalUpdateScript({ appRoot: 'x', stagedRoot: 'y', parentPid: 1, taskName: 'x', readyFile: '' }), /readiness file/);
});
