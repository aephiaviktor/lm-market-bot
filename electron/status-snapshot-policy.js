'use strict';

function buildAuthoritativeStatusSnapshot(snapshot, running) {
  return {
    ...(snapshot && typeof snapshot === 'object' ? snapshot : {}),
    running: running === true,
  };
}

function buildStatusFailureSnapshot(previousSnapshot, { running, version } = {}) {
  const previous = previousSnapshot && typeof previousSnapshot === 'object'
    ? previousSnapshot
    : {};

  return {
    ...previous,
    version: String(version || previous.version || 'unknown'),
    running: running === true,
  };
}

module.exports = {
  buildAuthoritativeStatusSnapshot,
  buildStatusFailureSnapshot,
};
