'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('packaged updater reports safe stop, official download, and restart phases', () => {
  const main = read('electron/main.js');
  for (const phase of ['stopping-bot', 'checking-release', 'downloading', 'restarting']) {
    assert.match(main, new RegExp(`emitUpdateProgress\\('${phase}'`));
  }
  assert.doesNotMatch(main, /emitUpdateProgress\('extracting'/);
  assert.doesNotMatch(main, /npm.*install|npm.*run.*build/);
});

test('preload exposes update progress and renderer displays its message', () => {
  const preload = read('electron/preload.js');
  const renderer = read('electron/renderer.js');
  assert.match(preload, /onUpdateProgress/);
  assert.match(preload, /ipcRenderer\.on\('update-progress'/);
  assert.match(renderer, /window\.botApi\.onUpdateProgress/);
  assert.match(renderer, /updateMessageEl\.textContent = progress\.message/);
});
