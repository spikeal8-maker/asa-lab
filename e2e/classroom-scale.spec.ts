import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type Request,
  type Response,
  type Route,
} from '@playwright/test';
type ScaleContracts = typeof import('../tools/capacity/classroom-scale-contracts.mjs');
type StormContracts = typeof import('../tools/capacity/request-storm-contracts.mjs');
let assertScaleEnvironment: ScaleContracts['assertScaleEnvironment'];
let assertScaleImages: ScaleContracts['assertScaleImages'];
let createScaleLedger: ScaleContracts['createScaleLedger'];
let scaleCohortPlan: ScaleContracts['scaleCohortPlan'];
let SCALE_DATABASE: ScaleContracts['SCALE_DATABASE'];
let SCALE_ORIGIN: ScaleContracts['SCALE_ORIGIN'];
let SCALE_PROFILE: ScaleContracts['SCALE_PROFILE'];
let SCALE_PROFILE_HASH: ScaleContracts['SCALE_PROFILE_HASH'];
let scaleHash: ScaleContracts['scaleHash'];
let stormChromiumResources: StormContracts['stormChromiumResources'];
let stormRoute: StormContracts['stormRoute'];

type Data = Record<string, unknown>;
type Editor = 'electronics' | 'scratch';
type OperationStatus =
  'NOT_STARTED' | 'STARTED' | 'ACKNOWLEDGED' | 'VERIFIED' | 'FAILED' | 'TIMED_OUT';
type ReadbackProof = {
  kind: 'independent-authenticated-api-readback';
  httpStatus: number;
  identityMatched: boolean;
  expectedContentHash: string;
  actualContentHash: string;
  documentHash: string;
  revisionBefore: number;
  revisionAfter: number;
  changeObserved: boolean;
};
type Operation = {
  id: string;
  client: number;
  name: string;
  status: OperationStatus;
  startedAtMs: number | null;
  endedAtMs: number | null;
  durationMs: number | null;
  attempts: number;
  acknowledgedAtMs?: number;
  verification?: ReadbackProof;
  failure?: { kind: string; code: string };
};
type Asset = {
  service: string;
  path: string;
  expectedHash: string;
  bytes: number;
};
type ImageManifest = {
  sourceSha: string;
  imageManifestHash: string;
  images: Array<{ service: string; id: string; revision: string }>;
  assets: Asset[];
};
type HttpRecord = {
  client: number;
  phase: string;
  route: string;
  method: string;
  status: number;
  startedAtMs: number;
  durationMs: number;
  injected: boolean;
  completed: boolean;
};
type NetworkFailure = {
  client: number;
  phase: string;
  route: string;
  method: string;
  error: string;
  expected: boolean;
  reason: string;
  navigationWindow: boolean;
};
type Draft = {
  projectId: string;
  moduleKey: string;
  revision: number;
  document: Data;
};
type Learner = {
  client: number;
  seatId: string;
  studentCode: string;
  classroomId: string;
  classroomCode: string;
  context: BrowserContext;
  page: Page;
  projects: Partial<Record<Editor, string>>;
  drafts: Partial<Record<Editor, Draft>>;
  expected: Partial<Record<Editor, Data>>;
  componentId?: string;
  navigating: boolean;
  closed: boolean;
  telemetryFault?: (route: Route) => Promise<void>;
};

class FixtureFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'FixtureFailure';
  }
}
class IntegrityFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'IntegrityFailure';
  }
}

const execute = promisify(execFile);
const wait = (milliseconds: number) => new Promise<void>((done) => setTimeout(done, milliseconds));
const telemetryPattern = /\/api\/(?:analytics|diagnostics)\//;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const moduleFor = (editor: Editor) => (editor === 'scratch' ? 'blocks' : 'electronics');
function object(value: unknown): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new FixtureFailure('invalid_json_object');
  return value as Data;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new FixtureFailure('missing_response_string');
  return value;
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new FixtureFailure('invalid_revision');
  return Number(value);
}
function identifier(value: unknown): string {
  const result = string(value);
  if (!uuidPattern.test(result)) throw new FixtureFailure('invalid_synthetic_identifier');
  return result;
}
function atomicJson(path: string, value: unknown) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n');
  renameSync(path + '.tmp', path);
}

/** Content expectations are chosen by the workload before editing. None are
 * copied from the later GET, a UI save receipt, or a local draft cache. */
function projection(editor: Editor, document: Data, expected: Data): Data {
  if (editor === 'electronics') {
    const components = Array.isArray(document['components'])
      ? document['components'].map(object)
      : [];
    const selected = components.filter((part) => part['id'] === expected['componentId']);
    return {
      moduleKey: 'electronics',
      componentId: selected[0]?.['id'] ?? null,
      componentTypeId: selected[0]?.['componentTypeId'] ?? null,
      resistanceOhms: selected[0]?.['value'] ?? null,
      matchingComponents: selected.length,
    };
  }
  const projectJson = object(document['projectJson']);
  const targets = Array.isArray(projectJson['targets']) ? projectJson['targets'].map(object) : [];
  const sprites = targets.filter(
    (target) => target['isStage'] === false && target['name'] === expected['spriteName'],
  );
  const assets = Array.isArray(document['assets']) ? document['assets'].map(object) : [];
  const costumes = Array.isArray(sprites[0]?.['costumes'])
    ? (sprites[0]!['costumes'] as unknown[]).map(object)
    : [];
  const storedAssets =
    costumes.length > 0 &&
    costumes.every((costume) =>
      assets.some(
        (asset) =>
          asset['assetId'] === costume['assetId'] &&
          asset['dataFormat'] === costume['dataFormat'] &&
          typeof asset['sha256'] === 'string' &&
          /^[a-f0-9]{64}$/.test(asset['sha256']) &&
          typeof asset['sizeBytes'] === 'number' &&
          asset['sizeBytes'] > 0,
      ),
    );
  return {
    moduleKey: 'blocks',
    spriteName: sprites[0]?.['name'] ?? null,
    matchingSprites: sprites.length,
    x: sprites[0]?.['x'] ?? null,
    y: sprites[0]?.['y'] ?? null,
    stageCount: targets.filter((target) => target['isStage'] === true).length,
    storedCostumeReferences: storedAssets,
  };
}

function draftPath(request: Request, projectId: string): boolean {
  return (
    request.method() === 'PUT' &&
    [
      `/api/projects/${projectId}/draft`,
      `/api/blocks/runtime/projects/${projectId}/draft`,
    ].includes(new URL(request.url()).pathname)
  );
}

/** Only successful real UI writes with the chosen content qualify as ACKs.
 * The independent authenticated GET below is still required for VERIFIED. */
function isExpectedDraft(
  response: Response,
  editor: Editor,
  projectId: string,
  expected: Data,
): boolean {
  if (!draftPath(response.request(), projectId)) return false;
  try {
    const submitted = object(response.request().postDataJSON());
    return (
      scaleHash(projection(editor, object(submitted['document']), expected)) === scaleHash(expected)
    );
  } catch {
    return false;
  }
}

async function editorReady(page: Page, editor: Editor) {
  if (editor === 'electronics') {
    await expect(page.locator('.workbench-stage')).toBeVisible({
      timeout: SCALE_PROFILE.deadlinesMs.editor,
    });
    await expect(page.getByRole('button', { name: 'Сохранить проект', exact: true })).toBeVisible();
    return;
  }
  const frame = page.frameLocator('iframe[title="Scratch runtime"]');
  await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
    'data-editor-state',
    'ready',
    {
      timeout: SCALE_PROFILE.deadlinesMs.editor,
    },
  );
  await expect(
    frame.getByRole('button', { name: /^(Choose a Sprite|Выбрать спрайт)$/ }).first(),
  ).toBeVisible();
}

async function resistanceInput(learner: Learner) {
  if (!learner.componentId) throw new FixtureFailure('resistor_not_placed');
  await learner.page
    .locator(
      `[data-testid="schematic-component"][data-component-id="${learner.componentId}"] .workbench-part`,
    )
    .press('Enter');
  const input = learner.page
    .locator('.workbench-inspector label')
    .filter({ hasText: 'Сопротивление' })
    .locator('input[type="number"]');
  await expect(input).toBeVisible();
  return input;
}

async function placeResistor(learner: Learner) {
  const page = learner.page;
  const card = page.getByRole('button', { name: 'Резистор', exact: true });
  await expect(card).toBeVisible();
  const from = await card.boundingBox();
  const field = await page.locator('.workbench-stage').boundingBox();
  if (!from || !field) throw new FixtureFailure('catalog_or_stage_geometry_missing');
  const previous = await page.getByTestId('schematic-component').count();
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 4, start.y, { steps: 2 });
  await expect(page.locator('.workbench-picked-up')).toHaveCount(1);
  await page.mouse.move(field.x + field.width * 0.45, field.y + field.height * 0.55, { steps: 12 });
  await expect(page.getByTestId('catalog-placement-preview')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.getByTestId('schematic-component')).toHaveCount(previous + 1);
  const resistor = page.locator(
    '[data-testid="schematic-component"][data-component-type="resistor-axial"]',
  );
  await expect(resistor).toHaveCount(1);
  learner.componentId = string(await resistor.getAttribute('data-component-id'));
}

async function editContent(learner: Learner, editor: Editor, step: number) {
  if (editor === 'electronics') {
    if (step === 1) await placeResistor(learner);
    const value = 1000 + learner.client * 10 + step;
    const input = await resistanceInput(learner);
    await input.fill(String(value));
    await input.press('Enter');
    await expect(input).toHaveValue(String(value));
    learner.expected.electronics = {
      moduleKey: 'electronics',
      componentId: learner.componentId,
      componentTypeId: 'resistor-axial',
      resistanceOhms: value,
      matchingComponents: 1,
    };
    return;
  }
  const frame = learner.page.frameLocator('iframe[title="Scratch runtime"]');
  if (step === 1) {
    await frame
      .getByRole('button', { name: /^(Choose a Sprite|Выбрать спрайт)$/ })
      .first()
      .click();
    await frame.getByText('Apple', { exact: true }).click();
    await expect(frame.getByPlaceholder(/^(Name|Имя)$/)).toHaveValue('Apple');
  } else {
    const name = string(learner.expected.scratch?.['spriteName']);
    await frame.getByRole('button', { name, exact: true }).click();
  }
  const name = `Scale-${learner.client}-${step}`;
  const x = (learner.client % 80) + step;
  const input = frame.getByPlaceholder(/^(Name|Имя)$/);
  await input.fill(name);
  await input.press('Enter');
  await expect(input).toHaveValue(name);
  await frame.getByPlaceholder('x', { exact: true }).fill(String(x));
  await frame.getByPlaceholder('x', { exact: true }).press('Enter');
  await frame.getByPlaceholder('y', { exact: true }).fill('0');
  await frame.getByPlaceholder('y', { exact: true }).press('Enter');
  await expect(frame.getByPlaceholder('x', { exact: true })).toHaveValue(String(x));
  learner.expected.scratch = {
    moduleKey: 'blocks',
    spriteName: name,
    matchingSprites: 1,
    x,
    y: 0,
    stageCount: 1,
    storedCostumeReferences: true,
  };
}

async function visibleContent(learner: Learner, editor: Editor) {
  const expected = learner.expected[editor];
  if (!expected) throw new FixtureFailure('expected_edit_missing');
  if (editor === 'electronics') {
    await expect(await resistanceInput(learner)).toHaveValue(String(expected['resistanceOhms']));
    return;
  }
  const frame = learner.page.frameLocator('iframe[title="Scratch runtime"]');
  const sprite = frame.getByRole('button', { name: string(expected['spriteName']), exact: true });
  await expect(sprite).toBeVisible();
  await sprite.click();
  await expect(frame.getByPlaceholder(/^(Name|Имя)$/)).toHaveValue(string(expected['spriteName']));
  await expect(frame.getByPlaceholder('x', { exact: true })).toHaveValue(String(expected['x']));
  await expect(frame.getByPlaceholder('y', { exact: true })).toHaveValue('0');
  await expect
    .poll(() =>
      sprite
        .locator('img')
        .first()
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
}

test.describe('P0 full editor classroom capacity — isolated hosted runner only', () => {
  test.skip(!process.env['ASA_SCALE_USERS'], 'Opt-in owned Compose capacity workload');
  test.beforeAll(async () => {
    ({
      assertScaleEnvironment,
      assertScaleImages,
      createScaleLedger,
      scaleCohortPlan,
      SCALE_DATABASE,
      SCALE_ORIGIN,
      SCALE_PROFILE,
      SCALE_PROFILE_HASH,
      scaleHash,
    } = await import('../tools/capacity/classroom-scale-contracts.mjs'));
    ({ stormChromiumResources, stormRoute } =
      await import('../tools/capacity/request-storm-contracts.mjs'));
  });

  test('all planned pupils authenticate, edit, save, reopen and recover in the full editors', async ({
    browser,
  }) => {
    test.setTimeout(SCALE_PROFILE.levelTimeoutMs);
    const identity = assertScaleEnvironment(process.env, true);
    const users = Number(process.env['ASA_SCALE_USERS']);
    const calibration = process.env['ASA_SCALE_MODE'] === 'calibration';
    const cohorts = scaleCohortPlan(users, calibration).map((cohort) => ({
      ...cohort,
      provisioned: 0,
      classroomHash: null as string | null,
    }));
    const directory = resolve(
      'reports/classroom-scale',
      calibration ? 'calibration' : `level-${users}`,
    );
    mkdirSync(directory, { recursive: true });
    const manifest = JSON.parse(
      readFileSync(resolve('reports/classroom-scale/image-manifest.json'), 'utf8'),
    ) as ImageManifest;
    if (
      manifest.sourceSha !== identity.sourceSha ||
      manifest.imageManifestHash !== process.env['ASA_SCALE_IMAGE_MANIFEST_HASH'] ||
      assertScaleImages(manifest.images, identity.sourceSha) !== manifest.imageManifestHash
    )
      throw new FixtureFailure('mixed_image_manifest');
    const operations = createScaleLedger(users, calibration) as Operation[];
    const learners: Learner[] = [];
    const requestRecords: HttpRecord[] = [];
    const requests = new Map<
      Request,
      { record: HttpRecord; learner: Learner; navigationWindow: boolean }
    >();
    const injected = new WeakSet<Request>();
    const pending = new Set<Promise<void>>();
    const networkFailures: NetworkFailure[] = [];
    const javascriptErrors: Array<{ client: number; phase: string; name: string }> = [];
    const integrityFailures: Array<{ client: number; operation: string; code: string }> = [];
    const observerRequests: HttpRecord[] = [];
    const setupRetries: Array<{
      atMs: number;
      route: string;
      method: string;
      status: 429;
      delayMs: number;
      attempt: number;
    }> = [];
    const browserSamples: Data[] = [];
    const loadedAssets: Array<Asset & { actualHash: string; executed: true }> = [];
    const assetInFlight = new Set<string>();
    const assetManifest = new Map(manifest.assets.map((asset) => [asset.path, asset]));
    const phaseTimes: Array<{ name: string; startedAtMs: number; endedAtMs?: number }> = [];
    const navigationWindows: Array<{
      client: number;
      action: string;
      startedAtMs: number;
      endedAtMs?: number;
    }> = [];
    const games = {
      chessInvitations: 0,
      checkersInvitations: 0,
      chessMatches: 0,
      checkersMatches: 0,
    };
    const accountControl: Data = { status: 'NOT_STARTED' };
    const raw: Data = {
      mode: calibration ? 'calibration' : 'capacity',
      ...identity,
      profileHash: SCALE_PROFILE_HASH,
      users,
      classCount: cohorts.length,
      cohorts,
      operations,
      requests: requestRecords,
      networkFailures,
      browserSamples,
      javascriptErrors,
      integrityFailures,
      observerRequests,
      setupRetries,
      accountControl,
      games,
      provenance: {
        sourceSha: identity.sourceSha,
        imageManifestHash: manifest.imageManifestHash,
        assets: loadedAssets,
      },
      observerErrors: 0,
      droppedObservations: 0,
      elapsedMs: 0,
      measuredTraffic:
        'browser requests only; independent verification reads are reported separately',
      latencyClock: 'Date.now; operation spans STARTED to independently VERIFIED',
      scratchPersistence: 'native upstream minute autosave; no timer or private method changes',
      phaseTimes,
      navigationWindows,
    };
    let phase = 'setup';
    let measuredAt = 0;
    let finishedAt = 0;
    let activeHttp = 0;
    let peakActiveHttp = 0;
    let observerErrors = 0;
    let setupRetryWaitMs = 0;
    let samplePending: Promise<void> | undefined;
    let sampler: ReturnType<typeof setInterval> | undefined;
    let checkpoint: ReturnType<typeof setInterval> | undefined;
    let setupContext: BrowserContext | undefined;
    let accountContext: BrowserContext | undefined;
    let mainEntryPath: string | undefined;
    const observer = new pg.Pool({
      connectionString: process.env['TEST_DATABASE_URL'],
      max: 1,
      connectionTimeoutMillis: 2000,
      statement_timeout: 1500,
      query_timeout: 2000,
      options: '-c default_transaction_read_only=on',
    });

    const checkAbort = () => {
      if (Number(raw['droppedObservations']) > 0)
        throw new FixtureFailure('browser_observer_bound');
      if (existsSync(resolve(directory, 'abort.json'))) {
        raw['runnerBlocked'] = true;
        throw new FixtureFailure('controller_resource_abort');
      }
    };
    const persist = () => {
      raw['elapsedMs'] = measuredAt ? Math.max(1, (finishedAt || Date.now()) - measuredAt) : 0;
      raw['observerErrors'] = observerErrors;
      raw['peakActiveHttp'] = peakActiveHttp;
      atomicJson(resolve(directory, 'raw.json'), raw);
    };
    const beginPhase = (name: string) => {
      const atMs = Date.now();
      const previous = phaseTimes.at(-1);
      if (previous) previous.endedAtMs = atMs;
      phase = name;
      phaseTimes.push({ name, startedAtMs: atMs });
      atomicJson(resolve(directory, 'progress.json'), { phase, atMs });
      console.log(`[classroom-scale] ${calibration ? 'calibration' : users}: ${name}`);
      persist();
    };
    const journal = (operation: Operation) =>
      appendFileSync(resolve(directory, 'operations.jsonl'), JSON.stringify({ operation }) + '\n');
    operations.forEach(journal);

    const observe = (promise: Promise<void>) => {
      const guarded = promise
        .catch(() => {
          observerErrors++;
        })
        .finally(() => pending.delete(guarded));
      pending.add(guarded);
    };
    const sample = () => {
      if (samplePending) return;
      samplePending = (async () => {
        const [processes, database] = await Promise.all([
          execute('ps', ['-eo', 'pid=,ppid=,rss=,pcpu=,comm='], {
            timeout: 2000,
            maxBuffer: 1048576,
            env: { ...process.env, LC_ALL: 'C' },
          }),
          observer.query(`SELECT count(*)::int AS connections,
            count(*) FILTER (WHERE state='active')::int AS active,
            count(*) FILTER (WHERE wait_event_type='Lock')::int AS lock_waiters
            FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`),
        ]);
        const chromium = stormChromiumResources(
          processes.stdout,
          process.pid,
          browser.isConnected(),
        );
        browserSamples.push({
          atMs: Date.now(),
          phase,
          chromiumProcesses: chromium.processes,
          chromiumRssBytes: chromium.rssSumBytes,
          chromiumLifetimeCpuPercentSum: chromium.lifetimeCpuPercentSum,
          nodeRssBytes: process.memoryUsage().rss,
          browserRequestsActive: activeHttp,
          postgres: database.rows[0],
        });
      })()
        .catch(() => {
          observerErrors++;
        })
        .finally(() => {
          samplePending = undefined;
        });
    };
    const attach = (learner: Learner) => {
      const page = learner.page;
      page.on('pageerror', (error) =>
        javascriptErrors.push({ client: learner.client, phase, name: error.name }),
      );
      page.on('request', (request) => {
        if (!measuredAt || finishedAt || new URL(request.url()).origin !== SCALE_ORIGIN) return;
        if (requestRecords.length >= SCALE_PROFILE.maximumHttpObservations) {
          raw['droppedObservations'] = Number(raw['droppedObservations']) + 1;
          return;
        }
        const record: HttpRecord = {
          client: learner.client,
          phase,
          route: stormRoute(new URL(request.url()).pathname),
          method: request.method(),
          status: 0,
          startedAtMs: Date.now(),
          durationMs: 0,
          injected: false,
          completed: false,
        };
        requestRecords.push(record);
        requests.set(request, { record, learner, navigationWindow: learner.navigating });
        activeHttp++;
        peakActiveHttp = Math.max(peakActiveHttp, activeHttp);
      });
      page.on('response', (response) => {
        const request = response.request();
        const tracked = requests.get(request);
        if (tracked) {
          tracked.record.status = response.status();
          tracked.record.injected = injected.has(request);
        }
        const url = new URL(response.url());
        if (
          url.origin !== SCALE_ORIGIN ||
          request.resourceType() !== 'script' ||
          response.status() !== 200
        )
          return;
        // The network event must belong to an actual page script request. An
        // independent fetch of a conveniently matching, unused file is not proof.
        if (!(
          url.pathname === mainEntryPath ||
          /\/assets\/index-[^/]+\.js$/.test(url.pathname) ||
          url.pathname === '/internal/blocks/vendor/scratch/scratch-gui-standalone.js'
        ))
          return;
        if (assetInFlight.has(url.pathname)) return;
        const expected = assetManifest.get(url.pathname);
        if (!expected) {
          observerErrors++;
          return;
        }
        assetInFlight.add(url.pathname);
        observe(
          (async () => {
            const failure = await response.finished();
            if (failure) throw new FixtureFailure('served_script_incomplete');
            const bytes = await response.body();
            const actualHash = createHash('sha256').update(bytes).digest('hex');
            if (bytes.length !== expected.bytes || actualHash !== expected.expectedHash)
              throw new FixtureFailure('served_script_differs_from_image');
            loadedAssets.push({ ...expected, bytes: bytes.length, actualHash, executed: true });
          })(),
        );
      });
      page.on('requestfinished', (request) => {
        const tracked = requests.get(request);
        if (!tracked) return;
        tracked.record.completed = true;
        tracked.record.durationMs = Date.now() - tracked.record.startedAtMs;
        tracked.record.injected = injected.has(request);
        activeHttp--;
        requests.delete(request);
      });
      page.on('requestfailed', (request) => {
        const tracked = requests.get(request);
        if (!tracked) return;
        const error = request.failure()?.errorText ?? 'unknown_network_error';
        const offline =
          tracked.record.phase.includes('offline') && error === 'net::ERR_INTERNET_DISCONNECTED';
        const navigationWindow = tracked.navigationWindow || learner.navigating;
        const navigation =
          navigationWindow &&
          ['GET', 'HEAD'].includes(request.method()) &&
          error === 'net::ERR_ABORTED';
        networkFailures.push({
          client: learner.client,
          phase: tracked.record.phase,
          route: tracked.record.route,
          method: request.method(),
          error,
          expected: offline || navigation,
          reason: offline
            ? 'deliberate_context_offline'
            : navigation
              ? 'explicit_native_navigation'
              : 'unexpected_network_failure',
          navigationWindow,
        });
        tracked.record.durationMs = Date.now() - tracked.record.startedAtMs;
        activeHttp--;
        requests.delete(request);
      });
    };
    const call = async (
      request: APIRequestContext,
      method: 'GET' | 'POST' | 'PUT',
      path: string,
      data?: unknown,
      statuses = [200],
      client = -1,
    ): Promise<Data> => {
      const commandId = randomUUID();
      for (let attempt = 0; ; attempt++) {
        checkAbort();
        if (observerRequests.length >= SCALE_PROFILE.maximumControlObservations)
          throw new FixtureFailure('control_observer_bound');
        const startedAtMs = Date.now();
        const response = await request.fetch(SCALE_ORIGIN + path, {
          method,
          headers: { origin: SCALE_ORIGIN, 'idempotency-key': commandId },
          ...(data === undefined ? {} : { data }),
          timeout: 15000,
          maxRedirects: 0,
        });
        observerRequests.push({
          client,
          phase,
          route: stormRoute(path),
          method,
          status: response.status(),
          startedAtMs,
          durationMs: Date.now() - startedAtMs,
          injected: false,
          completed: true,
        });
        if (statuses.includes(response.status())) return object(await response.json());
        // Provisioning a synthetic roster is outside the simultaneous workload.
        // Only an explicit rejection with a valid server delay may be retried;
        // no measured login/save or ambiguous transport failure is replayed.
        if (
          phase === 'setup' &&
          !measuredAt &&
          request === setupContext?.request &&
          response.status() === 429 &&
          attempt < SCALE_PROFILE.setupMaximumRetriesPerOperation
        ) {
          const header = response.headers()['retry-after'];
          if (header && /^[1-9][0-9]{0,2}$/.test(header)) {
            const seconds = Number(header);
            const payload = object(await response.json());
            const reason = object(payload['error']);
            const delayMs = seconds * 1000;
            if (
              reason['code'] === 'too_many_requests' &&
              reason['retryAfterSeconds'] === seconds &&
              delayMs <= SCALE_PROFILE.setupRetryBudgetMs - setupRetryWaitMs
            ) {
              setupRetryWaitMs += delayMs;
              setupRetries.push({
                atMs: Date.now(),
                route: stormRoute(path),
                method,
                status: 429,
                delayMs,
                attempt: attempt + 1,
              });
              persist();
              await response.dispose();
              await wait(delayMs);
              continue;
            }
          }
          throw new FixtureFailure('setup_retry_budget_or_receipt_invalid');
        }
        throw new FixtureFailure(`control_${method.toLowerCase()}_http_${response.status()}`);
      }
    };
    const checkSeat = async (learner: Learner) => {
      const me = await call(
        learner.context.request,
        'GET',
        '/api/class-join/me',
        undefined,
        [200],
        learner.client,
      );
      if (
        me['authenticated'] !== true ||
        object(me['student'])['seatId'] !== learner.seatId ||
        object(me['classroom'])['id'] !== learner.classroomId
      )
        throw new IntegrityFailure('seat_identity_mismatch');
    };
    const readDraft = async (learner: Learner, editor: Editor): Promise<Draft> => {
      const projectId = learner.projects[editor];
      if (!projectId) throw new FixtureFailure('project_not_created');
      const data = await call(
        learner.context.request,
        'GET',
        `/api/projects/${projectId}`,
        undefined,
        [200],
        learner.client,
      );
      const project = object(data['project']),
        draft = object(data['draft']);
      if (
        project['id'] !== projectId ||
        draft['projectId'] !== projectId ||
        project['moduleKey'] !== moduleFor(editor) ||
        project['scope'] !== 'personal'
      )
        throw new IntegrityFailure('project_identity_or_module_mismatch');
      return {
        projectId,
        moduleKey: moduleFor(editor),
        revision: integer(draft['revision']),
        document: object(draft['document']),
      };
    };
    const verify = async (
      learner: Learner,
      editor: Editor,
      previous: Draft,
      changed: boolean,
    ): Promise<ReadbackProof> => {
      await checkSeat(learner);
      const current = await readDraft(learner, editor);
      const expected = learner.expected[editor];
      if (!expected) throw new FixtureFailure('content_expectation_missing');
      const expectedContentHash = scaleHash(expected),
        actualContentHash = scaleHash(projection(editor, current.document, expected));
      if (
        expectedContentHash !== actualContentHash ||
        current.revision < previous.revision ||
        (changed && current.revision <= previous.revision)
      )
        throw new IntegrityFailure('content_or_revision_readback_mismatch');
      if (!changed && scaleHash(current.document) !== scaleHash(previous.document))
        throw new IntegrityFailure('reload_changed_saved_document');
      learner.drafts[editor] = current;
      return {
        kind: 'independent-authenticated-api-readback',
        httpStatus: 200,
        identityMatched: true,
        expectedContentHash,
        actualContentHash,
        documentHash: scaleHash(current.document),
        revisionBefore: previous.revision,
        revisionAfter: current.revision,
        changeObserved:
          current.revision > previous.revision &&
          scaleHash(current.document) !== scaleHash(previous.document),
      };
    };
    const acknowledge = (operation: Operation) => {
      if (operation.status !== 'STARTED') throw new FixtureFailure('operation_ack_out_of_order');
      operation.status = 'ACKNOWLEDGED';
      operation.acknowledgedAtMs = Date.now();
      journal(operation);
    };
    const runOperation = async (
      learner: Learner,
      name: string,
      budget: number,
      action: (operation: Operation) => Promise<void>,
    ) => {
      const operation = operations.find((entry) => entry.id === `${name}:${learner.client}`);
      if (!operation || operation.status !== 'NOT_STARTED')
        throw new FixtureFailure('duplicate_or_unplanned_operation');
      checkAbort();
      operation.status = 'STARTED';
      operation.startedAtMs = Date.now();
      operation.attempts = 1;
      learner.page.setDefaultTimeout(Math.min(budget, 15000));
      journal(operation);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          action(operation),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              // Abort only this owned test browser identity. Never let a timed-out
              // UI mutation run unnoticed in a later workload phase.
              learner.closed = true;
              void learner.context.close().catch(() => undefined);
              reject(new FixtureFailure('operation_deadline'));
            }, budget);
          }),
        ]);
        checkAbort();
        operation.status = 'VERIFIED';
      } catch (error) {
        const code =
          error instanceof FixtureFailure || error instanceof IntegrityFailure
            ? error.code
            : 'native_ui_or_api_assertion';
        operation.status = code === 'operation_deadline' ? 'TIMED_OUT' : 'FAILED';
        operation.failure = {
          kind:
            error instanceof IntegrityFailure
              ? 'integrity'
              : error instanceof FixtureFailure
                ? 'fixture_or_runtime'
                : 'native_ui_or_runtime',
          code,
        };
        if (error instanceof IntegrityFailure)
          integrityFailures.push({ client: learner.client, operation: name, code });
      } finally {
        if (timer) clearTimeout(timer);
        operation.endedAtMs = Date.now();
        operation.durationMs = operation.endedAtMs - operation.startedAtMs;
        journal(operation);
      }
      return operation.status === 'VERIFIED';
    };
    const parallel = async (
      name: string,
      budget: number,
      action: (learner: Learner, operation: Operation) => Promise<void>,
      phaseName = name,
    ) => {
      beginPhase(phaseName);
      const settled = await Promise.allSettled(
        learners.map((learner) =>
          runOperation(learner, name, budget, (operation) => action(learner, operation)),
        ),
      );
      persist();
      if (settled.some((result) => result.status !== 'fulfilled' || !result.value))
        throw new FixtureFailure('planned_phase_unconfirmed_' + name);
    };
    const navigate = async <T>(
      learner: Learner,
      action: string,
      body: () => Promise<T>,
    ): Promise<T> => {
      const prior = learner.navigating;
      const window = {
        client: learner.client,
        action,
        startedAtMs: Date.now(),
        endedAtMs: undefined as number | undefined,
      };
      navigationWindows.push(window);
      learner.navigating = true;
      try {
        return await body();
      } finally {
        window.endedAtMs = Date.now();
        learner.navigating = prior;
      }
    };
    const reload = (learner: Learner, editor: Editor) =>
      navigate(learner, 'native-reload-' + editor, async () => {
        await learner.page.reload({
          waitUntil: 'domcontentloaded',
          timeout: SCALE_PROFILE.deadlinesMs.editor,
        });
        await editorReady(learner.page, editor);
      });
    const projectsVisible = async (page: Page) => {
      await expect(page.getByRole('heading', { name: 'Мои проекты', exact: true })).toBeVisible({
        timeout: SCALE_PROFILE.deadlinesMs.portal,
      });
      await expect(page.getByLabel('Загрузка проектов', { exact: true })).toHaveCount(0);
      await expect(
        page
          .locator('.project-hub')
          .locator('.project-empty, [data-testid="personal-project-grid"]')
          .first(),
      ).toBeVisible();
      await expect(
        page.locator('.project-hub .portal-quick-create > summary').first(),
      ).toBeVisible();
    };
    const createEditor = (learner: Learner, editor: Editor, operation: Operation) =>
      navigate(learner, 'create-editor-' + editor, async () => {
        const page = learner.page;
        if (editor === 'scratch') {
          await page.getByRole('button', { name: 'ASA Lab', exact: true }).first().click();
          await page.getByRole('button', { name: 'Проекты', exact: true }).first().click();
          await projectsVisible(page);
        }
        const menu = page.locator('.portal-header .portal-quick-create');
        await menu.locator('summary').click();
        const creation = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/api/projects' &&
            response.request().method() === 'POST',
          { timeout: SCALE_PROFILE.deadlinesMs.editor },
        );
        const result = await Promise.all([
          creation,
          menu
            .getByRole('button', {
              name: editor === 'electronics' ? /Электрическая цепь/ : /Программа Scratch/,
            })
            .click(),
        ]);
        if (result[0].status() !== 201) throw new FixtureFailure('ui_project_creation_not_201');
        learner.projects[editor] = identifier(
          object(object(await result[0].json())['project'])['id'],
        );
        await editorReady(page, editor);
        acknowledge(operation);
        await checkSeat(learner);
        learner.drafts[editor] = await readDraft(learner, editor);
      });
    const save = async (
      learner: Learner,
      editor: Editor,
      operation: Operation,
      step: number,
      recovery = false,
    ) => {
      const previous = learner.drafts[editor];
      const projectId = learner.projects[editor];
      if (!previous || !projectId) throw new FixtureFailure('save_without_open_project');
      // Observe the real outgoing document rather than assuming the first PUT
      // after an edit is the final generation (Scratch may upload assets first).
      const response = learner.page.waitForResponse(
        (candidate) => {
          const expected = learner.expected[editor];
          return !!expected && isExpectedDraft(candidate, editor, projectId, expected);
        },
        { timeout: recovery ? SCALE_PROFILE.deadlinesMs.recovery : SCALE_PROFILE.deadlinesMs.save },
      );
      const action = async () => {
        if (recovery) await learner.context.setOffline(false);
        else await editContent(learner, editor, step);
        if (editor === 'electronics' && !recovery)
          await learner.page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
        // Scratch deliberately uses its real native minute autosave. There is
        // no synthetic clock, Save callback, postMessage, VM or React mutation.
      };
      const [ack] = await Promise.all([response, action()]);
      if (ack.status() !== 200 || (await ack.finished()))
        throw new FixtureFailure('draft_write_not_acknowledged');
      acknowledge(operation);
      operation.verification = await verify(learner, editor, previous, true);
      await visibleContent(learner, editor);
    };

    try {
      persist();
      const database = await observer.query(
        'SELECT current_database() AS name,current_user AS actor',
      );
      if (database.rows[0]?.name !== SCALE_DATABASE || database.rows[0]?.actor !== 'postgres')
        throw new FixtureFailure('wrong_observer_database');
      setupContext = await browser.newContext({
        baseURL: SCALE_ORIGIN,
        locale: 'en-US',
        viewport: { width: 1366, height: 900 },
      });
      const setupPage = await setupContext.newPage();
      setupPage.setDefaultTimeout(SCALE_PROFILE.deadlinesMs.login);
      const suffix = identity.runToken.slice(0, 12) + '-' + users;
      const email = `scale-${suffix}@example.invalid`,
        password = `Scale-${randomUUID()}-Only`;
      // Real registration/login forms and a valid native BotCheck interaction.
      // The fixed isolated NODE_ENV=test ingress has explicitly reported limits.
      await setupPage.goto(SCALE_ORIGIN + '/#/', { waitUntil: 'domcontentloaded' });
      await setupPage.getByRole('button', { name: 'Создать аккаунт', exact: true }).first().click();
      await setupPage.getByLabel('Email', { exact: true }).fill(email);
      await setupPage
        .getByLabel('Отображаемое имя', { exact: true })
        .fill('Synthetic scale teacher');
      await setupPage.getByLabel('Дата рождения').fill('1990-01-01');
      await setupPage.getByLabel('Пароль', { exact: true }).fill(password);
      await setupPage.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
      await expect(setupPage.getByRole('checkbox', { name: 'Я не робот' })).toBeChecked();
      await setupPage.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
      await expect(setupPage.getByRole('main', { name: 'Главная', exact: true })).toBeVisible();
      const setupIdentity = await call(setupContext.request, 'GET', '/api/auth/me');
      const accountId = identifier(object(setupIdentity['account'])['id']);
      await call(setupContext.request, 'POST', '/api/capabilities/educator/self-attest', {}, [201]);
      const credentials: Array<{
        id: string;
        code: string;
        classroomId: string;
        classroomCode: string;
      }> = [];
      for (const cohort of cohorts) {
        checkAbort();
        const classroom = object(
          (
            await call(
              setupContext.request,
              'POST',
              '/api/classrooms',
              {
                title: 'Synthetic capacity ' + suffix + ' cohort ' + cohort.cohort,
                ageBand: 'mixed',
                topicKeys: [],
                safeModeDefault: true,
              },
              [201],
            )
          )['classroom'],
        );
        const classId = identifier(classroom['id']);
        const classCode = string(
          object(
            (await call(setupContext.request, 'GET', `/api/classrooms/${classId}`))['classroom'],
          )['joinCode'],
        );
        cohort.classroomHash = scaleHash(classId);
        for (const game of ['chess', 'checkers']) {
          const policy = await call(
            setupContext.request,
            'GET',
            `/api/games/${game}/policy/${classId}`,
          );
          await call(setupContext.request, 'PUT', `/api/games/${game}/policy/${classId}`, {
            enabled: true,
            scope: 'classroom',
            expectedVersion: policy['version'],
          });
        }
        for (const client of cohort.clients) {
          const seat = object(
            (
              await call(
                setupContext.request,
                'POST',
                `/api/classrooms/${classId}/seats`,
                {
                  displayLabel: 'Synthetic learner ' + client,
                  safeMode: true,
                },
                [201],
              )
            )['student'],
          );
          credentials.push({
            id: identifier(seat['id']),
            code: string(seat['studentCode']),
            classroomId: classId,
            classroomCode: classCode,
          });
          cohort.provisioned++;
        }
        persist();
      }
      await setupContext.close();
      setupContext = undefined;

      accountControl['status'] = 'STARTED';
      accountControl['startedAtMs'] = Date.now();
      accountContext = await browser.newContext({ baseURL: SCALE_ORIGIN, locale: 'en-US' });
      const accountPage = await accountContext.newPage();
      await accountPage.goto(SCALE_ORIGIN + '/#/', { waitUntil: 'domcontentloaded' });
      await accountPage
        .getByRole('banner')
        .getByRole('button', { name: 'Войти', exact: true })
        .click();
      await accountPage.getByLabel('Почта или логин', { exact: true }).fill(email);
      await accountPage.getByLabel('Пароль', { exact: true }).fill(password);
      await accountPage.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
      await expect(accountPage.getByRole('checkbox', { name: 'Я не робот' })).toBeChecked();
      await accountPage.getByRole('button', { name: 'Войти', exact: true }).click();
      await expect(accountPage.getByRole('main', { name: 'Главная', exact: true })).toBeVisible();
      if (
        object((await call(accountContext.request, 'GET', '/api/auth/me'))['account'])['id'] !==
        accountId
      )
        throw new IntegrityFailure('account_login_identity_mismatch');
      await accountPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(accountPage.getByRole('main', { name: 'Главная', exact: true })).toBeVisible();
      if (
        object((await call(accountContext.request, 'GET', '/api/auth/me'))['account'])['id'] !==
        accountId
      )
        throw new IntegrityFailure('account_reload_identity_mismatch');
      accountControl['status'] = 'VERIFIED';
      accountControl['endedAtMs'] = Date.now();
      await accountContext.close();
      accountContext = undefined;

      for (const [client, credential] of credentials.entries()) {
        checkAbort();
        const context = await browser.newContext({
          baseURL: SCALE_ORIGIN,
          locale: 'en-US',
          viewport: { width: 1366, height: 900 },
          serviceWorkers: 'block',
        });
        const page = await context.newPage();
        const learner: Learner = {
          client,
          seatId: credential.id,
          studentCode: credential.code,
          classroomId: credential.classroomId,
          classroomCode: credential.classroomCode,
          context,
          page,
          projects: {},
          drafts: {},
          expected: {},
          navigating: false,
          closed: false,
        };
        learners.push(learner);
        attach(learner);
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
        // Each context is one pupil's focused machine, not a background tab.
        await page.goto(
          SCALE_ORIGIN + '/#/join-class?code=' + encodeURIComponent(learner.classroomCode),
          {
            waitUntil: 'domcontentloaded',
          },
        );
        await page.getByLabel('Код ученика', { exact: true }).fill(credential.code);
        if (client === 0) {
          const script = await page
            .locator('script[type="module"][src]')
            .first()
            .getAttribute('src');
          mainEntryPath = new URL(string(script), SCALE_ORIGIN).pathname;
          if (!assetManifest.has(mainEntryPath))
            throw new FixtureFailure('web_entry_absent_from_image_manifest');
        }
        expect(
          await page.evaluate(() => ({
            visibility: document.visibilityState,
            focused: document.hasFocus(),
          })),
        ).toEqual({ visibility: 'visible', focused: true });
      }
      if (new Set(learners.map((learner) => learner.seatId)).size !== users)
        throw new FixtureFailure('duplicate_seat_credentials');
      measuredAt = Date.now();
      sampler = setInterval(sample, 2000);
      sample();
      checkpoint = setInterval(persist, 5000);
      await parallel('login', SCALE_PROFILE.deadlinesMs.login, (learner, operation) =>
        navigate(learner, 'native-seat-login', async () => {
          const signed = learner.page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === '/api/class-join/studentseat' &&
              response.request().method() === 'POST',
          );
          const [response] = await Promise.all([
            signed,
            learner.page.getByRole('button', { name: 'Войти', exact: true }).click(),
          ]);
          if (response.status() !== 200) throw new FixtureFailure('seat_login_not_200');
          await expect(
            learner.page.getByRole('main', { name: 'Главная', exact: true }),
          ).toBeVisible({
            timeout: SCALE_PROFILE.deadlinesMs.login,
          });
          acknowledge(operation);
          await checkSeat(learner);
        }),
      );
      await parallel('portal', SCALE_PROFILE.deadlinesMs.portal, (learner, operation) =>
        navigate(learner, 'native-projects-navigation', async () => {
          await learner.page.getByRole('button', { name: 'Проекты', exact: true }).first().click();
          await projectsVisible(learner.page);
          acknowledge(operation);
        }),
      );

      for (const editor of ['electronics', 'scratch'] as const) {
        await parallel(`${editor}-open`, SCALE_PROFILE.deadlinesMs.editor, (learner, operation) =>
          createEditor(learner, editor, operation),
        );
        await parallel(`${editor}-save`, SCALE_PROFILE.deadlinesMs.save, (learner, operation) =>
          save(learner, editor, operation, 1),
        );
        await parallel(
          `${editor}-reload`,
          SCALE_PROFILE.deadlinesMs.editor,
          async (learner, operation) => {
            const previous = learner.drafts[editor];
            if (!previous) throw new FixtureFailure('reload_without_saved_draft');
            await reload(learner, editor);
            await visibleContent(learner, editor);
            acknowledge(operation);
            operation.verification = await verify(learner, editor, previous, false);
          },
        );
        beginPhase(`${editor}-telemetry-outage-prepare`);
        const faultPreparation = await Promise.allSettled(
          learners.map(async (learner) => {
            checkAbort();
            learner.telemetryFault = async (route) => {
              if (route.request().method() !== 'POST') {
                await route.continue();
                return;
              }
              injected.add(route.request());
              await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({ error: { code: 'fixture_telemetry_unavailable' } }),
              });
            };
            await learner.page.route(telemetryPattern, learner.telemetryFault);
            const fault = learner.page.waitForResponse(
              (response) => response.status() === 503 && injected.has(response.request()),
              { timeout: SCALE_PROFILE.deadlinesMs.editor },
            );
            await Promise.all([fault, reload(learner, editor)]);
            await visibleContent(learner, editor);
          }),
        );
        if (faultPreparation.some((result) => result.status !== 'fulfilled'))
          throw new FixtureFailure('real_telemetry_fault_not_observed_for_every_client');
        await parallel(
          `${editor}-outage-save`,
          SCALE_PROFILE.deadlinesMs.save,
          (learner, operation) => save(learner, editor, operation, 2),
          `${editor}-telemetry-outage-save`,
        );
        await Promise.all(
          learners.map(async (learner) => {
            if (learner.telemetryFault)
              await learner.page.unroute(telemetryPattern, learner.telemetryFault);
            learner.telemetryFault = undefined;
          }),
        );
        await parallel(
          `${editor}-offline-edit`,
          SCALE_PROFILE.offlineMs + 15000,
          async (learner, operation) => {
            await learner.context.setOffline(true);
            await editContent(learner, editor, 3);
            if (editor === 'electronics') {
              await learner.page
                .getByRole('button', { name: 'Сохранить проект', exact: true })
                .click();
            }
            await wait(SCALE_PROFILE.offlineMs);
            expect(await learner.page.evaluate(() => navigator.onLine)).toBe(false);
            await visibleContent(learner, editor);
            acknowledge(operation);
          },
        );
        await parallel(
          `${editor}-recovery`,
          SCALE_PROFILE.deadlinesMs.recovery,
          (learner, operation) => save(learner, editor, operation, 3, true),
        );
        beginPhase(`${editor}-healthy-observation`);
        await wait(SCALE_PROFILE.healthyObservationMs);
        await Promise.all(learners.map((learner) => checkSeat(learner)));
      }

      beginPhase('multiple-tabs');
      for (const learner of learners.slice(0, Math.min(users, 3))) {
        const secondary = await learner.context.newPage();
        const secondaryIdentity = { ...learner, page: secondary, navigating: false };
        attach(secondaryIdentity);
        try {
          // A real second tab shares the Seat cookie, but never writes the first
          // tab's project. Its auth is checked against the independent endpoint.
          await navigate(secondaryIdentity, 'open-second-tab', async () => {
            await secondary.goto(SCALE_ORIGIN + '/#/home', { waitUntil: 'domcontentloaded' });
            await expect(
              secondary.getByRole('main', { name: 'Главная', exact: true }),
            ).toBeVisible();
            await checkSeat(learner);
          });
        } finally {
          await navigate(secondaryIdentity, 'close-second-tab', () => secondary.close());
        }
      }
      beginPhase('game-notifications-and-matches');
      const sender = learners[0],
        receiver = learners[1];
      if (!sender || !receiver) throw new FixtureFailure('game_control_requires_two_counted_seats');
      if (sender.classroomId !== receiver.classroomId)
        throw new FixtureFailure('game_control_requires_same_classroom');
      for (const learner of [sender, receiver]) {
        await navigate(learner, 'open-games-page', async () => {
          await learner.page.goto(SCALE_ORIGIN + '/#/games', { waitUntil: 'domcontentloaded' });
          await expect(
            learner.page.getByRole('heading', { name: 'Игры', exact: true }),
          ).toBeVisible();
        });
      }
      for (const game of ['chess', 'checkers'] as const) {
        const target = object(
          (
            await call(
              receiver.context.request,
              'GET',
              `/api/games/${game}/access`,
              undefined,
              [200],
              receiver.client,
            )
          )['player'],
        );
        const challenge = await call(
          sender.context.request,
          'POST',
          `/api/games/${game}/players/${identifier(target['playerId'])}/challenge`,
          { scope: 'classroom', initialMs: 600000, incrementMs: 0, colorPreference: 'white' },
          [201],
          sender.client,
        );
        const invite = object(challenge['invite']);
        const notification = receiver.page.getByRole('button', {
          name: `Посмотреть приглашения: ${game === 'chess' ? 'Шахматы' : 'Шашки'}`,
          exact: true,
        });
        await expect(notification).toContainText('Вас приглашают играть', { timeout: 15000 });
        const incoming = receiver.page.getByRole('region', { name: 'Входящие вызовы' });
        await navigate(receiver, 'open-' + game + '-invitation', async () => {
          await notification.click();
          await expect(incoming).toBeVisible();
        });
        games[game === 'chess' ? 'chessInvitations' : 'checkersInvitations']++;
        const accepted = receiver.page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              `/api/games/${game}/invites/${string(invite['code'])}/accept` &&
            response.request().method() === 'POST',
        );
        const acceptResponse = await navigate(
          receiver,
          'accept-' + game + '-invitation',
          async () => {
            const [response] = await Promise.all([
              accepted,
              incoming.getByRole('button', { name: 'Принять вызов', exact: true }).click(),
            ]);
            if (response.status() !== 201) throw new FixtureFailure('game_acceptance_not_201');
            if (game === 'chess')
              await expect(receiver.page.getByTestId('asa-chess-board')).toBeVisible();
            else
              await expect(
                receiver.page.getByRole('grid', { name: 'Доска для русских шашек, 8 на 8' }),
              ).toBeVisible();
            return response;
          },
        );
        const match = object(object(await acceptResponse.json())['match']);
        const matchId = identifier(match['id']);
        const read = await call(
          receiver.context.request,
          'GET',
          `/api/games/${game}/matches/${matchId}`,
          undefined,
          [200],
          receiver.client,
        );
        if (object(read['match'])['id'] !== matchId)
          throw new IntegrityFailure('game_match_readback_mismatch');
        await call(
          sender.context.request,
          'POST',
          `/api/games/${game}/matches/${matchId}/commands`,
          { expectedVersion: match['version'], action: 'resign' },
          [201],
          sender.client,
        );
        games[game === 'chess' ? 'chessMatches' : 'checkersMatches']++;
        await navigate(receiver, 'return-to-games-page', async () => {
          await receiver.page.goto(SCALE_ORIGIN + '/#/games', { waitUntil: 'domcontentloaded' });
          await expect(
            receiver.page.getByRole('heading', { name: 'Игры', exact: true }),
          ).toBeVisible();
        });
      }
      beginPhase('final-readback-and-provenance');
      await Promise.all(
        learners.map(async (learner) => {
          for (const editor of ['electronics', 'scratch'] as const) {
            const previous = learner.drafts[editor];
            if (!previous) throw new FixtureFailure('final_document_missing');
            await verify(learner, editor, previous, false);
          }
        }),
      );
      await Promise.allSettled([...pending]);
      if (
        !mainEntryPath ||
        !loadedAssets.some((asset) => asset.service === 'web' && asset.path === mainEntryPath) ||
        !loadedAssets.some(
          (asset) =>
            asset.service === 'scratch' &&
            asset.path === '/internal/blocks/vendor/scratch/scratch-gui-standalone.js',
        )
      )
        throw new FixtureFailure('executed_entry_provenance_missing');
      if (networkFailures.some((failure) => !failure.expected))
        throw new FixtureFailure('unexpected_browser_network_failure');
      if (javascriptErrors.length) throw new FixtureFailure('javascript_error_observed');
      if (observerErrors) throw new FixtureFailure('observer_incomplete');
      raw['workloadComplete'] = true;
    } catch (error) {
      raw['workloadComplete'] = false;
      raw['failure'] = {
        phase,
        kind:
          error instanceof IntegrityFailure
            ? 'integrity'
            : error instanceof FixtureFailure
              ? 'fixture_or_runtime'
              : 'native_ui_or_runtime',
        code:
          error instanceof FixtureFailure || error instanceof IntegrityFailure
            ? error.code
            : 'unclassified_ui_or_api_assertion',
      };
      if (error instanceof IntegrityFailure)
        integrityFailures.push({ client: -1, operation: phase, code: error.code });
      // Full raw evidence and the denominator survive even when Playwright fails.
      throw new Error(
        `Full editor workload stopped in ${phase}; inspect raw.json and operations.jsonl`,
        { cause: error },
      );
    } finally {
      finishedAt = Date.now();
      const lastPhase = phaseTimes.at(-1);
      if (lastPhase) lastPhase.endedAtMs = finishedAt;
      if (sampler) clearInterval(sampler);
      if (checkpoint) clearInterval(checkpoint);
      await samplePending;
      for (const { record } of requests.values())
        record.durationMs = finishedAt - record.startedAtMs;
      raw['unfinishedAtObservationEnd'] = requests.size;
      raw['networkObservationCutoffAtMs'] = finishedAt;
      requests.clear();
      persist();
      // Measurement ends before deliberate teardown: closing a context must not
      // be confused with a server 5xx or a completed product request.
      await Promise.allSettled(
        learners
          .filter((learner) => !learner.closed)
          .map(async (learner) => {
            learner.navigating = true;
            learner.closed = true;
            await learner.context.close();
          }),
      );
      await Promise.allSettled([...pending]);
      await setupContext?.close();
      await accountContext?.close();
      await observer.end();
      persist();
    }
  });
});
