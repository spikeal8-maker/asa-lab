import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import type { SchematicDocument } from '../apps/web/src/api';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

const ARTIFACT_DIR = 'e2e/artifacts/electronics-simulation';

let admin: pg.Pool;
let teacher: SeededTeacher;

function circuitDocument(options: {
  readonly switchClosed: boolean;
  readonly resistorOhms: number;
  readonly reversedLed: boolean;
  readonly running?: boolean;
}): SchematicDocument {
  const ledInput = options.reversedLed ? 'cathode' : 'anode';
  const ledReturn = options.reversedLed ? 'anode' : 'cathode';
  return {
    schemaVersion: 3,
    components: [
      {
        id: 'source',
        kind: 'source',
        componentTypeId: 'battery-holder-aa-2',
        variantId: 'battery-holder-aa-2',
        name: 'Источник 3 В',
        position: { x: 70, y: 110 },
        rotation: 0,
        value: 3,
        pinIds: ['BAT-', 'BAT+'],
        stateProperties: { cells: 2 },
      },
      {
        id: 'board',
        kind: 'breadboard',
        componentTypeId: 'breadboard-medium',
        variantId: 'breadboard-medium',
        name: 'Макетная плата',
        position: { x: 260, y: 380 },
        rotation: 0,
        value: 0,
        pinIds: ['J1', 'I1'],
        internalConnections: [['J1', 'I1']],
        stateProperties: {},
      },
      {
        id: 'switch',
        kind: 'switch',
        componentTypeId: 'switch-spdt',
        variantId: 'switch-spdt',
        name: 'SW1',
        position: { x: 390, y: 120 },
        rotation: 0,
        value: 0,
        state: options.switchClosed,
        pinIds: ['throw-left', 'common', 'throw-right'],
        stateProperties: { selectedThrow: options.switchClosed ? 'right' : 'left' },
      },
      {
        id: 'resistor',
        kind: 'resistor',
        componentTypeId: 'resistor-axial',
        variantId: 'resistor-axial',
        name: 'R1',
        position: { x: 610, y: 150 },
        rotation: 90,
        value: options.resistorOhms,
        pinIds: ['lead-1', 'lead-2'],
        stateProperties: { tolerancePercent: 5, resistanceUnit: 'Ом' },
      },
      {
        id: 'led',
        kind: 'led',
        componentTypeId: 'led-5mm',
        variantId: 'led-5mm',
        name: 'LED1',
        position: { x: 790, y: 140 },
        rotation: 0,
        value: 2,
        pinIds: ['anode', 'cathode'],
        stateProperties: { ledColour: 'red', ledBrightness: 0, ledFault: 'none' },
      },
    ],
    connections: [
      {
        id: 'wire-source-board',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: 'board', terminal: 'J1' },
        color: '#e3212b',
        vertices: [{ x: 230, y: 300 }],
      },
      {
        id: 'wire-board-switch',
        from: { componentId: 'board', terminal: 'I1' },
        to: { componentId: 'switch', terminal: 'common' },
        color: '#e3212b',
        vertices: [{ x: 430, y: 320 }],
      },
      {
        id: 'wire-switch-resistor',
        from: { componentId: 'switch', terminal: 'throw-right' },
        to: { componentId: 'resistor', terminal: 'lead-1' },
        color: '#149447',
        vertices: [],
      },
      {
        id: 'wire-resistor-led',
        from: { componentId: 'resistor', terminal: 'lead-2' },
        to: { componentId: 'led', terminal: ledInput },
        color: '#149447',
        vertices: [],
      },
      {
        id: 'wire-led-source',
        from: { componentId: 'led', terminal: ledReturn },
        to: { componentId: 'source', terminal: 'BAT-' },
        color: '#2a3035',
        vertices: [
          { x: 820, y: 330 },
          { x: 160, y: 330 },
        ],
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: options.running ?? false, maxIterations: 24 },
  };
}

function breadboardDocument(): SchematicDocument {
  const seeded = circuitDocument({
    switchClosed: false,
    resistorOhms: 220,
    reversedLed: false,
  });
  return {
    ...seeded,
    components: seeded.components.filter((component) => component.id === 'board'),
    connections: [],
  };
}

async function createProject(page: Page, title: string): Promise<string> {
  const response = await page.context().request.post('/api/projects', {
    headers: {
      origin: new URL(page.url()).origin,
      'idempotency-key': `electronics-simulation-${crypto.randomUUID()}`,
    },
    data: {
      scope: 'personal',
      classroomId: null,
      module: 'electronics',
      title,
    },
  });
  expect(response.status()).toBe(201);
  const payload = (await response.json()) as { project: { id: string } };
  return payload.project.id;
}

async function saveDocument(
  page: Page,
  projectId: string,
  document: SchematicDocument,
): Promise<void> {
  const response = await page.context().request.put(`/api/projects/${projectId}/draft`, {
    headers: { origin: new URL(page.url()).origin },
    data: { document },
  });
  expect(response.status()).toBe(200);
}

async function openProject(page: Page, projectId: string): Promise<void> {
  await page.goto(`/#/home/${projectId}`);
  await expect(page.locator('.workbench-stage')).toBeVisible();
  await expect(page.getByLabel('Название проекта')).toHaveValue('R4-M1 live simulation');
}

function component(page: Page, componentTypeId: string) {
  return page.locator(
    `[data-testid="schematic-component"][data-component-type="${componentTypeId}"]`,
  );
}

function calculatedBrightness(page: Page) {
  return page
    .locator('.workbench-calculated-property')
    .filter({ hasText: 'Расчётная яркость' })
    .locator('output');
}

async function brightnessValue(page: Page): Promise<number> {
  const text = (await calculatedBrightness(page).textContent()) ?? '';
  return Number(text.replace(/[^0-9.-]/g, ''));
}

async function selectLed(page: Page): Promise<void> {
  await component(page, 'led-5mm').locator('.workbench-part').click();
  await expect(calculatedBrightness(page)).toBeVisible();
}

async function holeCenter(page: Page, holeId: string): Promise<{ x: number; y: number }> {
  const box = await page
    .locator(`[data-hole-id="${holeId}"] .workbench-breadboard-hole-hit`)
    .boundingBox();
  if (!box) throw new Error(`breadboard hole ${holeId} is not rendered`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragCatalogComponent(
  page: Page,
  name: string,
  target: { x: number; y: number },
): Promise<void> {
  const card = page.getByRole('button', { name, exact: true });
  const box = await card.boundingBox();
  if (!box) throw new Error(`catalog card ${name} is not rendered`);
  const before = await page.locator('[data-testid="schematic-component"]').count();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 4, start.y, { steps: 2 });
  await expect(page.locator('.workbench-picked-up')).toHaveCount(1);
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await expect(page.locator('.workbench-picked-up')).toHaveCount(0);
  await expect(page.getByTestId('catalog-placement-preview')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.workbench-picked-up')).toHaveCount(0);
  await expect(page.getByTestId('catalog-placement-preview')).toHaveCount(0);
  await expect(page.locator('[data-testid="schematic-component"]')).toHaveCount(before + 1);
}

test.beforeAll(async () => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'e2e-electronics-r4-m1-live');
});

test.afterAll(async () => {
  await admin.end();
});

test('catalog placement is one hold-drag-release gesture and snaps on the first drop', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);
  const projectId = await createProject(page, 'R4-M1 catalog drag and first snap');
  await saveDocument(page, projectId, breadboardDocument());
  await page.goto(`/#/home/${projectId}`);
  await expect(page.locator('.workbench-stage')).toBeVisible();

  const j8 = await holeCenter(page, 'J8');
  const j9 = await holeCenter(page, 'J9');
  const pitch = j9.x - j8.x;
  await dragCatalogComponent(page, 'Потенциометр', {
    x: j8.x + pitch,
    y: j8.y - (pitch * 6.858) / 2.54,
  });
  const potentiometer = component(page, 'potentiometer');
  await expect(potentiometer).toHaveAttribute('data-hole-bindings', '3');
  await expect(potentiometer).toHaveAttribute(
    'data-hole-ids',
    /terminal-1:J8,terminal-2:J10,wiper:J9/,
  );

  const j20 = await holeCenter(page, 'J20');
  await dragCatalogComponent(page, 'Батарейный отсек AA', {
    x: j20.x + (pitch * 1.2721) / 2.54,
    y: j20.y + (pitch * 28.9396) / 2.54,
  });
  const battery = component(page, 'battery-holder-aa-2');
  await expect(battery).toHaveAttribute('data-hole-bindings', '2');
  await expect(battery).toHaveAttribute('data-hole-ids', /BAT-:J20,BAT\+:J21/);
  const batteryPosition = {
    x: await battery.getAttribute('data-x'),
    y: await battery.getAttribute('data-y'),
  };
  const negativeLead = page.locator('[data-mounted-terminal="BAT-"]');
  const leadBefore = {
    x: await negativeLead.getAttribute('x2'),
    y: await negativeLead.getAttribute('y2'),
  };

  const boardPart = component(page, 'breadboard-medium').locator('.workbench-part');
  const boardBox = await boardPart.boundingBox();
  if (!boardBox) throw new Error('breadboard is not rendered');
  await page.mouse.move(boardBox.x + boardBox.width / 2, boardBox.y + boardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    boardBox.x + boardBox.width / 2 + 60,
    boardBox.y + boardBox.height / 2 + 30,
    {
      steps: 10,
    },
  );
  await page.mouse.up();
  await expect(battery).toHaveAttribute('data-x', batteryPosition.x ?? '');
  await expect(battery).toHaveAttribute('data-y', batteryPosition.y ?? '');
  await expect
    .poll(async () => ({
      x: await negativeLead.getAttribute('x2'),
      y: await negativeLead.getAttribute('y2'),
    }))
    .not.toEqual(leadBefore);
  failures.assertEmpty();
});

test('real editor recalculates SPDT, resistor and LED without waiting for persistence', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  const projectId = await createProject(page, 'R4-M1 live simulation');
  await openProject(page, projectId);
  await expect(page.getByText('Рабочее поле пустое')).toBeVisible();
  await page.screenshot({ path: `${ARTIFACT_DIR}/electronics-empty.png`, fullPage: true });

  await saveDocument(
    page,
    projectId,
    circuitDocument({ switchClosed: false, resistorOhms: 220, reversedLed: false }),
  );
  await page.reload();

  const led = component(page, 'led-5mm');
  const switchComponent = component(page, 'switch-spdt');
  const resistor = component(page, 'resistor-axial');
  await expect(component(page, 'breadboard-medium')).toBeVisible();
  await expect(page.locator('[data-testid="schematic-wire"]')).toHaveCount(5);
  await page.screenshot({ path: `${ARTIFACT_DIR}/electronics-wired.png`, fullPage: true });

  const sourcePositive = component(page, 'battery-holder-aa-2').locator(
    '.workbench-terminal-hit[data-terminal-id="BAT+"]',
  );
  await sourcePositive.click();
  const previewWire = page.locator('.workbench-wire-preview');
  const stageBox = await page.locator('svg.workbench-canvas').boundingBox();
  if (!stageBox) throw new Error('workbench canvas has no visual bounding box');
  await page.mouse.move(stageBox.x + stageBox.width * 0.46, stageBox.y + stageBox.height * 0.38);
  await expect(previewWire).toBeVisible();
  const initialPreviewPath = await previewWire.getAttribute('d');
  await page.mouse.move(stageBox.x + stageBox.width * 0.52, stageBox.y + stageBox.height * 0.42);
  await expect.poll(() => previewWire.getAttribute('d')).not.toBe(initialPreviewPath);
  await page.keyboard.press('Escape');
  await expect(previewWire).toHaveCount(0);

  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await expect(page.getByRole('button', { name: 'Остановить моделирование' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Остановить моделирование' })).toHaveAttribute(
    'data-simulation-status',
    'running',
  );

  await selectLed(page);
  await expect(calculatedBrightness(page)).toHaveText('0%');
  await expect(
    page.locator('.workbench-measurements div').filter({ hasText: 'Состояние' }).locator('dd'),
  ).toHaveText('Не горит');
  await expect(led.locator('image:not([filter])')).toHaveAttribute('href', /led_red_i000\.svg$/);
  await switchComponent.locator('.workbench-part').click();
  await expect(switchComponent).toHaveClass(/workbench-component-actuator-active/);
  await selectLed(page);
  await expect.poll(() => brightnessValue(page)).toBeGreaterThan(0);
  const brightAt220Ohms = await brightnessValue(page);
  await expect(
    page.locator('.workbench-measurements div').filter({ hasText: 'Состояние' }).locator('dd'),
  ).toHaveText('Горит');
  await expect(led.locator('image:not([filter])')).not.toHaveAttribute(
    'href',
    /led_red_i000\.svg$/,
  );
  await page.screenshot({ path: `${ARTIFACT_DIR}/electronics-running.png`, fullPage: true });

  await resistor.locator('.workbench-part').click();
  const resistanceInput = page
    .locator('.workbench-inspector label')
    .filter({ hasText: 'Сопротивление' })
    .locator('input[type="number"]');
  await resistanceInput.fill('1000');
  await selectLed(page);
  await expect.poll(() => brightnessValue(page)).toBeLessThan(brightAt220Ohms);
  await expect.poll(() => brightnessValue(page)).toBeGreaterThan(0);
  const brightAt1000Ohms = await brightnessValue(page);
  expect(brightAt1000Ohms).toBeLessThan(brightAt220Ohms);
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-resistance-changed.png`,
    fullPage: true,
  });

  await expect(page.locator('.workbench-save-state')).toContainText('Все изменения сохранены', {
    timeout: 15_000,
  });
  const checkpoint = await page.context().request.post(`/api/projects/${projectId}/checkpoints`, {
    headers: { origin: new URL(page.url()).origin },
    data: { label: 'Electronics M1 release candidate' },
  });
  expect(checkpoint.status()).toBe(201);
  expect((await checkpoint.json()) as { version: { versionNo: number } }).toMatchObject({
    version: { versionNo: 1 },
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Остановить моделирование' })).toBeVisible();
  await expect(switchComponent).toHaveClass(/workbench-component-actuator-active/);
  await selectLed(page);
  await expect.poll(() => brightnessValue(page)).toBe(brightAt1000Ohms);
  await page.screenshot({ path: `${ARTIFACT_DIR}/electronics-reload.png`, fullPage: true });

  await page.getByRole('button', { name: 'Остановить моделирование' }).click();
  await expect(page.getByRole('button', { name: 'Начать моделирование' })).toBeVisible();
  await saveDocument(
    page,
    projectId,
    circuitDocument({ switchClosed: true, resistorOhms: 1000, reversedLed: true }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await expect(page.getByRole('button', { name: 'Остановить моделирование' })).toBeVisible();
  await selectLed(page);
  await expect(calculatedBrightness(page)).toHaveText('0%');
  await expect(led).toHaveAttribute('data-diagnostics', /reverse_polarity/);
  await expect(led.locator('image:not([filter])')).toHaveAttribute(
    'href',
    /special\/led_red_reverse_polarity\.svg$/,
  );
  await expect(led.locator('[data-testid="led-diagnostic-badge"]')).toBeVisible();
  await expect(led.locator('[data-testid="led-burnout-explosion"]')).toHaveCount(0);
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-reverse-polarity.png`,
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Остановить моделирование' }).click();
  await saveDocument(
    page,
    projectId,
    circuitDocument({ switchClosed: true, resistorOhms: 20, reversedLed: false }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await selectLed(page);
  await expect(led).toHaveAttribute('data-diagnostics', /led_burnout/);
  await expect(led.locator('image:not([filter])')).toHaveAttribute(
    'href',
    /special\/led_red_burned\.svg$/,
  );
  await expect(page.locator('.workbench-inspector')).toContainText('Светодиод перегорел');
  await expect(led.locator('[data-testid="led-diagnostic-badge"]')).toBeVisible();
  await expect(led.locator('[data-testid="led-burnout-explosion"]')).toHaveCount(0);
  expect(failures.counts).toMatchObject({
    consoleErrors: 0,
    pageErrors: 0,
    failedRequests: 0,
    httpServerErrors: 0,
  });
  failures.assertEmpty();
});
