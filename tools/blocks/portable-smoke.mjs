import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers';
import { URL } from 'node:url';
import { chromium, expect } from '@playwright/test';

// CI-only disposable installation. Never point this at a working user database.
assert.equal(process.env.CI, 'true', 'portable smoke requires an isolated CI runner');
const root = path.resolve(process.env.ASA_PORTABLE_ROOT ?? '');
assert.ok(path.basename(root).startsWith('asa-portable-'));
assert.ok(
  !fs.existsSync(path.join(root, '.git')),
  'use exported tracked sources, not developer files',
);

const values = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
assert.equal(values.ASA_SEED_DEV, 'true');

const origin = 'http://127.0.0.1:4610';
const runtimeOrigin = 'http://localhost:4613';
const out = path.resolve('reports/blocks/portable-install');
const composeArgs = ['compose', '-f', 'compose.yaml', '-f', 'compose.dev.yaml'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
fs.mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hashFile = (file) => {
  const bytes = fs.readFileSync(file);
  return {
    md5: createHash('md5').update(bytes).digest('hex'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
  };
};
const delta = (after, before) => after - before;

function dockerCompose(...args) {
  return execFileSync('docker', [...composeArgs, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function projectState(projectId) {
  assert.match(projectId, UUID_RE);
  const sql = `
SELECT json_build_object(
  'tenantId', p.tenant_id::text,
  'revision', d.revision,
  'document', d.document_json,
  'blobRows', (SELECT count(*)::int FROM public.blocks_blobs b WHERE b.tenant_id=p.tenant_id),
  'aliasRows', (SELECT count(*)::int FROM public.blocks_asset_aliases a WHERE a.tenant_id=p.tenant_id),
  'blobBytes', (SELECT COALESCE(sum(size_bytes),0)::bigint FROM public.blocks_blobs b WHERE b.tenant_id=p.tenant_id)
)::text
FROM public.projects p
JOIN public.project_drafts d ON d.tenant_id=p.tenant_id AND d.project_id=p.id
WHERE p.id='${projectId}'::uuid;
`;
  const text = dockerCompose(
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    values.POSTGRES_USER,
    '-d',
    values.POSTGRES_DB,
    '-v',
    'ON_ERROR_STOP=1',
    '-At',
    '-c',
    sql,
  ).trim();
  assert.ok(text, `project ${projectId} missing from PostgreSQL`);
  return JSON.parse(text);
}

function objectSnapshot() {
  const text = dockerCompose(
    'run',
    '--rm',
    '--no-deps',
    '-T',
    '--entrypoint',
    '/bin/sh',
    'minio-init',
    '-c',
    'mc alias set local http://minio:9000 "$ASA_OBJECT_STORAGE_ACCESS_KEY" "$ASA_OBJECT_STORAGE_SECRET_KEY" >/dev/null; mc ls --recursive --json "local/$ASA_OBJECT_STORAGE_BUCKET"',
  );
  const entries = text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type === 'file');
  return {
    count: entries.length,
    bytes: entries.reduce((sum, entry) => sum + Number(entry.size ?? 0), 0),
  };
}

async function startObjectTrace() {
  const name = `asa-blocks-trace-${process.pid}-${Date.now()}`;
  const events = [];
  let phase = 'idle';
  let buffer = '';
  const command =
    'mc alias set local http://minio:9000 "$ASA_OBJECT_STORAGE_ACCESS_KEY" "$ASA_OBJECT_STORAGE_SECRET_KEY" >/dev/null; exec mc admin trace --json --path "$ASA_OBJECT_STORAGE_BUCKET/*" local';
  const child = spawn(
    'docker',
    [
      ...composeArgs,
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '--name',
      name,
      '--entrypoint',
      '/bin/sh',
      'minio-init',
      '-c',
      command,
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (typeof event?.api === 'string') {
          events.push({
            phase,
            name: event.api,
            bucket: null,
            object: typeof event.path === 'string' ? event.path : null,
          });
        }
      } catch {
        // mc can emit a non-JSON setup line; it is not object-request evidence.
      }
    }
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  await sleep(1500);
  if (child.exitCode !== null) {
    throw new Error(`MinIO trace exited before acceptance: ${stderr}`);
  }
  return {
    events,
    setPhase(next) {
      phase = next;
    },
    async settle() {
      await sleep(350);
    },
    async stop() {
      await sleep(250);
      try {
        execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
      } catch {
        // It may already have exited after the disposable install is torn down.
      }
      child.kill('SIGTERM');
      await sleep(100);
    },
  };
}

function observeRuntime(context, eventLog, getPhase, projectIds) {
  context.on('request', (request) => {
    const url = new URL(request.url());
    const runtimeSession = /^\/api\/projects\/([0-9a-f-]+)\/blocks\/runtime-session$/i.exec(
      url.pathname,
    );
    if (runtimeSession && request.method() === 'POST') {
      projectIds.push(runtimeSession[1]);
    }
    if (!url.pathname.startsWith('/api/blocks/runtime/projects/')) return;
    eventLog.push({
      phase: getPhase(),
      method: request.method(),
      pathname: url.pathname,
      bytes: request.postDataBuffer()?.byteLength ?? 0,
    });
  });
}

function phaseRuntimeMetrics(events, phase) {
  const selected = events.filter((event) => event.phase === phase);
  return {
    requests: selected.length,
    assetPutRequests: selected.filter(
      (event) => event.method === 'PUT' && event.pathname.includes('/assets/'),
    ).length,
    draftPutRequests: selected.filter(
      (event) => event.method === 'PUT' && event.pathname.endsWith('/draft'),
    ).length,
    assetGetRequests: selected.filter(
      (event) => event.method === 'GET' && event.pathname.includes('/assets/'),
    ).length,
    uploadedBytes: selected
      .filter((event) => event.method === 'PUT' && event.pathname.includes('/assets/'))
      .reduce((sum, event) => sum + event.bytes, 0),
  };
}

function phaseObjectMetrics(events, phase) {
  const selected = events.filter((event) => event.phase === phase);
  return {
    requests: selected.length,
    apiNames: selected.reduce((counts, event) => {
      counts[event.name] = (counts[event.name] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

async function loginAccount(context) {
  const login = await context.request.post('/api/auth/login', {
    headers: { origin },
    data: {
      workspace: values.ASA_SEED_WORKSPACE,
      email: values.ASA_SEED_TEACHER_EMAIL,
      password: values.ASA_SEED_TEACHER_PASSWORD,
    },
  });
  expect(login.status(), 'seeded organization login').toBe(200);
}

async function waitForEditor(page) {
  const frame = page.frameLocator('iframe[title="Scratch runtime"]');
  const shell = frame.locator('[data-asa-host-shell]');
  await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
  await expect(page.locator('[data-asa-blocks-save]')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
  return { frame, shell };
}

async function exportNamedMedia(page, frame, tab, name, destination) {
  await frame.getByRole('tab', { name: tab, exact: true }).click();
  const panel = frame.getByRole('tabpanel', { name: tab, exact: true });
  await panel.getByText(name, { exact: true }).click({ button: 'right' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    frame.getByRole('menuitem', { name: 'export', exact: true }).click(),
  ]);
  await download.saveAs(destination);
  expect(await download.failure()).toBeNull();
  return {
    suggestedFilename: download.suggestedFilename(),
    ...hashFile(destination),
  };
}

async function addDistinctProjectState(page, frame, marker, variable) {
  await frame.getByRole('button', { name: 'Choose a Sprite' }).first().click();
  await frame.getByText('Abby', { exact: true }).click();
  await expect(frame.getByPlaceholder('Name', { exact: true })).toHaveValue('Abby');
  await frame.getByPlaceholder('Name', { exact: true }).fill(marker);
  await frame.getByPlaceholder('Name', { exact: true }).press('Enter');
  await frame.getByPlaceholder('x', { exact: true }).fill('137');
  await frame.getByPlaceholder('x', { exact: true }).press('Enter');

  await frame.getByRole('treeitem', { name: 'Variables', exact: true }).click();
  await frame.getByText('Make a Variable', { exact: true }).click();
  const dialog = frame.getByRole('dialog', { name: 'New Variable' });
  await dialog.getByRole('textbox').fill(variable);
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();

  await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
  await frame.getByRole('button', { name: 'Choose a Sound', exact: true }).first().click();
  await frame.getByText('Bark', { exact: true }).click();
  await expect(frame.getByRole('textbox', { name: 'Sound', exact: true })).toHaveValue('Bark');

  await frame.getByRole('tab', { name: 'Code', exact: true }).click();
  await frame.getByRole('treeitem', { name: 'Motion', exact: true }).click();
  const flyoutBlock = frame
    .locator('.blocklyFlyout .blocklyDraggable')
    .filter({ hasText: 'move' })
    .first();
  const workspaceBackground = frame.locator('.blocklyMainBackground').first();
  const workspace = frame.locator('.blocklyBlockCanvas').first();
  await expect(flyoutBlock).toBeVisible();
  await expect(workspaceBackground).toBeVisible();
  await flyoutBlock.dragTo(workspaceBackground, { targetPosition: { x: 420, y: 180 } });
  const steps = workspace.getByText('10', { exact: true }).last();
  await expect(steps).toBeVisible();
  await steps.dblclick();
  const input = frame.locator('.blocklyHtmlInput:focus');
  await expect(input).toHaveValue('10');
  await input.fill('73');
  await input.press('Enter');
  await expect(workspace.getByText('73', { exact: true })).toBeVisible();

  await expect(frame.getByRole('button', { name: marker, exact: true })).toBeVisible();
  await expect(
    frame.locator('[class*="monitor_label"]').filter({ hasText: variable }),
  ).toBeVisible();
  await page.screenshot({ path: path.join(out, '01-before-asa-save.png') });
}

async function verifyDistinctProjectState(page, frame, marker, variable) {
  const sprite = frame.getByRole('button', { name: marker, exact: true });
  await expect(sprite).toBeVisible();
  await sprite.click();
  await expect(frame.getByPlaceholder('Name', { exact: true })).toHaveValue(marker);
  await expect(frame.getByPlaceholder('x', { exact: true })).toHaveValue('137');
  await expect(
    frame.locator('[class*="monitor_label"]').filter({ hasText: variable }),
  ).toBeVisible();

  await frame.getByRole('tab', { name: 'Code', exact: true }).click();
  await expect(
    frame.locator('.blocklyBlockCanvas').first().getByText('73', { exact: true }),
  ).toBeVisible();

  await frame.getByRole('tab', { name: 'Costumes', exact: true }).click();
  await expect(
    frame.getByRole('tabpanel', { name: 'Costumes', exact: true }).getByText('Abby-a', {
      exact: true,
    }),
  ).toBeVisible();

  await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
  await frame
    .getByRole('tabpanel', { name: 'Sounds', exact: true })
    .getByText('Bark', { exact: true })
    .click();
  await expect(frame.getByRole('textbox', { name: 'Sound', exact: true })).toHaveValue('Bark');

  await frame.getByRole('tab', { name: 'Code', exact: true }).click();
  await frame.getByRole('button', { name: 'Start project', exact: true }).click();
  const shell = frame.locator('[data-asa-host-shell]');
  await expect(shell).not.toHaveAttribute('data-runtime-state', 'error');
  await frame.getByRole('button', { name: 'Stop project', exact: true }).click();
  await expect(shell).toHaveAttribute('data-project-running', 'false');
  await page.screenshot({ path: path.join(out, '04-fresh-reopen-exact.png') });
}

async function editStepValue(frame, from, to) {
  await frame.getByRole('tab', { name: 'Code', exact: true }).click();
  const workspace = frame.locator('.blocklyBlockCanvas').first();
  const value = workspace.getByText(String(from), { exact: true }).last();
  await expect(value).toBeVisible();
  await value.dblclick();
  const input = frame.locator('.blocklyHtmlInput:focus');
  await expect(input).toHaveValue(String(from));
  await input.fill(String(to));
  await input.press('Enter');
  await expect(workspace.getByText(String(to), { exact: true })).toBeVisible();
}

function projectHasStep(state, marker, value) {
  const target = state.document?.projectJson?.targets?.find((item) => item.name === marker);
  return Boolean(
    target &&
      Object.values(target.blocks ?? {}).some(
        (block) =>
          block.opcode === 'motion_movesteps' &&
          Array.isArray(block.inputs?.STEPS) &&
          JSON.stringify(block.inputs.STEPS).includes(String(value)),
      ),
  );
}

async function assertUiRegression(page, frame) {
  await expect(frame.getByText('File', { exact: true })).toBeVisible();
  await expect(frame.getByText('Edit', { exact: true })).toBeVisible();
  await frame.getByText('File', { exact: true }).click();
  await expect(frame.getByText('Load from your computer', { exact: true })).toBeVisible();
  await expect(frame.getByText('Save to your computer', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(frame.getByRole('button', { name: 'Settings menu' })).toBeVisible();
  await frame.getByRole('tab', { name: 'Code', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Add Extension' })).toBeVisible();
  await expect(page.locator('[data-asa-blocks-home-overlay]')).toBeVisible();
  await expect(page.locator('[data-asa-blocks-account-overlay]')).toBeVisible();
  await expect(page.locator('.blocks-editor-connection-status')).toHaveCount(0);

  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('[data-asa-blocks-save]')).toHaveCount(0);
    const accountBox = await page.locator('[data-asa-blocks-account-overlay]').boundingBox();
    const fileBox = await frame.getByText('File', { exact: true }).boundingBox();
    const editBox = await frame.getByText('Edit', { exact: true }).boundingBox();
    assert.ok(accountBox);
    assert.ok(accountBox.x >= 0 && accountBox.y >= 0);
    assert.ok(accountBox.x + accountBox.width <= viewport.width);
    assert.ok(accountBox.y + accountBox.height <= viewport.height);
    const overlaps = (a, b) =>
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    if (fileBox) {
      assert.equal(overlaps(accountBox, fileBox), false, 'Account must not cover visible native File');
    }
    if (editBox) {
      assert.equal(overlaps(accountBox, editBox), false, 'Account must not cover visible native Edit');
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 });
}

async function waitForRevisionAdvance(projectId, previousRevision, timeout = 45000) {
  const startedAt = performance.now();
  await expect
    .poll(() => projectState(projectId).revision, { timeout })
    .toBeGreaterThan(previousRevision);
  const revision = projectState(projectId).revision;
  return { revision, latencyMs: Math.round((performance.now() - startedAt) * 100) / 100 };
}

async function createProject(request, title) {
  const response = await request.post('/api/projects', {
    headers: { origin, 'idempotency-key': randomUUID() },
    data: {
      scope: 'personal',
      classroomId: null,
      module: 'blocks',
      title,
      automaticTitle: false,
    },
  });
  expect([200, 201]).toContain(response.status());
  return (await response.json()).project;
}

async function waitForMinio() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      dockerCompose(
        'exec',
        '-T',
        'minio',
        'curl',
        '-fsS',
        'http://127.0.0.1:9000/minio/health/live',
      );
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error('MinIO did not recover after storage-failure acceptance');
}

const browser = await chromium.launch({ headless: true });
let context = await browser.newContext({
  baseURL: origin,
  viewport: { width: 1440, height: 960 },
  locale: 'en-US',
  acceptDownloads: true,
});
const runtimeEvents = [];
const projectIds = [];
let phase = 'readiness';
observeRuntime(context, runtimeEvents, () => phase, projectIds);

// A non-secret HttpOnly marker proves the iframe does not receive portal cookies.
const cookieProbe = 'asa_portable_host_cookie';
await context.addCookies([
  { name: cookieProbe, value: 'isolation-test', domain: '127.0.0.1', path: '/', httpOnly: true },
]);
let runtimeRequests = 0;
let portalCookieLeaked = false;
await context.route(/^http:\/\/(?:localhost|127\.0\.0\.1):4613\//, async (route) => {
  const headers = await route.request().allHeaders();
  runtimeRequests += 1;
  portalCookieLeaked ||= (headers.cookie ?? '').includes(`${cookieProbe}=`);
  await route.continue();
});

const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
let trace;
let noOpTrace;
try {
  const ready = await (await context.request.get('/health/ready')).json();
  const metadata = await (await context.request.get('/build-metadata.json')).json();
  expect(ready.deployment.revision).toBe(process.env.ASA_BUILD_REVISION);
  expect(metadata.revision).toBe(process.env.ASA_BUILD_REVISION);
  expect(ready.deployment.synchronized).toBe(true);

  phase = 'host-runtime-port';
  for (const host of ['localhost', '127.0.0.1']) {
    const health = await context.request.get(`http://${host}:4613/healthz`, { timeout: 10000 });
    expect(health.status(), 'runtime must be reachable from host').toBe(200);
  }

  phase = 'account-login';
  await loginAccount(context);
  phase = 'account-create';
  await page.goto('/#/home', { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { name: 'Программирование · Scratch', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Создать программу', exact: true }).click();
  const firstEditor = await waitForEditor(page);
  const projectId = projectIds.at(-1);
  assert.ok(projectId && UUID_RE.test(projectId), 'runtime-session must expose created project id');

  expect(runtimeRequests).toBeGreaterThan(0);
  expect(portalCookieLeaked, 'Scratch must not receive portal host cookie').toBe(false);
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    'http://localhost:4613/?asaStatus=parent',
  );

  const marker = `ASA Durable Sprite ${projectId.slice(0, 8)}`;
  const variable = `ASA_Durable_Proof_${projectId.slice(0, 6)}`;
  const p0 = projectState(projectId);
  const o0 = objectSnapshot();
  trace = await startObjectTrace();
  phase = 'account-save';
  trace.setPhase('account-save');
  const firstSaveStartedAt = performance.now();

  await addDistinctProjectState(page, firstEditor.frame, marker, variable);

  const beforeCostume = await exportNamedMedia(
    page,
    firstEditor.frame,
    'Costumes',
    'Abby-a',
    path.join(out, 'before-Abby-a.svg'),
  );
  const beforeSound = await exportNamedMedia(
    page,
    firstEditor.frame,
    'Sounds',
    'Bark',
    path.join(out, 'before-Bark.wav'),
  );
  expect(beforeCostume.suggestedFilename).toMatch(/\.svg$/i);
  expect(beforeSound.suggestedFilename).toBe('Bark.wav');

  await expect
    .poll(
      () => {
        const current = projectState(projectId);
        const target = current.document?.projectJson?.targets?.find(
          (item) => item.name === marker,
        );
        const hasVariable = current.document?.projectJson?.targets?.some((item) =>
          Object.values(item.variables ?? {}).some(
            (entry) => Array.isArray(entry) && entry[0] === variable,
          ),
        );
        const hasCostume = current.document?.assets?.some(
          (asset) => asset.assetId === beforeCostume.md5,
        );
        const hasSound = current.document?.assets?.some(
          (asset) => asset.assetId === beforeSound.md5,
        );
        return Boolean(
          current.revision > p0.revision &&
            target?.x === 137 &&
            hasVariable &&
            hasCostume &&
            hasSound &&
            projectHasStep(current, marker, 73),
        );
      },
      { timeout: 45000 },
    )
    .toBe(true);
  const p1 = projectState(projectId);
  const firstSave = {
    revision: p1.revision,
    latencyMs: Math.round((performance.now() - firstSaveStartedAt) * 100) / 100,
  };
  await trace.settle();
  trace.setPhase('idle');

  const o1 = objectSnapshot();
  expect(p1.revision).toBeGreaterThan(p0.revision);
  expect(p1.blobRows).toBeGreaterThan(p0.blobRows);
  expect(p1.aliasRows).toBeGreaterThan(p0.aliasRows);
  expect(p1.blobBytes).toBeGreaterThan(p0.blobBytes);
  expect(o1.count).toBe(p1.blobRows);
  expect(o1.bytes).toBe(p1.blobBytes);

  const savedTarget = p1.document.projectJson.targets.find((target) => target.name === marker);
  assert.ok(savedTarget, 'durable document must contain the unique sprite');
  expect(savedTarget.x).toBe(137);
  expect(
    p1.document.projectJson.targets.some((target) =>
      Object.values(target.variables ?? {}).some(
        (entry) => Array.isArray(entry) && entry[0] === variable,
      ),
    ),
  ).toBe(true);
  expect(
    Object.values(savedTarget.blocks).some(
      (block) =>
        block.opcode === 'motion_movesteps' &&
        Array.isArray(block.inputs?.STEPS) &&
        JSON.stringify(block.inputs.STEPS).includes('73'),
    ),
  ).toBe(true);

  const costumeRef = p1.document.assets.find((asset) => asset.assetId === beforeCostume.md5);
  const soundRef = p1.document.assets.find((asset) => asset.assetId === beforeSound.md5);
  expect(costumeRef).toMatchObject({
    assetId: beforeCostume.md5,
    sha256: beforeCostume.sha256,
    sizeBytes: beforeCostume.sizeBytes,
  });
  expect(soundRef).toMatchObject({
    assetId: beforeSound.md5,
    sha256: beforeSound.sha256,
    sizeBytes: beforeSound.sizeBytes,
  });
  fs.writeFileSync(
    path.join(out, '02-durable-document.json'),
    JSON.stringify({ projectId, revision: p1.revision, document: p1.document }, null, 2),
  );

  phase = 'destroy-first-context';
  await context.close();

  context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 960 },
    locale: 'en-US',
    acceptDownloads: true,
  });
  const freshStateBeforeAuth = await context.storageState();
  expect(freshStateBeforeAuth.cookies).toEqual([]);
  expect(freshStateBeforeAuth.origins).toEqual([]);
  observeRuntime(context, runtimeEvents, () => phase, projectIds);
  await loginAccount(context);

  const reopened = await context.newPage();
  reopened.on('pageerror', (error) => pageErrors.push(error.message));
  phase = 'fresh-reopen';
  trace.setPhase('fresh-reopen');
  const reopenStartedAt = performance.now();
  const sessionResponsePromise = reopened.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/projects/${projectId}/blocks/runtime-session`,
  );
  await reopened.goto(`/#/home/${projectId}?module=blocks`, { waitUntil: 'domcontentloaded' });
  const freshEditor = await waitForEditor(reopened);
  const reopenLatencyMs = Math.round((performance.now() - reopenStartedAt) * 100) / 100;
  const freshSessionResponse = await sessionResponsePromise;
  expect(freshSessionResponse.status()).toBe(200);
  const freshSession = await freshSessionResponse.json();
  await trace.settle();
  trace.setPhase('idle');

  expect(freshSession.draftRevision).toBe(p1.revision);
  expect(freshSession.projectJson).toEqual(p1.document.projectJson);
  expect(freshSession.assets).toEqual(p1.document.assets);
  const canonicalFreshAssetPaths = freshSession.assets.map(
    (asset) =>
      `/api/blocks/runtime/projects/${projectId}/assets/${asset.assetId}.${asset.dataFormat}`,
  );
  const freshAssetGets = runtimeEvents
    .filter(
      (event) =>
        event.phase === 'fresh-reopen' &&
        event.method === 'GET' &&
        event.pathname.includes('/assets/'),
    )
    .map((event) => event.pathname);
  expect(freshAssetGets).toHaveLength(canonicalFreshAssetPaths.length);
  expect(new Set(freshAssetGets)).toEqual(new Set(canonicalFreshAssetPaths));
  await verifyDistinctProjectState(reopened, freshEditor.frame, marker, variable);

  const afterCostume = await exportNamedMedia(
    reopened,
    freshEditor.frame,
    'Costumes',
    'Abby-a',
    path.join(out, 'after-Abby-a.svg'),
  );
  const afterSound = await exportNamedMedia(
    reopened,
    freshEditor.frame,
    'Sounds',
    'Bark',
    path.join(out, 'after-Bark.wav'),
  );
  expect(afterCostume).toMatchObject({
    md5: beforeCostume.md5,
    sha256: beforeCostume.sha256,
    sizeBytes: beforeCostume.sizeBytes,
  });
  expect(afterSound).toMatchObject({
    md5: beforeSound.md5,
    sha256: beforeSound.sha256,
    sizeBytes: beforeSound.sizeBytes,
  });

  const costumeAssetPath = `/api/blocks/runtime/projects/${projectId}/assets/${beforeCostume.md5}.svg`;
  const soundAssetPath = `/api/blocks/runtime/projects/${projectId}/assets/${beforeSound.md5}.wav`;
  expect(
    runtimeEvents.some(
      (event) =>
        event.phase === 'fresh-reopen' &&
        event.method === 'GET' &&
        event.pathname === costumeAssetPath,
    ),
  ).toBe(true);
  expect(
    runtimeEvents.some(
      (event) =>
        event.phase === 'fresh-reopen' &&
        event.method === 'GET' &&
        event.pathname === soundAssetPath,
    ),
  ).toBe(true);

  await assertUiRegression(reopened, freshEditor.frame);

  const p2 = projectState(projectId);
  const o2 = objectSnapshot();
  await trace.settle();
  await trace.stop();
  const durableTraceEvents = trace.events;
  trace = undefined;

  noOpTrace = await startObjectTrace();
  phase = 'fresh-noop';
  noOpTrace.setPhase('fresh-noop');
  await reopened.waitForTimeout(9000);
  await noOpTrace.settle();
  noOpTrace.setPhase('idle');
  const p3 = projectState(projectId);
  const o3 = objectSnapshot();
  const noOpRuntime = phaseRuntimeMetrics(runtimeEvents, 'fresh-noop');
  expect(noOpRuntime.assetPutRequests).toBe(0);
  expect(noOpRuntime.draftPutRequests).toBe(0);
  expect(noOpRuntime.uploadedBytes).toBe(0);
  expect(delta(p3.blobRows, p2.blobRows)).toBe(0);
  expect(delta(p3.aliasRows, p2.aliasRows)).toBe(0);
  expect(delta(p3.revision, p2.revision)).toBe(0);
  expect(delta(o3.count, o2.count)).toBe(0);
  expect(delta(o3.bytes, o2.bytes)).toBe(0);

  await noOpTrace.stop();
  const noOpTraceEvents = noOpTrace.events;
  noOpTrace = undefined;
  const objectSave = phaseObjectMetrics(durableTraceEvents, 'account-save');
  const objectReopen = phaseObjectMetrics(durableTraceEvents, 'fresh-reopen');
  const objectNoOp = phaseObjectMetrics(noOpTraceEvents, 'fresh-noop');
  expect(objectSave.requests).toBeGreaterThan(0);
  expect(objectReopen.requests).toBeGreaterThan(0);
  expect(objectNoOp.requests).toBe(0);
  const traceEvents = [...durableTraceEvents, ...noOpTraceEvents];

  phase = 'blocks-only-autosave';
  const pBlocks0 = projectState(projectId);
  await editStepValue(freshEditor.frame, 73, 74);
  const blockSave = await waitForRevisionAdvance(projectId, pBlocks0.revision);
  const pBlocks1 = projectState(projectId);
  expect(blockSave.revision).toBe(pBlocks1.revision);
  expect(projectHasStep(pBlocks1, marker, 74)).toBe(true);
  const blocksOnlyRuntime = phaseRuntimeMetrics(runtimeEvents, 'blocks-only-autosave');
  expect(blocksOnlyRuntime.assetPutRequests).toBe(0);
  expect(blocksOnlyRuntime.draftPutRequests).toBe(1);
  expect(delta(pBlocks1.revision, pBlocks0.revision)).toBe(1);

  phase = 'rapid-edit';
  const pRapid0 = projectState(projectId);
  const draftPattern = new RegExp(
    `/api/blocks/runtime/projects/${projectId}/draft$`,
  );
  let firstRapidDraft = true;
  let releaseRapidResponse;
  let markRapidCommitted;
  const rapidRelease = new Promise((resolve) => {
    releaseRapidResponse = resolve;
  });
  const rapidCommitted = new Promise((resolve) => {
    markRapidCommitted = resolve;
  });
  const rapidHandler = async (route, request) => {
    if (request.method() !== 'PUT' || !firstRapidDraft) {
      await route.continue();
      return;
    }
    firstRapidDraft = false;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await response.body();
    markRapidCommitted();
    await rapidRelease;
    await route.fulfill({ response });
  };
  await context.route(draftPattern, rapidHandler);
  try {
    await editStepValue(freshEditor.frame, 74, 75);
    await rapidCommitted;
    expect(projectHasStep(projectState(projectId), marker, 75)).toBe(true);

    await editStepValue(freshEditor.frame, 75, 76);
    releaseRapidResponse();

    await expect
      .poll(() => projectHasStep(projectState(projectId), marker, 76), { timeout: 45000 })
      .toBe(true);
    const pRapid1 = projectState(projectId);
    expect(delta(pRapid1.revision, pRapid0.revision)).toBe(2);
    const rapidRuntime = phaseRuntimeMetrics(runtimeEvents, 'rapid-edit');
    expect(rapidRuntime.assetPutRequests).toBe(0);
    expect(rapidRuntime.draftPutRequests).toBe(2);
  } finally {
    releaseRapidResponse?.();
    await context.unroute(draftPattern, rapidHandler);
  }

  phase = 'student-seat';
  const classCreate = await context.request.post('/api/classrooms', {
    headers: { origin, 'idempotency-key': randomUUID() },
    data: {
      title: `Blocks durable ${projectId.slice(0, 8)}`,
      ageBand: 'mixed',
      topicKeys: [],
      safeModeDefault: true,
    },
  });
  expect(classCreate.status(), await classCreate.text()).toBe(201);
  const classroomId = (await classCreate.json()).classroom.id;
  const classView = await context.request.get(`/api/classrooms/${classroomId}`);
  expect(classView.status(), await classView.text()).toBe(200);
  const joinCode = (await classView.json()).classroom.joinCode;
  const seatCreate = await context.request.post(`/api/classrooms/${classroomId}/seats`, {
    headers: { origin },
    data: { displayLabel: 'Blocks durable learner', safeMode: true },
  });
  expect(seatCreate.status(), await seatCreate.text()).toBe(201);
  const student = (await seatCreate.json()).student;

  let seatContext = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1024, height: 768 },
    locale: 'en-US',
  });
  const resolveSeat = await seatContext.request.post('/api/class-join/resolve', {
    headers: { origin },
    data: { code: joinCode },
  });
  expect(resolveSeat.status(), await resolveSeat.text()).toBe(200);
  const seatLogin = await seatContext.request.post('/api/class-join/studentseat', {
    headers: { origin },
    data: { code: joinCode, studentCode: student.studentCode },
  });
  expect(seatLogin.status(), await seatLogin.text()).toBe(200);
  const seatProject = await createProject(seatContext.request, 'StudentSeat durable Blocks');
  const seatPage = await seatContext.newPage();
  await seatPage.goto(`/#/home/${seatProject.id}?module=blocks`, { waitUntil: 'domcontentloaded' });
  await waitForEditor(seatPage);
  const seatSave = await clickConfirmedSave(seatPage);
  expect(seatSave.revision).toBeGreaterThan(0);
  await seatContext.close();

  seatContext = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1024, height: 768 },
    locale: 'en-US',
  });
  const seatRelogin = await seatContext.request.post('/api/class-join/studentseat', {
    headers: { origin },
    data: { code: joinCode, studentCode: student.studentCode },
  });
  expect(seatRelogin.status(), await seatRelogin.text()).toBe(200);
  const seatReopen = await seatContext.request.post(
    `/api/projects/${seatProject.id}/blocks/runtime-session`,
    { headers: { origin }, data: {} },
  );
  expect(seatReopen.status(), await seatReopen.text()).toBe(200);
  expect((await seatReopen.json()).draftRevision).toBe(seatSave.revision);
  await seatContext.close();

  phase = 'foreign-negative';
  const foreignContext = await browser.newContext({ baseURL: origin, locale: 'en-US' });
  const foreignId = randomUUID().replaceAll('-', '');
  const foreignRegister = await foreignContext.request.post('/api/auth/register', {
    headers: { origin },
    data: {
      email: `${foreignId}@blocks-foreign.test`,
      username: `blocks_${foreignId.slice(0, 20)}`,
      displayName: 'Blocks foreign acceptance',
      password: `Safe-${foreignId}-Password`,
      birthDate: '1990-04-12',
      country: 'RU',
    },
  });
  expect(foreignRegister.status(), await foreignRegister.text()).toBe(201);
  const foreignBootstrap = await foreignContext.request.post(
    `/api/projects/${projectId}/blocks/runtime-session`,
    { headers: { origin }, data: {} },
  );
  expect(foreignBootstrap.status()).toBe(404);

  const foreignProject = await createProject(foreignContext.request, 'Foreign Blocks');
  const foreignSessionResponse = await foreignContext.request.post(
    `/api/projects/${foreignProject.id}/blocks/runtime-session`,
    { headers: { origin }, data: {} },
  );
  expect(foreignSessionResponse.status(), await foreignSessionResponse.text()).toBe(200);
  const foreignSession = await foreignSessionResponse.json();
  const foreignAsset = await foreignContext.request.get(
    `/api/blocks/runtime/projects/${projectId}/assets/${beforeCostume.md5}.svg`,
    {
      headers: {
        origin: runtimeOrigin,
        authorization: `Bearer ${foreignSession.runtimeToken}`,
      },
    },
  );
  expect(foreignAsset.status()).toBe(401);
  const foreignDraft = await foreignContext.request.put(
    `/api/blocks/runtime/projects/${projectId}/draft`,
    {
      headers: {
        origin: runtimeOrigin,
        authorization: `Bearer ${foreignSession.runtimeToken}`,
        'content-type': 'application/vnd.asa.blocks-draft+json',
      },
      data: {
        document: p1.document,
        baseRevision: p1.revision,
        mutationId: randomUUID(),
      },
    },
  );
  expect(foreignDraft.status()).toBe(401);
  await foreignContext.close();

  phase = 'revoked-and-origin-negative';
  const revokedProject = await createProject(context.request, 'Revoked Blocks');
  const revokedSessionResponse = await context.request.post(
    `/api/projects/${revokedProject.id}/blocks/runtime-session`,
    { headers: { origin }, data: {} },
  );
  expect(revokedSessionResponse.status(), await revokedSessionResponse.text()).toBe(200);
  const revokedSession = await revokedSessionResponse.json();
  const deniedBody = {
    document: {},
    baseRevision: revokedSession.draftRevision,
    mutationId: randomUUID(),
  };
  const wrongOrigin = await context.request.put(
    `/api/blocks/runtime/projects/${revokedProject.id}/draft`,
    {
      headers: {
        origin: 'http://evil.invalid',
        authorization: `Bearer ${revokedSession.runtimeToken}`,
        'content-type': 'application/vnd.asa.blocks-draft+json',
      },
      data: deniedBody,
    },
  );
  expect(wrongOrigin.status()).toBe(403);
  const trash = await context.request.post(`/api/projects/${revokedProject.id}/status`, {
    headers: { origin },
    data: { status: 'trashed' },
  });
  expect(trash.status(), await trash.text()).toBe(201);
  const revokedUse = await context.request.put(
    `/api/blocks/runtime/projects/${revokedProject.id}/draft`,
    {
      headers: {
        origin: runtimeOrigin,
        authorization: `Bearer ${revokedSession.runtimeToken}`,
        'content-type': 'application/vnd.asa.blocks-draft+json',
      },
      data: { ...deniedBody, mutationId: randomUUID() },
    },
  );
  expect(revokedUse.status()).toBe(403);

  phase = 'storage-failure';
  await freshEditor.frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
  await freshEditor.frame
    .getByRole('button', { name: 'Choose a Sound', exact: true })
    .first()
    .click();
  await freshEditor.frame.getByText('Boing', { exact: true }).click();
  await expect(freshEditor.frame.getByRole('textbox', { name: 'Sound', exact: true })).toHaveValue(
    'Boing',
  );
  const beforeStorageFailure = projectState(projectId);
  dockerCompose('stop', 'minio');
  const saveButton = reopened.locator('[data-asa-blocks-save]');
  await saveButton.click();
  await expect(saveButton).toHaveAttribute('data-save-state', 'error', { timeout: 45000 });
  const afterStorageFailure = projectState(projectId);
  expect(afterStorageFailure.revision).toBe(beforeStorageFailure.revision);
  dockerCompose('start', 'minio');
  await waitForMinio();

  expect(pageErrors).toEqual([]);
  const p0p1 = phaseRuntimeMetrics(runtimeEvents, 'account-save');
  const p1p2 = phaseRuntimeMetrics(runtimeEvents, 'fresh-reopen');
  const mediaEvidence = { beforeCostume, afterCostume, beforeSound, afterSound };
  const accountEvidence = {
    projectId,
    confirmedRevision: firstSave.revision,
    firstSaveLatencyMs: firstSave.latencyMs,
    reopenLatencyMs,
    p0: { db: p0, objectStore: o0 },
    p1: { db: p1, objectStore: o1 },
    p2: { db: p2, objectStore: o2 },
    p3: { db: p3, objectStore: o3 },
    firstSave: {
      runtime: p0p1,
      objectStore: objectSave,
      revisionDelta: delta(p1.revision, p0.revision),
      blobDelta: delta(p1.blobRows, p0.blobRows),
      aliasDelta: delta(p1.aliasRows, p0.aliasRows),
      objectDelta: delta(o1.count, o0.count),
      objectByteDelta: delta(o1.bytes, o0.bytes),
    },
    freshReopen: { runtime: p1p2, objectStore: objectReopen },
    freshNoOp: {
      runtime: noOpRuntime,
      objectStore: objectNoOp,
      revisionDelta: delta(p3.revision, p2.revision),
      blobDelta: delta(p3.blobRows, p2.blobRows),
      aliasDelta: delta(p3.aliasRows, p2.aliasRows),
      objectDelta: delta(o3.count, o2.count),
      objectByteDelta: delta(o3.bytes, o2.bytes),
    },
  };
  const authorizationEvidence = {
    account: { saveRevision: firstSave.revision, freshReopenRevision: freshSession.draftRevision },
    studentSeat: { projectId: seatProject.id, saveRevision: seatSave.revision },
    foreign: {
      bootstrapStatus: foreignBootstrap.status(),
      assetStatus: foreignAsset.status(),
      draftStatus: foreignDraft.status(),
    },
    invalidOriginStatus: wrongOrigin.status(),
    revokedCapabilityStatus: revokedUse.status(),
    storageFailure: {
      uiState: await saveButton.getAttribute('data-save-state'),
      revisionBefore: beforeStorageFailure.revision,
      revisionAfter: afterStorageFailure.revision,
    },
  };

  fs.writeFileSync(
    path.join(out, 'real-persistence.json'),
    JSON.stringify(accountEvidence, null, 2),
  );
  fs.writeFileSync(path.join(out, 'media-digests.json'), JSON.stringify(mediaEvidence, null, 2));
  fs.writeFileSync(
    path.join(out, 'authorization-negative.json'),
    JSON.stringify(authorizationEvidence, null, 2),
  );
  fs.writeFileSync(
    path.join(out, 'minio-trace.json'),
    JSON.stringify({ events: traceEvents }, null, 2),
  );
  fs.writeFileSync(
    path.join(out, 'result.json'),
    JSON.stringify(
      {
        revision: metadata.revision,
        result: 'PASS',
        portalCookieLeaked,
        runtimeRequests,
        projectId,
        confirmedRevision: firstSave.revision,
        scenario:
          'fresh exported stack → account edit/save → destroy context → re-auth → exact reopen → fresh no-op → StudentSeat/negative acceptance',
        pageErrors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  fs.writeFileSync(
    path.join(out, 'failure.json'),
    JSON.stringify({ phase, error: String(error), pageErrors }, null, 2),
  );
  const lastPage = context.pages().at(-1);
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  await trace?.stop().catch(() => {});
  await noOpTrace?.stop().catch(() => {});
  await context.close().catch(() => {});
  await browser.close();
}
