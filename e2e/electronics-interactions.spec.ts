import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import type { SchematicDocument } from '../apps/web/src/api';
import {
  configureProductionLibrary,
  productionBreadboard,
} from '../apps/web/src/electronics/production-manifest-adapter';
import {
  catalogEntry,
  componentPointPosition,
  renderedSize,
  terminalPosition,
} from '../apps/web/src/electronics/component-catalog';
import {
  addComponentToDocument,
  moveComponentInDocument,
  snapComponentToBreadboard,
  terminalPositionInDocument,
} from '../apps/web/src/electronics/workbench-document';

configureProductionLibrary(
  JSON.parse(
    readFileSync(
      resolve(process.cwd(), 'apps/web/public/assets/electronics/component-database/catalog.json'),
      'utf8',
    ),
  ),
);
const ID = '10000000-0000-4000-8000-000000000001';
const touchVideoTest = test.extend({
  hasTouch: true,
  viewport: { width: 390, height: 844 },
  video: 'on',
});
const wireVideoTest = test.extend({ video: 'on' });
test.beforeEach(async ({ page }, info) => {
  if (!/R3 native matrix|R3 cancellation/.test(info.title)) return;
  await page.addInitScript(() => {
    const events: unknown[] = [];
    (window as unknown as { inputProbe: unknown[] }).inputProbe = events;
    for (const type of [
      'pointerdown',
      'pointerup',
      'pointercancel',
      'gotpointercapture',
      'lostpointercapture',
      'touchstart',
      'touchend',
      'touchcancel',
      'click',
      'blur',
    ]) {
      window.addEventListener(
        type,
        (event) => {
          const pointer = event as PointerEvent;
          const target = event.target instanceof Element ? event.target : null;
          if (events.length === 256) events.shift();
          events.push({
            type,
            t: Math.round(performance.now()),
            id: pointer.pointerId,
            x: pointer.clientX,
            y: pointer.clientY,
            defaultPrevented: event.defaultPrevented,
            target: target?.getAttribute('class'),
            terminal: target?.getAttribute('data-terminal-id'),
            label: target?.closest('[aria-label]')?.getAttribute('aria-label'),
            touches: (event as TouchEvent).touches?.length,
          });
        },
        true,
      );
    }
  });
});
test.afterEach(async ({ page }, info) => {
  if (!/R3 native matrix|R3 cancellation/.test(info.title) || info.status === 'passed') return;
  if (page.isClosed()) return;
  await info.attach('native-input-failure', {
    body: JSON.stringify(
      await page.evaluate(() => (window as unknown as { inputProbe: unknown[] }).inputProbe),
    ),
    contentType: 'application/json',
  });
});

test.describe('interaction: document integrity', () => {
  test('board carries mounted parts in one undoable move', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    let doc = addComponentToDocument(
      documentFixture(),
      'potentiometer',
      { x: 500, y: 500 },
      'pot',
    ).document;
    const board = doc.components.find((p) => p.id === 'board')!;
    const pot = doc.components.find((p) => p.id === 'pot')!;
    const hole = productionBreadboard('breadboard-medium')!.holes.find((h) => h.id === 'J8')!;
    const target = componentPointPosition(board, board.position, hole)!;
    const pin = terminalPosition(pot, pot.position, 'terminal-1')!;
    doc = snapComponentToBreadboard(
      moveComponentInDocument(doc, 'pot', {
        x: pot.position.x + target.x - pin.x,
        y: pot.position.y + target.y - pin.y,
      }),
      'pot',
    );
    await openEditor(page, doc);
    await expect(part(page, 'pot')).toHaveAttribute('data-hole-bindings', '3');
    const grab = await part(page, 'board')
      .locator('.workbench-part')
      .evaluate((el) => {
        const b = el.getBoundingClientRect();
        return { x: b.x + b.width * 0.7, y: b.y + 2 };
      });
    const original = await part(page, 'board').getAttribute('data-x');
    const mountedBefore = (await part(page, 'pot').boundingBox())!;
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 75, grab.y + 40, { steps: 25 });
    await frames(page);
    const preview = (await part(page, 'pot').boundingBox())!;
    expect(preview.x - mountedBefore.x).toBeCloseTo(75, 0);
    await page.mouse.up();
    await expect(part(page, 'board')).not.toHaveAttribute('data-x', original!);
    await expect(part(page, 'pot')).toHaveAttribute('data-hole-bindings', '3');
    const after = (await part(page, 'pot').boundingBox())!;
    expect(after.x - mountedBefore.x).toBeCloseTo(75, 0);
    expect(after.y - mountedBefore.y).toBeCloseTo(40, 0);
    await page.getByRole('button', { name: /Отменить/ }).click();
    await expect(part(page, 'board')).toHaveAttribute('data-x', original!);
    await expect(part(page, 'pot')).toHaveAttribute('data-hole-bindings', '3');
  });

  test('wire bend previews without writing and commits only once', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const doc = documentFixture();
    doc.connections = [
      {
        id: 'test-wire',
        from: { componentId: 'led', terminal: 'cathode' },
        to: { componentId: 'battery', terminal: 'BAT+' },
        vertices: [{ x: 820, y: 280 }],
      },
    ];
    await openEditor(page, doc);
    const wire = page.getByTestId('schematic-wire');
    const bend = await page.locator('.workbench-canvas').evaluate((el) => {
      const p = new DOMPoint(820, 280).matrixTransform((el as SVGSVGElement).getScreenCTM()!);
      return { x: p.x, y: p.y };
    });
    // Select the wire away from its bend, so this isn't a double click on a vertex.
    const pathPoint = await page.getByTestId('wire-hit').evaluate((el) => {
      const path = el as SVGPathElement;
      const p = path
        .getPointAtLength(path.getTotalLength() * 0.25)
        .matrixTransform(path.getScreenCTM()!);
      return { x: p.x, y: p.y };
    });
    await page.mouse.click(pathPoint.x, pathPoint.y);
    const vertex = page.getByTestId('wire-vertex');
    await expect(vertex).toHaveCount(1);
    const original = await wire.getAttribute('d');
    const writes = await page.evaluate(
      () => (window as unknown as { draftWrites: number }).draftWrites,
    );
    await page.mouse.move(bend.x, bend.y);
    await page.mouse.down();
    await page.mouse.move(bend.x + 40, bend.y - 35, { steps: 20 });
    await frames(page);
    await expect(wire).not.toHaveAttribute('d', original!);
    expect(
      await page.evaluate(() => (window as unknown as { draftWrites: number }).draftWrites),
    ).toBe(writes);
    await page.mouse.up();
    expect(
      await page.evaluate(() => (window as unknown as { draftWrites: number }).draftWrites),
    ).toBe(writes + 1);
    await page.getByRole('button', { name: /Отменить/ }).click();
    await expect(wire).toHaveAttribute('d', original!);
  });

  test('wire double-click is consecutive: intervening straighten and Undo break the click pair', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const doc = documentFixture();
    doc.connections = [
      {
        id: 'double-click-wire',
        from: { componentId: 'led', terminal: 'cathode' },
        to: { componentId: 'battery', terminal: 'BAT+' },
        vertices: [{ x: 820, y: 280 }],
      },
    ];
    const { readDocument } = await openEditor(page, doc);
    const wireHit = page.getByTestId('wire-hit');
    const wire = page.getByTestId('schematic-wire');
    const pointAtQuarter = () =>
      wireHit.evaluate((element) => {
        const path = element as SVGPathElement;
        const point = path
          .getPointAtLength(path.getTotalLength() * 0.25)
          .matrixTransform(path.getScreenCTM()!);
        return { x: point.x, y: point.y };
      });

    const trueDoublePoint = await pointAtQuarter();
    await page.mouse.dblclick(trueDoublePoint.x, trueDoublePoint.y);
    await expect(page.getByTestId('wire-vertex')).toHaveCount(2);
    await expect.poll(() => readDocument().connections[0]?.vertices?.length).toBe(2);

    await page.getByRole('button', { name: /Отменить/ }).click();
    await expect(page.getByTestId('wire-vertex')).toHaveCount(1);
    await expect.poll(() => readDocument().connections[0]?.vertices).toEqual([{ x: 820, y: 280 }]);

    // First click establishes a possible pair, but the command and its Undo
    // replace the document twice. The next select is not a double-click even
    // when it lands at the same screen point well inside the old time window.
    const firstSelect = await pointAtQuarter();
    await page.mouse.click(firstSelect.x, firstSelect.y);
    const panel = page.getByTestId('wire-inspector-compact');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Выпрямить провод', exact: true }).click();
    await expect(page.getByTestId('wire-vertex')).toHaveCount(0);
    await page.getByRole('button', { name: /Отменить/ }).click();
    await expect(page.getByTestId('wire-vertex')).toHaveCount(1);

    const beforeReselect = structuredClone(readDocument().connections[0]?.vertices ?? []);
    const writesBeforeReselect = await page.evaluate(
      () => (window as unknown as { draftWrites: number }).draftWrites,
    );
    const secondSelect = await pointAtQuarter();
    await page.mouse.click(secondSelect.x, secondSelect.y);
    await expect(page.getByTestId('wire-vertex')).toHaveCount(1);
    await expect.poll(() => readDocument().connections[0]?.vertices).toEqual(beforeReselect);
    expect(
      await page.evaluate(() => (window as unknown as { draftWrites: number }).draftWrites),
    ).toBe(writesBeforeReselect);
    await expect(wire).toHaveAttribute('data-wire-id', 'double-click-wire');

    // A non-mutating pointer press between two wire presses must break the
    // double-click pair. Dispatch all three pointerdowns in one browser task so
    // the test stays inside the 420 ms product window even under parallel load.
    const pairPoint = await pointAtQuarter();
    const writesBeforeFocusPair = await page.evaluate(
      () => (window as unknown as { draftWrites: number }).draftWrites,
    );
    const interruptedPairDurationMs = await page.evaluate(({ x, y }) => {
      const wireHit = document.querySelector<SVGPathElement>(
        '[data-testid="wire-hit"][data-wire-id="double-click-wire"]',
      );
      const title = document.querySelector<HTMLInputElement>('.workbench-title-input');
      if (!wireHit || !title) throw new Error('Wire hit or project title input is missing');

      const press = (target: Element, pointerId: number): void => {
        target.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            pointerId,
            pointerType: 'mouse',
            button: 0,
            buttons: 1,
          }),
        );
      };

      // Break any sequence left by the preceding acceptance steps first.
      press(title, 71);
      const startedAt = performance.now();
      press(wireHit, 72);
      press(title, 73);
      press(wireHit, 74);
      return performance.now() - startedAt;
    }, pairPoint);
    expect(interruptedPairDurationMs).toBeLessThan(420);
    await expect(page.getByTestId('wire-vertex')).toHaveCount(1);
    expect(readDocument().connections[0]?.vertices).toEqual(beforeReselect);
    expect(
      await page.evaluate(() => (window as unknown as { draftWrites: number }).draftWrites),
    ).toBe(writesBeforeFocusPair);
  });
});

function documentFixture(): SchematicDocument {
  let doc: SchematicDocument = {
    schemaVersion: 4,
    components: [],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
  for (const [type, id, x, y] of [
    ['breadboard-medium', 'board', 490, 410],
    ['led-5mm', 'led', 680, 300],
    ['battery-holder-aa-2', 'battery', 910, 520],
    ['arduino-uno', 'uno', 310, 650],
  ] as const)
    doc = addComponentToDocument(doc, type, { x, y }, id).document;
  return {
    ...doc,
    components: doc.components.map((part) =>
      part.id === 'uno'
        ? {
            ...part,
            stateProperties: {
              ...part.stateProperties,
              arduinoCodeMode: 'text',
              arduinoSource: 'void setup() {}\nvoid loop() {}',
              arduinoSerialOpen: false,
              arduinoBaudRate: 9600,
            },
          }
        : part,
    ),
  };
}

/** UI-only fixture: all API traffic intercepted. The real-API simulation suite is separate. */
async function openEditor(page: Page, initial = documentFixture()) {
  let doc = initial;
  let revision = 1;
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const draft = () => ({
    projectId: ID,
    document: doc,
    revision,
    updatedAt: '2026-09-09T00:00:00Z',
  });
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    (window as unknown as { draftWrites: number }).draftWrites = 0;
    Storage.prototype.setItem = function (key, value) {
      if (key.includes('draft')) {
        (window as unknown as { draftWrites: number }).draftWrites++;
      }
      return original.call(this, key, value);
    };
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const user = { id: ID, displayName: 'Проверка интерфейса', email: 'interaction@example.test' };
    let body: unknown;
    if (path === '/api/auth/me')
      body = {
        authenticated: true,
        user,
        account: user,
        capabilities: [],
        workspaces: [{ workspaceId: ID, kind: 'personal', title: 'Мои проекты', role: 'owner' }],
        activeWorkspace: { workspaceId: ID, kind: 'personal' },
        navigation: { classes: false, classroomManagement: false },
        timeZone: 'Europe/Moscow',
      };
    else if (path === '/api/projects/' + ID)
      body = {
        project: {
          id: ID,
          scope: 'personal',
          classroomId: null,
          moduleKey: 'electronics',
          title: 'Проверка перемещения',
          status: 'active',
          createdAt: '2026-09-09T00:00:00Z',
          updatedAt: '2026-09-09T00:00:00Z',
          preview: null,
          snapshotRevision: null,
          copiedFrom: null,
        },
        draft: draft(),
        versions: [],
        result: null,
      };
    else if (path === '/api/projects/' + ID + '/draft') {
      doc = route.request().postDataJSON().document;
      revision++;
      requests.push(path);
      body = { draft: draft(), result: null };
    } else if (path === '/api/account/avatar') body = { avatarDataUrl: null };
    else if (path.endsWith('/status')) body = { available: false };
    else if (path.endsWith('/me')) body = { authenticated: false, administrator: false };
    else body = { items: [], total: 0 };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.goto('/projects/' + ID + '/electronics/edit');
  await expect(page.getByTestId('schematic-component')).toHaveCount(initial.components.length);
  return { requests, errors, readDocument: () => doc };
}

const part = (page: Page, id: string) =>
  page.locator('[data-testid="schematic-component"][data-component-id="' + id + '"]');
const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
async function pointOnBody(page: Page, id: string) {
  return part(page, id)
    .locator('.workbench-part')
    .evaluate((element) => {
      const box = element.getBoundingClientRect();
      const component = element.closest<SVGElement>('[data-testid="schematic-component"]');
      const componentId = component?.dataset['componentId'];
      const terminalOverlay = componentId
        ? document.querySelector<SVGGElement>(
            '[data-testid="component-terminal-overlay"][data-component-id="' + componentId + '"]',
          )
        : null;
      const terminalRects = terminalOverlay
        ? [
            ...terminalOverlay.querySelectorAll<SVGGraphicsElement>('[data-terminal-component-id]'),
          ].map((terminal) => terminal.getBoundingClientRect())
        : [];

      // Pick a point the browser can actually deliver to the component body.
      // Geometry alone is insufficient on compact landscape layouts: an inspector
      // can cover the body, and enlarged R2 terminal targets can cover a lead.
      const fractions = [0.5, 0.35, 0.65, 0.2, 0.8] as const;
      for (const ry of fractions) {
        for (const rx of fractions) {
          const point = { x: box.x + box.width * rx, y: box.y + box.height * ry };
          const overlapsTerminal = terminalRects.some(
            (terminal) =>
              point.x >= terminal.left - 1 &&
              point.x <= terminal.right + 1 &&
              point.y >= terminal.top - 1 &&
              point.y <= terminal.bottom + 1,
          );
          if (overlapsTerminal) continue;
          const topmost = document.elementFromPoint(point.x, point.y);
          if (!topmost) continue;
          if (topmost.closest('.workbench-inspector')) continue;
          if (topmost.closest('[data-terminal-component-id][data-terminal-id]')) continue;
          const topComponent = topmost.closest<SVGElement>('[data-testid="schematic-component"]');
          if (
            topComponent?.dataset['componentId'] === component?.dataset['componentId'] ||
            topmost.classList.contains('workbench-grid-hit')
          ) {
            return point;
          }
        }
      }
      throw new Error('No exposed component-body point is reachable without crossing a terminal');
    });
}

test.describe('interaction: electronics input and responsive layout', () => {
  test('drag follows the pointer, writes only on release, and Escape restores without saving', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const { errors } = await openEditor(page);
    const component = part(page, 'battery');
    const start = await pointOnBody(page, 'battery');
    const originalX = await component.getAttribute('data-x');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const writes = await page.evaluate(
      () => (window as unknown as { draftWrites: number }).draftWrites,
    );
    const before = await component.boundingBox();
    await page.mouse.move(start.x + 95, start.y + 55, { steps: 30 });
    await frames(page);
    const moving = await component.boundingBox();
    expect(moving!.x - before!.x).toBeCloseTo(95, 0);
    expect(moving!.y - before!.y).toBeCloseTo(55, 0);
    expect(await component.getAttribute('data-x')).toBe(originalX);
    expect(
      await page.evaluate(() => (window as unknown as { draftWrites: number }).draftWrites),
    ).toBe(writes);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await component.getAttribute('data-x')).toBe(originalX);
    expect(
      await page.evaluate(() => (window as unknown as { draftWrites: number }).draftWrites),
    ).toBe(writes);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 25, start.y + 20);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.up();
    await expect(component).toHaveAttribute('data-x', originalX!);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 95, start.y + 55, { steps: 30 });
    await page.mouse.up();
    await expect(component).not.toHaveAttribute('data-x', originalX!);
    const end = await component.boundingBox();
    expect(end!.x - before!.x).toBeCloseTo(95, 0);
    expect(
      await page.evaluate(() => (window as unknown as { draftWrites: number }).draftWrites),
    ).toBe(writes + 1);
    await page.getByRole('button', { name: /Отменить/ }).click();
    await expect(component).toHaveAttribute('data-x', originalX!);
    expect(errors).toEqual([]);
  });

  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [768, 1024],
    [2560, 1440],
    [3840, 2160],
  ]) {
    test('layout ' + width + 'x' + height, async ({ page }) => {
      await page.setViewportSize({ width: width!, height: height! });
      const { errors } = await openEditor(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width!,
      );
      const shell = page.locator('.workbench-shell');
      const box = await shell.boundingBox();
      expect(box!.height).toBeLessThanOrEqual(height! + 1);
      await page.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();
      const code = page.getByRole('region', { name: 'Редактор кода Arduino' });
      await expect(code).toBeVisible();
      const cb = await code.boundingBox();
      expect(cb!.y + cb!.height).toBeLessThanOrEqual(height! + 1);
      await page.screenshot({ path: 'reports/interactions/code-' + width + 'x' + height + '.png' });
      if (width! <= 980) {
        const stage = await page.locator('.workbench-stage').boundingBox();
        expect(stage!.height).toBeGreaterThan(100);
        await page.getByRole('button', { name: 'Развернуть код', exact: true }).click();
        await expect(shell).toHaveClass(/code-expanded/);
        await page.getByRole('button', { name: 'Закрыть панель кода', exact: true }).click();
        await expect(shell).not.toHaveClass(/code-expanded/);
        await expect(page.locator('.workbench-stage')).toBeVisible();
        await page.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();
        await page.getByRole('button', { name: 'Код на половину экрана', exact: true }).click();
        await page.getByRole('button', { name: 'Закрыть панель кода', exact: true }).click();
        await page.getByRole('button', { name: 'Каталог деталей', exact: true }).click();
        const grid = page.locator('.workbench-catalog-grid');
        expect(await grid.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
        expect(await grid.evaluate((el) => getComputedStyle(el).touchAction)).toBe(
          'pan-x pinch-zoom',
        );
        const overflowingArt = await grid.locator('.workbench-catalog-art').evaluateAll(
          (items) =>
            items.filter((item) => {
              const visual = item.querySelector('.workbench-production-visual');
              if (!visual) return false;
              return (
                visual.getBoundingClientRect().bottom > item.getBoundingClientRect().bottom + 1
              );
            }).length,
        );
        expect(overflowingArt).toBe(0);
      }
      await page.screenshot({
        path: 'reports/interactions/layout-' + width + 'x' + height + '.png',
      });
      expect(errors).toEqual([]);
    });
  }
});

touchVideoTest.describe('interaction: native touch', () => {
  touchVideoTest(
    'one-finger pan and two-finger pinch use the same screen coordinates',
    async ({ page, context }) => {
      const { errors } = await openEditor(page);
      const session = await context.newCDPSession(page);
      const send = (
        type: 'touchStart' | 'touchMove' | 'touchEnd',
        points: { id: number; x: number; y: number }[],
      ) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points });
      const stage = page.locator('.workbench-canvas');
      const project = async (x: number, y: number) =>
        stage.evaluate(
          (el, p) => {
            const point = new DOMPoint(p.x, p.y).matrixTransform(
              (el as SVGSVGElement).getScreenCTM()!,
            );
            return { x: point.x, y: point.y };
          },
          { x, y },
        );
      const origin = await project(800, 750);
      await send('touchStart', [{ id: 1, x: 120, y: 650 }]);
      await send('touchMove', [{ id: 1, x: 165, y: 675 }]);
      await send('touchEnd', []);
      const panned = await project(800, 750);
      expect(panned.x - origin.x).toBeCloseTo(45, 0);
      expect(panned.y - origin.y).toBeCloseTo(25, 0);
      const before = await stage.evaluate((el) => {
        const matrix = (el as SVGSVGElement).getScreenCTM()!;
        const anchor = new DOMPoint(170, 600).matrixTransform(matrix.inverse());
        return { a: matrix.a, x: anchor.x, y: anchor.y };
      });
      await send('touchStart', [
        { id: 1, x: 120, y: 600 },
        { id: 2, x: 220, y: 600 },
      ]);
      await send('touchMove', [
        { id: 1, x: 100, y: 615 },
        { id: 2, x: 250, y: 615 },
      ]);
      await send('touchEnd', []);
      const after = await project(before.x, before.y);
      expect(after.x).toBeCloseTo(175, 0);
      expect(after.y).toBeCloseTo(615, 0);
      const scale = await stage.evaluate((el) => (el as SVGSVGElement).getScreenCTM()!.a);
      expect(scale / before.a).toBeCloseTo(1.5, 2);
      expect(errors).toEqual([]);
    },
  );

  touchVideoTest(
    'R3 shelf scroll stays native and one upward finger drag places exactly one part',
    async ({ page, context }) => {
      await openEditor(page);
      await page.getByRole('button', { name: 'Каталог деталей', exact: true }).click();
      const shelf = page.locator('.workbench-catalog-grid');
      const session = await context.newCDPSession(page);
      const send = (
        type: 'touchStart' | 'touchMove' | 'touchEnd',
        points: { id: number; x: number; y: number }[],
      ) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points });

      await send('touchStart', [{ id: 1, x: 340, y: 775 }]);
      for (let x = 310; x >= 70; x -= 30) await send('touchMove', [{ id: 1, x, y: 775 }]);
      await send('touchEnd', []);
      await expect.poll(() => shelf.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
      await expect(page.getByTestId('catalog-placement-preview')).toHaveCount(0);
      await expect(page.getByTestId('schematic-component')).toHaveCount(4);

      await shelf.evaluate((el) => {
        el.scrollLeft = 0;
      });
      const card = page.getByRole('button', { name: 'Резистор', exact: true });
      await card.scrollIntoViewIfNeeded();
      const cardBox = await card.boundingBox();
      const stageBox = await page.locator('.workbench-stage').boundingBox();
      if (!cardBox || !stageBox) throw new Error('Expected visible mobile shelf and stage');
      const start = {
        x: cardBox.x + cardBox.width / 2,
        y: cardBox.y + cardBox.height / 2,
      };
      const drop = {
        x: stageBox.x + stageBox.width * 0.55,
        y: stageBox.y + stageBox.height * 0.55,
      };

      await send('touchStart', [{ id: 2, ...start }]);
      await send('touchMove', [{ id: 2, x: start.x, y: start.y - 12 }]);
      await expect(page.getByTestId('catalog-placement-preview')).toBeVisible();
      for (let step = 1; step <= 6; step += 1) {
        const ratio = step / 6;
        await send('touchMove', [
          {
            id: 2,
            x: start.x + (drop.x - start.x) * ratio,
            y: start.y - 12 + (drop.y - (start.y - 12)) * ratio,
          },
        ]);
      }
      const preview = page.getByTestId('catalog-placement-preview');
      const previewBox = await preview.boundingBox();
      if (!previewBox) throw new Error('Expected component preview during direct touch drag');
      expect(previewBox.x + previewBox.width / 2).toBeCloseTo(drop.x, 0);
      expect(previewBox.y + previewBox.height / 2).toBeCloseTo(drop.y, 0);
      await page.screenshot({ path: 'reports/interactions/r3-touch-drag-preview.png' });
      await send('touchEnd', []);

      await expect(page.getByTestId('schematic-component')).toHaveCount(5);
      await expect(page.getByTestId('catalog-placement-preview')).toHaveCount(0);
      await expect(page.locator('.workbench-library')).toHaveClass(/collapsed/);
      const resistor = page.locator(
        '[data-testid="schematic-component"][data-component-type="resistor-axial"]',
      );
      await expect(resistor).toHaveCount(1);
      await expect(resistor).toBeVisible();
      await page.screenshot({ path: 'reports/interactions/r3-touch-direct-placement.png' });
    },
  );
});

test.describe('interaction: catalog and carrier', () => {
  test('large catalog preview stays opaque and anchored across the canvas edge', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openEditor(page);
    const card = page.getByRole('button', { name: 'Батарейный отсек AA', exact: true });
    await card.scrollIntoViewIfNeeded();
    const box = (await card.boundingBox())!;
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 5, start.y);
    const preview = page.getByTestId('catalog-placement-preview');
    await expect(preview).toBeVisible();
    const initial = (await preview.boundingBox())!;
    expect(await preview.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.mouse.move(80, 200, { steps: 25 });
    await frames(page);
    const edge = (await preview.boundingBox())!;
    expect(edge.width).toBeCloseTo(initial.width, 1);
    expect(edge.x + edge.width / 2).toBeCloseTo(80, 0);
    expect(edge.y + edge.height / 2).toBeCloseTo(200, 0);
    await page.screenshot({ path: 'reports/interactions/catalog-edge.png' });
    await page.mouse.up();
    await expect(page.getByTestId('schematic-component')).toHaveCount(5);
    await expect(preview).toHaveCount(0);
    const placed = page
      .locator('[data-component-type="battery-holder-aa-2"][data-testid="schematic-component"]')
      .last();
    const placedBox = (await placed.boundingBox())!;
    // Stored placements round world units and selection strokes extend the visible bounds.
    expect(Math.abs(placedBox.x - edge.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(placedBox.y - edge.y)).toBeLessThanOrEqual(2);
  });

  test('fit includes the large board and panning does not change project positions', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openEditor(page);
    await page.getByRole('button', { name: 'Подогнать проект', exact: true }).click();
    const stage = (await page.locator('.workbench-canvas').boundingBox())!;
    for (const id of ['board', 'led', 'battery', 'uno']) {
      const bounds = (await part(page, id).boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(stage.x - 1);
      expect(bounds.y).toBeGreaterThanOrEqual(stage.y - 1);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
    }
  });
});

const wireTerminal = (page: Page, componentId: string, terminalId: string) =>
  page
    .locator(`[data-terminal-component-id="${componentId}"][data-terminal-id="${terminalId}"]`)
    .first();

async function locatorCenter(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Expected visible wire interaction target');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function pathScreenPoint(locator: Locator, ratio = 1) {
  return locator.evaluate((element, positionRatio) => {
    const path = element as SVGPathElement;
    const point = path
      .getPointAtLength(path.getTotalLength() * positionRatio)
      .matrixTransform(path.getScreenCTM()!);
    return { x: point.x, y: point.y };
  }, ratio);
}

function wiredDocument(): SchematicDocument {
  const doc = documentFixture();
  doc.connections = [
    {
      id: 'acceptance-wire',
      from: { componentId: 'led', terminal: 'cathode' },
      to: { componentId: 'battery', terminal: 'BAT+' },
      vertices: [],
    },
  ];
  return doc;
}

function componentCenterInDocument(document: SchematicDocument, componentId: string) {
  const component = document.components.find((item) => item.id === componentId);
  if (!component) throw new Error('Missing crossing component ' + componentId);
  const entry = catalogEntry(component);
  if (!entry) throw new Error('Missing catalog entry for ' + componentId);
  const size = renderedSize(entry, component.rotation ?? 0);
  return {
    x: component.position.x + size.width / 2,
    y: component.position.y + size.height / 2,
  };
}

function layeredCrossingDocument(): SchematicDocument {
  let document = documentFixture();
  document = addComponentToDocument(
    document,
    'resistor-axial',
    { x: 720, y: 650 },
    'cross-resistor',
  ).document;
  const crossingVertices = (componentId: string) => {
    const center = componentCenterInDocument(document, componentId);
    return [
      { x: center.x - 80, y: center.y },
      { x: center.x + 80, y: center.y },
    ];
  };
  return {
    ...document,
    connections: [
      {
        id: 'uno-cross',
        from: { componentId: 'led', terminal: 'cathode' },
        to: { componentId: 'battery', terminal: 'BAT+' },
        vertices: crossingVertices('uno'),
        color: '#e3212b',
      },
      {
        id: 'led-cross',
        from: { componentId: 'battery', terminal: 'BAT-' },
        to: { componentId: 'led', terminal: 'anode' },
        vertices: crossingVertices('led'),
        color: '#149447',
      },
      {
        id: 'resistor-cross',
        from: { componentId: 'led', terminal: 'cathode' },
        to: { componentId: 'battery', terminal: 'BAT-' },
        vertices: crossingVertices('cross-resistor'),
        color: '#2457d6',
      },
      {
        id: 'board-cross',
        from: { componentId: 'battery', terminal: 'BAT+' },
        to: { componentId: 'led', terminal: 'anode' },
        vertices: crossingVertices('board'),
        color: '#e38b21',
      },
    ],
  };
}

wireVideoTest.describe('interaction: natural precise wire routing', () => {
  wireVideoTest(
    'R2 TERMINAL/HIT/ENDPOINT geometry scales at 0.5/1/2/4 and keeps one centre',
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      const doc = wiredDocument();
      doc.components = doc.components.map((item) =>
        item.id === 'led' ? { ...item, rotation: 45 } : item,
      );
      await openEditor(page, doc);

      type Sample = {
        hit: number;
        dot: number;
        breadboardHit: number;
        breadboardDot: number;
        endpointHit: number;
        endpointVisible: number;
      };
      const samples = new Map<number, Sample>();
      const centerOf = (box: { x: number; y: number; width: number; height: number }) => ({
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      });

      for (const zoom of [0.5, 1, 2, 4]) {
        await page.evaluate(
          ({ id, zoomLevel }) => {
            const center = { x: 800, y: 420 };
            localStorage.setItem(
              `asa-electronics-viewport:${id}`,
              JSON.stringify({
                x: center.x - 1600 / (2 * zoomLevel),
                y: center.y - 980 / (2 * zoomLevel),
                zoom: zoomLevel,
              }),
            );
          },
          { id: ID, zoomLevel: zoom },
        );
        await page.reload();
        await expect(page.getByTestId('schematic-component')).toHaveCount(doc.components.length);

        const wirePath = page.getByTestId('wire-hit').first();
        const wirePoint = await pathScreenPoint(wirePath, 0.5);
        await page.mouse.click(wirePoint.x, wirePoint.y);
        await expect(page.getByTestId('wire-endpoint')).toHaveCount(2);

        const componentHit = wireTerminal(page, 'led', 'cathode');
        const componentDot = componentHit.locator('..').locator('.workbench-terminal-dot');
        const breadboardHit = wireTerminal(page, 'board', 'J20');
        const breadboardDot = breadboardHit.locator('..').locator('.workbench-contact-square');
        const endpoint = page.getByTestId('wire-endpoint').first();
        const endpointVisible = page.getByTestId('wire-endpoint-visible').first();
        const [hitBox, dotBox, boardHitBox, boardDotBox, endpointBox, endpointVisibleBox] =
          await Promise.all([
            componentHit.boundingBox(),
            componentDot.boundingBox(),
            breadboardHit.boundingBox(),
            breadboardDot.boundingBox(),
            endpoint.boundingBox(),
            endpointVisible.boundingBox(),
          ]);
        if (
          !hitBox ||
          !dotBox ||
          !boardHitBox ||
          !boardDotBox ||
          !endpointBox ||
          !endpointVisibleBox
        ) {
          throw new Error(`Expected visible R2 geometry at zoom ${zoom}`);
        }
        const hitCenter = centerOf(hitBox);
        const dotCenter = centerOf(dotBox);
        const boardHitCenter = centerOf(boardHitBox);
        const boardDotCenter = centerOf(boardDotBox);
        const endpointCenter = centerOf(endpointBox);
        const endpointVisibleCenter = centerOf(endpointVisibleBox);
        expect(
          Math.hypot(hitCenter.x - dotCenter.x, hitCenter.y - dotCenter.y),
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.hypot(boardHitCenter.x - boardDotCenter.x, boardHitCenter.y - boardDotCenter.y),
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.hypot(hitCenter.x - endpointCenter.x, hitCenter.y - endpointCenter.y),
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.hypot(
            endpointCenter.x - endpointVisibleCenter.x,
            endpointCenter.y - endpointVisibleCenter.y,
          ),
        ).toBeLessThanOrEqual(0.5);
        expect(Number(await componentHit.getAttribute('r'))).toBe(9);
        expect(Number(await componentDot.getAttribute('width'))).toBe(8);
        expect(Number(await endpoint.getAttribute('r'))).toBe(9);
        expect(Number(await endpointVisible.getAttribute('r'))).toBe(4);
        expect(dotBox.width).toBeLessThan(hitBox.width);
        expect(endpointVisibleBox.width).toBeLessThan(endpointBox.width);

        samples.set(zoom, {
          hit: hitBox.width,
          dot: dotBox.width,
          breadboardHit: boardHitBox.width,
          breadboardDot: boardDotBox.width,
          endpointHit: endpointBox.width,
          endpointVisible: endpointVisibleBox.width,
        });
        if (zoom === 1 || zoom === 2 || zoom === 4) {
          await page.screenshot({
            path: 'reports/interactions/f1-marker-zoom-' + zoom + 'x.png',
          });
        }
      }

      const base = samples.get(1)!;
      for (const zoom of [0.5, 1, 2, 4]) {
        const sample = samples.get(zoom)!;
        for (const key of [
          'hit',
          'dot',
          'breadboardHit',
          'breadboardDot',
          'endpointHit',
          'endpointVisible',
        ] as const) {
          expect(sample[key] / base[key]).toBeCloseTo(zoom, 1);
        }
      }

      // Prove that the retained collision geometry, not the smaller visible
      // marker, owns pointer input near its outer edge.
      await page.keyboard.press('Escape');
      const edgeTerminal = wireTerminal(page, 'led', 'cathode');
      const edgeTerminalBox = await edgeTerminal.boundingBox();
      if (!edgeTerminalBox) throw new Error('Missing terminal hit geometry for edge acceptance');
      const terminalEdgePoint = {
        x: edgeTerminalBox.x + edgeTerminalBox.width - 1,
        y: edgeTerminalBox.y + edgeTerminalBox.height / 2,
      };
      await page.mouse.move(terminalEdgePoint.x, terminalEdgePoint.y);
      await page.mouse.down();
      await expect(page.locator('.workbench-wire-preview')).toHaveCount(1);
      await page.mouse.up();
      await page.keyboard.press('Escape');

      const edgeWirePoint = await pathScreenPoint(page.getByTestId('wire-hit').first(), 0.5);
      await page.mouse.click(edgeWirePoint.x, edgeWirePoint.y);
      const endpointHit = page.getByTestId('wire-endpoint').first();
      const endpointVisible = page.getByTestId('wire-endpoint-visible').first();
      const edgeEndpointBox = await endpointHit.boundingBox();
      if (!edgeEndpointBox) throw new Error('Missing endpoint hit geometry for edge acceptance');
      const endpointEdgePoint = {
        x: edgeEndpointBox.x + edgeEndpointBox.width - 1,
        y: edgeEndpointBox.y + edgeEndpointBox.height / 2,
      };
      await page.mouse.move(endpointEdgePoint.x, endpointEdgePoint.y);
      await page.mouse.down();
      await frames(page);
      const movedVisible = await locatorCenter(endpointVisible);
      expect(
        Math.hypot(movedVisible.x - endpointEdgePoint.x, movedVisible.y - endpointEdgePoint.y),
      ).toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    },
  );

  wireVideoTest(
    'F2 SVG layering keeps wires above breadboard and below Arduino/LED/resistor with matching pointer ownership',
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      const fixture = layeredCrossingDocument();
      await openEditor(page, fixture);
      await page
        .getByRole('button', {
          name: '\u041f\u043e\u0434\u043e\u0433\u043d\u0430\u0442\u044c \u043f\u0440\u043e\u0435\u043a\u0442',
          exact: true,
        })
        .click();

      for (const [componentId, wireId] of [
        ['uno', 'uno-cross'],
        ['led', 'led-cross'],
        ['cross-resistor', 'resistor-cross'],
      ] as const) {
        const body = part(page, componentId).locator('.workbench-part');
        const box = await body.boundingBox();
        if (!box) throw new Error('Missing foreground body ' + componentId);
        const crossingWire = page.locator(
          '[data-testid="wire-hit"][data-wire-id="' + wireId + '"]',
        );
        const candidatePoints = await crossingWire.evaluate((element, bounds) => {
          const path = element as SVGPathElement;
          const matrix = path.getScreenCTM();
          if (!matrix) return [];
          const length = path.getTotalLength();
          const points: Array<{ x: number; y: number }> = [];
          for (let index = 1; index < 80; index += 1) {
            const point = path.getPointAtLength((length * index) / 80).matrixTransform(matrix);
            if (
              point.x > bounds.x + 2 &&
              point.x < bounds.x + bounds.width - 2 &&
              point.y > bounds.y + 2 &&
              point.y < bounds.y + bounds.height - 2
            )
              points.push({ x: point.x, y: point.y });
          }
          return points;
        }, box);
        expect(candidatePoints.length).toBeGreaterThan(0);

        let componentOwnedPoint: { x: number; y: number } | null = null;
        for (const point of candidatePoints) {
          await page.mouse.click(point.x, point.y);
          if (
            await part(page, componentId).evaluate((node) =>
              node.classList.contains('workbench-component-selected'),
            )
          ) {
            componentOwnedPoint = point;
            break;
          }
          await page.keyboard.press('Escape');
        }
        expect(
          componentOwnedPoint,
          'wire crossing must resolve pointer ownership to visible ' + componentId + ' artwork',
        ).not.toBeNull();
        await expect(page.getByTestId('wire-inspector-compact')).toHaveCount(0);
        await page.keyboard.press('Escape');
      }

      const board = part(page, 'board').locator('.workbench-part');
      const boardBox = await board.boundingBox();
      if (!boardBox) throw new Error('Missing breadboard body');
      const boardWire = page.locator('[data-testid="wire-hit"][data-wire-id="board-cross"]');
      const selectablePoint = await boardWire.evaluate((element, bounds) => {
        const path = element as SVGPathElement;
        const matrix = path.getScreenCTM();
        if (!matrix) return null;
        const length = path.getTotalLength();
        for (let index = 1; index < 240; index += 1) {
          const point = path.getPointAtLength((length * index) / 240).matrixTransform(matrix);
          if (
            point.x <= bounds.x + 4 ||
            point.x >= bounds.x + bounds.width - 4 ||
            point.y <= bounds.y + 4 ||
            point.y >= bounds.y + bounds.height - 4
          )
            continue;
          const top = document.elementFromPoint(point.x, point.y);
          const wireTarget = top?.closest<SVGElement>(
            '[data-testid="wire-hit"], [data-testid="wire-segment"]',
          );
          if (wireTarget?.dataset['wireId'] === 'board-cross') return { x: point.x, y: point.y };
        }
        return null;
      }, boardBox);
      expect(selectablePoint).not.toBeNull();
      await page.mouse.click(selectablePoint!.x, selectablePoint!.y);
      await expect(page.getByTestId('wire-endpoint')).toHaveCount(2);

      await page.screenshot({ path: 'reports/interactions/f2-scene-layering.png' });
    },
  );

  wireVideoTest(
    'R1_SOFT_WIRE_ASSIST + FREE_EXIT + ALT_DISABLE + CLICK_CLICK_CONNECT',
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openEditor(page);
      const source = wireTerminal(page, 'led', 'cathode');
      const target = wireTerminal(page, 'battery', 'BAT+');
      const sourcePoint = await locatorCenter(source);

      await page.mouse.click(sourcePoint.x, sourcePoint.y);
      const preview = page.locator('.workbench-wire-preview');
      const guide = page.getByTestId('wire-alignment-guide');
      const guideLength = () =>
        guide.evaluate((element) => {
          const line = element as SVGLineElement;
          const style = getComputedStyle(line);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            Number(style.opacity) <= 0 ||
            style.stroke === 'none' ||
            Number.parseFloat(style.strokeWidth) <= 0
          )
            return 0;
          const matrix = line.getScreenCTM();
          if (!matrix) return 0;
          const from = new DOMPoint(line.x1.baseVal.value, line.y1.baseVal.value).matrixTransform(
            matrix,
          );
          const to = new DOMPoint(line.x2.baseVal.value, line.y2.baseVal.value).matrixTransform(
            matrix,
          );
          return Math.hypot(to.x - from.x, to.y - from.y);
        });
      await expect(preview).toHaveCount(1);

      const enter = { x: sourcePoint.x + 120, y: sourcePoint.y + 5 };
      await page.mouse.move(enter.x, enter.y);
      await frames(page);
      await expect(guide).toHaveCount(1);
      expect(await guideLength()).toBeGreaterThan(160);
      let previewEnd = await pathScreenPoint(preview);
      expect(previewEnd.x).toBeCloseTo(enter.x, 0);
      expect(previewEnd.y).toBeCloseTo(sourcePoint.y, 0);
      await page.screenshot({ path: 'reports/interactions/r1-soft-wire-guide.png' });

      const hysteresis = { x: sourcePoint.x + 120, y: sourcePoint.y + 9 };
      await page.mouse.move(hysteresis.x, hysteresis.y);
      await frames(page);
      await expect(guide).toHaveCount(1);
      expect(await guideLength()).toBeGreaterThan(160);
      previewEnd = await pathScreenPoint(preview);
      expect(previewEnd.y).toBeCloseTo(sourcePoint.y, 0);

      const exit = { x: sourcePoint.x + 120, y: sourcePoint.y + 12 };
      await page.mouse.move(exit.x, exit.y);
      await frames(page);
      await expect(guide).toHaveCount(0);
      previewEnd = await pathScreenPoint(preview);
      expect(previewEnd.x).toBeCloseTo(exit.x, 0);
      expect(previewEnd.y).toBeCloseTo(exit.y, 0);

      const verticalEnter = { x: sourcePoint.x + 5, y: sourcePoint.y - 120 };
      await page.mouse.move(verticalEnter.x, verticalEnter.y);
      await frames(page);
      await expect(guide).toHaveCount(1);
      expect(await guideLength()).toBeGreaterThan(160);
      previewEnd = await pathScreenPoint(preview);
      expect(previewEnd.x).toBeCloseTo(sourcePoint.x, 0);
      expect(previewEnd.y).toBeCloseTo(verticalEnter.y, 0);
      await page.screenshot({ path: 'reports/interactions/r1-soft-wire-guide-vertical.png' });

      const verticalExit = { x: sourcePoint.x + 12, y: sourcePoint.y - 120 };
      await page.mouse.move(verticalExit.x, verticalExit.y);
      await frames(page);
      await expect(guide).toHaveCount(0);
      previewEnd = await pathScreenPoint(preview);
      expect(previewEnd.x).toBeCloseTo(verticalExit.x, 0);
      expect(previewEnd.y).toBeCloseTo(verticalExit.y, 0);

      const diagonal = { x: sourcePoint.x + 120, y: sourcePoint.y + 40 };
      await page.mouse.move(diagonal.x, diagonal.y);
      await frames(page);
      previewEnd = await pathScreenPoint(preview);
      expect(previewEnd.x).toBeCloseTo(diagonal.x, 0);
      expect(previewEnd.y).toBeCloseTo(diagonal.y, 0);

      await page.keyboard.down('Alt');
      const disabled = { x: sourcePoint.x + 120, y: sourcePoint.y + 4 };
      await page.mouse.move(disabled.x, disabled.y);
      await frames(page);
      await expect(guide).toHaveCount(0);
      previewEnd = await pathScreenPoint(preview);
      expect(previewEnd.y).toBeCloseTo(disabled.y, 0);
      await page.keyboard.up('Alt');

      const cancelGuide = { x: sourcePoint.x + 120, y: sourcePoint.y + 4 };
      await page.mouse.move(cancelGuide.x, cancelGuide.y);
      await frames(page);
      await expect(guide).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(preview).toHaveCount(0);
      await expect(guide).toHaveCount(0);
      await expect(page.getByTestId('schematic-wire')).toHaveCount(0);

      await page.mouse.click(sourcePoint.x, sourcePoint.y);
      await expect(preview).toHaveCount(1);
      const targetPoint = await locatorCenter(target);
      await page.mouse.click(targetPoint.x, targetPoint.y);
      await expect(page.getByTestId('schematic-wire')).toHaveCount(1);
      await expect(preview).toHaveCount(0);
      await expect(guide).toHaveCount(0);
      await page.screenshot({ path: 'reports/interactions/r1-click-click-connected.png' });
    },
  );

  wireVideoTest('DRAG_CONNECT + NO_DOUBLE_COMMIT', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openEditor(page);
    const sourcePoint = await locatorCenter(wireTerminal(page, 'led', 'cathode'));
    const targetPoint = await locatorCenter(wireTerminal(page, 'battery', 'BAT+'));
    const writes = await page.evaluate(
      () => (window as unknown as { draftWrites: number }).draftWrites,
    );

    await page.mouse.move(sourcePoint.x, sourcePoint.y);
    await page.mouse.down();
    await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 12 });
    await expect(wireTerminal(page, 'battery', 'BAT+').locator('..')).toHaveClass(/drop-target/);
    await page.mouse.up();

    await expect(page.getByTestId('schematic-wire')).toHaveCount(1);
    await expect(page.locator('.workbench-wire-preview')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { draftWrites: number }).draftWrites),
    ).toBe(writes + 1);
    await page.waitForTimeout(20);
    await expect(page.locator('.workbench-wire-preview')).toHaveCount(0);
    await page.screenshot({ path: 'reports/interactions/wire-drag-connect.png' });
  });

  wireVideoTest(
    'R2 dense breadboard resolver highlights and records the nearest eligible terminal',
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openEditor(page);
      const sourcePoint = await locatorCenter(wireTerminal(page, 'battery', 'BAT+'));
      const j20 = wireTerminal(page, 'board', 'J20');
      const j21 = wireTerminal(page, 'board', 'J21');
      const j20Point = await locatorCenter(j20);
      const j21Point = await locatorCenter(j21);
      const targetPoint = {
        x: j20Point.x + (j21Point.x - j20Point.x) * 0.35,
        y: j20Point.y + (j21Point.y - j20Point.y) * 0.35,
      };

      await page.mouse.move(sourcePoint.x, sourcePoint.y);
      await page.mouse.down();
      await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 12 });
      await expect(j20.locator('..')).toHaveClass(/drop-target/);
      await expect(j21.locator('..')).not.toHaveClass(/drop-target/);
      await page.mouse.up();

      await expect(page.getByTestId('schematic-wire')).toHaveCount(1);
      const targetEndpoint = page.locator('[data-testid="wire-endpoint"][data-wire-endpoint="to"]');
      await expect(targetEndpoint).toBeVisible();
      const endpointPoint = await locatorCenter(targetEndpoint);
      expect(
        Math.hypot(endpointPoint.x - j20Point.x, endpointPoint.y - j20Point.y),
      ).toBeLessThanOrEqual(0.5);
      await page.screenshot({ path: 'reports/interactions/r2-dense-terminal-resolver.png' });
    },
  );

  wireVideoTest('DRAG_RELEASE_EMPTY creates no connection or draft residue', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openEditor(page);
    const sourcePoint = await locatorCenter(wireTerminal(page, 'led', 'cathode'));
    const writes = await page.evaluate(
      () => (window as unknown as { draftWrites: number }).draftWrites,
    );

    await page.mouse.move(sourcePoint.x, sourcePoint.y);
    await page.mouse.down();
    await page.mouse.move(sourcePoint.x + 180, sourcePoint.y + 120, { steps: 10 });
    await page.mouse.up();

    await expect(page.getByTestId('schematic-wire')).toHaveCount(0);
    await expect(page.locator('.workbench-wire-preview')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { draftWrites: number }).draftWrites),
    ).toBe(writes);
  });

  wireVideoTest(
    'R1 SHIFT_ORTHOGONAL + EXPLICIT_90_MODE keep every saved segment orthogonal',
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openEditor(page);
      const source = wireTerminal(page, 'led', 'cathode');
      const target = wireTerminal(page, 'battery', 'BAT+');
      const sourcePoint = await locatorCenter(source);
      const targetPoint = await locatorCenter(target);

      const assertSavedRouteOrthogonal = async () => {
        const vertices = await page.getByTestId('wire-vertex').evaluateAll((nodes) =>
          nodes.map((node) => {
            const box = node.getBoundingClientRect();
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          }),
        );
        const route = [await locatorCenter(source), ...vertices, await locatorCenter(target)];
        for (let index = 1; index < route.length; index += 1) {
          const previous = route[index - 1]!;
          const current = route[index]!;
          expect(
            Math.min(Math.abs(current.x - previous.x), Math.abs(current.y - previous.y)),
          ).toBeLessThanOrEqual(1);
        }
        const targetEndpoint = page.locator(
          '[data-testid="wire-endpoint"][data-wire-endpoint="to"]',
        );
        const endpointPoint = await locatorCenter(targetEndpoint);
        const exactTarget = await locatorCenter(target);
        expect(
          Math.hypot(endpointPoint.x - exactTarget.x, endpointPoint.y - exactTarget.y),
        ).toBeLessThanOrEqual(0.5);
      };

      await page.mouse.click(sourcePoint.x, sourcePoint.y);
      await page.keyboard.down('Shift');
      const shiftedPointer = { x: sourcePoint.x + 110, y: sourcePoint.y + 38 };
      await page.mouse.move(shiftedPointer.x, shiftedPointer.y);
      await frames(page);
      const shiftedEnd = await pathScreenPoint(page.locator('.workbench-wire-preview'));
      expect(
        Math.min(Math.abs(shiftedEnd.x - sourcePoint.x), Math.abs(shiftedEnd.y - sourcePoint.y)),
      ).toBeLessThan(2);
      await page.mouse.click(targetPoint.x, targetPoint.y);
      await page.keyboard.up('Shift');
      await expect(page.getByTestId('schematic-wire')).toHaveCount(1);
      await expect(page.getByTestId('wire-vertex')).toHaveCount(1);
      await assertSavedRouteOrthogonal();
      await page.screenshot({ path: 'reports/interactions/r1-shift-orthogonal.png' });

      await page.getByRole('button', { name: /Отменить/ }).click();
      await expect(page.getByTestId('schematic-wire')).toHaveCount(0);
      const mode = page.getByRole('button', {
        name: 'Автоматическая прокладка провода под 90 градусов',
      });
      await mode.click();
      await expect(mode).toHaveAttribute('aria-pressed', 'true');

      await page.mouse.click(sourcePoint.x, sourcePoint.y);
      const freePointer = { x: sourcePoint.x + 105, y: sourcePoint.y + 34 };
      await page.mouse.move(freePointer.x, freePointer.y);
      await frames(page);
      const orthogonalEnd = await pathScreenPoint(page.locator('.workbench-wire-preview'));
      expect(
        Math.min(
          Math.abs(orthogonalEnd.x - sourcePoint.x),
          Math.abs(orthogonalEnd.y - sourcePoint.y),
        ),
      ).toBeLessThan(2);
      await page.mouse.click(targetPoint.x, targetPoint.y);
      await expect(page.getByTestId('schematic-wire')).toHaveCount(1);
      await expect(page.getByTestId('wire-vertex')).toHaveCount(1);
      await assertSavedRouteOrthogonal();
      await page.screenshot({ path: 'reports/interactions/r1-mode90-orthogonal.png' });
    },
  );

  wireVideoTest(
    'F3 bend soft-lock enters, holds, exits; Alt stays free; Shift is strict; Undo/Redo restore the bend',
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      const fixture = wiredDocument();
      fixture.connections[0] = {
        ...fixture.connections[0]!,
        vertices: [{ x: 790, y: 430 }],
      };
      const fromComponent = fixture.components.find((item) => item.id === 'led')!;
      const toComponent = fixture.components.find((item) => item.id === 'battery')!;
      const previous = terminalPositionInDocument(
        fixture,
        fromComponent,
        fixture.connections[0]!.from.terminal,
      )!;
      const next = terminalPositionInDocument(
        fixture,
        toComponent,
        fixture.connections[0]!.to.terminal,
      )!;
      const canonical = { x: previous.x, y: next.y };
      const alternate = { x: next.x, y: previous.y };
      const { readDocument } = await openEditor(page, fixture);
      await page
        .getByRole('button', {
          name: '\u041f\u043e\u0434\u043e\u0433\u043d\u0430\u0442\u044c \u043f\u0440\u043e\u0435\u043a\u0442',
          exact: true,
        })
        .click();

      const wireHit = page.getByTestId('wire-hit').first();
      const selectPoint = await pathScreenPoint(wireHit, 0.5);
      await page.mouse.click(selectPoint.x, selectPoint.y);
      const vertex = page.getByTestId('wire-vertex').first();
      await expect(vertex).toBeVisible();
      // D4 is specifically committed-wire cable management, not new-wire
      // drafting: the route already exists and no creation preview is active.
      expect(readDocument().connections[0]?.vertices).toEqual([{ x: 790, y: 430 }]);
      await expect(page.locator('.workbench-wire-preview')).toHaveCount(0);
      const guide = page.getByTestId('wire-alignment-guide');
      const previousClient = await locatorCenter(wireTerminal(page, 'led', 'cathode'));
      const nextClient = await locatorCenter(wireTerminal(page, 'battery', 'BAT+'));
      const canonicalClient = { x: previousClient.x, y: nextClient.y };

      const resetByUndo = async () => {
        await page
          .getByRole('button', { name: /\u041e\u0442\u043c\u0435\u043d\u0438\u0442\u044c/ })
          .click();
        await expect
          .poll(() => readDocument().connections[0]?.vertices?.[0])
          .toEqual({ x: 790, y: 430 });
      };

      let start = await locatorCenter(vertex);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(canonicalClient.x + 5, canonicalClient.y + 3);
      await frames(page);
      await expect(guide).toHaveCount(2);
      const enteredHandle = await locatorCenter(vertex);
      expect(
        Math.hypot(enteredHandle.x - canonicalClient.x, enteredHandle.y - canonicalClient.y),
      ).toBeLessThanOrEqual(2);
      await page.mouse.move(canonicalClient.x + 10, canonicalClient.y);
      await frames(page);
      await expect(guide).toHaveCount(2);
      const heldHandle = await locatorCenter(vertex);
      expect(
        Math.hypot(heldHandle.x - canonicalClient.x, heldHandle.y - canonicalClient.y),
      ).toBeLessThanOrEqual(2);
      await page.screenshot({ path: 'reports/interactions/d4-committed-bend-soft-lock.png' });
      await page.mouse.up();
      await expect.poll(() => readDocument().connections[0]?.vertices?.[0]).toEqual(canonical);
      await page.screenshot({ path: 'reports/interactions/f3-bend-soft-lock.png' });
      await resetByUndo();
      await page
        .getByRole('button', { name: /\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c/ })
        .click();
      await expect.poll(() => readDocument().connections[0]?.vertices?.[0]).toEqual(canonical);
      await resetByUndo();

      start = await locatorCenter(vertex);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(canonicalClient.x + 5, canonicalClient.y + 3);
      await frames(page);
      await expect(guide).toHaveCount(2);
      const releasedPointer = { x: canonicalClient.x + 14, y: canonicalClient.y };
      await page.mouse.move(releasedPointer.x, releasedPointer.y);
      await frames(page);
      await expect(guide).toHaveCount(0);
      const releasedHandle = await locatorCenter(vertex);
      expect(
        Math.hypot(releasedHandle.x - releasedPointer.x, releasedHandle.y - releasedPointer.y),
      ).toBeLessThanOrEqual(2);
      await page.mouse.up();
      await expect.poll(() => readDocument().connections[0]?.vertices?.[0]).not.toEqual(canonical);
      await resetByUndo();

      start = await locatorCenter(vertex);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.keyboard.down('Alt');
      const freePointer = { x: canonicalClient.x + 42, y: canonicalClient.y + 31 };
      await page.mouse.move(freePointer.x, freePointer.y);
      await frames(page);
      await expect(guide).toHaveCount(0);
      const freeHandle = await locatorCenter(vertex);
      expect(
        Math.hypot(freeHandle.x - freePointer.x, freeHandle.y - freePointer.y),
      ).toBeLessThanOrEqual(2);
      await page.screenshot({ path: 'reports/interactions/d1-bend-handle-follows-pointer.png' });
      await page.mouse.up();
      await page.keyboard.up('Alt');
      await expect.poll(() => readDocument().connections[0]?.vertices?.[0]).not.toEqual(canonical);
      await resetByUndo();

      start = await locatorCenter(vertex);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.keyboard.down('Shift');
      await page.mouse.move(canonicalClient.x + 46, canonicalClient.y + 31);
      await frames(page);
      await expect(guide).toHaveCount(0);
      await page.mouse.up();
      await page.keyboard.up('Shift');
      await expect
        .poll(() => {
          const point = readDocument().connections[0]?.vertices?.[0];
          return Boolean(
            point &&
            ((point.x === canonical.x && point.y === canonical.y) ||
              (point.x === alternate.x && point.y === alternate.y)),
          );
        })
        .toBe(true);
      await resetByUndo();
    },
  );

  wireVideoTest(
    'R4 compact external wire panel keeps primary actions small and removes duplicate 90°',
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openEditor(page, wiredDocument());

      const wirePath = page.getByTestId('wire-hit').first();
      const wirePoint = await pathScreenPoint(wirePath, 0.5);
      await page.mouse.click(wirePoint.x, wirePoint.y);

      const panel = page.locator('.workbench-inspector.wire-selected');
      const compact = page.getByTestId('wire-inspector-compact');
      await expect(panel).toHaveAttribute('aria-label', 'Параметры выбранного провода');
      await expect(compact).toBeVisible();
      await expect(compact.locator('.workbench-wire-swatches button')).toHaveCount(6);
      await expect(panel.locator('.workbench-inspector-heading')).toHaveCount(0);
      await expect(compact.getByRole('button', { name: /90°/ })).toHaveCount(0);
      await expect(compact.getByRole('button', { name: 'Выпрямить провод' })).toBeVisible();
      await expect(compact.getByRole('button', { name: 'Удалить провод' })).toBeVisible();
      await expect(
        compact.locator('.workbench-wire-more > summary[aria-label="Ещё действия с проводом"]'),
      ).toBeVisible();

      const panelBox = await panel.boundingBox();
      if (!panelBox) throw new Error('Expected external selected-wire panel');
      expect(panelBox.width).toBeLessThanOrEqual(296);
      expect(panelBox.height).toBeLessThanOrEqual(48);
      const panelStyle = await panel.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          borderWidth: style.borderTopWidth,
          borderRadius: style.borderTopLeftRadius,
          boxShadow: style.boxShadow,
        };
      });
      expect(panelStyle.borderWidth).toBe('1px');
      expect(Number.parseFloat(panelStyle.borderRadius)).toBeGreaterThanOrEqual(7);
      expect(panelStyle.boxShadow).not.toBe('none');

      const swatchStyle = await compact
        .locator('.workbench-wire-swatches button')
        .first()
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            radius: style.borderRadius,
            cursor: style.cursor,
            userSelect: style.userSelect,
          };
        });
      expect(Number.parseFloat(swatchStyle.radius)).toBeGreaterThanOrEqual(5);
      expect(swatchStyle.cursor).toBe('pointer');
      expect(swatchStyle.userSelect).toBe('none');

      const panelControlStyles = await compact
        .locator('button, .workbench-wire-more > summary')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const style = getComputedStyle(element);
            return {
              caretColor: style.caretColor,
              cursor: style.cursor,
              userSelect: style.userSelect,
              editable: (element as HTMLElement).isContentEditable,
            };
          }),
        );
      expect(panelControlStyles.length).toBeGreaterThan(8);
      for (const style of panelControlStyles) {
        expect(['transparent', 'rgba(0, 0, 0, 0)']).toContain(style.caretColor);
        expect(style.cursor).toBe('pointer');
        expect(style.userSelect).toBe('none');
        expect(style.editable).toBe(false);
      }

      const deleteIcon = compact.locator(
        '.workbench-wire-compact-actions > button.workbench-wire-delete svg.workbench-delete-icon',
      );
      await expect(deleteIcon).toBeVisible();
      const deleteIconBox = await deleteIcon.boundingBox();
      expect(deleteIconBox?.width).toBeGreaterThanOrEqual(18);
      expect(deleteIconBox?.width).toBeLessThanOrEqual(20);
      const actionDivider = await compact
        .locator('.workbench-wire-compact-actions')
        .evaluate((element) => getComputedStyle(element).borderLeftWidth);
      expect(actionDivider).toBe('1px');

      const libraryBox = await page.locator('.workbench-library').boundingBox();
      if (!libraryBox) throw new Error('Expected desktop component library');
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(libraryBox.x - 4);

      const firstSwatch = compact.locator('.workbench-wire-swatches button').first();
      await firstSwatch.click();
      await expect(firstSwatch).toBeFocused();
      expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
      await page.keyboard.press('Tab');
      const secondSwatch = compact.locator('.workbench-wire-swatches button').nth(1);
      await expect(secondSwatch).toBeFocused();
      const keyboardFocus = await secondSwatch.evaluate((element) => {
        const style = getComputedStyle(element);
        return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
      });
      expect(keyboardFocus.outlineStyle).not.toBe('none');
      expect(Number.parseFloat(keyboardFocus.outlineWidth)).toBeGreaterThanOrEqual(2);
      const selectedWire = page.getByTestId('schematic-wire');
      const beforeColour = await selectedWire.getAttribute('stroke');
      await compact.locator('.workbench-wire-swatches button:not(.active)').first().click();
      await expect.poll(() => selectedWire.getAttribute('stroke')).not.toBe(beforeColour);

      await compact.locator('.workbench-wire-more > summary').click();
      await expect(compact.getByRole('button', { name: 'Переподключить начало' })).toBeVisible();
      await expect(compact.getByRole('button', { name: 'Переподключить конец' })).toBeVisible();
      await page.screenshot({ path: 'reports/interactions/r4-wire-panel-desktop.png' });
      await page.screenshot({ path: 'reports/interactions/d1-trash-desktop.png' });
    },
  );

  wireVideoTest(
    'R4 mobile wire panel stays inside the stage with 44px primary targets',
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openEditor(page, wiredDocument());
      const wirePoint = await pathScreenPoint(page.getByTestId('wire-hit').first(), 0.5);
      await page.mouse.click(wirePoint.x, wirePoint.y);

      const panel = page.locator('.workbench-inspector.wire-selected');
      const compact = page.getByTestId('wire-inspector-compact');
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      if (!box) throw new Error('Expected mobile selected-wire panel');
      expect(box.x).toBeGreaterThanOrEqual(7);
      expect(box.x + box.width).toBeLessThanOrEqual(383);
      expect(box.height).toBeLessThanOrEqual(112);
      for (const target of await compact.locator('.workbench-wire-swatches button').all()) {
        const targetBox = await target.boundingBox();
        expect(targetBox?.width).toBeGreaterThanOrEqual(44);
        expect(targetBox?.height).toBeGreaterThanOrEqual(44);
      }
      for (const target of await compact
        .locator('.workbench-wire-compact-actions > button')
        .all()) {
        const targetBox = await target.boundingBox();
        expect(targetBox?.width).toBeGreaterThanOrEqual(44);
        expect(targetBox?.height).toBeGreaterThanOrEqual(44);
      }
      const mobileDeleteIcon = compact.locator(
        '.workbench-wire-compact-actions > button.workbench-wire-delete svg.workbench-delete-icon',
      );
      await expect(mobileDeleteIcon).toBeVisible();
      const mobileDeleteIconBox = await mobileDeleteIcon.boundingBox();
      expect(mobileDeleteIconBox?.width).toBeGreaterThanOrEqual(19);
      expect(mobileDeleteIconBox?.width).toBeLessThanOrEqual(21);
      const library = page.locator('.workbench-library');
      const libraryBox = await library.boundingBox();
      if (!libraryBox) throw new Error('Expected mobile component shelf');
      expect(box.y + box.height).toBeLessThanOrEqual(libraryBox.y - 4);
      await page.screenshot({ path: 'reports/interactions/r4-wire-panel-mobile.png' });
      await page.screenshot({ path: 'reports/interactions/d1-trash-mobile.png' });
    },
  );
});

test.describe('owner follow-up: edit mode, multi-select, clipboard and physical shortcuts', () => {
  test('E5/E6 multi-select, group move and clipboard preserve internal wiring', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const baseFixture = documentFixture();
    const ordinaryFixture = {
      ...baseFixture,
      components: baseFixture.components.filter((item) => ['led', 'battery'].includes(item.id)),
    };
    let fixture = addComponentToDocument(
      ordinaryFixture,
      'resistor-axial',
      { x: 1060, y: 300 },
      'group-resistor',
    ).document;
    fixture = {
      ...fixture,
      connections: [
        {
          id: 'internal-wire',
          from: { componentId: 'led', terminal: 'cathode' },
          to: { componentId: 'battery', terminal: 'BAT+' },
          color: '#149447',
          vertices: [{ x: 860, y: 340 }],
        },
        {
          id: 'external-wire',
          from: { componentId: 'battery', terminal: 'BAT-' },
          to: { componentId: 'group-resistor', terminal: 'lead-2' },
          color: '#2c62c9',
          vertices: [{ x: 1020, y: 500 }],
        },
      ],
    };
    const { readDocument } = await openEditor(page, fixture);
    await page
      .getByRole('button', {
        name: '\u041f\u043e\u0434\u043e\u0433\u043d\u0430\u0442\u044c \u043f\u0440\u043e\u0435\u043a\u0442',
        exact: true,
      })
      .click();

    const clickBody = async (id: string, shift = false) => {
      let at: { x: number; y: number };
      try {
        at = await pointOnBody(page, id);
      } catch (error) {
        if (!shift) throw error;
        // Compact parts can be completely covered by their retained R2 terminal
        // hit targets. Shift-click the real terminal surface in that case; the
        // controller must arbitrate it as additive component selection while no
        // wire/reconnect interaction is active.
        const terminal = page
          .locator('[data-terminal-component-id="' + id + '"][data-terminal-id]')
          .first();
        await expect(terminal).toBeVisible();
        at = await locatorCenter(terminal);
      }
      if (shift) await page.keyboard.down('Shift');
      await page.mouse.click(at.x, at.y);
      if (shift) await page.keyboard.up('Shift');
    };
    const selectedIds = () =>
      page
        .locator('[data-testid="schematic-component"].workbench-component-selected')
        .evaluateAll((nodes) =>
          nodes.map((node) => (node as SVGElement).dataset['componentId']).sort(),
        );

    await clickBody('led');
    await clickBody('battery', true);
    await expect.poll(selectedIds).toEqual(['battery', 'led']);
    await expect(
      page.getByText('\u0412\u044b\u0431\u0440\u0430\u043d\u043e: 2', { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('component-compact-properties')).toHaveCount(0);

    await clickBody('battery', true);
    await expect.poll(selectedIds).toEqual(['led']);
    await clickBody('battery', true);
    await expect.poll(selectedIds).toEqual(['battery', 'led']);

    const beforeMove = structuredClone(readDocument());
    const ledBefore = beforeMove.components.find((item) => item.id === 'led')!.position;
    const resistorBefore = beforeMove.components.find(
      (item) => item.id === 'group-resistor',
    )!.position;
    const batteryBefore = beforeMove.components.find((item) => item.id === 'battery')!.position;
    const grab = await pointOnBody(page, 'led');
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 42, grab.y + 28, { steps: 12 });
    await frames(page);
    await page.mouse.up();
    await expect
      .poll(() => readDocument().components.find((item) => item.id === 'led')?.position)
      .not.toEqual(ledBefore);
    const moved = structuredClone(readDocument());
    const ledMoved = moved.components.find((item) => item.id === 'led')!.position;
    const batteryMoved = moved.components.find((item) => item.id === 'battery')!.position;
    expect(batteryMoved.x - batteryBefore.x).toBeCloseTo(ledMoved.x - ledBefore.x, 3);
    expect(batteryMoved.y - batteryBefore.y).toBeCloseTo(ledMoved.y - ledBefore.y, 3);
    expect(moved.components.find((item) => item.id === 'group-resistor')!.position).toEqual(
      resistorBefore,
    );

    await page
      .getByRole('button', { name: /\u041e\u0442\u043c\u0435\u043d\u0438\u0442\u044c/ })
      .click();
    await expect
      .poll(() => readDocument().components.find((item) => item.id === 'led')?.position)
      .toEqual(ledBefore);
    await expect
      .poll(() => readDocument().components.find((item) => item.id === 'battery')?.position)
      .toEqual(batteryBefore);

    await clickBody('battery');
    const ledBox = await part(page, 'led').boundingBox();
    const resistorBox = await part(page, 'group-resistor').boundingBox();
    const stageBox = await page.locator('.workbench-stage').boundingBox();
    if (!ledBox || !resistorBox || !stageBox) throw new Error('Missing group selection bounds');
    const start = {
      x: Math.max(stageBox.x + 8, Math.min(ledBox.x, resistorBox.x) - 18),
      y: Math.max(stageBox.y + 8, Math.min(ledBox.y, resistorBox.y) - 18),
    };
    const end = {
      x: Math.min(
        stageBox.x + stageBox.width - 8,
        Math.max(ledBox.x + ledBox.width, resistorBox.x + resistorBox.width) + 18,
      ),
      y: Math.min(
        stageBox.y + stageBox.height - 8,
        Math.max(ledBox.y + ledBox.height, resistorBox.y + resistorBox.height) + 18,
      ),
    };
    await page.keyboard.down('Shift');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect.poll(selectedIds).toEqual(['battery', 'group-resistor', 'led']);

    const session = await context.newCDPSession(page);
    const physicalKey = async (
      code: string,
      key: string,
      options: { ctrl?: boolean; shift?: boolean } = {},
    ) => {
      const virtualCodes: Record<string, number> = {
        KeyA: 65,
        KeyC: 67,
        KeyD: 68,
        KeyR: 82,
        KeyV: 86,
        KeyY: 89,
        KeyZ: 90,
        Delete: 46,
        Backspace: 8,
        Escape: 27,
        Space: 32,
      };
      const virtual = virtualCodes[code] ?? 0;
      const modifiers = (options.ctrl ? 2 : 0) | (options.shift ? 8 : 0);
      await session.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        code,
        key,
        modifiers,
        windowsVirtualKeyCode: virtual,
        nativeVirtualKeyCode: virtual,
      });
      await session.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        code,
        key,
        modifiers,
        windowsVirtualKeyCode: virtual,
        nativeVirtualKeyCode: virtual,
      });
    };

    await clickBody('led');
    await clickBody('battery', true);
    await expect.poll(selectedIds).toEqual(['battery', 'led']);
    const originalComponentCount = readDocument().components.length;
    const originalConnectionCount = readDocument().connections.length;
    expect(
      readDocument().connections.some(
        (wire) =>
          new Set([wire.from.componentId, wire.to.componentId]).size === 2 &&
          [wire.from.componentId, wire.to.componentId].includes('led') &&
          [wire.from.componentId, wire.to.componentId].includes('battery'),
      ),
    ).toBe(true);

    await physicalKey('KeyC', 'c', { ctrl: true });
    await physicalKey('KeyV', 'v', { ctrl: true });
    await expect.poll(() => readDocument().components.length).toBe(originalComponentCount + 2);
    await expect.poll(() => readDocument().connections.length).toBe(originalConnectionCount + 1);
    const firstPaste = structuredClone(readDocument());
    const pastedIds = firstPaste.components
      .map((item) => item.id)
      .filter((id) => !fixture.components.some((source) => source.id === id));
    expect(new Set(pastedIds).size).toBe(2);
    const copiedWire = firstPaste.connections.find(
      (wire) => !fixture.connections.some((source) => source.id === wire.id),
    );
    expect(copiedWire).toBeDefined();
    expect(copiedWire?.from.componentId).not.toBe('battery');
    expect(copiedWire?.to.componentId).not.toBe('battery');

    await physicalKey('KeyZ', 'z', { ctrl: true });
    await expect.poll(() => readDocument().components.length).toBe(originalComponentCount);
    await physicalKey('KeyZ', 'z', { ctrl: true, shift: true });
    await expect.poll(() => readDocument().components.length).toBe(originalComponentCount + 2);

    await page.screenshot({ path: 'reports/interactions/e5-e6-multiselect-copy-paste.png' });

    const expectedComponents = readDocument().components.length;
    const expectedConnections = readDocument().connections.length;
    await page.reload();
    await expect(page.getByTestId('schematic-component')).toHaveCount(expectedComponents);
    await expect(page.getByTestId('schematic-wire')).toHaveCount(expectedConnections);
  });

  test('E7/E8 physical-code edit commands remain layout-independent and protect text fields', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const { readDocument } = await openEditor(page, documentFixture());
    await page
      .getByRole('button', {
        name: '\u041f\u043e\u0434\u043e\u0433\u043d\u0430\u0442\u044c \u043f\u0440\u043e\u0435\u043a\u0442',
        exact: true,
      })
      .click();

    const session = await context.newCDPSession(page);
    const physicalKey = async (
      code: string,
      key: string,
      options: { ctrl?: boolean; shift?: boolean } = {},
    ) => {
      const virtualCodes: Record<string, number> = {
        KeyA: 65,
        KeyD: 68,
        KeyR: 82,
        KeyZ: 90,
        Delete: 46,
        Backspace: 8,
        Escape: 27,
      };
      const virtual = virtualCodes[code] ?? 0;
      const modifiers = (options.ctrl ? 2 : 0) | (options.shift ? 8 : 0);
      await session.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        code,
        key,
        modifiers,
        windowsVirtualKeyCode: virtual,
        nativeVirtualKeyCode: virtual,
      });
      await session.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        code,
        key,
        modifiers,
        windowsVirtualKeyCode: virtual,
        nativeVirtualKeyCode: virtual,
      });
    };

    const selectBattery = async () => {
      const point = await pointOnBody(page, 'battery');
      await page.mouse.click(point.x, point.y);
      await expect(part(page, 'battery')).toHaveClass(/workbench-component-selected/);
    };

    await selectBattery();
    const rotationBefore =
      readDocument().components.find((item) => item.id === 'battery')?.rotation ?? 0;
    await physicalKey('KeyR', '\u043a');
    await expect
      .poll(() => readDocument().components.find((item) => item.id === 'battery')?.rotation ?? 0)
      .not.toBe(rotationBefore);
    await physicalKey('KeyZ', 'z', { ctrl: true });
    await expect
      .poll(() => readDocument().components.find((item) => item.id === 'battery')?.rotation ?? 0)
      .toBe(rotationBefore);

    const countBeforeDelete = readDocument().components.length;
    await selectBattery();
    await physicalKey('Delete', 'Delete');
    await expect.poll(() => readDocument().components.length).toBe(countBeforeDelete - 1);
    await physicalKey('KeyZ', 'z', { ctrl: true });
    await expect.poll(() => readDocument().components.length).toBe(countBeforeDelete);

    await selectBattery();
    await physicalKey('Backspace', 'Backspace');
    await expect.poll(() => readDocument().components.length).toBe(countBeforeDelete - 1);
    await physicalKey('KeyZ', 'z', { ctrl: true });
    await expect.poll(() => readDocument().components.length).toBe(countBeforeDelete);

    await physicalKey('KeyA', 'a', { ctrl: true });
    const selectedComponentIds = () =>
      page
        .locator('[data-testid="schematic-component"].workbench-component-selected')
        .evaluateAll((nodes) =>
          [...new Set(nodes.map((node) => (node as SVGElement).dataset['componentId']))]
            .filter((id): id is string => Boolean(id))
            .sort(),
        );
    await expect.poll(selectedComponentIds).toEqual(
      readDocument()
        .components.map((component) => component.id)
        .sort(),
    );
    await physicalKey('Escape', 'Escape');
    await expect.poll(selectedComponentIds).toEqual([]);

    const title = page.getByRole('textbox', {
      name: '\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u043f\u0440\u043e\u0435\u043a\u0442\u0430',
      exact: true,
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await title.fill('ABC');
    await title.selectText();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('End');
    await page.keyboard.press('Control+v');
    await expect(title).toHaveValue('ABCABC');
    const countBeforeTextKeys = readDocument().components.length;
    await physicalKey('KeyD', '\u0432', { ctrl: true });
    expect(readDocument().components.length).toBe(countBeforeTextKeys);
    await page.keyboard.press('Backspace');
    await expect(title).toHaveValue('ABCAB');
    await page.keyboard.press('Space');
    await page.keyboard.type('X');
    await expect(title).toHaveValue('ABCAB X');
    expect(readDocument().components.length).toBe(countBeforeTextKeys);
    await page.screenshot({ path: 'reports/interactions/e7-e8-shortcuts-editable.png' });
  });

  wireVideoTest(
    'E2 running simulation locks existing structure; only catalog pickup exits the mode',
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      let fixture = addComponentToDocument(
        documentFixture(),
        'button-tactile-6mm',
        { x: 1070, y: 420 },
        'runtime-button',
      ).document;
      fixture = addComponentToDocument(
        fixture,
        'switch-spdt',
        { x: 1030, y: 610 },
        'runtime-switch',
      ).document;
      fixture = addComponentToDocument(
        fixture,
        'potentiometer',
        { x: 790, y: 610 },
        'runtime-pot',
      ).document;
      fixture = {
        ...fixture,
        connections: [
          ...fixture.connections,
          {
            id: 'simulation-lock-wire',
            from: { componentId: 'battery', terminal: 'BAT+' },
            to: { componentId: 'led', terminal: 'cathode' },
            color: '#149447',
            vertices: [{ x: 820, y: 430 }],
          },
        ],
      };
      const { readDocument } = await openEditor(page, fixture);
      await page.getByRole('button', { name: 'Подогнать проект', exact: true }).click();

      await page.getByRole('button', { name: 'Начать моделирование' }).click();
      const runningSimulation = page.getByRole('button', { name: 'Остановить моделирование' });
      await expect(runningSimulation).toBeVisible();
      await expect(runningSimulation).toHaveAttribute('aria-pressed', 'true');
      const runningStyle = await runningSimulation.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          color: style.color,
          fontWeight: style.fontWeight,
        };
      });
      expect(runningStyle.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(runningStyle.background).not.toBe('transparent');
      expect(runningStyle.color).toBe('rgb(255, 255, 255)');
      expect(Number.parseInt(runningStyle.fontWeight, 10)).toBeGreaterThanOrEqual(700);
      await page.screenshot({ path: 'reports/interactions/d2-simulation-running.png' });

      const batteryPosition = () => {
        const item = readDocument().components.find((component) => component.id === 'battery');
        if (!item) throw new Error('Battery disappeared');
        return { ...item.position };
      };
      const baseline = structuredClone(readDocument());

      const batteryPoint = await pointOnBody(page, 'battery');
      await page.mouse.click(batteryPoint.x, batteryPoint.y);
      await expect(part(page, 'battery')).toHaveClass(/workbench-component-selected/);
      await expect(runningSimulation).toBeVisible();

      const beforeDrag = batteryPosition();
      await page.mouse.move(batteryPoint.x, batteryPoint.y);
      await page.mouse.down();
      await page.mouse.move(batteryPoint.x + 80, batteryPoint.y + 50, { steps: 6 });
      await page.mouse.up();
      expect(batteryPosition()).toEqual(beforeDrag);
      await expect(runningSimulation).toBeVisible();

      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Control+c');
      await page.keyboard.press('Control+v');
      await page.keyboard.press('Control+d');
      await page.keyboard.press('KeyR');
      await page.keyboard.press('Delete');
      await page.keyboard.press('Control+z');
      await page.keyboard.press('Control+Shift+z');
      expect(readDocument()).toEqual(baseline);
      await expect(runningSimulation).toBeVisible();

      const wireHit = page.locator('[data-testid="wire-hit"][data-wire-id="simulation-lock-wire"]');
      const wirePoint = await pathScreenPoint(wireHit, 0.5);
      await page.mouse.click(wirePoint.x, wirePoint.y);
      const vertex = page.locator(
        '[data-testid="wire-vertex"][data-wire-id="simulation-lock-wire"]',
      );
      await expect(vertex).toHaveCount(1);
      const vertexPoint = await locatorCenter(vertex);
      await page.mouse.move(vertexPoint.x, vertexPoint.y);
      await page.mouse.down();
      await page.mouse.move(vertexPoint.x + 70, vertexPoint.y + 40, { steps: 5 });
      await page.mouse.up();
      expect(readDocument()).toEqual(baseline);

      const source = wireTerminal(page, 'battery', 'BAT+');
      const sourcePoint = await locatorCenter(source);
      await page.mouse.click(sourcePoint.x, sourcePoint.y);
      await expect(page.locator('.workbench-wire-preview')).toHaveCount(0);
      expect(readDocument()).toEqual(baseline);
      await expect(runningSimulation).toBeVisible();

      const buttonPoint = await pointOnBody(page, 'runtime-button');
      await page.mouse.move(buttonPoint.x, buttonPoint.y);
      await page.mouse.down();
      await expect(part(page, 'runtime-button')).toHaveClass(/workbench-component-actuator-active/);
      await expect(runningSimulation).toBeVisible();
      await page.mouse.up();

      const switchActuator = part(page, 'runtime-switch').getByTestId('spdt-actuator');
      await switchActuator.click();
      await expect(part(page, 'runtime-switch')).toHaveClass(/workbench-component-actuator-active/);
      await expect(runningSimulation).toBeVisible();

      const potPoint = await pointOnBody(page, 'runtime-pot');
      await page.mouse.click(potPoint.x, potPoint.y);
      await page
        .getByRole('button', { name: /Техническое состояние Потенциометр/ })
        .click();
      const slider = page.getByRole('slider', { name: 'Положение движка' });
      await expect(slider).toBeVisible();
      await slider.press('Home');
      await slider.press('End');
      await expect(runningSimulation).toBeVisible();
      expect(readDocument()).toEqual(baseline);

      const card = page.locator('.workbench-catalog-card[data-family-id="resistor"]');
      await card.scrollIntoViewIfNeeded();
      const cardPoint = await locatorCenter(card);
      const stage = await page.locator('.workbench-stage').boundingBox();
      if (!stage) throw new Error('Missing stage for catalog placement');
      const drop = { x: stage.x + stage.width * 0.55, y: stage.y + stage.height * 0.42 };
      const beforeCount = readDocument().components.length;
      await page.mouse.move(cardPoint.x, cardPoint.y);
      await page.mouse.down();
      await page.mouse.move(cardPoint.x - 10, cardPoint.y - 12, { steps: 2 });
      await expect(page.getByRole('button', { name: 'Начать моделирование' })).toBeVisible();
      await expect(page.getByTestId('catalog-placement-preview')).toHaveCount(1);
      await page.mouse.move(drop.x, drop.y, { steps: 10 });
      await page.mouse.up();
      await expect.poll(() => readDocument().components.length).toBe(beforeCount + 1);

      await page.getByRole('button', { name: 'Начать моделирование' }).click();
      await expect(page.getByRole('button', { name: 'Остановить моделирование' })).toBeVisible();
      await page.getByRole('button', { name: 'Остановить моделирование' }).click();
      await expect(page.getByRole('button', { name: 'Начать моделирование' })).toBeVisible();

      const unlockedPoint = await pointOnBody(page, 'battery');
      const unlockedBefore = batteryPosition();
      await page.mouse.move(unlockedPoint.x, unlockedPoint.y);
      await page.mouse.down();
      await page.mouse.move(unlockedPoint.x + 55, unlockedPoint.y + 30, { steps: 6 });
      await page.mouse.up();
      await expect.poll(batteryPosition).not.toEqual(unlockedBefore);
    },
  );
});

for (const zoom of [1, 2, 4] as const) {
  wireVideoTest(
    'E3 full-stage H/V guide keeps constant screen treatment at zoom ' + zoom + 'x',
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      const fixture = documentFixture();
      const battery = fixture.components.find((component) => component.id === 'battery');
      if (!battery) throw new Error('Missing battery for guide acceptance');
      const sourceWorld = terminalPositionInDocument(fixture, battery, 'BAT+');
      if (!sourceWorld) throw new Error('Missing BAT+ world point for guide acceptance');
      fixture.viewport = {
        x: sourceWorld.x - 800 / zoom,
        y: sourceWorld.y - 490 / zoom,
        zoom,
      };
      await openEditor(page, fixture);
      const source = wireTerminal(page, 'battery', 'BAT+');
      const sourcePoint = await locatorCenter(source);
      await page.mouse.click(sourcePoint.x, sourcePoint.y);
      await expect(page.locator('.workbench-wire-preview')).toHaveCount(1);

      const stageBox = await page.locator('.workbench-stage').boundingBox();
      if (!stageBox) throw new Error('Missing guide stage bounds');
      const horizontalRoomRight = stageBox.x + stageBox.width - 30 - sourcePoint.x;
      const horizontalRoomLeft = sourcePoint.x - (stageBox.x + 30);
      const horizontalDirection = horizontalRoomRight >= horizontalRoomLeft ? 1 : -1;
      const horizontalDistance = Math.max(
        30,
        Math.min(90, horizontalDirection > 0 ? horizontalRoomRight : horizontalRoomLeft),
      );
      const horizontalTarget = {
        x: sourcePoint.x + horizontalDistance * horizontalDirection,
        y: sourcePoint.y + 2,
      };
      await page.mouse.move(horizontalTarget.x, horizontalTarget.y);
      await frames(page);
      const horizontal = page.getByTestId('wire-alignment-guide');
      await expect(horizontal).toHaveCount(1);
      await expect(horizontal).toHaveAttribute('data-guide-axis', 'horizontal');
      await expect(horizontal).toHaveAttribute('vector-effect', 'non-scaling-stroke');
      const hBox = await horizontal.boundingBox();
      if (!hBox) throw new Error('Missing guide bounds');
      expect(hBox.width).toBeGreaterThanOrEqual(stageBox.width - 3);
      const strokeWidth = await horizontal.evaluate((node) => getComputedStyle(node).strokeWidth);
      expect(Number.parseFloat(strokeWidth)).toBeCloseTo(1, 1);
      await page.screenshot({
        path: 'reports/interactions/e3-guide-horizontal-' + zoom + 'x.png',
      });

      await page.keyboard.press('Escape');
      await expect(page.getByTestId('wire-alignment-guide')).toHaveCount(0);
      await page.mouse.click(sourcePoint.x, sourcePoint.y);
      await expect(page.locator('.workbench-wire-preview')).toHaveCount(1);
      const verticalRoomDown = stageBox.y + stageBox.height - 30 - sourcePoint.y;
      const verticalRoomUp = sourcePoint.y - (stageBox.y + 30);
      const verticalDirection = verticalRoomDown >= verticalRoomUp ? 1 : -1;
      const verticalDistance = Math.max(
        30,
        Math.min(90, verticalDirection > 0 ? verticalRoomDown : verticalRoomUp),
      );
      const verticalTarget = {
        x: sourcePoint.x + 2,
        y: sourcePoint.y + verticalDistance * verticalDirection,
      };
      await page.mouse.move(verticalTarget.x, verticalTarget.y);
      await frames(page);
      const vertical = page.getByTestId('wire-alignment-guide');
      await expect(vertical).toHaveCount(1);
      await expect(vertical).toHaveAttribute('data-guide-axis', 'vertical');
      const vBox = await vertical.boundingBox();
      if (!vBox) throw new Error('Missing vertical guide bounds');
      expect(vBox.height).toBeGreaterThanOrEqual(stageBox.height - 3);
      await page.keyboard.down('Alt');
      await page.mouse.move(verticalTarget.x, verticalTarget.y);
      await frames(page);
      await expect(page.getByTestId('wire-alignment-guide')).toHaveCount(0);
      await page.keyboard.up('Alt');
      await page.keyboard.press('Escape');
    },
  );
}

for (const [width, height] of [
  [320, 568],
  [390, 844],
  [430, 932],
  [768, 1024],
  [568, 320],
  [844, 390],
  [932, 430],
  [1024, 768],
] as const) {
  touchVideoTest(
    `R3 native matrix ${width}x${height}: place, move, both wire gestures, Undo/Redo and panel`,
    async ({ page, context }) => {
      await page.setViewportSize({ width, height });
      const fixture = documentFixture();
      fixture.components = fixture.components
        .filter((item) => item.id !== 'board' && item.id !== 'uno')
        .map((item) =>
          item.id === 'led'
            ? { ...item, rotation: 45, stateProperties: { ...item.stateProperties, mirrorX: true } }
            : item,
        );
      const { errors, readDocument } = await openEditor(page, fixture);
      const session = await context.newCDPSession(page);
      const send = (
        type: 'touchStart' | 'touchMove' | 'touchEnd',
        touchPoints: { id: number; x: number; y: number }[],
      ) => session.send('Input.dispatchTouchEvent', { type, touchPoints });
      const tap = async (locator: Locator) => {
        if (await locator.evaluate((element) => element instanceof SVGElement)) {
          // Dense terminal hit circles overlap by design. Send real screen input
          // and verify the resolver's recorded terminal identity below, not DOM order.
          const point = await locatorCenter(locator);
          await page.touchscreen.tap(point.x, point.y);
        } else {
          await locator.tap();
        }
      };
      const gesture = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
        await send('touchStart', [{ id: 1, ...from }]);
        for (let step = 1; step <= 8; step++)
          await send('touchMove', [
            {
              id: 1,
              x: from.x + ((to.x - from.x) * step) / 8,
              y: from.y + ((to.y - from.y) * step) / 8,
            },
          ]);
        await send('touchEnd', []);
      };
      if (width <= 980) {
        await tap(page.getByRole('button', { name: 'Каталог деталей', exact: true }));
      }
      const card = page.getByRole('button', { name: 'Резистор', exact: true });
      await card.scrollIntoViewIfNeeded();
      const start = await locatorCenter(card);
      const stage = await page.locator('.workbench-stage').boundingBox();
      if (!stage) throw new Error('Missing built stage');
      const drop = { x: stage.x + stage.width * 0.6, y: stage.y + stage.height * 0.5 };
      await send('touchStart', [{ id: 1, ...start }]);
      await send('touchMove', [{ id: 1, x: start.x, y: start.y - 14 }]);
      const preview = page.getByTestId('catalog-placement-preview');
      await expect(preview).toHaveCount(1);
      for (let step = 1; step <= 8; step++)
        await send('touchMove', [
          {
            id: 1,
            x: start.x + ((drop.x - start.x) * step) / 8,
            y: start.y - 14 + ((drop.y - start.y + 14) * step) / 8,
          },
        ]);
      await frames(page);
      const previewCenter = await locatorCenter(preview);
      expect(Math.hypot(previewCenter.x - drop.x, previewCenter.y - drop.y)).toBeLessThanOrEqual(1);
      await send('touchEnd', []);
      await expect(page.getByTestId('schematic-component')).toHaveCount(3);
      await expect(preview).toHaveCount(0);
      await tap(page.getByRole('button', { name: 'Подогнать проект', exact: true }));
      const resistor = page.locator(
        '[data-testid="schematic-component"][data-component-type="resistor-axial"]',
      );
      const resistorId = await resistor.getAttribute('data-component-id');
      if (!resistorId) throw new Error('Missing placed resistor identity');
      const grab = await pointOnBody(page, resistorId);
      const oldX = await resistor.getAttribute('data-x');
      await gesture(grab, { x: grab.x + 18, y: grab.y + 20 });
      await expect(resistor).not.toHaveAttribute('data-x', oldX!);
      const movedX = await resistor.getAttribute('data-x');
      if (!movedX || movedX === oldX) throw new Error('Touch drag did not move the resistor body');
      await tap(page.getByRole('button', { name: 'Подогнать проект', exact: true }));
      const clearPoint = await page.locator('.workbench-stage').evaluate((stage) => {
        const box = stage.getBoundingClientRect();
        const componentBoxes = [
          ...document.querySelectorAll<SVGGraphicsElement>(
            '[data-testid="schematic-component"] .workbench-part',
          ),
        ].map((element) => element.getBoundingClientRect());
        for (const fy of [0.08, 0.18, 0.32, 0.5, 0.68, 0.82, 0.92]) {
          for (const fx of [0.08, 0.18, 0.32, 0.5, 0.68, 0.82, 0.92]) {
            const point = { x: box.left + box.width * fx, y: box.top + box.height * fy };
            const insideComponentBox = componentBoxes.some(
              (part) =>
                point.x >= part.left &&
                point.x <= part.right &&
                point.y >= part.top &&
                point.y <= part.bottom,
            );
            if (insideComponentBox) continue;
            const topmost = document.elementFromPoint(point.x, point.y);
            if (topmost?.classList.contains('workbench-grid-hit')) return point;
          }
        }
        throw new Error('No exposed empty-canvas point is available after fit');
      });
      await page.touchscreen.tap(clearPoint.x, clearPoint.y);
      await expect(page.getByTestId('component-compact-properties')).toHaveCount(0);
      const source = wireTerminal(page, 'battery', 'BAT+');
      const target = wireTerminal(page, 'led', 'cathode');
      await gesture(await locatorCenter(source), await locatorCenter(target));
      await expect(page.getByTestId('schematic-wire')).toHaveCount(1);
      await expect(page.locator('.workbench-wire-preview')).toHaveCount(0);
      const undo = page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true });
      const redo = page.getByRole('button', {
        name: 'Повторить (Ctrl+Shift+Z)',
        exact: true,
      });
      await expect(undo).toBeEnabled();
      if (width === 390 && height === 844) {
        const box = await undo.boundingBox();
        if (!box) throw new Error('Undo button is not visible');
        const centre = { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const beforeCancelled = structuredClone(readDocument());
        const writesBeforeCancelled = await page.evaluate(
          () => (window as unknown as { draftWrites: number }).draftWrites,
        );
        // A swipe is not a command, even when the pointer returns to its start.
        await send('touchStart', [centre]);
        await send('touchMove', [{ ...centre, x: centre.x + 12 }]);
        await send('touchMove', [centre]);
        await send('touchEnd', []);
        // Implicit capture delivers a near-edge release to the original button;
        // release outside its rectangle still must not activate Undo.
        const edge = { id: 1, x: box.x + 1, y: centre.y };
        await send('touchStart', [edge]);
        await send('touchMove', [{ ...edge, x: box.x - 2 }]);
        await send('touchEnd', []);
        await send('touchStart', [centre]);
        await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        // A second contact cancels the command gesture rather than turning the
        // first finger's later release into an unsolicited Undo.
        await send('touchStart', [centre]);
        await send('touchStart', [centre, { id: 2, x: centre.x + 44, y: centre.y }]);
        await send('touchEnd', []);
        await frames(page);
        expect(readDocument()).toEqual(beforeCancelled);
        expect(
          await page.evaluate(() => (window as unknown as { draftWrites: number }).draftWrites),
        ).toBe(writesBeforeCancelled);
        await expect(page.getByTestId('schematic-wire')).toHaveCount(1);
      }
      await undo.tap();
      await expect(page.getByTestId('schematic-wire')).toHaveCount(0);
      await expect(resistor).toHaveAttribute('data-x', movedX);
      expect(readDocument().connections).toHaveLength(0);
      await expect(redo).toBeEnabled();
      await redo.tap();
      await expect(page.getByTestId('schematic-wire')).toHaveCount(1);
      await expect(resistor).toHaveAttribute('data-x', movedX);
      await undo.tap();
      await expect(page.getByTestId('schematic-wire')).toHaveCount(0);
      await tap(source);
      await expect(page.locator('.workbench-wire-preview')).toHaveCount(1);
      await tap(target);
      await expect(page.getByTestId('schematic-wire')).toHaveCount(1);
      await expect
        .poll(() => readDocument().connections.map((wire) => ({ from: wire.from, to: wire.to })))
        .toEqual([
          {
            from: { componentId: 'battery', terminal: 'BAT+' },
            to: { componentId: 'led', terminal: 'cathode' },
          },
        ]);
      await undo.tap();
      await expect(page.getByTestId('schematic-wire')).toHaveCount(0);
      await expect(resistor).toHaveAttribute('data-x', movedX);
      await redo.tap();
      await expect(page.getByTestId('schematic-wire')).toHaveCount(1);
      await expect(resistor).toHaveAttribute('data-x', movedX);
      await expect
        .poll(() => readDocument().connections.map((wire) => ({ from: wire.from, to: wire.to })))
        .toEqual([
          {
            from: { componentId: 'battery', terminal: 'BAT+' },
            to: { componentId: 'led', terminal: 'cathode' },
          },
        ]);
      const panel = page.locator('.workbench-inspector.wire-selected');
      const box = await panel.boundingBox();
      const zoom = await page.locator('.workbench-stage-controls').boundingBox();
      if (!box || !zoom) throw new Error('Missing panel or zoom controls');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(
        box.x >= zoom.x + zoom.width ||
          box.y >= zoom.y + zoom.height ||
          box.x + box.width <= zoom.x ||
          box.y + box.height <= zoom.y,
      ).toBe(true);
      await page.screenshot({ path: `reports/interactions/native-${width}x${height}.png` });
      expect(errors).toEqual([]);
    },
  );
}

touchVideoTest(
  'R3 cancellation: second finger, pointercancel, capture loss and blur leave no draft',
  async ({ page, context }) => {
    const { errors } = await openEditor(page);
    await page.getByRole('button', { name: 'Каталог деталей', exact: true }).click();
    const card = page.getByRole('button', { name: 'Резистор', exact: true });
    await card.scrollIntoViewIfNeeded();
    const session = await context.newCDPSession(page);
    const send = (
      type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
      touchPoints: { id: number; x: number; y: number }[],
    ) => session.send('Input.dispatchTouchEvent', { type, touchPoints });
    for (const mode of ['second-finger', 'pointercancel', 'capture-loss', 'blur'] as const) {
      const start = await locatorCenter(card);
      const moving = { x: start.x, y: start.y - 24 };
      const writes = await page.evaluate(
        () => (window as unknown as { draftWrites: number }).draftWrites,
      );
      await card.evaluate((element) => {
        element.addEventListener(
          'pointerdown',
          (event) => {
            (element as HTMLElement).dataset['testPointerId'] = String(
              (event as PointerEvent).pointerId,
            );
          },
          { once: true },
        );
      });
      await send('touchStart', [{ id: 1, ...start }]);
      await send('touchMove', [{ id: 1, ...moving }]);
      await expect(page.getByTestId('catalog-placement-preview')).toHaveCount(1);
      if (mode === 'second-finger')
        await send('touchStart', [
          { id: 1, ...moving },
          { id: 2, x: 185, y: 300 },
        ]);
      else if (mode === 'pointercancel') await send('touchCancel', []);
      else if (mode === 'capture-loss')
        await card.evaluate((element) => {
          const owner = element.closest('article');
          const id = Number((element as HTMLElement).dataset['testPointerId']);
          if (!owner?.hasPointerCapture(id)) throw new Error('Card does not own actual capture');
          owner.releasePointerCapture(id);
        });
      else await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      if (mode === 'capture-loss')
        await send('touchMove', [{ id: 1, x: moving.x, y: moving.y - 1 }]);
      await expect(page.getByTestId('catalog-placement-preview')).toHaveCount(0);
      if (mode !== 'pointercancel') await send('touchEnd', []);
      await expect(page.getByTestId('schematic-component')).toHaveCount(4);
      expect(
        await page.evaluate(() => (window as unknown as { draftWrites: number }).draftWrites),
      ).toBe(writes);
    }
    expect(errors).toEqual([]);
  },
);

test.describe('owner D3-D6 acceptance', () => {
  test('D3 arrow nudge moves one component and a group with one undoable step per keypress', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const { readDocument } = await openEditor(page, documentFixture());
    await page
      .getByRole('button', {
        name: '\u041f\u043e\u0434\u043e\u0433\u043d\u0430\u0442\u044c \u043f\u0440\u043e\u0435\u043a\u0442',
        exact: true,
      })
      .click();

    const selectBody = async (id: string, shift = false) => {
      const at = await pointOnBody(page, id);
      if (shift) await page.keyboard.down('Shift');
      await page.mouse.click(at.x, at.y);
      if (shift) await page.keyboard.up('Shift');
    };
    const position = (id: string) => {
      const found = readDocument().components.find((component) => component.id === id);
      if (!found) throw new Error('Missing component ' + id);
      return { ...found.position };
    };

    await selectBody('battery');
    const batteryStart = position('battery');
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => position('battery'))
      .toEqual({
        x: batteryStart.x + 5,
        y: batteryStart.y,
      });
    await page.keyboard.press('Shift+ArrowDown');
    await expect
      .poll(() => position('battery'))
      .toEqual({
        x: batteryStart.x + 5,
        y: batteryStart.y + 20,
      });

    await page.keyboard.press('Control+z');
    await expect
      .poll(() => position('battery'))
      .toEqual({
        x: batteryStart.x + 5,
        y: batteryStart.y,
      });
    await page.keyboard.press('Control+z');
    await expect.poll(() => position('battery')).toEqual(batteryStart);
    await page.keyboard.press('Control+Shift+z');
    await page.keyboard.press('Control+Shift+z');
    await expect
      .poll(() => position('battery'))
      .toEqual({
        x: batteryStart.x + 5,
        y: batteryStart.y + 20,
      });

    await selectBody('battery');
    await selectBody('led', true);
    const batteryGroupStart = position('battery');
    const ledGroupStart = position('led');
    await page.keyboard.press('ArrowLeft');
    await expect
      .poll(() => position('battery'))
      .toEqual({
        x: batteryGroupStart.x - 5,
        y: batteryGroupStart.y,
      });
    await expect
      .poll(() => position('led'))
      .toEqual({
        x: ledGroupStart.x - 5,
        y: ledGroupStart.y,
      });
    await page.keyboard.press('Control+z');
    await expect.poll(() => position('battery')).toEqual(batteryGroupStart);
    await expect.poll(() => position('led')).toEqual(ledGroupStart);

    const title = page.getByRole('textbox', {
      name: '\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u043f\u0440\u043e\u0435\u043a\u0442\u0430',
      exact: true,
    });
    await title.fill('Arrow field');
    const beforeEditableArrow = position('battery');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    expect(position('battery')).toEqual(beforeEditableArrow);

    await page.screenshot({ path: 'reports/interactions/d3-keyboard-nudge.png' });
  });

  test('D4 desktop empty project starts closer while mobile contract stays independent', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const empty: SchematicDocument = {
      schemaVersion: 4,
      components: [],
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: false, maxIterations: 24 },
    };
    const { readDocument } = await openEditor(page, empty);
    await expect(page.getByLabel('Масштаб 125 процентов')).toBeVisible();

    const card = page.locator('.workbench-catalog-card[data-family-id="battery-holder-aa"]');
    await card.scrollIntoViewIfNeeded();
    const cardPoint = await locatorCenter(card);
    const stage = await page.locator('.workbench-stage').boundingBox();
    if (!stage) throw new Error('Missing desktop stage');
    const drop = { x: stage.x + stage.width * 0.48, y: stage.y + stage.height * 0.5 };
    await page.mouse.move(cardPoint.x, cardPoint.y);
    await page.mouse.down();
    await page.mouse.move(drop.x, drop.y, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByTestId('schematic-component')).toHaveCount(1);

    const battery = page
      .locator('[data-component-type="battery-holder-aa-2"][data-testid="schematic-component"]')
      .first();
    const afterBox = await battery.boundingBox();
    if (!afterBox) throw new Error('Missing battery at closer initial zoom');
    await page.screenshot({ path: 'reports/interactions/d4-initial-zoom-after.png' });

    await page.evaluate(
      ({ id }) => {
        localStorage.setItem(
          'asa-electronics-viewport:' + id,
          JSON.stringify({ x: 0, y: 0, zoom: 1 }),
        );
      },
      { id: ID },
    );
    await page.reload();
    await expect(page.getByLabel('Масштаб 100 процентов')).toBeVisible();
    await expect(page.getByTestId('schematic-component')).toHaveCount(
      readDocument().components.length,
    );
    const beforeBox = await battery.boundingBox();
    if (!beforeBox) throw new Error('Missing battery at legacy initial zoom');
    expect(afterBox.width).toBeGreaterThan(beforeBox.width * 1.18);
    expect(afterBox.height).toBeGreaterThan(beforeBox.height * 1.18);
    await page.screenshot({ path: 'reports/interactions/d4-initial-zoom-before.png' });
  });

  test('D5 mobile component shelf is compact with edge handle and opt-in search', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openEditor(page, documentFixture());

    const library = page.locator('.workbench-library');
    const handle = page.locator('.workbench-library-collapse');
    await expect(library).toHaveClass(/collapsed/);
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('Missing compact mobile library handle');
    expect(handleBox.width).toBeLessThanOrEqual(40);
    expect(handleBox.height).toBeLessThanOrEqual(32);
    await page.screenshot({ path: 'reports/interactions/d5-mobile-panel-collapsed.png' });

    await handle.click();
    await expect(library).not.toHaveClass(/collapsed/);
    const openBox = await library.boundingBox();
    if (!openBox) throw new Error('Missing open mobile library');
    expect(openBox.height).toBeLessThanOrEqual(170);
    const searchToggle = page.getByRole('button', { name: 'Поиск компонентов' });
    await expect(searchToggle).toBeVisible();
    const searchInput = page.getByPlaceholder('Поиск');
    await expect(searchInput).toBeHidden();
    await page.screenshot({ path: 'reports/interactions/d5-mobile-panel-open.png' });

    await searchToggle.click();
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();
    await searchInput.fill('светодиод');
    await expect(page.getByRole('button', { name: 'Светодиод', exact: true })).toBeVisible();
    await page.screenshot({ path: 'reports/interactions/d5-mobile-search-active.png' });
  });

  test('D6 component shelf opens on All and search/categories remain functional', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openEditor(page, documentFixture());

    const category = page.getByRole('combobox', { name: 'Категория компонентов' });
    await expect(category).toHaveValue('all');
    const cards = page.locator('.workbench-catalog-card');
    const allCount = await cards.count();
    expect(allCount).toBeGreaterThan(10);

    await category.selectOption('basic');
    await expect(category).toHaveValue('basic');
    const basicCount = await cards.count();
    expect(basicCount).toBeGreaterThan(0);
    expect(basicCount).toBeLessThanOrEqual(allCount);

    await category.selectOption('power');
    await expect(category).toHaveValue('power');
    expect(await cards.count()).toBeGreaterThan(0);

    await category.selectOption('all');
    const search = page.getByPlaceholder('Поиск');
    await search.fill('резистор');
    await expect(page.getByRole('button', { name: 'Резистор', exact: true })).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);
    await page.screenshot({ path: 'reports/interactions/d6-all-components-default.png' });
  });
});
