'use strict';
const { build, Platform, Arch } = require('electron-builder');
const { buildConfiguration } = require('./independent-build-config');
async function main() {
  const profiles = process.argv.slice(2);
  if (!profiles.length) profiles.push('MUD', 'ONI', 'USTUR');
  const configs = profiles.map(buildConfiguration); // Validate all before building.
  for (const config of configs) await build({ targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), config, publish: 'never' });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
