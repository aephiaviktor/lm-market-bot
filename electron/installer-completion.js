'use strict';

// The NSIS customInstall hook runs after payload extraction, registry and shortcuts.
// Require its per-handoff marker AND process exit; version visibility alone races extraction.
function buildInstallerCompletionGate() {
  return [
    '$completion = Join-Path $handoff "installer-complete.txt"',
    '$completionDeadline = [DateTime]::UtcNow.AddMinutes(10)',
    'while ($true) {',
    '  if (Test-Path -LiteralPath $completion) {',
    '    $fields = @(Get-Content -LiteralPath $completion -Encoding Unicode)',
    '    if ($fields.Count -ne 4) { throw "Malformed installer completion marker" }',
    '    if ($fields[0] -cne $token -or $fields[2] -ine (Split-Path -Parent $executablePath) -or $fields[3] -cne $targetVersion) { throw "Installer completion identity mismatch" }',
    '    $installerPid = 0',
    '    if (-not [int]::TryParse($fields[1], [ref]$installerPid) -or $installerPid -le 0) { throw "Invalid installer PID" }',
    '    if (-not (Get-Process -Id $installerPid -ErrorAction SilentlyContinue)) { break }',
    '    if ([DateTime]::UtcNow -ge $completionDeadline) { throw "Installer is still running" }',
    '  }',
    '  if ([DateTime]::UtcNow -ge $completionDeadline) { throw "Installer completion timeout" }',
    '  Start-Sleep -Milliseconds 250',
    '}',
    'Log "Installer completion verified"',
  ];
}

module.exports = { buildInstallerCompletionGate };
