const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {waitForHelper,buildHelperLauncher}=require('../electron/update-handshake');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lm-handshake-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const child=new EventEmitter();child.exitCode=null;child.signalCode=null;child.kill=()=>{child.killed=true;};return {dir,child};}
test('helper acknowledgement requires matching token and writes authorization',async t=>{const {dir,child}=fixture(t);fs.writeFileSync(path.join(dir,'helper-started.json'),JSON.stringify({token:'current'}));await waitForHelper(child,dir,'current',path.join(dir,'log'),1000);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'helper-proceed.json'))).token,'current');});
test('stale acknowledgement fails closed without authorization',async t=>{const {dir,child}=fixture(t);fs.writeFileSync(path.join(dir,'helper-started.json'),JSON.stringify({token:'old'}));await assert.rejects(waitForHelper(child,dir,'current',path.join(dir,'log'),20),/acknowledge/);assert.equal(fs.existsSync(path.join(dir,'helper-proceed.json')),false);assert.equal(child.killed,true);});
test('launcher uses a hidden waiting WScript wrapper and rejects quote injection',()=>{assert.match(buildHelperLauncher('C:\\temporary folder\\helper.ps1'),/0, True/);assert.throws(()=>buildHelperLauncher('bad"path'),/Invalid/);});
test('restart script uses acknowledged handoff, exact versions, checked task results and bounded parent wait',()=>{
 const {buildWindowsProfileRestartScript}=require('../electron/shared-update-policy');
 const script=buildWindowsProfileRestartScript({parentPid:123,executablePath:'C:\\app\\bot.exe',targetVersion:'0.3.3',profiles:['MUD'],handoffDirectory:'C:\\temp\\handoff',token:'abc'});
 assert.match(script,/helper-started.json/);
 assert.match(script,/helper-proceed.json/);
 assert.match(script,/Wait-Process -Id 123 -Timeout/);
 assert.doesNotMatch(script,/StartsWith/);
 assert.match(script,/LASTEXITCODE/);
 assert.match(script,/throw 'Timed out waiting for installed version'/);
});
test('supervisor retains handle, captures launch errors and supports update maintenance',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../scripts/lm-market-bot-supervisor.ps1'),'utf8');
 assert.match(s,/\$handle = \$process.Handle/);
 assert.match(s,/catch/);
 assert.match(s,/update-maintenance.json/);
 assert.match(s,/\$null -eq \$exitCode/);
 assert.match(s,/Wait-UpdateMaintenance/);
});
