import fs from 'node:fs';
import http from 'node:http';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { chromium } from '@playwright/test';
import { runtimeUrl, parentPort, parentOrigin, projectId } from './protocol.mjs';

export async function createProtocolFixture(options = {}) {
  const repoRoot = new URL('../../../', import.meta.url);
  const checkedSources = [
    'infra/scratch-editor/host/protocol.js',
    'infra/scratch-editor/host/status.js',
    'infra/scratch-editor/host/main.js',
    'infra/scratch-editor/host/storage.js',
    'infra/scratch-editor/host/editor.js',
    'apps/web/src/blocks/runtime-protocol.ts',
    'apps/web/src/blocks/runtime-session.ts',
    'apps/web/src/blocks/BlocksEditor.tsx',
  ];
  for (const relative of checkedSources) {
    const text = fs.readFileSync(new URL(relative, repoRoot), 'utf8');
    for (const forbidden of [
      'localStorage',
      'sessionStorage',
      'indexedDB',
      "postMessage('*')",
      'postMessage("*")',
    ]) {
      if (text.includes(forbidden))
        throw new Error(`${relative} contains forbidden protocol text: ${forbidden}`);
    }
  }

  const blocksShellCss = fs.readFileSync(
    new URL('apps/web/src/blocks/blocks-editor-shell.css', repoRoot),
    'utf8',
  );
  const parentHtml = `<!doctype html><html><head><style>
html, body { margin: 0; width: 100%; height: 100%; font: 14px system-ui; }
body { overflow: hidden; }
${blocksShellCss}
#runtime-frame { border: 0; width: 100%; height: 100%; }
#attacker-frame { display: none; }
</style></head><body data-parent-state="alive">
<section class="blocks-editor-shell" data-asa-blocks-editor-shell>
  <div class="blocks-editor-runtime" data-asa-blocks-runtime-slot>
    <iframe id="runtime-frame" title="Scratch runtime" src="${runtimeUrl}/"></iframe>
  </div>
  <button type="button" class="blocks-editor-account" aria-label="Открыть аккаунт: Пользователь ASA Lab" data-asa-blocks-account-overlay>
    <span class="blocks-editor-account-initials" aria-hidden="true">АС</span>
  </button>
</section>
<iframe id="attacker-frame" src="/attacker"></iframe>
<script>
window.__blocksMessages = [];
const runtimeOrigin = ${JSON.stringify(runtimeUrl)};
const runtimeFrame = document.getElementById('runtime-frame');
const attackerFrame = document.getElementById('attacker-frame');
window.addEventListener('message', (event) => {
  if (event.source !== runtimeFrame.contentWindow || event.origin !== runtimeOrigin) return;
  window.__blocksMessages.push(event.data);
  if (event.data?.messageType === 'ASA_BLOCKS_FATAL') {
    document.body.dataset.parentState = 'fatal';
  }
});
window.sendToRuntime = (payload) => runtimeFrame.contentWindow.postMessage(payload, runtimeOrigin);
window.sendFromAttacker = (payload) => attackerFrame.contentWindow.postMessage(
  { command: 'relay', payload, runtimeOrigin },
  window.location.origin,
);
</script></body></html>`;

  const attackerHtml = `<!doctype html><html><body><script>
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.data?.command !== 'relay') return;
  const target = window.parent.document.getElementById('runtime-frame').contentWindow;
  target.postMessage(event.data.payload, event.data.runtimeOrigin);
});
</script></body></html>`;

  const product = options.product
    ? await (await import('./product-bundle.mjs')).productFiles()
    : null;
  const runtimeSession = options.runtimeSession ?? {
    draftRevision: 0,
    projectJson: null,
    assets: [],
  };
  const runtimeAssets = options.runtimeAssets ?? new Map();
  const runtimeAssetEvidence = [];
  let runtimeSessionSequence = 0;
  const runtimeSessionPath = `/api/projects/${projectId}/blocks/runtime-session`;
  const runtimeAssetPrefix = `/api/blocks/runtime/projects/${projectId}/assets/`;

  const applyRuntimeCors = (request, response) => {
    if (request.headers.origin !== runtimeUrl) return false;
    response.setHeader('Access-Control-Allow-Origin', runtimeUrl);
    response.setHeader('Vary', 'Origin');
    return true;
  };

  const server = http.createServer((request, response) => {
    const requestUrl = request.url ?? '/';

    if (product && request.method === 'POST' && requestUrl === runtimeSessionPath) {
      runtimeSessionSequence += 1;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(
        JSON.stringify({
          ...runtimeSession,
          runtimeOrigin: runtimeUrl,
          runtimeToken: `fixture.${runtimeSessionSequence}.signature`,
          expiresAt: 4_000_000_000,
        }),
      );
      return;
    }

    if (
      product &&
      requestUrl.startsWith(runtimeAssetPrefix) &&
      (request.method === 'OPTIONS' || request.method === 'GET')
    ) {
      if (!applyRuntimeCors(request, response)) {
        response.statusCode = 403;
        response.end();
        return;
      }
      if (request.method === 'OPTIONS') {
        response.statusCode = 204;
        response.setHeader('Access-Control-Allow-Methods', 'GET');
        response.setHeader('Access-Control-Allow-Headers', 'authorization, accept');
        response.end();
        return;
      }

      const assetFile = requestUrl.slice(runtimeAssetPrefix.length);
      const expectedAuthorization = `Bearer fixture.${runtimeSessionSequence}.signature`;
      const authorizationOk = request.headers.authorization === expectedAuthorization;
      runtimeAssetEvidence.push({
        assetFile,
        authorizationOk,
        cookiePresent: Boolean(request.headers.cookie),
        urlHasCapability: requestUrl.includes('fixture.'),
        originOk: request.headers.origin === runtimeUrl,
      });
      if (!authorizationOk) {
        response.statusCode = 401;
        response.end();
        return;
      }

      const configured = runtimeAssets.get(assetFile);
      if (!configured) {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.statusCode = configured.status ?? 200;
      response.setHeader('Cache-Control', 'no-store');
      if (configured.contentType) response.setHeader('Content-Type', configured.contentType);
      if ((configured.status ?? 200) >= 400) {
        response.end();
        return;
      }
      const body = Buffer.from(configured.body);
      response.setHeader('Content-Length', String(body.byteLength));
      response.end(body);
      return;
    }

    const productFile = product?.files.get(requestUrl);
    if (productFile) {
      response.setHeader('Content-Type', productFile.type);
      response.setHeader('Cache-Control', 'no-store');
      response.end(productFile.body);
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (requestUrl === '/attacker') {
      response.end(attackerHtml);
      return;
    }
    response.end(parentHtml);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(parentPort, '127.0.0.1', resolve);
  });
  let browser;
  let context;
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext(options.locale ? { locale: options.locale } : undefined);
    const pageErrors = [];

    context.on('page', (page) => {
      page.on('pageerror', (error) => {
        if (!error.message.includes('protocol-fixture-fatal')) pageErrors.push(error.message);
      });
      page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().includes('protocol-fixture-fatal')) {
          pageErrors.push(`console: ${message.text()}`);
        }
      });
    });

    await context.route(
      (url) => url.origin === runtimeUrl && url.pathname === '/',
      async (route) => {
        const upstream = await route.fetch();
        const body = (await upstream.text()).replace(
          '<meta name="asa-parent-origin" content="" />',
          `<meta name="asa-parent-origin" content="${parentOrigin}" />`,
        );
        if (!body.includes(`content="${parentOrigin}"`)) {
          throw new Error('failed to inject deterministic parent-origin fixture');
        }
        await route.fulfill({ response: upstream, body });
      },
    );

    return {
      avatarDataUrl: product?.avatarDataUrl,
      updatedAvatarDataUrl: product?.updatedAvatarDataUrl,
      context,
      pageErrors,
      runtimeAssetEvidence,
      async close() {
        try {
          await context.close();
        } finally {
          try {
            await browser.close();
          } finally {
            await new Promise((resolve) => server.close(resolve));
          }
        }
      },
    };
  } catch (error) {
    try {
      await browser?.close();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    throw error;
  }
}
