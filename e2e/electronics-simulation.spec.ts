import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import type { SchematicDocument } from '../apps/web/src/api';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

const ARTIFACT_DIR = 'e2e/artifacts/electronics-simulation';

let admin: pg.Pool;
let teacher: SeededTeacher;

interface OwnerCatalogFixture {
  readonly components: ReadonlyArray<{
    readonly componentId: string;
    readonly pins: ReadonlyArray<{ readonly id: string }>;
  }>;
}

const ownerCatalog = JSON.parse(
  readFileSync(
    resolve(process.cwd(), 'apps/web/public/assets/electronics/owner-catalog/manifest.json'),
    'utf8',
  ),
) as OwnerCatalogFixture;
const breadboardPinIds = ownerCatalog.components
  .find((component) => component.componentId === 'breadboard-medium')
  ?.pins.map((pin) => pin.id);

if (!breadboardPinIds) throw new Error('breadboard-medium owner manifest entry is missing');

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

function buttonCircuitDocument(resistorOhms: number): SchematicDocument {
  const seeded = circuitDocument({
    switchClosed: false,
    resistorOhms,
    reversedLed: false,
  });
  return {
    ...seeded,
    components: seeded.components.map((item) =>
      item.id === 'switch'
        ? {
            ...item,
            id: 'button',
            kind: 'button' as const,
            componentTypeId: 'button-tactile-6mm',
            variantId: 'button-tactile-6mm',
            name: 'S1',
            state: false,
            pinIds: ['SW-A1', 'SW-A2', 'SW-B1', 'SW-B2'],
            internalConnections: [
              ['SW-A1', 'SW-A2'],
              ['SW-B1', 'SW-B2'],
            ],
            stateProperties: {},
          }
        : item,
    ),
    connections: seeded.connections.map((wire) =>
      wire.id === 'wire-board-switch'
        ? {
            ...wire,
            to: { componentId: 'button', terminal: 'SW-A2' },
          }
        : wire.id === 'wire-switch-resistor'
          ? {
              ...wire,
              from: { componentId: 'button', terminal: 'SW-B2' },
            }
          : wire,
    ),
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
    components: seeded.components
      .filter((component) => component.id === 'board')
      .map((component) => ({ ...component, pinIds: breadboardPinIds })),
    connections: [],
  };
}

function shortCircuitDocument(): SchematicDocument {
  const source = circuitDocument({
    switchClosed: true,
    resistorOhms: 220,
    reversedLed: false,
  }).components.find((component) => component.id === 'source');
  if (!source) throw new Error('source fixture is missing');
  return {
    schemaVersion: 3,
    components: [source],
    connections: [
      {
        id: 'wire-direct-short',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: 'source', terminal: 'BAT-' },
        color: '#e3212b',
        vertices: [],
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function directLedWithLoosePartsDocument(): SchematicDocument {
  const seeded = circuitDocument({
    switchClosed: true,
    resistorOhms: 166,
    reversedLed: false,
  });
  const source = seeded.components.find((component) => component.id === 'source');
  const board = seeded.components.find((component) => component.id === 'board');
  const resistor = seeded.components.find((component) => component.id === 'resistor');
  const led = seeded.components.find((component) => component.id === 'led');
  if (!source || !board || !resistor || !led) throw new Error('direct LED fixture is incomplete');

  return {
    ...seeded,
    components: [
      board,
      {
        ...source,
        id: 'open-source',
        name: 'Неподключённый источник',
        position: { x: 80, y: 500 },
      },
      source,
      resistor,
      led,
      { ...led, id: 'unused-led', name: 'Свободный LED', position: { x: 980, y: 360 } },
      {
        id: 'unused-potentiometer',
        kind: 'potentiometer',
        componentTypeId: 'potentiometer',
        variantId: 'potentiometer',
        name: 'Свободный потенциометр',
        position: { x: 1_050, y: 480 },
        rotation: 0,
        value: 1_000,
        pinIds: ['terminal-1', 'terminal-2', 'wiper'],
        stateProperties: {},
      },
      {
        id: 'unused-transistor',
        kind: 'transistor',
        componentTypeId: 'transistor-npn',
        variantId: 'transistor-npn',
        name: 'Свободный NPN',
        position: { x: 1_150, y: 480 },
        rotation: 0,
        value: 100,
        pinIds: ['base', 'collector', 'emitter'],
        stateProperties: {
          currentGain: 100,
          saturationVoltage: 0.2,
          baseEmitterVoltage: 0.7,
          maxCollectorCurrent: 0.2,
        },
      },
      {
        id: 'unused-rgb-led',
        kind: 'rgb-led',
        componentTypeId: 'rgb-led',
        variantId: 'rgb-led',
        name: 'Свободный RGB LED',
        position: { x: 1_250, y: 480 },
        rotation: 0,
        value: 0,
        pinIds: ['red', 'common', 'green', 'blue'],
        stateProperties: { commonMode: 'common-cathode' },
      },
    ],
    connections: [
      {
        id: 'wire-open-source',
        from: { componentId: 'board', terminal: 'J1' },
        to: { componentId: 'open-source', terminal: 'BAT+' },
        color: '#149447',
        vertices: [],
      },
      {
        id: 'wire-positive',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: 'resistor', terminal: 'lead-1' },
        color: '#e3212b',
        vertices: [],
      },
      {
        id: 'wire-limited',
        from: { componentId: 'resistor', terminal: 'lead-2' },
        to: { componentId: 'led', terminal: 'anode' },
        color: '#e3212b',
        vertices: [],
      },
      {
        id: 'wire-negative',
        from: { componentId: 'led', terminal: 'cathode' },
        to: { componentId: 'source', terminal: 'BAT-' },
        color: '#149447',
        vertices: [],
      },
    ],
  };
}

function rgbLedDocument(commonMode: 'common-cathode' | 'common-anode'): SchematicDocument {
  const commonCathode = commonMode === 'common-cathode';
  const channels = ['red', 'green', 'blue'] as const;
  return {
    schemaVersion: 3,
    components: [
      {
        id: 'source',
        kind: 'source',
        componentTypeId: 'battery-holder-aa-4',
        variantId: 'battery-holder-aa-4',
        name: 'Источник 6 В',
        position: { x: 100, y: 260 },
        rotation: 0,
        value: 6,
        pinIds: ['BAT-', 'BAT+'],
        stateProperties: { cells: 4 },
      },
      ...channels.map((channel, index) => ({
        id: `resistor-${channel}`,
        kind: 'resistor' as const,
        componentTypeId: 'resistor-axial',
        variantId: 'resistor-axial',
        name: `R ${channel.toUpperCase()}`,
        position: { x: 430 + index * 120, y: 390 },
        rotation: 0,
        value: 220,
        pinIds: ['lead-1', 'lead-2'],
        stateProperties: { tolerancePercent: 5, resistanceUnit: 'Ом' },
      })),
      {
        id: 'rgb',
        kind: 'rgb-led',
        componentTypeId: 'rgb-led',
        variantId: 'rgb-led',
        name: 'RGB LED',
        position: { x: 560, y: 160 },
        rotation: 0,
        value: 0,
        pinIds: ['red', 'common', 'green', 'blue'],
        stateProperties: { commonMode },
      },
    ],
    connections: commonCathode
      ? [
          ...channels.flatMap((channel) => [
            {
              id: `positive-${channel}`,
              from: { componentId: 'source', terminal: 'BAT+' },
              to: { componentId: `resistor-${channel}`, terminal: 'lead-1' },
              color: '#e3212b',
              vertices: [],
            },
            {
              id: `channel-${channel}`,
              from: { componentId: `resistor-${channel}`, terminal: 'lead-2' },
              to: { componentId: 'rgb', terminal: channel },
              color: channel === 'red' ? '#e3212b' : channel === 'green' ? '#149447' : '#2868d7',
              vertices: [],
            },
          ]),
          {
            id: 'common-return',
            from: { componentId: 'rgb', terminal: 'common' },
            to: { componentId: 'source', terminal: 'BAT-' },
            color: '#2a3035',
            vertices: [],
          },
        ]
      : [
          {
            id: 'common-positive',
            from: { componentId: 'source', terminal: 'BAT+' },
            to: { componentId: 'rgb', terminal: 'common' },
            color: '#e3212b',
            vertices: [],
          },
          ...channels.flatMap((channel) => [
            {
              id: `channel-${channel}`,
              from: { componentId: 'rgb', terminal: channel },
              to: { componentId: `resistor-${channel}`, terminal: 'lead-1' },
              color: channel === 'red' ? '#e3212b' : channel === 'green' ? '#149447' : '#2868d7',
              vertices: [],
            },
            {
              id: `return-${channel}`,
              from: { componentId: `resistor-${channel}`, terminal: 'lead-2' },
              to: { componentId: 'source', terminal: 'BAT-' },
              color: '#2a3035',
              vertices: [],
            },
          ]),
        ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function ownerRedBlueRgbDocument(): SchematicDocument {
  const seeded = rgbLedDocument('common-cathode');
  return {
    ...seeded,
    components: seeded.components
      .filter((item) => ['source', 'resistor-red', 'rgb'].includes(item.id))
      .map((item) =>
        item.id === 'source'
          ? {
              ...item,
              componentTypeId: 'battery-holder-aa-2',
              variantId: 'battery-holder-aa-2',
              name: 'Источник 3 В',
              value: 3,
              stateProperties: { cells: 2 },
            }
          : item.id === 'rgb'
            ? {
                ...item,
                stateProperties: { commonMode: 'common-cathode', pinLayout: 'RCBG' },
              }
            : item,
      ),
    connections: [
      ...seeded.connections.filter((wire) =>
        ['positive-red', 'channel-red', 'common-return'].includes(wire.id),
      ),
      {
        id: 'direct-blue',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: 'rgb', terminal: 'blue' },
        color: '#2868d7',
        vertices: [],
      },
    ],
  };
}

function singleChannelRgbLedDocument(options: {
  readonly componentMode: 'common-cathode' | 'common-anode';
  readonly wiringMode: 'common-cathode' | 'common-anode';
  readonly resistorOhms: number | null;
}): SchematicDocument {
  const seeded = rgbLedDocument(options.wiringMode);
  const components = seeded.components
    .filter((item) => ['source', 'resistor-green', 'rgb'].includes(item.id))
    .filter((item) => options.resistorOhms !== null || item.id !== 'resistor-green')
    .map((item) =>
      item.id === 'source'
        ? {
            ...item,
            componentTypeId: 'battery-holder-aa-2',
            variantId: 'battery-holder-aa-2',
            name: 'Источник 3 В',
            value: 3,
            stateProperties: { cells: 2 },
          }
        : item.id === 'resistor-green'
          ? { ...item, value: options.resistorOhms ?? 0 }
          : item.id === 'rgb'
            ? { ...item, stateProperties: { commonMode: options.componentMode } }
            : item,
    );
  const direct = options.resistorOhms === null;
  const connections =
    options.wiringMode === 'common-cathode'
      ? [
          ...(direct
            ? [
                {
                  id: 'direct-green',
                  from: { componentId: 'source', terminal: 'BAT+' },
                  to: { componentId: 'rgb', terminal: 'green' },
                  color: '#149447',
                  vertices: [],
                },
              ]
            : seeded.connections.filter((wire) =>
                ['positive-green', 'channel-green'].includes(wire.id),
              )),
          ...seeded.connections.filter((wire) => wire.id === 'common-return'),
        ]
      : [
          ...seeded.connections.filter((wire) => wire.id === 'common-positive'),
          ...(direct
            ? [
                {
                  id: 'direct-green-return',
                  from: { componentId: 'rgb', terminal: 'green' },
                  to: { componentId: 'source', terminal: 'BAT-' },
                  color: '#149447',
                  vertices: [],
                },
              ]
            : seeded.connections.filter((wire) =>
                ['channel-green', 'return-green'].includes(wire.id),
              )),
        ];
  return { ...seeded, components, connections };
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
  await expect(page.locator('.workbench-stage')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Название проекта')).toHaveValue('R4-M1 live simulation');
}

function component(page: Page, componentTypeId: string) {
  return page.locator(
    `[data-testid="schematic-component"][data-component-type="${componentTypeId}"]`,
  );
}

async function brightnessValue(page: Page): Promise<number> {
  const value = await component(page, 'led-5mm')
    .locator('.workbench-production-visual')
    .getAttribute('data-led-brightness');
  return Number(value ?? '0');
}

async function selectLed(page: Page): Promise<void> {
  await component(page, 'led-5mm').locator('.workbench-part').click();
  await expect(page.getByRole('complementary', { name: 'Параметры выделения' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^Цвет(?: светодиода)?$/ })).toBeVisible();
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

async function unobstructedComponentPoint(
  page: Page,
  componentTypeId: string,
): Promise<{ x: number; y: number }> {
  return page
    .locator(
      `[data-testid="schematic-component"][data-component-type="${componentTypeId}"] .workbench-part`,
    )
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      for (let y = rect.top + 8; y < rect.bottom - 8; y += 12) {
        for (let x = rect.left + 8; x < rect.right - 8; x += 12) {
          const hit = document.elementFromPoint(x, y);
          if (
            hit &&
            element.contains(hit) &&
            !hit.closest('.workbench-terminal-hit, .workbench-breadboard-hole-hit')
          ) {
            return { x, y };
          }
        }
      }
      throw new Error(`no unobstructed point found for ${componentTypeId}`);
    });
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

  const board = component(page, 'breadboard-medium');
  const boardPosition = {
    x: await board.getAttribute('data-x'),
    y: await board.getAttribute('data-y'),
  };
  const boardGrab = await unobstructedComponentPoint(page, 'breadboard-medium');
  await page.mouse.move(boardGrab.x, boardGrab.y);
  await page.mouse.down();
  await page.mouse.move(boardGrab.x + 60, boardGrab.y + 30, { steps: 10 });
  await page.mouse.up();
  await expect(board).not.toHaveAttribute('data-x', boardPosition.x ?? '');
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
  await expect.poll(() => brightnessValue(page)).toBe(0);
  await expect(led.locator('.workbench-production-visual')).toHaveAttribute(
    'data-led-runtime-state',
    'off',
  );
  await expect(led.locator('image:not([filter])')).toHaveAttribute('href', /led_red_i000\.svg$/);
  await switchComponent.getByTestId('spdt-actuator').click();
  await expect(switchComponent).toHaveClass(/workbench-component-actuator-active/);
  const colourBrightness: number[] = [];
  for (const colour of ['red', 'orange', 'yellow', 'green', 'blue', 'white']) {
    await selectLed(page);
    await page.getByRole('combobox', { name: /^Цвет(?: светодиода)?$/ }).selectOption(colour);
    await expect(led.locator('.workbench-production-visual')).toHaveAttribute(
      'data-led-colour',
      colour,
    );
    await expect.poll(() => brightnessValue(page)).toBeGreaterThan(0);
    await expect(led.locator('image:not([filter])')).toHaveAttribute(
      'href',
      new RegExp(`led_${colour}_i(?!000)\\d{3}\\.svg$`),
    );
    colourBrightness.push(await brightnessValue(page));
  }
  for (let index = 1; index < colourBrightness.length; index += 1) {
    expect(colourBrightness[index]).toBeLessThan(colourBrightness[index - 1] ?? 0);
  }
  await page.getByRole('combobox', { name: /^Цвет(?: светодиода)?$/ }).selectOption('red');
  await expect.poll(() => brightnessValue(page)).toBe(colourBrightness[0]);
  const brightAt220Ohms = await brightnessValue(page);
  await expect(led.locator('.workbench-production-visual')).toHaveAttribute(
    'data-led-runtime-state',
    'lit',
  );
  await expect(led.locator('image:not([filter])')).not.toHaveAttribute(
    'href',
    /led_red_i000\.svg$/,
  );
  await page.screenshot({ path: `${ARTIFACT_DIR}/electronics-running.png`, fullPage: true });

  let previousBrightness = brightAt220Ohms;
  let persistedArbitraryBrightness = brightAt220Ohms;
  for (const resistance of [317.25, 683.7, 1_000, 2_475.25]) {
    await resistor.locator('.workbench-part').click();
    const resistanceInput = page
      .locator('.workbench-inspector label')
      .filter({ hasText: 'Сопротивление' })
      .locator('input[type="number"]');
    await resistanceInput.fill(String(resistance));
    await selectLed(page);
    await expect.poll(() => brightnessValue(page)).toBeLessThan(previousBrightness);
    await expect.poll(() => brightnessValue(page)).toBeGreaterThan(0);
    persistedArbitraryBrightness = await brightnessValue(page);
    previousBrightness = persistedArbitraryBrightness;
  }
  await resistor.locator('.workbench-part').click();
  await expect(page.getByRole('combobox', { name: 'Единица сопротивления' })).toHaveValue('Ω');
  await expect(
    page
      .locator('.workbench-inspector label')
      .filter({ hasText: 'Сопротивление' })
      .locator('input[type="number"]'),
  ).toHaveValue('2475.25');
  await selectLed(page);
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-resistance-changed.png`,
    fullPage: true,
  });

  await expect(page.locator('.editor-host-save-state')).toContainText('Все изменения сохранены', {
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
  await expect(page.getByRole('button', { name: 'Начать моделирование' })).toBeVisible();
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await expect(page.getByRole('button', { name: 'Остановить моделирование' })).toBeVisible();
  await expect(switchComponent).toHaveClass(/workbench-component-actuator-active/);
  await selectLed(page);
  await expect.poll(() => brightnessValue(page)).toBe(persistedArbitraryBrightness);
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
  await expect.poll(() => brightnessValue(page)).toBe(0);
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
    circuitDocument({ switchClosed: true, resistorOhms: 0, reversedLed: false }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await selectLed(page);
  await expect(led).toHaveAttribute('data-diagnostics', /led_burnout/);
  await expect(led.locator('image:not([filter])')).toHaveAttribute(
    'href',
    /special\/led_red_burned\.svg$/,
  );
  await expect(led.locator('[data-testid="led-diagnostic-badge"]')).toHaveCount(0);
  await expect(led.locator('[data-testid="led-burnout-explosion"]')).toBeVisible();
  await expect(led.locator('[data-testid="led-burnout-explosion"]')).toHaveAttribute(
    'aria-label',
    /перегорел/i,
  );

  await page.getByRole('button', { name: 'Остановить моделирование' }).click();
  await saveDocument(page, projectId, shortCircuitDocument());
  await page.reload();
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await expect(page.getByRole('button', { name: 'Остановить моделирование' })).toBeVisible();
  await expect(page.getByText(/Время моделирования:/)).toBeVisible();
  const source = page.locator('[data-testid="schematic-component"][data-kind="source"]');
  await expect(source).toHaveAttribute('data-diagnostics', /short_circuit/);
  await expect(source.locator('[data-testid="component-diagnostic-indicator"]')).toBeVisible();
  await expect(page.locator('.workbench-results')).toHaveCount(0);
  await expect(page.locator('.workbench-toast')).toHaveCount(0);
  expect(failures.counts).toMatchObject({
    consoleErrors: 0,
    pageErrors: 0,
    failedRequests: 0,
    httpServerErrors: 0,
  });
  failures.assertEmpty();
});

test('four-pin button is a momentary bridge for an arbitrary decimal LED load', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  const projectId = await createProject(page, 'R4-M1 momentary button arbitrary resistance');
  await saveDocument(page, projectId, buttonCircuitDocument(683.7));
  await page.goto(`/#/home/${projectId}`);
  await expect(page.locator('.workbench-stage')).toBeVisible();
  await page.getByRole('button', { name: 'Начать моделирование' }).click();

  const button = component(page, 'button-tactile-6mm');
  const buttonBody = button.locator('.workbench-part');
  await selectLed(page);
  await expect.poll(() => brightnessValue(page)).toBe(0);

  const buttonBox = await buttonBody.boundingBox();
  if (!buttonBox) throw new Error('button actuator has no visual bounding box');
  await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
  await page.mouse.down();
  await expect(button).toHaveClass(/workbench-component-actuator-active/);
  await expect.poll(() => brightnessValue(page)).toBeGreaterThan(0);

  await page.mouse.up();
  await expect(button).not.toHaveClass(/workbench-component-actuator-active/);
  await selectLed(page);
  await expect.poll(() => brightnessValue(page)).toBe(0);
  failures.assertEmpty();
});

test('a direct 3 V / 166 ohm LED branch stays lit beside loose editor parts', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  const projectId = await createProject(page, 'R4-M1 direct 166 ohm LED regression');
  await saveDocument(page, projectId, directLedWithLoosePartsDocument());
  await page.goto(`/#/home/${projectId}`);
  await expect(page.locator('.workbench-stage')).toBeVisible();
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await expect(page.getByRole('button', { name: 'Остановить моделирование' })).toBeVisible();

  const workingLed = component(page, 'led-5mm').first();
  await expect(workingLed.locator('.workbench-production-visual')).toHaveAttribute(
    'data-led-runtime-state',
    'lit',
  );
  await expect
    .poll(async () =>
      Number(
        (await workingLed
          .locator('.workbench-production-visual')
          .getAttribute('data-led-brightness')) ?? '0',
      ),
    )
    .toBeGreaterThan(40);
  await expect(workingLed).not.toHaveAttribute('data-diagnostics', /numerical_instability/);
  await expect(workingLed.locator('image:not([filter])')).not.toHaveAttribute(
    'href',
    /led_red_i000\.svg$/,
  );
  await page.screenshot({ path: `${ARTIFACT_DIR}/electronics-direct-led-166.png`, fullPage: true });
  failures.assertEmpty();
});

test('RGB LED mixes three calculated channels for both common modes', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  for (const commonMode of ['common-cathode', 'common-anode'] as const) {
    const projectId = await createProject(page, `R4-M1 RGB LED ${commonMode}`);
    await saveDocument(page, projectId, rgbLedDocument(commonMode));
    await page.goto(`/#/home/${projectId}`);
    await expect(page.locator('.workbench-stage')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Начать моделирование' }).click();

    const rgb = component(page, 'rgb-led');
    const visual = rgb.locator('.workbench-production-visual');
    await expect(visual).toHaveAttribute('data-rgb-runtime-state', 'lit');
    for (const channel of ['red', 'green', 'blue'] as const) {
      await expect
        .poll(async () => Number((await visual.getAttribute(`data-rgb-${channel}`)) ?? '0'))
        .toBeGreaterThan(0);
    }
    await expect(visual).not.toHaveAttribute('data-rgb-colour', 'rgb(0, 0, 0)');
    await expect(rgb.getByTestId('rgb-led-mixture')).toHaveCSS('opacity', /^(?!0(?:\.0+)?$)/);
    await rgb.locator('.workbench-part').click();
    const inspector = page.getByRole('complementary', { name: 'Параметры выделения' });
    await expect(inspector.getByLabel('Разводка выводов RGB-светодиода')).toHaveValue('RCBG');
    await expect(inspector.locator('.workbench-calculated-property')).toHaveCount(0);
    await expect(inspector.locator('.workbench-terminal-list')).toHaveCount(0);

    if (commonMode === 'common-cathode') {
      await page.screenshot({
        path: `${ARTIFACT_DIR}/electronics-rgb-mixed-common-cathode.png`,
        fullPage: true,
      });
    }
  }
  failures.assertEmpty();
});

test('RGB LED visibly mixes the saved 3 V red and blue owner wiring', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  const projectId = await createProject(page, 'R4-M1 RGB red blue 3 V regression');
  await saveDocument(page, projectId, ownerRedBlueRgbDocument());
  await page.goto(`/#/home/${projectId}`);
  await expect(page.locator('.workbench-stage')).toBeVisible();
  await page.getByRole('button', { name: 'Начать моделирование' }).click();

  const rgb = component(page, 'rgb-led');
  const visual = rgb.locator('.workbench-production-visual');
  await expect(visual).toHaveAttribute('data-rgb-runtime-state', 'lit');
  const red = Number((await visual.getAttribute('data-rgb-red')) ?? '0');
  const green = Number((await visual.getAttribute('data-rgb-green')) ?? '0');
  const blue = Number((await visual.getAttribute('data-rgb-blue')) ?? '0');
  expect(red).toBeGreaterThan(0);
  expect(green).toBe(0);
  expect(blue).toBeGreaterThan(red);
  await expect(visual).not.toHaveAttribute('data-rgb-colour', /^rgb\((?:0, 0, 0|255, 0, 0)\)$/);
  await expect(rgb.getByTestId('rgb-led-mixture')).toHaveCSS('opacity', /^(?!0(?:\.0+)?$)/);
  await expect(rgb.getByTestId('rgb-led-burnout-explosion')).toHaveCount(0);
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-rgb-red-blue-3v.png`,
    fullPage: true,
  });
  failures.assertEmpty();
});

test('RGB LED mirrors ordinary LED lit, reverse-polarity and burnout states', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  const scenarios = [
    {
      name: 'single-green',
      document: singleChannelRgbLedDocument({
        componentMode: 'common-cathode',
        wiringMode: 'common-cathode',
        resistorOhms: 220,
      }),
      runtimeState: 'lit',
      diagnostic: null,
    },
    {
      name: 'owner-reversed-common',
      document: singleChannelRgbLedDocument({
        componentMode: 'common-cathode',
        wiringMode: 'common-anode',
        resistorOhms: null,
      }),
      runtimeState: 'off',
      diagnostic: 'reverse_polarity',
    },
    {
      name: 'direct-overload',
      document: singleChannelRgbLedDocument({
        componentMode: 'common-anode',
        wiringMode: 'common-anode',
        resistorOhms: null,
      }),
      runtimeState: 'burned',
      diagnostic: 'led_burnout',
    },
  ] as const;

  for (const scenario of scenarios) {
    const projectId = await createProject(page, `R4-M1 RGB ${scenario.name}`);
    await saveDocument(page, projectId, scenario.document);
    await page.goto(`/#/home/${projectId}`);
    await expect(page.locator('.workbench-stage')).toBeVisible();
    await page.getByRole('button', { name: 'Начать моделирование' }).click();

    const rgb = component(page, 'rgb-led');
    const visual = rgb.locator('.workbench-production-visual');
    await expect(visual).toHaveAttribute('data-rgb-runtime-state', scenario.runtimeState);
    if (scenario.runtimeState === 'lit') {
      await expect(visual).toHaveAttribute('data-rgb-red', '0');
      await expect
        .poll(async () => Number((await visual.getAttribute('data-rgb-green')) ?? '0'))
        .toBeGreaterThan(0);
      await expect(visual).toHaveAttribute('data-rgb-blue', '0');
      await expect(rgb.getByTestId('rgb-led-mixture')).toHaveCSS('opacity', /^(?!0(?:\.0+)?$)/);
    } else {
      await expect(rgb).toHaveAttribute('data-diagnostics', new RegExp(scenario.diagnostic ?? ''));
      await expect(rgb.getByTestId('rgb-led-mixture')).toHaveCSS('opacity', '0');
    }
    if (scenario.diagnostic === 'reverse_polarity') {
      await expect(rgb.getByTestId('led-diagnostic-badge')).toHaveCount(0);
      await expect(rgb.getByTestId('rgb-led-burnout-explosion')).toHaveCount(0);
    }
    if (scenario.runtimeState === 'burned') {
      await expect(rgb.getByTestId('rgb-led-burnout-explosion')).toBeVisible();
      await expect(rgb.getByTestId('rgb-led-burnout-explosion')).toHaveAttribute(
        'aria-label',
        /перегорел/i,
      );
    }
  }
  failures.assertEmpty();
});
