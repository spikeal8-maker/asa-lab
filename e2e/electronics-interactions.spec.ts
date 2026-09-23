import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
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

test.describe('interaction: native touch', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 }, video: 'on' });

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

  test('R3 shelf scroll stays native and one upward finger drag places exactly one part', async ({
    page,
    context,
  }) => {
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

test.describe('interaction: natural precise wire routing', () => {
  test.use({ video: 'on' });
  test('R2 TERMINAL/HIT/ENDPOINT geometry scales at 0.5/1/2/4 and keeps one centre', async ({
    page,
  }) => {
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
      endpoint: number;
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
      const [hitBox, dotBox, boardHitBox, boardDotBox, endpointBox] = await Promise.all([
        componentHit.boundingBox(),
        componentDot.boundingBox(),
        breadboardHit.boundingBox(),
        breadboardDot.boundingBox(),
        endpoint.boundingBox(),
      ]);
      if (!hitBox || !dotBox || !boardHitBox || !boardDotBox || !endpointBox) {
        throw new Error(`Expected visible R2 geometry at zoom ${zoom}`);
      }
      const hitCenter = centerOf(hitBox);
      const dotCenter = centerOf(dotBox);
      const boardHitCenter = centerOf(boardHitBox);
      const boardDotCenter = centerOf(boardDotBox);
      const endpointCenter = centerOf(endpointBox);
      expect(
        Math.hypot(hitCenter.x - dotCenter.x, hitCenter.y - dotCenter.y),
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.hypot(boardHitCenter.x - boardDotCenter.x, boardHitCenter.y - boardDotCenter.y),
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.hypot(hitCenter.x - endpointCenter.x, hitCenter.y - endpointCenter.y),
      ).toBeLessThanOrEqual(0.5);

      samples.set(zoom, {
        hit: hitBox.width,
        dot: dotBox.width,
        breadboardHit: boardHitBox.width,
        breadboardDot: boardDotBox.width,
        endpoint: endpointBox.width,
      });
      if (zoom === 4) {
        await page.screenshot({ path: 'reports/interactions/r2-terminal-scale-4x.png' });
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
        'endpoint',
      ] as const) {
        expect(sample[key] / base[key]).toBeCloseTo(zoom, 1);
      }
    }
  });

  test('R1_SOFT_WIRE_ASSIST + FREE_EXIT + ALT_DISABLE + CLICK_CLICK_CONNECT', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openEditor(page);
    const source = wireTerminal(page, 'led', 'cathode');
    const target = wireTerminal(page, 'battery', 'BAT+');
    const sourcePoint = await locatorCenter(source);

    await page.mouse.click(sourcePoint.x, sourcePoint.y);
    const preview = page.locator('.workbench-wire-preview');
    const guide = page.getByTestId('wire-alignment-guide');
    await expect(preview).toHaveCount(1);

    const enter = { x: sourcePoint.x + 120, y: sourcePoint.y + 5 };
    await page.mouse.move(enter.x, enter.y);
    await frames(page);
    await expect(guide).toBeVisible();
    let previewEnd = await pathScreenPoint(preview);
    expect(previewEnd.x).toBeCloseTo(enter.x, 0);
    expect(previewEnd.y).toBeCloseTo(sourcePoint.y, 0);
    await page.screenshot({ path: 'reports/interactions/r1-soft-wire-guide.png' });

    const hysteresis = { x: sourcePoint.x + 120, y: sourcePoint.y + 9 };
    await page.mouse.move(hysteresis.x, hysteresis.y);
    await frames(page);
    await expect(guide).toBeVisible();
    previewEnd = await pathScreenPoint(preview);
    expect(previewEnd.y).toBeCloseTo(sourcePoint.y, 0);

    const exit = { x: sourcePoint.x + 120, y: sourcePoint.y + 12 };
    await page.mouse.move(exit.x, exit.y);
    await frames(page);
    await expect(guide).toHaveCount(0);
    previewEnd = await pathScreenPoint(preview);
    expect(previewEnd.x).toBeCloseTo(exit.x, 0);
    expect(previewEnd.y).toBeCloseTo(exit.y, 0);

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

    const targetPoint = await locatorCenter(target);
    await page.mouse.click(targetPoint.x, targetPoint.y);
    await expect(page.getByTestId('schematic-wire')).toHaveCount(1);
    await expect(preview).toHaveCount(0);
    await expect(guide).toHaveCount(0);
    await page.screenshot({ path: 'reports/interactions/r1-click-click-connected.png' });
  });

  test('DRAG_CONNECT + NO_DOUBLE_COMMIT', async ({ page }) => {
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

  test('R2 dense breadboard resolver highlights and records the nearest eligible terminal', async ({
    page,
  }) => {
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
    const targetEndpoint = page.locator(
      '[data-testid="wire-endpoint"][data-wire-endpoint="to"]',
    );
    await expect(targetEndpoint).toBeVisible();
    const endpointPoint = await locatorCenter(targetEndpoint);
    expect(
      Math.hypot(endpointPoint.x - j20Point.x, endpointPoint.y - j20Point.y),
    ).toBeLessThanOrEqual(0.5);
    await page.screenshot({ path: 'reports/interactions/r2-dense-terminal-resolver.png' });
  });

  test('DRAG_RELEASE_EMPTY creates no connection or draft residue', async ({ page }) => {
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

  test('R1 SHIFT_ORTHOGONAL + EXPLICIT_90_MODE keep every saved segment orthogonal', async ({
    page,
  }) => {
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
  });

  test('R4 compact external wire panel keeps primary actions small and removes duplicate 90°', async ({
    page,
  }) => {
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
    const libraryBox = await page.locator('.workbench-library').boundingBox();
    if (!libraryBox) throw new Error('Expected desktop component library');
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(libraryBox.x - 4);

    const firstSwatch = compact.locator('.workbench-wire-swatches button').first();
    await firstSwatch.focus();
    await expect(firstSwatch).toBeFocused();
    const selectedWire = page.getByTestId('schematic-wire');
    const beforeColour = await selectedWire.getAttribute('stroke');
    await compact.locator('.workbench-wire-swatches button:not(.active)').first().click();
    await expect.poll(() => selectedWire.getAttribute('stroke')).not.toBe(beforeColour);

    await compact.locator('.workbench-wire-more > summary').click();
    await expect(compact.getByRole('button', { name: 'Переподключить начало' })).toBeVisible();
    await expect(compact.getByRole('button', { name: 'Переподключить конец' })).toBeVisible();
    await page.screenshot({ path: 'reports/interactions/r4-wire-panel-desktop.png' });
  });

  test('R4 mobile wire panel stays inside the stage with 44px primary targets', async ({ page }) => {
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
    for (const target of await compact.locator('.workbench-wire-compact-actions > button').all()) {
      const targetBox = await target.boundingBox();
      expect(targetBox?.width).toBeGreaterThanOrEqual(44);
      expect(targetBox?.height).toBeGreaterThanOrEqual(44);
    }
    const library = page.locator('.workbench-library');
    const libraryBox = await library.boundingBox();
    if (!libraryBox) throw new Error('Expected mobile component shelf');
    expect(box.y + box.height).toBeLessThanOrEqual(libraryBox.y - 4);
    await page.screenshot({ path: 'reports/interactions/r4-wire-panel-mobile.png' });
  });
});
