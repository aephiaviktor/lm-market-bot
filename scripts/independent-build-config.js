'use strict';
const { installationIdentity } = require('../electron/installation-policy');
function buildConfiguration(profile) {
  const id = installationIdentity(profile);
  const base = structuredClone(require('../package.json').build);
  delete base.nsis.include;
  return { ...base, files: [...base.files, '!electron/development-update-source.js'], appId: id.appId, productName: id.productName,
    artifactName: `LM-Market-Bot-${id.profile}-Setup-\${version}.\${ext}`,
    directories: { ...base.directories, output: `release/${id.slug}` },
    extraMetadata: { name: id.name, installationProfile: id.profile },
    win: { ...base.win, executableName: id.productName },
    publish: [{ provider: 'generic', url: 'https://github.com/aephiaviktor/lm-market-bot/releases/latest/download/', channel: id.slug }],
  };
}
module.exports = { buildConfiguration };
