const test=require('node:test'),assert=require('node:assert/strict');
const {developmentUpdate}=require('../electron/development-update-source');
test('production metadata cannot activate development routing',()=>assert.equal(developmentUpdate({version:'0.3.2',installationProfile:'MUD'}),null));
test('only explicit MUD test pair is admitted',()=>{
 const a=developmentUpdate({version:'0.3.3-test.3',installationProfile:'MUD',developmentUpdateTest:true});
 assert.equal(a.updateAvailable,true);assert.equal(a.feed.url,'http://127.0.0.1:18765/');
 assert.equal(developmentUpdate({version:'0.3.3-test.4',installationProfile:'MUD',developmentUpdateTest:true}).updateAvailable,false);
 for(const version of ['0.3.2','0.3.3','0.3.3-test.5'])assert.throws(()=>developmentUpdate({version,installationProfile:'MUD',developmentUpdateTest:true}));
 assert.throws(()=>developmentUpdate({version:'0.3.3-test.3',installationProfile:'ONI',developmentUpdateTest:true}));
});
test('normal profile build never embeds development flag',()=>{
 const {buildConfiguration}=require('../scripts/independent-build-config');
 for(const p of ['MUD','ONI','USTUR'])assert.equal(buildConfiguration(p).extraMetadata.developmentUpdateTest,undefined);
});
