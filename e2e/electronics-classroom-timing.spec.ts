import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type pg from 'pg';
import type { SchematicDocument } from '../apps/web/src/api';
import type { ArduinoRuntimeState } from '../contexts/electronics/domain/arduino-program-runtime';
import type {
  ElectronicsSimulationWorkerRequest,
  ElectronicsSimulationWorkerResponse,
  SimulationTimedAdvancePayload,
} from '../apps/web/src/electronics/simulation-worker-protocol';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

// This separate classroom contract retains the existing real-time suite unchanged.
// BEFORE reports the same observed criteria; a successful harness is not acceptance.
const before = process.env['ASA_ELECTRONICS_CLASSROOM_PHASE'] === 'before';
const phase = before ? 'before' : 'after';
const artifactBaseRoot = resolve('e2e/artifacts/electronics-simulation/classroom-d13', phase);
let artifactRoot = artifactBaseRoot;
const observationTimeoutMs = 45_000;
const startupLimitMs = 5_000;
const completeCycles = 8;
const sourcePaths = [
  'contexts/electronics/domain/arduino-circuit-scheduler.ts',
  'contexts/electronics/domain/arduino-program-runtime.ts',
  'contexts/electronics/domain/solver.ts',
  'contexts/electronics/domain/simulation.ts',
  'apps/web/src/electronics/use-electronics-workbench.ts',
  'apps/web/src/electronics/ProductionComponentVisual.tsx',
  'contexts/electronics/domain/led-temporal-observation.ts',
  'e2e/electronics-classroom-timing.spec.ts',
];
const ownerCatalog = JSON.parse(
  readFileSync(resolve('apps/web/public/assets/electronics/owner-catalog/manifest.json'), 'utf8'),
) as { components: Array<{ componentId: string; pins: Array<{ id: string }> }> };
let admin: pg.Pool;
let teacher: SeededTeacher;

type Component = NonNullable<SimulationTimedAdvancePayload['result']>['components'][number];
type Optical = NonNullable<SimulationTimedAdvancePayload['ledTemporal']>;
type RuntimeEvent = ArduinoRuntimeState['eventQueue'][number];
type Frame = {
  at: number;
  workerId: number;
  requestId: string;
  requestAt: number | null;
  source: string | null;
  generationId: number;
  requestedGenerationId: number | null;
  projectSessionId: string;
  engineRevision: string | null;
  metricsRevision: string | null;
  protocolVersion: number;
  status: SimulationTimedAdvancePayload['executionStatus'];
  requestedUs: number;
  committedUs: number;
  continuationUs: number | null;
  computeMs: number | null;
  hasResult: boolean;
  solved: boolean;
  quality: NonNullable<SimulationTimedAdvancePayload['result']>['quality'] | null;
  diagnostics: SimulationTimedAdvancePayload['diagnostics'];
  components: Component[];
  optical: Optical | null;
  loadedSource: string | null;
  fingerprint: string | null;
  d13Voltage: number | null;
  runtimeEvents: RuntimeEvent[];
  nextEventSequence: number | null;
};
type ImageWitness = {
  href: string;
  decoded: boolean;
  mountedLoadAt: number | null;
  visible: boolean;
  unoccluded: boolean;
  opacity: number;
  rect: { x: number; y: number; width: number; height: number } | null;
};
type Paint = {
  at: number;
  previousAt: number | null;
  stable: boolean;
  brightness: number;
  ledLit: boolean;
  lActive: boolean;
  lOpacity: number | null;
  led: ImageWitness;
  board: ImageWitness;
  lVisible: boolean;
  assetsReady: boolean;
  running: string | null;
  timeText: string;
};
type Probe = {
  epoch: number;
  label: string;
  source: string;
  markedAt: number;
  frames: Frame[];
  paints: Paint[];
  gpio: Array<{ at: number; generationId: number; workerId: number; event: RuntimeEvent }>;
  clicks: Array<{ at: number; action: 'start' | 'reset' | 'stop'; trusted: boolean }>;
  errors: Array<{ at: number; requestId: string; code: string }>;
  inflight: Array<{ at: number; count: number; reason: string }>;
  observerErrors: string[];
  finishedAt: number | null;
};
type ProbeWindow = Window & { __classroomD13?: Probe };
type Edge = { at: number; level: number; receivedAt?: number };
type Metrics = {
  findings: string[];
  phaseDiagnostics: string[];
  cycles: number;
  startupMs: number | null;
  modelEdges: Edge[];
  paintedEdges: Edge[];
  highMs: number[];
  lowMs: number[];
  periodsMs: number[];
  medianHighMs: number | null;
  medianLowMs: number | null;
  medianPeriodMs: number | null;
  modelMedianPeriodMs: number | null;
  measuredSlowdown: number | null;
  maxInflight: number | null;
  initialization: {
    model: Edge[];
    painted: Edge[];
    firstModelHigh: number;
    firstPaintedHigh: number;
  };
  backlog: Array<{ at: number; completed: number; painted: number; unpresented: number }>;
  maxBacklog: number | null;
};

function blink(high: number, low = high, setupHold = 0): string {
  return [
    'void setup() {',
    '  pinMode(13, OUTPUT);',
    '  digitalWrite(13, LOW);',
    ...(setupHold > 0 ? ['  delay(' + setupHold + ');'] : []),
    '}',
    '',
    'void loop() {',
    '  digitalWrite(13, HIGH);',
    '  delay(' + high + ');',
    '  digitalWrite(13, LOW);',
    '  delay(' + low + ');',
    '}',
  ].join('\n');
}
const initialSource = 'void setup() {}\nvoid loop() { delay(100); }';

function circuit(wiring: 'normal' | 'open' | 'reversed' = 'normal'): SchematicDocument {
  const boardPins = ownerCatalog.components.find((row) => row.componentId === 'arduino-uno');
  if (!boardPins) throw new Error('The actual owner catalog has no Arduino Uno pins');
  const components: SchematicDocument['components'] = [
    {
      id: 'uno',
      kind: 'visual',
      componentTypeId: 'arduino-uno',
      variantId: 'arduino-uno',
      name: 'Arduino Uno',
      position: { x: 140, y: 140 },
      rotation: 0,
      value: 5,
      pinIds: boardPins.pins.map((pin) => pin.id),
      stateProperties: {
        arduinoSource: initialSource,
        arduinoCodeMode: 'text',
        arduinoWorkspace: '',
        arduinoSerialOpen: false,
        arduinoBaudRate: 9600,
      },
    },
    {
      id: 'r0',
      kind: 'resistor',
      componentTypeId: 'resistor-axial',
      variantId: 'resistor-axial',
      name: '330 Ом',
      position: { x: 620, y: 220 },
      rotation: 90,
      value: 330,
      pinIds: ['lead-1', 'lead-2'],
      stateProperties: { tolerancePercent: 5, resistanceUnit: 'Ом', powerRatingWatt: 0.25 },
    },
    {
      id: 'led0',
      kind: 'led',
      componentTypeId: 'led-5mm',
      variantId: 'led-5mm',
      name: 'D13 — красный светодиод',
      position: { x: 760, y: 220 },
      rotation: 0,
      value: 2,
      pinIds: ['anode', 'cathode'],
      stateProperties: { colour: 'red', ledColour: 'red', ledBrightness: 0, ledFault: 'none' },
    },
  ];
  const endpoints: Array<[string, string, string, string]> = [
    ['uno', 'd13', 'r0', 'lead-1'],
    ['r0', 'lead-2', 'led0', wiring === 'reversed' ? 'cathode' : 'anode'],
    ['led0', wiring === 'reversed' ? 'anode' : 'cathode', 'uno', 'power-gnd-1'],
  ];
  return {
    schemaVersion: 4,
    components,
    connections: endpoints
      .filter((_, index) => wiring !== 'open' || index !== 2)
      .map(([from, fromPin, to, toPin], index) => ({
        id: 'w' + index,
        from: { componentId: from, terminal: fromPin },
        to: { componentId: to, terminal: toPin },
        color: '#149447',
        vertices: [],
      })),
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

async function installObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const host = window as ProbeWindow;
    host.__classroomD13 = {
      epoch: 0,
      label: 'page-startup',
      source: '',
      markedAt: performance.now(),
      frames: [],
      paints: [],
      gpio: [],
      clicks: [],
      errors: [],
      inflight: [],
      observerErrors: [],
      finishedAt: null,
    };
    let workerCounter = 0;
    const pending = new Set<string>();
    const eventKeys = new Set<string>();
    const decoded = new Map<string, boolean>();
    const mountedImages = new WeakMap<SVGImageElement, { href: string; at: number }>();
    let lastAt: number | null = null;
    let previousSignature = '';
    let previousEpoch = -1;
    document.addEventListener(
      'load',
      (event) => {
        if (event.target instanceof SVGImageElement)
          mountedImages.set(event.target, {
            href: event.target.href.baseVal,
            at: performance.now(),
          });
      },
      true,
    );
    document.addEventListener(
      'error',
      (event) => {
        if (event.target instanceof SVGImageElement) mountedImages.delete(event.target);
      },
      true,
    );

    window.Worker = new Proxy(window.Worker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget) as Worker;
        if ((args[1] as WorkerOptions | undefined)?.name !== 'asa-electronics-simulation')
          return worker;
        const workerId = ++workerCounter;
        const requests = new Map<
          string,
          {
            at: number;
            source: string;
            generationId: number;
            engineRevision: string;
            epoch: number;
          }
        >();
        const post = worker.postMessage.bind(worker);
        const terminate = worker.terminate.bind(worker);
        worker.terminate = () => {
          for (const id of requests.keys()) pending.delete(workerId + ':' + id);
          requests.clear();
          host.__classroomD13!.inflight.push({
            at: performance.now(),
            count: pending.size,
            reason: 'actual-worker-termination',
          });
          terminate();
        };
        worker.postMessage = ((...values: unknown[]) => {
          const request = values[0] as ElectronicsSimulationWorkerRequest;
          if (request.kind === 'advance') {
            const probe = host.__classroomD13!;
            requests.set(request.requestId, {
              at: performance.now(),
              source: String(
                request.document.components.find((row) => row.id === 'uno')?.stateProperties?.[
                  'arduinoSource'
                ] ?? '',
              ),
              generationId: request.generationId,
              engineRevision: request.engineRevision,
              epoch: probe.epoch,
            });
            pending.add(workerId + ':' + request.requestId);
            probe.inflight.push({
              at: performance.now(),
              count: pending.size,
              reason: 'post-advance',
            });
          }
          Reflect.apply(post, worker, values);
        }) as Worker['postMessage'];
        worker.addEventListener('message', (event: MessageEvent) => {
          const response = event.data as ElectronicsSimulationWorkerResponse;
          const request = requests.get(response.requestId);
          requests.delete(response.requestId);
          const probe = host.__classroomD13!;
          if (pending.delete(workerId + ':' + response.requestId))
            probe.inflight.push({ at: performance.now(), count: pending.size, reason: 'response' });
          if (!response.ok) {
            probe.errors.push({
              at: performance.now(),
              requestId: response.requestId,
              code: response.code,
            });
            return;
          }
          if (response.kind !== 'advance' || !request || request.epoch !== probe.epoch) return;
          const advance = response.advance;
          let board:
            | { componentId: string; loadedSource?: string | null; runtime: ArduinoRuntimeState }
            | undefined;
          try {
            const serialized = advance.state.continuation?.serializedState;
            if (serialized)
              board = (
                JSON.parse(serialized) as { boards: NonNullable<typeof board>[] }
              ).boards.find((row) => row.componentId === 'uno');
          } catch (error) {
            probe.observerErrors.push('continuation decode: ' + String(error));
          }
          const receivedAt = performance.now();
          probe.frames.push({
            at: receivedAt,
            workerId,
            requestId: response.requestId,
            requestAt: request.at,
            source: request.source,
            generationId: response.generationId,
            requestedGenerationId: request.generationId,
            projectSessionId: response.projectSessionId,
            engineRevision: request.engineRevision,
            metricsRevision: response.metrics.solverRevision,
            protocolVersion: response.protocolVersion,
            status: advance.executionStatus,
            requestedUs: advance.requestedHorizonMicroseconds,
            committedUs: advance.committedHorizonMicroseconds,
            continuationUs: advance.state.continuation?.committedHorizonMicroseconds ?? null,
            computeMs: response.metrics.computeMs,
            hasResult: advance.result !== null,
            solved: advance.result?.solved === true,
            quality: advance.result?.quality ?? null,
            diagnostics: advance.diagnostics,
            components:
              advance.result?.components.filter((row) =>
                ['uno', 'r0', 'led0'].includes(row.componentId),
              ) ?? [],
            optical: advance.ledTemporal ?? null,
            loadedSource: board?.loadedSource ?? null,
            fingerprint: board?.runtime.programFingerprint ?? null,
            d13Voltage: board?.runtime.outputVoltages.d13 ?? null,
            runtimeEvents: [...(board?.runtime.eventQueue ?? [])],
            nextEventSequence: board?.runtime.nextEventSequence ?? null,
          });
          for (const item of board?.runtime.eventQueue ?? []) {
            if (item.kind !== 'output-change' || item.terminal !== 'd13') continue;
            const key =
              probe.epoch + ':' + workerId + ':' + response.generationId + ':' + item.sequence;
            if (!eventKeys.has(key)) {
              eventKeys.add(key);
              probe.gpio.push({
                at: receivedAt,
                generationId: response.generationId,
                workerId,
                event: item,
              });
            }
          }
        });
        return worker;
      },
    });
    document.addEventListener(
      'click',
      (event) => {
        const element = event.target as Element | null;
        const action = element?.closest('[aria-label="Начать моделирование"]')
          ? 'start'
          : element?.closest('[data-testid="arduino-reset-button"]')
            ? 'reset'
            : element?.closest('[aria-label="Остановить моделирование"]')
              ? 'stop'
              : null;
        if (action)
          host.__classroomD13!.clicks.push({
            at: performance.now(),
            action,
            trusted: event.isTrusted,
          });
      },
      true,
    );
    const visibleAncestors = (element: Element | null) => {
      let opacity = 1;
      let visible = !!element;
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        opacity *= Number(style.opacity);
        visible &&= style.display !== 'none' && style.visibility === 'visible';
      }
      return { visible, opacity };
    };
    const imageWitness = (svg: SVGSVGElement | null): ImageWitness => {
      const image = [...(svg?.querySelectorAll<SVGImageElement>('image') ?? [])].find(
        (candidate) => !candidate.closest('.workbench-selection-silhouette'),
      );
      const href = image?.href.baseVal ?? '';
      if (href && !decoded.has(href)) {
        decoded.set(href, false);
        const resource = new Image();
        resource.src = href;
        void resource.decode().then(
          () => decoded.set(href, resource.naturalWidth > 0 && resource.naturalHeight > 0),
          () => decoded.set(href, false),
        );
      }
      const style = visibleAncestors(image ?? null);
      const mounted = image ? mountedImages.get(image) : undefined;
      const box = image?.getBoundingClientRect();
      const component = svg?.closest('[data-component-id]');
      // The real SVG image ignores pointer input. Use the existing ready-cadence
      // hit-test technique, synchronously restoring its exact style before paint.
      // This changes no pixel, timing state, wire, event or model value.
      const hits: Array<Element | undefined> = [];
      if (image && box) {
        const originalStyle = image.getAttribute('style');
        try {
          image.style.setProperty('pointer-events', 'all', 'important');
          for (const fraction of [0.35, 0.5, 0.65])
            hits.push(
              document.elementsFromPoint(
                box.left + box.width * fraction,
                box.top + box.height * 0.5,
              )[0],
            );
        } finally {
          image.setAttribute('style', originalStyle ?? '');
          if (originalStyle === null) image.removeAttribute('style');
        }
      }
      const unoccluded =
        hits.length === 3 && hits.every((hit) => !!hit && !!component?.contains(hit));
      return {
        href,
        decoded: decoded.get(href) === true,
        opacity: style.opacity,
        mountedLoadAt: mounted?.href === href ? mounted.at : null,
        visible:
          style.visible &&
          !!box &&
          box.width > 0 &&
          box.height > 0 &&
          box.left >= 0 &&
          box.top >= 0 &&
          box.right <= innerWidth &&
          box.bottom <= innerHeight &&
          image?.getAttribute('data-owner-image-status') !== 'failed',
        unoccluded,
        rect: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
      };
    };
    const paint = () => {
      const probe = host.__classroomD13!;
      const ledSvg = document.querySelector<SVGSVGElement>(
        '[data-component-id="led0"] .workbench-production-visual',
      );
      const boardSvg = document.querySelector<SVGSVGElement>(
        '[data-component-id="uno"] .workbench-production-visual',
      );
      const l = boardSvg?.querySelector<SVGRectElement>('[data-testid="arduino-led-l"]');
      if (ledSvg && boardSvg && l) {
        const led = imageWitness(ledSvg);
        const boardImage = imageWitness(boardSvg);
        const brightness = Number(ledSvg.getAttribute('data-led-brightness') ?? 'NaN');
        const ledLit = ledSvg.classList.contains('is-lit');
        const lActive = l.getAttribute('data-active') === 'true';
        const lOpacity = Number(getComputedStyle(l).opacity);
        const lBox = l.getBoundingClientRect();
        const lStyle = visibleAncestors(l.parentElement);
        const lVisible =
          lStyle.visible &&
          lStyle.opacity === 1 &&
          lBox.width > 0 &&
          lBox.height > 0 &&
          lBox.left >= 0 &&
          lBox.top >= 0 &&
          lBox.right <= innerWidth &&
          lBox.bottom <= innerHeight;
        const assetsReady =
          [led, boardImage].every(
            (image) =>
              image.decoded &&
              image.mountedLoadAt !== null &&
              image.visible &&
              image.unoccluded &&
              image.opacity === 1,
          ) &&
          lVisible &&
          lOpacity === Number(lActive) &&
          Number.isFinite(brightness) &&
          ledLit === brightness > 0;
        const running =
          document
            .querySelector('.workbench-pill.simulate')
            ?.getAttribute('data-simulation-status') ?? null;
        const signature = JSON.stringify([
          brightness,
          ledLit,
          lActive,
          lOpacity,
          assetsReady,
          led.href,
          boardImage.href,
          running,
        ]);
        const at = performance.now();
        probe.paints.push({
          at,
          previousAt: lastAt,
          stable: previousEpoch === probe.epoch && previousSignature === signature,
          brightness,
          ledLit,
          lActive,
          lOpacity,
          led,
          board: boardImage,
          lVisible,
          assetsReady,
          running,
          timeText: document.querySelector('.workbench-simulation-time')?.textContent ?? '',
        });
        lastAt = at;
        previousSignature = signature;
        previousEpoch = probe.epoch;
      }
      requestAnimationFrame(paint);
    };
    requestAnimationFrame(paint);
  });
}

async function mark(page: Page, label: string, source: string): Promise<void> {
  await page.evaluate(
    ({ label, source }) => {
      const host = window as ProbeWindow;
      const previous = host.__classroomD13!;
      host.__classroomD13 = {
        epoch: previous.epoch + 1,
        label,
        source,
        markedAt: performance.now(),
        frames: [],
        paints: [],
        gpio: [],
        clicks: [],
        errors: [],
        inflight: [],
        observerErrors: [],
        finishedAt: null,
      };
    },
    { label, source },
  );
}
async function snapshot(page: Page): Promise<Probe> {
  return page.evaluate(() => ({
    ...(window as ProbeWindow).__classroomD13!,
    finishedAt: performance.now(),
  }));
}
function persist(label: string, value: unknown): string {
  const path = resolve(artifactRoot, label + '.json');
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
  return path;
}
function sourceManifest() {
  return Object.fromEntries(
    sourcePaths.map((path) => {
      const present = existsSync(resolve(path));
      return [
        path,
        {
          present,
          sha256: present
            ? createHash('sha256')
                .update(readFileSync(resolve(path)))
                .digest('hex')
            : null,
        },
      ];
    }),
  );
}
async function provenance(page: Page) {
  const response = await page
    .context()
    .request.get(new URL('/build-metadata.json', page.url()).href);
  expect(response.status(), 'the real built editor must publish its source identity').toBe(200);
  const build = (await response.json()) as { revision: string; builtAt?: string };
  expect(build.revision).toMatch(/^[0-9a-f]{40}$/);
  const expected =
    process.env['ASA_ELECTRONICS_EXPECTED_SHA'] ??
    process.env['ASA_BUILD_REVISION'] ??
    process.env['GITHUB_SHA'];
  if (expected && /^[0-9a-f]{40}$/.test(expected)) expect(build.revision).toBe(expected);
  return {
    phase,
    build,
    expectedRevision: expected ?? null,
    sourceSha256: sourceManifest(),
    browserVersion: page.context().browser()?.version() ?? null,
    viewport: page.viewportSize(),
    workflowRun: process.env['GITHUB_RUN_ID'] ?? null,
  };
}
type SavedProject = { draft: { revision: number; updatedAt: string; document: SchematicDocument } };
async function openFixture(
  page: Page,
  name: string,
  wiring: 'normal' | 'open' | 'reversed' = 'normal',
) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await installObserver(page);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await loginWithOrganization(page, teacher);
  const origin = new URL(page.url()).origin;
  const created = await page.context().request.post('/api/projects', {
    headers: { origin, 'idempotency-key': crypto.randomUUID() },
    data: {
      scope: 'personal',
      classroomId: null,
      module: 'electronics',
      title: 'Classroom D13 ' + name,
    },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { project: { id: string } }).project.id;
  const endpoint = '/api/projects/' + id;
  const read = async (): Promise<SavedProject> => {
    const response = await page.context().request.get(endpoint, { headers: { origin } });
    expect(response.status()).toBe(200);
    return response.json() as Promise<SavedProject>;
  };
  const empty = await read();
  const seed = await page.context().request.put(endpoint + '/draft', {
    headers: { origin },
    data: {
      document: circuit(wiring),
      baseRevision: empty.draft.revision,
      mutationId: crypto.randomUUID(),
    },
  });
  expect(seed.status()).toBe(200);
  await page.goto('/#/home/' + id);
  await expect(page.locator('.workbench-stage')).toBeVisible();
  await expect(
    page.locator('[data-component-id="led0"] .workbench-production-visual'),
  ).toBeVisible();
  const build = await provenance(page);
  persist(name + '-setup', { id, wiring, document: await read(), provenance: build });
  return { id, endpoint, origin, read, failures, build };
}
async function editor(page: Page, open: boolean): Promise<void> {
  const button = page.getByRole('button', {
    name: open ? 'Открыть редактор кода' : 'Закрыть редактор кода',
    exact: true,
  });
  await button.click();
  if (open) await expect(page.locator('.arduino-source-editor textarea')).toBeVisible();
  else await expect(page.locator('.arduino-code-panel')).toHaveClass(/closed/);
}
async function edit(page: Page, source: string): Promise<void> {
  await editor(page, true);
  await page.locator('.arduino-source-editor textarea').fill(source);
  await expect(page.locator('.arduino-source-editor textarea')).toHaveValue(source);
  await editor(page, false);
}
async function save(page: Page, session: Awaited<ReturnType<typeof openFixture>>, source: string) {
  const previous = await session.read();
  const put = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === session.endpoint + '/draft' &&
      response.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
  const response = await put;
  expect(response.status()).toBe(200);
  const requestBody = response.request().postDataJSON() as {
    document: SchematicDocument;
    baseRevision: number;
  };
  const saved = await session.read();
  const expected = {
    ...previous.draft.document,
    components: previous.draft.document.components.map((component) =>
      component.id === 'uno'
        ? {
            ...component,
            stateProperties: { ...component.stateProperties, arduinoSource: source },
          }
        : component,
    ),
  };
  expect(requestBody.document).toEqual(expected);
  expect(requestBody.baseRevision).toBe(previous.draft.revision);
  expect(saved.draft.document).toEqual(expected);
  expect(saved.draft.revision).toBe(previous.draft.revision + 1);
  persist('save-' + session.id + '-' + saved.draft.revision, {
    previous,
    requestBody,
    saved,
    expected,
  });
  return saved;
}
function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
function edges(rows: readonly { at: number; level: number; receivedAt?: number }[]): Edge[] {
  const result: Edge[] = [];
  for (const row of rows) if (result.at(-1)?.level !== row.level) result.push(row);
  return result;
}
function periods(sequence: readonly Edge[]) {
  const high: number[] = [],
    low: number[] = [],
    full: number[] = [];
  const first = sequence.findIndex((row) => row.level === 1);
  for (let index = first; index >= 0 && index + 2 < sequence.length; index += 2) {
    const a = sequence[index]!,
      b = sequence[index + 1]!,
      c = sequence[index + 2]!;
    if (a.level !== 1 || b.level !== 0 || c.level !== 1) break;
    high.push(b.at - a.at);
    low.push(c.at - b.at);
    full.push(c.at - a.at);
  }
  return { high, low, full };
}
function analyse(
  raw: Probe,
  high: number,
  low: number,
  wiring: 'normal' | 'open' | 'reversed' = 'normal',
): Metrics {
  const findings: string[] = [];
  const phaseDiagnostics: string[] = [];
  const check = (condition: boolean, message: string) => {
    if (!condition && findings.length < 100) findings.push(message);
  };
  const click = raw.clicks.find((row) => row.action === 'start' || row.action === 'reset');
  check(!!click?.trusted, 'no actual trusted Run/Reset click');
  check(raw.observerErrors.length === 0, 'observer errors: ' + raw.observerErrors.join('; '));
  const relevant = raw.frames.filter((frame) => frame.source === raw.source);
  const ready = relevant.filter((frame) => frame.status === 'ready');
  check(ready.length >= 2, 'no complete electrical progression');
  check(
    new Set(ready.map((frame) => frame.generationId)).size === 1,
    'unexpected generation change inside one Run/Reset observation',
  );
  check(
    new Set(ready.map((frame) => frame.projectSessionId)).size === 1,
    'unexpected project session change inside one observation',
  );
  check(!raw.errors.some((error) => error.code !== 'cancelled'), 'worker failure occurred');
  let previous: Frame | undefined;
  for (const frame of relevant) {
    check(
      frame.generationId === frame.requestedGenerationId,
      'generation mismatch ' + frame.requestId,
    );
    check(
      frame.protocolVersion === 2 && frame.engineRevision === frame.metricsRevision,
      'protocol/source identity mismatch ' + frame.requestId,
    );
    check(frame.projectSessionId.length > 0, 'missing project session ' + frame.requestId);
    check(
      frame.requestAt !== null && frame.at >= frame.requestAt,
      'invalid receipt time ' + frame.requestId,
    );
    check(
      frame.computeMs !== null && Number.isFinite(frame.computeMs) && frame.computeMs >= 0,
      'invalid compute evidence ' + frame.requestId,
    );
    if (frame.status === 'yielded') {
      check(
        !frame.hasResult && frame.optical === null,
        'yielded state published as an electrical picture',
      );
      continue;
    }
    check(frame.status === 'ready', 'fault instead of ready ' + frame.requestId);
    check(
      frame.solved && frame.quality?.passed === true,
      'failed electrical quality ' + frame.requestId,
    );
    check(
      frame.committedUs === frame.requestedUs && frame.continuationUs === frame.committedUs,
      'incomplete canonical frame ' + frame.requestId,
    );
    check(frame.loadedSource === raw.source, 'edited source not loaded ' + frame.requestId);
    check(
      /^arduino-v1-/.test(frame.fingerprint ?? ''),
      'missing runtime fingerprint ' + frame.requestId,
    );
    if (previous && previous.generationId === frame.generationId)
      check(frame.committedUs >= previous.committedUs, 'canonical clock moved backwards');
    const led = frame.components.find((component) => component.componentId === 'led0');
    check(
      !!led && Number.isFinite(led.current) && Number.isFinite(led.brightness),
      'missing finite electrical LED state',
    );
    if (led) {
      check(
        led.brightness! > 0
          ? led.current > 0.001 && led.current < 0.02
          : Math.abs(led.current) < 0.000001,
        'light is inconsistent with actual forward current',
      );
      if (wiring !== 'normal')
        check(
          led.brightness === 0 && Math.abs(led.current) < 0.000001,
          wiring + ' LED emitted electrical light',
        );
    }
    if (frame.optical) {
      const optical = frame.optical;
      check(optical.profile === 'ordinary-led-held-v1', 'unrecognized electrical temporal profile');
      check(
        optical.toMicroseconds === frame.committedUs,
        'optical horizon differs from ready horizon',
      );
      if (!previous)
        check(
          optical.fromMicroseconds === 0,
          'MISSING_HISTORY: startup electrical prefix does not begin at zero',
        );
      if (previous?.generationId === frame.generationId)
        check(optical.fromMicroseconds === previous.committedUs, 'optical history gap');
      const channel = optical.components.find((component) => component.componentId === 'led0');
      check(
        !!channel && !channel.truncated && channel.samples.length > 0,
        'missing/truncated LED history',
      );
      if (channel?.samples.length) {
        check(
          channel.samples[0]!.atMicroseconds === optical.fromMicroseconds &&
            channel.samples.at(-1)!.atMicroseconds === optical.toMicroseconds,
          'optical endpoints missing',
        );
        let integral = 0,
          litDuration = 0,
          transitions = 0;
        for (let index = 0; index < channel.samples.length; index++) {
          const sample = channel.samples[index]!,
            next = channel.samples[index + 1];
          check(
            Number.isSafeInteger(sample.atMicroseconds) &&
              Number.isFinite(sample.current) &&
              sample.brightness >= 0 &&
              sample.brightness <= 100,
            'nonfinite optical sample',
          );
          check(
            sample.atMicroseconds >= optical.fromMicroseconds &&
              sample.atMicroseconds <= optical.toMicroseconds,
            'optical sample outside completed interval',
          );
          check(
            sample.brightness > 0
              ? sample.current > 0.001 && sample.current < 0.02
              : Math.abs(sample.current) < 0.000001,
            'optical light not supported by actual forward current',
          );
          if (wiring !== 'normal')
            check(sample.brightness === 0, wiring + ' LED has nonzero optical history');
          if (next) {
            const duration = next.atMicroseconds - sample.atMicroseconds;
            check(duration > 0, 'unordered optical samples');
            integral += sample.brightness * duration;
            if (sample.brightness > 0) litDuration += duration;
            if (sample.brightness !== next.brightness) transitions++;
          }
        }
        check(
          Math.abs(integral - channel.brightnessIntegral) < 0.00001 &&
            litDuration === channel.litDurationMicroseconds &&
            transitions === channel.transitionCount,
          'optical integral/history mismatch',
        );
        check(
          channel.samples.at(-1)!.brightness === led?.brightness &&
            channel.samples.at(-1)!.current === led?.current,
          'optical final state differs from solved LED',
        );
      }
    } else check(false, 'MISSING_HISTORY: no complete electrical temporal history');
    previous = frame;
  }
  const allEvents = new Map<number, RuntimeEvent>();
  for (const frame of relevant) {
    for (const event of frame.runtimeEvents) {
      const prior = allEvents.get(event.sequence);
      check(
        !prior || JSON.stringify(prior) === JSON.stringify(event),
        'runtime history changed an already observed event',
      );
      allEvents.set(event.sequence, event);
    }
  }
  const eventSequence = [...allEvents.keys()].sort((a, b) => a - b);
  const nextSequence = Math.max(...relevant.map((frame) => frame.nextEventSequence ?? -1));
  check(
    nextSequence > 0 &&
      eventSequence.length === nextSequence &&
      eventSequence.every((sequence, index) => sequence === index),
    'MISSING_HISTORY: complete runtime event prefix was not observed from sequence zero',
  );
  check(
    raw.gpio.every(
      (row) => typeof row.event.voltage === 'number' && Number.isFinite(row.event.voltage),
    ),
    'missing finite D13 voltage in actual GPIO history',
  );
  const completeGpio = new Map<number, { event: RuntimeEvent; receivedAt: number }>();
  for (const frame of ready)
    for (const event of frame.runtimeEvents)
      if (
        event.kind === 'output-change' &&
        event.terminal === 'd13' &&
        !completeGpio.has(event.sequence)
      )
        completeGpio.set(event.sequence, { event, receivedAt: frame.at });
  const sourceEvents = [...completeGpio.values()].map((row) => ({
    at: row.event.atMicroseconds / 1000,
    level: Number((row.event.voltage ?? NaN) >= 2.5),
    receivedAt: row.receivedAt,
  }));
  const gpioEdges = edges(sourceEvents);
  const opticalRows = ready.flatMap(
    (frame) =>
      frame.optical?.components
        .find((component) => component.componentId === 'led0')
        ?.samples.map((sample) => ({
          at: sample.atMicroseconds / 1000,
          level: Number(sample.brightness > 0),
          receivedAt: frame.at,
        })) ?? [],
  );
  const modelEdges = wiring === 'normal' && opticalRows.length ? edges(opticalRows) : gpioEdges;
  if (wiring === 'normal' && opticalRows.length) {
    check(
      modelEdges.length === gpioEdges.length,
      'solved optical transition count differs from the complete D13 GPIO prefix',
    );
    for (let index = 0; index < modelEdges.length; index++) {
      const model = modelEdges[index]!,
        gpio = gpioEdges[index];
      check(
        !!gpio && model.level === gpio.level && Math.abs(model.at - gpio.at) <= 0.001,
        'solved optical transition differs from its real D13 electrical event',
      );
    }
  }
  const physicalPeriods = periods(modelEdges);
  for (const [name, values, expected] of [
    ['HIGH', physicalPeriods.high, high],
    ['LOW', physicalPeriods.low, low],
  ] as const)
    check(
      values.length >= completeCycles &&
        values.every(
          (value) =>
            Math.round(value * 1000) >= expected * 1000 &&
            Math.round(value * 1000) <= expected * 1000 + 50,
        ),
      'incorrect model ' + name + ' phase duration',
    );
  const paints = raw.paints.filter(
    (paint) =>
      paint.stable && paint.previousAt !== null && paint.previousAt >= (click?.at ?? raw.markedAt),
  );
  const firstLit = paints.find(
    (paint) => paint.assetsReady && (wiring === 'normal' ? paint.ledLit : paint.lActive),
  );
  const startupMs = firstLit && click ? firstLit.previousAt! - click.at : null;
  check(
    startupMs !== null && startupMs >= 0 && startupMs <= startupLimitMs,
    'first visible HIGH exceeds 5 seconds',
  );
  const activePaints = paints.filter(
    (paint) => !!firstLit && paint.previousAt! >= firstLit.previousAt!,
  );
  check(
    activePaints.every((paint) => paint.assetsReady),
    'actual body/L image lost, hidden or occluded during blinking',
  );
  if (wiring === 'normal')
    check(
      activePaints.every((paint) => paint.ledLit === paint.lActive),
      'D13 L and external LED show different phases',
    );
  else
    check(
      activePaints.every((paint) => !paint.ledLit && paint.brightness === 0),
      wiring + ' LED visibly glowed',
    );
  const completePaintedPrefix = edges(
    paints
      .filter((paint) => paint.assetsReady)
      .map((paint) => ({
        at: paint.previousAt!,
        level: Number(wiring === 'normal' ? paint.ledLit : paint.lActive),
      })),
  );
  const firstPaintedHigh = completePaintedPrefix.findIndex((row) => row.level === 1);
  const paintedEdges = firstPaintedHigh >= 0 ? completePaintedPrefix.slice(firstPaintedHigh) : [];
  const observed = periods(paintedEdges);
  check(
    observed.full.length >= completeCycles,
    'fewer than eight complete visible cycles in 45 seconds',
  );
  const selectedHigh = observed.high.slice(0, completeCycles);
  const selectedLow = observed.low.slice(0, completeCycles);
  const selectedPeriods = observed.full.slice(0, completeCycles);
  const highMedian = median(selectedHigh),
    lowMedian = median(selectedLow),
    periodMedian = median(selectedPeriods);
  for (const [name, values, middle] of [
    ['HIGH', selectedHigh, highMedian],
    ['LOW', selectedLow, lowMedian],
  ] as const) {
    check(
      middle !== null && values.every((duration) => duration >= 1000 / 30),
      'visible ' + name + ' phase is shorter than 33 ms',
    );
    if (
      middle === null ||
      !values.every((duration) => Math.abs(duration - middle) <= Math.max(1000 / 30, middle * 0.25))
    )
      phaseDiagnostics.push(name + ' first-eight phase jitter exceeds max(33 ms, 25% of median)');
  }
  if (highMedian !== null && lowMedian !== null) {
    const ratio = lowMedian / highMedian;
    if (high === low) {
      check(
        ratio >= 0.8 && ratio <= 1.25,
        'symmetric LOW/HIGH median ratio outside 0.8..1.25: ' + ratio,
      );
    } else
      check(
        ratio >= (0.8 * low) / high && ratio <= (1.2 * low) / high,
        'visible asymmetric HIGH/LOW duration ratio contradicts the sketch',
      );
  }
  // Match actual sequence prefixes, not merely the presence of HIGH and LOW.
  const firstModelHigh = modelEdges.findIndex((row) => row.level === 1);
  for (let index = 0; index < paintedEdges.length; index++) {
    const logical = modelEdges[firstModelHigh + index],
      painted = paintedEdges[index]!;
    check(
      !!logical && logical.level === painted.level,
      'visible transition order differs from solved history',
    );
    check(
      !!logical && logical.receivedAt !== undefined && painted.at + 1 >= logical.receivedAt,
      'visible transition precedes its complete electrical result',
    );
  }
  // Every receipt and stable painted frame is checked, with the entire prefix
  // retained. Initial LOW is evidence, not an invented missing transition.
  const regularModel = firstModelHigh >= 0 ? modelEdges.slice(firstModelHigh) : [];
  const startupEndsAt = paintedEdges[0]?.at;
  const checkpoints = [
    ...new Set([...ready.map((frame) => frame.at), ...paints.map((paint) => paint.previousAt!)]),
  ]
    .filter((at) => startupEndsAt !== undefined && at >= startupEndsAt)
    .sort((a, b) => a - b);
  const backlog = checkpoints.map((at) => {
    const completed = regularModel.filter(
      (row) => row.receivedAt !== undefined && row.receivedAt <= at + 1,
    ).length;
    const painted = paintedEdges.filter((row) => row.at <= at).length;
    return { at, completed, painted, unpresented: completed - painted };
  });
  check(
    backlog.every((row) => row.unpresented >= 0),
    'painted prefix contains an uncompleted electrical transition',
  );
  const maxBacklog = backlog.length ? Math.max(...backlog.map((row) => row.unpresented)) : null;
  const maxInflight = raw.inflight.length
    ? Math.max(...raw.inflight.map((row) => row.count))
    : null;
  check(maxInflight !== null && maxInflight <= 1, 'more than one actual Worker advance in flight');
  const modelMedian = median(physicalPeriods.full.slice(0, completeCycles));
  return {
    findings,
    phaseDiagnostics,
    cycles: observed.full.length,
    startupMs,
    modelEdges,
    paintedEdges,
    highMs: selectedHigh,
    lowMs: selectedLow,
    periodsMs: selectedPeriods,
    medianHighMs: highMedian,
    medianLowMs: lowMedian,
    medianPeriodMs: periodMedian,
    modelMedianPeriodMs: modelMedian,
    measuredSlowdown:
      periodMedian !== null && modelMedian !== null ? periodMedian / modelMedian : null,
    maxInflight,
    maxBacklog,
    backlog,
    initialization: {
      model: modelEdges.slice(0, Math.max(firstModelHigh, 0)),
      painted: completePaintedPrefix.slice(0, Math.max(firstPaintedHigh, 0)),
      firstModelHigh,
      firstPaintedHigh,
    },
  };
}

async function capture(
  page: Page,
  label: string,
  source: string,
  high: number,
  low = high,
  wiring: 'normal' | 'open' | 'reversed' = 'normal',
  action: 'start' | 'reset' = 'start',
) {
  await mark(page, label, source);
  if (action === 'reset') await page.getByTestId('arduino-reset-button').click();
  else await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
  let observationError: string | null = null;
  try {
    await page.waitForFunction(
      ({ cycles, wiring }) => {
        const raw = (window as ProbeWindow).__classroomD13!;
        let last = false,
          rises = 0;
        const clicked = raw.clicks.find(
          (row) => row.action === 'start' || row.action === 'reset',
        )?.at;
        if (clicked === undefined) return false;
        for (const paint of raw.paints) {
          if (
            !paint.stable ||
            !paint.assetsReady ||
            paint.previousAt === null ||
            paint.previousAt < clicked
          )
            continue;
          const lit = wiring === 'normal' ? paint.ledLit : paint.lActive;
          if (lit && !last) rises++;
          last = lit;
        }
        return rises >= cycles + 1;
      },
      { cycles: completeCycles, wiring },
      { timeout: observationTimeoutMs, polling: 100 },
    );
  } catch (error) {
    observationError = String(error);
  }
  // Freeze and write the full prefix before any assertion, screenshot or risky cleanup.
  const raw = await snapshot(page);
  const metrics = analyse(raw, high, low, wiring);
  if (observationError) metrics.findings.push('observation deadline: ' + observationError);
  const path = persist(label + '-raw', {
    phase,
    expectedBaselineFailure: before,
    source,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    raw,
    metrics,
    observedVerdict: metrics.findings.length ? 'FAIL' : 'PASS',
    acceptance: before ? 'NOT_APPLICABLE_BEFORE' : metrics.findings.length ? 'FAIL' : 'PASS',
  });
  await test
    .info()
    .attach(label + '-complete-timeseries', { path, contentType: 'application/json' });
  return { raw, metrics };
}
async function stop(page: Page, label: string): Promise<number> {
  let error: string | null = null;
  try {
    await page
      .getByRole('button', { name: 'Остановить моделирование', exact: true })
      .click({ timeout: 1_000 });
    await page.waitForFunction(
      () => {
        const raw = (window as ProbeWindow).__classroomD13!;
        const click = raw.clicks.filter((row) => row.action === 'stop').at(-1);
        return (
          !!click?.trusted &&
          raw.paints.some(
            (paint) =>
              paint.stable &&
              paint.assetsReady &&
              paint.previousAt !== null &&
              paint.previousAt >= click.at &&
              paint.running === 'stopped' &&
              !paint.ledLit &&
              paint.brightness === 0 &&
              !paint.lActive &&
              paint.lOpacity === 0,
          )
        );
      },
      undefined,
      { timeout: 1_000, polling: 'raf' },
    );
  } catch (caught) {
    error = String(caught);
  }
  const raw = await snapshot(page);
  const click = raw.clicks.filter((row) => row.action === 'stop').at(-1);
  const dark = raw.paints.find(
    (paint) =>
      !!click?.trusted &&
      paint.stable &&
      paint.assetsReady &&
      paint.previousAt !== null &&
      paint.previousAt >= click.at &&
      paint.running === 'stopped' &&
      !paint.ledLit &&
      paint.brightness === 0 &&
      !paint.lActive &&
      paint.lOpacity === 0,
  );
  const elapsed = dark && click ? dark.previousAt! - click.at : Infinity;
  persist(label + '-stop', {
    visibleStopMs: Number.isFinite(elapsed) ? elapsed : null,
    limitMs: 1_000,
    actualClick: click,
    firstStableDark: dark,
    error,
    passed: elapsed <= 1_000,
  });
  return elapsed;
}
async function nativeSamples(page: Page, label: string): Promise<string[]> {
  const findings: string[] = [];
  for (const active of [true, false]) {
    let unambiguous = false;
    for (let attempt = 0; attempt < 3 && !unambiguous; attempt++) {
      await page.waitForFunction(
        (active) => {
          const paint = (window as ProbeWindow).__classroomD13?.paints.at(-1);
          return (
            paint?.stable &&
            paint.assetsReady &&
            paint.ledLit === active &&
            paint.lActive === active
          );
        },
        active,
        { timeout: 5_000 },
      );
      const beforeShot = await page.evaluate(() =>
        (window as ProbeWindow).__classroomD13!.paints.at(-1)!,
      );
      const name = label + (active ? '-high-' : '-low-') + attempt;
      const path = resolve(artifactRoot, name + '.png');
      await page.screenshot({ path });
      const during = await page.evaluate(
        (start) =>
          (window as ProbeWindow).__classroomD13!.paints.filter((paint) => paint.at >= start),
        beforeShot.at,
      );
      unambiguous =
        during.length >= 2 &&
        during.every(
          (paint) => paint.assetsReady && paint.ledLit === active && paint.lActive === active,
        );
      persist(name + '-image', { beforeShot, during, path, unambiguousPhase: unambiguous });
      await test.info().attach(name + '-native', { path, contentType: 'image/png' });
    }
    if (!unambiguous)
      findings.push(
        'native image never captured an unambiguous ' + (active ? 'HIGH' : 'LOW') + ' phase',
      );
  }
  return findings;
}
function finish(info: TestInfo, findings: string[], extra: unknown = null): void {
  persist(info.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 100) + '-verdict', {
    phase,
    criteriaVersion: 'classroom-d13-2026-10-19-v1',
    expectedBaselineFailure: before,
    observedVerdict: findings.length ? 'FAIL' : 'PASS',
    acceptance: before ? 'NOT_APPLICABLE_BEFORE' : findings.length ? 'FAIL' : 'PASS',
    findings,
    extra,
  });
  if (!before) expect(findings, 'real classroom D13 acceptance').toEqual([]);
}

test.use({ video: 'on' });
test.beforeAll(() => {
  admin = e2eAdminPool();
  mkdirSync(artifactRoot, { recursive: true });
});
test.beforeEach(async ({ browserName }, info) => {
  void browserName;
  artifactRoot = resolve(
    artifactBaseRoot,
    info.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 100) +
      '-worker-' +
      info.workerIndex +
      '-retry-' +
      info.retry,
  );
  mkdirSync(artifactRoot, { recursive: true });
  teacher = await seedTeacher(
    admin,
    'classroom-d13-' + info.workerIndex + '-' + info.retry + '-' + Date.now(),
  );
});
test.afterAll(async () => {
  await admin.end();
});
test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) {
    const raw = await snapshot(page);
    const path = persist(info.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 100) + '-final-prefix', {
      phase,
      harnessStatus: info.status,
      expectedStatus: info.expectedStatus,
      raw,
    });
    await info.attach('complete-final-prefix-even-on-failure', {
      path,
      contentType: 'application/json',
    });
  }
});

test('Classroom D13: visible 100, 200, 300, 150 and asymmetric phases on one circuit', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  const session = await openFixture(page, 'timing-matrix');
  const findings: string[] = [];
  const results = new Map<number, Metrics>();
  try {
    for (const half of [100, 200, 300, 150]) {
      const source = blink(half);
      await edit(page, source);
      const result = await capture(page, 'matrix-' + half, source, half);
      findings.push(...result.metrics.findings.map((message) => half + ' ms: ' + message));
      results.set(half, result.metrics);
      if (half === 300 && result.metrics.cycles >= completeCycles)
        findings.push(...(await nativeSamples(page, 'matrix-300')));
      if ((await stop(page, 'matrix-' + half)) > 1_000)
        findings.push(half + ' ms: Stop exceeded 1 second');
    }
    const source = blink(100, 300);
    await edit(page, source);
    const asymmetric = await capture(page, 'matrix-100-high-300-low', source, 100, 300);
    findings.push(...asymmetric.metrics.findings.map((message) => '100/300 ms: ' + message));
    if ((await stop(page, 'matrix-asymmetric')) > 1_000)
      findings.push('asymmetric: Stop exceeded 1 second');
    const t = (half: number) => results.get(half)?.medianPeriodMs ?? NaN;
    if (!(t(100) < t(150) && t(150) < t(200) && t(200) < t(300)))
      findings.push('visible periods are not strictly ordered T100 < T150 < T200 < T300');
    for (const [half, lower, upper] of [
      [150, 1.2, 1.8],
      [200, 1.6, 2.4],
      [300, 2.4, 3.6],
    ]) {
      const ratio = t(half!) / t(100);
      if (!(ratio >= lower! && ratio <= upper!)) findings.push('T' + half + '/T100 = ' + ratio);
    }
    // One actual Save after real pupil source edits, preserving the entire circuit.
    const saved = await save(page, session, source);
    expect(saved.draft.document.connections).toEqual(circuit().connections);
    session.failures.assertEmpty();
    finish(info, findings, {
      results: Object.fromEntries(results),
      asymmetric: asymmetric.metrics,
      saved,
    });
  } finally {
    persist('matrix-final-prefix', await snapshot(page));
  }
});

test('Classroom D13: failed edit, correction, Reset and cookies-only saved reopen', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const session = await openFixture(page, 'edit-reset-save');
  const findings: string[] = [];
  const valid = blink(100);
  await edit(page, valid);
  const initial = await capture(page, 'lifecycle-initial', valid, 100);
  findings.push(...initial.metrics.findings);
  const invalid = valid.replace('delay(100);', 'thisFunctionDoesNotExist(100);');
  await editor(page, true);
  await page.locator('.arduino-source-editor textarea').fill(invalid);
  await expect(page.locator('.arduino-source-editor textarea')).toHaveValue(invalid);
  // Do not mandate a new lastGood policy; the error must be visible and no invalid source may be claimed loaded.
  await expect(page.locator('.arduino-code-check.has-blockers')).toBeVisible({ timeout: 5_000 });
  const errorRaw = await snapshot(page);
  persist('lifecycle-invalid-code', {
    invalid,
    raw: errorRaw,
    diagnosticsText: await page.locator('#arduino-source-diagnostics').innerText(),
  });
  await page.screenshot({ path: resolve(artifactRoot, 'lifecycle-invalid-code.png') });
  if (errorRaw.frames.some((frame) => frame.loadedSource === invalid && frame.solved))
    findings.push('invalid edited source was represented as successfully loaded');
  await editor(page, false);
  if (await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).isVisible())
    await stop(page, 'lifecycle-before-correction');
  const corrected = blink(150, 150, 300);
  await edit(page, corrected);
  const fixed = await capture(page, 'lifecycle-corrected', corrected, 150);
  findings.push(...fixed.metrics.findings.map((message) => 'correction: ' + message));
  const oldGeneration = fixed.raw.frames
    .filter((frame) => frame.status === 'ready')
    .at(-1)?.generationId;
  const reset = await capture(page, 'lifecycle-reset', corrected, 150, 150, 'normal', 'reset');
  findings.push(...reset.metrics.findings.map((message) => 'Reset: ' + message));
  const firstReady = reset.raw.frames.find((frame) => frame.status === 'ready');
  if (
    !firstReady ||
    firstReady.generationId === oldGeneration ||
    firstReady.optical?.fromMicroseconds !== 0
  )
    findings.push('Reset did not start a new generation at model time zero');
  const resetClick = reset.raw.clicks.find((click) => click.action === 'reset');
  if (!resetClick?.trusted) findings.push('Reset was not an actual trusted UI action');
  const setup = reset.raw.frames.filter(
    (frame) =>
      frame.status === 'ready' &&
      frame.generationId === firstReady?.generationId &&
      frame.committedUs < 300_000,
  );
  if (
    setup.length < 2 ||
    setup.some(
      (frame) =>
        (frame.components.find((row) => row.componentId === 'led0')?.brightness ?? -1) !== 0,
    )
  )
    findings.push('Reset did not reproduce the explicit LOW setup hold');
  if ((await stop(page, 'lifecycle-reset')) > 1_000)
    findings.push('Reset scenario: Stop exceeded 1 second');
  const saved = await save(page, session, corrected);
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    recordVideo: { dir: artifactRoot },
  });
  try {
    await context.addCookies(await page.context().cookies());
    const reopened = await context.newPage();
    await installObserver(reopened);
    const reopenedFailures = collectBrowserFailures(reopened, { allowAnonymousSessionProbe: true });
    await reopened.goto(session.origin + '/#/home/' + session.id);
    await expect(reopened.locator('.workbench-stage')).toBeVisible();
    await provenance(reopened);
    await editor(reopened, true);
    await expect(reopened.locator('.arduino-source-editor textarea')).toHaveValue(corrected);
    await editor(reopened, false);
    const opened = await capture(reopened, 'lifecycle-cookies-reopen', corrected, 150);
    findings.push(...opened.metrics.findings.map((message) => 'cookies-only reopen: ' + message));
    if ((await stop(reopened, 'lifecycle-cookies-reopen')) > 1_000)
      findings.push('cookies-only reopen: Stop exceeded 1 second');
    const response = await context.request.get(session.origin + session.endpoint, {
      headers: { origin: session.origin },
    });
    expect(response.status()).toBe(200);
    const final = (await response.json()) as SavedProject;
    persist('lifecycle-saved-reopened', { saved, final });
    expect(final.draft).toEqual(saved.draft);
    reopenedFailures.assertEmpty();
  } finally {
    await context.close();
  }
  session.failures.assertEmpty();
  finish(info, findings, {
    initial: initial.metrics,
    corrected: fixed.metrics,
    reset: reset.metrics,
    saved,
  });
});

for (const wiring of ['open', 'reversed'] as const) {
  test(
    'Classroom D13: ' + wiring + ' LED stays dark while real D13 L blinks',
    async ({ page }, info) => {
      test.setTimeout(75_000);
      const session = await openFixture(page, 'negative-' + wiring, wiring);
      const source = blink(100);
      await edit(page, source);
      const result = await capture(page, 'negative-' + wiring, source, 100, 100, wiring);
      await page.screenshot({ path: resolve(artifactRoot, 'negative-' + wiring + '.png') });
      if ((await stop(page, 'negative-' + wiring)) > 1_000)
        result.metrics.findings.push('Stop exceeded 1 second');
      session.failures.assertEmpty();
      finish(info, result.metrics.findings, result.metrics);
    },
  );
}

test('Classroom D13: sixty-second bounded running and responsive Stop', async ({ page }, info) => {
  test.setTimeout(100_000);
  const session = await openFixture(page, 'sustained');
  const source = blink(100);
  await edit(page, source);
  await mark(page, 'sustained-60-seconds', source);
  await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
  // Persist increments while the run is alive: the full startup prefix survives a later tool/page failure.
  for (let second = 5; second <= 60; second += 5) {
    await page.waitForFunction(
      (seconds) => {
        const probe = (window as ProbeWindow).__classroomD13!;
        const click = probe.clicks.find((row) => row.action === 'start');
        return !!click && performance.now() - click.at >= seconds * 1000;
      },
      second,
      { timeout: 7_000, polling: 100 },
    );
    persist('sustained-progress-complete-prefix', {
      throughSeconds: second,
      raw: await snapshot(page),
    });
  }
  const raw = await snapshot(page);
  const metrics = analyse(raw, 100, 100);
  const findings = [...metrics.findings];
  const start = raw.clicks.find((row) => row.action === 'start')?.at;
  if (start === undefined || raw.finishedAt === null || raw.finishedAt - start < 60_000)
    findings.push('sustained observation did not cover sixty seconds from actual Run');
  if (metrics.maxBacklog === null || metrics.backlog.length < 2)
    findings.push('MISSING_HISTORY: no comparable complete electrical/painted prefix for backlog');
  else if (metrics.maxBacklog > 2)
    findings.push('completed electrical transitions exceed the painted prefix by more than two');
  const lastPaint = raw.paints.at(-1)?.at;
  if (lastPaint === undefined || raw.finishedAt === null || raw.finishedAt - lastPaint > 1_000)
    findings.push('no live rendered image at the end of the sixty-second observation');
  persist('sustained-final-before-stop', {
    raw,
    metrics,
    findings,
    backlogContract:
      'completed electrical prefix minus painted prefix, initial LOW recorded separately, maximum 2',
  });
  const stoppedMs = await stop(page, 'sustained');
  if (stoppedMs > 1_000) findings.push('Stop was not visibly complete within 1 second');
  session.failures.assertEmpty();
  finish(info, findings, { metrics, stoppedMs });
});
