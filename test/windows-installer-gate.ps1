param([Parameter(Mandatory=$true)][string]$GateFile, [Parameter(Mandatory=$true)][string]$FixtureDirectory)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Force $FixtureDirectory | Out-Null
$gate=Get-Content -Raw -LiteralPath $GateFile
# Only deadline duration is shortened; no installer/task/application command is run.
$gate=$gate.Replace('AddMinutes(10)', 'AddMilliseconds(150)')
function Log([string]$message) { $script:messages += $message }
function Get-Process { param($Id,$ErrorAction); $script:checks++; if($script:alive){return @{Id=$Id}} }
$cases=@('missing','wrong-token','wrong-path','wrong-version','bad-pid','alive','complete')
foreach($case in $cases) {
 $handoff=Join-Path $FixtureDirectory $case
 New-Item -ItemType Directory -Force $handoff | Out-Null
 $token='current-nonce';$targetVersion='0.3.2';$executablePath='C:\fixture\LM Market Bot.exe'
 $script:messages=@();$script:checks=0;$script:alive=($case -eq 'alive')
 $fields=@($token,'123','C:\fixture',$targetVersion)
 switch($case) {
  'wrong-token' {$fields[0]='old-nonce'}
  'wrong-path' {$fields[2]='C:\other'}
  'wrong-version' {$fields[3]='0.3.20'}
  'bad-pid' {$fields[1]='0'}
 }
 if($case -ne 'missing'){Set-Content -LiteralPath (Join-Path $handoff 'installer-complete.txt') -Encoding Unicode -Value $fields}
 $passed=$false;$failure=''
 try { & ([scriptblock]::Create($gate));$passed=$true } catch { $failure=$_.Exception.Message }
 if($case -eq 'complete') {
  if(-not $passed -or $script:checks -lt 1){throw "Valid completion rejected: $failure"}
 } elseif($passed) {throw "Unsafe completion accepted: $case"}
 "PASS $case $failure"
}
