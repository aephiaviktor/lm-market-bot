> HISTORICAL — superseded by [independent installations](INDEPENDENT-INSTALLATIONS.md). The helper failed the live test; this design is not active or approved for deployment. Retained for investigation only.

# Windows restart recovery — local patch

The application and the external supervisor must be reviewed/deployed together. The NSIS app package does **not** install `scripts/lm-market-bot-supervisor.ps1`. No automatic supervisor migration is included.

- A unique WScript/PowerShell helper uses token-bound startup/proceed markers before the application quits. Startup failure keeps the UI open (the trading loop may already be stopped; operator can resume it).
- An exclusive shared `update-maintenance.json` lease prevents concurrent handoffs. The updated supervisor suppresses launching during that lease. Failure before handoff removes the request/lease and requests peer recovery.
- The helper waits at most 120 seconds for parent exit, then requires the token/version/install-directory-bound NSIS payload-completion marker and the reported installer process to exit before verifying the exact executable version. It releases only its own lease, requests profile tasks sequentially and observes one responsive profile main window per profile (120 seconds each). Failures remain in `update-handoff-*/restart.log`.
- The supervisor retains the process handle for reliable exit codes, records launch/wait exceptions, preserves per-attempt stdout/stderr, and bounds retries. Expired or malformed maintenance fails closed rather than starting against an uncertain install. An expired lease requires operator inspection, not blind deletion.

## Validation boundary

Local Node tests and harmless native Windows fixtures cover handshake survival, clean exit handling, launch failure logging, bounded retries, maintenance suppression and PowerShell syntax. Tests do not invoke real scheduled tasks, install NSIS, change registry entries, use wallets or submit transactions.

Full packaged Electron→NSIS→multi-profile restart remains **unverified**. The local timing fix now uses `customInstall` (after payload/registry/shortcuts) plus installer process exit, not executable visibility alone. NSIS environment inheritance across elevation/fallback paths remains unverified: a missing marker fails closed. Responsive windows do not prove trading-cycle health. This patch must not be described as deployment-ready until the complete installer lifecycle is validated in a genuinely isolated environment. No automatic rollback is implemented.

## Timing-gate evidence (local only)

- Hook compiled with cached NSIS 3.0.4.1 in a minimal compile-only fixture; generated EXE was **not executed**.
- Native PowerShell fixture rejects missing completion, wrong token/path/version, invalid PID and still-running installer; accepts matched completion after process absence. Process observation is stubbed, no real installer or scheduled task is run.
- The marker is UTF-16LE, atomically renamed, and unique to the current handoff. Manual installs without the updater environment do not emit it.
- This requires a target installer containing the hook. Restoring an older hook-less release fails closed and needs a separately authorized manual recovery. Existing running older app versions also still use their old updater: installing this patch cannot retroactively fix the initiating old updater.

Source reviewed: electron-builder tag `electron-builder@26.15.3`, `packages/app-builder-lib/templates/nsis/installSection.nsh` (`customInstall` placement), `packages/app-builder-lib/src/targets/nsis/NsisTarget.ts` (`VERSION`), and `packages/electron-updater/src/NsisUpdater.ts` (installer launch/elevation/fallback). No updater dependency was changed.
