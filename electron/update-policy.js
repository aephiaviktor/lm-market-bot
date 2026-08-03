'use strict';

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function compareVersions(a, b) {
  const left = normalizeVersion(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = normalizeVersion(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return 1;
    if ((left[index] || 0) < (right[index] || 0)) return -1;
  }
  return 0;
}

function quotePowerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildWindowsTransactionalUpdateScript({ appRoot, stagedRoot, parentPid, taskName, readyFile }) {
  const pid = Number.parseInt(String(parentPid), 10);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('A positive parent process id is required.');
  if (!taskName) throw new Error('A scheduled task name is required.');
  if (!readyFile) throw new Error('A readiness file is required.');

  return [
    '$ErrorActionPreference = "Stop"',
    `$appRoot = ${quotePowerShellLiteral(appRoot)}`,
    `$stagedRoot = ${quotePowerShellLiteral(stagedRoot)}`,
    `$parentPid = ${pid}`,
    `$taskName = ${quotePowerShellLiteral(taskName)}`,
    `$readyFile = ${quotePowerShellLiteral(readyFile)}`,
    '$backupRoot = $appRoot + ".rollback"',
    '$manifestPath = Join-Path $stagedRoot ".update-release.json"',
    '$stagedNodeModules = Join-Path $stagedRoot "node_modules"',
    '$backupNodeModules = Join-Path $backupRoot "node_modules"',
    '$stagedElectron = Join-Path $stagedRoot "node_modules\\electron\\dist\\electron.exe"',
    '$logDir = Join-Path $env:LOCALAPPDATA "LMMarketBot\\logs"',
    '$logFile = Join-Path $logDir "updater.log"',
    'New-Item -ItemType Directory -Force -Path $logDir | Out-Null',
    'Set-Content -Path $readyFile -Value $PID',
    'function Write-UpdateLog([string]$message) { Add-Content -Path $logFile -Value ("{0:o} {1}" -f (Get-Date), $message) }',
    'try {',
    '  Write-UpdateLog "Waiting for LM Market Bot to exit"',
    '  Wait-Process -Id $parentPid -ErrorAction SilentlyContinue',
    '  Write-UpdateLog "Waiting for scheduled task to become Ready"',
    '  $taskReadyDeadline = [DateTime]::UtcNow.AddSeconds(30)',
    '  while ($true) {',
    '    $taskState = (Get-ScheduledTask -TaskName $taskName -ErrorAction Stop).State',
    '    if ($taskState -eq "Ready") { break }',
    '    if ([DateTime]::UtcNow -ge $taskReadyDeadline) {',
    '      throw "Timed out waiting for scheduled task $taskName to become Ready; current state: $taskState"',
    '    }',
    '    Start-Sleep -Milliseconds 250',
    '  }',
    '  Write-UpdateLog "Scheduled task is Ready"',
    '  if (-not (Test-Path $manifestPath)) { throw "Staged release manifest is missing" }',
    '  $manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json',
    '  $reuseDependencies = [bool]$manifest.reuseDependencies',
    '  if (-not (Test-Path $stagedElectron)) { throw "Staged Electron executable is missing" }',
    '  if ($reuseDependencies) { [System.IO.Directory]::Delete($stagedNodeModules) }',
    '  if (Test-Path $backupRoot) { Remove-Item -Recurse -Force $backupRoot }',
    '  $moveDeadline = (Get-Date).AddSeconds(30)',
    '  while ($true) {',
    '    try {',
    '      Move-Item -Path $appRoot -Destination $backupRoot',
    '      break',
    '    } catch {',
    '      if ((Get-Date) -ge $moveDeadline) { throw }',
    '      Start-Sleep -Milliseconds 500',
    '    }',
    '  }',
    '  try {',
    '    if ($reuseDependencies) {',
    '      if (-not (Test-Path $backupNodeModules)) { throw "Installed dependency folder is missing from rollback release" }',
    '      Move-Item -Path $backupNodeModules -Destination $stagedNodeModules',
    '    }',
    '    Move-Item -Path $stagedRoot -Destination $appRoot',
    '    $oldAnalysis = Join-Path $backupRoot "analysis"',
    '    if (Test-Path $oldAnalysis) { Move-Item -Path $oldAnalysis -Destination (Join-Path $appRoot "analysis") }',
    '    Write-UpdateLog "Release swap completed; starting scheduled task"',
    '    & schtasks.exe /Run /TN $taskName *>> $logFile',
    '    if ($LASTEXITCODE -ne 0) { throw "Scheduled task restart failed with exit code $LASTEXITCODE" }',
    '  } catch {',
    '    Write-UpdateLog ("New release failed; rolling back: " + $_.Exception.Message)',
    '    if ($reuseDependencies -and -not (Test-Path $backupNodeModules)) {',
    '      $activeNodeModules = if (Test-Path (Join-Path $appRoot "node_modules")) { Join-Path $appRoot "node_modules" } else { Join-Path $stagedRoot "node_modules" }',
    '      if (Test-Path $activeNodeModules) { Move-Item -Path $activeNodeModules -Destination $backupNodeModules }',
    '    }',
    '    if (Test-Path $appRoot) { Remove-Item -Recurse -Force $appRoot }',
    '    Move-Item -Path $backupRoot -Destination $appRoot',
    '    & schtasks.exe /Run /TN $taskName *>> $logFile',
    '    throw',
    '  }',
    '} catch {',
    '  Write-UpdateLog ("Update failed: " + $_.Exception.Message)',
    '  if (Test-Path $appRoot) { & schtasks.exe /Run /TN $taskName *>> $logFile }',
    '  exit 1',
    '}',
  ].join('\r\n');
}

function buildWindowsUpdaterLauncher({ powershellPath, scriptPath }) {
  const quoteVbs = (value) => String(value).replace(/"/g, '""');
  const command = `"${powershellPath}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`;
  return [
    'Set shell = CreateObject("WScript.Shell")',
    `exitCode = shell.Run("${quoteVbs(command)}", 0, False)`,
    'WScript.Quit exitCode',
  ].join('\r\n');
}

module.exports = { buildWindowsTransactionalUpdateScript, buildWindowsUpdaterLauncher, compareVersions, normalizeVersion };
