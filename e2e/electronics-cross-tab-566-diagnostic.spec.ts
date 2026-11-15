import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { ElectronicsDocument } from '../contexts/electronics/domain/document';
import { e2eAdminPool, seedTeacher } from './seed';
import { loginWithOrganization } from './organization-login';

type Draft = { revision: number; document: ElectronicsDocument };
type Writer = {
  key: string;
  raw: string;
  acknowledgement: string | null;
  draft: { baseRevision: number; baseDocument: ElectronicsDocument; document: ElectronicsDocument };
};

const originalSketch = '// Original\nvoid setup() {}\nvoid loop() {}';
const sketchA = '// Saved from tab A\nvoid setup() {}\nvoid loop() { delay(111); }';
const sketchB = '// Unsaved from tab B\nvoid setup() {}\nvoid loop() { delay(222); }';
const catalog = JSON.parse(
  readFileSync('apps/web/public/assets/electronics/component-database/catalog.json', 'utf8'),
) as { components: { componentId: string; pins: { id: string }[] }[] };

function circuit(): ElectronicsDocument {
  return {
    schemaVersion: 4,
    components: [
      {
        id: 'uno',
        kind: 'visual',
        componentTypeId: 'arduino-uno',
        variantId: 'arduino-uno',
        position: { x: 120, y: 120 },
        value: 5,
        pinIds: catalog.components
          .find((row) => row.componentId === 'arduino-uno')!
          .pins.map((pin) => pin.id),
        stateProperties: {
          arduinoSource: originalSketch,
          arduinoCodeMode: 'text',
          arduinoWorkspace: '',
          arduinoSerialOpen: false,
          arduinoBaudRate: 9600,
        },
      },
      {
        id: 'resistor',
        kind: 'resistor',
        componentTypeId: 'resistor-axial',
        variantId: 'resistor-axial',
        position: { x: 650, y: 190 },
        value: 50,
        pinIds: ['lead-1', 'lead-2'],
        stateProperties: { resistanceUnit: 'Ω', tolerancePercent: 5, powerRatingWatt: 0.25 },
      },
      {
        id: 'led',
        kind: 'led',
        componentTypeId: 'led-5mm',
        variantId: 'led-5mm',
        position: { x: 840, y: 190 },
        value: 2,
        pinIds: ['anode', 'cathode'],
        stateProperties: { ledColour: 'red', ledBrightness: 0, ledFault: 'none' },
      },
    ],
    connections: [
      {
        id: 'out',
        from: { componentId: 'uno', terminal: 'd13' },
        to: { componentId: 'resistor', terminal: 'lead-1' },
        color: '#149447',
      },
      {
        id: 'led-feed',
        from: { componentId: 'resistor', terminal: 'lead-2' },
        to: { componentId: 'led', terminal: 'anode' },
        color: '#149447',
      },
      {
        id: 'return',
        from: { componentId: 'led', terminal: 'cathode' },
        to: { componentId: 'uno', terminal: 'power-gnd-1' },
        color: '#149447',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function edited(
  base: ElectronicsDocument,
  resistance: number,
  sketch: string,
): ElectronicsDocument {
  return {
    ...base,
    components: base.components.map((component) => {
      if (component.id === 'resistor') return { ...component, value: resistance };
      if (component.id === 'uno')
        return {
          ...component,
          stateProperties: { ...component.stateProperties, arduinoSource: sketch },
        };
      return component;
    }),
  };
}

const status = (page: Page) => page.locator('.workbench-main');
const save = (page: Page) => page.getByRole('button', { name: 'Сохранить проект', exact: true });
const sketch = (page: Page) => page.getByLabel('Код Arduino C++', { exact: true });
const openCode = (page: Page) =>
  page.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();

async function resistance(page: Page) {
  await page
    .locator('[data-testid="schematic-component"][data-component-id="resistor"] .workbench-part')
    .press('Enter');
  return page
    .locator('.workbench-inspector label')
    .filter({ hasText: 'Сопротивление' })
    .locator('input[type="number"]');
}

async function edit(page: Page, ohms: string, source: string) {
  await openCode(page);
  await sketch(page).fill(source);
  await expect(sketch(page)).toHaveValue(source);
  await page.getByRole('button', { name: 'Закрыть редактор кода', exact: true }).click();
  const field = await resistance(page);
  await field.fill(ohms);
  await expect(field).toHaveValue(ohms);
}

async function readWriters(page: Page, prefix: string): Promise<Writer[]> {
  return page.evaluate((writerPrefix) => {
    const entries: Writer[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(writerPrefix) || key.endsWith(':ack')) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      entries.push({
        key,
        raw,
        acknowledgement: localStorage.getItem(key + ':ack'),
        draft: JSON.parse(raw),
      });
    }
    return entries;
  }, prefix);
}

test('ELECTRONICS-E01 CROSS-TAB late acknowledgement preserves another tab recovery document', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const admin = e2eAdminPool();
  const teacher = await seedTeacher(admin, 'e2e-electronics-566-current').finally(() =>
    admin.end(),
  );
  await loginWithOrganization(page, teacher);
  const request = page.context().request;
  const sourceRevision = process.env.ASA_ELECTRONICS_EXPECTED_SHA;
  expect(sourceRevision).toMatch(/^[0-9a-f]{40}$/);
  for (const path of ['/api/version', '/build-metadata.json']) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect((await response.json()).revision).toBe(sourceRevision);
  }
  const session = await request.get('/api/auth/me');
  expect(session.status()).toBe(200);
  const identity = (await session.json()) as { authenticated: boolean; user?: { id: string } };
  expect(identity.authenticated).toBe(true);
  expect(identity.user?.id).toBeTruthy();
  const origin = new URL(page.url()).origin;
  const created = await request.post('/api/projects', {
    headers: { origin, 'idempotency-key': randomUUID() },
    data: {
      scope: 'personal',
      classroomId: null,
      module: 'electronics',
      title: 'E01 cross-tab recovery',
    },
  });
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;
  const projectPath = '/api/projects/' + projectId;
  const draftPath = projectPath + '/draft';
  const readServer = async (): Promise<Draft> => {
    const response = await request.get(projectPath, { headers: { origin } });
    expect(response.status()).toBe(200);
    const { revision, document } = (await response.json()).draft as Draft;
    return { revision, document };
  };
  const seeded = await request.put(draftPath, {
    headers: { origin },
    data: {
      document: circuit(),
      baseRevision: (await readServer()).revision,
      mutationId: randomUUID(),
    },
  });
  expect(seeded.status()).toBe(200);
  const editor = '/#/home/' + projectId;
  const open = async (tab: Page) => {
    await tab.goto(editor);
    await expect(tab.locator('.workbench-stage')).toBeVisible();
  };
  await open(page);
  // Confirm any load-time schema normalization before taking the common base.
  if (await save(page).isEnabled()) {
    await save(page).click();
    await expect(status(page)).toHaveAttribute('data-project-save-status', 'saved');
  }
  const before = await readServer();
  const expectedA = edited(before.document, 111.1, sketchA);
  const expectedB = edited(before.document, 222.2, sketchB);
  const prefix =
    'asa-project-local-draft:user:account:' +
    encodeURIComponent(identity.user!.id) +
    ':' +
    encodeURIComponent(projectId) +
    ':electronics-editor:';
  const second = await page.context().newPage();
  await open(second);
  const firstPuts: unknown[] = [];
  const blockedPuts: { tab: string; body: unknown }[] = [];
  let releaseA!: () => void;
  const holdA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  let settleServerA!: (result: number | { error: unknown }) => void;
  const serverA = new Promise<number | { error: unknown }>((resolve) => {
    settleServerA = resolve;
  });
  let settleDeliveryA!: (failure: { error: unknown } | null) => void;
  const deliveryA = new Promise<{ error: unknown } | null>((resolve) => {
    settleDeliveryA = resolve;
  });
  // A background focus refresh must not advance B's editor before its local edit.
  // Once released, this request still goes to the real API.
  await second.route('**' + projectPath, async (route) => {
    if (route.request().method() === 'GET') await holdA;
    await route.continue();
  });
  // Use the real API and PostgreSQL before withholding A's already committed reply.
  await page.route('**' + draftPath, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    firstPuts.push(route.request().postDataJSON());
    try {
      const response = await route.fetch();
      settleServerA(response.status());
      await holdA;
      await route.fulfill({ response });
      settleDeliveryA(null);
    } catch (error) {
      const failure = { error };
      settleServerA(failure);
      settleDeliveryA(failure);
    }
  });
  const preventPut = (tab: string) => async (route: Route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    blockedPuts.push({ tab, body: route.request().postDataJSON() });
    await route.abort('internetdisconnected');
  };
  await second.route('**' + draftPath, preventPut('B'));
  const receipt: Record<string, unknown> = {
    sourceRevision,
    projectId,
    before,
    firstPuts,
    blockedPuts,
  };
  try {
    await edit(page, '111.1', sketchA);
    await save(page).click();
    const responseA = await serverA;
    if (typeof responseA !== 'number') throw responseA.error;
    expect(responseA).toBe(200);
    await expect(status(page)).toHaveAttribute('data-project-save-status', 'saving');
    const committedA = await readServer();
    receipt.committedA = committedA;
    expect(committedA).toEqual({ revision: before.revision + 1, document: expectedA });
    expect(firstPuts).toMatchObject([{ baseRevision: before.revision, document: expectedA }]);

    await edit(second, '222.2', sketchB);
    const writersBeforeAck = await readWriters(second, prefix);
    receipt.writersBeforeAck = writersBeforeAck;
    const b = writersBeforeAck.find((entry) =>
      entry.draft.document.components.some(
        (part) => part.stateProperties?.arduinoSource === sketchB,
      ),
    );
    expect(b).toBeDefined();
    expect(b!.draft).toMatchObject({
      baseRevision: before.revision,
      baseDocument: before.document,
    });
    expect(b!.draft.document).toEqual(expectedB);
    expect(b!.acknowledgement).toBeNull();

    releaseA();
    const deliveryFailure = await deliveryA;
    if (deliveryFailure) throw deliveryFailure.error;
    receipt.deliveryA = 'fulfilled';
    await expect(status(page)).toHaveAttribute('data-project-save-status', 'saved');
    const writersAfterAck = await readWriters(second, prefix);
    receipt.writersAfterAck = writersAfterAck;
    expect(writersAfterAck.find((entry) => entry.key === b!.key)).toEqual(b);
    expect(await readServer()).toEqual(committedA);

    await second.close({ runBeforeUnload: true });
    await expect.poll(() => second.isClosed()).toBe(true);
    const writersAfterClose = await readWriters(page, prefix);
    receipt.writersAfterClose = writersAfterClose;
    expect(writersAfterClose.find((entry) => entry.key === b!.key)).toEqual(b);

    const reopened = await page.context().newPage();
    await reopened.route('**' + draftPath, preventPut('reopened B'));
    await open(reopened);
    expect(await reopened.evaluate(() => window.opener === null)).toBe(true);
    await expect(await resistance(reopened)).toHaveValue('222.2');
    await openCode(reopened);
    await expect(sketch(reopened)).toHaveValue(sketchB);
    await expect(status(reopened)).toHaveAttribute('data-project-save-status', 'error');
    const indicator = reopened.locator('.workbench-save-state');
    await expect(indicator).toHaveAttribute(
      'title',
      /сохранены в браузере.*Сервер содержит другую версию/,
    );
    const reopenedWriters = await readWriters(reopened, prefix);
    receipt.reopenedWriters = reopenedWriters;
    expect(reopenedWriters.find((entry) => entry.key === b!.key)).toEqual(b);
    const reopenedKey = await reopened.evaluate((key) => sessionStorage.getItem(key), prefix);
    receipt.reopenedKey = reopenedKey;
    expect(reopenedKey?.startsWith(prefix)).toBe(true);
    expect(reopenedKey).not.toBe(b!.key);
    const reopenedWriter = reopenedWriters.find((entry) => entry.key === reopenedKey);
    expect(reopenedWriter?.draft.document).toEqual(expectedB);
    expect(reopenedWriter?.acknowledgement).toBeNull();
    const finalServer = await readServer();
    receipt.finalServer = finalServer;
    expect(finalServer).toEqual(committedA);
    expect(firstPuts).toHaveLength(1);
    await info.attach('reopened-recovery', {
      body: await reopened.screenshot(),
      contentType: 'image/png',
    });
    await reopened.close();
  } finally {
    releaseA();
    await info.attach('cross-tab-storage-and-server-receipt', {
      body: JSON.stringify(receipt, null, 2),
      contentType: 'application/json',
    });
  }
});
