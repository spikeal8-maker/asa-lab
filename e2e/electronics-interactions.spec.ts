import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { SchematicDocument } from '../apps/web/src/api';
import {
  configureProductionLibrary,
  productionBreadboard,
} from '../apps/web/src/electronics/production-manifest-adapter';
import {
  componentPointPosition,
  terminalPosition,
} from '../apps/web/src/electronics/component-catalog';
import {
  addComponentToDocument,
  moveComponentInDocument,
  snapComponentToBreadboard,
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
  return { requests, errors };
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
      return { x: box.x + box.width * 0.5, y: box.y + box.height * 0.35 };
    });
}

test.describe('interaction: electronics input and responsive layout', () => {
  test('drag follows the pointer, writes only on release, and Escape restores without saving', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const { errors } = await openEditor(page);
    const led = part(page, 'led');
    const start = await pointOnBody(page, 'led');
    const originalX = await led.getAttribute('data-x');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const writes = await page.evaluate(
      () => (window as unknown as { draftWrites: number }).draftWrites,
    );
    const before = await led.boundingBox();
    await page.mouse.move(start.x + 95, start.y + 55, { steps: 30 });
    await frames(page);
    const moving = await led.boundingBox();
    expect(moving!.x - before!.x).toBeCloseTo(95, 0);
    expect(moving!.y - before!.y).toBeCloseTo(55, 0);
    expect(await led.getAttribute('data-x')).toBe(originalX);
    expect(
      await page.evaluate(() => (window as unknown as { draftWrites: number }).draftWrites),
    ).toBe(writes);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await led.getAttribute('data-x')).toBe(originalX);
    expect(
      await page.evaluate(() => (window as unknown as { draftWrites: number }).draftWrites),
    ).toBe(writes);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 25, start.y + 20);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.up();
    await expect(led).toHaveAttribute('data-x', originalX!);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 95, start.y + 55, { steps: 30 });
    await page.mouse.up();
    await expect(led).not.toHaveAttribute('data-x', originalX!);
    const end = await led.boundingBox();
    expect(end!.x - before!.x).toBeCloseTo(95, 0);
    expect(
      await page.evaluate(() => (window as unknown as { draftWrites: number }).draftWrites),
    ).toBe(writes + 1);
    await page.getByRole('button', { name: /Отменить/ }).click();
    await expect(led).toHaveAttribute('data-x', originalX!);
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
        expect(await grid.evaluate((el) => getComputedStyle(el).touchAction)).toBe('pan-x');
      }
      await page.screenshot({
        path: 'reports/interactions/layout-' + width + 'x' + height + '.png',
      });
      expect(errors).toEqual([]);
    });
  }
});

test.describe('interaction: native touch', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('one-finger pan and two-finger pinch use the same screen coordinates', async ({
    page,
    context,
  }) => {
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
  });

  test('shelf scrolls natively; tap then canvas places exactly one part', async ({
    page,
    context,
  }) => {
    await openEditor(page);
    await page.getByRole('button', { name: 'Каталог деталей', exact: true }).click();
    const shelf = page.locator('.workbench-catalog-grid');
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ id: 1, x: 340, y: 775 }],
    });
    for (let x = 310; x >= 70; x -= 30)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ id: 1, x, y: 775 }],
      });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => shelf.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
    await expect(page.getByTestId('catalog-placement-preview')).toHaveCount(0);
    await expect(page.getByTestId('schematic-component')).toHaveCount(4);
    await shelf.evaluate((el) => {
      el.scrollLeft = 0;
    });
    await page.getByRole('button', { name: 'Резистор', exact: true }).tap();
    await expect(page.locator('.workbench-library')).toHaveClass(/collapsed/);
    await page.touchscreen.tap(190, 580);
    await expect(page.getByTestId('schematic-component')).toHaveCount(5);
    await expect(page.getByTestId('catalog-placement-preview')).toHaveCount(0);
    await page.screenshot({ path: 'reports/interactions/touch-placement.png' });
  });
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
    expect(Math.abs(placedBox.x - edge.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(placedBox.y - edge.y)).toBeLessThanOrEqual(1);
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
