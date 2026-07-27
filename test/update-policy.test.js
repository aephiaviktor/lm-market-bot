'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWindowsTransactionalUpdateScript, compareVersions, normalizeVersion } = require('../electron/update-policy');

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
  });
  assert.ok(script.indexOf('Wait-Process') < script.indexOf('Move-Item -Path $appRoot'));
  assert.match(script, /\.update-release\.json/);
  assert.match(script, /\.rollback/);
  assert.match(script, /Move-Item -Path \$backupRoot -Destination \$appRoot/);
  assert.match(script, /schtasks\.exe \/Run \/TN \$taskName/);
  assert.match(script, /LM Market Bot MUD/);
  assert.match(script, /MUD''s/);
});

test('transactional updater rejects invalid process and task identity', () => {
  assert.throws(() => buildWindowsTransactionalUpdateScript({ appRoot: 'x', stagedRoot: 'y', parentPid: 0, taskName: 'x' }), /positive/);
  assert.throws(() => buildWindowsTransactionalUpdateScript({ appRoot: 'x', stagedRoot: 'y', parentPid: 1, taskName: '' }), /task name/);
});
