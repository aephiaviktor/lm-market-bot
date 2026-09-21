const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function waitForHelper(helper, directory, token, logPath, timeoutMs = 15000) {
  let failure;
  const onError = error => { failure = error; };
  const onExit = (code, signal) => { failure = new Error(`Update helper exited before handoff (code=${code}, signal=${signal}).`); };
  helper.on('error', onError);
  helper.on('exit', onExit);
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (helper.exitCode !== null || helper.signalCode !== null) throw new Error('Update helper exited before handoff.');
      let marker;
      try { marker = JSON.parse((await fs.readFile(path.join(directory, 'helper-started.json'), 'utf8')).replace(/^\uFEFF/, '')); }
      catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      if (marker?.token === token) {
        const proceed = path.join(directory, 'helper-proceed.json');
        await fs.writeFile(`${proceed}.tmp`, JSON.stringify({ token }), { mode: 0o600 });
        if (failure) throw failure;
        await fs.rename(`${proceed}.tmp`, proceed);
        return;
      }
      await delay(100);
    }
    throw new Error('Update helper did not acknowledge startup; application kept open.');
  } catch (error) {
    helper.kill();
    await fs.appendFile(logPath, `${new Date().toISOString()} helper-handoff-failed ${error.message}\n`).catch(() => {});
    throw error;
  } finally {
    helper.removeListener('error', onError);
    helper.removeListener('exit', onExit);
  }
}
function buildHelperLauncher(scriptPath) {
  if (/[\r\n"]/.test(scriptPath)) throw new Error('Invalid helper script path.');
  const command = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`;
  // Wait keeps the launcher handle meaningful until PowerShell actually exits.
  return `WScript.Quit CreateObject("WScript.Shell").Run("${command.replaceAll('"', '""')}", 0, True)\r\n`;
}
module.exports = { waitForHelper, buildHelperLauncher };
