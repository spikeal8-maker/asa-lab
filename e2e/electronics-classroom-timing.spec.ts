import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page, type Response, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import type pg from 'pg';
import type { SchematicDocument } from '../apps/web/src/api';
import type { ArduinoRuntimeState } from '../contexts/electronics/domain/arduino-program-runtime';
import { resolveElectricalModelIdentity } from '../contexts/electronics/domain/model-identity';
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
  'apps/web/src/electronics/led-temporal-presentation.ts',
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
  lRect: ImageWitness['rect'];
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
const probeArrayKeys = [
  'frames',
  'paints',
  'gpio',
  'clicks',
  'errors',
  'inflight',
  'observerErrors',
] as const;
type ProbeArrayKey = (typeof probeArrayKeys)[number];
type ProbeOffsets = Record<ProbeArrayKey, number>;
type ProbeHeader = Omit<Probe, ProbeArrayKey>;
// Frames contain growing runtime history. Encode each receipt exactly once;
// returning nested history through Playwright on every poll expands the trace
// and blocks the very renderer being measured. These strings are observation
// records only, never inputs to the simulator.
type BrowserProbe = Omit<Probe, 'frames'> & { frames: string[] };
type TransferCut = {
  token: string;
  header: ProbeHeader;
  from: ProbeOffsets;
  to: ProbeOffsets;
  characters: number;
};
type ProbeWindow = Window & {
  __classroomD13?: BrowserProbe;
  __classroomD13Transfer?: {
    probe: BrowserProbe;
    cut: TransferCut;
    text: string;
  };
};
type ProbeArchive = {
  raw: Probe;
  cuts: Array<TransferCut & { path: string; sha256: string }>;
};
const probeArchives = new WeakMap<Page, ProbeArchive>();
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
    const append = <T>(rows: T[], value: T): void => {
      const copy = typeof value === 'string' ? value : structuredClone(value);
      const freeze = (item: unknown): void => {
        if (!item || typeof item !== 'object' || Object.isFrozen(item)) return;
        for (const child of Object.values(item)) freeze(child);
        Object.freeze(item);
      };
      freeze(copy);
      // A previously recorded row cannot be changed, deleted or truncated.
      // The next array index remains appendable. Never freeze a product object.
      Object.defineProperty(rows, rows.length, {
        value: copy,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    };
    host.__classroomD13 = Object.freeze({
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
    });
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
          append(host.__classroomD13!.inflight, {
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
            append(probe.inflight, {
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
            append(probe.inflight, {
              at: performance.now(),
              count: pending.size,
              reason: 'response',
            });
          if (!response.ok) {
            append(probe.errors, {
              at: performance.now(),
              requestId: response.requestId,
              code: response.code,
            });
            return;
          }
          // Keep late responses from a pre-mark request. Analysis must reject
          // every stale post-click frame, rather than hiding it by request epoch.
          if (response.kind !== 'advance' || !request) return;
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
            append(probe.observerErrors, 'continuation decode: ' + String(error));
          }
          const receivedAt = performance.now();
          append(
            probe.frames,
            JSON.stringify({
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
            } satisfies Frame),
          );
          for (const item of board?.runtime.eventQueue ?? []) {
            if (item.kind !== 'output-change' || item.terminal !== 'd13') continue;
            const key =
              probe.epoch + ':' + workerId + ':' + response.generationId + ':' + item.sequence;
            if (!eventKeys.has(key)) {
              eventKeys.add(key);
              append(probe.gpio, {
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
          append(host.__classroomD13!.clicks, {
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
        append(probe.paints, {
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
          lRect: { x: lBox.x, y: lBox.y, width: lBox.width, height: lBox.height },
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
      host.__classroomD13 = Object.freeze({
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
      });
      delete host.__classroomD13Transfer;
    },
    { label, source },
  );
  probeArchives.delete(page);
}
async function snapshot(page: Page): Promise<Probe> {
  let archive = probeArchives.get(page);
  const from = Object.fromEntries(
    probeArrayKeys.map((key) => [key, archive?.raw[key].length ?? 0]),
  ) as ProbeOffsets;
  const expected = archive
    ? {
        epoch: archive.raw.epoch,
        label: archive.raw.label,
        source: archive.raw.source,
        markedAt: archive.raw.markedAt,
      }
    : null;
  const cut = await page.evaluate(
    ({ keys, from, expected }) => {
      const host = window as ProbeWindow;
      const probe = host.__classroomD13;
      if (!probe) throw new Error('MISSING_HISTORY: observer was not installed');
      if (
        expected &&
        (probe.epoch !== expected.epoch ||
          probe.label !== expected.label ||
          probe.source !== expected.source ||
          probe.markedAt !== expected.markedAt)
      )
        throw new Error('MISSING_HISTORY: transfer epoch/source changed');
      const same = (a: ProbeOffsets, b: ProbeOffsets) => keys.every((key) => a[key] === b[key]);
      const previous = host.__classroomD13Transfer;
      if (previous) {
        if (previous.probe !== probe) throw new Error('MISSING_HISTORY: probe was replaced');
        // An interrupted transfer can request the identical immutable cut again.
        if (same(from, previous.cut.from) && !same(from, previous.cut.to)) return previous.cut;
        if (!same(from, previous.cut.to))
          throw new Error('MISSING_HISTORY: transfer skipped, repeated or reversed an offset');
      } else if (keys.some((key) => from[key] !== 0)) {
        throw new Error('MISSING_HISTORY: transfer did not begin at row zero');
      }
      const to = Object.fromEntries(keys.map((key) => [key, probe[key].length])) as ProbeOffsets;
      if (
        keys.some((key) => !Number.isSafeInteger(from[key]) || from[key] < 0 || to[key] < from[key])
      )
        throw new Error('MISSING_HISTORY: append-only prefix was truncated');
      const header: ProbeHeader = {
        epoch: probe.epoch,
        label: probe.label,
        source: probe.source,
        markedAt: probe.markedAt,
        finishedAt: performance.now(),
      };
      // The fixed lengths and timestamp are one cut. Rendering continues while
      // its already recorded text is delivered; later rows belong to the next cut.
      const text =
        '{' +
        keys
          .map(
            (key) =>
              JSON.stringify(key) +
              ':' +
              (key === 'frames'
                ? '[' + probe.frames.slice(from.frames, to.frames).join(',') + ']'
                : JSON.stringify(probe[key].slice(from[key], to[key]))),
          )
          .join(',') +
        '}';
      const cut: TransferCut = {
        token: probe.epoch + ':' + JSON.stringify(from) + ':' + JSON.stringify(to),
        header,
        from,
        to,
        characters: text.length,
      };
      host.__classroomD13Transfer = { probe, cut, text };
      return cut;
    },
    { keys: probeArrayKeys, from, expected },
  );
  if (
    probeArrayKeys.some((key) => cut.from[key] !== from[key]) ||
    (expected &&
      (cut.header.epoch !== expected.epoch ||
        cut.header.source !== expected.source ||
        cut.header.label !== expected.label ||
        cut.header.markedAt !== expected.markedAt))
  )
    throw new Error('MISSING_HISTORY: returned transfer boundary does not match host prefix');
  const cutIndex = archive?.cuts.length ?? 0;
  const path = resolve(
    artifactRoot,
    cut.header.label + '-epoch-' + cut.header.epoch + '-cut-' + cutIndex + '.wire.json',
  );
  const receiptPath = path.replace('.wire.json', '.receipt.json');
  writeFileSync(path, '');
  const chunks: Array<{ fromCharacter: number; toCharacter: number; bytes: number }> = [];
  const pieces: string[] = [];
  const digest = createHash('sha256');
  writeFileSync(receiptPath, JSON.stringify({ cut, complete: false, chunks }) + '\n');
  let offset = 0;
  while (offset < cut.characters) {
    const chunk = await page.evaluate(
      ({ token, offset }) => {
        const host = window as ProbeWindow;
        const transfer = host.__classroomD13Transfer;
        if (!transfer || transfer.cut.token !== token || transfer.probe !== host.__classroomD13)
          throw new Error('MISSING_HISTORY: transfer token/epoch changed');
        if (!Number.isSafeInteger(offset) || offset < 0 || offset >= transfer.text.length)
          throw new Error('MISSING_HISTORY: invalid character offset');
        let end = Math.min(offset + 256 * 1024, transfer.text.length);
        // Do not split a UTF-16 surrogate pair when writing separate UTF-8 chunks.
        const last = transfer.text.charCodeAt(end - 1);
        if (end < transfer.text.length && last >= 0xd800 && last <= 0xdbff) end--;
        return {
          token,
          fromCharacter: offset,
          toCharacter: end,
          text: transfer.text.slice(offset, end),
        };
      },
      { token: cut.token, offset },
    );
    if (
      chunk.token !== cut.token ||
      chunk.fromCharacter !== offset ||
      chunk.toCharacter !== offset + chunk.text.length ||
      chunk.text.length === 0 ||
      chunk.text.length > 256 * 1024 ||
      chunk.toCharacter > cut.characters
    )
      throw new Error('MISSING_HISTORY: character chunk was lost, duplicated or reordered');
    appendFileSync(path, chunk.text);
    digest.update(chunk.text);
    pieces.push(chunk.text);
    chunks.push({
      fromCharacter: offset,
      toCharacter: chunk.toCharacter,
      bytes: Buffer.byteLength(chunk.text),
    });
    offset = chunk.toCharacter;
  }
  const delta = JSON.parse(pieces.join('')) as Pick<Probe, ProbeArrayKey>;
  if (
    Object.keys(delta).length !== probeArrayKeys.length ||
    probeArrayKeys.some(
      (key) => !Array.isArray(delta[key]) || delta[key].length !== cut.to[key] - cut.from[key],
    )
  )
    throw new Error('MISSING_HISTORY: decoded row counts differ from the fixed cut');
  if (!archive) {
    archive = {
      raw: {
        ...cut.header,
        frames: [],
        paints: [],
        gpio: [],
        clicks: [],
        errors: [],
        inflight: [],
        observerErrors: [],
      },
      cuts: [],
    };
    probeArchives.set(page, archive);
  }
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  for (const key of probeArrayKeys) {
    if (archive.raw[key].length !== cut.from[key])
      throw new Error('MISSING_HISTORY: host prefix changed during transfer');
    for (const row of delta[key]) {
      freeze(row);
      (archive.raw[key] as unknown[]).push(row);
    }
  }
  archive.raw.finishedAt = cut.header.finishedAt;
  const sha256 = digest.digest('hex');
  archive.cuts.push({ ...cut, path, sha256 });
  writeFileSync(receiptPath, JSON.stringify({ cut, complete: true, chunks, sha256 }) + '\n');
  persist(cut.header.label + '-transport-index', {
    format: 'classroom-lossless-append-cuts-v1',
    cuts: archive.cuts,
    counts: cut.to,
  });
  // A snapshot is a fixed host prefix, not an alias that later appends can grow.
  return {
    ...archive.raw,
    ...Object.fromEntries(probeArrayKeys.map((key) => [key, archive!.raw[key].slice()])),
  } as Probe;
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
function observeDraftSaves(page: Page, endpoint: string, origin: string) {
  const responses: Response[] = [];
  const matches = (response: Response) =>
    new URL(response.url()).origin === origin &&
    new URL(response.url()).pathname === endpoint + '/draft' &&
    response.request().method() === 'PUT';
  page.on('response', (response) => {
    if (matches(response)) responses.push(response);
  });
  return { responses, matches };
}
async function openFixture(
  page: Page,
  name: string,
  wiring: 'normal' | 'open' | 'reversed' = 'normal',
) {
  const document = circuit(wiring);
  // Capture the intended circuit before opening the editor or observing autosave.
  // The current model registry adds only these four identity fields per component.
  const intendedDocument: SchematicDocument = {
    ...document,
    components: document.components.map((component) => {
      const identity = resolveElectricalModelIdentity(component);
      return {
        ...component,
        electricalModelId: identity.electricalModelId,
        electricalModelVersion: identity.electricalModelVersion,
        modelProfileId: identity.modelProfileId,
        modelProfileVersion: identity.modelProfileVersion,
      };
    }),
  };
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
      document,
      baseRevision: empty.draft.revision,
      mutationId: crypto.randomUUID(),
    },
  });
  expect(seed.status()).toBe(200);
  // Observe actual browser writes before any pupil edit; autosave may finish
  // during the long optical captures, before the later persistence checkpoint.
  const persistence = observeDraftSaves(page, endpoint, origin);
  await page.goto('/#/home/' + id);
  await expect(page.locator('.workbench-stage')).toBeVisible();
  await expect(
    page.locator('[data-component-id="led0"] .workbench-production-visual'),
  ).toBeVisible();
  const build = await provenance(page);
  persist(name + '-setup', {
    id,
    wiring,
    intendedDocument,
    document: await read(),
    provenance: build,
  });
  return { id, endpoint, origin, read, failures, build, persistence, intendedDocument };
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
  const expected = {
    ...session.intendedDocument,
    components: session.intendedDocument.components.map((component) =>
      component.id === 'uno'
        ? {
            ...component,
            stateProperties: { ...component.stateProperties, arduinoSource: source },
          }
        : component,
    ),
  };
  const matchesSource = (response: Response) => {
    if (!session.persistence.matches(response)) return false;
    const body = response.request().postDataJSON() as { document?: SchematicDocument } | null;
    return (
      body?.document?.components.find((component) => component.id === 'uno')?.stateProperties
        ?.arduinoSource === source
    );
  };
  const observed = session.persistence.responses.findLast(matchesSource);
  // There is no await between the retained lookup and installing the waiter.
  // A saved/disabled label alone cannot satisfy this actual HTTP receipt check.
  const response = observed ?? (await page.waitForResponse(matchesSource));
  expect(response.status()).toBe(200);
  expect(await response.finished()).toBeNull();
  const requestBody = response.request().postDataJSON() as {
    document: SchematicDocument;
    baseRevision: number;
  };
  const responseBody = (await response.json()) as SavedProject;
  const saved = await session.read();
  expect(requestBody.document).toEqual(expected);
  expect(responseBody.draft.document).toEqual(expected);
  expect(responseBody.draft.revision).toBe(requestBody.baseRevision + 1);
  expect(saved.draft.document).toEqual(expected);
  expect(saved.draft.revision).toBe(responseBody.draft.revision);
  if (previous.draft.revision === requestBody.baseRevision) {
    expect(saved.draft.revision).toBe(previous.draft.revision + 1);
  } else {
    // The pre-read may already contain this same completed autosave. Require
    // its whole document and the actual PUT's single revision increment.
    expect(previous.draft.revision).toBe(requestBody.baseRevision + 1);
    expect(previous.draft.document).toEqual(expected);
    expect(saved.draft.revision).toBe(previous.draft.revision);
  }
  persist('save-' + session.id + '-' + saved.draft.revision, {
    previous,
    requestBody,
    saved,
    expected,
    responseBody,
    observedAtLookup: observed !== undefined,
    request: {
      method: response.request().method(),
      url: response.url(),
      timing: response.request().timing(),
    },
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
  const click = raw.clicks.find(
    (row) => row.trusted && (row.action === 'start' || row.action === 'reset'),
  );
  check(!!click?.trusted, 'no actual trusted Run/Reset click');
  check(raw.observerErrors.length === 0, 'observer errors: ' + raw.observerErrors.join('; '));
  // mark() starts retention; the actual trusted input starts acceptance. Keep
  // every pre-click row in raw, and inspect every post-click response regardless
  // of source or generation so that a genuinely late stale frame cannot vanish.
  const actionAt = click?.at ?? raw.markedAt;
  const relevant = raw.frames.filter((frame) => frame.at >= actionAt);
  check(
    relevant.every((frame) => frame.source === raw.source),
    'stale source response after actual Run/Reset click',
  );
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
  check(
    !raw.errors.some((error) => error.at >= actionAt && error.code !== 'cancelled'),
    'worker failure occurred',
  );
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
    raw.gpio
      .filter((row) => row.at >= actionAt)
      .every((row) => typeof row.event.voltage === 'number' && Number.isFinite(row.event.voltage)),
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
  const inflight = raw.inflight.filter((row) => row.at >= actionAt);
  const inflightAtAction = raw.inflight.filter((row) => row.at < actionAt).at(-1);
  if (inflightAtAction) inflight.unshift(inflightAtAction);
  const maxInflight = inflight.length ? Math.max(...inflight.map((row) => row.count)) : null;
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

function d13BoardInsideCaptureViewport(
  board: { x: number; y: number; width: number; height: number } | null,
  stage: { x: number; y: number; width: number; height: number } | null,
  viewport: { width: number; height: number } | null,
): boolean {
  if (!board || !stage || !viewport) return false;
  if (
    ![
      board.x,
      board.y,
      board.width,
      board.height,
      stage.x,
      stage.y,
      stage.width,
      stage.height,
      viewport.width,
      viewport.height,
    ].every(Number.isFinite) ||
    board.width <= 0 ||
    board.height <= 0 ||
    stage.width <= 0 ||
    stage.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return false;
  return (
    board.x >= Math.max(0, stage.x) &&
    board.y >= Math.max(0, stage.y) &&
    board.x + board.width <= Math.min(viewport.width, stage.x + stage.width) &&
    board.y + board.height <= Math.min(viewport.height, stage.y + stage.height)
  );
}

async function prepareD13CaptureViewport(page: Page): Promise<void> {
  // Closing the drawer sets its class before its 170ms visibility transition.
  // Fit only after it is actually hidden, using the normal pupil UI.
  await expect(page.locator('.arduino-code-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Подогнать проект', exact: true }).click();
  const board = await page
    .locator('[data-component-id="uno"] .workbench-production-visual image')
    .first()
    .boundingBox();
  const stage = await page.locator('.workbench-canvas').boundingBox();
  expect(
    d13BoardInsideCaptureViewport(board, stage, page.viewportSize()),
    'D13 capture requires the whole native board inside the stage and viewport after Fit',
  ).toBe(true);
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
  await prepareD13CaptureViewport(page);
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
          (row) => row.trusted && (row.action === 'start' || row.action === 'reset'),
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
type NativePixelReference = {
  x: number;
  y: number;
  low: number[];
  high: number[];
};
type NativeAssetProof = { state: string; href: string; sha256: string };
type NativeElectricalReceipt = {
  requestId: string;
  generationId: number;
  at: number;
  committedUs: number;
  brightness: number;
  current: number;
};
type NativeAssetBasis = {
  proof: {
    catalogSha256: string;
    sourceSha256: string;
    epoch: number;
    low: NativeAssetProof;
    high: NativeAssetProof;
    board: NativeAssetProof;
    physicalLow: NativeElectricalReceipt;
    physicalHigh: NativeElectricalReceipt;
    lHighRgb: [number, number, number];
  };
  encoded: { low: string; high: string; board: string };
};
function nativeAssetBasis(raw: Probe): NativeAssetBasis {
  const click = raw.clicks.find(
    (row) => row.trusted && (row.action === 'start' || row.action === 'reset'),
  );
  if (!click) throw new Error('native basis has no trusted run action');
  // The semantic reference comes from the solved electrical fixture and the
  // retained catalog, independently of the renderer's href, class or data label.
  // No temporal extension is required, so this also observes the old BEFORE.
  const frames = raw.frames.filter((frame) => frame.at >= click.at && frame.status === 'ready');
  if (!frames.length) throw new Error('native basis has no post-action electrical receipt');
  const states: NativeElectricalReceipt[] = frames.map((frame) => {
    if (
      !frame.solved ||
      frame.quality?.passed !== true ||
      frame.source !== raw.source ||
      frame.loadedSource !== raw.source ||
      frame.generationId !== frames[0]!.generationId
    )
      throw new Error(
        'native basis contains failed, stale or mixed-generation electrical evidence',
      );
    const led = frame.components.find((component) => component.componentId === 'led0');
    const brightness = led?.brightness,
      current = led?.current;
    if (
      typeof brightness !== 'number' ||
      typeof current !== 'number' ||
      !Number.isFinite(brightness) ||
      !Number.isFinite(current) ||
      brightness < 0 ||
      brightness > 100 ||
      (brightness > 0 ? !(current > 0.001 && current < 0.02) : Math.abs(current) >= 0.000001)
    )
      throw new Error('native basis light is inconsistent with solved forward current');
    return {
      requestId: frame.requestId,
      generationId: frame.generationId,
      at: frame.at,
      committedUs: frame.committedUs,
      brightness,
      current,
    };
  });
  const physicalLow = states.find((state) => state.brightness === 0);
  const physicalHigh = states.find((state) => state.brightness > 0);
  if (!physicalLow || !physicalHigh)
    throw new Error('native basis requires both solved LOW and HIGH');
  const level = Math.round(physicalHigh.brightness);
  if (
    level < 1 ||
    states.some((state) => state.brightness > 0 && Math.round(state.brightness) !== level)
  )
    throw new Error('native constant-current fixture has ambiguous HIGH asset level');
  type CatalogAsset = { state?: string; runtimePath: string; runtimeSha256: string };
  const catalogBytes = readFileSync(
    resolve('apps/web/public/assets/electronics/component-database/catalog.json'),
  );
  const catalog = JSON.parse(catalogBytes.toString('utf8')) as {
    components: Array<
      CatalogAsset & {
        componentId: string;
        stateAssets: CatalogAsset[];
        stateContract: { type: string; brightness?: { min: number; max: number; step: number } };
      }
    >;
  };
  const led = catalog.components.find((component) => component.componentId === 'led-5mm');
  const board = catalog.components.find((component) => component.componentId === 'arduino-uno');
  if (
    led?.stateContract.type !== 'ordinary_led' ||
    led.stateContract.brightness?.min !== 0 ||
    led.stateContract.brightness.max !== 100 ||
    led.stateContract.brightness.step !== 1
  )
    throw new Error('native basis requires the retained one-percent ordinary LED catalog contract');
  const ledState = (state: string) => {
    const matches = led.stateAssets.filter((asset) => asset.state === state);
    if (matches.length !== 1)
      throw new Error('native catalog state is missing or ambiguous: ' + state);
    return matches[0]!;
  };
  const read = (asset: CatalogAsset | undefined, state: string, href: string) => {
    if (!asset || asset.runtimePath !== href || !/^[a-f0-9]{64}$/.test(asset.runtimeSha256))
      throw new Error('native catalog asset disagrees with the canonical fixture state: ' + state);
    const bytes = readFileSync(resolve('apps/web/public' + href));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== asset.runtimeSha256)
      throw new Error('native canonical asset SHA mismatch: ' + state);
    return {
      proof: { state, href, sha256 },
      encoded: 'data:image/svg+xml;base64,' + bytes.toString('base64'),
    };
  };
  const ledRoot = '/assets/electronics/component-database/components/led/red/led_red_i';
  const low = read(ledState('red:0'), 'red:0', ledRoot + '000.svg');
  const high = read(
    ledState('red:' + level),
    'red:' + level,
    ledRoot + String(level).padStart(3, '0') + '.svg',
  );
  const uno = read(
    board,
    'arduino-uno:static',
    '/assets/electronics/component-database/components/arduino-uno/arduino-uno/component.svg',
  );
  return {
    proof: {
      catalogSha256: createHash('sha256').update(catalogBytes).digest('hex'),
      sourceSha256: createHash('sha256').update(raw.source).digest('hex'),
      epoch: raw.epoch,
      low: low.proof,
      high: high.proof,
      board: uno.proof,
      physicalLow,
      physicalHigh,
      // Fixed retained UNO L overlay colour, never sampled from live DOM styles.
      lHighRgb: [255, 241, 106],
    },
    encoded: { low: low.encoded, high: high.encoded, board: uno.encoded },
  };
}
type NativeReferences = {
  width: number;
  height: number;
  lowHref: string;
  highHref: string;
  boardHref: string;
  basis: NativeAssetBasis['proof'];
  led: NativePixelReference[];
  l: NativePixelReference[];
};
async function nativeReferences(
  page: Page,
  geometry: Paint,
  width: number,
  height: number,
  basis: NativeAssetBasis,
): Promise<NativeReferences> {
  return page.evaluate(
    async ({ geometry, width, height, basis }) => {
      if (
        ![basis.proof.low.href, basis.proof.high.href].includes(geometry.led.href) ||
        geometry.board.href !== basis.proof.board.href ||
        !geometry.led.rect ||
        !geometry.board.rect ||
        !geometry.lRect
      )
        throw new Error(
          'native reference requires canonical body/board assets and actual L geometry',
        );
      const load = async (href: string) => {
        const image = new Image();
        image.src = href;
        await image.decode();
        if (!image.naturalWidth || !image.naturalHeight)
          throw new Error('native reference asset did not decode');
        return image;
      };
      const [lowImage, highImage, boardImage] = await Promise.all([
        load(basis.encoded.low),
        load(basis.encoded.high),
        load(basis.encoded.board),
      ]);
      // A detached canvas supplies the original asset colours at the actual image
      // geometry. It is never mounted and never changes the editor, LED or clock.
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('native reference canvas unavailable');
      const scaleX = width / innerWidth,
        scaleY = height / innerHeight;
      const points = (rect: NonNullable<ImageWitness['rect']>, vertical: number[]) => {
        const result: Array<{ x: number; y: number }> = [];
        for (const v of vertical)
          for (const u of [0.35, 0.5, 0.65]) {
            const point = {
              x: Math.floor((rect.x + rect.width * u) * scaleX),
              y: Math.floor((rect.y + rect.height * v) * scaleY),
            };
            if (!result.some((row) => row.x === point.x && row.y === point.y)) result.push(point);
          }
        if (result.length < 4)
          throw new Error('native body/L is too small for independent pixel evidence');
        return result;
      };
      const read = (points: Array<{ x: number; y: number }>) =>
        points.map(({ x, y }) => {
          if (x < 0 || y < 0 || x >= width || y >= height)
            throw new Error('native reference point outside screenshot');
          const pixel = [...context.getImageData(x, y, 1, 1).data];
          if (pixel[3] !== 255)
            throw new Error('native reference point is not an opaque body pixel');
          return pixel.slice(0, 3);
        });
      const draw = (image: HTMLImageElement, rect: NonNullable<ImageWitness['rect']>) => {
        context.clearRect(0, 0, width, height);
        const fit = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
        const drawnWidth = image.naturalWidth * fit,
          drawnHeight = image.naturalHeight * fit;
        context.drawImage(
          image,
          (rect.x + (rect.width - drawnWidth) / 2) * scaleX,
          (rect.y + (rect.height - drawnHeight) / 2) * scaleY,
          drawnWidth * scaleX,
          drawnHeight * scaleY,
        );
      };
      const ledPoints = points(geometry.led.rect, [0.3, 0.4, 0.5]);
      draw(lowImage, geometry.led.rect);
      const ledLow = read(ledPoints);
      draw(highImage, geometry.led.rect);
      const ledHigh = read(ledPoints);
      const lPoints = points(geometry.lRect, [0.35, 0.5, 0.65]);
      draw(boardImage, geometry.board.rect);
      const lLow = read(lPoints);
      // Both states use canonical source bytes / a fixed renderer contract.
      // Even swapped hrefs or wrong live CSS cannot relabel the pixel reference.
      context.fillStyle = 'rgb(' + basis.proof.lHighRgb.join(',') + ')';
      context.fillRect(
        geometry.lRect.x * scaleX,
        geometry.lRect.y * scaleY,
        geometry.lRect.width * scaleX,
        geometry.lRect.height * scaleY,
      );
      const lHigh = read(lPoints);
      return {
        width,
        height,
        lowHref: basis.proof.low.href,
        highHref: basis.proof.high.href,
        boardHref: basis.proof.board.href,
        basis: basis.proof,
        led: ledPoints.map((point, index) => ({
          ...point,
          low: ledLow[index]!,
          high: ledHigh[index]!,
        })),
        l: lPoints.map((point, index) => ({ ...point, low: lLow[index]!, high: lHigh[index]! })),
      };
    },
    { geometry, width, height, basis },
  );
}
function classifyNativePng(png: PNG, references: NativeReferences) {
  const classify = (points: NativePixelReference[]) => {
    const actual = points.map(({ x, y }) => {
      const index = (y * png.width + x) * 4;
      return [...png.data.subarray(index, index + 4)];
    });
    const score = (key: 'low' | 'high') => {
      const perPixel = points.map((point, index) =>
        point[key].map((value, channel) => Math.abs(value - actual[index]![channel]!)),
      );
      const errors = perPixel.flat();
      return {
        mean: errors.reduce((sum, value) => sum + value, 0) / errors.length,
        maximum: Math.max(...errors),
        matchingPixels: perPixel.filter((channels) => channels.every((error) => error <= 24))
          .length,
      };
    };
    const low = score('low'),
      high = score('high');
    const separation = points.flatMap((point) =>
      point.low.map((value, channel) => Math.abs(value - point.high[channel]!)),
    );
    const meanSeparation = separation.reduce((sum, value) => sum + value, 0) / separation.length;
    const valid =
      points.length >= 4 &&
      png.width === references.width &&
      png.height === references.height &&
      points.every(
        (point) => point.x >= 0 && point.y >= 0 && point.x < png.width && point.y < png.height,
      ) &&
      actual.every((pixel) => pixel.length === 4 && pixel[3] === 255) &&
      meanSeparation >= 30;
    const matches = (own: typeof low, other: typeof low) =>
      valid &&
      own.mean <= 12 &&
      own.matchingPixels >= Math.ceil(points.length * 0.8) &&
      other.mean - own.mean >= 24;
    const state = matches(high, low) ? 'HIGH' : matches(low, high) ? 'LOW' : 'UNKNOWN';
    return { state, low, high, meanSeparation, actual };
  };
  const led = classify(references.led),
    l = classify(references.l);
  const observedPhase =
    led.state === 'UNKNOWN' || l.state === 'UNKNOWN'
      ? 'UNKNOWN'
      : led.state === l.state
        ? led.state
        : 'MISMATCH';
  return {
    observedPhase,
    led,
    l,
    limits: {
      meanError: 12,
      perChannelError: 24,
      matchingPixelFraction: 0.8,
      minimumSeparation: 30,
      winningMargin: 24,
    },
  };
}
async function nativeSamples(page: Page, label: string, raw: Probe): Promise<string[]> {
  const findings: string[] = [];
  const basis = nativeAssetBasis(raw);
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
      const bytes = await page.screenshot({ path });
      const during = await page.evaluate(
        (start) =>
          (window as ProbeWindow).__classroomD13!.paints.filter((paint) => paint.at >= start),
        beforeShot.at,
      );
      const png = PNG.sync.read(bytes);
      const references = await nativeReferences(page, beforeShot, png.width, png.height, basis);
      const pixels = classifyNativePng(png, references);
      const requestedPhase = active ? 'HIGH' : 'LOW';
      const rects = (paint: Paint) => [paint.led.rect, paint.board.rect, paint.lRect];
      const fixedGeometry =
        during.length >= 2 &&
        during.every((paint) =>
          rects(paint).every((rect, index) => {
            const expected = rects(beforeShot)[index];
            return (
              rect !== null &&
              expected !== null &&
              expected !== undefined &&
              ['x', 'y', 'width', 'height'].every(
                (key) =>
                  Math.abs(
                    rect[key as keyof typeof rect] - expected[key as keyof typeof expected],
                  ) <= 0.25,
              )
            );
          }),
        );
      const coherentWitness = during.some(
        (paint) =>
          paint.stable && paint.assetsReady && paint.ledLit === active && paint.lActive === active,
      );
      unambiguous = fixedGeometry && coherentWitness && pixels.observedPhase === requestedPhase;
      if (pixels.observedPhase === 'MISMATCH')
        findings.push(name + ': actual native PNG shows different body/L phases');
      persist(name + '-image', {
        beforeShot,
        during,
        path,
        requestedPhase,
        references,
        pixels,
        fixedGeometry,
        coherentWitness,
        unambiguousPhase: unambiguous,
        interpretation:
          'PNG pixels determine the observed phase; the requested phase and filename do not. Screenshot transport can span multiple phases.',
      });
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
        findings.push(...(await nativeSamples(page, 'matrix-300', result.raw)));
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
    // Verify an actual browser draft write after pupil edits, preserving the entire circuit.
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
  const resetClick = reset.raw.clicks.find((click) => click.trusted && click.action === 'reset');
  const resetFrames = reset.raw.frames.filter(
    (frame) => resetClick !== undefined && frame.at >= resetClick.at,
  );
  const firstReady = resetFrames.find((frame) => frame.status === 'ready');
  if (
    !firstReady ||
    firstReady.generationId === oldGeneration ||
    firstReady.optical?.fromMicroseconds !== 0
  )
    findings.push('Reset did not start a new generation at model time zero');
  if (!resetClick?.trusted) findings.push('Reset was not an actual trusted UI action');
  const setup = resetFrames.filter(
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
    const progress = await snapshot(page);
    persist('sustained-progress-complete-prefix', {
      throughSeconds: second,
      finishedAt: progress.finishedAt,
      counts: Object.fromEntries(probeArrayKeys.map((key) => [key, progress[key].length])),
      // Each referenced cut is already on disk, including all source/ready/GPIO/
      // paint/error/inflight rows. The complete prefix is assembled on the host.
      losslessCuts: probeArchives.get(page)!.cuts,
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
