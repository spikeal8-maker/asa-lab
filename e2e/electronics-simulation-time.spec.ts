import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type pg from 'pg';
import type { SchematicDocument } from '../apps/web/src/api';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher } from './seed';

type ClockFrame = {
  workerId: number;
  generationId: number;
  requestedMicroseconds: number;
  committedMicroseconds: number;
  status: string;
  computeMs: number | null;
  resultSolved: boolean | null;
  receivedAt: number;
};
type ClockPublication = {
  text: string;
  publishedAt: number;
  frame: ClockFrame | null;
};
type ClockProbe = {
  frames: ClockFrame[];
  publications: ClockPublication[];
  actions: Array<{ name: string; at: number }>;
};
type ProbeWindow = Window & { __integerClockProbe?: ClockProbe };

// A complete ordinary DC circuit: no Arduino cadence or fake clock is needed
// to demonstrate the presentation of real fractional committed horizons.
const initialDocument: SchematicDocument = {
  schemaVersion: 4,
  components: [
    {
      id: 'source',
      kind: 'source',
      componentTypeId: 'battery-holder-aa-2',
      variantId: 'battery-holder-aa-2',
      name: 'Источник 3 В',
      position: { x: 100, y: 150 },
      rotation: 0,
      value: 3,
      pinIds: ['BAT-', 'BAT+'],
      stateProperties: { cells: 2 },
    },
    {
      id: 'resistor',
      kind: 'resistor',
      componentTypeId: 'resistor-axial',
      variantId: 'resistor-axial',
      name: 'R1',
      position: { x: 400, y: 150 },
      rotation: 90,
      value: 220,
      pinIds: ['lead-1', 'lead-2'],
      stateProperties: { tolerancePercent: 5, resistanceUnit: 'Ом' },
    },
  ],
  connections: [
    {
      id: 'positive',
      from: { componentId: 'source', terminal: 'BAT+' },
      to: { componentId: 'resistor', terminal: 'lead-1' },
      color: '#e3212b',
      vertices: [{ x: 300, y: 100 }],
    },
    {
      id: 'negative',
      from: { componentId: 'resistor', terminal: 'lead-2' },
      to: { componentId: 'source', terminal: 'BAT-' },
      color: '#2a3035',
      vertices: [
        { x: 500, y: 350 },
        { x: 100, y: 350 },
      ],
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: false, maxIterations: 24 },
};

async function observeRealClock(page: Page) {
  await page.addInitScript(() => {
    const probe: ClockProbe = { frames: [], publications: [], actions: [] };
    (window as ProbeWindow).__integerClockProbe = probe;
    let workerId = 0;
    let latestReady: ClockFrame | null = null;
    let priorText = '';
    window.Worker = new Proxy(window.Worker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget) as Worker;
        if ((args[1] as WorkerOptions | undefined)?.name !== 'asa-electronics-simulation')
          return worker;
        const id = ++workerId;
        latestReady = null;
        worker.postMessage = new Proxy(worker.postMessage, {
          apply(target, thisArg, messages) {
            if ((messages[0] as { kind?: string })?.kind === 'preflight') latestReady = null;
            return Reflect.apply(target, thisArg, messages);
          },
        });
        worker.addEventListener('message', (event: MessageEvent) => {
          const response = event.data as {
            ok?: boolean;
            kind?: string;
            generationId?: number;
            metrics?: { computeMs: number };
            advance?: {
              requestedHorizonMicroseconds: number;
              committedHorizonMicroseconds: number;
              executionStatus: string;
              result?: { solved: boolean } | null;
            };
          };
          if (!response.ok || response.kind !== 'advance' || !response.advance) return;
          const frame: ClockFrame = {
            workerId: id,
            generationId: response.generationId ?? -1,
            requestedMicroseconds: response.advance.requestedHorizonMicroseconds,
            committedMicroseconds: response.advance.committedHorizonMicroseconds,
            status: response.advance.executionStatus,
            computeMs: response.metrics?.computeMs ?? null,
            resultSolved: response.advance.result?.solved ?? null,
            receivedAt: performance.now(),
          };
          probe.frames.push(frame);
          if (frame.status === 'ready') latestReady = frame;
          // A bounded observer must fail rather than silently lose evidence.
          if (probe.frames.length > 500) throw new Error('Integer clock observer overflow');
        });
        return worker;
      },
    });
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => {
        const text =
          document.querySelector('.workbench-simulation-time')?.textContent?.trim() ?? '';
        if (text !== priorText) {
          priorText = text;
          if (text)
            probe.publications.push({ text, publishedAt: performance.now(), frame: latestReady });
        }
      }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    });
  });
}

async function observation(page: Page) {
  return page.evaluate(() => {
    const probe = (window as ProbeWindow).__integerClockProbe;
    if (!probe) throw new Error('Real Worker observer is missing');
    return probe;
  });
}

async function markAction(page: Page, name: string) {
  await page.evaluate((name) => {
    (window as ProbeWindow).__integerClockProbe?.actions.push({ name, at: performance.now() });
  }, name);
}

async function projectDraft(page: Page, projectId: string) {
  const response = await page.context().request.get(`/api/projects/${projectId}`, {
    headers: { origin: new URL(page.url()).origin },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    draft: { revision: number; document: SchematicDocument; updatedAt: string };
  };
}

async function runStopWithRealClock(page: Page, phase: string, testInfo: TestInfo) {
  const before = await observation(page);
  await markAction(page, `${phase}:Run`);
  await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Остановить моделирование', exact: true }),
  ).toHaveAttribute('data-simulation-status', 'running');
  await expect
    .poll(async () => {
      const probe = await observation(page);
      return probe.publications
        .slice(before.publications.length)
        .some(
          (entry) =>
            entry.frame &&
            entry.frame.committedMicroseconds > 0 &&
            entry.frame.committedMicroseconds % 1_000_000 !== 0,
        );
    })
    .toBe(true);
  // Assert the original fractional publication immediately. BEFORE therefore
  // fails on the actual decimal suffix, not on a deliberately longer wait.
  const fractional = (await observation(page)).publications
    .slice(before.publications.length)
    .find(
      (entry) =>
        entry.frame &&
        entry.frame.committedMicroseconds > 0 &&
        entry.frame.committedMicroseconds % 1_000_000 !== 0,
    )!;
  expect(fractional.text).toMatch(/^Время моделирования: \d{2,}:\d{2}:\d{2}$/);
  await expect
    .poll(async () => {
      const probe = await observation(page);
      return probe.publications
        .slice(before.publications.length)
        .some((entry) => entry.frame && entry.frame.committedMicroseconds >= 1_000_000);
    })
    .toBe(true);
  const geometry = await page.evaluate(() => {
    const clock = document.querySelector('.workbench-simulation-time')!;
    const button = document.querySelector('.workbench-pill.simulate')!;
    const c = clock.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    const caption = Array.from(button.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
      .map((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        return { text: node.textContent?.trim(), left: rect.left, right: rect.right };
      });
    return {
      viewportWidth: innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      clockLeft: c.left,
      clockRight: c.right,
      clockWidth: c.width,
      clockScrollWidth: clock.scrollWidth,
      clockClientWidth: clock.clientWidth,
      buttonLeft: b.left,
      buttonRight: b.right,
      buttonHit: hit !== null && button.contains(hit),
      caption,
    };
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.clockLeft).toBeGreaterThanOrEqual(-1);
  expect(geometry.clockRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.clockScrollWidth).toBeLessThanOrEqual(geometry.clockClientWidth + 1);
  expect(geometry.buttonLeft).toBeGreaterThanOrEqual(-1);
  expect(geometry.buttonRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.buttonHit).toBe(true);
  expect(geometry.caption.map((entry) => entry.text).join('')).toBe('Остановить моделирование');
  for (const caption of geometry.caption) {
    expect(caption.left).toBeGreaterThanOrEqual(geometry.buttonLeft - 1);
    expect(caption.right).toBeLessThanOrEqual(geometry.buttonRight + 1);
  }
  await testInfo.attach(`${phase}-running-clock`, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await markAction(page, `${phase}:Stop`);
  await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
  await expect(page.locator('.workbench-simulation-time')).toHaveCount(0);
  const after = await observation(page);
  const frames = after.frames.slice(before.frames.length);
  expect(
    frames.some((frame) => frame.status === 'ready' && frame.committedMicroseconds === 0),
  ).toBe(true);
  for (const frame of frames) {
    expect(Number.isSafeInteger(frame.committedMicroseconds)).toBe(true);
    expect(frame.committedMicroseconds).toBeLessThanOrEqual(frame.requestedMicroseconds);
    if (frame.status === 'ready')
      expect(frame.committedMicroseconds).toBe(frame.requestedMicroseconds);
    if (frame.status === 'ready') expect(frame.resultSolved).toBe(true);
    expect(frame.status).not.toBe('fault');
    expect(frame.computeMs).not.toBeNull();
  }
  for (const publication of after.publications.slice(before.publications.length)) {
    if (!publication.frame) continue;
    expect(publication.frame.status).toBe('ready');
    const seconds = Math.floor(publication.frame.committedMicroseconds / 1_000_000);
    const expected = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map((part) => String(part).padStart(2, '0'))
      .join(':');
    expect(publication.text).toBe(`Время моделирования: ${expected}`);
    expect(publication.publishedAt).toBeGreaterThanOrEqual(publication.frame.receivedAt);
  }
  return {
    phase,
    geometry,
    frames,
    publications: after.publications.slice(before.publications.length),
  };
}

let admin: pg.Pool;
test.beforeAll(() => {
  admin = e2eAdminPool();
});
test.afterAll(async () => {
  await admin.end();
});

for (const width of [1440, 1024, 390, 320]) {
  test(`integer simulation time: real DC Run Stop save reopen at ${width}px`, async ({
    page,
    browser,
  }, testInfo) => {
    const teacher = await seedTeacher(
      admin,
      `e2e-integer-clock-${width}-${testInfo.workerIndex}-${testInfo.retry}`,
    );
    const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
    const phases: unknown[] = [];
    await page.setViewportSize({ width: 1440, height: 900 });
    await observeRealClock(page);
    await loginWithOrganization(page, teacher);
    const sessionResponse = await page.context().request.get('/api/auth/me');
    expect(sessionResponse.status()).toBe(200);
    const session = (await sessionResponse.json()) as {
      authenticated: boolean;
      user: { id: string };
    };
    expect(session.authenticated).toBe(true);
    const userId = session.user.id;
    const created = await page.context().request.post('/api/projects', {
      headers: { origin: new URL(page.url()).origin, 'idempotency-key': crypto.randomUUID() },
      data: {
        scope: 'personal',
        classroomId: null,
        module: 'electronics',
        title: `Целое время ${width}`,
      },
    });
    expect(created.status()).toBe(201);
    const projectId = ((await created.json()) as { project: { id: string } }).project.id;
    const empty = await projectDraft(page, projectId);
    const seeded = await page.context().request.put(`/api/projects/${projectId}/draft`, {
      headers: { origin: new URL(page.url()).origin },
      data: {
        document: initialDocument,
        baseRevision: empty.draft.revision,
        mutationId: crypto.randomUUID(),
      },
    });
    expect(seeded.status()).toBe(200);
    let reopened: Page | null = null;
    try {
      await page.goto(`/#/home/${projectId}`);
      await expect(page.locator('.workbench-stage')).toBeVisible();
      await page.locator('[data-component-id="resistor"] .workbench-part').press('Enter');
      const resistance = page
        .locator('.workbench-inspector label')
        .filter({ hasText: 'Сопротивление' })
        .locator('input[type="number"]');
      await resistance.fill('333.3');
      await expect(resistance).toHaveValue('333.3');
      const localKey = `asa-project-local-draft:user:account:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`;
      const wholeEdited = await page.evaluate(
        ({ key, id, userId }) => {
          const raw = localStorage.getItem(key);
          if (!raw) throw new Error('Edited full local document is missing');
          const record = JSON.parse(raw) as {
            schemaVersion: number;
            identityKind: string;
            userId: string;
            projectId: string;
            moduleKey: string;
            document: SchematicDocument;
          };
          if (
            record.schemaVersion !== 3 ||
            record.identityKind !== 'account' ||
            record.userId !== userId ||
            record.projectId !== id ||
            record.moduleKey !== 'electronics'
          )
            throw new Error('Edited full local document belongs to another identity or scope');
          return record.document;
        },
        { key: localKey, id: projectId, userId },
      );
      expect(wholeEdited.components.find((item) => item.id === 'resistor')?.value).toBe(333.3);
      const beforeSave = await projectDraft(page, projectId);
      await markAction(page, 'Save');
      await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
      await expect
        .poll(async () => (await projectDraft(page, projectId)).draft.document)
        .toEqual(wholeEdited);
      const saved = await projectDraft(page, projectId);
      expect(saved.draft.revision).toBe(beforeSave.draft.revision + 1);
      phases.push({ wholeEdited, beforeSave: beforeSave.draft, saved: saved.draft });
      await page.setViewportSize({ width, height: 900 });
      phases.push(await runStopWithRealClock(page, 'first', testInfo));
      phases.push(await runStopWithRealClock(page, 'restart', testInfo));
      expect((await projectDraft(page, projectId)).draft).toEqual(saved.draft);
      const cookies = await page.context().cookies();
      const fresh = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width, height: 900 },
      });
      try {
        await fresh.addCookies(cookies);
        reopened = await fresh.newPage();
        const freshFailures = collectBrowserFailures(reopened, {
          allowAnonymousSessionProbe: true,
        });
        await observeRealClock(reopened);
        await reopened.goto(`/#/home/${projectId}`);
        await expect(reopened.locator('.workbench-stage')).toBeVisible();
        expect(
          await reopened.evaluate(() =>
            Object.keys(localStorage).filter((key) => key.startsWith('asa-project-local-draft:')),
          ),
        ).toEqual([]);
        expect((await projectDraft(reopened, projectId)).draft).toEqual(saved.draft);
        // The reopened DOM must expose the actual persisted component value.
        await reopened.locator('[data-component-id="resistor"] .workbench-part').press('Enter');
        await expect(
          reopened
            .locator('.workbench-inspector label')
            .filter({ hasText: 'Сопротивление' })
            .locator('input[type="number"]'),
        ).toHaveValue('333.3');
        phases.push(await runStopWithRealClock(reopened, 'cookies-only-reopen', testInfo));
        expect((await projectDraft(reopened, projectId)).draft).toEqual(saved.draft);
        freshFailures.assertEmpty();
      } finally {
        if (reopened) phases.push({ reopenedProbe: await observation(reopened) });
        await fresh.close();
        reopened = null;
      }
      failures.assertEmpty();
    } finally {
      await testInfo.attach(`integer-clock-${width}-raw`, {
        body: JSON.stringify(
          {
            width,
            projectId,
            phases,
            probe: await observation(page),
            server: await projectDraft(page, projectId),
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
      await page.screenshot({ path: testInfo.outputPath(`integer-clock-${width}.png`) });
    }
  });
}
