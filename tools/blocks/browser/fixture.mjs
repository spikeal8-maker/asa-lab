import fs from 'node:fs';
import http from 'node:http';
import { URL } from 'node:url';
import { chromium } from '@playwright/test';
import { runtimeUrl, parentPort, parentOrigin } from './protocol.mjs';

export async function createProtocolFixture() {
  const repoRoot = new URL('../../../', import.meta.url);
  const checkedSources = [
    'infra/scratch-editor/host/protocol.js',
    'infra/scratch-editor/host/status.js',
    'infra/scratch-editor/host/main.js',
    'apps/web/src/blocks/runtime-protocol.ts',
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

  const parentHtml = `<!doctype html><html><body data-parent-state="alive">
<iframe id="runtime-frame" src="${runtimeUrl}/"></iframe>
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

  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/attacker') {
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
    context = await browser.newContext();
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

    await context.route(`${runtimeUrl}/`, async (route) => {
      const upstream = await route.fetch();
      const body = (await upstream.text()).replace(
        '<meta name="asa-parent-origin" content="" />',
        `<meta name="asa-parent-origin" content="${parentOrigin}" />`,
      );
      if (!body.includes(`content="${parentOrigin}"`)) {
        throw new Error('failed to inject deterministic parent-origin fixture');
      }
      await route.fulfill({ response: upstream, body });
    });

    return {
      context,
      pageErrors,
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
