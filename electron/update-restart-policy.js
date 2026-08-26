const fs = require('node:fs');
const path = require('node:path');

const UPDATE_RESTART_REQUEST_FILE = 'update-restart-requested.json';

function getPackagedInstallDirectory(execPath) {
  const value = String(execPath || '').trim();
  if (!value) throw new Error('The packaged executable path is required.');
  return /^[A-Za-z]:[\\/]/.test(value) ? path.win32.dirname(value) : path.dirname(value);
}

function getUpdateRestartRequestPath(runtimeDir) {
  const value = String(runtimeDir || '').trim();
  if (!value) throw new Error('The persistent runtime directory is required.');
  return path.join(value, UPDATE_RESTART_REQUEST_FILE);
}

function buildUpdateRestartRequest({ targetVersion, installDirectory, requestedAt = new Date().toISOString() }) {
  const normalizedVersion = String(targetVersion || '').trim();
  const normalizedDirectory = String(installDirectory || '').trim();
  if (!normalizedVersion) throw new Error('The target update version is required.');
  if (!normalizedDirectory) throw new Error('The update install directory is required.');
  return {
    targetVersion: normalizedVersion,
    installDirectory: normalizedDirectory,
    requestedAt: String(requestedAt),
  };
}

function writeUpdateRestartRequest({ runtimeDir, targetVersion, installDirectory, requestedAt }) {
  const requestPath = getUpdateRestartRequestPath(runtimeDir);
  const request = buildUpdateRestartRequest({ targetVersion, installDirectory, requestedAt });
  fs.mkdirSync(path.dirname(requestPath), { recursive: true });
  fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return requestPath;
}

function consumeSatisfiedUpdateRestartRequest({ runtimeDir, currentVersion, installDirectory }) {
  const requestPath = getUpdateRestartRequestPath(runtimeDir);
  if (!fs.existsSync(requestPath)) return false;

  let request;
  try {
    request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  } catch {
    return false;
  }

  const targetVersion = String(request?.targetVersion || '').trim();
  const targetDirectory = String(request?.installDirectory || '').trim();
  const normalizedCurrentDirectory = path.resolve(String(installDirectory || '').trim());
  const normalizedTargetDirectory = path.resolve(targetDirectory);
  const directoriesMatch = process.platform === 'win32'
    ? normalizedCurrentDirectory.toLowerCase() === normalizedTargetDirectory.toLowerCase()
    : normalizedCurrentDirectory === normalizedTargetDirectory;

  if (targetVersion !== String(currentVersion || '').trim() || !directoriesMatch) return false;
  fs.unlinkSync(requestPath);
  return true;
}

module.exports = {
  UPDATE_RESTART_REQUEST_FILE,
  buildUpdateRestartRequest,
  consumeSatisfiedUpdateRestartRequest,
  getPackagedInstallDirectory,
  getUpdateRestartRequestPath,
  writeUpdateRestartRequest,
};
