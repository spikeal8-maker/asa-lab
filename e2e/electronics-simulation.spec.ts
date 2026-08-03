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

async function createProject(page: Page, title: string): Promise<string> {
  const response = await page.request.post('/api/projects', {
    headers: { 'idempotency-key': `electronics-simulation-${crypto.randomUUID()}` },
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
  const response = await page.request.put(`/api/projects/${projectId}/draft`, {
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

test.beforeAll(async () => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'e2e-electronics-r4-m1-live');
});

test.afterAll(async () => {
  await admin.end();
});

test('real editor recalculates SPDT, resistor and LED without waiting for persistence', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  const projectId = await createProject(page, 'R4-M1 live simulation');
  await saveDocument(
    page,
    projectId,
    circuitDocument({ switchClosed: false, resistorOhms: 220, reversedLed: false }),
  );
  await openProject(page, projectId);

  const led = component(page, 'led-5mm');
  const switchComponent = component(page, 'switch-spdt');
  const resistor = component(page, 'resistor-axial');
  await expect(component(page, 'breadboard-medium')).toBeVisible();
  await expect(page.locator('[data-testid="schematic-wire"]')).toHaveCount(5);

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
  await expect(led.locator('image')).toHaveAttribute('href', /led_red_i000\.svg$/);
  await page.screenshot({ path: `${ARTIFACT_DIR}/01-open-switch-led-off.png`, fullPage: true });

  await switchComponent.locator('.workbench-part').click();
  await expect(switchComponent).toHaveClass(/workbench-component-actuator-active/);
  await selectLed(page);
  await expect.poll(() => brightnessValue(page)).toBeGreaterThan(0);
  const brightAt220Ohms = await brightnessValue(page);
  await expect(
    page.locator('.workbench-measurements div').filter({ hasText: 'Состояние' }).locator('dd'),
  ).toHaveText('Горит');
  await expect(led.locator('image')).not.toHaveAttribute('href', /led_red_i000\.svg$/);
  await page.screenshot({ path: `${ARTIFACT_DIR}/02-closed-switch-led-lit.png`, fullPage: true });

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

  await expect(page.locator('.workbench-save-state')).toContainText('Все изменения сохранены', {
    timeout: 15_000,
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Остановить моделирование' })).toBeVisible();
  await expect(switchComponent).toHaveClass(/workbench-component-actuator-active/);
  await selectLed(page);
  await expect.poll(() => brightnessValue(page)).toBe(brightAt1000Ohms);
  await page.screenshot({ path: `${ARTIFACT_DIR}/03-reload-preserves-result.png`, fullPage: true });

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
  await expect(led.locator('image')).toHaveAttribute(
    'href',
    /special\/led_red_reverse_polarity\.svg$/,
  );
  await page.screenshot({ path: `${ARTIFACT_DIR}/04-reverse-polarity.png`, fullPage: true });

  expect(failures.counts).toMatchObject({
    consoleErrors: 0,
    pageErrors: 0,
    failedRequests: 0,
    httpServerErrors: 0,
  });
  failures.assertEmpty();
});
