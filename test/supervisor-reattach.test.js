const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('clean exit observes installer relaunch without starting a replacement',()=>{
 const s=fs.readFileSync('scripts/lm-market-bot-supervisor.ps1','utf8');
 assert.match(s,/function Wait-NativeRelaunch/);
 assert.match(s,/ExecutablePath -ieq \$Executable/);
 assert.match(s,/SessionId -eq \$Session/);
 assert.match(s,/Count -gt 1/);
 assert.match(s,/\$nextProcess = Wait-NativeRelaunch/);
 assert.match(s,/if \(\$nextProcess\)/);
 const f=s.slice(s.indexOf('function Wait-NativeRelaunch'),s.indexOf('# One supervisor'));
 assert.doesNotMatch(f,/Start-Process|Stop-Process/);
});
