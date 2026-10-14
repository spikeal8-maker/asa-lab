import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type pg from 'pg';
import type { SchematicDocument } from '../apps/web/src/api';
import type { ElectronicsTimedState } from '../contexts/electronics/engine';
import type { SimulationTimedAdvancePayload } from '../apps/web/src/electronics/simulation-worker-protocol';
import type { ArduinoRuntimeState } from '../contexts/electronics/domain/arduino-program-runtime';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

const serialSketch = `void setup() {
  Serial.begin(9600);
  for (int i = 0; i < 8; i++) {
    unsigned int mask = 1;
    for (int index = 0; index < i; index++) { mask *= 2; }
    Serial.println(mask);
  }
}

void loop() {
}`;
const gpioSketch = `void setup() {
  for (int pin = 2; pin <= 9; pin++) {
    pinMode(pin, OUTPUT);
  }
}

void loop() {
  for (int step = 0; step < 8; step++) {
    for (int bitIndex = 0; bitIndex < 8; bitIndex++) {
      digitalWrite(2 + bitIndex, step == bitIndex);
    }
    delay(250);
  }
}`;
const initialSource = 'void setup() {}\nvoid loop() { delay(100); }';
const ownerCatalog = JSON.parse(
  readFileSync(resolve('apps/web/public/assets/electronics/owner-catalog/manifest.json'), 'utf8'),
) as { components: Array<{ componentId: string; pins: Array<{ id: string }> }> };
const artifactRoot = resolve('e2e/artifacts/electronics-simulation/ready-cadence-539');
let admin: pg.Pool;
let teacher: SeededTeacher;

type BoardReceipt = {
  componentId: string;
  loadedSource?: string | null;
  runtime: ArduinoRuntimeState;
};
type WorkerReceipt = {
  worker: number;
  requestId: string;
  requestAt: number | null;
  generationId: number | null;
  requestSource: string | null;
  at: number;
  advance: Omit<SimulationTimedAdvancePayload, 'state'>;
  boards: BoardReceipt[];
  state: ElectronicsTimedState;
  computeMs: number | null;
};
type UiReceipt = { at: number; time: string; brightness: number[]; serial: string[] };
type ProbeWindow = Window & { __bitwiseWorker?: WorkerReceipt[]; __bitwiseUi?: UiReceipt[] };

function fixture(): SchematicDocument {
  const components: SchematicDocument['components'][number][] = [
    {
      id: 'uno',
      kind: 'visual',
      componentTypeId: 'arduino-uno',
      variantId: 'arduino-uno',
      name: 'Arduino Uno',
      position: { x: 140, y: 140 },
      rotation: 0,
      value: 5,
      pinIds: ownerCatalog.components
        .find((row) => row.componentId === 'arduino-uno')!
        .pins.map((pin) => pin.id),
      stateProperties: {
        arduinoSource: initialSource,
        arduinoCodeMode: 'text',
        arduinoWorkspace: '',
        arduinoSerialOpen: true,
        arduinoBaudRate: 9600,
      },
    },
  ];
  const connections: SchematicDocument['connections'][number][] = [];
  for (let index = 0; index < 8; index++) {
    const position = { x: 580 + (index % 4) * 150, y: 180 + Math.floor(index / 4) * 240 };
    components.push({
      id: `r${index}`,
      kind: 'resistor',
      componentTypeId: 'resistor-axial',
      variantId: 'resistor-axial',
      name: `R${index + 1}`,
      position,
      rotation: 90,
      value: 330,
      pinIds: ['lead-1', 'lead-2'],
      stateProperties: { tolerancePercent: 5, resistanceUnit: 'Ом', powerRatingWatt: 0.25 },
    });
    components.push({
      id: `led${index}`,
      kind: 'led',
      componentTypeId: 'led-5mm',
      variantId: 'led-5mm',
      name: `LED${index + 1}`,
      position: { x: position.x, y: position.y + 90 },
      rotation: 0,
      value: 2,
      pinIds: ['anode', 'cathode'],
      stateProperties: { colour: 'red', ledColour: 'red', ledBrightness: 0, ledFault: 'none' },
    });
    for (const [from, fromPin, to, toPin] of [
      ['uno', `d${index + 2}`, `r${index}`, 'lead-1'],
      [`r${index}`, 'lead-2', `led${index}`, 'anode'],
      [`led${index}`, 'cathode', 'uno', 'power-gnd-1'],
    ]) {
      connections.push({
        id: `w${connections.length}`,
        from: { componentId: from!, terminal: fromPin! },
        to: { componentId: to!, terminal: toPin! },
        color: '#149447',
        vertices: [],
      });
    }
  }
  return {
    schemaVersion: 4,
    components,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

async function observeRealWorkerAndUi(page: Page, ledCount = 8): Promise<void> {
  await page.addInitScript((ledCount) => {
    const probe = window as ProbeWindow;
    const workers: WorkerReceipt[] = [];
    const ui: UiReceipt[] = [];
    probe.__bitwiseWorker = workers;
    probe.__bitwiseUi = ui;
    let workerId = 0;
    window.Worker = new Proxy(window.Worker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget) as Worker;
        if ((args[1] as WorkerOptions | undefined)?.name !== 'asa-electronics-simulation')
          return worker;
        const id = ++workerId;
        const sources = new Map<
          string,
          { source: string; at: number; generationId: number | null }
        >();
        const post = worker.postMessage.bind(worker);
        worker.postMessage = ((...args: unknown[]) => {
          const message = args[0] as {
            kind?: string;
            requestId: string;
            generationId?: number;
            document?: SchematicDocument;
          };
          if (message.kind === 'advance')
            sources.set(message.requestId, {
              source: String(
                message.document?.components.find((row) => row.id === 'uno')?.stateProperties?.[
                  'arduinoSource'
                ] ?? '',
              ),
              at: performance.now(),
              generationId: message.generationId ?? null,
            });
          Reflect.apply(post, worker, args);
        }) as Worker['postMessage'];
        worker.addEventListener('message', (event: MessageEvent) => {
          const response = event.data as {
            ok?: boolean;
            kind?: string;
            requestId: string;
            advance?: SimulationTimedAdvancePayload;
            metrics?: { computeMs?: number };
          };
          if (!response.ok || response.kind !== 'advance' || !response.advance) return;
          const { state, ...advance } = response.advance;
          const serialized = state.continuation?.serializedState;
          const boards = serialized
            ? (JSON.parse(serialized) as { boards: BoardReceipt[] }).boards
            : [];
          workers.push({
            worker: id,
            requestId: response.requestId,
            requestAt: sources.get(response.requestId)?.at ?? null,
            generationId: sources.get(response.requestId)?.generationId ?? null,
            requestSource: sources.get(response.requestId)?.source ?? null,
            at: performance.now(),
            advance,
            boards,
            state,
            computeMs:
              typeof response.metrics?.computeMs === 'number' ? response.metrics.computeMs : null,
          });
          sources.delete(response.requestId);
          if (workers.length > 200) workers.shift();
        });
        return worker;
      },
    });
    const collect = () => {
      const elements = Array.from({ length: ledCount }, (_, index) =>
        document.querySelector(
          `[data-testid="schematic-component"][data-component-id="led${index}"] .workbench-production-visual`,
        ),
      );
      if (elements.some((element) => !element)) return;
      ui.push({
        at: performance.now(),
        time: document.querySelector('.workbench-simulation-time')?.textContent ?? '',
        serial: Array.from(document.querySelectorAll('.arduino-serial-output > div')).map(
          (node) => node.textContent ?? '',
        ),
        brightness: elements.map((element) =>
          Number(element!.getAttribute('data-led-brightness') ?? '0'),
        ),
      });
      if (ui.length > 200) ui.shift();
    };
    new MutationObserver(collect).observe(document, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
      attributeFilter: ['data-led-brightness'],
    });
  }, ledCount);
}
async function observation(page: Page) {
  return page.evaluate(() => ({
    worker: (window as ProbeWindow).__bitwiseWorker ?? [],
    ui: (window as ProbeWindow).__bitwiseUi ?? [],
  }));
}
// Keep polling beside the full receipts: transporting their canonical state on
// every attempt can cross the deadline after the required frame already exists.
function compactObservation({
  source,
  raw,
}: {
  source: string;
  raw?: { worker: WorkerReceipt[]; ui: UiReceipt[] };
}) {
  const observed = raw ?? {
    worker: (window as ProbeWindow).__bitwiseWorker ?? [],
    ui: (window as ProbeWindow).__bitwiseUi ?? [],
  };
  function highIndex(row: WorkerReceipt): number {
    if (row.advance.executionStatus !== 'ready' || !row.advance.result?.solved) return -1;
    const board = row.boards.find((board) => board.componentId === 'uno');
    if (!board) return -1;
    const voltages = Array.from(
      { length: 8 },
      (_, index) => board.runtime.outputVoltages[`d${index + 2}` as 'd2'] ?? 0,
    );
    const high = voltages
      .map((value, index) => (value === 5 ? index : -1))
      .filter((index) => index >= 0);
    return high.length === 1 && voltages.every((value) => value === 0 || value === 5)
      ? high[0]!
      : -1;
  }
  function visibleIndices(rows: UiReceipt[]): number[] {
    return [
      ...new Set(
        rows.flatMap((row) => {
          const high = row.brightness
            .map((value, index) => (value > 0 ? index : -1))
            .filter((index) => index >= 0);
          return high.length === 1 ? high : [];
        }),
      ),
    ].sort((a, b) => a - b);
  }
  const ready = observed.worker.filter(
    (row) =>
      row.requestSource === source &&
      row.advance.executionStatus === 'ready' &&
      row.advance.committedHorizonMicroseconds === row.advance.requestedHorizonMicroseconds,
  );
  return {
    serial:
      ready
        .at(-1)
        ?.advance.serial.find((board) => board.componentId === 'uno')
        ?.tx.map((entry) => entry.text) ?? [],
    gpio: [...new Set(ready.map(highIndex).filter((index) => index >= 0))].sort((a, b) => a - b),
    visible: visibleIndices(observed.ui),
  };
}
async function runActualSketch(page: Page, kind: 'serial' | 'gpio', source: string, path: string) {
  let raw: Awaited<ReturnType<typeof observation>>;
  try {
    await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
    if (kind === 'serial') {
      await expect
        .poll(async () => (await page.evaluate(compactObservation, { source })).serial)
        .toEqual([1, 2, 4, 8, 16, 32, 64, 128].map((value) => `${value}\n`));
      await expect(page.locator('.arduino-serial-output > div')).toHaveText(
        [1, 2, 4, 8, 16, 32, 64, 128].map(String),
      );
    } else {
      await expect
        .poll(async () => (await page.evaluate(compactObservation, { source })).gpio)
        .toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      await expect
        .poll(async () => (await page.evaluate(compactObservation, { source })).visible)
        .toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
  } finally {
    // Preserve complete canonical state/events/quality even when a predicate fails.
    raw = await observation(page);
    writeFileSync(
      `${path}.json`,
      JSON.stringify(
        { kind, source, sourceSha256: createHash('sha256').update(source).digest('hex'), ...raw },
        null,
        2,
      ) + '\n',
    );
  }
  await page.screenshot({ path: `${path}.png` });
  const ready = raw.worker.filter(
    (row) => row.requestSource === source && row.advance.executionStatus === 'ready',
  );
  expect(ready.length).toBeGreaterThan(0);
  for (const row of ready) {
    expect(row.advance.committedHorizonMicroseconds).toBe(row.advance.requestedHorizonMicroseconds);
    expect(row.advance.result?.solved).toBe(true);
    expect(row.advance.result?.quality?.passed).toBe(true);
    expect(row.advance.diagnostics).toEqual([]);
    expect(row.computeMs).not.toBeNull();
    expect(Number.isFinite(row.computeMs)).toBe(true);
    expect(row.computeMs).toBeGreaterThanOrEqual(0);
    const board = row.boards.find((board) => board.componentId === 'uno')!;
    expect(board.loadedSource).toBe(source);
    expect(board.runtime.programFingerprint).toMatch(/^arduino-v1-/);
    expect(board.runtime.clockProfile).toBe('instruction-us-v1');
  }
  for (const row of raw.worker.filter((row) => row.advance.executionStatus === 'yielded'))
    expect(row.advance.result).toBeNull();
  if (kind === 'gpio') {
    for (let index = 0; index < 8; index++) {
      const row = ready.find((row) =>
        compactObservation({ source, raw: { worker: [row], ui: [] } }).gpio.includes(index),
      )!;
      for (let led = 0; led < 8; led++) {
        const result = row.advance.result!.components.find(
          (component) => component.componentId === `led${led}`,
        )!;
        expect(result).toBeDefined();
        if (led === index) expect(result.brightness ?? 0).toBeGreaterThan(0);
        else expect(result.brightness ?? 0).toBe(0);
        if (led === index) {
          expect(result.current).toBeGreaterThan(0.001);
          expect(result.current).toBeLessThan(0.02);
        } else expect(Math.abs(result.current)).toBeLessThan(0.000001);
        expect(result.stressState).not.toBe('burned');
      }
    }
  }
  await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
  await expect(page.locator('.workbench-simulation-message')).toHaveCount(0);
  return ready[0]!.boards.find((board) => board.componentId === 'uno')!.runtime.programFingerprint;
}

test.beforeAll(() => {
  admin = e2eAdminPool();
  mkdirSync(artifactRoot, { recursive: true });
});
test.beforeEach(async ({ browserName }, info) => {
  void browserName;
  teacher = await seedTeacher(admin, `ready-cadence-${info.workerIndex}-${info.retry}`);
});
test.afterAll(async () => {
  await admin.end();
});
for (const kind of ['serial', 'gpio'] as const) {
  test(`Canonical ready cadence: ${kind} sketch saved, observed completely and reopened with cookies only`, async ({
    page,
    browser,
  }) => {
    const source = kind === 'serial' ? serialSketch : gpioSketch;
    const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await observeRealWorkerAndUi(page);
    await loginWithOrganization(page, teacher);
    const origin = new URL(page.url()).origin;
    const created = await page.context().request.post('/api/projects', {
      headers: { origin, 'idempotency-key': `cadence-${crypto.randomUUID()}` },
      data: {
        scope: 'personal',
        classroomId: null,
        module: 'electronics',
        title: `Canonical ${kind} ready observations`,
      },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { project: { id: string } }).project.id;
    const endpoint = `/api/projects/${id}`;
    const read = async () => {
      const response = await page.context().request.get(endpoint, { headers: { origin } });
      expect(response.status()).toBe(200);
      return response.json() as Promise<{
        draft: { revision: number; updatedAt: string; document: SchematicDocument };
      }>;
    };
    const empty = await read();
    const savedFixture = await page.context().request.put(`${endpoint}/draft`, {
      headers: { origin },
      data: {
        document: fixture(),
        baseRevision: empty.draft.revision,
        mutationId: crypto.randomUUID(),
      },
    });
    expect(savedFixture.status()).toBe(200);
    const before = await read();
    await page.goto(`/#/home/${id}`);
    await expect(page.locator('.workbench-stage')).toBeVisible();
    await page.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();
    await expect(page.locator('.arduino-source-editor textarea')).toHaveValue(initialSource);
    await page.locator('.arduino-source-editor textarea').fill(source);
    await expect(page.locator('.arduino-source-editor textarea')).toHaveValue(source);
    const saveResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${endpoint}/draft` &&
        response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
    expect((await saveResponse).status()).toBe(200);
    const after = await read();
    const expected = {
      ...before.draft.document,
      components: before.draft.document.components.map((component) =>
        component.id === 'uno'
          ? {
              ...component,
              stateProperties: { ...component.stateProperties, arduinoSource: source },
            }
          : component,
      ),
    };
    writeFileSync(
      resolve(artifactRoot, `${kind}-saved.json`),
      JSON.stringify({ projectId: id, before, after, expected }, null, 2) + '\n',
    );
    expect(after.draft.document).toEqual(expected);
    expect(after.draft.revision).toBe(before.draft.revision + 1);
    const fingerprint = await runActualSketch(
      page,
      kind,
      source,
      resolve(artifactRoot, `${kind}-initial`),
    );
    const originalAfterRun = await read();
    expect(originalAfterRun.draft.document).toEqual(after.draft.document);
    expect(originalAfterRun.draft.revision).toBe(after.draft.revision);
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    try {
      const reopened = await context.newPage();
      const reopenFailures = collectBrowserFailures(reopened, { allowAnonymousSessionProbe: true });
      await observeRealWorkerAndUi(reopened);
      await context.addCookies(await page.context().cookies());
      await reopened.goto(`${origin}/#/home/${id}`);
      await expect(reopened.locator('.workbench-stage')).toBeVisible();
      await reopened.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();
      await expect(reopened.locator('.arduino-source-editor textarea')).toHaveValue(source);
      expect(
        await runActualSketch(reopened, kind, source, resolve(artifactRoot, `${kind}-reopened`)),
      ).toBe(fingerprint);
      const finalResponse = await context.request.get(endpoint, { headers: { origin } });
      expect(finalResponse.status()).toBe(200);
      const final = (await finalResponse.json()) as typeof after;
      writeFileSync(
        resolve(artifactRoot, `${kind}-final.json`),
        JSON.stringify({ after, final }, null, 2) + '\n',
      );
      expect(final.draft.document).toEqual(after.draft.document);
      expect(final.draft.revision).toBe(after.draft.revision);
      expect(final.draft.updatedAt).toBe(after.draft.updatedAt);
      reopenFailures.assertEmpty();
    } finally {
      await context.close();
    }
    failures.assertEmpty();
  });
}

// These are the owner's three-pin programmes, not shortened substitutes for
// the eight-pin GPIO/Serial cases above. Runtime events establish logical
// timing; real DOM transitions separately establish visible publication.
function threeLedFixture(): SchematicDocument {
  const original = fixture();
  const keep = new Set(['uno', 'r0', 'led0', 'r1', 'led1', 'r2', 'led2']);
  return {
    ...original,
    components: original.components.filter((component) => keep.has(component.id)),
    connections: original.connections
      .filter(
        (connection) =>
          keep.has(connection.from.componentId) && keep.has(connection.to.componentId),
      )
      .map((connection) =>
        connection.from.componentId === 'uno'
          ? {
              ...connection,
              from: {
                ...connection.from,
                terminal: `d${13 - Number(connection.to.componentId.slice(1))}` as 'd13',
              },
            }
          : connection,
      ),
  };
}

function threeLedSource(delayMs: number | null): string {
  return `void setup() {
  pinMode(13, OUTPUT);
  pinMode(12, OUTPUT);
  pinMode(11, OUTPUT);
}
void loop() {
  digitalWrite(13, HIGH);
  digitalWrite(12, HIGH);
  digitalWrite(11, HIGH);${
    delayMs === null
      ? ''
      : `
  delay(${delayMs});
  digitalWrite(13, LOW);
  digitalWrite(12, LOW);
  digitalWrite(11, LOW);
  delay(${delayMs});`
  }
}`;
}

function ownerTimingSummary({ source }: { source: string }) {
  const probe = window as ProbeWindow;
  const worker = (probe.__bitwiseWorker ?? []).filter((row) => row.requestSource === source);
  const ready = worker.filter(
    (row) =>
      row.advance.executionStatus === 'ready' &&
      row.advance.committedHorizonMicroseconds === row.advance.requestedHorizonMicroseconds &&
      row.advance.result?.solved &&
      row.advance.result.quality?.passed,
  );
  const ui = probe.__bitwiseUi ?? [];
  const changes: number[] = [];
  for (const row of ui) {
    const level = row.brightness.every((value) => value > 0)
      ? 1
      : row.brightness.every((value) => value === 0)
        ? 0
        : -1;
    if (level >= 0 && level !== changes.at(-1)) changes.push(level);
  }
  return {
    committed: ready.at(-1)?.advance.committedHorizonMicroseconds ?? 0,
    completeAllHigh: ready.some((row) =>
      [0, 1, 2].every(
        (index) =>
          (row.advance.result?.components.find(
            (component) => component.componentId === `led${index}`,
          )?.brightness ?? 0) > 0,
      ),
    ),
    visibleAllHigh: ui.some((row) => row.brightness.every((value) => value > 0)),
    visibleChanges: changes.length,
  };
}

for (const delayMs of [null, 100, 50] as const) {
  const label = delayMs === null ? 'three HIGH outputs without delay' : `blink delay ${delayMs} ms`;
  test(`Owner Arduino timing: ${label}, complete ready frames and real LED transitions`, async ({
    page,
  }) => {
    const source = threeLedSource(delayMs);
    const name = delayMs === null ? 'no-delay' : `blink-${delayMs}`;
    const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await observeRealWorkerAndUi(page, 3);
    await loginWithOrganization(page, teacher);
    const origin = new URL(page.url()).origin;
    const created = await page.context().request.post('/api/projects', {
      headers: { origin, 'idempotency-key': `owner-timing-${crypto.randomUUID()}` },
      data: {
        scope: 'personal',
        classroomId: null,
        module: 'electronics',
        title: `Owner Arduino ${name}`,
      },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { project: { id: string } }).project.id;
    const endpoint = `/api/projects/${id}`;
    const read = async () => {
      const response = await page.context().request.get(endpoint, { headers: { origin } });
      expect(response.status()).toBe(200);
      return response.json() as Promise<{
        draft: { revision: number; updatedAt: string; document: SchematicDocument };
      }>;
    };
    const empty = await read();
    const seeded = await page.context().request.put(`${endpoint}/draft`, {
      headers: { origin },
      data: {
        document: threeLedFixture(),
        baseRevision: empty.draft.revision,
        mutationId: crypto.randomUUID(),
      },
    });
    expect(seeded.status()).toBe(200);
    const before = await read();
    await page.goto(`/#/home/${id}`);
    await expect(page.locator('.workbench-stage')).toBeVisible();
    await page.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();
    await page.locator('.arduino-source-editor textarea').fill(source);
    const savedResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${endpoint}/draft` &&
        response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
    expect((await savedResponse).status()).toBe(200);
    const saved = await read();
    const expected = {
      ...before.draft.document,
      components: before.draft.document.components.map((component) =>
        component.id === 'uno'
          ? {
              ...component,
              stateProperties: { ...component.stateProperties, arduinoSource: source },
            }
          : component,
      ),
    };
    expect(saved.draft.document).toEqual(expected);
    expect(saved.draft.revision).toBe(before.draft.revision + 1);
    const startAt = await page.evaluate(() => {
      const probe = window as ProbeWindow;
      if (probe.__bitwiseWorker) probe.__bitwiseWorker.length = 0;
      if (probe.__bitwiseUi) probe.__bitwiseUi.length = 0;
      return performance.now();
    });
    let raw: Awaited<ReturnType<typeof observation>> | null = null;
    let primary: unknown;
    try {
      await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
      if (delayMs === null) {
        await expect
          .poll(async () => {
            const summary = await page.evaluate(ownerTimingSummary, { source });
            return { ready: summary.completeAllHigh, visible: summary.visibleAllHigh };
          })
          .toEqual({ ready: true, visible: true });
      } else {
        // A correct GPIO event log alone cannot pass a hidden/aliased blink.
        // Both on and off states must actually reach the production DOM.
        await expect
          .poll(async () => {
            const summary = await page.evaluate(ownerTimingSummary, { source });
            return (
              summary.committed >= 1_000_000 && summary.visibleChanges >= (delayMs === 100 ? 8 : 16)
            );
          })
          .toBe(true);
      }
    } catch (error) {
      primary = error;
    } finally {
      try {
        raw = await observation(page);
        writeFileSync(
          resolve(artifactRoot, `owner-${name}-raw.json`),
          JSON.stringify(
            {
              source,
              sourceSha256: createHash('sha256').update(source).digest('hex'),
              startAt,
              collectedAt: await page.evaluate(() => performance.now()),
              before,
              saved,
              expected,
              primaryError: primary instanceof Error ? primary.message : null,
              ...raw,
            },
            null,
            2,
          ) + '\n',
        );
      } catch (evidenceError) {
        if (primary === undefined) primary = evidenceError;
        writeFileSync(
          resolve(artifactRoot, `owner-${name}-evidence-error.json`),
          JSON.stringify({
            primaryError: primary instanceof Error ? primary.message : String(primary),
            evidenceError:
              evidenceError instanceof Error ? evidenceError.message : String(evidenceError),
          }) + '\n',
        );
      }
    }
    if (primary !== undefined) throw primary;
    const ready = raw!.worker.filter(
      (row) => row.requestSource === source && row.advance.executionStatus === 'ready',
    );
    expect(ready.some((row) => row.advance.committedHorizonMicroseconds === 0)).toBe(true);
    for (const row of ready) {
      expect(row.advance.committedHorizonMicroseconds).toBe(
        row.advance.requestedHorizonMicroseconds,
      );
      expect(row.advance.result?.solved).toBe(true);
      expect(row.advance.result?.quality?.passed).toBe(true);
      expect(row.advance.diagnostics).toEqual([]);
      expect(Number.isFinite(row.computeMs)).toBe(true);
    }
    for (const row of raw!.worker.filter((row) => row.advance.executionStatus === 'yielded'))
      expect(row.advance.result).toBeNull();
    expect(
      raw!.worker.filter(
        (row) => row.requestSource === source && row.advance.executionStatus === 'fault',
      ),
    ).toEqual([]);
    const events = new Map<number, ArduinoRuntimeState['eventQueue'][number]>();
    for (const row of raw!.worker.filter((row) => row.requestSource === source))
      for (const event of row.boards.find((board) => board.componentId === 'uno')?.runtime
        .eventQueue ?? [])
        if (event.kind === 'output-change' && event.terminal === 'd13')
          events.set(event.sequence, event);
    const edges = [...events.values()]
      .sort((a, b) => a.sequence - b.sequence)
      .filter((event, index, rows) => index === 0 || event.voltage !== rows[index - 1]!.voltage);
    if (delayMs !== null) {
      expect(edges.length).toBeGreaterThanOrEqual(delayMs === 100 ? 10 : 20);
      for (let index = 1; index < edges.length; index++) {
        const interval = edges[index]!.atMicroseconds - edges[index - 1]!.atMicroseconds;
        expect(interval).toBeGreaterThanOrEqual(delayMs * 1000);
        expect(interval).toBeLessThanOrEqual(delayMs * 1000 + 10);
      }
    }
    const transitions: Array<{
      at: number;
      level: number;
      readyAt: number;
      committed: number;
      publicationMs: number;
    }> = [];
    for (const row of raw!.ui.filter((row) => row.at >= startAt)) {
      const level = row.brightness.every((value) => value > 0)
        ? 1
        : row.brightness.every((value) => value === 0)
          ? 0
          : -1;
      if (level < 0 || level === transitions.at(-1)?.level) continue;
      const matching = ready
        .filter(
          (frame) =>
            frame.at <= row.at &&
            row.brightness.every((value, index) => {
              const physical =
                frame.advance.result?.components.find(
                  (component) => component.componentId === `led${index}`,
                )?.brightness ?? 0;
              return value === Math.round(Math.max(0, Math.min(100, physical)));
            }),
        )
        .at(-1);
      // The pre-Run dark DOM is not a simulated publication.
      if (!matching) {
        expect(level).toBe(0);
        continue;
      }
      transitions.push({
        at: row.at,
        level,
        readyAt: matching.at,
        committed: matching.advance.committedHorizonMicroseconds,
        publicationMs: row.at - matching.at,
      });
    }
    expect(transitions.some((row) => row.level === 1)).toBe(true);
    if (delayMs !== null) {
      expect(transitions.length).toBeGreaterThanOrEqual(delayMs === 100 ? 8 : 16);
      const first = transitions[0]!;
      const last = transitions.at(-1)!;
      const modelSpanMs = (last.committed - first.committed) / 1000;
      const wallSpanMs = last.at - first.at;
      expect(modelSpanMs).toBeGreaterThanOrEqual(750);
      // The five-second discovery deadline is not permission to play one
      // logical second over five real seconds. This is a separate rate check.
      expect(Math.abs(wallSpanMs - modelSpanMs)).toBeLessThanOrEqual(250);
      const sameLevel = transitions.filter((row) => row.level === 1);
      const wallPeriodMs = (sameLevel.at(-1)!.at - sameLevel[0]!.at) / (sameLevel.length - 1);
      expect(wallPeriodMs).toBeGreaterThanOrEqual(delayMs * 2 * 0.75);
      expect(wallPeriodMs).toBeLessThanOrEqual(delayMs * 2 * 1.25);
      for (let index = 1; index < transitions.length; index++)
        expect(transitions[index]!.at - transitions[index - 1]!.at).toBeLessThanOrEqual(
          delayMs * 3,
        );
    }
    writeFileSync(
      resolve(artifactRoot, `owner-${name}-timing.json`),
      JSON.stringify(
        {
          startAt,
          firstReadyAt: ready[0]!.at,
          firstReadyMs: ready[0]!.at - startAt,
          firstLedMs: transitions.find((row) => row.level === 1)!.at - startAt,
          requestedPeriodUs: delayMs === null ? null : delayMs * 2000,
          edges,
          transitions,
          horizonTimeline: raw!.worker.map((row) => ({
            at: row.at,
            requestAt: row.requestAt,
            generationId: row.generationId,
            requestId: row.requestId,
            computeMs: row.computeMs,
            executionStatus: row.advance.executionStatus,
            requested: row.advance.requestedHorizonMicroseconds,
            committed: row.advance.committedHorizonMicroseconds,
          })),
          finalWallMs: ready.at(-1)!.at - startAt,
          finalModelMs: ready.at(-1)!.advance.committedHorizonMicroseconds / 1000,
          modelToWallRatio:
            ready.at(-1)!.advance.committedHorizonMicroseconds /
            1000 /
            (ready.at(-1)!.at - startAt),
        },
        null,
        2,
      ) + '\n',
    );
    await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
    const final = await read();
    expect(final.draft).toEqual(saved.draft);
    failures.assertEmpty();
  });
}
