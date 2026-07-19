#!/usr/bin/env node
// TST-PORTS-001: canonical port policy verification (LOCAL_PORT_POLICY.md).
// Static: first-party runtime configs/scripts/READMEs reference only canonical
// ports; forbidden legacy ports are absent. Dynamic: a harmless listener is
// opened on the canonical API port, the real dev command is executed and must
// exit with BLOCKED (78) while the listener stays alive; only our own listener
// is closed afterwards. Nothing is ever probed or killed on foreign ports.
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { spawnSync } from 'node:child_process';

const SCAN_FILES = [
  'package.json',
  'README.md',
  'apps/web/README.md',
  'apps/api/README.md',
  'apps/web/vite.config.ts',
  'apps/api/src/main.ts',
  'playwright.config.ts',
  'e2e/server.mjs',
  'tools/dev.mjs',
  'tools/check-startup.mjs',
  'tools/seed-dev.mjs',
];
const FORBIDDEN = ['5173', '3000', '3100'];
const REQUIRED = [
  ['apps/web/vite.config.ts', '4610'],
  ['apps/web/vite.config.ts', '4611'],
  ['apps/api/src/main.ts', '4611'],
  ['playwright.config.ts', '4612'],
  ['e2e/server.mjs', '4612'],
  ['tools/dev.mjs', '4610'],
  ['tools/dev.mjs', '4611'],
];

let failures = 0;
for (const file of SCAN_FILES) {
  // Deny-list declarations (lines mentioning FORBIDDEN) are the one legitimate
  // place these numbers may appear: they exist to reject the ports.
  const lines = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !/forbidden/i.test(line));
  const text = lines.join('\n');
  for (const port of FORBIDDEN) {
    const pattern = new RegExp(`(?<![0-9.])${port}(?![0-9])`);
    if (pattern.test(text)) {
      console.error(`FAIL: forbidden port ${port} referenced in ${file}`);
      failures += 1;
    }
  }
}
for (const [file, port] of REQUIRED) {
  if (!readFileSync(file, 'utf8').includes(port)) {
    console.error(`FAIL: canonical port ${port} missing from ${file}`);
    failures += 1;
  }
}

// Dynamic occupied-port safety proof on the canonical API port only.
const API_PORT = 4611;
const listener = net.createServer();
const listenState = await new Promise((resolvePromise) => {
  listener
    .once('error', () => resolvePromise('busy'))
    .once('listening', () => resolvePromise('ok'))
    .listen(API_PORT, '127.0.0.1');
});
if (listenState !== 'ok') {
  console.error(
    `BLOCKED: canonical port ${API_PORT} already occupied by another process; not touching it`,
  );
  process.exit(78);
}
try {
  const result = spawnSync('node', ['tools/dev.mjs'], {
    encoding: 'utf8',
    timeout: 60000,
    shell: false,
  });
  if (result.status !== 78) {
    console.error(
      `FAIL: dev command on an occupied canonical port must exit 78, got ${result.status}\n${(result.stderr ?? '').slice(-300)}`,
    );
    failures += 1;
  } else if (!listener.listening) {
    console.error('FAIL: our listener was terminated by the dev command');
    failures += 1;
  } else {
    console.log(`occupied-port safety: dev exits 78 on busy ${API_PORT}, listener untouched`);
  }
} finally {
  listener.close();
}

if (failures > 0) {
  console.error(`ports:check FAIL (${failures} violation(s))`);
  process.exit(1);
}
console.log(
  'ports:check PASS (canonical 4610/4611/4612; forbidden legacy ports absent; occupied-port safety proven)',
);
