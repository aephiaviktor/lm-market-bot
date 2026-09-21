'use strict';
const semver = require('semver');
function installationIdentity(value) {
  const profile = String(value || '').toUpperCase();
  if (!['MUD', 'ONI', 'USTUR'].includes(profile)) throw new Error('Invalid independent installation profile');
  const slug = profile.toLowerCase();
  return { profile, slug, appId: `com.aephia.lm-market-bot.${slug}`, name: `lm-market-bot-${slug}`, productName: `LM Market Bot ${profile}`, cache: `lm-market-bot-${slug}-updater` };
}
function resolveInstallationProfile(embedded, requested) {
  if (!embedded) return requested;
  const { profile } = installationIdentity(embedded);
  if (requested && requested.toUpperCase() !== profile) throw new Error('This installation belongs to a different profile');
  return profile;
}
function updateFeed(profile, version) {
  const { slug } = installationIdentity(profile);
  if (!semver.valid(version)) throw new Error('Invalid update version');
  return { provider: 'generic', url: `https://github.com/aephiaviktor/lm-market-bot/releases/download/v${version}/`, channel: slug };
}
module.exports = { installationIdentity, resolveInstallationProfile, updateFeed };
