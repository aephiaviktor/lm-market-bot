'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('updater reports each long-running staging phase to the renderer', () => {
  const main = read('electron/main.js');
  for (const phase of ['downloading', 'extracting', 'dependencies', 'runtime', 'building', 'restarting']) {
    assert.match(main, new RegExp(`emitUpdateProgress\\('${phase}'`));
  }
  assert.match(main, /webContents\.send\('update-progress'/);
});

test('preload exposes update progress and renderer displays its message', () => {
  const preload = read('electron/preload.js');
  const renderer = read('electron/renderer.js');
  assert.match(preload, /onUpdateProgress/);
  assert.match(preload, /ipcRenderer\.on\('update-progress'/);
  assert.match(renderer, /window\.botApi\.onUpdateProgress/);
  assert.match(renderer, /updateMessageEl\.textContent = progress\.message/);
});
