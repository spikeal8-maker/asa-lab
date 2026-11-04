// Match Vite's build-revision fallback without shell-specific inline quoting.
import { execFileSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';

let revision = process.env['VITE_ASA_BUILD_REVISION']?.trim();
if (!revision) {
  try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    revision = 'development';
  }
}
process.stdout.write(revision);
