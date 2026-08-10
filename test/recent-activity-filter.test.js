'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('recent activity supports a filled-orders-only filter', () => {
  const html = fs.readFileSync(path.join(__dirname, '../electron/renderer.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '../electron/renderer.js'), 'utf8');
  assert.match(html, /id="recent-activity-filled-only"/);
  assert.match(html, />Only filled orders</);
  assert.match(renderer, /entry\?\.event === 'FILLED'/);
  assert.match(renderer, /filledOnly \? 'No filled orders' : 'No recent activity'/);
});
