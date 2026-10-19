import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// This named qualification selects the same complete suite as the strict gate.
// It changes only the three recorded comparison sites in ready-cadence; the
// browser, product clock and all other assertions receive no alternate runner.
if (process.argv.length !== 2) {
  throw new Error('The classroom browser gate accepts no filters or extra arguments.');
}
const profile = 'classroom-d13-v2';
const entrypoint = 'gate:electronics-classroom-d13:browser';
if (process.env.npm_lifecycle_event !== entrypoint) {
  throw new Error('Invoke the explicitly named classroom browser gate through pnpm.');
}
if (process.env.ASA_ELECTRONICS_QUALIFICATION_ENTRYPOINT !== undefined) {
  throw new Error('Do not inherit an alternate qualification entrypoint.');
}
const suppliedProfile = process.env.ASA_ELECTRONICS_QUALIFICATION_PROFILE;
if (suppliedProfile !== undefined && suppliedProfile !== profile) {
  throw new Error('Conflicting or unknown Electronics qualification profile.');
}
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli || !isAbsolute(pnpmCli)) {
  throw new Error('Run this gate through pnpm; its absolute npm_execpath is required.');
}
const child = spawn(process.execPath, [pnpmCli, 'e2e:electronics-simulation'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: {
    ...process.env,
    ASA_ELECTRONICS_QUALIFICATION_PROFILE: profile,
    ASA_ELECTRONICS_QUALIFICATION_ENTRYPOINT: entrypoint,
  },
  stdio: 'inherit',
});
let failedToStart = false;
child.on('error', (error) => {
  failedToStart = true;
  console.error(`Classroom browser process could not start: ${error.message}`);
  process.exitCode = 1;
});
child.on('close', (code, signal) => {
  if (signal) console.error(`Classroom browser process ended with signal ${signal}.`);
  process.exitCode = failedToStart ? 1 : (code ?? 1);
});
