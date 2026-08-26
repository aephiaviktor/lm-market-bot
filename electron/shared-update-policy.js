'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SHARED_UPDATE_REQUEST_FILE = 'shared-update-request.json';
const SHARED_UPDATE_ACK_DIRECTORY = 'shared-update-acks';
const RUNTIME_REGISTRY_DIRECTORY = 'runtime-instances';

function sanitizeRuntimeProfile(value) {
  const profile = String(value || '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(profile)) {
    throw new Error('Invalid runtime profile. Use letters, numbers, dots, underscores, or hyphens only.');
  }
  return profile;
}

function getSharedUpdateRequestPath(sharedRuntimeDir) {
  const root = String(sharedRuntimeDir || '').trim();
  if (!root) throw new Error('The shared runtime directory is required.');
  return path.join(root, SHARED_UPDATE_REQUEST_FILE);
}

function getSharedUpdateAckPath(sharedRuntimeDir, profile, pid) {
  const normalizedProfile = sanitizeRuntimeProfile(profile);
  const normalizedPid = Number.parseInt(String(pid), 10);
  if (!Number.isSafeInteger(normalizedPid) || normalizedPid <= 0) throw new Error('A positive runtime pid is required.');
  return path.join(sharedRuntimeDir, SHARED_UPDATE_ACK_DIRECTORY, `${normalizedProfile}-${normalizedPid}.json`);
}

function getRuntimeRegistrationPath(sharedRuntimeDir, profile) {
  return path.join(sharedRuntimeDir, RUNTIME_REGISTRY_DIRECTORY, `${sanitizeRuntimeProfile(profile)}.json`);
}

function normalizeParticipants(participants) {
  const seen = new Set();
  const result = [];
  for (const candidate of Array.isArray(participants) ? participants : []) {
    const profile = sanitizeRuntimeProfile(candidate?.profile);
    const pid = Number.parseInt(String(candidate?.pid), 10);
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`A positive runtime pid is required for ${profile}.`);
    if (seen.has(profile)) continue;
    seen.add(profile);
    result.push({ profile, pid });
  }
  if (!result.length) throw new Error('At least one active runtime profile is required.');
  return result;
}

function buildSharedUpdateRequest({ targetVersion, installDirectory, initiatorProfile, participants, requestedAt = new Date().toISOString() }) {
  const version = String(targetVersion || '').trim();
  const directory = String(installDirectory || '').trim();
  const initiator = sanitizeRuntimeProfile(initiatorProfile);
  if (!version) throw new Error('The target update version is required.');
  if (!directory) throw new Error('The shared install directory is required.');
  const normalizedParticipants = normalizeParticipants(participants);
  if (!normalizedParticipants.some((entry) => entry.profile === initiator)) {
    throw new Error('The initiating runtime must be an update participant.');
  }
  return {
    schemaVersion: 1,
    targetVersion: version,
    installDirectory: directory,
    initiatorProfile: initiator,
    participants: normalizedParticipants,
    requestedAt: String(requestedAt),
  };
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.rmSync(filePath, { force: true });
  fs.renameSync(tempPath, filePath);
}

function writeSharedUpdateRequest(sharedRuntimeDir, request) {
  const requestPath = getSharedUpdateRequestPath(sharedRuntimeDir);
  fs.rmSync(path.join(sharedRuntimeDir, SHARED_UPDATE_ACK_DIRECTORY), { recursive: true, force: true });
  writeJsonAtomic(requestPath, request);
  return requestPath;
}

function readSharedUpdateRequest(sharedRuntimeDir) {
  const requestPath = getSharedUpdateRequestPath(sharedRuntimeDir);
  try {
    return JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  } catch {
    return null;
  }
}

function acknowledgeSharedUpdate(sharedRuntimeDir, profile, pid) {
  const ack = { profile: sanitizeRuntimeProfile(profile), pid: Number(pid), acknowledgedAt: new Date().toISOString() };
  writeJsonAtomic(getSharedUpdateAckPath(sharedRuntimeDir, ack.profile, ack.pid), ack);
  return ack;
}

function readSharedUpdateAcknowledgements(sharedRuntimeDir) {
  const directory = path.join(sharedRuntimeDir, SHARED_UPDATE_ACK_DIRECTORY);
  try {
    return fs.readdirSync(directory).flatMap((name) => {
      try { return [JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))]; } catch { return []; }
    });
  } catch {
    return [];
  }
}

function listPendingProfiles(request, acknowledgements) {
  const acknowledged = new Set((acknowledgements || []).map((entry) => `${entry?.profile}:${Number(entry?.pid)}`));
  return (request?.participants || [])
    .filter((entry) => !acknowledged.has(`${entry.profile}:${Number(entry.pid)}`))
    .map((entry) => entry.profile);
}

function registerRuntime(sharedRuntimeDir, profile, pid, executablePath) {
  const registration = {
    profile: sanitizeRuntimeProfile(profile),
    pid: Number(pid),
    executablePath: String(executablePath || ''),
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(getRuntimeRegistrationPath(sharedRuntimeDir, registration.profile), registration);
  return registration;
}

function listRuntimeRegistrations(sharedRuntimeDir, isPidActive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
}) {
  const directory = path.join(sharedRuntimeDir, RUNTIME_REGISTRY_DIRECTORY);
  try {
    return fs.readdirSync(directory).flatMap((name) => {
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
        return isPidActive(Number(entry.pid)) ? [{ profile: sanitizeRuntimeProfile(entry.profile), pid: Number(entry.pid) }] : [];
      } catch { return []; }
    });
  } catch { return []; }
}

function quotePowerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildWindowsProfileRestartScript({ parentPid, executablePath, targetVersion, profiles }) {
  const pid = Number.parseInt(String(parentPid), 10);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('A positive parent process id is required.');
  const executable = String(executablePath || '').trim();
  const version = String(targetVersion || '').trim();
  if (!executable || !version) throw new Error('Executable path and target version are required.');
  const normalizedProfiles = [...new Set((profiles || []).map(sanitizeRuntimeProfile))];
  if (!normalizedProfiles.length) throw new Error('At least one runtime profile is required.');
  return [
    '$ErrorActionPreference = "Stop"',
    `$parentPid = ${pid}`,
    `$executablePath = ${quotePowerShellLiteral(executable)}`,
    `$targetVersion = ${quotePowerShellLiteral(version)}`,
    `Wait-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    '$deadline = [DateTime]::UtcNow.AddMinutes(10)',
    'while ($true) {',
    '  if (Test-Path $executablePath) {',
    '    $installedVersion = (Get-Item $executablePath).VersionInfo.ProductVersion',
    '    if ($installedVersion -and $installedVersion.StartsWith($targetVersion)) { break }',
    '  }',
    '  if ([DateTime]::UtcNow -ge $deadline) { break }',
    '  Start-Sleep -Seconds 1',
    '}',
    ...normalizedProfiles.map((profile) => `& schtasks.exe /Run /TN ${quotePowerShellLiteral(`LM Market Bot ${profile}`)}`),
  ].join('\r\n');
}

module.exports = {
  SHARED_UPDATE_REQUEST_FILE,
  acknowledgeSharedUpdate,
  buildSharedUpdateRequest,
  buildWindowsProfileRestartScript,
  getRuntimeRegistrationPath,
  getSharedUpdateAckPath,
  getSharedUpdateRequestPath,
  listPendingProfiles,
  listRuntimeRegistrations,
  readSharedUpdateAcknowledgements,
  readSharedUpdateRequest,
  registerRuntime,
  sanitizeRuntimeProfile,
  writeSharedUpdateRequest,
};
