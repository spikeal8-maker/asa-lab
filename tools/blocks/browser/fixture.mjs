import fs from 'node:fs';
import http from 'node:http';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { chromium } from '@playwright/test';
import { runtimeUrl, parentPort, parentOrigin, projectId, runtimeToken } from './protocol.mjs';

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
  const runtimeAssetPutEvidence = [];
  const runtimeDraftEvidence = [];
  const runtimeSnapshotEvidence = [];
  const runtimeSnapshotReads = [];
  const runtimeWriteEvents = [];
  let storedSnapshot = options.initialSnapshot ?? null;
  const runtimePersistenceMetrics = {
    assetRequests: 0,
    uploadedBytes: 0,
    uniqueAssetBytes: 0,
    blobRows: 0,
    aliasRows: 0,
    draftRequests: 0,
    revisionCommits: 0,
    idempotentReplays: 0,
    externalRevisionAdvances: 0,
  };
  const durableBlobKeys = new Set(
    (runtimeSession.assets ?? []).map((reference) => `${reference.sha256}.${reference.dataFormat}`),
  );
  const durableAliasKeys = new Set(
    (runtimeSession.assets ?? []).map(
      (reference) => `${reference.assetId}.${reference.dataFormat}`,
    ),
  );
  const committedMutations = new Map();
  let serverRevision = Number(runtimeSession.draftRevision ?? 0);
  let durableProjectDocument =
    runtimeSession.projectJson === null || typeof runtimeSession.projectJson === 'undefined'
      ? null
      : { projectJson: runtimeSession.projectJson, assets: runtimeSession.assets ?? [] };
  let dropDraftResponseRemaining = options.dropFirstDraftResponseAfterCommit === true ? 1 : 0;
  let runtimeSessionSequence = 0;
  const runtimeSessionPath = `/api/projects/${projectId}/blocks/runtime-session`;
  const runtimeAssetPrefix = `/api/blocks/runtime/projects/${projectId}/assets/`;
  const runtimeDraftPath = `/api/blocks/runtime/projects/${projectId}/draft`;
  const projectPath = `/api/projects/${projectId}`;
  const projectSnapshotPath = `${projectPath}/snapshot`;
  const canonicalTypes = {
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
  };

  const expectedRuntimeToken = () =>
    product ? `fixture.${runtimeSessionSequence}.signature` : runtimeToken;
  const runtimeAuthorizationOk = (authorization) => {
    if (authorization === `Bearer ${expectedRuntimeToken()}`) return true;
    return !product && authorization === 'Bearer rotated.runtime.token';
  };
  const urlHasCapability = (requestUrl) =>
    requestUrl.includes('fixture.') ||
    requestUrl.includes(runtimeToken) ||
    requestUrl.includes('rotated.runtime.token');
  const applyRuntimeCors = (request, response) => {
    if (request.headers.origin !== runtimeUrl) return false;
    response.setHeader('Access-Control-Allow-Origin', runtimeUrl);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'authorization, accept, content-type');
    return true;
  };
  const requestBody = async (request) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };

  const server = http.createServer(async (request, response) => {
    const requestUrl = request.url ?? '/';

    if (product && request.method === 'POST' && requestUrl === runtimeSessionPath) {
      runtimeSessionSequence += 1;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      const expiresAt =
        typeof options.runtimeSessionExpiresAt === 'function'
          ? options.runtimeSessionExpiresAt(runtimeSessionSequence)
          : (options.runtimeSessionExpiresAt ?? 4_000_000_000);
      response.end(
        JSON.stringify({
          ...runtimeSession,
          draftRevision: serverRevision,
          projectJson: durableProjectDocument?.projectJson ?? null,
          assets: durableProjectDocument?.assets ?? [],
          runtimeOrigin: runtimeUrl,
          runtimeToken: `fixture.${runtimeSessionSequence}.signature`,
          expiresAt,
        }),
      );
      return;
    }

    if (
      requestUrl.startsWith(runtimeAssetPrefix) &&
      ['OPTIONS', 'GET', 'PUT'].includes(request.method ?? '')
    ) {
      if (!applyRuntimeCors(request, response)) {
        response.statusCode = 403;
        response.end();
        return;
      }
      if (request.method === 'OPTIONS') {
        response.statusCode = 204;
        response.end();
        return;
      }

      const assetFile = requestUrl.slice(runtimeAssetPrefix.length);
      const authorizationOk = runtimeAuthorizationOk(request.headers.authorization);
      if (request.method === 'GET') {
        runtimeAssetEvidence.push({
          assetFile,
          authorizationOk,
          cookiePresent: Boolean(request.headers.cookie),
          urlHasCapability: urlHasCapability(requestUrl),
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

      const body = await requestBody(request);
      const match = /^([a-f0-9]{32})\.(svg|png|jpg|wav|mp3)$/.exec(assetFile);
      const dataFormat = match?.[2] ?? null;
      const canonicalReference = match
        ? {
            assetId: match[1],
            dataFormat,
            sha256: createHash('sha256').update(body).digest('hex'),
            sizeBytes: body.byteLength,
          }
        : null;
      const identityOk =
        Boolean(match) && createHash('md5').update(body).digest('hex') === match?.[1];
      const contentTypeOk =
        Boolean(dataFormat) && request.headers['content-type'] === canonicalTypes[dataFormat];
      const evidence = {
        assetFile,
        authorizationOk,
        cookiePresent: Boolean(request.headers.cookie),
        urlHasCapability: urlHasCapability(requestUrl),
        originOk: request.headers.origin === runtimeUrl,
        identityOk,
        contentTypeOk,
        sizeBytes: body.byteLength,
        sha256: canonicalReference?.sha256 ?? null,
      };
      runtimeAssetPutEvidence.push(evidence);
      runtimeWriteEvents.push({ kind: 'asset-put', assetFile });
      runtimePersistenceMetrics.assetRequests += 1;
      runtimePersistenceMetrics.uploadedBytes += body.byteLength;
      if (!authorizationOk) {
        response.statusCode = 401;
        response.end();
        return;
      }
      const assetWriteStatus = options.assetWriteStatus ?? 200;
      if (assetWriteStatus >= 400) {
        response.statusCode = assetWriteStatus;
        response.end();
        return;
      }
      if (!canonicalReference || !identityOk || !contentTypeOk) {
        response.statusCode = 400;
        response.end();
        return;
      }
      const blobKey = `${canonicalReference.sha256}.${canonicalReference.dataFormat}`;
      if (!durableBlobKeys.has(blobKey)) {
        durableBlobKeys.add(blobKey);
        runtimePersistenceMetrics.uniqueAssetBytes += body.byteLength;
        runtimePersistenceMetrics.blobRows += 1;
      }
      const aliasKey = `${canonicalReference.assetId}.${canonicalReference.dataFormat}`;
      if (!durableAliasKeys.has(aliasKey)) {
        durableAliasKeys.add(aliasKey);
        runtimePersistenceMetrics.aliasRows += 1;
      }
      runtimeAssets.set(assetFile, {
        body,
        contentType: canonicalTypes[dataFormat],
      });
      const payload =
        typeof options.assetWriteResponse === 'function'
          ? options.assetWriteResponse(canonicalReference)
          : (options.assetWriteResponse ?? { status: 'ok', asset: canonicalReference });
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify(payload));
      return;
    }

    if (
      requestUrl === runtimeDraftPath &&
      (request.method === 'OPTIONS' || request.method === 'PUT')
    ) {
      if (!applyRuntimeCors(request, response)) {
        response.statusCode = 403;
        response.end();
        return;
      }
      if (request.method === 'OPTIONS') {
        response.statusCode = 204;
        response.end();
        return;
      }
      const body = await requestBody(request);
      let parsed;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch {
        parsed = null;
      }
      const evidence = {
        authorizationOk: runtimeAuthorizationOk(request.headers.authorization),
        cookiePresent: Boolean(request.headers.cookie),
        urlHasCapability: urlHasCapability(requestUrl),
        originOk: request.headers.origin === runtimeUrl,
        contentTypeOk: request.headers['content-type'] === 'application/vnd.asa.blocks-draft+json',
        body: parsed,
      };
      runtimeDraftEvidence.push({
        ...evidence,
        serverRevisionBefore: serverRevision,
      });
      runtimeWriteEvents.push({ kind: 'draft-put' });
      runtimePersistenceMetrics.draftRequests += 1;
      if (!evidence.authorizationOk) {
        response.statusCode = 401;
        response.end();
        return;
      }
      const draftWriteStatus =
        typeof options.draftWriteStatus === 'function'
          ? options.draftWriteStatus(parsed, serverRevision)
          : (options.draftWriteStatus ?? 200);
      if (draftWriteStatus >= 400) {
        response.statusCode = draftWriteStatus;
        response.end();
        return;
      }
      if (!parsed || !evidence.contentTypeOk) {
        response.statusCode = 400;
        response.end();
        return;
      }

      const mutationId = parsed.mutationId;
      const previous = committedMutations.get(mutationId);
      let revision;
      if (previous) {
        if (
          previous.baseRevision !== parsed.baseRevision ||
          JSON.stringify(previous.document) !== JSON.stringify(parsed.document)
        ) {
          response.statusCode = 409;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(
            JSON.stringify({
              error: { code: 'idempotency_conflict', message: 'mutation payload changed' },
            }),
          );
          return;
        }
        runtimePersistenceMetrics.idempotentReplays += 1;
        revision = previous.revision;
      } else {
        if (parsed.baseRevision !== serverRevision) {
          response.statusCode = 409;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(
            JSON.stringify({
              error: { code: 'project_revision_conflict', message: 'server revision moved' },
            }),
          );
          return;
        }
        serverRevision += 1;
        revision = serverRevision;
        committedMutations.set(mutationId, {
          baseRevision: parsed.baseRevision,
          document: parsed.document,
          revision,
        });
        durableProjectDocument = parsed.document;
        runtimePersistenceMetrics.revisionCommits += 1;
        if (dropDraftResponseRemaining > 0) {
          dropDraftResponseRemaining -= 1;
          const partial = '{"status":"ok","revision":';
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.setHeader('Content-Length', String(partial.length + 32));
          response.write(partial);
          response.destroy();
          return;
        }
      }

      const payload =
        typeof options.draftWriteResponse === 'function'
          ? options.draftWriteResponse(parsed, revision)
          : (options.draftWriteResponse ?? { status: 'ok', revision });
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify(payload));
      return;
    }

    if (product && request.method === 'PUT' && requestUrl === projectSnapshotPath) {
      const body = await requestBody(request);
      let parsed;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch {
        parsed = null;
      }
      const sourceRevision = parsed?.sourceRevision;
      const imageDataUrl = parsed?.imageDataUrl;
      runtimeSnapshotEvidence.push({
        sourceRevision,
        serverRevisionBefore: serverRevision,
        contentType:
          typeof imageDataUrl === 'string'
            ? imageDataUrl.slice(5, imageDataUrl.indexOf(';'))
            : null,
      });

      const configuredStatus =
        typeof options.snapshotWriteStatus === 'function'
          ? options.snapshotWriteStatus(parsed)
          : (options.snapshotWriteStatus ?? 200);
      if (configuredStatus >= 400) {
        response.statusCode = configuredStatus;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(
          JSON.stringify({
            error: { code: 'snapshot_write_failed', message: 'snapshot rejected' },
          }),
        );
        return;
      }
      if (!Number.isSafeInteger(sourceRevision) || sourceRevision !== serverRevision) {
        response.statusCode = 409;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(
          JSON.stringify({
            error: { code: 'project_revision_conflict', message: 'snapshot revision is stale' },
          }),
        );
        return;
      }
      const match =
        typeof imageDataUrl === 'string'
          ? /^data:image\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageDataUrl)
          : null;
      if (!match) {
        response.statusCode = 400;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(
          JSON.stringify({ error: { code: 'validation_error', message: 'invalid snapshot' } }),
        );
        return;
      }
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length < 64 || bytes.length > 262_144) {
        response.statusCode = 400;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(
          JSON.stringify({ error: { code: 'validation_error', message: 'snapshot size' } }),
        );
        return;
      }
      storedSnapshot = {
        sourceRevision,
        contentType: `image/${match[1]}`,
        bytes,
      };
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(
        JSON.stringify({
          snapshot: {
            projectId,
            contentType: storedSnapshot.contentType,
            width: 480,
            height: 360,
            sourceRevision,
            capturedAt: '2026-09-19T20:00:00.000Z',
          },
        }),
      );
      return;
    }

    if (product && request.method === 'GET' && requestUrl.startsWith(projectSnapshotPath)) {
      const parsedUrl = new URL(requestUrl, parentOrigin);
      runtimeSnapshotReads.push({
        requestedRevision: parsedUrl.searchParams.get('rev'),
        storedRevision: storedSnapshot?.sourceRevision ?? null,
      });
      if (!storedSnapshot) {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.statusCode = 200;
      response.setHeader('Content-Type', storedSnapshot.contentType);
      response.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      response.end(storedSnapshot.bytes);
      return;
    }

    if (product && request.method === 'GET' && requestUrl === projectPath) {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(
        JSON.stringify({
          project: {
            id: projectId,
            scope: 'personal',
            classroomId: null,
            moduleKey: 'blocks',
            title: 'Scratch preview acceptance',
            status: 'active',
            createdAt: '2026-09-19T20:00:00.000Z',
            updatedAt: '2026-09-19T20:00:00.000Z',
            preview: null,
            snapshotRevision: storedSnapshot?.sourceRevision ?? null,
            copiedFrom: null,
          },
          draft: {
            projectId,
            document: null,
            revision: serverRevision,
            updatedAt: '2026-09-19T20:00:00.000Z',
          },
          versions: [],
          result: null,
        }),
      );
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
    const allRequests = [];

    context.on('request', (request) => {
      allRequests.push({ method: request.method(), url: request.url() });
    });
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
      allRequests,
      runtimeAssetEvidence,
      runtimeAssetPutEvidence,
      runtimeDraftEvidence,
      runtimeSnapshotEvidence,
      runtimeSnapshotReads,
      runtimeWriteEvents,
      runtimePersistenceMetrics,
      getServerRevision() {
        return serverRevision;
      },
      getRuntimeSessionSequence() {
        return runtimeSessionSequence;
      },
      getSnapshotRevision() {
        return storedSnapshot?.sourceRevision ?? null;
      },
      getStoredSnapshot() {
        return storedSnapshot;
      },
      advanceServerRevision() {
        serverRevision += 1;
        runtimePersistenceMetrics.externalRevisionAdvances += 1;
        return serverRevision;
      },
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
