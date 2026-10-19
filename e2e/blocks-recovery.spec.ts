import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { types as nodeTypes } from 'node:util';

let createProtocolFixture: typeof import('../tools/blocks/browser/fixture.mjs').createProtocolFixture;
let installMinuteAutosaveClock: typeof import('../tools/blocks/browser/fixture.mjs').installMinuteAutosaveClock;
let parentOrigin: string;

const PRINCIPAL_A = '33333333-3333-4333-8333-333333333333';

function recoveryBootstrapFixture() {
  const imageBytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#0877b3"/></svg>',
    'utf8',
  );
  const imageAssetId = createHash('md5').update(imageBytes).digest('hex');
  const imageReference = {
    assetId: imageAssetId,
    dataFormat: 'svg' as const,
    sha256: createHash('sha256').update(imageBytes).digest('hex'),
    sizeBytes: imageBytes.byteLength,
  };
  const costume = (name: string) => ({
    assetId: imageAssetId,
    name,
    bitmapResolution: 1,
    md5ext: `${imageAssetId}.svg`,
    dataFormat: 'svg',
    rotationCenterX: 48,
    rotationCenterY: 48,
  });
  const projectJson = {
    targets: [
      {
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {},
        currentCostume: 0,
        costumes: [costume('Recovery Backdrop')],
        sounds: [],
        volume: 100,
      },
      {
        isStage: false,
        name: 'Recovery Sprite',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {
          flag: {
            opcode: 'event_whenflagclicked',
            next: 'move',
            parent: null,
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: true,
            x: 70,
            y: 60,
          },
          move: {
            opcode: 'motion_movesteps',
            next: null,
            parent: 'flag',
            inputs: { STEPS: [1, [4, '10']] },
            fields: {},
            shadow: false,
            topLevel: false,
          },
        },
        currentCostume: 0,
        costumes: [costume('Recovery Costume')],
        sounds: [],
        volume: 100,
        visible: true,
        x: 20,
        y: -10,
        size: 100,
        direction: 90,
        draggable: false,
        rotationStyle: 'all around',
      },
    ],
    monitors: [],
    extensions: [],
    meta: { semver: '3.0.0', vm: '0.1.0', agent: 'ASA recovery acceptance' },
  };
  return {
    projectJson,
    assets: [imageReference],
    runtimeAssets: new Map([
      [`${imageAssetId}.svg`, { body: imageBytes, contentType: 'image/svg+xml' }],
    ]),
  };
}

type RecoveryRecord = {
  principalKey: string;
  projectId: string;
  baseRevision: number;
  projectJson: Record<string, unknown>;
  generation: number;
  capturedAt: number;
  expiresAt: number;
};

test.beforeAll(async () => {
  ({ createProtocolFixture, installMinuteAutosaveClock } =
    await import('../tools/blocks/browser/fixture.mjs'));
  ({ parentOrigin } = await import('../tools/blocks/browser/protocol.mjs'));
});
async function readRecoveryRecords(
  frame: import('@playwright/test').FrameLocator,
): Promise<RecoveryRecord[]> {
  return frame.locator('html').evaluate(async () => {
    const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    if (!databases.some((database) => database.name === 'asa-blocks-recovery')) return [];
    return new Promise<RecoveryRecord[]>((resolve, reject) => {
      const open = indexedDB.open('asa-blocks-recovery');
      open.onerror = () => reject(open.error ?? new Error('recovery database open failed'));
      open.onsuccess = () => {
        const database = open.result;
        if (!database.objectStoreNames.contains('project-recovery')) {
          database.close();
          resolve([]);
          return;
        }
        const transaction = database.transaction('project-recovery', 'readonly');
        const request = transaction.objectStore('project-recovery').getAll();
        request.onerror = () => reject(request.error ?? new Error('recovery database read failed'));
        request.onsuccess = () => {
          const records = request.result.map((value) => {
            const record = { ...value } as Record<string, unknown>;
            delete record.key;
            return record;
          });
          database.close();
          resolve(records as RecoveryRecord[]);
        };
      };
    });
  });
}

function recoverySteps(record: RecoveryRecord | undefined): string | null {
  if (!record) return null;
  const project = record.projectJson as {
    targets?: Array<{
      name?: string;
      blocks?: Record<string, { inputs?: Record<string, unknown> }>;
    }>;
  };
  const sprite = project.targets?.find((target) => target.name === 'Recovery Sprite');
  const steps = sprite?.blocks?.move?.inputs?.STEPS as [number, [number, string]] | undefined;
  return steps?.[1]?.[1] ?? null;
}
async function waitReady(frame: import('@playwright/test').FrameLocator) {
  await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
    'data-editor-state',
    'ready',
    { timeout: 45000 },
  );
}

async function minuteClockPage(fixture: Awaited<ReturnType<typeof createProtocolFixture>>) {
  const page = await fixture.context.newPage();
  await installMinuteAutosaveClock(page);
  return page;
}

async function expectSteps(frame: import('@playwright/test').FrameLocator, value: string) {
  await frame.getByRole('tab', { name: 'Code', exact: true }).click();
  await frame.getByRole('button', { name: 'Recovery Sprite', exact: true }).click();
  await expect(
    frame.locator('.blocklyBlockCanvas').first().getByText(value, { exact: true }),
  ).toBeVisible();
}

async function setSteps(
  frame: import('@playwright/test').FrameLocator,
  fromValue: string,
  toValue: string,
) {
  await frame.getByRole('tab', { name: 'Code', exact: true }).click();
  await frame.getByRole('button', { name: 'Recovery Sprite', exact: true }).click();
  const program = frame.locator('.blocklyBlockCanvas').first();
  await program.getByText(fromValue, { exact: true }).dblclick();
  const input = frame.locator('.blocklyHtmlInput:focus');
  await expect(input).toHaveValue(fromValue);
  await input.fill(toValue);
  await input.press('Enter');
  await expect(program.getByText(toValue, { exact: true })).toBeVisible();
}

function snapshot23() {
  return {
    sourceRevision: 23,
    contentType: 'image/png',
    bytes: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  };
}
test('dirty crash restores real Scratch state, autosaves it, clears recovery and second reopen uses server', async () => {
  test.setTimeout(150_000);
  const serverProject = recoveryBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
    initialSnapshot: snapshot23(),
  });
  try {
    let page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    let frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);

    await setSteps(frame, '10', '73');
    await expect
      .poll(async () => recoverySteps((await readRecoveryRecords(frame))[0]), { timeout: 5000 })
      .toBe('73');
    expect(fixture.getServerRevision()).toBe(23);
    expect(fixture.getSnapshotRevision()).toBe(23);
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);
    expect(fixture.runtimeSnapshotEvidence).toHaveLength(0);

    await fixture.reopenContextWithIndexedDB();
    page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-project-source', 'recovery');
    await expectSteps(frame, '73');
    expect(fixture.getServerRevision()).toBe(23);
    expect(fixture.getSnapshotRevision()).toBe(23);

    await expect.poll(() => fixture.getServerRevision(), { timeout: 90_000 }).toBe(24);
    await expect
      .poll(async () => (await readRecoveryRecords(frame)).length, { timeout: 10_000 })
      .toBe(0);
    await expect.poll(() => fixture.getSnapshotRevision(), { timeout: 20_000 }).toBe(24);

    await fixture.reopenContextWithIndexedDB();
    page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    const secondShell = frame.locator('[data-asa-host-shell]');
    await expect(secondShell).toHaveAttribute('data-project-source', 'runtime-session');
    await expectSteps(frame, '73');
    expect(fixture.getServerRevision()).toBe(24);
    expect(await readRecoveryRecords(frame)).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('pagehide before the local debounce flushes newest recovery for a fresh browser', async () => {
  const serverProject = recoveryBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
  });
  try {
    let page = await minuteClockPage(fixture);
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    let frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);

    // Pause against the browser's own clock, while the project is still clean.
    // A future boundary avoids racing the running clock with host wall time.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 60_000));
    const program = frame.locator('.blocklyBlockCanvas').first();
    await program.getByText('10', { exact: true }).dblclick();
    const input = frame.locator('.blocklyHtmlInput:focus');
    await input.fill('73');
    await input.press('Enter');
    await page.clock.runFor(100);
    await expect(program.getByText('73', { exact: true })).toBeVisible();
    expect(await readRecoveryRecords(frame)).toEqual([]);

    await frame.locator('html').evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect
      .poll(async () => recoverySteps((await readRecoveryRecords(frame))[0]), { timeout: 5000 })
      .toBe('73');
    expect(fixture.getServerRevision()).toBe(23);
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);

    await fixture.reopenContextWithIndexedDB();
    page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-project-source',
      'recovery',
    );
    await expectSteps(frame, '73');
    expect(fixture.getServerRevision()).toBe(23);
  } finally {
    await fixture.close();
  }
});

test('rapid dirty edits coalesce to one latest recovery record', async () => {
  const serverProject = recoveryBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
  });
  try {
    const page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    await setSteps(frame, '10', '20');

    const program = frame.locator('.blocklyBlockCanvas').first();
    for (const [fromValue, toValue] of [
      ['20', '30'],
      ['30', '73'],
    ]) {
      await program.getByText(fromValue, { exact: true }).dblclick();
      const input = frame.locator('.blocklyHtmlInput:focus');
      await input.fill(toValue);
      await input.press('Enter');
    }

    await expect
      .poll(
        async () => {
          const records = await readRecoveryRecords(frame);
          return { count: records.length, steps: recoverySteps(records[0]) };
        },
        { timeout: 5000 },
      )
      .toEqual({ count: 1, steps: '73' });
    expect(fixture.getServerRevision()).toBe(23);
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);
  } finally {
    await fixture.close();
  }
});

test('normal upstream autosave clears recovery only after durable save', async () => {
  test.setTimeout(150_000);
  const serverProject = recoveryBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
  });
  try {
    const page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    await setSteps(frame, '10', '73');
    await expect.poll(async () => (await readRecoveryRecords(frame)).length).toBe(1);
    await expect.poll(() => fixture.getServerRevision(), { timeout: 90_000 }).toBe(24);
    await expect
      .poll(async () => (await readRecoveryRecords(frame)).length, { timeout: 10_000 })
      .toBe(0);
  } finally {
    await fixture.close();
  }
});

test('failed server autosave retains recovery', async () => {
  test.setTimeout(150_000);
  const { projectId } = await import('../tools/blocks/browser/protocol.mjs');
  const serverProject = recoveryBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
    draftWriteStatus: 503,
  });
  let observedDraftStatus: number | null = null;
  const stageDirectory = 'reports/blocks/recovery';
  const stagePath = `${stageDirectory}/failed-autosave-stages.json`;
  const stageNames = [
    'fixture-ready',
    'page-create-enter',
    'page-create-return',
    'open-enter',
    'open-return',
    'editor-ready-wait-enter',
    'editor-ready-observed',
    'save-and-checkpoint-wait-enter',
    'save-and-checkpoint-wait-return',
    'edit-enter',
    'checkpoint-wait-enter',
    'checkpoint-observed',
    'draft-request-observed',
    'draft-response-request-matched',
    'draft-request-selection-ambiguous',
    'draft-requestfinished',
    'draft-requestfailed',
    'draft-observer-failed',
    'response-headers',
    'response-completion-enter',
    'response-completion-call-return',
    'response-completion-call-throw',
    'response-completion-return',
    'response-completion-error-return',
    'response-completion-unknown-return',
    'response-completion-reject',
    'recovery-read-enter',
    'recovery-read-return',
    'assertions-completed',
    'finally-enter',
    'legacy-attachment-enter',
    'legacy-attachment-setup-throw',
    'legacy-attachment-payload-enter',
    'legacy-attachment-payload-ready',
    'legacy-attachment-payload-throw',
    'legacy-attachment-call-enter',
    'legacy-attachment-call-return',
    'legacy-attachment-call-throw',
    'legacy-attachment-catch-enter',
    'legacy-attachment-catch-return',
    'legacy-attachment-catch-throw',
    'legacy-attachment-reject',
    'legacy-attachment-await-enter',
    'legacy-attachment-await-reject',
    'legacy-attachment-fulfilled',
    'legacy-attachment-return',
    'teardown-enter',
    'teardown-return',
    'teardown-interrupted',
    'diagnostic-observation-failed',
  ] as const;
  type Stage = (typeof stageNames)[number];
  type StageDetail = {
    recoveryReadyAtResponse?: boolean;
    retainedCount?: number;
    retainedStepsMatch73?: boolean;
    returnKind?: 'PROMISE' | 'UNKNOWN';
  };
  const stageEvents: Array<
    {
      sequence: number;
      stage: Stage;
      elapsedMs: number | null;
      responseStatus: number | null;
    } & StageDetail
  > = [];
  const observedStages = new Set<Stage>();
  let stageSequence = 0;
  let droppedStageEvents = 0;
  let stageWriteFailures = 0;
  let stageTimingFailures = 0;
  let stageObservationFailures = 0;
  let clockOriginMs: number | null = null;
  let lastClockMs = 0;
  const maxElapsedMs = 600_000;
  let draftRequest: import('@playwright/test').Request | null = null;
  let draftRequestState: 'NOT_OBSERVED' | 'REQUEST_OBSERVED' | 'RESPONSE_MATCHED' | 'AMBIGUOUS' =
    'NOT_OBSERVED';
  let assertionsCompleted = false;
  let teardownCompleted = false;
  const incrementCount = (value: number) => Math.min(value + 1, Number.MAX_SAFE_INTEGER);
  const safeCount = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const sampleElapsedMs = (): number | null => {
    try {
      const now = performance.now();
      if (Number.isFinite(now) && now >= lastClockMs && now <= Number.MAX_SAFE_INTEGER) {
        if (clockOriginMs === null) clockOriginMs = now;
        const elapsed = Math.floor(now - clockOriginMs);
        if (safeCount(elapsed) !== null && elapsed <= maxElapsedMs) {
          lastClockMs = now;
          return elapsed;
        }
      }
    } catch {
      // A clock failure leaves the boundary time unknown.
    }
    stageTimingFailures = incrementCount(stageTimingFailures);
    return null;
  };
  const recordStage = (stage: Stage, detail: StageDetail = {}) => {
    try {
      if (!stageNames.includes(stage)) {
        stageObservationFailures = incrementCount(stageObservationFailures);
        stage = 'diagnostic-observation-failed';
      }
      stageSequence = incrementCount(stageSequence);
      const elapsedMs = sampleElapsedMs();
      const safeDetail: StageDetail = {};
      if (typeof detail.recoveryReadyAtResponse === 'boolean')
        safeDetail.recoveryReadyAtResponse = detail.recoveryReadyAtResponse;
      if (typeof detail.retainedStepsMatch73 === 'boolean')
        safeDetail.retainedStepsMatch73 = detail.retainedStepsMatch73;
      if (typeof detail.retainedCount === 'number' && safeCount(detail.retainedCount) !== null)
        safeDetail.retainedCount = detail.retainedCount;
      if (detail.returnKind === 'PROMISE' || detail.returnKind === 'UNKNOWN')
        safeDetail.returnKind = detail.returnKind;
      if (stageEvents.length < 64) {
        stageEvents.push({
          sequence: stageSequence,
          stage,
          elapsedMs,
          responseStatus: safeCount(observedDraftStatus),
          ...safeDetail,
        });
        observedStages.add(stage);
      } else droppedStageEvents = incrementCount(droppedStageEvents);
      if (stage === 'assertions-completed') assertionsCompleted = true;
      if (stage === 'teardown-return') teardownCompleted = true;
      fs.mkdirSync(stageDirectory, { recursive: true });
      fs.writeFileSync(
        `${stagePath}.tmp`,
        JSON.stringify(
          {
            schemaVersion: 2,
            lastStage: stage,
            outcome: assertionsCompleted && teardownCompleted ? 'NOT_REPRODUCED' : 'INCOMPLETE',
            captureState:
              stageWriteFailures === 0 &&
              droppedStageEvents === 0 &&
              stageTimingFailures === 0 &&
              stageObservationFailures === 0
                ? 'OBSERVED'
                : 'INCOMPLETE',
            clock: 'NODE_MONOTONIC',
            timeOrigin: 'FIRST_VALID_NODE_SAMPLE',
            timeObservation: 'NODE_STAGE_ENTRY_OR_AWAIT_CONTINUATION',
            maxElapsedMs,
            responseStatus: safeCount(observedDraftStatus),
            serverRevision: safeCount(fixture.getServerRevision()),
            draftCount: safeCount(fixture.runtimeDraftEvidence.length),
            draftRequestState,
            boundaries: Object.fromEntries(
              stageNames.map((boundary) => [
                boundary,
                observedStages.has(boundary) ? 'OBSERVED' : 'NOT_OBSERVED',
              ]),
            ),
            events: stageEvents,
            droppedEvents: droppedStageEvents,
            writeFailures: stageWriteFailures,
            timingFailures: stageTimingFailures,
            observationFailures: stageObservationFailures,
          },
          null,
          2,
        ),
      );
      fs.renameSync(`${stagePath}.tmp`, stagePath);
    } catch {
      // Diagnostic I/O cannot replace the original failure or skip cleanup.
      stageWriteFailures = incrementCount(stageWriteFailures);
    }
  };
  const recordPromiseReturn = (
    stage:
      | 'response-completion-call-return'
      | 'legacy-attachment-call-return'
      | 'legacy-attachment-catch-return',
    value: unknown,
  ) => {
    let returnKind: 'PROMISE' | 'UNKNOWN' = 'UNKNOWN';
    try {
      // Native branding does not read .then or add a Promise reaction.
      if (nodeTypes.isPromise(value)) returnKind = 'PROMISE';
    } catch {
      // Do not inspect a returned value to explain a diagnostic failure.
    }
    if (returnKind === 'UNKNOWN')
      stageObservationFailures = incrementCount(stageObservationFailures);
    recordStage(stage, { returnKind });
  };
  const recordResponseCompletion = (value: unknown) => {
    let stage: Stage = 'response-completion-unknown-return';
    try {
      if (value === null) stage = 'response-completion-return';
      else if (nodeTypes.isNativeError(value)) stage = 'response-completion-error-return';
    } catch {
      // Only the fixed classification is evidence, never the Error value.
    }
    if (stage === 'response-completion-unknown-return')
      stageObservationFailures = incrementCount(stageObservationFailures);
    recordStage(stage);
  };
  const selectDraftRequest = (
    request: import('@playwright/test').Request,
    fromResponse: boolean,
  ) => {
    if (draftRequest === null) {
      draftRequest = request;
      draftRequestState = fromResponse ? 'RESPONSE_MATCHED' : 'REQUEST_OBSERVED';
      recordStage(fromResponse ? 'draft-response-request-matched' : 'draft-request-observed');
    } else if (draftRequest !== request) {
      draftRequestState = 'AMBIGUOUS';
      stageObservationFailures = incrementCount(stageObservationFailures);
      recordStage('draft-request-selection-ambiguous');
    } else if (fromResponse && draftRequestState !== 'AMBIGUOUS') {
      draftRequestState = 'RESPONSE_MATCHED';
      recordStage('draft-response-request-matched');
    }
  };
  recordStage('fixture-ready');
  try {
    // Exercise the real failed-save boundary; minute-deadline behavior has its
    // own clock-controlled acceptance case in blocks-product-integration.
    recordStage('page-create-enter');
    const page = await fixture.context.newPage();
    recordStage('page-create-return');
    recordStage('open-enter');
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    recordStage('open-return');
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    recordStage('editor-ready-wait-enter');
    await waitReady(frame);
    recordStage('editor-ready-observed');
    const registerDraftObserver = (
      event: 'request' | 'requestfinished' | 'requestfailed',
      callback: (request: import('@playwright/test').Request) => void,
    ) => {
      try {
        if (event === 'request') page.on('request', callback);
        else if (event === 'requestfinished') page.on('requestfinished', callback);
        else page.on('requestfailed', callback);
      } catch {
        stageObservationFailures = incrementCount(stageObservationFailures);
        recordStage('draft-observer-failed');
      }
    };
    registerDraftObserver('request', (request) => {
      try {
        if (
          request.method() === 'PUT' &&
          request.url() === `${parentOrigin}/api/blocks/runtime/projects/${projectId}/draft`
        ) {
          selectDraftRequest(request, false);
        }
      } catch {
        stageObservationFailures = incrementCount(stageObservationFailures);
        recordStage('draft-observer-failed');
      }
    });
    // Terminal events are associated by object identity, never by a similar URL.
    registerDraftObserver('requestfinished', (request) => {
      if (request === draftRequest) recordStage('draft-requestfinished');
    });
    registerDraftObserver('requestfailed', (request) => {
      if (request === draftRequest) recordStage('draft-requestfailed');
    });
    let recoveryReady = false;
    let recoveryReadyAtResponse = false;
    recordStage('save-and-checkpoint-wait-enter');
    const [response] = await Promise.all([
      page
        .waitForResponse(
          (candidate) => {
            const request = candidate.request();
            const matches =
              request.method() === 'PUT' &&
              candidate.url() === `${parentOrigin}/api/blocks/runtime/projects/${projectId}/draft`;
            if (matches) selectDraftRequest(request, true);
            return matches;
          },
          { timeout: 90_000 },
        )
        .then((candidate) => {
          observedDraftStatus = candidate.status();
          recoveryReadyAtResponse = recoveryReady;
          recordStage('response-headers', { recoveryReadyAtResponse });
          return candidate;
        }),
      (async () => {
        recordStage('edit-enter');
        await setSteps(frame, '10', '73');
        recordStage('checkpoint-wait-enter');
        await expect
          .poll(async () => recoverySteps((await readRecoveryRecords(frame))[0]))
          .toBe('73');
        recoveryReady = true;
        recordStage('checkpoint-observed');
      })(),
    ]);
    recordStage('save-and-checkpoint-wait-return');
    recordStage('response-completion-enter');
    let responseCompletionPromise: ReturnType<import('@playwright/test').Response['finished']>;
    try {
      responseCompletionPromise = response.finished();
    } catch (error) {
      recordStage('response-completion-call-throw');
      throw error;
    }
    recordPromiseReturn('response-completion-call-return', responseCompletionPromise);
    let responseCompletion: Awaited<typeof responseCompletionPromise>;
    try {
      // Await the original returned Promise without adding an observer reaction.
      responseCompletion = await responseCompletionPromise;
    } catch (error) {
      recordStage('response-completion-reject');
      throw error;
    }
    recordResponseCompletion(responseCompletion);
    expect(recoveryReadyAtResponse).toBe(true);
    expect(observedDraftStatus).toBe(503);
    expect(fixture.runtimeDraftEvidence).toHaveLength(1);
    expect(fixture.runtimeDraftEvidence[0]).toMatchObject({
      authorizationOk: true,
      cookiePresent: false,
      urlHasCapability: false,
      originOk: true,
      contentTypeOk: true,
      serverRevisionBefore: 23,
      body: { baseRevision: 23 },
    });
    expect(fixture.runtimeDraftEvidence[0].body.document.projectJson.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Recovery Sprite',
          blocks: expect.objectContaining({
            move: expect.objectContaining({ inputs: { STEPS: [1, [4, '73']] } }),
          }),
        }),
      ]),
    );
    expect(fixture.getServerRevision()).toBe(23);
    recordStage('recovery-read-enter');
    const retainedRecovery = await readRecoveryRecords(frame);
    recordStage('recovery-read-return', {
      retainedCount: retainedRecovery.length,
      retainedStepsMatch73: recoverySteps(retainedRecovery[0]) === '73',
    });
    expect(retainedRecovery).toHaveLength(1);
    expect(recoverySteps(retainedRecovery[0])).toBe('73');
    recordStage('assertions-completed');
  } finally {
    recordStage('finally-enter');
    recordStage('legacy-attachment-enter');
    let attachmentInfo: ReturnType<typeof test.info>;
    let attach: ReturnType<typeof test.info>['attach'];
    let attachmentSetupReturned = false;
    try {
      // Preserve info -> method lookup -> payload preparation -> invocation.
      attachmentInfo = test.info();
      attach = attachmentInfo.attach;
      attachmentSetupReturned = true;
    } finally {
      if (!attachmentSetupReturned) recordStage('legacy-attachment-setup-throw');
    }
    recordStage('legacy-attachment-payload-enter');
    let attachmentOptions: Parameters<typeof attach>[1];
    let attachmentPayloadReturned = false;
    try {
      attachmentOptions = {
        contentType: 'application/json',
        body: JSON.stringify({
          observedDraftStatus,
          serverRevision: fixture.getServerRevision(),
          draftCount: fixture.runtimeDraftEvidence.length,
          drafts: fixture.runtimeDraftEvidence.slice(0, 3).map(({ body, ...provenance }) => ({
            ...provenance,
            baseRevision: body?.baseRevision,
          })),
          errors: fixture.pageErrorEvidence.slice(0, 5).map(({ kind, type, text }) => ({
            kind,
            type,
            text: typeof text === 'string' ? text.slice(0, 500) : undefined,
          })),
        }),
      };
      attachmentPayloadReturned = true;
    } finally {
      if (!attachmentPayloadReturned) recordStage('legacy-attachment-payload-throw');
    }
    recordStage('legacy-attachment-payload-ready');
    recordStage('legacy-attachment-call-enter');
    let attachmentPromise: ReturnType<typeof attach>;
    let attachmentCallReturned = false;
    try {
      attachmentPromise = Reflect.apply(attach, attachmentInfo, [
        'failed-autosave-outcome',
        attachmentOptions,
      ]);
      attachmentCallReturned = true;
    } finally {
      if (!attachmentCallReturned) recordStage('legacy-attachment-call-throw');
    }
    recordPromiseReturn('legacy-attachment-call-return', attachmentPromise);
    let attachmentRejected = false;
    let attachmentAwaitable: Promise<void | undefined>;
    recordStage('legacy-attachment-catch-enter');
    let attachmentCatchReturned = false;
    try {
      // This is the original rejection handler: it still resolves to undefined.
      attachmentAwaitable = attachmentPromise.catch(() => {
        attachmentRejected = true;
        recordStage('legacy-attachment-reject');
        return undefined;
      });
      attachmentCatchReturned = true;
    } finally {
      if (!attachmentCatchReturned) recordStage('legacy-attachment-catch-throw');
    }
    recordPromiseReturn('legacy-attachment-catch-return', attachmentAwaitable);
    recordStage('legacy-attachment-await-enter');
    let attachmentAwaitReturned = false;
    try {
      await attachmentAwaitable;
      attachmentAwaitReturned = true;
    } finally {
      // Only an error propagated by the original catch/await reaches this marker.
      if (!attachmentAwaitReturned) recordStage('legacy-attachment-await-reject');
    }
    if (!attachmentRejected) recordStage('legacy-attachment-fulfilled');
    recordStage('legacy-attachment-return');
    recordStage('teardown-enter');
    let closeReturned = false;
    try {
      await fixture.close();
      closeReturned = true;
    } finally {
      recordStage(closeReturned ? 'teardown-return' : 'teardown-interrupted');
    }
  }
});

test('different account cannot restore or autosave another principal recovery', async () => {
  const serverProject = recoveryBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
  });
  try {
    let page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    let frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    await setSteps(frame, '10', '73');
    await expect.poll(async () => (await readRecoveryRecords(frame)).length).toBe(1);

    await fixture.reopenContextWithIndexedDB();
    page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product?account=b`, { waitUntil: 'domcontentloaded' });
    frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-project-source', 'runtime-session');
    await expectSteps(frame, '10');
    expect(fixture.getServerRevision()).toBe(23);
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);
    const records = await readRecoveryRecords(frame);
    expect(records).toHaveLength(1);
    expect(records[0]?.principalKey).toBe(PRINCIPAL_A);
    expect(recoverySteps(records[0])).toBe('73');
  } finally {
    await fixture.close();
  }
});

test('server-ahead conflict opens server state, does not overwrite, and retains recovery', async () => {
  const serverProject = recoveryBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
  });
  try {
    let page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    let frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    await setSteps(frame, '10', '73');
    await expect.poll(async () => recoverySteps((await readRecoveryRecords(frame))[0])).toBe('73');
    expect(fixture.advanceServerRevision()).toBe(24);

    await fixture.reopenContextWithIndexedDB();
    page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-recovery-state', 'recovery_conflict');
    await expect(shell).toHaveAttribute('data-project-source', 'runtime-session');
    await expectSteps(frame, '10');
    expect(fixture.getServerRevision()).toBe(24);
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);
    const records = await readRecoveryRecords(frame);
    expect(records).toHaveLength(1);
    expect(records[0]?.baseRevision).toBe(23);
    expect(recoverySteps(records[0])).toBe('73');
  } finally {
    await fixture.close();
  }
});
