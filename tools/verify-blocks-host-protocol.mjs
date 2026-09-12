import fs from 'node:fs';
import http from 'node:http';
import { chromium } from '@playwright/test';

const runtimeUrl = process.env.BLOCKS_RUNTIME_URL ?? 'http://127.0.0.1:4613';
const parentPort = Number.parseInt(process.env.BLOCKS_PARENT_PORT ?? '4612', 10);
const parentOrigin = `http://127.0.0.1:${parentPort}`;
const alternateParentOrigin = `http://localhost:${parentPort}`;
const projectId = '11111111-1111-4111-8111-111111111111';
const sessionNonce = 'fixture-session-nonce-c';
const runtimeToken = 'fixture-runtime-token-c';

const repoRoot = new URL('../', import.meta.url);
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
  server.listen(parentPort, '0.0.0.0', resolve);
});
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
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

const binding = {
  protocolVersion: 1,
  projectId,
  sessionNonce,
};
const initMessage = {
  ...binding,
  messageType: 'ASA_BLOCKS_INIT',
  mode: 'editor',
  versionId: null,
  apiOrigin: parentOrigin,
  runtimeToken,
  draftRevision: 0,
  hasProjectJson: false,
  assets: [],
  recoveryNamespace: 'fixture-c',
};
async function runtimeFrame(page) {
  const iframe = page.locator('#runtime-frame');
  await iframe.waitFor({ state: 'attached' });

  let frame = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const handle = await iframe.elementHandle();
    frame = await handle?.contentFrame();
    if (frame) break;
    await page.waitForTimeout(100);
  }

  if (!frame) throw new Error('runtime iframe is unavailable after waiting');
  await frame.locator('[data-asa-host-shell]').waitFor({ state: 'visible' });
  return frame;
}

async function rejectionCount(frame) {
  return Number.parseInt(
    (await frame.locator('[data-asa-host-shell]').getAttribute('data-protocol-rejections')) ?? '0',
    10,
  );
}

async function runtimeState(frame) {
  return frame.locator('[data-asa-host-shell]').getAttribute('data-runtime-state');
}

async function sendFromParent(page, message) {
  await page.evaluate((payload) => window.sendToRuntime(payload), message);
}

try {
  const page = await context.newPage();
  await page.goto(`${parentOrigin}/parent`, { waitUntil: 'domcontentloaded' });
  const frame = await runtimeFrame(page);
  await frame.waitForFunction(
    () =>
      document.querySelector('[data-asa-host-shell]')?.getAttribute('data-runtime-state') ===
      'awaiting-init',
  );

  const editorChildren = await frame
    .locator('#scratch-editor-root')
    .evaluate((node) => node.childElementCount);
  if (editorChildren !== 0) throw new Error(`editor mounted before valid INIT: ${editorChildren}`);
  await page.waitForFunction(() => {
    const attacker = document.getElementById('attacker-frame');
    return attacker?.contentDocument?.readyState === 'complete';
  });
  await page.evaluate((payload) => window.sendFromAttacker(payload), initMessage);
  await page.waitForTimeout(50);
  if ((await rejectionCount(frame)) !== 1 || (await runtimeState(frame)) !== 'awaiting-init') {
    throw new Error('wrong-source INIT was not rejected');
  }

  await sendFromParent(page, { ...initMessage, protocolVersion: 2 });
  await page.waitForTimeout(50);
  if ((await rejectionCount(frame)) !== 2)
    throw new Error('wrong protocol version was not rejected');

  await sendFromParent(page, {
    ...initMessage,
    projectId: '22222222-2222-4222-8222-222222222222',
  });
  await page.waitForTimeout(50);
  if ((await rejectionCount(frame)) !== 3) throw new Error('wrong project INIT was not rejected');

  await sendFromParent(page, initMessage);
  await frame.waitForFunction(
    () =>
      document.querySelector('[data-asa-host-shell]')?.getAttribute('data-runtime-state') ===
      'init-accepted',
  );

  const receivedAfterInit = await page.evaluate(() => window.__blocksMessages);
  if (
    !receivedAfterInit.some(
      (message) =>
        message?.messageType === 'ASA_BLOCKS_STATUS' && message?.status === 'init-accepted',
    )
  ) {
    throw new Error('parent did not receive bound init-accepted status');
  }

  const persistenceLeak = await frame.evaluate(
    (token) => ({
      url: location.href.includes(token),
      html: document.documentElement.outerHTML.includes(token),
      local: Object.values(localStorage).some((value) => value.includes(token)),
      session: Object.values(sessionStorage).some((value) => value.includes(token)),
    }),
    runtimeToken,
  );
  if (Object.values(persistenceLeak).some(Boolean))
    throw new Error('runtime token leaked to browser persistence/DOM/URL');
  const beforeWrongNonce = await rejectionCount(frame);
  await sendFromParent(page, {
    ...binding,
    sessionNonce: 'wrong-nonce',
    messageType: 'ASA_BLOCKS_TOKEN_UPDATE',
    runtimeToken: 'ignored-token',
  });
  await page.waitForTimeout(50);
  if ((await rejectionCount(frame)) !== beforeWrongNonce + 1) {
    throw new Error('wrong nonce was not rejected');
  }

  await sendFromParent(page, {
    ...binding,
    messageType: 'ASA_BLOCKS_TOKEN_UPDATE',
    runtimeToken: 'rotated-runtime-token-c',
  });
  await page.waitForFunction(() =>
    window.__blocksMessages.some(
      (message) =>
        message?.messageType === 'ASA_BLOCKS_STATUS' && message?.status === 'token-updated',
    ),
  );

  await sendFromParent(page, {
    ...binding,
    messageType: 'ASA_BLOCKS_FLUSH_REQUEST',
    requestId: 'flush-c-1',
  });
  await page.waitForFunction(() =>
    window.__blocksMessages.some(
      (message) =>
        message?.messageType === 'ASA_BLOCKS_FLUSH_RESULT' && message?.requestId === 'flush-c-1',
    ),
  );
  const flushResult = await page.evaluate(() =>
    window.__blocksMessages.find((message) => message?.messageType === 'ASA_BLOCKS_FLUSH_RESULT'),
  );
  if (flushResult?.ok !== false || flushResult?.reason !== 'storage_not_available') {
    throw new Error(`unexpected flush result: ${JSON.stringify(flushResult)}`);
  }
  await frame.evaluate(() => {
    setTimeout(() => {
      throw new Error('protocol-fixture-fatal');
    }, 0);
  });
  await page.waitForFunction(() => document.body.dataset.parentState === 'fatal');
  if (page.isClosed()) throw new Error('parent page closed after child fatal');

  const wrongOriginPage = await context.newPage();
  await wrongOriginPage.goto(`${alternateParentOrigin}/parent`, { waitUntil: 'domcontentloaded' });
  const wrongOriginFrame = await runtimeFrame(wrongOriginPage);
  await wrongOriginFrame.waitForFunction(
    () =>
      document.querySelector('[data-asa-host-shell]')?.getAttribute('data-runtime-state') ===
      'awaiting-init',
  );
  await sendFromParent(wrongOriginPage, initMessage);
  await wrongOriginPage.waitForTimeout(50);
  if (
    (await rejectionCount(wrongOriginFrame)) !== 1 ||
    (await runtimeState(wrongOriginFrame)) !== 'awaiting-init'
  ) {
    throw new Error('wrong-origin INIT was not rejected');
  }

  if (pageErrors.length > 0)
    throw new Error(`unexpected browser errors:\n${pageErrors.join('\n')}`);

  console.log('blocks host protocol browser smoke: PASS');
  console.log(`runtime=${runtimeUrl}`);
  console.log(`parent=${parentOrigin}`);
  console.log(`rejections=${await rejectionCount(frame)}`);
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
