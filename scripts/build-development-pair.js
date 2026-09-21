'use strict';
const {build,Platform,Arch}=require('electron-builder');
const {buildConfiguration}=require('./independent-build-config');
async function main(){
 throw new Error('Historical test harness: use commit dad0406; production routing has been removed.');
 for(const version of ['0.3.3-test.3','0.3.3-test.4']){
  const config=buildConfiguration('MUD');
  config.extraMetadata={...config.extraMetadata,version,developmentUpdateTest:true};
  config.directories.output=`release/${version}/mud`;
  await build({targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),config,publish:'never'});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
