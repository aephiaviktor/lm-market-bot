const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('production entrypoint has no development source or feed override',()=>{
 const main=fs.readFileSync(require.resolve('../electron/main'),'utf8');
 assert.doesNotMatch(main,/developmentUpdate|update\.feed/);
 assert.match(main,/autoUpdater\.allowPrerelease = false/);
});
test('all production packages exclude test routing and metadata',()=>{
 const {buildConfiguration}=require('../scripts/independent-build-config');
 for(const p of ['MUD','ONI','USTUR']){
  const c=buildConfiguration(p);
  assert(c.files.includes('!electron/development-update-source.js'));
  assert.equal(c.extraMetadata.developmentUpdateTest,undefined);
 }
});
