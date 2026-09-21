# Independent Windows installations (local implementation)

## Build and update model

`npm run dist:win` builds MUD, ONI and USTUR sequentially from the same source/version. For one local artifact: `npm run build && node scripts/build-independent.js MUD`.

Each package has its own application ID (and derived NSIS GUID/registry identity), product/executable name, package name/updater cache, shortcut, output directory, installer filename and update channel. Outputs are `release/<profile-lowercase>/LM-Market-Bot-<PROFILE>-Setup-<version>.exe`, its blockmap and `<profile-lowercase>.yml`. The release workflow expects all nine assets. There is no shared `latest.yml` fallback.

The embedded installationProfile selects the existing `%APPDATA%\lm-market-bot\profiles\<PROFILE>` data path, including settings and encrypted secrets. No data migration or wallet changes are performed. A contradictory `--profile` is rejected. A no-argument NSIS relaunch retains the correct profile. Electron's single-instance lock is acquired after the profile data path is selected; duplicate copies of the same dedicated profile do not start a second bot.

Updates select the current official GitHub release, pin its versioned download URL, select only that installation's channel, download before stopping its own bot, and use electron-updater's native `quitAndInstall(true, true)` (silent install with force-run). No WScript/PowerShell helper, shared update request, peer shutdown, task restart or cross-profile polling remains in the runtime update path. Other dedicated profiles have different executable names, avoiding NSIS name-based process matching against their bots.

Legacy helper modules/fixtures remain in source as historical evidence of the failed local experiment, but are excluded from package files and no longer referenced by main.js. The older shared binary is NOT automatically converted by this code. This modified source refuses in-app independent updates if built without an embedded profile.

## Supervisor

The repository supervisor now requires an explicit AppDir containing `LM Market Bot <PROFILE>.exe`. It has a per-profile Windows mutex, per-profile maintenance path and clean-exit handling. It is NOT installed automatically by NSIS. After a clean app exit, the existing supervisor observes for up to 180 seconds without launching anything. If native NSIS relaunch produces exactly one main process at the dedicated executable path in the same Windows session, it retains that process handle and resumes crash supervision. Renderer processes, other executable paths/sessions and the previous PID are excluded; ambiguous matches or observation errors stop supervision without launching a replacement. The live handle path/session are rechecked against PID reuse. A normal manual close therefore leaves the supervisor observing for up to three minutes, then it exits without reopening the app. If the installer takes longer, or the supervisor was never running, the app may restart unsupervised: this is not an installer success signal. Relaunched process stdout/stderr are not retroactively redirected. No new helper or scheduled-task manipulation is used.

## Migration boundary — NOT executed

Existing shared tasks/binaries remain untouched. A separately approved migration must stop each actual supervisor (not merely its WScript scheduled-task wrapper), safely close each bot, install each dedicated package into its own directory, repoint the matching task and validate one main/supervisor per profile. Never launch old shared and new dedicated instances concurrently: old binaries lack the new singleton guarantee. Preserve existing profile data, verify hashes/backup, and retain the old installation for rollback. Do not uninstall old packages blindly or copy executables into folders and assume registry isolation.

Do not publish this as version 0.3.2 over the existing release. A future approved release needs a fresh version plus all three installers and channels. This local patch deliberately does not bump, commit, push, publish, install or migrate anything.

## Evidence and limits

Source grounding: installed electron-builder 26.15.3 `out/appInfo.js` derives updater cache from package name; `out/publish/updateInfoBuilder.js` writes the configured channel; `templates/nsis/include/allowOnlyOneInstallerInstance.nsh` targets APP_EXECUTABLE_FILENAME. electron-updater 6.8.9 `out/providers/GenericProvider.js` chooses the configured channel; `out/NsisUpdater.js` passes --force-run for the second quitAndInstall argument. Configuration tests invoke builder's actual validator and AppInfo implementation.

Tests cover distinct identities, profile pinning, update feed selection, singleton wiring, supervisor wiring, legacy refusal, download failure and update ordering. Full Windows installer/registry/shortcut/relaunch E2E is NOT validated here. These are local implementation results, not live rollout approval or proof that Windows restart problems are solved.

## Local build follow-up

An actual build exposed electron-builder merging the old base GitHub publish configuration into the generic profile provider. Removed the base publish block; regression coverage now loads the effective disk-plus-override configuration before validating it. The subsequent standard Windows build reached native dependency rebuilding but stopped because bigint-buffer requires source compilation and node-gyp cannot cross-compile it from Linux. No installer artifacts were produced, and native rebuilding was not disabled to mask the error. A native Windows build is still required.

The harmless PowerShell observer fixture stubs process discovery and covers matching, exclusion, ambiguity and PID reuse. Windows refused to execute the unsigned UNC script under its execution policy; no policy was changed or bypassed. Native behavioral results remain unverified.

## Development-only MUD update pair
Explicit workflow_dispatch input `development_pair=true` builds 0.3.3-test.3 and .4 with embedded `developmentUpdateTest:true`; normal build configs do not include this flag. Only those exact versions and MUD are accepted. Test packages use fixed loopback127.0.0.1:18765/mud.yml; no GitHub release discovery, arbitrary URL/env override, or sibling profiles. The same actual download/stop/marker/native-install function is used, allowing prereleases only for marked test packages. Target .4 reports no further update. They must not be used as production replacements; eventual production migration/rollback requires explicit planning.

On the Windows host, during a separately authorized live test only, `node scripts/serve-development-update.js <verified-target-artifact-directory>` serves exactly the .4 installer, blockmap and SHA512 metadata. Verify artifact SHA256 against CI evidence before serving. Server binds loopback only, performs no installation, and is not started by the build. The harness validates the native updater path, NOT official GitHub release discovery. No test feed is running as part of preparation.
