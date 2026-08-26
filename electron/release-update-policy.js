'use strict';

const semver = require('semver');

function normalizeAppVersion(value) {
  const normalized = semver.valid(String(value || '').trim().replace(/^v/i, ''));
  if (!normalized) throw new Error(`Invalid application version: ${value}`);
  return normalized;
}

function determineReleaseAction(currentVersion, latestOfficialVersion) {
  const current = normalizeAppVersion(currentVersion);
  const latest = normalizeAppVersion(latestOfficialVersion);
  const comparison = semver.compare(current, latest);

  if (comparison < 0) return { action: 'update', currentVersion: current, latestVersion: latest };
  if (comparison > 0) return { action: 'restore', currentVersion: current, latestVersion: latest };
  return { action: 'none', currentVersion: current, latestVersion: latest };
}

module.exports = {
  determineReleaseAction,
  normalizeAppVersion,
};
