// Disposable built fixture only, no ASA stack, accounts or database.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { privateSymbols } from './web-private-symbols.mjs';
import { decryptSymbols, symbolize } from './browser-error-symbols.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const revision = process.env.GITHUB_SHA || 'a'.repeat(40);
const temp = mkdtempSync(resolve(tmpdir(), 'asa-browser-error-'));
const output = resolve(temp, 'public'),
  symbols = resolve(temp, 'private');
const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
await build({
  configFile: false,
  root: resolve(repositoryRoot, 'tools/fixtures/browser-error'),
  esbuild: { jsx: 'automatic' },
  define: { __ASA_BUILD_REVISION__: JSON.stringify(revision) },
  plugins: [
    privateSymbols({ revision, repositoryRoot, output: symbols, publicKey: keys.publicKey }),
  ],
  build: { outDir: output, sourcemap: 'hidden', minify: true, emptyOutDir: true },
});
assert.equal(
  readdirSync(resolve(output, 'assets')).some((name) => name.endsWith('.map')),
  false,
);
const archive = decryptSymbols(
  JSON.parse(readFileSync(resolve(symbols, `web-symbols-${revision}.json`), 'utf8')),
  keys.privateKey,
);
const reports = [];
const server = createServer(async (request, response) => {
  if (request.url === '/api/diagnostics/client') {
    let body = '';
    for await (const chunk of request) body += chunk;
    reports.push(JSON.parse(body));
    response.writeHead(202, { 'content-type': 'application/json' });
    response.end('{"accepted":true}');
    return;
  }
  const file =
    request.url === '/'
      ? resolve(output, 'index.html')
      : /^\/assets\/[A-Za-z0-9_.-]+$/.test(request.url || '')
        ? resolve(output, `.${request.url}`)
        : null;
  if (!file || !existsSync(file)) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, {
    'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html',
  });
  response.end(readFileSync(file));
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(4612, '127.0.0.1', resolve);
});
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4612/');
  await page.waitForFunction(() => typeof window.triggerError === 'function');
  const expectedLine =
    readFileSync(resolve(repositoryRoot, 'tools/fixtures/browser-error/entry.tsx'), 'utf8')
      .split('\n')
      .findIndex((line) => line.includes('throw new TypeError')) + 1;
  for (const mode of ['window', 'rejection', 'boundary']) {
    await page.evaluate((mode) => window.triggerError(mode), mode);
    const expectedCode =
      mode === 'window'
        ? 'window_error'
        : mode === 'rejection'
          ? 'unhandled_rejection'
          : 'render_failed';
    await page.waitForFunction(
      (code) =>
        JSON.parse(sessionStorage.getItem('asa:diagnostics:v1') || '[]').every(
          (event) => event.code !== code,
        ),
      expectedCode,
    );
    // Wait on the received report, not elapsed time or a console message.
    const deadline = Date.now() + 5000;
    while (!reports.some((event) => event.code === expectedCode) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    const event = reports.find((event) => event.code === expectedCode);
    assert.ok(event, `Missing ${expectedCode}`);
    assert.equal(event.exception.kind, 'TypeError');
    assert.equal(JSON.stringify(event).includes('PRIVATE-STUDENT-SENTINEL'), false);
    const positions = symbolize(archive, event);
    assert.ok(
      positions.some(
        (position) =>
          position.original.source === 'tools/fixtures/browser-error/entry.tsx' &&
          position.original.line === expectedLine,
      ),
      'Exact throw source line not recovered',
    );
    assert.equal(event.exception.handling, mode === 'boundary' ? 'boundary_fallback' : 'unhandled');
    if (mode === 'boundary')
      await page.getByRole('heading', { name: 'ASA Lab не удалось открыть' }).waitFor();
  }
  console.info(
    JSON.stringify({
      revision,
      browserReports: reports.length,
      exactSourceLine: expectedLine,
      privateTextLeaked: false,
      publicMaps: 0,
      result: 'PASS',
    }),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
