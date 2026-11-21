import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { dirname } from 'node:path';
import { expect as playwrightExpect, test, type BrowserContext, type Page } from '@playwright/test';
import { e2eAdminPool, seedTeacher } from './seed';

const PUPILS = 30;
const expect = playwrightExpect.configure({ timeout: 20_000 });
type Phase = 'setup' | 'cold' | 'warm' | 'recovery';
type Learner = {
  context: BrowserContext;
  page: Page;
  seatId: string;
  projectId: string;
  name: string;
  x: number;
};

function loopbackOrigin(raw: string | undefined): URL {
  const url = new URL(raw ?? '');
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== raw)
    throw new Error('Scratch classroom evidence requires an exact loopback HTTP origin');
  return url;
}

function editor(learner: Learner) {
  return learner.page.frameLocator('iframe[title="Scratch runtime"]');
}

function editorPath(learner: Learner) {
  return `/#/projects/${learner.projectId}?module=blocks`;
}

async function ready(learner: Learner) {
  await expect(editor(learner).locator('[data-asa-host-shell]')).toHaveAttribute(
    'data-editor-state',
    'ready',
    { timeout: 70_000 },
  );
}

async function visibleSprite(learner: Learner) {
  const frame = editor(learner);
  await frame.getByRole('button', { name: learner.name, exact: true }).click();
  await expect(frame.getByPlaceholder('x', { exact: true })).toHaveValue(String(learner.x));
}

async function editPosition(learner: Learner, x: number) {
  const position = editor(learner).getByPlaceholder('x', { exact: true });
  await position.fill(String(x));
  await position.press('Enter');
  await expect(position).toHaveValue(String(x));
  learner.x = x;
}

test.use({ trace: 'off', screenshot: 'off' });

test('30 real pupil contexts open, autosave and reopen Scratch with independent durable drafts', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    process.env['ASA_SCRATCH_CLASSROOM30'] !== '1',
    'Runs in the isolated Scratch CI stack',
  );
  test.setTimeout(420_000);
  const origin = loopbackOrigin(process.env['ASA_WEB_ORIGIN']);
  const api = loopbackOrigin(baseURL);
  const runtime = loopbackOrigin(process.env['ASA_BLOCKS_UPSTREAM_ORIGIN']);
  const s3 = loopbackOrigin(process.env['ASA_OBJECT_STORAGE_ENDPOINT']);
  const database = new URL(process.env['TEST_DATABASE_URL'] ?? '');
  const appDatabase = new URL(process.env['APP_TEST_DATABASE_URL'] ?? '');
  expect(database.hostname).toBe('127.0.0.1');
  expect(appDatabase.hostname).toBe('127.0.0.1');
  expect(database.pathname).toMatch(/^\/asa_public_scratch_test$/);
  expect(appDatabase.pathname).toBe(database.pathname);
  expect(process.env['ASA_OBJECT_STORAGE_BUCKET']).toBe('public-scratch-ci-only');
  expect(new Set([origin.origin, api.origin, runtime.origin, s3.origin]).size).toBe(4);
  const headers = { origin: origin.origin };
  const learners: Learner[] = [];
  const contexts: BrowserContext[] = [];
  const evidence = {
    revision: process.env['ASA_BUILD_REVISION'],
    users: PUPILS,
    completed: {} as Record<string, number>,
    phaseMs: {} as Record<string, number>,
    vendorRequests: { cold: 0, warm: 0 },
    vendorBytes: { cold: 0, warm: 0 },
    faultAttempts: { session: 0, asset: 0, expiredPermission: 0 },
    rotationSessions: 0,
    assetHits: { cold: 0, warm: 0 },
    databaseActivity: { samples: 0, activePeak: 0, lockWaitPeak: 0, errors: 0 },
    unexpectedApiErrors: [] as { phase: Phase; status: number; operation: string }[],
  };
  const observer = e2eAdminPool();
  let samplePending: Promise<void> | null = null;
  let sampler: ReturnType<typeof setInterval> | undefined;
  const sampleDatabase = () => {
    if (samplePending) return;
    samplePending = observer
      .query<{ active: number; locks: number }>(
        `
        SELECT count(*) FILTER (WHERE state='active')::int AS active,
               count(*) FILTER (WHERE wait_event_type='Lock')::int AS locks
        FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid()
      `,
      )
      .then(({ rows: [sample] }) => {
        if (!sample) throw new Error('Empty PostgreSQL activity sample');
        const activity = evidence.databaseActivity;
        activity.samples++;
        activity.activePeak = Math.max(activity.activePeak, sample.active);
        activity.lockWaitPeak = Math.max(activity.lockWaitPeak, sample.locks);
      })
      .catch(() => {
        evidence.databaseActivity.errors++;
      })
      .finally(() => {
        samplePending = null;
      });
  };
  const runPhase = async (name: string, operation: (learner: Learner) => Promise<void>) => {
    const started = Date.now();
    const results = await Promise.allSettled(learners.map(operation));
    evidence.phaseMs[name] = Date.now() - started;
    evidence.completed[name] = results.filter((result) => result.status === 'fulfilled').length;
    const problems = results.flatMap((result, index) =>
      result.status === 'rejected' ? [`pupil ${index + 1}: ${String(result.reason)}`] : [],
    );
    expect(problems, name).toEqual([]);
  };
  let phase: Phase = 'setup';
  const gateway = createServer((incoming, outgoing) => {
    const url = new URL(incoming.url ?? '/', origin);
    const route = url.pathname;
    const scratch = route.startsWith('/internal/blocks/');
    const vendor = scratch && route.endsWith('/scratch-gui-standalone.js');
    const method = incoming.method;
    const requestPhase = phase;
    if (requestPhase === 'cold' || requestPhase === 'warm') {
      if (vendor) evidence.vendorRequests[requestPhase]++;
      if (method === 'GET' && /^\/api\/blocks\/runtime\/projects\/[^/]+\/assets\//.test(route))
        evidence.assetHits[requestPhase]++;
    }
    const firstProject = learners[0]?.projectId;
    const session =
      method === 'POST' && route === `/api/projects/${firstProject}/blocks/runtime-session`;
    const asset =
      method === 'GET' && route.startsWith(`/api/blocks/runtime/projects/${firstProject}/assets/`);
    const rotationProject = learners[1]?.projectId;
    if (
      phase === 'warm' &&
      method === 'POST' &&
      route === `/api/projects/${rotationProject}/blocks/runtime-session`
    )
      evidence.rotationSessions++;
    if (
      phase === 'warm' &&
      method === 'GET' &&
      route.startsWith(`/api/blocks/runtime/projects/${rotationProject}/assets/`) &&
      evidence.faultAttempts.expiredPermission++ === 0
    ) {
      outgoing.writeHead(401, { 'cache-control': 'no-store', 'content-type': 'application/json' });
      outgoing.end('{"error":{"code":"unauthorized"}}');
      return;
    }
    if (
      (session && phase === 'cold' && evidence.faultAttempts.session++ === 0) ||
      (asset && phase === 'warm' && evidence.faultAttempts.asset++ === 0)
    ) {
      outgoing.writeHead(503, { 'cache-control': 'no-store', 'content-type': 'application/json' });
      outgoing.end('{"error":{"code":"temporary_unavailable"}}');
      return;
    }
    const target = scratch ? runtime : api;
    const path = (scratch ? route.slice('/internal/blocks'.length) : route) + url.search;
    const forwarded = { ...incoming.headers };
    if (scratch) {
      delete forwarded.cookie;
      delete forwarded.authorization;
    }
    const proxied = request(target.origin, { method, path, headers: forwarded }, (reply) => {
      const status = reply.statusCode ?? 502;
      if (
        status >= 400 &&
        (phase === 'cold' || phase === 'warm') &&
        (route.startsWith('/api/blocks/runtime/') || route.endsWith('/blocks/runtime-session'))
      ) {
        evidence.unexpectedApiErrors.push({
          phase,
          status,
          operation: route.endsWith('/blocks/runtime-session')
            ? 'session'
            : route.endsWith('/draft')
              ? 'draft'
              : 'asset',
        });
      }
      outgoing.writeHead(status, reply.headers);
      if (vendor && (requestPhase === 'cold' || requestPhase === 'warm')) {
        reply.on('data', (chunk: Buffer) => {
          evidence.vendorBytes[requestPhase] += chunk.length;
        });
      }
      reply.pipe(outgoing);
    });
    proxied.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    outgoing.once('close', () => proxied.destroy());
    incoming.pipe(proxied);
  });
  const makeContext = async () => {
    const context = await browser.newContext({
      baseURL: origin.origin,
      locale: 'en-US',
      viewport: { width: 1280, height: 850 },
    });
    contexts.push(context);
    return context;
  };
  const draft = async (learner: Learner) => {
    const response = await learner.context.request.get(`/api/projects/${learner.projectId}`);
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.project).toMatchObject({ id: learner.projectId, moduleKey: 'blocks' });
    return result.draft as {
      revision: number;
      document: {
        projectJson: { targets: { name: string; x: number; costumes: { assetId: string }[] }[] };
        assets: { assetId: string; sha256: string }[];
      };
    };
  };
  const verifyDraft = async (learner: Learner, previous: number) => {
    const stored = await draft(learner);
    expect(stored.revision).toBeGreaterThan(previous);
    const sprite = stored.document.projectJson.targets.find(
      (target) => target.name === learner.name,
    );
    expect(sprite?.x).toBe(learner.x);
    expect(
      stored.document.assets.some(
        (asset) =>
          asset.assetId === sprite?.costumes[0]?.assetId && /^[a-f0-9]{64}$/.test(asset.sha256),
      ),
    ).toBe(true);
  };
  const waitForSave = (learner: Learner) =>
    learner.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/blocks/runtime/projects/${learner.projectId}/draft` &&
        response.request().method() === 'PUT' &&
        response.request().postData()?.includes(JSON.stringify(learner.name)) === true,
      { timeout: 110_000 },
    );

  try {
    await new Promise<void>((resolve, reject) => {
      gateway.once('error', reject);
      gateway.listen(Number(origin.port), '127.0.0.1', resolve);
    });
    const revision = await fetch(`${origin.origin}/internal/blocks/asa-commit.txt`);
    expect(revision.status).toBe(200);
    expect((await revision.text()).trim()).toBe(evidence.revision);
    const teacher = await seedTeacher(observer, 'scratch-class30');
    const setup = await makeContext();
    const staff = setup.request;
    const login = await staff.post('/api/auth/login', {
      headers,
      data: { workspace: teacher.workspace, email: teacher.email, password: teacher.password },
    });
    expect(login.status()).toBe(200);
    const classroom = await staff.post('/api/classrooms', {
      headers: { ...headers, 'idempotency-key': randomUUID() },
      data: { title: 'Scratch classroom', ageBand: 'mixed', topicKeys: [], safeModeDefault: true },
    });
    expect(classroom.status()).toBe(201);
    const classId = (await classroom.json()).classroom.id as string;
    const settings = await staff.get(`/api/classrooms/${classId}`);
    expect(settings.status()).toBe(200);
    const code = (await settings.json()).classroom.joinCode as string;
    for (let index = 0; index < PUPILS; index++) {
      const response = await staff.post(`/api/classrooms/${classId}/seats`, {
        headers,
        data: { displayLabel: `Synthetic pupil ${index + 1}`, safeMode: true },
      });
      expect(response.status()).toBe(201);
      const { student } = await response.json();
      const context = await makeContext();
      const joined = await context.request.post('/api/class-join/studentseat', {
        headers,
        data: { code, studentCode: student.studentCode },
      });
      expect(joined.status()).toBe(200);
      const who = await context.request.get('/api/class-join/me');
      expect(await who.json()).toMatchObject({
        authenticated: true,
        student: { seatId: student.id },
      });
      const name = `Scratch pupil ${index + 1}`;
      const created = await context.request.post('/api/projects', {
        headers: { ...headers, 'idempotency-key': randomUUID() },
        data: { module: 'blocks', scope: 'personal', title: name },
      });
      expect(created.status()).toBe(201);
      const page = await context.newPage();
      page.setDefaultTimeout(25_000);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      learners.push({
        context,
        page,
        seatId: student.id,
        projectId: (await created.json()).project.id,
        name,
        x: index + 1,
      });
    }
    expect(new Set(learners.map((learner) => learner.seatId)).size).toBe(PUPILS);
    sampleDatabase();
    sampler = setInterval(sampleDatabase, 1_500);
    phase = 'cold';
    await runPhase('coldOpen', async (learner) => {
      await learner.page.goto(editorPath(learner), { waitUntil: 'domcontentloaded' });
      await ready(learner);
    });
    await runPhase('nativeMinuteSave', async (learner) => {
      const before = (await draft(learner)).revision;
      const [response] = await Promise.all([
        waitForSave(learner),
        (async () => {
          const frame = editor(learner);
          await frame.getByRole('button', { name: 'Choose a Sprite', exact: true }).first().click();
          await frame.getByText('Apple', { exact: true }).click();
          const name = frame.getByPlaceholder('Name', { exact: true });
          await name.fill(learner.name);
          await name.press('Enter');
          await editPosition(learner, learner.x);
        })(),
      ]);
      expect(response.status()).toBe(200);
      expect(await response.finished()).toBeNull();
      await verifyDraft(learner, before);
    });
    phase = 'warm';
    await runPhase('warmReopen', async (learner) => {
      await learner.page.goto('/#/projects', { waitUntil: 'domcontentloaded' });
      await expect(
        learner.page.getByRole('heading', { name: 'Мои проекты', exact: true }),
      ).toBeVisible();
      await learner.page.goto(editorPath(learner), { waitUntil: 'domcontentloaded' });
      await ready(learner);
      await visibleSprite(learner);
      const who = await learner.context.request.get('/api/class-join/me');
      expect(await who.json()).toMatchObject({
        authenticated: true,
        student: { seatId: learner.seatId },
      });
    });
    expect(evidence.vendorRequests.cold).toBeGreaterThan(0);
    expect(evidence.vendorRequests.warm).toBe(0);
    expect(evidence.vendorBytes.cold).toBeGreaterThan(0);
    expect(evidence.vendorBytes.warm).toBe(0);
    expect(evidence.faultAttempts.session).toBeGreaterThan(1);
    expect(evidence.faultAttempts.asset).toBeGreaterThan(1);
    expect(evidence.faultAttempts.expiredPermission).toBeGreaterThan(1);
    expect(evidence.rotationSessions).toBeGreaterThan(1);
    expect(evidence.unexpectedApiErrors).toEqual([]);

    phase = 'recovery';
    const first = learners[0]!;
    const beforeRecovery = (await draft(first)).revision;
    await first.context.setOffline(true);
    await editPosition(first, 111);
    await expect(editor(first).locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-recovery-state',
      'checkpointed',
      { timeout: 15_000 },
    );
    await first.page.close();
    await first.context.setOffline(false);
    first.page = await first.context.newPage();
    const [recoverySave] = await Promise.all([
      waitForSave(first),
      (async () => {
        await first.page.goto(editorPath(first), { waitUntil: 'domcontentloaded' });
        await ready(first);
        await visibleSprite(first);
      })(),
    ]);
    expect(recoverySave.status()).toBe(200);
    await verifyDraft(first, beforeRecovery);
    evidence.completed.offlineTabRecovery = 1;

    const leaving = learners[1]!;
    const beforeExit = (await draft(leaving)).revision;
    await editPosition(leaving, 112);
    const [exitSave] = await Promise.all([
      waitForSave(leaving),
      leaving.page.waitForURL('**/#/home'),
      editor(leaving).getByRole('button', { name: 'ASA Lab', exact: true }).click(),
    ]);
    expect(exitSave.status()).toBe(200);
    await verifyDraft(leaving, beforeExit);
    evidence.completed.controlledExit = 1;

    const revoked = learners.at(-1)!;
    const removal = await staff.delete(`/api/classrooms/${classId}/seats/${revoked.seatId}`, {
      headers,
    });
    expect(removal.status()).toBe(200);
    const denied = await revoked.context.request.post(
      `/api/projects/${revoked.projectId}/blocks/runtime-session`,
      { headers, data: { mode: 'editor' } },
    );
    expect([401, 403]).toContain(denied.status());
    evidence.completed.revocation = 1;
    expect(evidence.databaseActivity.samples).toBeGreaterThan(0);
    expect(evidence.databaseActivity.errors).toBe(0);
  } finally {
    clearInterval(sampler);
    await samplePending;
    await Promise.allSettled(contexts.map((context) => context.close()));
    gateway.closeAllConnections();
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    await observer.end();
    const destination = testInfo.outputPath('scratch-classroom-30.json');
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(evidence, null, 2) + '\n');
  }
});
