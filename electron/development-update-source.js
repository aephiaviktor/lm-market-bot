'use strict';
// Embedded only by the explicitly selected development-pair build; no environment override.
function developmentUpdate(pkg) {
  if (pkg.developmentUpdateTest !== true) return null;
  if (pkg.installationProfile !== 'MUD' || !['0.3.3-test.3','0.3.3-test.4'].includes(pkg.version)) {
    throw new Error('Invalid development update test identity');
  }
  return { currentVersion: pkg.version, latestVersion: '0.3.3-test.4',
    updateAvailable: pkg.version === '0.3.3-test.3', restoreOfficial: false,
    releaseUrl: 'http://127.0.0.1:18765/',
    feed: { provider: 'generic', url: 'http://127.0.0.1:18765/', channel: 'mud' } };
}
module.exports = { developmentUpdate };
