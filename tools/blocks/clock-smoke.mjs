import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';

// Only a disposable exported-source CI installation; never a user database.
assert.equal(process.env.CI, 'true');
const root = path.resolve(process.env.ASA_PORTABLE_ROOT ?? '');
assert.ok(path.basename(root).startsWith('asa-portable-'));
assert.ok(!fs.existsSync(path.join(root, '.git')));
const values = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
assert.equal(values.ASA_SEED_DEV, 'true');
const origin = 'http://127.0.0.1:4610';
const out = path.resolve('reports/blocks/portable-install');
fs.mkdirSync(out, { recursive: true });
const evidence = { revision: process.env.ASA_BUILD_REVISION, result: 'RUNNING', cases: [] };
const browser = await chromium.launch({ headless: true });
const contexts = [];
const startedAt = performance.now();

async function bootstrap(context, projectId) {
  const response = await context.request.post(`/api/projects/${projectId}/blocks/runtime-session`, {
    headers: { origin },
    data: {},
  });
  expect(response.status()).toBe(200);
  return response.json();
}

async function setXAndVerify(item, x) {
  const { page, context, projectId, marker } = item;
  const frame = page.frameLocator('iframe[title="Scratch runtime"]');
  await frame.getByPlaceholder('x', { exact: true }).fill(String(x));
  await frame.getByPlaceholder('x', { exact: true }).press('Enter');
  await expect
    .poll(
      async () => {
        const state = await bootstrap(context, projectId);
        return state.projectJson?.targets?.find((target) => target.name === marker)?.x;
      },
      { timeout: 90_000, intervals: [1000, 2000, 5000] },
    )
    .toBe(x);
  return (await bootstrap(context, projectId)).draftRevision;
}

try {
  for (const hours of [-3, 3]) {
    const context = await browser.newContext({
      baseURL: origin,
      locale: 'en-US',
      viewport: { width: 1440, height: 960 },
    });
    contexts.push(context);
    await context.addInitScript((offsetMs) => {
      const RealDate = Date;
      class StudentDate extends RealDate {
        constructor(...args) {
          if (args.length) super(...args);
          else super(RealDate.now() + offsetMs);
        }
        static now() {
          return RealDate.now() + offsetMs;
        }
      }
      globalThis.Date = StudentDate;
      globalThis.__clockProofInitCount = 0;
      globalThis.addEventListener('message', (event) => {
        if (event.data?.messageType === 'ASA_BLOCKS_INIT') globalThis.__clockProofInitCount += 1;
      });
    }, hours * 3_600_000);
    const login = await context.request.post('/api/auth/login', {
      headers: { origin },
      data: {
        workspace: values.ASA_SEED_WORKSPACE,
        email: values.ASA_SEED_TEACHER_EMAIL,
        password: values.ASA_SEED_TEACHER_PASSWORD,
      },
    });
    expect(login.status()).toBe(200);
    const ready = await (await context.request.get('/health/ready')).json();
    expect(ready.deployment.revision).toBe(evidence.revision);
    expect(ready.deployment.synchronized).toBe(true);
    const created = await context.request.post('/api/projects', {
      headers: { origin, 'idempotency-key': randomUUID() },
      data: {
        scope: 'personal',
        classroomId: null,
        module: 'blocks',
        title: `Clock ${hours}`,
        automaticTitle: false,
      },
    });
    expect([200, 201]).toContain(created.status());
    const projectId = (await created.json()).project.id;
    const page = await context.newPage();
    let grants = 0;
    let suspend = false;
    let releasePending;
    let interrupted = 0;
    let pendingRefresh = false;
    const sessionPath = `${origin}/api/projects/${projectId}/blocks/runtime-session`;
    await page.route(sessionPath, async (route) => {
      if (suspend) {
        pendingRefresh = true;
        await new Promise((resolve) => {
          releasePending = resolve;
        });
        interrupted += 1;
        await route.fulfill({ status: 503, headers: { 'retry-after': '1' }, body: '{}' });
      } else {
        await route.continue();
      }
    });
    page.on('response', (response) => {
      if (response.url() === sessionPath && response.status() === 200) grants += 1;
    });
    const firstResponse = page.waitForResponse(
      (response) => response.url() === sessionPath && response.status() === 200,
    );
    await page.goto(`/#/home/${projectId}?module=blocks`, { waitUntil: 'domcontentloaded' });
    const first = await firstResponse;
    const grant = await first.json();
    const serverMs = Date.parse(first.headers().date);
    const ttlMs = grant.expiresAt * 1000 - serverMs;
    expect(ttlMs).toBeGreaterThanOrEqual(599_000);
    expect(ttlMs).toBeLessThanOrEqual(600_000);
    const expiresAtElapsed = performance.now() + ttlMs + 2000;
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45_000 },
    );
    const marker = `Clock proof ${hours}`;
    await frame.getByPlaceholder('Name', { exact: true }).fill(marker);
    await frame.getByPlaceholder('Name', { exact: true }).press('Enter');
    const item = {
      page,
      context,
      projectId,
      marker,
      grant,
      expiresAtElapsed,
      getGrants: () => grants,
    };
    const initialRevision = await setXAndVerify(item, 137);
    item.initialGrants = grants;
    const proof = {
      offsetHours: hours,
      opened: true,
      initialRevision,
      serverTtlSeconds: ttlMs / 1000,
      initialGrants: grants,
    };
    evidence.cases.push(proof);
    item.proof = proof;
    if (hours === 3) {
      suspend = true;
      // Simulate a stopped parent monotonic clock and hidden tab. Server time
      // and real timers remain untouched; expiry below is a real 10-minute wait.
      await page.evaluate(() => {
        const now = performance.now();
        Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
        Object.defineProperty(globalThis.document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        });
        globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange'));
      });
      item.resume = async () => {
        expect(pendingRefresh, 'scheduled refresh waited across suspension').toBe(true);
        suspend = false;
        await page.evaluate(() => {
          delete performance.now;
          delete globalThis.document.visibilityState;
          globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange'));
          globalThis.dispatchEvent(new globalThis.Event('pageshow'));
          globalThis.dispatchEvent(new globalThis.Event('online'));
        });
        releasePending();
        await expect.poll(() => grants, { timeout: 15_000 }).toBeGreaterThan(item.initialGrants);
        proof.transient503Responses = interrupted;
        expect(interrupted).toBe(1);
      };
    }
    item.frame = frame;
    contexts[contexts.length - 1].clockItem = item;
  }

  const items = contexts.map((context) => context.clockItem);
  const remaining = Math.max(...items.map((item) => item.expiresAtElapsed)) - performance.now();
  console.log(
    'Waiting once for the real server capability TTL; browser timers are not accelerated.',
  );
  await sleep(Math.max(0, remaining));
  for (const item of items) {
    const expired = await item.context.request.get(
      `/api/blocks/runtime/projects/${item.projectId}/assets/${'0'.repeat(32)}.svg`,
      {
        headers: { origin, authorization: `Bearer ${item.grant.runtimeToken}` },
      },
    );
    expect(expired.status(), 'old real server capability remains expired').toBe(401);
    expect((await expired.json()).error.code).toBe('expired_token');
    item.proof.oldTokenStatus = expired.status();
    if (item.resume) await item.resume();
    expect(item.getGrants(), 'proactive or resume renewal').toBeGreaterThan(item.initialGrants);
    item.proof.grantsAfterTtl = item.getGrants();
    item.proof.afterExpiryRevision = await setXAndVerify(item, 151);
    expect(item.proof.afterExpiryRevision).toBeGreaterThan(item.proof.initialRevision);
    const child = item.page.frames().find((frame) => frame.url().includes('/internal/blocks/'));
    expect(await child.evaluate(() => globalThis.__clockProofInitCount)).toBe(1);
    item.proof.initCountBeforeReopen = 1;
    await item.page.reload({ waitUntil: 'domcontentloaded' });
    await expect(item.frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45_000 },
    );
    await expect(item.frame.getByPlaceholder('Name', { exact: true })).toHaveValue(item.marker);
    await expect(item.frame.getByPlaceholder('x', { exact: true })).toHaveValue('151');
    item.proof.reopenedWithSavedState = true;
    await item.page.screenshot({ path: path.join(out, `clock-${item.proof.offsetHours}.png`) });
  }
  evidence.result = 'PASS';
} catch (error) {
  evidence.result = 'FAIL';
  throw error;
} finally {
  evidence.elapsedSeconds = Math.round((performance.now() - startedAt) / 1000);
  fs.writeFileSync(path.join(out, 'clock-proof.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  await browser.close();
}
