import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type pg from 'pg';
import type { SchematicDocument } from '../apps/web/src/api';
import { parseElectronicsDocument } from '../contexts/electronics/domain/document';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher } from './seed';

test.use({ trace: 'on', screenshot: 'on' });
const sketch =
  '// retained whole sketch\nvoid setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}\nvoid loop(){delay(100);}\n';
const input: SchematicDocument = {
  schemaVersion: 4,
  components: [
    {
      id: 'supply',
      kind: 'source',
      componentTypeId: 'regulated-power-supply',
      variantId: 'regulated-power-supply',
      position: { x: 10, y: 20 },
      value: 5,
      state: true,
      pinIds: ['positive', 'negative'],
      stateProperties: {
        voltageSetpointVolt: 5,
        currentLimitAmp: 1,
        outputEnabled: true,
        outputResistanceOhm: 0.05,
      },
    },
    {
      id: 'load',
      kind: 'resistor',
      componentTypeId: 'resistor-axial',
      variantId: 'resistor-axial',
      position: { x: 400, y: 20 },
      value: 220,
      pinIds: ['lead-1', 'lead-2'],
      stateProperties: { powerRatingWatt: 5, tolerancePercent: 5, resistanceUnit: 'Ω' },
    },
    {
      id: 'uno',
      kind: 'visual',
      componentTypeId: 'arduino-uno',
      variantId: 'arduino-uno',
      position: { x: 700, y: 100 },
      value: 5,
      pinIds: ['d13', 'power-gnd-1', 'power-5v', 'power-3v3'],
      stateProperties: {
        arduinoCodeMode: 'text',
        arduinoSource: sketch,
        arduinoWorkspace: '{"blocks":{"blocks":[]}}',
        arduinoSerialOpen: false,
        arduinoBaudRate: 9600,
      },
    },
  ],
  connections: [
    {
      id: 'positive',
      from: { componentId: 'supply', terminal: 'positive' },
      to: { componentId: 'load', terminal: 'lead-1' },
      vertices: [{ x: 300, y: 20 }],
      color: '#ff0000',
    },
    {
      id: 'negative',
      from: { componentId: 'load', terminal: 'lead-2' },
      to: { componentId: 'supply', terminal: 'negative' },
      vertices: [],
      color: '#000000',
    },
  ],
  viewport: { x: 5, y: 6, zoom: 1.25 },
  simulation: { running: false, maxIterations: 24 },
};

// Actual domain parser validates and adds explicit model identities BEFORE API
// seeding. Expected documents never come from the server or observed UI.
const parsed = parseElectronicsDocument(input);
if (!parsed.ok) throw new Error(parsed.message);
// Domain arrays are readonly in the type contract; the browser/API contract
// names mutable arrays. Serialization retains the complete canonical payload.
const initial: SchematicDocument = JSON.parse(JSON.stringify(parsed.document));
const reparsed = parseElectronicsDocument(initial);
if (!reparsed.ok || JSON.stringify(reparsed.document) !== JSON.stringify(initial))
  throw new Error('Wheel fixture is not parser-idempotent');
const expected: SchematicDocument = {
  ...initial,
  components: initial.components.map((part) =>
    part.id === 'load' ? { ...part, value: 333.3 } : part,
  ),
};
const editedParsed = parseElectronicsDocument(expected);
if (!editedParsed.ok || JSON.stringify(editedParsed.document) !== JSON.stringify(expected))
  throw new Error('Edited whole fixture is not parser-idempotent');

async function localDocument(page: Page, user: string, project: string, requireDraft = true) {
  return page.locator('.workbench-stage').evaluate(
    (stage, { user, project, requireDraft }) => {
      type Fiber = {
        stateNode?: unknown;
        child?: Fiber | null;
        sibling?: Fiber | null;
        return?: Fiber | null;
        memoizedProps?: {
          controller?: { project?: { id: string }; document?: SchematicDocument | null };
        };
      };
      // Read the current committed tree, not a potentially stale host alternate.
      // WorkbenchStage renders this controller.document directly. No callback,
      // React state, browser storage or product document is invoked or modified.
      let container: Element | null = stage;
      let current: Fiber | undefined;
      while (container && !current) {
        const key = Object.keys(container).find((key) => key.startsWith('__reactContainer$'));
        if (key) {
          const root = (container as unknown as Record<string, Fiber>)[key]!;
          current = (root.stateNode as { current?: Fiber } | undefined)?.current;
        }
        container = container.parentElement;
      }
      if (!current) throw new Error('Actual committed React root not available');
      const pending = [current];
      let host: Fiber | undefined;
      while (pending.length) {
        const fiber = pending.pop()!;
        if (fiber.stateNode === stage) {
          host = fiber;
          break;
        }
        if (fiber.sibling) pending.push(fiber.sibling);
        if (fiber.child) pending.push(fiber.child);
      }
      let controller: NonNullable<NonNullable<Fiber['memoizedProps']>['controller']> | undefined;
      for (let owner = host?.return; owner; owner = owner.return) {
        if (owner.memoizedProps?.controller) {
          controller = owner.memoizedProps.controller;
          break;
        }
      }
      if (controller?.project?.id !== project || controller.document?.schemaVersion !== 4)
        throw new Error('Actual local controller/document scope mismatch');
      const actual = controller.document;
      const key = `asa-project-local-draft:user:account:${encodeURIComponent(user)}:${encodeURIComponent(project)}`;
      const text = localStorage.getItem(key);
      if (!text) {
        if (requireDraft) throw new Error('Expected full account-scoped local document');
        return actual;
      }
      const record = JSON.parse(text) as {
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
        record.userId !== user ||
        record.projectId !== project ||
        record.moduleKey !== 'electronics'
      )
        throw new Error('Local document scope mismatch');
      if (JSON.stringify(record.document) !== JSON.stringify(actual))
        throw new Error('Dirty draft differs from actual committed local document');
      return actual;
    },
    { user, project, requireDraft },
  );
}

type WheelReceipt = {
  trusted: boolean;
  cancelable: boolean;
  prevented: boolean;
  stage: boolean;
  deltaY: number;
  clientX: number;
  clientY: number;
  at: number;
  target: string;
  scrollBefore: number[];
  scrollAfter: number[];
};
type WheelProbe = { events: WheelReceipt[]; viewBoxes: string[] };
type ProbeWindow = Window & { __nativeWheel?: WheelProbe };
async function installObserver(page: Page) {
  await page.addInitScript(() => {
    const probe: WheelProbe = { events: [], viewBoxes: [] };
    const captured = new WeakMap<WheelEvent, WheelReceipt>();
    (window as ProbeWindow).__nativeWheel = probe;
    const scroll = () => [
      scrollX,
      scrollY,
      document.documentElement.scrollLeft,
      document.documentElement.scrollTop,
      document.body?.scrollLeft ?? 0,
      document.body?.scrollTop ?? 0,
    ];
    document.addEventListener(
      'wheel',
      (event) => {
        const target = event.target as Element;
        const receipt: WheelReceipt = {
          trusted: event.isTrusted,
          cancelable: event.cancelable,
          prevented: false,
          stage: !!target.closest('.workbench-canvas'),
          deltaY: event.deltaY,
          clientX: event.clientX,
          clientY: event.clientY,
          at: performance.now(),
          target: target.tagName + '.' + target.getAttribute('class'),
          scrollBefore: scroll(),
          scrollAfter: [],
        };
        captured.set(event, receipt);
      },
      { capture: true, passive: true },
    );
    // The SVG target handler runs before document bubble, regardless of any
    // microtask checkpoint between native listener callbacks. Capture only
    // takes before-data; this passive listener reads the same original event.
    document.addEventListener(
      'wheel',
      (event) => {
        const receipt = captured.get(event);
        if (!receipt) throw new Error('Native wheel capture receipt is missing');
        receipt.prevented = event.defaultPrevented;
        receipt.scrollAfter = scroll();
        probe.events.push(receipt);
        captured.delete(event);
      },
      { passive: true },
    );
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as Element;
        if (record.attributeName === 'viewBox' && target.matches('.workbench-canvas'))
          probe.viewBoxes.push(target.getAttribute('viewBox')!);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['viewBox'] });
  });
}
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<SVGSVGElement>('.workbench-canvas');
    if (!canvas) throw new Error('Real canvas missing');
    const rect = canvas.getBoundingClientRect();
    const box = canvas.viewBox.baseVal;
    return {
      probe: (window as ProbeWindow).__nativeWheel!,
      viewport: { x: box.x, y: box.y, zoom: 1600 / box.width },
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      scroll: [
        scrollX,
        scrollY,
        document.documentElement.scrollLeft,
        document.documentElement.scrollTop,
        document.body.scrollLeft,
        document.body.scrollTop,
      ],
      pageWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      canvasVisible: rect.width > 0 && rect.height > 0,
    };
  });
}
async function serverDraft(page: Page, project: string) {
  const response = await page.context().request.get('/api/projects/' + project, {
    headers: { origin: new URL(page.url()).origin },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { draft: { revision: number; document: SchematicDocument } };
}
function world(
  view: { x: number; y: number; zoom: number },
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
) {
  // Independent xMidYMid/slice arithmetic, not a production geometry import.
  const scale = Math.max((rect.width * view.zoom) / 1600, (rect.height * view.zoom) / 980);
  const ox = (rect.width - (1600 / view.zoom) * scale) / 2;
  const oy = (rect.height - (980 / view.zoom) * scale) / 2;
  return { x: view.x + (x - rect.left - ox) / scale, y: view.y + (y - rect.top - oy) / scale };
}
let admin: pg.Pool;
test.beforeAll(() => {
  admin = e2eAdminPool();
});
test.afterAll(async () => {
  await admin.end();
});
for (const width of [1440, 1024, 390, 320]) {
  test(
    'native wheel: local zoom and whole pupil save reopen at ' + width + 'px',
    async ({ page, browser }, info) => {
      const journal: Record<string, unknown> = {
        width,
        initial,
        expected,
        checkpoint: 'setup',
        phases: [],
      };
      const phases = journal['phases'] as unknown[];
      const consoleMessages: unknown[] = [];
      const pageErrors: string[] = [];
      const puts: unknown[] = [];
      const network: unknown[] = [];
      let project = '';
      let user = '';
      let primary: unknown;
      let fresh: Awaited<ReturnType<typeof browser.newContext>> | undefined;
      page.on('console', (message) =>
        consoleMessages.push({
          type: message.type(),
          text: message.text(),
          location: message.location(),
        }),
      );
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('request', (request) => {
        if (request.method() === 'PUT' && request.url().includes('/draft'))
          puts.push(request.postDataJSON());
      });
      page.on('response', (response) => {
        if (response.url().includes('/api/'))
          network.push({
            url: response.url(),
            status: response.status(),
            method: response.request().method(),
          });
      });
      const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
      try {
        const teacher = await seedTeacher(
          admin,
          'e2e-native-wheel-' + width + '-' + info.workerIndex + '-' + info.retry,
        );
        await page.setViewportSize({ width: 1440, height: 900 });
        await installObserver(page);
        await loginWithOrganization(page, teacher);
        const me = await page.context().request.get('/api/auth/me');
        expect(me.status()).toBe(200);
        user = ((await me.json()) as { user: { id: string } }).user.id;
        const origin = new URL(page.url()).origin;
        const created = await page.context().request.post('/api/projects', {
          headers: { origin, 'idempotency-key': crypto.randomUUID() },
          data: {
            scope: 'personal',
            classroomId: null,
            module: 'electronics',
            title: 'Колесо ' + width,
          },
        });
        journal['createResponse'] = { status: created.status(), body: await created.text() };
        expect(created.status()).toBe(201);
        project = ((await created.json()) as { project: { id: string } }).project.id;
        const empty = await serverDraft(page, project);
        const seeded = await page.context().request.put('/api/projects/' + project + '/draft', {
          headers: { origin },
          data: {
            document: initial,
            baseRevision: empty.draft.revision,
            mutationId: crypto.randomUUID(),
          },
        });
        journal['seedResponse'] = { status: seeded.status(), body: await seeded.text() };
        expect(seeded.status()).toBe(200);
        const seed = await serverDraft(page, project);
        expect(seed.draft.document).toEqual(initial);
        journal['seed'] = seed;
        journal['checkpoint'] = 'seeded';
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/#/home/' + project);
        await expect(page.locator('.workbench-stage')).toBeVisible();
        expect(await localDocument(page, user, project, false)).toEqual(initial);
        const start = await snapshot(page);
        expect(start.pageWidth).toBeLessThanOrEqual(start.clientWidth + 1);
        expect(start.canvasVisible).toBe(true);
        let cancelable = 0;
        for (const delta of [100, -100]) {
          const before = await snapshot(page);
          const x = before.rect.left + before.rect.width * 0.42;
          const y = before.rect.top + before.rect.height * 0.52;
          const hit = await page.evaluate(
            ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.workbench-canvas'),
            { x, y },
          );
          expect(hit).toBe(true);
          await page.mouse.move(x, y);
          await page.mouse.wheel(0, delta);
          await expect
            .poll(async () => (await snapshot(page)).probe.events.length)
            .toBe(before.probe.events.length + 1);
          const zoom = Math.max(0.2, Math.min(8, before.viewport.zoom * (delta > 0 ? 0.88 : 1.14)));
          await expect.poll(async () => (await snapshot(page)).viewport.zoom).toBeCloseTo(zoom, 6);
          const after = await snapshot(page);
          const event = after.probe.events.at(-1)!;
          phases.push({
            delta,
            before,
            after,
            local: await localDocument(page, user, project, false),
          });
          journal['checkpoint'] = 'wheel-' + delta;
          expect(event.trusted).toBe(true);
          expect(event.stage).toBe(true);
          if (event.cancelable) {
            cancelable++;
            expect.soft(event.prevented).toBe(true);
          }
          expect(after.probe.viewBoxes.length - before.probe.viewBoxes.length).toBe(1);
          const a = world(before.viewport, before.rect, x, y);
          const b = world(after.viewport, after.rect, x, y);
          expect(b.x).toBeCloseTo(a.x, 3);
          expect(b.y).toBeCloseTo(a.y, 3);
          expect(after.scroll).toEqual(before.scroll);
          expect(await localDocument(page, user, project, false)).toEqual(initial);
          expect((await serverDraft(page, project)).draft).toEqual(seed.draft);
          expect(puts).toHaveLength(0);
          await page.screenshot({ path: info.outputPath('wheel-' + delta + '-' + width + '.png') });
        }
        expect
          .soft(cancelable, 'At least one genuinely cancelable native wheel is required')
          .toBeGreaterThan(0);
        const outside = page.getByRole('button', { name: 'Открыть редактор кода', exact: true });
        await expect(outside).toBeVisible();
        const box = await outside.boundingBox();
        if (!box) throw new Error('Outside stage control has no bounds');
        const beforeOutside = await snapshot(page);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 100);
        await expect
          .poll(async () => (await snapshot(page)).probe.events.length)
          .toBe(beforeOutside.probe.events.length + 1);
        const afterOutside = await snapshot(page);
        phases.push({ outside: { before: beforeOutside, after: afterOutside } });
        expect(afterOutside.probe.events.at(-1)?.stage).toBe(false);
        expect(afterOutside.probe.events.at(-1)?.prevented).toBe(false);
        expect(afterOutside.viewport).toEqual(beforeOutside.viewport);
        expect(puts).toHaveLength(0);
        // Keyboard selection is a real accessible pupil action, not a forced click.
        await page.locator('[data-component-id="load"] .workbench-part').press('Enter');
        const resistance = page
          .locator('.workbench-inspector label')
          .filter({ hasText: 'Сопротивление' })
          .locator('input[type="number"]');
        await resistance.fill('333.3');
        await expect(resistance).toHaveValue('333.3');
        expect(await localDocument(page, user, project, true)).toEqual(expected);
        expect(puts).toHaveLength(0);
        journal['checkpoint'] = 'edited';
        await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
        await expect
          .poll(async () => (await serverDraft(page, project)).draft.document)
          .toEqual(expected);
        const saved = await serverDraft(page, project);
        expect(saved.draft.revision).toBe(seed.draft.revision + 1);
        expect(puts).toHaveLength(1);
        expect((puts[0] as { document: SchematicDocument; baseRevision: number }).document).toEqual(
          expected,
        );
        expect((puts[0] as { baseRevision: number }).baseRevision).toBe(seed.draft.revision);
        journal['saved'] = saved;
        journal['checkpoint'] = 'saved';
        fresh = await browser.newContext({ baseURL: origin, viewport: { width, height: 900 } });
        await fresh.addCookies(await page.context().cookies());
        const reopened = await fresh.newPage();
        reopened.on('console', (message) =>
          consoleMessages.push({
            page: 'reopened',
            type: message.type(),
            text: message.text(),
            location: message.location(),
          }),
        );
        reopened.on('pageerror', (error) => pageErrors.push('reopened: ' + error.message));
        reopened.on('request', (request) => {
          if (request.method() === 'PUT' && request.url().includes('/draft'))
            puts.push(request.postDataJSON());
        });
        reopened.on('response', (response) => {
          if (response.url().includes('/api/'))
            network.push({
              page: 'reopened',
              url: response.url(),
              status: response.status(),
              method: response.request().method(),
            });
        });
        const reopenFailures = collectBrowserFailures(reopened, {
          allowAnonymousSessionProbe: true,
        });
        await reopened.goto('/#/home/' + project);
        await expect(reopened.locator('.workbench-stage')).toBeVisible();
        expect(
          await reopened.evaluate(() =>
            Object.keys(localStorage).filter((key) => key.startsWith('asa-project-local-draft:')),
          ),
        ).toEqual([]);
        expect(await localDocument(reopened, user, project, false)).toEqual(expected);
        expect((await serverDraft(reopened, project)).draft).toEqual(saved.draft);
        await reopened.locator('[data-component-id="load"] .workbench-part').press('Enter');
        await expect(
          reopened
            .locator('.workbench-inspector label')
            .filter({ hasText: 'Сопротивление' })
            .locator('input[type="number"]'),
        ).toHaveValue('333.3');
        phases.push({ reopened: await localDocument(reopened, user, project, false) });
        expect(puts).toHaveLength(1);
        await reopened.screenshot({ path: info.outputPath('wheel-reopened-' + width + '.png') });
        reopenFailures.assertEmpty();
        failures.assertEmpty();
        journal['checkpoint'] = 'complete';
      } catch (error) {
        primary = error;
        journal['primaryError'] =
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error);
      }
      // Original completed checkpoints survive a failed/hung browser. Failure
      // finalization never asks the browser for a new optional snapshot.
      Object.assign(journal, { project, user, consoleMessages, pageErrors, network, puts });
      let captureError: unknown;
      try {
        await writeFile(
          info.outputPath('native-wheel-' + width + '-raw.json'),
          JSON.stringify(journal, null, 2),
          'utf8',
        );
      } catch (error) {
        captureError = error;
      }
      if (primary) throw primary;
      if (captureError) throw captureError;
      if (fresh) await fresh.close();
    },
  );
}
