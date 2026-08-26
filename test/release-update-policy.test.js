const assert = require('node:assert/strict');
const test = require('node:test');
const { determineReleaseAction, normalizeAppVersion } = require('../electron/release-update-policy');

test('release policy updates only from newer published semantic versions', () => {
  assert.deepEqual(determineReleaseAction('0.2.96', 'v0.2.97'), {
    action: 'update', currentVersion: '0.2.96', latestVersion: '0.2.97',
  });
  assert.deepEqual(determineReleaseAction('0.2.97', 'v0.2.97'), {
    action: 'none', currentVersion: '0.2.97', latestVersion: '0.2.97',
  });
});

test('release policy can restore a development build newer than the official release', () => {
  assert.equal(determineReleaseAction('0.2.98', '0.2.97').action, 'restore');
});

test('release policy rejects malformed release tags', () => {
  assert.throws(() => normalizeAppVersion('main'), /Invalid application version/);
});
