# Harmless fixture: extract only the observer function; stub all process discovery.
$ErrorActionPreference = 'Stop'
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../scripts/lm-market-bot-supervisor.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
$fn=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Wait-NativeRelaunch'},$true)
if(-not $fn){throw 'Observer missing'}
Invoke-Expression $fn.Extent.Text
function Get-CimInstance { param($ClassName,$ErrorAction) return $script:rows }
function Get-Process { param($Id,$ErrorAction) return $script:candidate }
function Start-Sleep { throw 'Zero-timeout fixture must not sleep' }
function Row($id,$path,$session,$cmd) { [pscustomobject]@{ProcessId=$id;ExecutablePath=$path;SessionId=$session;CommandLine=$cmd} }
$exe='C:\isolated\LM Market Bot MUD.exe'
$script:candidate=[pscustomobject]@{Id=42;Handle=123;HasExited=$false;Path=$exe;SessionId=7}
$script:candidate|Add-Member ScriptMethod Dispose {}
$script:rows=@(Row 42 $exe 7 '"bot.exe"')
$result=Wait-NativeRelaunch $exe 7 10 0
if($result.Id -ne 42){throw 'Matching relaunch not attached'}
Write-Output 'PASS matching dedicated main attached'
$script:rows=@((Row 43 'C:\other\LM Market Bot ONI.exe' 7 'bot'),(Row 44 $exe 7 'bot --type=renderer'),(Row 45 $exe 8 'bot'),(Row 10 $exe 7 'bot'))
if($null -ne (Wait-NativeRelaunch $exe 7 10 0)){throw 'Sibling/renderer/session/previous PID was accepted'}
Write-Output 'PASS sibling, renderer, other session and previous PID excluded; timeout returns no launch'
$script:rows=@((Row 42 $exe 7 'bot'),(Row 46 $exe 7 'bot'))
$rejected=$false
try { Wait-NativeRelaunch $exe 7 10 0|Out-Null } catch { if($_ -match 'Multiple matching'){ $rejected=$true } else { throw } }
if(-not $rejected){throw 'Ambiguous processes accepted'}
Write-Output 'PASS duplicate mains fail closed'
$script:rows=@(Row 42 $exe 7 'bot')
$script:candidate.Path='C:\other\reused-pid.exe'
if($null -ne (Wait-NativeRelaunch $exe 7 10 0)){throw 'Reused PID accepted'}
Write-Output 'PASS live handle path mismatch rejected'
