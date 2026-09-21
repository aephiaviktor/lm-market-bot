param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('MUD','ONI','USTUR')][string]$Profile,
    [Parameter(Mandatory = $true)][string]$AppDir,
    [string]$RuntimeDir = '',
    [string]$SharedData = "$env:APPDATA\lm-market-bot",
    [string]$LogDir = "$env:LOCALAPPDATA\LMMarketBot\logs",
    [ValidateRange(1,10)][int]$MaximumRestarts = 10
)
$ErrorActionPreference = 'Stop'
if (-not $RuntimeDir) { $RuntimeDir = $AppDir }
$Profile = $Profile.ToUpperInvariant()
$executable = Join-Path $AppDir "LM Market Bot $Profile.exe"
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Dedicated profile executable not found; shared installation is not supported.' }
$delays = @{ MUD = 60; ONI = 120; USTUR = 180 }
$restartDelay = if ($delays.ContainsKey($Profile)) { $delays[$Profile] } else { 120 }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$logFile = Join-Path $LogDir "supervisor-$Profile.log"
function Write-Log([string]$Message) {
    Add-Content -LiteralPath $logFile -Value ((Get-Date -Format o) + ' ' + $Message)
}
function Wait-UpdateMaintenance {
    $marker = Join-Path (Join-Path $SharedData "profiles\$Profile") 'update-maintenance.json'
    $announced = $false
    while (Test-Path -LiteralPath $marker) {
        # Malformed state fails closed and is logged by the outer error handler.
        $lease = Get-Content -Raw -LiteralPath $marker | ConvertFrom-Json
        if (-not $lease.expiresAt) { throw 'Maintenance lease has no expiry' }
        if ([DateTime]::Parse($lease.expiresAt).ToUniversalTime() -le [DateTime]::UtcNow) {
            Write-Log 'Expired update lease; refusing automatic launch. Operator review required.'
            throw 'Update maintenance expired without completion'
        }
        if (-not $announced) { Write-Log 'Update maintenance active; launch deferred'; $announced = $true }
        Start-Sleep -Seconds 1
    }
}
function Wait-NativeRelaunch([string]$Executable, [int]$Session, [int]$PreviousPid, [int]$TimeoutSeconds = 180) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $matches = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
            $_.ExecutablePath -ieq $Executable -and $_.SessionId -eq $Session -and
            $_.ProcessId -ne $PreviousPid -and $_.CommandLine -and $_.CommandLine -notmatch '--type='
        })
        if ($matches.Count -gt 1) { throw 'Multiple matching main processes; refusing ambiguous supervision' }
        if ($matches.Count -eq 1) {
            $candidate = Get-Process -Id $matches[0].ProcessId -ErrorAction SilentlyContinue
            if ($candidate) {
                # Recheck the live handle to protect against PID reuse between queries.
                $candidateHandle = $candidate.Handle
                if (-not $candidate.HasExited -and $candidate.Path -ieq $Executable -and $candidate.SessionId -eq $Session) {
                    return $candidate
                }
                $candidate.Dispose()
            }
        }
        if ([DateTime]::UtcNow -ge $deadline) { return $null }
        Start-Sleep -Seconds 1
    } while ($true)
}
# One supervisor per profile, even if a task wrapper is restarted independently.
$mutex = New-Object System.Threading.Mutex($false, "Local\LMMarketBotSupervisor-$Profile")
try { $ownsMutex = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
if (-not $ownsMutex) { $mutex.Dispose(); exit 0 }
$restartCount = 0
$nextProcess = $null
$session = (Get-Process -Id $PID).SessionId
while ($true) {
    $process = $null
    try {
        Wait-UpdateMaintenance
        $stamp = Get-Date -Format 'yyyyMMddTHHmmssfff'
        $stdoutLog = Join-Path $LogDir "runtime-$Profile-$stamp.out.log"
        $stderrLog = Join-Path $LogDir "runtime-$Profile-$stamp.err.log"
        if ($nextProcess) {
            $process = $nextProcess
            $nextProcess = $null
            Write-Log "Attached native relaunch PID=$($process.Id)"
        } else {
            Write-Log "Starting LM Market Bot $Profile; attempt $restartCount"
            $process = Start-Process -FilePath $executable -ArgumentList @('--profile', $Profile) -WorkingDirectory $RuntimeDir -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
        }
        # Windows PowerShell can lose ExitCode unless the process handle is retained.
        $handle = $process.Handle
        $process.WaitForExit()
        $exitCode = $process.ExitCode
        if ($null -eq $exitCode) { throw 'Process exit status unavailable' }
        Write-Log "LM Market Bot $Profile exited with code $exitCode"
        if ($exitCode -eq 0) {
            Write-Log 'Clean exit; observing native relaunch for up to 180s (no launch during installation).'
            try { $nextProcess = Wait-NativeRelaunch -Executable $executable -Session $session -PreviousPid $process.Id }
            catch { Write-Log ("Relaunch observation failed; no replacement launched: " + $_.Exception.Message); exit 1 }
            if ($nextProcess) { continue }
            Write-Log 'No native relaunch observed; supervisor stopping without launching a replacement.'
            exit 0
        }
    } catch {
        Write-Log ("Launch/wait failed: " + $_.Exception.ToString())
        # Never spawn a duplicate if observation failed while the child is alive.
        if ($process -and -not $process.HasExited) { Write-Log 'Child still alive; refusing duplicate launch'; exit 1 }
    } finally {
        if ($process) { $process.Dispose() }
    }
    $restartCount++
    if ($restartCount -gt $MaximumRestarts) { Write-Log 'Restart limit reached.'; exit 1 }
    Write-Log "Retry $restartCount/$MaximumRestarts in $restartDelay seconds"
    Start-Sleep -Seconds $restartDelay
}
