'use strict';

const STATUS_WARNING = 'Status details temporarily unavailable; bot lifecycle is unaffected.';

function buildStatusFailureSnapshot(previousSnapshot, { running, version } = {}) {
  const previous = previousSnapshot && typeof previousSnapshot === 'object'
    ? previousSnapshot
    : {};

  return {
    ...previous,
    version: String(version || previous.version || 'unknown'),
    running: running === true,
    statusWarning: STATUS_WARNING,
  };
}

module.exports = {
  STATUS_WARNING,
  buildStatusFailureSnapshot,
};
