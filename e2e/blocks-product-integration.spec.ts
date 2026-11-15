import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

let isTelemetryRequest: typeof import('../tools/blocks/browser/telemetry-fixture.mjs').isTelemetryRequest;

let createProtocolFixture: typeof import('../tools/blocks/browser/fixture.mjs').createProtocolFixture;
let advanceMinuteAutosave: typeof import('../tools/blocks/browser/fixture.mjs').advanceMinuteAutosave;
let installMinuteAutosaveClock: typeof import('../tools/blocks/browser/fixture.mjs').installMinuteAutosaveClock;
let waitForMinuteAutosaveArm: typeof import('../tools/blocks/browser/fixture.mjs').waitForMinuteAutosaveArm;
let parentOrigin: string;
let projectId: string;
let runtimeUrl: string;
const evidenceDir = 'reports/blocks/product-integration';
const barkAssetId = 'cd8fa8390b0efdd281882533fbfcfcfb';
const popAssetId = '83a9787d4cb6f3b7632b4ddfebf74367';

const abbyObserverStages = [
  'observer-ready',
  'observer-unavailable',
  'observer-limit-reached',
  'timer-scheduled',
  'timer-enter',
  'timer-return',
  'timer-throw',
  'root-observed',
  'root-unmount-return',
  'root-unmount-throw',
  'saver-registration',
  'saver-registration-throw',
  'vm-registration',
  'vm-to-json-enter',
  'vm-to-json-return',
  'vm-to-json-throw',
  'auto-update-dispatch-enter',
  'auto-update-dispatch-return',
  'auto-update-dispatch-throw',
  'dirty-dispatch-enter',
  'dirty-dispatch-return',
  'dirty-dispatch-throw',
  'project-loaded-enter',
  'project-loaded-return',
  'project-loaded-throw',
  'asset-store-enter',
  'asset-store-return',
  'asset-store-throw',
  'save-project-enter',
  'save-project-return',
  'save-project-throw',
  'recovery-assets-enter',
  'recovery-assets-return',
  'recovery-assets-throw',
] as const;
type AbbyObserverStage = (typeof abbyObserverStages)[number];
const abbyObserverEnums = {
  callbackLink: ['MATCHED', 'DIFFERENT', 'UNREGISTERED', 'STALE', 'MULTIPLE', 'UNKNOWN'],
  registration: ['SET', 'REPEATED', 'REPLACED', 'CLEARED', 'UNKNOWN'],
  synchronousContext: ['LINKED_AUTO_UPDATE_DISPATCH_STACK', 'LINKED_TIMER_STACK', 'UNATTRIBUTED'],
  reduxLoadingState: [
    'NOT_LOADED',
    'ERROR',
    'AUTO_UPDATING',
    'CREATING_COPY',
    'CREATING_NEW',
    'FETCHING_NEW_DEFAULT',
    'FETCHING_WITH_ID',
    'LOADING_VM_FILE_UPLOAD',
    'LOADING_VM_NEW_DEFAULT',
    'LOADING_VM_WITH_ID',
    'MANUAL_UPDATING',
    'REMIXING',
    'SHOWING_WITH_ID',
    'SHOWING_WITHOUT_ID',
    'UPDATING_BEFORE_COPY',
    'UPDATING_BEFORE_NEW',
    'UNKNOWN',
  ],
  reduxTimer: ['ARMED', 'EMPTY', 'UNKNOWN'],
  dirtyRootAssociation: ['UNIQUE_ACTIVE_STORE', 'MULTIPLE_ACTIVE_STORES', 'UNKNOWN'],
  bundleCallsite: ['URL_MATCHED_NUMERIC_POSITIONS_ONLY', 'UNKNOWN'],
  bundleCallsiteReason: [
    'OWN_DATA_STACK',
    'STACK_ACCESSOR_UNSUPPORTED',
    'STACK_ABSENT',
    'STACK_NON_STRING',
    'STACK_TOO_LARGE',
    'STACK_LINE_LIMIT',
    'NO_ELIGIBLE_FRAME',
    'CAPTURE_ERROR',
  ],
} as const;
type AbbyStageEvent = {
  sequence: number;
  stage: string;
  callbackId?: number;
  delayMs?: number;
  timerHandle?: number;
  observerSequence?: number;
  rootId?: number;
  vmId?: number;
  callId?: number;
  dispatchId?: number;
  dirtyDispatchId?: number;
  loadedCallId?: number;
  observerFailures?: number;
  captureFailures?: number;
  actionChanged?: boolean;
  rootActive?: boolean;
  bundleFrames?: Array<{ line: number; column: number }>;
  bundleFramesTruncated?: boolean;
  reduxProjectChanged?: boolean | 'UNKNOWN';
  renderCanSave?: boolean | 'UNKNOWN';
} & { [Key in keyof typeof abbyObserverEnums]?: (typeof abbyObserverEnums)[Key][number] };

function createAbbySaveStageEvidence(
  cleanPop: boolean,
  fixture: Awaited<ReturnType<typeof createProtocolFixture>>,
) {
  const path = `${evidenceDir}/abby-pop-${cleanPop ? 'clean' : 'native'}-save-stages.json`;
  const events: AbbyStageEvent[] = [];
  let sequence = 0;
  let rejectedObserverEvents = 0;
  let droppedEvents = 0;
  let writeFailures = 0;
  let observerFailures = 0;
  let captureFailures = 0;
  let assertionsCompleted = false;
  let teardownCompleted = false;
  let linkedCallbackObserved = false;
  const observed = new Set<string>();
  const receivedBrowserEvents = new Map<number, string>();
  let duplicateObserverSequences = 0;
  let conflictingObserverSequences = 0;
  let unsequencedObserverEvents = 0;
  let reconciliationReason = 'PUBLISHED_PREFIX_NOT_READ';
  let finalSnapshot: {
    lastSequence: number;
    suppressedEvents: number;
    observerFailures: number;
    captureFailures: number;
    rootCoverageLost: boolean;
    storeDispatchCoverage: 'MATCHED' | 'UNAVAILABLE' | 'NO_ACTIVE_ROOT';
    events: Omit<AbbyStageEvent, 'sequence'>[];
  } | null = null;
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const reconciliation = () => {
    const recoveredSequences: number[] = [];
    const mismatchedSequences: number[] = [];
    for (const event of finalSnapshot?.events ?? []) {
      const observerSequence = event.observerSequence!;
      const received = receivedBrowserEvents.get(observerSequence);
      if (received === undefined) recoveredSequences.push(observerSequence);
      else if (received !== JSON.stringify(event)) mismatchedSequences.push(observerSequence);
    }
    const complete =
      finalSnapshot !== null &&
      reconciliationReason === 'CONTIGUOUS_PUBLISHED_PREFIX' &&
      finalSnapshot.suppressedEvents === 0 &&
      finalSnapshot.observerFailures === 0 &&
      finalSnapshot.captureFailures === 0 &&
      !finalSnapshot.rootCoverageLost &&
      finalSnapshot.storeDispatchCoverage === 'MATCHED' &&
      !finalSnapshot.events.some(
        (event) =>
          event.stage === 'observer-unavailable' || event.stage === 'observer-limit-reached',
      ) &&
      duplicateObserverSequences === 0 &&
      conflictingObserverSequences === 0 &&
      unsequencedObserverEvents === 0 &&
      rejectedObserverEvents === 0 &&
      droppedEvents === 0 &&
      mismatchedSequences.length === 0;
    return {
      status: complete
        ? 'RECONCILED_PUBLISHED_PREFIX'
        : finalSnapshot === null && reconciliationReason !== 'INVALID_PUBLISHED_PREFIX'
          ? 'NOT_OBSERVED'
          : 'INCOMPLETE',
      reason: reconciliationReason,
      scope: 'last-successfully-published-diagnostic-prefix-read-at-existing-final-checkpoint',
      snapshotOwnership: 'NOT_ATTESTED_BY_PASSIVE_DATA',
      publicationAge: 'UNKNOWN',
      emissionsAfterLastPublication: 'NOT_ATTESTED',
      laterCaptureOrPublicationFailures: 'UNKNOWN',
      storeDispatchCoverageScope: 'AT_LAST_SUCCESSFUL_PUBLICATION_ONLY',
      finalStoreDispatchCoverage: 'NOT_OBSERVED',
      productCallCoverage: 'NOT_PROVEN_BY_DIAGNOSTIC_SEQUENCE_CONTIGUITY',
      retainedEventLimit: 129,
      lastSequence: finalSnapshot?.lastSequence ?? null,
      suppressedEvents: finalSnapshot?.suppressedEvents ?? null,
      observerFailures: finalSnapshot?.observerFailures ?? null,
      captureFailures: finalSnapshot?.captureFailures ?? null,
      rootCoverageLost: finalSnapshot?.rootCoverageLost ?? null,
      storeDispatchCoverage: finalSnapshot?.storeDispatchCoverage ?? 'UNKNOWN',
      observerUnavailableObserved:
        finalSnapshot?.events.some((event) => event.stage === 'observer-unavailable') ?? null,
      eventLimitReached:
        finalSnapshot?.events.some((event) => event.stage === 'observer-limit-reached') ?? null,
      recoveredSequencesAbsentFromCurrentNodeReceipt: recoveredSequences,
      mismatchedSequences,
      duplicateObserverSequences,
      conflictingObserverSequences,
      unsequencedObserverEvents,
      rejectedObserverEvents,
      droppedNodeEvents: droppedEvents,
      nodeSequencesAfterSnapshot:
        finalSnapshot === null
          ? []
          : [...receivedBrowserEvents.keys()].filter((item) => item > finalSnapshot!.lastSequence),
      events: finalSnapshot?.events ?? [],
    };
  };
  const record = (stage: string, detail: Omit<AbbyStageEvent, 'sequence' | 'stage'> = {}) => {
    sequence += 1;
    if (stage === 'assertions-completed') assertionsCompleted = true;
    if (stage === 'teardown-return') teardownCompleted = true;
    observed.add(stage);
    if (events.length < 256) events.push({ sequence, stage, ...detail });
    else droppedEvents += 1;
    try {
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(
        `${path}.tmp`,
        JSON.stringify(
          {
            schemaVersion: 3,
            variant: cleanPop ? 'clean-pop' : 'default-cached-pop',
            lastStage: stage,
            outcome: assertionsCompleted && teardownCompleted ? 'NOT_REPRODUCED' : 'INCOMPLETE',
            // A passive published prefix cannot attest events or failures after
            // its last publication, even when every retained sequence matches.
            captureState: 'INCOMPLETE',
            finalCheckpointCompleteness: 'NOT_ATTESTED_BY_PUBLISHED_PREFIX',
            eventOrder: 'node-receive-order-with-separate-browser-observer-sequence',
            browserDeliveryCompleteness: 'ASYNCHRONOUS_BINDING_DELIVERY_NOT_ATTESTED',
            browserSequenceReconciliation: reconciliation(),
            callbackIdentityScope: 'function-reference-within-first-runtime-realm',
            projectSaverCallbackLink: linkedCallbackObserved ? 'OBSERVED' : 'NOT_OBSERVED',
            vmSerialization: observed.has('vm-to-json-enter') ? 'OBSERVED' : 'NOT_OBSERVED',
            projectSaverSerialization: 'NOT_OBSERVED',
            serializationAttribution: 'synchronous-stack-context-only-not-caller-identification',
            reduxStateScope: 'public-store-not-react-instance-props',
            bundleCallsiteMapping: 'NOT_PERFORMED_REQUIRES_NEW_ACTUAL_BUNDLE_SHA256',
            bundleCallsiteSource: '/internal/blocks/vendor/scratch/scratch-gui-standalone.js',
            dirtyCallerAttribution: 'UNKNOWN',
            projectLoadedScope: 'original-callback-supplied-at-root-render-not-current-react-props',
            asynchronousReturnSettlement: 'NOT_OBSERVED',
            boundaryObservationSources: [
              'asynchronous-binding',
              'validated-last-published-browser-prefix',
            ],
            boundaries: Object.fromEntries(
              [
                'timer-enter',
                'saver-registration',
                'auto-update-dispatch-enter',
                'auto-update-dispatch-return',
                'dirty-dispatch-enter',
                'dirty-dispatch-return',
                'dirty-dispatch-throw',
                'project-loaded-enter',
                'project-loaded-return',
                'project-loaded-throw',
                'vm-to-json-enter',
                'vm-to-json-return',
                'vm-to-json-throw',
                'asset-store-enter',
                'save-project-enter',
                'recovery-assets-enter',
              ].map((boundary) => [boundary, observed.has(boundary) ? 'OBSERVED' : 'NOT_OBSERVED']),
            ),
            revision: count(fixture.getServerRevision()),
            assetRequests: count(fixture.runtimePersistenceMetrics.assetRequests),
            draftRequests: count(fixture.runtimePersistenceMetrics.draftRequests),
            revisionCommits: count(fixture.runtimePersistenceMetrics.revisionCommits),
            events,
            droppedEvents,
            rejectedObserverEvents,
            observerFailures,
            captureFailures,
            writeFailures,
          },
          null,
          2,
        ),
      );
      fs.renameSync(`${path}.tmp`, path);
    } catch {
      // A diagnostic write cannot replace an assertion or prevent teardown.
      writeFailures += 1;
    }
  };
  const parseObserverEvent = (input: unknown) => {
    // Browser values never become artifact fields without this second allowlist.
    if (!input || typeof input !== 'object') throw null;
    const value = (key: string) => {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor && !('value' in descriptor)) throw null;
      return descriptor?.value as unknown;
    };
    const stage = value('stage');
    if (!abbyObserverStages.includes(stage as AbbyObserverStage)) throw null;
    const detail: Omit<AbbyStageEvent, 'sequence' | 'stage'> = {};
    const limits = {
      callbackId: 64,
      rootId: 8,
      vmId: 8,
      callId: 1_000_000,
      dispatchId: 1_000_000,
      dirtyDispatchId: 1_000_000,
      loadedCallId: 1_000_000,
      timerHandle: Number.MAX_SAFE_INTEGER,
      observerSequence: 129,
      observerFailures: 1_000_000,
      captureFailures: 1_000_000,
    } as const;
    for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
      const item = value(key);
      if (item === undefined) continue;
      if (typeof item !== 'number' || count(item) === null || item > limits[key]) throw null;
      detail[key] = item;
    }
    const delay = value('delayMs');
    if (delay !== undefined) {
      if (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 55_000 || delay > 65_000)
        throw null;
      detail.delayMs = delay;
    }
    for (const key of ['reduxProjectChanged', 'renderCanSave'] as const) {
      const item = value(key);
      if (item === undefined) continue;
      if (typeof item !== 'boolean' && item !== 'UNKNOWN') throw null;
      detail[key] = item;
    }
    for (const key of ['actionChanged', 'rootActive', 'bundleFramesTruncated'] as const) {
      const item = value(key);
      if (item === undefined) continue;
      if (typeof item !== 'boolean') throw null;
      detail[key] = item;
    }
    const frames = value('bundleFrames');
    if (frames !== undefined) {
      if (!Array.isArray(frames)) throw null;
      const length = Object.getOwnPropertyDescriptor(frames, 'length')?.value as unknown;
      if (typeof length !== 'number' || count(length) === null || length > 8) throw null;
      detail.bundleFrames = [];
      for (let index = 0; index < length; index += 1) {
        const frame = Object.getOwnPropertyDescriptor(frames, String(index))?.value as unknown;
        if (!frame || typeof frame !== 'object') throw null;
        const line = Object.getOwnPropertyDescriptor(frame, 'line')?.value as unknown;
        const column = Object.getOwnPropertyDescriptor(frame, 'column')?.value as unknown;
        if (
          typeof line !== 'number' ||
          count(line) === null ||
          line < 1 ||
          line > 100_000_000 ||
          typeof column !== 'number' ||
          count(column) === null ||
          column < 1 ||
          column > 100_000_000
        )
          throw null;
        detail.bundleFrames.push({ line, column });
      }
    }
    for (const key of Object.keys(abbyObserverEnums) as (keyof typeof abbyObserverEnums)[]) {
      const item = value(key);
      if (item === undefined) continue;
      const allowed: readonly string[] = abbyObserverEnums[key];
      if (typeof item !== 'string' || !allowed.includes(item)) throw null;
      Object.assign(detail, { [key]: item });
    }
    if (stage === 'timer-enter' && detail.callbackLink === 'MATCHED') {
      if (!detail.callbackId || !detail.rootId) throw null;
    }
    if ((stage as string).startsWith('dirty-dispatch-')) {
      if (
        !detail.dirtyDispatchId ||
        typeof detail.actionChanged !== 'boolean' ||
        detail.dirtyRootAssociation === undefined
      )
        throw null;
      if (
        detail.dirtyRootAssociation === 'UNIQUE_ACTIVE_STORE' &&
        (!detail.rootId || typeof detail.rootActive !== 'boolean')
      )
        throw null;
      if (detail.dirtyRootAssociation !== 'UNIQUE_ACTIVE_STORE' && detail.rootId !== undefined)
        throw null;
    }
    if (
      (stage as string).startsWith('project-loaded-') &&
      (!detail.loadedCallId || !detail.rootId || typeof detail.rootActive !== 'boolean')
    )
      throw null;
    if (
      detail.bundleCallsite === 'URL_MATCHED_NUMERIC_POSITIONS_ONLY' &&
      (!detail.bundleFrames?.length || typeof detail.bundleFramesTruncated !== 'boolean')
    )
      throw null;
    if (detail.bundleCallsite === 'UNKNOWN' && detail.bundleFrames !== undefined) throw null;
    return { stage: stage as AbbyObserverStage, ...detail };
  };
  const observer = (input: unknown) => {
    try {
      const event = parseObserverEvent(input);
      const { stage, ...detail } = event;
      if (stage === 'timer-enter' && detail.callbackLink === 'MATCHED')
        linkedCallbackObserved = true;
      observerFailures = Math.max(observerFailures, detail.observerFailures ?? 0);
      captureFailures = Math.max(captureFailures, detail.captureFailures ?? 0);
      if (detail.observerSequence === undefined || detail.observerSequence < 1) {
        unsequencedObserverEvents = Math.min(unsequencedObserverEvents + 1, 1_000_000);
      } else {
        const encoded = JSON.stringify(event);
        const previous = receivedBrowserEvents.get(detail.observerSequence);
        if (previous !== undefined) {
          duplicateObserverSequences = Math.min(duplicateObserverSequences + 1, 1_000_000);
          if (previous !== encoded) {
            conflictingObserverSequences = Math.min(conflictingObserverSequences + 1, 1_000_000);
          }
        } else receivedBrowserEvents.set(detail.observerSequence, encoded);
      }
      record(stage, detail);
    } catch {
      rejectedObserverEvents += 1;
      record('observer-event-rejected');
    }
  };
  const reconcile = (input: unknown) => {
    finalSnapshot = null;
    if (input === null || input === undefined) {
      // The successful path replaces page/context before this existing read.
      // An absent first-realm journal never proves delivery or contiguity.
      reconciliationReason = 'UNAVAILABLE_OR_DIFFERENT_RUNTIME_REALM';
      record('browser-sequence-snapshot-unavailable');
      return;
    }
    try {
      if (typeof input !== 'string' || input.length > 262_144) throw null;
      const decoded: unknown = JSON.parse(input);
      if (!decoded || typeof decoded !== 'object') throw null;
      const value = (key: string) =>
        Object.getOwnPropertyDescriptor(decoded, key)?.value as unknown;
      if (value('schemaVersion') !== 2 || value('eventLimit') !== 128) throw null;
      const numeric = (key: string, limit: number) => {
        const item = value(key);
        if (typeof item !== 'number' || count(item) === null || item > limit) throw null;
        return item;
      };
      const lastSequence = numeric('lastSequence', 129);
      if (lastSequence < 1) throw null;
      const suppressedEvents = numeric('suppressedEvents', 1_000_000);
      const snapshotObserverFailures = numeric('observerFailures', 1_000_000);
      const snapshotCaptureFailures = numeric('captureFailures', 1_000_000);
      const rootCoverageLost = value('rootCoverageLost');
      if (typeof rootCoverageLost !== 'boolean') throw null;
      const storeDispatchCoverage = value('storeDispatchCoverage');
      if (!['MATCHED', 'UNAVAILABLE', 'NO_ACTIVE_ROOT'].includes(storeDispatchCoverage as string)) {
        throw null;
      }
      const rawEvents = value('events');
      if (!Array.isArray(rawEvents)) throw null;
      const length = Object.getOwnPropertyDescriptor(rawEvents, 'length')?.value as unknown;
      if (length !== lastSequence) throw null;
      const events: Omit<AbbyStageEvent, 'sequence'>[] = [];
      for (let index = 0; index < lastSequence; index += 1) {
        const event = parseObserverEvent(
          Object.getOwnPropertyDescriptor(rawEvents, String(index))?.value,
        );
        if (event.observerSequence !== index + 1) throw null;
        if (
          (event.observerFailures ?? 0) > snapshotObserverFailures ||
          (event.captureFailures ?? 0) > snapshotCaptureFailures
        )
          throw null;
        events.push(event);
      }
      finalSnapshot = {
        lastSequence,
        suppressedEvents,
        observerFailures: snapshotObserverFailures,
        captureFailures: snapshotCaptureFailures,
        rootCoverageLost,
        storeDispatchCoverage: storeDispatchCoverage as
          'MATCHED' | 'UNAVAILABLE' | 'NO_ACTIVE_ROOT',
        events,
      };
      for (const event of events) {
        observed.add(event.stage);
        if (event.stage === 'timer-enter' && event.callbackLink === 'MATCHED') {
          linkedCallbackObserved = true;
        }
      }
      observerFailures = Math.max(observerFailures, snapshotObserverFailures);
      captureFailures = Math.max(captureFailures, snapshotCaptureFailures);
      reconciliationReason = 'CONTIGUOUS_PUBLISHED_PREFIX';
      record('browser-sequence-snapshot-read');
    } catch {
      reconciliationReason = 'INVALID_PUBLISHED_PREFIX';
      record('browser-sequence-snapshot-rejected');
    }
  };
  record('fixture-ready');
  return { record, observer, reconcile };
}

async function installAbbySaveStageObserver(
  page: import('@playwright/test').Page,
  observer: (input: unknown) => void,
) {
  const binding = '__asaAbbySaveStageEvidence';
  await page.exposeBinding(binding, (_source, input: unknown) => observer(input));
  await page.addInitScript(
    ({ bindingName, enums }) => {
      if (!globalThis.location.pathname.startsWith('/internal/blocks/')) return;
      type Callable = (...args: unknown[]) => unknown;
      type Detail = Record<string, unknown>;
      type RootObservation = {
        id: number;
        active: boolean;
        registrationKnown: boolean;
        saver: Callable | null;
        store: object | null;
        vm: object | null;
        canSave: boolean | 'UNKNOWN';
        cleanup: Set<() => void>;
      };
      type TimerContext = { callbackId: number; root?: RootObservation };
      type DispatchContext = { id: number; store: object; root?: RootObservation };
      const globals = globalThis as unknown as Record<string, unknown>;
      const snapshotKey = '__asaAbbySaveStageSnapshot';
      const encodeDiagnostic = JSON.stringify;
      let publishedSnapshot = '';
      let publicationEnabled = false;
      let publishing = false;
      let emitted = 0;
      let observerFailures = 0;
      let captureFailures = 0;
      let suppressedEvents = 0;
      const browserEvents: Detail[] = [];
      const deliveryFailed = () => {
        observerFailures = Math.min(observerFailures + 1, 1_000_000);
        publishSnapshot();
      };
      const emit = (stage: string, detail: Detail = {}) => {
        try {
          if (emitted >= 128) suppressedEvents = Math.min(suppressedEvents + 1, 1_000_000);
          if (emitted > 128) return;
          const event =
            emitted === 128 ? { stage: 'observer-limit-reached' } : { stage, ...detail };
          emitted += 1;
          const observedEvent = {
            ...event,
            observerSequence: emitted,
            observerFailures,
            captureFailures,
          };
          // Retain the same bounded diagnostic emissions before asynchronous
          // delivery. The final reader never invokes a product method or timer.
          browserEvents.push(observedEvent);
          // Only this diagnostic Promise receives a rejection handler. Original
          // product results are returned without reading then/catch/finally.
          const send = globals[bindingName] as (value: unknown) => Promise<void>;
          void send({ ...observedEvent }).catch(deliveryFailed);
        } catch {
          deliveryFailed();
          // Reporting must not change an original call, return or thrown value.
        } finally {
          publishSnapshot();
        }
      };
      const safely = (observe: () => void) => {
        try {
          observe();
        } catch {
          captureFailures = Math.min(captureFailures + 1, 1_000_000);
          emit('observer-unavailable');
        }
      };
      const isObject = (value: unknown): value is object =>
        value !== null && (typeof value === 'object' || typeof value === 'function');
      // Do not invoke an accessor merely to collect evidence.
      const ownValue = (object: unknown, key: string): unknown =>
        isObject(object) ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined;
      const restoreMethod = (object: object, key: string, wrap: (fn: Callable) => Callable) => {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        if (!descriptor || typeof descriptor.value !== 'function' || !descriptor.writable) {
          emit('observer-unavailable');
          return null;
        }
        const replacement = wrap(descriptor.value as Callable);
        Object.defineProperty(object, key, { ...descriptor, value: replacement });
        return () => {
          const current = Object.getOwnPropertyDescriptor(object, key);
          if (
            current?.value === replacement &&
            current.configurable === descriptor.configurable &&
            current.enumerable === descriptor.enumerable &&
            current.writable === descriptor.writable
          ) {
            Object.defineProperty(object, key, descriptor);
          }
          // A product replacement is never overwritten during observer cleanup.
        };
      };
      const roots: RootObservation[] = [];
      const observedRoots = new WeakMap<object, RootObservation>();
      let rootCoverageLost = false;
      let activeTimer: TimerContext | undefined;
      let activeDispatch: DispatchContext | undefined;
      let nextCallbackId = 0;
      let nextVmId = 0;
      let nextDispatchId = 0;
      let nextDirtyDispatchId = 0;
      let nextLoadedCallId = 0;
      const callbacks = new WeakMap<
        Callable,
        { id: number; observed: Callable; registered: boolean }
      >();
      const vms = new WeakMap<object, { id: number; calls: number }>();
      const sharedMethods = new WeakMap<
        object,
        Map<
          string,
          {
            users: Set<RootObservation>;
            restore: () => void;
            observed: Callable;
          }
        >
      >();
      const publishSnapshot = () => {
        if (!publicationEnabled || publishing) return;
        publishing = true;
        try {
          const descriptor = Object.getOwnPropertyDescriptor(globalThis, snapshotKey);
          if (
            descriptor?.value !== publishedSnapshot ||
            descriptor.configurable !== true ||
            descriptor.enumerable !== false ||
            descriptor.writable !== false
          ) {
            publicationEnabled = false;
            captureFailures = Math.min(captureFailures + 1, 1_000_000);
            emit('observer-unavailable');
            return;
          }
          let storeDispatchCoverage = 'UNAVAILABLE';
          try {
            const active = roots.filter((root) => root.active);
            storeDispatchCoverage =
              active.length === 0
                ? 'NO_ACTIVE_ROOT'
                : active.every((root) => {
                      if (!root.store) return false;
                      const method = sharedMethods.get(root.store)?.get('dispatch');
                      return (
                        method !== undefined &&
                        Object.getOwnPropertyDescriptor(root.store, 'dispatch')?.value ===
                          method.observed
                      );
                    })
                  ? 'MATCHED'
                  : 'UNAVAILABLE';
          } catch {
            captureFailures = Math.min(captureFailures + 1, 1_000_000);
          }
          // Serialize only our bounded diagnostic values. Null prototypes on
          // every copied object/array prevent inherited product toJSON hooks.
          const publishedEvents = browserEvents.map((event) => {
            const copy = Object.assign(Object.create(null) as Detail, event);
            if (Array.isArray(event.bundleFrames)) {
              const frames = event.bundleFrames.map((frame: { line: number; column: number }) =>
                Object.assign(Object.create(null) as Detail, {
                  line: frame.line,
                  column: frame.column,
                }),
              );
              copy.bundleFrames = Object.setPrototypeOf(frames, null);
            }
            return copy;
          });
          const encoded = encodeDiagnostic(
            Object.assign(Object.create(null) as Detail, {
              schemaVersion: 2,
              eventLimit: 128,
              lastSequence: emitted,
              suppressedEvents,
              observerFailures,
              captureFailures,
              rootCoverageLost,
              storeDispatchCoverage,
              events: Object.setPrototypeOf(publishedEvents, null),
            }),
          );
          if (encoded.length > 262_144) throw null;
          // Preserve any product replacement. A failed publication may leave
          // an older string, which never proves coverage at the final read.
          const current = Object.getOwnPropertyDescriptor(globalThis, snapshotKey);
          if (
            current?.value !== publishedSnapshot ||
            current.configurable !== true ||
            current.enumerable !== false ||
            current.writable !== false
          )
            throw null;
          Object.defineProperty(globalThis, snapshotKey, { ...descriptor, value: encoded });
          publishedSnapshot = encoded;
        } catch {
          publicationEnabled = false;
          captureFailures = Math.min(captureFailures + 1, 1_000_000);
          emit('observer-unavailable');
        } finally {
          publishing = false;
        }
      };
      const snapshot = (root: RootObservation | undefined): Detail => {
        const detail: Detail = {
          reduxProjectChanged: 'UNKNOWN',
          reduxLoadingState: 'UNKNOWN',
          reduxTimer: 'UNKNOWN',
          renderCanSave: root?.canSave ?? 'UNKNOWN',
        };
        if (!root?.store) return detail;
        safely(() => {
          const getState = ownValue(root.store, 'getState');
          if (typeof getState !== 'function') return;
          const state = Reflect.apply(getState, root.store, []);
          const gui = ownValue(state, 'scratchGui');
          const changed = ownValue(gui, 'projectChanged');
          const loading = ownValue(ownValue(gui, 'projectState'), 'loadingState');
          const timeout = ownValue(ownValue(gui, 'timeout'), 'autoSaveTimeoutId');
          detail.reduxProjectChanged = typeof changed === 'boolean' ? changed : 'UNKNOWN';
          if (
            typeof loading === 'string' &&
            (enums.reduxLoadingState as readonly string[]).includes(loading)
          ) {
            detail.reduxLoadingState = loading;
          }
          detail.reduxTimer =
            timeout === null
              ? 'EMPTY'
              : typeof timeout === 'number' && Number.isSafeInteger(timeout)
                ? 'ARMED'
                : 'UNKNOWN';
        });
        return detail;
      };
      const dirtyCallsite = (): Detail => {
        const unknown = (reason: string) => ({
          bundleCallsite: 'UNKNOWN',
          bundleCallsiteReason: reason,
          bundleFramesTruncated: false,
        });
        try {
          // Only an own data stack from this diagnostic Error is supported.
          // Do not invoke an accessor, change stackTraceLimit, retain a raw stack,
          // or identify callers by function names. A new actual bundle digest
          // and source mapping are still required before using these positions.
          const descriptor = Object.getOwnPropertyDescriptor(new Error(), 'stack');
          if (!descriptor) return unknown('STACK_ABSENT');
          if (!('value' in descriptor)) return unknown('STACK_ACCESSOR_UNSUPPORTED');
          const stack = descriptor.value as unknown;
          if (typeof stack !== 'string') return unknown('STACK_NON_STRING');
          if (stack.length > 65_536) return unknown('STACK_TOO_LARGE');
          const lines = stack.split(/\r?\n/);
          if (lines.length > 64) return unknown('STACK_LINE_LIMIT');
          const source = `${globalThis.location.origin}/internal/blocks/vendor/scratch/scratch-gui-standalone.js`;
          const frames: Array<{ line: number; column: number }> = [];
          let truncated = false;
          for (const line of lines) {
            const match = line.match(
              /(?:^ {4}at | \()(https?:\/\/[^\s()]+):([1-9]\d{0,8}):([1-9]\d{0,8})\)?$/,
            );
            if (!match || match[1] !== source) continue;
            const sourceLine = Number(match[2]);
            const column = Number(match[3]);
            if (sourceLine > 100_000_000 || column > 100_000_000) continue;
            if (frames.length < 8) frames.push({ line: sourceLine, column });
            else truncated = true;
          }
          if (frames.length === 0) return unknown('NO_ELIGIBLE_FRAME');
          return {
            bundleCallsite: 'URL_MATCHED_NUMERIC_POSITIONS_ONLY',
            bundleCallsiteReason: 'OWN_DATA_STACK',
            bundleFrames: frames,
            bundleFramesTruncated: truncated,
          };
        } catch {
          return unknown('CAPTURE_ERROR');
        }
      };
      const link = (callback: Callable): { callbackLink: string; root?: RootObservation } => {
        const active = roots.filter((root) => root.active);
        const matches = active.filter((root) => root.registrationKnown && root.saver === callback);
        if (matches.length > 1) return { callbackLink: 'MULTIPLE' };
        if (rootCoverageLost || active.some((root) => !root.registrationKnown)) {
          return { callbackLink: 'UNKNOWN' };
        }
        if (matches.length === 1) return { callbackLink: 'MATCHED', root: matches[0] };
        if (callbacks.get(callback)?.registered) return { callbackLink: 'STALE' };
        return { callbackLink: active.some((root) => root.saver) ? 'DIFFERENT' : 'UNREGISTERED' };
      };
      const callbackEntry = (callback: Callable) => {
        let entry = callbacks.get(callback);
        if (entry) return entry;
        if (nextCallbackId >= 64) {
          emit('observer-limit-reached');
          return undefined;
        }
        const id = ++nextCallbackId;
        entry = {
          id,
          registered: false,
          observed: new Proxy(callback, {
            apply(target, receiver, args) {
              const previous = activeTimer;
              let detail: Detail = { callbackId: id, callbackLink: 'UNKNOWN' };
              activeTimer = undefined;
              safely(() => {
                const association = link(target);
                activeTimer = { callbackId: id, root: association.root };
                detail = {
                  callbackId: id,
                  callbackLink: association.callbackLink,
                  ...(association.root ? { rootId: association.root.id } : {}),
                };
                emit('timer-enter', { ...detail, ...snapshot(association.root) });
              });
              let returned = false;
              try {
                const result = Reflect.apply(target, receiver, args);
                returned = true;
                return result;
              } finally {
                safely(() => {
                  const association = link(target);
                  emit(returned ? 'timer-return' : 'timer-throw', {
                    callbackId: id,
                    callbackLink: association.callbackLink,
                    ...(association.root ? { rootId: association.root.id } : {}),
                    ...snapshot(association.root),
                  });
                });
                activeTimer = previous;
              }
            },
          }),
        };
        callbacks.set(callback, entry);
        return entry;
      };
      const shareMethod = (
        root: RootObservation,
        owner: object,
        key: string,
        wrap: (fn: Callable) => Callable,
      ) => {
        let methods = sharedMethods.get(owner);
        if (!methods) {
          methods = new Map();
          sharedMethods.set(owner, methods);
        }
        let method = methods.get(key);
        if (method && Object.getOwnPropertyDescriptor(owner, key)?.value !== method.observed) {
          // A product replacement ends this shared hook's coverage. Decline it
          // explicitly instead of claiming coverage or reinstalling the hook.
          emit('observer-unavailable');
          return;
        }
        if (!method) {
          let observed: Callable | undefined;
          const restore = restoreMethod(owner, key, (fn) => {
            observed = wrap(fn);
            return observed;
          });
          if (!restore || !observed) return;
          method = { users: new Set(), restore, observed };
          methods.set(key, method);
        }
        if (method.users.has(root)) return;
        method.users.add(root);
        const shared = method;
        root.cleanup.add(() => {
          shared.users.delete(root);
          if (shared.users.size === 0) {
            shared.restore();
            methods.delete(key);
          }
        });
      };
      const observeStore = (root: RootObservation) => {
        const store = root.store;
        if (!store) {
          emit('observer-unavailable');
          return;
        }
        shareMethod(
          root,
          store,
          'dispatch',
          (fn) =>
            new Proxy(fn, {
              apply(target, receiver, args) {
                let relevant = false;
                let dirtyChanged: boolean | undefined;
                safely(() => {
                  const type = ownValue(args[0], 'type');
                  relevant = type === 'scratch-gui/project-state/START_AUTO_UPDATING';
                  if (type === 'scratch-gui/project-changed/SET_PROJECT_CHANGED') {
                    const changed = ownValue(args[0], 'changed');
                    if (typeof changed === 'boolean') dirtyChanged = changed;
                    else emit('observer-unavailable');
                  }
                });
                if (dirtyChanged !== undefined) {
                  let detail: Detail | undefined;
                  let currentRoot: RootObservation | undefined;
                  safely(() => {
                    if (nextDirtyDispatchId >= 1_000_000) {
                      emit('observer-limit-reached');
                      return;
                    }
                    const candidates = roots.filter((item) => item.active && item.store === store);
                    currentRoot =
                      !rootCoverageLost && candidates.length === 1 ? candidates[0] : undefined;
                    detail = {
                      dirtyDispatchId: ++nextDirtyDispatchId,
                      actionChanged: dirtyChanged,
                      dirtyRootAssociation:
                        rootCoverageLost || candidates.length === 0
                          ? 'UNKNOWN'
                          : candidates.length === 1
                            ? 'UNIQUE_ACTIVE_STORE'
                            : 'MULTIPLE_ACTIVE_STORES',
                      ...(currentRoot
                        ? { rootId: currentRoot.id, rootActive: currentRoot.active }
                        : {}),
                      ...dirtyCallsite(),
                    };
                    emit('dirty-dispatch-enter', { ...detail, ...snapshot(currentRoot) });
                  });
                  // Dirty dispatches never install, clear or relabel the existing
                  // AUTO_UPDATING stack context, including nested dispatch/throw.
                  let returned = false;
                  try {
                    const result = Reflect.apply(target, receiver, args);
                    returned = true;
                    return result;
                  } finally {
                    if (detail)
                      safely(() =>
                        emit(returned ? 'dirty-dispatch-return' : 'dirty-dispatch-throw', {
                          ...detail,
                          ...(currentRoot ? { rootActive: currentRoot.active } : {}),
                          ...snapshot(currentRoot?.active ? currentRoot : undefined),
                        }),
                      );
                  }
                }
                if (!relevant) return Reflect.apply(target, receiver, args);
                const previous = activeDispatch;
                let detail: Detail = { synchronousContext: 'UNATTRIBUTED' };
                activeDispatch = undefined;
                safely(() => {
                  if (nextDispatchId >= 1_000_000) {
                    emit('observer-limit-reached');
                    return;
                  }
                  const candidates = roots.filter((item) => item.active && item.store === store);
                  const linked = activeTimer?.root;
                  const currentRoot =
                    linked?.store === store
                      ? linked
                      : candidates.length === 1
                        ? candidates[0]
                        : undefined;
                  activeDispatch = {
                    id: ++nextDispatchId,
                    store,
                    root: linked?.store === store ? linked : undefined,
                  };
                  detail = {
                    dispatchId: activeDispatch.id,
                    ...(currentRoot ? { rootId: currentRoot.id } : {}),
                    ...(activeDispatch.root ? { callbackId: activeTimer?.callbackId } : {}),
                    synchronousContext: activeDispatch.root
                      ? 'LINKED_AUTO_UPDATE_DISPATCH_STACK'
                      : 'UNATTRIBUTED',
                  };
                  emit('auto-update-dispatch-enter', { ...detail, ...snapshot(currentRoot) });
                });
                let returned = false;
                try {
                  const result = Reflect.apply(target, receiver, args);
                  returned = true;
                  return result;
                } finally {
                  safely(() => {
                    const currentRoot = roots.find((item) => item.id === detail.rootId);
                    emit(returned ? 'auto-update-dispatch-return' : 'auto-update-dispatch-throw', {
                      ...detail,
                      ...snapshot(currentRoot),
                    });
                  });
                  activeDispatch = previous;
                }
              },
            }),
        );
      };
      const observeVm = (root: RootObservation, instance: unknown) => {
        // Retained callbacks still call the original, but an unmounted root
        // cannot acquire a new hook after its cleanup has already run.
        if (!root.active) return;
        if (!isObject(instance)) {
          root.vm = null;
          emit('observer-unavailable');
          return;
        }
        root.vm = instance;
        let entry = vms.get(instance);
        if (!entry) {
          if (nextVmId >= 8) {
            emit('observer-limit-reached');
            return;
          }
          entry = { id: ++nextVmId, calls: 0 };
          vms.set(instance, entry);
        }
        emit('vm-registration', { rootId: root.id, vmId: entry.id });
        // toJSON is a prototype method in the pinned VM. Preserve its owner and
        // descriptor rather than installing an own-property shadow on the VM.
        let owner: object | null = instance;
        for (let depth = 0; owner && depth < 16; depth += 1) {
          if (Object.getOwnPropertyDescriptor(owner, 'toJSON')) break;
          owner = Object.getPrototypeOf(owner);
        }
        if (!owner) {
          emit('observer-unavailable');
          return;
        }
        shareMethod(
          root,
          owner,
          'toJSON',
          (fn) =>
            new Proxy(fn, {
              apply(target, receiver, args) {
                let detail: Detail | undefined;
                safely(() => {
                  if (!isObject(receiver)) return;
                  const current = vms.get(receiver);
                  const matches = roots.filter((item) => item.active && item.vm === receiver);
                  if (!current || matches.length === 0) return;
                  if (current.calls >= 1_000_000) {
                    emit('observer-limit-reached');
                    return;
                  }
                  const currentRoot = matches.length === 1 ? matches[0] : undefined;
                  const linked = currentRoot && activeTimer?.root === currentRoot;
                  const dispatchLinked = linked && activeDispatch?.root === currentRoot;
                  detail = {
                    vmId: current.id,
                    callId: ++current.calls,
                    ...(currentRoot ? { rootId: currentRoot.id } : {}),
                    ...(linked ? { callbackId: activeTimer?.callbackId } : {}),
                    ...(dispatchLinked ? { dispatchId: activeDispatch?.id } : {}),
                    synchronousContext: dispatchLinked
                      ? 'LINKED_AUTO_UPDATE_DISPATCH_STACK'
                      : linked
                        ? 'LINKED_TIMER_STACK'
                        : 'UNATTRIBUTED',
                  };
                  // This reports only dynamic stack containment. It never names the
                  // caller as ProjectSaver or inspects/retains the serialized result.
                  emit('vm-to-json-enter', detail);
                });
                let returned = false;
                try {
                  const result = Reflect.apply(target, receiver, args);
                  returned = true;
                  return result;
                } finally {
                  if (detail) emit(returned ? 'vm-to-json-return' : 'vm-to-json-throw', detail);
                }
              },
            }),
        );
      };
      const observeRoot = (value: unknown, state: unknown) => {
        if (!isObject(value) || roots.length >= 8) {
          rootCoverageLost = true;
          emit('observer-unavailable');
          return;
        }
        if (observedRoots.get(value)?.active) {
          rootCoverageLost = true;
          emit('observer-unavailable');
          return;
        }
        const store = ownValue(state, 'store');
        const root: RootObservation = {
          id: roots.length + 1,
          active: true,
          registrationKnown: false,
          saver: null,
          store: isObject(store) ? store : null,
          vm: null,
          canSave: 'UNKNOWN',
          cleanup: new Set(),
        };
        roots.push(root);
        observedRoots.set(value, root);
        observeStore(root);
        const renderRestore = restoreMethod(
          value,
          'render',
          (fn) =>
            new Proxy(fn, {
              apply(target, receiver, args) {
                const temporary: (() => void)[] = [];
                safely(() => {
                  const props = args[0];
                  if (!isObject(props)) {
                    emit('observer-unavailable');
                    return;
                  }
                  const canSave = ownValue(props, 'canSave');
                  root.canSave = typeof canSave === 'boolean' ? canSave : 'UNKNOWN';
                  const saverRestore = restoreMethod(
                    props,
                    'onSetProjectSaver',
                    (callback) =>
                      new Proxy(callback, {
                        apply(original, callbackThis, callbackArgs) {
                          let returned = false;
                          try {
                            const result = Reflect.apply(original, callbackThis, callbackArgs);
                            returned = true;
                            safely(() => {
                              const next =
                                typeof callbackArgs[0] === 'function'
                                  ? (callbackArgs[0] as Callable)
                                  : null;
                              const registration =
                                next === null
                                  ? 'CLEARED'
                                  : root.saver === next
                                    ? 'REPEATED'
                                    : root.saver
                                      ? 'REPLACED'
                                      : 'SET';
                              root.saver = next;
                              root.registrationKnown = true;
                              const entry = next ? callbackEntry(next) : undefined;
                              if (entry) entry.registered = true;
                              emit('saver-registration', {
                                rootId: root.id,
                                registration,
                                ...(entry ? { callbackId: entry.id } : {}),
                              });
                            });
                            return result;
                          } finally {
                            if (!returned) {
                              root.registrationKnown = false;
                              emit('saver-registration-throw', {
                                rootId: root.id,
                                registration: 'UNKNOWN',
                              });
                            }
                          }
                        },
                      }),
                  );
                  if (saverRestore) temporary.push(saverRestore);
                  const vmRestore = restoreMethod(
                    props,
                    'onVmInit',
                    (callback) =>
                      new Proxy(callback, {
                        apply(original, callbackThis, callbackArgs) {
                          safely(() => observeVm(root, callbackArgs[0]));
                          let returned = false;
                          try {
                            const result = Reflect.apply(original, callbackThis, callbackArgs);
                            returned = true;
                            return result;
                          } finally {
                            if (!returned) {
                              root.vm = null;
                              emit('observer-unavailable', { rootId: root.id });
                            }
                          }
                        },
                      }),
                  );
                  if (vmRestore) temporary.push(vmRestore);
                  const loadedRestore = restoreMethod(
                    props,
                    'onProjectLoaded',
                    (callback) =>
                      new Proxy(callback, {
                        apply(original, callbackThis, callbackArgs) {
                          if (!root.active)
                            return Reflect.apply(original, callbackThis, callbackArgs);
                          let detail: Detail | undefined;
                          safely(() => {
                            if (nextLoadedCallId >= 1_000_000) {
                              emit('observer-limit-reached');
                              return;
                            }
                            detail = { rootId: root.id, loadedCallId: ++nextLoadedCallId };
                            emit('project-loaded-enter', {
                              ...detail,
                              rootActive: true,
                              ...snapshot(root),
                            });
                          });
                          let returned = false;
                          try {
                            const result = Reflect.apply(original, callbackThis, callbackArgs);
                            returned = true;
                            return result;
                          } finally {
                            if (detail)
                              safely(() =>
                                emit(returned ? 'project-loaded-return' : 'project-loaded-throw', {
                                  ...detail,
                                  rootActive: root.active,
                                  ...snapshot(root.active ? root : undefined),
                                }),
                              );
                          }
                        },
                      }),
                  );
                  if (loadedRestore) temporary.push(loadedRestore);
                });
                try {
                  // The pinned root.render copies props into the React element. Keep
                  // the original props object/arguments and restore its descriptors
                  // when that original synchronous call returns or throws.
                  return Reflect.apply(target, receiver, args);
                } finally {
                  for (const restore of temporary.reverse()) safely(restore);
                }
              },
            }),
        );
        if (renderRestore) root.cleanup.add(renderRestore);
        const unmountRestore = restoreMethod(
          value,
          'unmount',
          (fn) =>
            new Proxy(fn, {
              apply(target, receiver, args) {
                let returned = false;
                try {
                  const result = Reflect.apply(target, receiver, args);
                  returned = true;
                  return result;
                } finally {
                  root.active = false;
                  root.registrationKnown = false;
                  root.saver = null;
                  root.vm = null;
                  emit(returned ? 'root-unmount-return' : 'root-unmount-throw', {
                    rootId: root.id,
                  });
                  for (const restore of root.cleanup) safely(restore);
                  root.cleanup.clear();
                }
              },
            }),
        );
        if (unmountRestore) root.cleanup.add(unmountRestore);
        emit('root-observed', { rootId: root.id });
      };
      const wrapBoundary = (callback: Callable, prefix: string) =>
        new Proxy(callback, {
          apply(target, receiver, args) {
            emit(`${prefix}-enter`);
            let returned = false;
            try {
              const result = Reflect.apply(target, receiver, args);
              returned = true;
              return result;
            } finally {
              emit(returned ? `${prefix}-return` : `${prefix}-throw`);
            }
          },
        });
      let installed = false;
      const factories = new WeakSet<object>();
      const install = (options: unknown) => {
        // createStandaloneRoot is a writable data export in the actual pinned
        // CJS bundle. Decline accessors/nonwritable descriptors without replacing
        // the namespace, state, arguments or factory result.
        const standalone = ownValue(options, 'standalone');
        if (isObject(standalone) && !factories.has(standalone)) {
          factories.add(standalone);
          restoreMethod(
            standalone,
            'createStandaloneRoot',
            (fn) =>
              new Proxy(fn, {
                apply(target, receiver, args) {
                  const root = Reflect.apply(target, receiver, args);
                  safely(() => observeRoot(root, args[0]));
                  return root;
                },
              }),
          );
        } else if (!isObject(standalone)) {
          rootCoverageLost = true;
          emit('observer-unavailable');
        }
        if (installed) return;
        installed = true;
        const storageApi = globals.AsaBlocksStorage;
        if (isObject(storageApi)) {
          const observedStorages = new WeakSet<object>();
          restoreMethod(
            storageApi,
            'createReadOnlyStorage',
            (fn) =>
              new Proxy(fn, {
                apply(target, receiver, args) {
                  const storage = Reflect.apply(target, receiver, args);
                  safely(() => {
                    if (!isObject(storage) || observedStorages.has(storage)) return;
                    observedStorages.add(storage);
                    restoreMethod(storage, 'saveProject', (callback) =>
                      wrapBoundary(callback, 'save-project'),
                    );
                    restoreMethod(storage, 'captureRecoveryAssets', (callback) =>
                      wrapBoundary(callback, 'recovery-assets'),
                    );
                    const scratchStorage = ownValue(storage, 'scratchStorage');
                    if (isObject(scratchStorage)) {
                      restoreMethod(scratchStorage, 'store', (callback) =>
                        wrapBoundary(callback, 'asset-store'),
                      );
                    } else emit('observer-unavailable');
                  });
                  return storage;
                },
              }),
          );
        } else emit('observer-unavailable');
        // Retain the existing minute-clock and clean-load fixture ordering.
        restoreMethod(
          globalThis,
          'setTimeout',
          (fn) =>
            new Proxy(fn, {
              apply(target, receiver, args) {
                const [callback, delay] = args;
                if (
                  typeof callback !== 'function' ||
                  typeof delay !== 'number' ||
                  !Number.isFinite(delay) ||
                  delay < 55_000 ||
                  delay > 65_000
                ) {
                  return Reflect.apply(target, receiver, args);
                }
                let entry: ReturnType<typeof callbackEntry>;
                let detail: Detail = {};
                let scheduledRoot: RootObservation | undefined;
                safely(() => {
                  entry = callbackEntry(callback as Callable);
                  const association = link(callback as Callable);
                  scheduledRoot = association.root;
                  detail = {
                    callbackLink: association.callbackLink,
                    ...(association.root ? { rootId: association.root.id } : {}),
                  };
                });
                if (!entry) return Reflect.apply(target, receiver, args);
                const result = Reflect.apply(target, receiver, [entry.observed, ...args.slice(1)]);
                emit('timer-scheduled', {
                  callbackId: entry.id,
                  delayMs: delay,
                  ...detail,
                  ...snapshot(scheduledRoot?.active ? scheduledRoot : undefined),
                  ...(typeof result === 'number' && Number.isSafeInteger(result)
                    ? { timerHandle: result }
                    : {}),
                });
                return result;
              },
            }),
        );
        emit('observer-ready');
      };
      safely(() => {
        if (Object.getOwnPropertyDescriptor(globalThis, snapshotKey)) {
          emit('observer-unavailable');
          return;
        }
        Object.defineProperty(globalThis, snapshotKey, {
          configurable: true,
          enumerable: false,
          writable: false,
          value: publishedSnapshot,
        });
        publicationEnabled = true;
      });
      if (Object.getOwnPropertyDescriptor(globalThis, 'AsaBlocksEditor')) {
        emit('observer-unavailable');
        return;
      }
      Object.defineProperty(globalThis, 'AsaBlocksEditor', {
        configurable: true,
        enumerable: true,
        set(value: unknown) {
          Object.defineProperty(globalThis, 'AsaBlocksEditor', {
            configurable: true,
            enumerable: true,
            writable: true,
            value,
          });
          safely(() => {
            if (!isObject(value)) {
              emit('observer-unavailable');
              return;
            }
            restoreMethod(
              value,
              'mountEditor',
              (fn) =>
                new Proxy(fn, {
                  apply(target, receiver, args) {
                    safely(() => install(args[0]));
                    return Reflect.apply(target, receiver, args);
                  },
                }),
            );
          });
        },
      });
    },
    { bindingName: binding, enums: abbyObserverEnums },
  );
}

async function realRuntimeBootstrapFixture() {
  const imageBytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="16" fill="#ff5f57"/><circle cx="48" cy="48" r="23" fill="#0877b3"/></svg>',
    'utf8',
  );
  const stockSoundId = '83c36d806dc92327b9e7049a565c6bff';
  const soundResponse = await fetch(`${runtimeUrl}/library-assets/${stockSoundId}.wav`);
  if (!soundResponse.ok) throw new Error('pinned Scratch bootstrap sound unavailable');
  const soundBytes = Buffer.from(await soundResponse.arrayBuffer());
  if (
    soundBytes.length <= 44 ||
    soundBytes.subarray(0, 4).toString() !== 'RIFF' ||
    soundBytes.subarray(8, 12).toString() !== 'WAVE'
  ) {
    throw new Error('pinned Scratch bootstrap sound is not canonical WAV');
  }
  soundBytes[44] = soundBytes[44]! ^ 1;
  const imageAssetId = createHash('md5').update(imageBytes).digest('hex');
  const soundAssetId = createHash('md5').update(soundBytes).digest('hex');
  const asset = (assetId: string, dataFormat: 'svg' | 'wav', bytes: Buffer) => ({
    assetId,
    dataFormat,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
  });
  const imageReference = asset(imageAssetId, 'svg', imageBytes);
  const soundReference = asset(soundAssetId, 'wav', soundBytes);
  const costume = (name: string) => ({
    assetId: imageAssetId,
    name,
    bitmapResolution: 1,
    md5ext: `${imageAssetId}.svg`,
    dataFormat: 'svg',
    rotationCenterX: 50,
    rotationCenterY: 50,
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
        costumes: [costume('Server Bootstrap Backdrop')],
        sounds: [],
        volume: 100,
      },
      {
        isStage: false,
        name: 'Server Bootstrap Sprite',
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
            inputs: { STEPS: [1, [4, '8']] },
            fields: {},
            shadow: false,
            topLevel: false,
          },
        },
        currentCostume: 0,
        costumes: [costume('Server Bootstrap Costume')],
        sounds: [
          {
            assetId: soundAssetId,
            name: 'Server Bootstrap Tone',
            dataFormat: 'wav',
            format: '',
            rate: 22050,
            sampleCount: 18688,
            md5ext: `${soundAssetId}.wav`,
          },
        ],
        volume: 100,
        visible: true,
        x: 37,
        y: -11,
        size: 100,
        direction: 90,
        draggable: false,
        rotationStyle: 'all around',
      },
    ],
    monitors: [],
    extensions: [],
    meta: { semver: '3.0.0', vm: '0.1.0', agent: 'ASA Lab browser test' },
  };
  return {
    projectJson,
    assets: [imageReference, soundReference],
    runtimeAssets: new Map([
      [`${imageAssetId}.svg`, { body: imageBytes, contentType: 'image/svg+xml' }],
      [`${soundAssetId}.wav`, { body: soundBytes, contentType: 'audio/wav' }],
    ]),
    imageAssetId,
    soundAssetId,
  };
}

test.beforeAll(async () => {
  ({
    createProtocolFixture,
    advanceMinuteAutosave,
    installMinuteAutosaveClock,
    waitForMinuteAutosaveArm,
  } = await import('../tools/blocks/browser/fixture.mjs'));
  // Load native fixture dependencies before Playwright's TypeScript module loader.
  ({ isTelemetryRequest } = await import('../tools/blocks/browser/telemetry-fixture.mjs'));
  ({ parentOrigin, projectId, runtimeUrl } = await import('../tools/blocks/browser/protocol.mjs'));
  fs.mkdirSync(evidenceDir, { recursive: true });
});

type CapturedBlocksMessage = {
  messageType?: string;
  protocolVersion?: number;
  projectId?: string;
  sessionNonce?: string;
  requestId?: string;
  ok?: boolean;
  reason?: string | null;
  revision?: number;
  generation?: number;
  snapshotGeneration?: number;
  savedGeneration?: number;
};

async function installBlocksMessageCapture(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const state = window as unknown as { __asaBlocksTestMessages?: unknown[] };
    state.__asaBlocksTestMessages = [];
    window.addEventListener('message', (event) => {
      const message = event.data as { messageType?: unknown } | null;
      if (
        typeof message?.messageType === 'string' &&
        message.messageType.startsWith('ASA_BLOCKS_')
      ) {
        state.__asaBlocksTestMessages?.push(message);
      }
    });
  });
}

async function minuteClockPage(fixture: Awaited<ReturnType<typeof createProtocolFixture>>) {
  const page = await fixture.context.newPage();
  await installMinuteAutosaveClock(page);
  return page;
}

async function advanceMinuteCheckpoint(page: import('@playwright/test').Page, armCount = 1) {
  await advanceMinuteAutosave(page, armCount);
}

async function editorClockNow(page: import('@playwright/test').Page) {
  return page
    .frameLocator('iframe[title="Scratch runtime"]')
    .locator('body')
    .evaluate(() => Date.now());
}

async function runEditorClockUntil(page: import('@playwright/test').Page, deadline: number) {
  const remaining = deadline - (await editorClockNow(page));
  if (remaining <= 0) throw new Error('minute autosave clock passed its assertion deadline');
  await page.clock.runFor(remaining);
}

async function setServerSteps(
  frame: import('@playwright/test').FrameLocator,
  fromValue: string,
  toValue: string,
): Promise<void> {
  await frame.getByRole('tab', { name: 'Code', exact: true }).click();
  await frame.getByRole('button', { name: 'Server Bootstrap Sprite', exact: true }).click();
  const program = frame.locator('.blocklyBlockCanvas').first();
  await program.getByText(fromValue, { exact: true }).dblclick();
  const numberField = frame.locator('.blocklyHtmlInput:focus');
  await expect(numberField).toHaveValue(fromValue);
  await numberField.fill(toValue);
  await numberField.press('Enter');
  await expect(program.getByText(toValue, { exact: true })).toBeVisible();
}

async function editLiveServerProjectAndAddMedia(
  frame: import('@playwright/test').FrameLocator,
): Promise<void> {
  await setServerSteps(frame, '8', '37');

  await frame.getByRole('button', { name: 'Choose a Sprite' }).first().click();
  await frame.getByText('Abby', { exact: true }).click();
  await expect(frame.getByPlaceholder('Name', { exact: true })).toHaveValue('Abby');

  await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
  await frame.getByRole('button', { name: 'Choose a Sound', exact: true }).first().click();
  await frame.getByText('Bark', { exact: true }).click();
  await expect(frame.getByRole('textbox', { name: 'Sound', exact: true })).toHaveValue('Bark');
}

async function editPreviewScene(
  frame: import('@playwright/test').FrameLocator,
  x: string,
): Promise<void> {
  await frame.getByRole('button', { name: 'Choose a Sprite' }).first().click();
  await frame.getByText('Apple', { exact: true }).click();
  await expect(frame.getByPlaceholder('Name', { exact: true })).toHaveValue('Apple');
  await frame.getByPlaceholder('x', { exact: true }).fill(x);
  await frame.getByPlaceholder('x', { exact: true }).press('Enter');
  await frame.getByRole('button', { name: 'Choose a Backdrop' }).first().click();
  await frame.getByText('Blue Sky', { exact: true }).click();
}

test('shipping fullscreen host loads the account avatar in ASA only and survives runtime failure', async () => {
  const fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
  const page = await fixture.context.newPage();
  const requests: string[] = [];
  fixture.context.on('request', (request) => requests.push(request.url()));
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    const account = page.locator('[data-asa-blocks-account-overlay]');
    const avatar = account.locator('img');
    await expect(account).toHaveAccessibleName('Открыть аккаунт: Scratch acceptance account');
    await expect(avatar).toHaveAttribute('src', fixture.avatarDataUrl ?? 'missing-avatar');
    await expect
      .poll(() => avatar.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await expect(account.locator('.blocks-editor-account-initials')).toHaveCount(0);
    await expect(frame.locator('[data-asa-blocks-account-overlay]')).toHaveCount(0);
    await expect(page.locator('.portal-shell, .portal-header')).toHaveCount(0);
    await expect(frame.locator('header[role="banner"]')).toHaveCount(1);
    await expect(frame.locator('#logo_img')).toHaveAttribute(
      'src',
      './asa-lab-scratch-wordmark.svg',
    );
    for (const size of [
      { width: 1440, height: 960 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(size);
      await expect
        .poll(async () => page.locator('[data-asa-blocks-fullscreen]').boundingBox())
        .toEqual({ x: 0, y: 0, ...size });
      await expect(page.getByRole('status')).toHaveCount(0);
      await expect
        .poll(async () => page.locator('iframe').boundingBox())
        .toEqual({ x: 0, y: 0, width: size.width, height: size.height });
    }
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.locator('.blocks-editor-connection-status')).toHaveCount(0);
    await page.screenshot({ path: `${evidenceDir}/01-shipping-host-account.png` });
    await account.click();
    await expect(page).toHaveURL(`${parentOrigin}/product#/account`);
    const updatedAvatar = fixture.updatedAvatarDataUrl;
    await page.evaluate((src) => {
      window.dispatchEvent(new CustomEvent('asa-profile-avatar-changed', { detail: src }));
    }, updatedAvatar);
    await expect(avatar).toHaveAttribute('src', updatedAvatar ?? 'missing-avatar');
    expect(requests).toContain(`${parentOrigin}/api/account/avatar`);
    expect(requests.filter((url) => url.startsWith(`${runtimeUrl}/api/account`))).toEqual([]);
    expect(requests.filter((url) => url.startsWith(`${parentOrigin}/chunks/`))).toEqual([]);
    expect(
      requests.some((url) =>
        url.startsWith(`${parentOrigin}/internal/blocks/vendor/scratch/chunks/fetch-worker.`),
      ),
    ).toBe(true);
    expect(
      requests.filter(
        (url) => /^https?:/.test(url) && ![parentOrigin, runtimeUrl].includes(new URL(url).origin),
      ),
    ).toEqual([]);
    await page.screenshot({ path: `${evidenceDir}/02-updated-account.png` });
    await frame.locator('body').evaluate(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'protocol-fixture-fatal' }));
    });
    const failureOverlay = page.locator('[data-asa-blocks-loading-overlay]');
    await expect(failureOverlay).toHaveAttribute('data-state', 'error');
    await expect(failureOverlay).toContainText('Не удалось открыть среду');
    await expect(account).toBeVisible();
    await expect(avatar).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}/03-parent-survives-failure.png` });
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    fs.writeFileSync(`${evidenceDir}/network.json`, JSON.stringify({ requests }, null, 2));
    await fixture.close();
  }
});

test('missing library files return HTTP 404 instead of a successful SPA document', async ({
  request,
}) => {
  for (const path of [
    '/library-assets/00000000000000000000000000000000.svg',
    '/library-assets/11111111-1111-4111-8111-111111111111.json',
  ]) {
    const response = await request.get(`${runtimeUrl}${path}`);
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain('data-asa-scratch-host');
  }
});

// A successful HTTP response is insufficient: the storage adapter checks MIME.
test('stock WAV is served as audio and retains the pinned sound bytes', async ({ request }) => {
  const response = await request.get(`${runtimeUrl}/library-assets/${barkAssetId}.wav`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('audio/wav');
  const bytes = await response.body();
  expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
  expect(bytes.subarray(8, 12).toString()).toBe('WAVE');
  expect(createHash('md5').update(bytes).digest('hex')).toBe(barkAssetId);
});

test('runtime-session opens the real server project and reads declared costume and sound assets', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
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
  const page = await fixture.context.newPage();
  const requests: string[] = [];
  fixture.context.on('request', (request) => requests.push(request.url()));
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
    await expect(shell).toHaveAttribute('data-project-source', 'runtime-session');
    await expect(shell).toHaveAttribute('data-draft-revision', '23');

    const serverSprite = frame.getByRole('button', {
      name: 'Server Bootstrap Sprite',
      exact: true,
    });
    await expect(serverSprite).toBeVisible();
    await serverSprite.click();
    await expect(frame.getByPlaceholder('Name', { exact: true })).toHaveValue(
      'Server Bootstrap Sprite',
    );
    await expect(frame.getByPlaceholder('x', { exact: true })).toHaveValue('37');
    await expect(frame.getByText('Fixture Cat', { exact: true })).toHaveCount(0);
    await expect(
      frame.locator('[class*="monitor_label"]').filter({ hasText: 'Ticks' }),
    ).toHaveCount(0);
    await frame.getByRole('tab', { name: 'Costumes', exact: true }).click();
    await expect(
      frame
        .getByRole('tabpanel', { name: 'Costumes', exact: true })
        .getByText('Server Bootstrap Costume', { exact: true }),
    ).toBeVisible();
    const costumeImage = serverSprite.locator('img').first();
    await expect
      .poll(() => costumeImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);

    await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
    await frame
      .getByRole('tabpanel', { name: 'Sounds', exact: true })
      .getByText('Server Bootstrap Tone', { exact: true })
      .click();
    await expect(frame.getByRole('textbox', { name: 'Sound', exact: true })).toHaveValue(
      'Server Bootstrap Tone',
    );

    expect(fixture.runtimeAssetEvidence).toHaveLength(2);
    expect(fixture.runtimeAssetEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetFile: `${serverProject.imageAssetId}.svg`,
          authorizationOk: true,
          cookiePresent: false,
          urlHasCapability: false,
          originOk: true,
        }),
        expect.objectContaining({
          assetFile: `${serverProject.soundAssetId}.wav`,
          authorizationOk: true,
          cookiePresent: false,
          urlHasCapability: false,
          originOk: true,
        }),
      ]),
    );
    expect(
      requests.some((url) =>
        url.includes(
          `/api/blocks/runtime/projects/11111111-1111-4111-8111-111111111111/assets/${serverProject.imageAssetId}.svg`,
        ),
      ),
    ).toBe(true);
    expect(
      requests.some((url) =>
        url.includes(
          `/api/blocks/runtime/projects/11111111-1111-4111-8111-111111111111/assets/${serverProject.soundAssetId}.wav`,
        ),
      ),
    ).toBe(true);
    expect(requests.some((url) => url.includes('fixture.1.signature'))).toBe(false);
    expect(fixture.pageErrors).toEqual([]);
    await page.screenshot({ path: `${evidenceDir}/real-runtime-bootstrap.png` });
  } finally {
    await fixture.close();
  }
});

for (const cleanPop of [false, true]) {
  test(`existing project adding Abby ${cleanPop ? 'with clean Pop still completes' : 'dirties default-cached Pop and completes'} ordinary no-click autosave`, async () => {
    const serverProject = await realRuntimeBootstrapFixture();
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
    const saveStages = createAbbySaveStageEvidence(cleanPop, fixture);
    saveStages.record('page-create-enter');
    let page = await minuteClockPage(fixture);
    saveStages.record('page-create-return');
    let stage = 'opening';
    let savedTiming: unknown = null;
    const reloadedAssets: Array<{ assetFile: string; sha256: string; sizeBytes: number }> = [];
    const saveErrors: string[] = [];
    page.on('console', (message) => {
      if (
        ['warning', 'error'].includes(message.type()) &&
        /save|asset_reference/.test(message.text())
      ) {
        saveErrors.push(message.text());
      }
    });
    saveStages.record('observer-install-enter');
    await installAbbySaveStageObserver(page, saveStages.observer).catch(() => {
      saveStages.record('observer-unavailable');
    });
    saveStages.record('observer-install-return');
    if (cleanPop) {
      // Exercise Scratch's valid clean=true media state without invoking a save
      // or changing the minute timer: only ASA's acknowledgement is durability.
      await page.addInitScript((assetId) => {
        type Asset = { clean: boolean };
        type Storage = { scratchStorage: { load: (...args: unknown[]) => Promise<Asset | null> } };
        type Api = { createReadOnlyStorage: (...args: unknown[]) => Storage };
        let api: Api;
        const state = globalThis as unknown as { __asaCleanPopLoads: number };
        state.__asaCleanPopLoads = 0;
        Object.defineProperty(globalThis, 'AsaBlocksStorage', {
          configurable: true,
          get: () => api,
          set(value: Api) {
            api = {
              ...value,
              createReadOnlyStorage(...args: unknown[]) {
                const storage = value.createReadOnlyStorage(...args);
                const load = storage.scratchStorage.load.bind(storage.scratchStorage);
                storage.scratchStorage.load = async (...params: unknown[]) => {
                  const asset = await load(...params);
                  if (asset && params[1] === assetId) {
                    asset.clean = true;
                    state.__asaCleanPopLoads += 1;
                  }
                  return asset;
                };
                return storage;
              },
            };
          },
        });
      }, popAssetId);
    }
    try {
      saveStages.record('open-enter');
      await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
      saveStages.record('open-return');
      let frame = page.frameLocator('iframe[title="Scratch runtime"]');
      saveStages.record('editor-ready-wait-enter');
      await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
        'data-editor-state',
        'ready',
        { timeout: 45000 },
      );

      saveStages.record('editor-ready-observed');
      saveStages.record('add-abby-enter');
      await frame.getByRole('button', { name: 'Choose a Sprite' }).first().click();
      await frame.getByText('Abby', { exact: true }).click();
      await expect(frame.getByPlaceholder('Name', { exact: true })).toHaveValue('Abby');
      if (cleanPop) {
        expect(
          await frame
            .locator('body')
            .evaluate(
              () => (globalThis as unknown as { __asaCleanPopLoads: number }).__asaCleanPopLoads,
            ),
        ).toBeGreaterThan(0);
      }

      saveStages.record('add-abby-return');
      stage = 'first-checkpoint';
      expect(fixture.getServerRevision()).toBe(23);
      saveStages.record('clock-advance-enter');
      await advanceMinuteCheckpoint(page);
      saveStages.record('clock-advance-return');
      saveStages.record('revision-24-wait-enter');
      await expect.poll(() => fixture.getServerRevision(), { timeout: 30000 }).toBe(24);
      saveStages.record('revision-24-observed');

      const popFile = `${popAssetId}.wav`;
      const popPuts = fixture.runtimeAssetPutEvidence.filter((item) => item.assetFile === popFile);
      expect(popPuts.length).toBeGreaterThanOrEqual(1);
      expect(popPuts.at(-1)).toMatchObject({
        authorizationOk: true,
        cookiePresent: false,
        urlHasCapability: false,
        originOk: true,
        identityOk: true,
        contentTypeOk: true,
      });
      expect(fixture.runtimeDraftEvidence.length).toBeGreaterThan(0);
      saveStages.record('saved-timing-read-enter');
      savedTiming = await frame.locator('body').evaluate(() => ({
        timers:
          (globalThis as unknown as { __asaMinuteAutosaveTimers?: unknown[] })
            .__asaMinuteAutosaveTimers ?? [],
        shell: { ...(document.querySelector('[data-asa-host-shell]') as HTMLElement)?.dataset },
      }));
      saveStages.record('saved-timing-read-return');
      stage = 'saved';

      const savedDocument = fixture.runtimeDraftEvidence.at(-1)?.body?.document?.projectJson as
        | {
            targets?: Array<{
              name?: string;
              costumes?: Array<{ assetId?: string; dataFormat?: string }>;
              sounds?: Array<{ name?: string; assetId?: string; dataFormat?: string }>;
            }>;
          }
        | undefined;
      const abby = savedDocument?.targets?.find((target) => target.name === 'Abby');
      expect(abby).toBeTruthy();
      expect(
        abby?.sounds?.some((sound) => sound.name === 'Pop' && sound.assetId === popAssetId),
      ).toBe(true);

      const abbyAssetFiles = [...(abby?.costumes ?? []), ...(abby?.sounds ?? [])].map(
        (asset) => `${asset.assetId}.${asset.dataFormat}`,
      );
      const uploaded = new Set(fixture.runtimeAssetPutEvidence.map((item) => item.assetFile));
      for (const assetFile of abbyAssetFiles) expect(uploaded.has(assetFile)).toBe(true);

      saveStages.record('reopen-context-enter');
      await fixture.reopenContextWithIndexedDB();
      saveStages.record('reopen-context-return');
      stage = 'reopen';
      saveStages.record('reopen-page-enter');
      page = await fixture.context.newPage();
      saveStages.record('reopen-page-return');
      saveStages.record('reopen-navigation-enter');
      await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
      saveStages.record('reopen-navigation-return');
      frame = page.frameLocator('iframe[title="Scratch runtime"]');
      saveStages.record('reopen-ready-wait-enter');
      await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
        'data-editor-state',
        'ready',
        { timeout: 45000 },
      );
      await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
        'data-project-source',
        'runtime-session',
      );
      saveStages.record('reopen-ready-observed');
      const abbyButton = frame.getByRole('button', { name: 'Abby', exact: true });
      await expect(abbyButton).toBeVisible();
      await abbyButton.click();
      await frame.getByRole('tab', { name: 'Costumes', exact: true }).click();
      await expect
        .poll(() =>
          abbyButton
            .locator('img')
            .first()
            .evaluate((image) => (image as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
      await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
      await expect(
        frame
          .getByRole('tabpanel', { name: 'Sounds', exact: true })
          .getByText('Pop', { exact: true }),
      ).toBeVisible();

      for (const assetFile of abbyAssetFiles) {
        const response = await fixture.context.request.get(
          `${parentOrigin}/api/blocks/runtime/projects/${projectId}/assets/${assetFile}`,
          {
            headers: {
              origin: parentOrigin,
              authorization: `Bearer fixture.${fixture.getRuntimeSessionSequence()}.signature`,
            },
          },
        );
        expect(response.status()).toBe(200);
        const bytes = await response.body();
        const actual = {
          assetFile,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          sizeBytes: bytes.byteLength,
        };
        const written = fixture.runtimeAssetPutEvidence.find(
          (item) => item.assetFile === assetFile,
        );
        expect(actual.sha256).toBe(written?.sha256);
        expect(actual.sizeBytes).toBe(written?.sizeBytes);
        reloadedAssets.push(actual);
      }
      expect(fixture.getServerRevision()).toBe(24);
      await page.screenshot({
        path: `${evidenceDir}/abby-pop-${cleanPop ? 'clean' : 'native'}-reopened.png`,
      });

      const scratchFoundationWrites = fixture.allRequests.filter(({ method, url }) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(method) || !/^https?:/.test(url)) return false;
        const host = new URL(url).hostname.toLowerCase();
        return host.includes('scratch.mit.edu') || host.includes('scratchfoundation');
      });
      expect(scratchFoundationWrites).toEqual([]);
      expect(fixture.pageErrors).toEqual([]);
      saveStages.record('assertions-completed');
    } finally {
      saveStages.record('finally-enter');
      saveStages.record('legacy-timing-read-enter');
      const timing = await page
        .frameLocator('iframe[title="Scratch runtime"]')
        .locator('body')
        .evaluate(() => ({
          timers:
            (globalThis as unknown as { __asaMinuteAutosaveTimers?: unknown[] })
              .__asaMinuteAutosaveTimers ?? [],
          shell: { ...(document.querySelector('[data-asa-host-shell]') as HTMLElement)?.dataset },
          observerSnapshot: (() => {
            try {
              const descriptor = Object.getOwnPropertyDescriptor(
                globalThis,
                '__asaAbbySaveStageSnapshot',
              );
              // Never call or coerce a value obtained from this global slot.
              // It can be foreign or stale; parse only bounded text in Node.
              return descriptor?.configurable === true &&
                descriptor.enumerable === false &&
                descriptor.writable === false &&
                typeof descriptor.value === 'string' &&
                descriptor.value.length <= 262_144
                ? descriptor.value
                : null;
            } catch {
              return null;
            }
          })(),
        }))
        .catch(() => null);
      saveStages.record('legacy-timing-read-return');
      saveStages.reconcile(timing?.observerSnapshot);
      saveStages.record('legacy-evidence-write-enter');
      fs.writeFileSync(
        `${evidenceDir}/abby-pop-${cleanPop ? 'clean' : 'native'}-autosave.json`,
        JSON.stringify(
          {
            stage,
            revision: fixture.getServerRevision(),
            timing: timing === null ? null : { timers: timing.timers, shell: timing.shell },
            savedTiming,
            reloadedAssets,
            saveErrors,
            metrics: fixture.runtimePersistenceMetrics,
            assetPuts: fixture.runtimeAssetPutEvidence,
            draftCount: fixture.runtimeDraftEvidence.length,
            errors: fixture.pageErrorEvidence,
          },
          null,
          2,
        ),
      );
      saveStages.record('legacy-evidence-write-return');
      saveStages.record('teardown-enter');
      let teardownCompleted = false;
      try {
        await fixture.close();
        teardownCompleted = true;
      } finally {
        saveStages.record(teardownCompleted ? 'teardown-return' : 'teardown-interrupted');
      }
    }
  });
}

test('long-lived editor rotates capability in place and upstream autosaves with the refreshed bearer', async () => {
  test.setTimeout(180_000);
  const serverProject = await realRuntimeBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
    runtimeSessionExpiresAt: (sequence: number) =>
      Math.floor(Date.now() / 1000) + (sequence === 1 ? 62 : 600),
  });
  const page = await fixture.context.newPage();
  await installBlocksMessageCapture(page);
  let runtimeNavigations = 0;
  page.on('framenavigated', (navigated) => {
    if (navigated.url().startsWith(`${parentOrigin}/internal/blocks/`)) runtimeNavigations += 1;
  });
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
    expect(fixture.getRuntimeSessionSequence()).toBe(1);
    await expect(page.locator('[data-asa-blocks-save]')).toHaveCount(0);

    const initialBinding = await page.evaluate(() => {
      const messages =
        (window as unknown as { __asaBlocksTestMessages?: CapturedBlocksMessage[] })
          .__asaBlocksTestMessages ?? [];
      return messages.find(
        (message) =>
          message.messageType === 'ASA_BLOCKS_STATUS' &&
          (message as CapturedBlocksMessage & { status?: string }).status === 'editor-ready',
      );
    });
    if (!initialBinding?.sessionNonce) throw new Error('initial runtime binding unavailable');

    await frame.locator('body').evaluate(() => {
      (
        window as unknown as { __asaCapabilityRefreshMarker?: string }
      ).__asaCapabilityRefreshMarker = 'same-runtime-realm';
    });
    await setServerSteps(frame, '8', '37');
    await expect.poll(() => fixture.getRuntimeSessionSequence(), { timeout: 10_000 }).toBe(2);
    expect(
      await frame
        .locator('body')
        .evaluate(
          () =>
            (window as unknown as { __asaCapabilityRefreshMarker?: string })
              .__asaCapabilityRefreshMarker,
        ),
    ).toBe('same-runtime-realm');
    await expect(
      frame.locator('.blocklyBlockCanvas').first().getByText('37', { exact: true }),
    ).toBeVisible();

    await expect.poll(() => fixture.runtimeDraftEvidence.length, { timeout: 90_000 }).toBe(1);
    expect(fixture.runtimeDraftEvidence[0].authorizationOk).toBe(true);
    expect(
      fixture.runtimeDraftEvidence[0].body.document.projectJson.targets.find(
        (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
      ).blocks.move.inputs.STEPS[1][1],
    ).toBe('37');

    const messages = await page.evaluate(
      () =>
        (window as unknown as { __asaBlocksTestMessages?: CapturedBlocksMessage[] })
          .__asaBlocksTestMessages ?? [],
    );
    const readyMessages = messages.filter(
      (message) =>
        message.messageType === 'ASA_BLOCKS_STATUS' &&
        (message as CapturedBlocksMessage & { status?: string }).status === 'editor-ready',
    );
    const dirtyMessages = messages.filter(
      (message) =>
        message.messageType === 'ASA_BLOCKS_STATUS' &&
        (message as CapturedBlocksMessage & { status?: string }).status === 'project-dirty',
    );
    expect(readyMessages.length).toBeGreaterThanOrEqual(1);
    expect(
      readyMessages.every((message) => message.sessionNonce === initialBinding.sessionNonce),
    ).toBe(true);
    expect(dirtyMessages.length).toBeGreaterThan(0);
    expect(
      dirtyMessages.every((message) => message.sessionNonce === initialBinding.sessionNonce),
    ).toBe(true);
    expect(runtimeNavigations).toBe(1);

    await setServerSteps(frame, '37', '41');
    await expect.poll(() => fixture.runtimeDraftEvidence.length, { timeout: 90_000 }).toBe(2);
    const latestDraft = fixture.runtimeDraftEvidence.at(-1);
    expect(
      latestDraft.body.document.projectJson.targets.find(
        (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
      ).blocks.move.inputs.STEPS[1][1],
    ).toBe('41');
    expect(latestDraft.authorizationOk).toBe(true);
    await expect(
      frame.locator('.blocklyBlockCanvas').first().getByText('41', { exact: true }),
    ).toBeVisible();
  } finally {
    await fixture.close();
  }
});

test('edit during in-flight upstream autosave persists the latest generation', async () => {
  test.setTimeout(240_000);
  const serverProject = await realRuntimeBootstrapFixture();
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
  const runtimeDraftPath = `/api/blocks/runtime/projects/${projectId}/draft`;
  let releaseResponse!: () => void;
  let markCommitted!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const committed = new Promise<void>((resolve) => {
    markCommitted = resolve;
  });
  await fixture.context.route(
    (url) => url.pathname === runtimeDraftPath,
    async (route, request) => {
      if (request.method() !== 'PUT') {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await response.body();
      markCommitted();
      await release;
      await route.fulfill({ response });
    },
  );

  const page = await fixture.context.newPage();
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
    await expect(page.locator('[data-asa-blocks-save]')).toHaveCount(0);

    await setServerSteps(frame, '8', '37');
    await committed;
    expect(fixture.runtimeDraftEvidence).toHaveLength(1);
    expect(fixture.getServerRevision()).toBe(24);

    await setServerSteps(frame, '37', '41');
    expect(fixture.runtimeDraftEvidence).toHaveLength(1);
    releaseResponse();
    await expect.poll(() => fixture.runtimeDraftEvidence.length, { timeout: 90_000 }).toBe(2);
    await expect.poll(() => fixture.getServerRevision(), { timeout: 20_000 }).toBe(25);

    const finalDraft = fixture.runtimeDraftEvidence.at(-1);
    expect(
      finalDraft.body.document.projectJson.targets.find(
        (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
      ).blocks.move.inputs.STEPS[1][1],
    ).toBe('41');
    expect(fixture.runtimeAssetPutEvidence).toHaveLength(0);
    await expect(
      frame.locator('.blocklyBlockCanvas').first().getByText('41', { exact: true }),
    ).toBeVisible();
  } finally {
    releaseResponse();
    await fixture.close();
  }
});

test('shipping ProjectSaverHOC checkpoints the newest edit at a bounded minute deadline', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
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
  const page = await minuteClockPage(fixture);
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      {
        timeout: 45_000,
      },
    );

    await setServerSteps(frame, '8', '37');
    await waitForMinuteAutosaveArm(page, 1);
    const firstArmAt = await editorClockNow(page);
    await runEditorClockUntil(page, firstArmAt + 30_000);
    await setServerSteps(frame, '37', '41');
    await runEditorClockUntil(page, firstArmAt + 54_000);
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);
    await runEditorClockUntil(page, firstArmAt + 65_000);
    await expect.poll(() => fixture.getServerRevision()).toBe(24);
    expect(fixture.runtimeDraftEvidence).toHaveLength(1);
    const savedFirst = fixture.runtimeDraftEvidence[0].body.document.projectJson.targets.find(
      (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
    );
    expect(savedFirst.blocks.move.inputs.STEPS[1][1]).toBe('41');

    await setServerSteps(frame, '41', '43');
    await waitForMinuteAutosaveArm(page, 2);
    const secondArmAt = await editorClockNow(page);
    await runEditorClockUntil(page, secondArmAt + 30_000);
    await setServerSteps(frame, '43', '47');
    await runEditorClockUntil(page, secondArmAt + 54_000);
    expect(fixture.runtimeDraftEvidence).toHaveLength(1);
    await runEditorClockUntil(page, secondArmAt + 65_000);
    await expect.poll(() => fixture.getServerRevision()).toBe(25);
    expect(fixture.runtimeDraftEvidence).toHaveLength(2);
    const savedSecond = fixture.runtimeDraftEvidence[1].body.document.projectJson.targets.find(
      (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
    );
    expect(savedSecond.blocks.move.inputs.STEPS[1][1]).toBe('47');
    expect(fixture.runtimeAssetPutEvidence).toHaveLength(0);
  } finally {
    await fixture.close();
  }
});

test('ordinary autosave persists canonical state, stays idle while unchanged and advances only new edits', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
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
  const page = await minuteClockPage(fixture);
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });

    const p0 = {
      ...fixture.runtimePersistenceMetrics,
      serverRevision: fixture.getServerRevision(),
    };
    expect(fixture.runtimeWriteEvents).toEqual([]);

    await editLiveServerProjectAndAddMedia(frame);
    await advanceMinuteCheckpoint(page);
    await expect.poll(() => fixture.runtimeDraftEvidence.length, { timeout: 20_000 }).toBe(1);
    await expect.poll(() => fixture.getServerRevision(), { timeout: 20_000 }).toBe(24);

    const p1 = {
      ...fixture.runtimePersistenceMetrics,
      serverRevision: fixture.getServerRevision(),
    };
    expect(p1.assetRequests - p0.assetRequests).toBeGreaterThan(0);
    expect(p1.uploadedBytes - p0.uploadedBytes).toBeGreaterThan(0);
    expect(p1.uniqueAssetBytes - p0.uniqueAssetBytes).toBeGreaterThan(0);
    expect(p1.blobRows - p0.blobRows).toBeGreaterThan(0);
    expect(p1.aliasRows - p0.aliasRows).toBeGreaterThan(0);
    expect(p1.draftRequests - p0.draftRequests).toBe(1);
    expect(p1.revisionCommits - p0.revisionCommits).toBe(1);
    expect(p1.serverRevision - p0.serverRevision).toBe(1);

    expect(
      fixture.runtimeAssetPutEvidence.some(
        (item) =>
          item.assetFile === `${serverProject.imageAssetId}.svg` ||
          item.assetFile === `${serverProject.soundAssetId}.wav`,
      ),
    ).toBe(false);
    expect(
      fixture.runtimeAssetPutEvidence.some((item) => item.assetFile === `${barkAssetId}.wav`),
    ).toBe(true);
    expect(
      fixture.runtimeAssetPutEvidence.every(
        (item) =>
          item.authorizationOk &&
          !item.cookiePresent &&
          !item.urlHasCapability &&
          item.originOk &&
          item.identityOk &&
          item.contentTypeOk,
      ),
    ).toBe(true);

    const firstDraft = fixture.runtimeDraftEvidence[0];
    expect(firstDraft.body.baseRevision).toBe(23);
    expect(firstDraft.body.mutationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const savedServerSprite = firstDraft.body.document.projectJson.targets.find(
      (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
    );
    expect(savedServerSprite.blocks.move.inputs.STEPS[1][1]).toBe('37');
    expect(
      firstDraft.body.document.projectJson.targets.some(
        (target: { name?: string }) => target.name === 'Abby',
      ),
    ).toBe(true);
    expect(
      firstDraft.body.document.projectJson.targets.some(
        (target: { sounds?: { name?: string }[] }) =>
          target.sounds?.some((sound) => sound.name === 'Bark'),
      ),
    ).toBe(true);

    const firstRefs = firstDraft.body.document.assets as Array<{
      assetId: string;
      dataFormat: string;
      sha256: string;
      sizeBytes: number;
    }>;
    expect(
      new Set(firstRefs.map((reference) => `${reference.assetId}.${reference.dataFormat}`)).size,
    ).toBe(firstRefs.length);
    expect(
      fixture.runtimeAssetPutEvidence.every((item) =>
        firstRefs.some(
          (reference) =>
            `${reference.assetId}.${reference.dataFormat}` === item.assetFile &&
            reference.sha256 === item.sha256 &&
            reference.sizeBytes === item.sizeBytes,
        ),
      ),
    ).toBe(true);

    const writesBeforeNoop = fixture.runtimeWriteEvents.length;
    const draftsBeforeNoop = fixture.runtimeDraftEvidence.length;
    await page.clock.fastForward(9_000);
    const p2 = {
      ...fixture.runtimePersistenceMetrics,
      serverRevision: fixture.getServerRevision(),
    };
    expect(p2).toEqual(p1);
    expect(fixture.runtimeWriteEvents).toHaveLength(writesBeforeNoop);
    expect(fixture.runtimeDraftEvidence).toHaveLength(draftsBeforeNoop);

    await setServerSteps(frame, '37', '41');
    await advanceMinuteCheckpoint(page, 2);
    await expect.poll(() => fixture.runtimeDraftEvidence.length, { timeout: 20_000 }).toBe(2);
    await expect.poll(() => fixture.getServerRevision(), { timeout: 20_000 }).toBe(25);
    const p3 = {
      ...fixture.runtimePersistenceMetrics,
      serverRevision: fixture.getServerRevision(),
    };
    expect(p3.assetRequests - p2.assetRequests).toBe(0);
    expect(p3.uploadedBytes - p2.uploadedBytes).toBe(0);
    expect(p3.uniqueAssetBytes - p2.uniqueAssetBytes).toBe(0);
    expect(p3.blobRows - p2.blobRows).toBe(0);
    expect(p3.aliasRows - p2.aliasRows).toBe(0);
    expect(p3.draftRequests - p2.draftRequests).toBe(1);
    expect(p3.revisionCommits - p2.revisionCommits).toBe(1);
    expect(p3.serverRevision - p2.serverRevision).toBe(1);
    expect(fixture.runtimeDraftEvidence.at(-1).body.mutationId).not.toBe(
      firstDraft.body.mutationId,
    );
    expect(fixture.runtimeDraftEvidence.at(-1).body.baseRevision).toBe(24);

    fs.writeFileSync(
      `${evidenceDir}/canonical-autosave-p0-p3.json`,
      JSON.stringify(
        {
          p0,
          p1,
          p2,
          p3,
          firstSave: {
            assetRequests: p1.assetRequests - p0.assetRequests,
            uploadedBytes: p1.uploadedBytes - p0.uploadedBytes,
            uniqueAssetBytes: p1.uniqueAssetBytes - p0.uniqueAssetBytes,
            blobRowDelta: p1.blobRows - p0.blobRows,
            aliasRowDelta: p1.aliasRows - p0.aliasRows,
            draftRequests: p1.draftRequests - p0.draftRequests,
            revisionDelta: p1.serverRevision - p0.serverRevision,
          },
          unchanged: {
            assetRequests: p2.assetRequests - p1.assetRequests,
            uploadedBytes: p2.uploadedBytes - p1.uploadedBytes,
            uniqueAssetBytes: p2.uniqueAssetBytes - p1.uniqueAssetBytes,
            blobRowDelta: p2.blobRows - p1.blobRows,
            aliasRowDelta: p2.aliasRows - p1.aliasRows,
            draftRequests: p2.draftRequests - p1.draftRequests,
            revisionDelta: p2.serverRevision - p1.serverRevision,
          },
          newEdit: {
            assetRequests: p3.assetRequests - p2.assetRequests,
            uploadedBytes: p3.uploadedBytes - p2.uploadedBytes,
            uniqueAssetBytes: p3.uniqueAssetBytes - p2.uniqueAssetBytes,
            blobRowDelta: p3.blobRows - p2.blobRows,
            aliasRowDelta: p3.aliasRows - p2.aliasRows,
            draftRequests: p3.draftRequests - p2.draftRequests,
            revisionDelta: p3.serverRevision - p2.serverRevision,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await fixture.close();
  }
});

test('lost draft response followed by edit reconciles A before saving B without duplicate assets', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
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
  const runtimeDraftPath = `/api/blocks/runtime/projects/${projectId}/draft`;
  let loseFirstDraftResponse = true;
  await fixture.context.route(
    (url) => loseFirstDraftResponse && url.pathname === runtimeDraftPath,
    async (route, request) => {
      if (request.method() !== 'PUT') {
        await route.continue();
        return;
      }
      loseFirstDraftResponse = false;
      const committedResponse = await route.fetch();
      expect(committedResponse.status()).toBe(200);
      await committedResponse.body();
      await route.abort('failed');
    },
  );
  const page = await minuteClockPage(fixture);
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
    await editLiveServerProjectAndAddMedia(frame);
    await advanceMinuteCheckpoint(page);
    await expect.poll(() => fixture.runtimeDraftEvidence.length, { timeout: 20_000 }).toBe(1);
    await expect.poll(() => fixture.getServerRevision(), { timeout: 20_000 }).toBe(24);
    await expect(frame.getByText('Project could not save.', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    const afterLost = {
      ...fixture.runtimePersistenceMetrics,
      serverRevision: fixture.getServerRevision(),
    };
    expect(afterLost.revisionCommits).toBe(1);
    expect(afterLost.serverRevision).toBe(24);
    expect(fixture.runtimeDraftEvidence).toHaveLength(1);
    const firstMutation = fixture.runtimeDraftEvidence[0].body;
    const assetRequestsBeforeRetry = afterLost.assetRequests;
    const uploadedBytesBeforeRetry = afterLost.uploadedBytes;
    const uniqueBytesBeforeRetry = afterLost.uniqueAssetBytes;
    const blobRowsBeforeRetry = afterLost.blobRows;
    const aliasRowsBeforeRetry = afterLost.aliasRows;
    await setServerSteps(frame, '37', '41');
    await advanceMinuteCheckpoint(page, 2);
    await expect.poll(() => fixture.runtimeDraftEvidence.length, { timeout: 20_000 }).toBe(3);
    await expect.poll(() => fixture.getServerRevision(), { timeout: 20_000 }).toBe(25);
    const replayMutation = fixture.runtimeDraftEvidence[1].body;
    const generationB = fixture.runtimeDraftEvidence[2].body;
    expect(replayMutation.mutationId).toBe(firstMutation.mutationId);
    expect(replayMutation.baseRevision).toBe(23);
    expect(firstMutation.baseRevision).toBe(23);
    expect(replayMutation.document).toEqual(firstMutation.document);
    expect(generationB.mutationId).not.toBe(firstMutation.mutationId);
    expect(generationB.baseRevision).toBe(24);
    expect(
      generationB.document.projectJson.targets.find(
        (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
      )?.blocks.move.inputs.STEPS[1][1],
    ).toBe('41');

    const afterReplayAndB = {
      ...fixture.runtimePersistenceMetrics,
      serverRevision: fixture.getServerRevision(),
    };
    expect(afterReplayAndB.assetRequests).toBe(assetRequestsBeforeRetry);
    expect(afterReplayAndB.uploadedBytes).toBe(uploadedBytesBeforeRetry);
    expect(afterReplayAndB.uniqueAssetBytes).toBe(uniqueBytesBeforeRetry);
    expect(afterReplayAndB.blobRows).toBe(blobRowsBeforeRetry);
    expect(afterReplayAndB.aliasRows).toBe(aliasRowsBeforeRetry);
    expect(afterReplayAndB.revisionCommits).toBe(2);
    expect(afterReplayAndB.idempotentReplays).toBe(1);
    expect(afterReplayAndB.serverRevision).toBe(25);
    expect(new Set(fixture.runtimeDraftEvidence.map((entry) => entry.body.mutationId)).size).toBe(
      2,
    );
    fs.writeFileSync(
      `${evidenceDir}/lost-response-edit-reconciliation.json`,
      JSON.stringify(
        {
          logicalMutations: 2,
          generationA: {
            mutationId: firstMutation.mutationId,
            baseRevision: firstMutation.baseRevision,
            replayMutationId: replayMutation.mutationId,
            replayBaseRevision: replayMutation.baseRevision,
          },
          generationB: {
            mutationId: generationB.mutationId,
            baseRevision: generationB.baseRevision,
          },
          draftRequests: afterReplayAndB.draftRequests,
          revisionCommits: afterReplayAndB.revisionCommits,
          idempotentReplays: afterReplayAndB.idempotentReplays,
          revisionDelta: afterReplayAndB.serverRevision - 23,
          assetRequestsAfterAmbiguity: afterReplayAndB.assetRequests - assetRequestsBeforeRetry,
          uploadedBytesAfterAmbiguity: afterReplayAndB.uploadedBytes - uploadedBytesBeforeRetry,
          uniqueAssetBytesAfterAmbiguity: afterReplayAndB.uniqueAssetBytes - uniqueBytesBeforeRetry,
        },
        null,
        2,
      ),
    );
  } finally {
    await fixture.close();
  }
});

test('server revision movement rejects autosave without overwrite or automatic retry', async () => {
  test.setTimeout(150_000);
  const serverProject = await realRuntimeBootstrapFixture();
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
  const page = await fixture.context.newPage();
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
    await setServerSteps(frame, '8', '37');
    expect(fixture.runtimeWriteEvents).toEqual([]);
    expect(fixture.advanceServerRevision()).toBe(24);
    await expect.poll(() => fixture.runtimeDraftEvidence.length, { timeout: 90_000 }).toBe(1);
    await expect(frame.getByText('Project could not save.', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    expect(fixture.runtimePersistenceMetrics.assetRequests).toBe(0);
    expect(fixture.runtimePersistenceMetrics.draftRequests).toBe(1);
    expect(fixture.runtimePersistenceMetrics.revisionCommits).toBe(0);
    expect(fixture.runtimePersistenceMetrics.externalRevisionAdvances).toBe(1);
    expect(fixture.runtimeDraftEvidence).toHaveLength(1);
    fs.writeFileSync(
      `${evidenceDir}/revision-conflict.json`,
      JSON.stringify(
        {
          reason: 'revision_conflict',
          clientBaseRevision: 23,
          serverRevision: fixture.getServerRevision(),
          draftRequests: fixture.runtimePersistenceMetrics.draftRequests,
          clientRevisionCommits: fixture.runtimePersistenceMetrics.revisionCommits,
          automaticRetries: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await fixture.close();
  }
});

test('expired asset and draft capabilities recover in the real pinned Scratch without reloading', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
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
  const page = await minuteClockPage(fixture);
  let expiredAsset = '';
  let rejectDraft = true;
  const draftBodies: string[] = [];
  const assetTokens: string[] = [];
  await page.route('**/api/blocks/runtime/projects/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'PUT') return route.continue();
    const path = new URL(request.url()).pathname;
    let reject = false;
    if (path.includes('/assets/')) {
      if (!expiredAsset) {
        expiredAsset = path;
        reject = true;
      }
      if (path === expiredAsset) assetTokens.push(request.headers()['authorization']);
    } else if (path.endsWith('/draft')) {
      draftBodies.push(request.postData()!);
      reject = rejectDraft;
      rejectDraft = false;
    }
    if (!reject) return route.continue();
    await route.fulfill({
      status: 401,
      headers: { 'Access-Control-Allow-Origin': request.headers()['origin'] ?? parentOrigin },
      contentType: 'application/json',
      body: JSON.stringify({ code: 'expired_token' }),
    });
  });
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
    await editLiveServerProjectAndAddMedia(frame);
    await advanceMinuteCheckpoint(page);
    await expect.poll(() => fixture.getServerRevision(), { timeout: 20_000 }).toBe(24);
    expect(assetTokens).toHaveLength(2);
    expect(assetTokens[1]).not.toBe(assetTokens[0]);
    expect(draftBodies).toHaveLength(2);
    expect(draftBodies[1]).toBe(draftBodies[0]);
    expect(fixture.runtimeDraftEvidence).toHaveLength(1);
    expect(fixture.runtimePersistenceMetrics.revisionCommits).toBe(1);
    expect(fixture.getRuntimeSessionSequence()).toBe(3);
    await expect(shell).toHaveAttribute('data-editor-state', 'ready');
  } finally {
    await fixture.close();
  }
});

test('asset PUT failure makes autosave fail closed before draft PUT', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
    assetWriteStatus: 503,
  });
  const page = await minuteClockPage(fixture);
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
    await editLiveServerProjectAndAddMedia(frame);
    await advanceMinuteCheckpoint(page);
    await expect
      .poll(() => fixture.runtimeAssetPutEvidence.length, { timeout: 20_000 })
      .toBeGreaterThan(0);
    await expect(frame.getByText('Project could not save.', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);
    expect(fixture.runtimeWriteEvents.length).toBeGreaterThan(0);
    expect(fixture.runtimeWriteEvents.every((event) => event.kind === 'asset-put')).toBe(true);
    expect(fixture.getServerRevision()).toBe(23);
  } finally {
    await fixture.close();
  }
});

test('draft PUT failure never produces false autosave success or advances confirmed revision', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
    draftWriteStatus: 409,
  });
  const page = await minuteClockPage(fixture);
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
    await editLiveServerProjectAndAddMedia(frame);
    await advanceMinuteCheckpoint(page);
    await expect.poll(() => fixture.runtimeDraftEvidence.length, { timeout: 20_000 }).toBe(1);
    await expect(frame.getByText('Project could not save.', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    expect(fixture.runtimeAssetPutEvidence.length).toBeGreaterThan(0);
    expect(fixture.runtimeDraftEvidence).toHaveLength(1);
    expect(fixture.runtimeWriteEvents.at(-1)).toEqual({ kind: 'draft-put' });
    expect(
      fixture.runtimeWriteEvents.slice(0, -1).every((event) => event.kind === 'asset-put'),
    ).toBe(true);
    expect(fixture.getServerRevision()).toBe(23);
  } finally {
    await fixture.close();
  }
});

// Regression #256: text presence alone missed two overlapping live regions.
test('ready editor has no footer; connection error stays actionable outside the frame', async () => {
  const fixture = await createProtocolFixture({ product: true, locale: 'ru-RU' });
  const page = await fixture.context.newPage();
  const directory = `${evidenceDir}/status-layout`;
  fs.mkdirSync(directory, { recursive: true });
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    for (const state of ['ready', 'error']) {
      if (state === 'error') {
        await frame.locator('body').evaluate(() => {
          window.dispatchEvent(new ErrorEvent('error', { message: 'protocol-fixture-fatal' }));
        });
        await expect(page.locator('[data-asa-blocks-loading-overlay]')).toHaveAttribute(
          'data-state',
          'error',
        );
      }
      for (const size of [
        { width: 1440, height: 960 },
        { width: 1024, height: 768 },
        { width: 390, height: 844 },
        { width: 320, height: 720 },
      ]) {
        await page.setViewportSize(size);
        const overlay = page.locator('[data-asa-blocks-loading-overlay]');
        const iframe = await page.locator('iframe[title="Scratch runtime"]').boundingBox();
        expect(iframe).not.toBeNull();
        expect(iframe!.x).toBe(0);
        expect(iframe!.y).toBe(0);
        expect(iframe!.width).toBe(size.width);
        expect(iframe!.height).toBeCloseTo(size.height, 1);
        await expect(frame.locator('#runtime-status')).toBeHidden();
        await expect(page.locator('.blocks-editor-connection-status')).toHaveCount(0);
        if (state === 'ready') {
          await expect(overlay).toHaveAttribute('data-state', 'ready');
          await expect(overlay).toHaveAttribute('aria-hidden', 'true');
        } else {
          await expect(overlay).toHaveAttribute('data-state', 'error');
          await expect(overlay).toContainText('Не удалось открыть среду');
          await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible();
          const box = await overlay.boundingBox();
          expect(box).toEqual({ x: 0, y: 0, width: size.width, height: size.height });
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);
        await expect(page.locator('[data-asa-blocks-account-overlay]')).toBeVisible();
        await page.screenshot({ path: `${directory}/${state}-${size.width}.png` });
      }
    }
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('status presentation opt-in cannot hide local errors before accepted INIT', async () => {
  const fixture = await createProtocolFixture();
  const page = await fixture.context.newPage();
  try {
    await page.goto(`${runtimeUrl}/?asaStatus=parent`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-runtime-state',
      'awaiting-init',
    );
    await expect(page.locator('#runtime-status')).toBeVisible();
    await expect(page.locator('#runtime-status')).toContainText('Ожидание безопасного подключения');
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('native File New resets the same managed ASA project and reopens the Scratch default', async () => {
  test.setTimeout(180_000);
  const serverProject = await realRuntimeBootstrapFixture();
  let fixture: Awaited<ReturnType<typeof createProtocolFixture>> | undefined;
  try {
    fixture = await createProtocolFixture({
      product: true,
      locale: 'en-US',
      runtimeSession: {
        draftRevision: 23,
        projectJson: serverProject.projectJson,
        assets: serverProject.assets,
      },
      runtimeAssets: serverProject.runtimeAssets,
    });
    const page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    let frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });

    await setServerSteps(frame, '8', '37');
    await expect(frame.getByText('Save Now', { exact: true })).toHaveCount(0);
    await frame.getByText('File', { exact: true }).click();
    await expect(frame.getByText('Save now', { exact: true })).toHaveCount(0);
    await expect(frame.getByText('Save to your computer', { exact: true })).toBeVisible();
    await frame.getByText('File', { exact: true }).click();
    await expect.poll(() => fixture?.runtimeDraftEvidence.length, { timeout: 90_000 }).toBe(1);
    expect(fixture.getServerRevision()).toBe(24);
    const editedDraft = fixture.runtimeDraftEvidence[0]!.body.document.projectJson.targets.find(
      (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
    );
    expect(editedDraft.blocks.move.inputs.STEPS[1][1]).toBe('37');

    page.once('dialog', async (confirmation) => {
      expect(confirmation.type()).toBe('confirm');
      expect(confirmation.message()).toBe('Replace contents of the current project?');
      await confirmation.accept();
    });
    await frame.getByText('File', { exact: true }).click();
    await frame.getByText('New', { exact: true }).click();

    await expect(
      frame.getByRole('button', { name: 'Server Bootstrap Sprite', exact: true }),
    ).toHaveCount(0);
    await expect(frame.getByText('Could not find project', { exact: false })).toHaveCount(0);
    await expect.poll(() => fixture?.runtimeDraftEvidence.length, { timeout: 90_000 }).toBe(2);
    expect(fixture.getServerRevision()).toBe(25);
    const resetDocument = fixture.runtimeDraftEvidence.at(-1)!.body.document;
    expect(
      resetDocument.projectJson.targets.some(
        (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
      ),
    ).toBe(false);
    const resetSprite = resetDocument.projectJson.targets.find(
      (target: { isStage?: boolean }) => target.isStage === false,
    );
    const resetSpriteName = resetSprite?.name;
    expect(resetSpriteName).toEqual(expect.any(String));
    if (typeof resetSpriteName !== 'string') throw new Error('default Scratch sprite name missing');
    expect(resetSprite?.costumes?.map((costume: { assetId?: string }) => costume.assetId)).toEqual([
      'bcf454acf82e4504149f7ffe07081dbc',
      '0fb9be3e8397c983338cb71dc84d0b25',
    ]);
    expect(resetSprite?.sounds?.map((sound: { assetId?: string }) => sound.assetId)).toEqual([
      '83c36d806dc92327b9e7049a565c6bff',
    ]);
    expect(
      resetDocument.projectJson.targets.some((target: { blocks?: Record<string, unknown> }) =>
        Object.values(target.blocks ?? {}).some(
          (block) =>
            typeof block === 'object' && block !== null && JSON.stringify(block).includes('"37"'),
        ),
      ),
    ).toBe(false);
    expect(fixture.pageErrors).toEqual([]);

    const reopenedSession = {
      draftRevision: fixture.getServerRevision(),
      projectJson: resetDocument.projectJson,
      assets: resetDocument.assets,
    };
    await fixture.close();
    fixture = await createProtocolFixture({
      product: true,
      locale: 'en-US',
      runtimeSession: reopenedSession,
      runtimeAssets: serverProject.runtimeAssets,
    });
    const reopened = await fixture.context.newPage();
    await reopened.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    frame = reopened.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await expect(
      frame.getByRole('button', { name: 'Server Bootstrap Sprite', exact: true }),
    ).toHaveCount(0);
    await expect(frame.getByRole('button', { name: resetSpriteName, exact: true })).toBeVisible();
    await expect(frame.getByText('Could not find project', { exact: false })).toHaveCount(0);
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture?.close();
  }
});

test('dirty Home waits for upstream durable save and a fresh browser reopens the saved value', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  let fixture: Awaited<ReturnType<typeof createProtocolFixture>> | undefined;
  try {
    fixture = await createProtocolFixture({
      product: true,
      locale: 'en-US',
      runtimeSession: {
        draftRevision: 23,
        projectJson: serverProject.projectJson,
        assets: serverProject.assets,
      },
      runtimeAssets: serverProject.runtimeAssets,
    });
    const page = await fixture.context.newPage();
    let draftSeenResolve: (() => void) | undefined;
    const draftSeen = new Promise<void>((resolve) => {
      draftSeenResolve = resolve;
    });
    let releaseDraftResolve: (() => void) | undefined;
    const releaseDraft = new Promise<void>((resolve) => {
      releaseDraftResolve = resolve;
    });
    await fixture.context.route(
      `${parentOrigin}/api/blocks/runtime/projects/${projectId}/draft`,
      async (route) => {
        if (route.request().method() !== 'PUT') {
          await route.continue();
          return;
        }
        draftSeenResolve?.();
        await releaseDraft;
        await route.continue();
      },
    );

    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    let frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await setServerSteps(frame, '8', '73');
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);

    await frame.getByRole('button', { name: 'Home', exact: true }).click();
    await draftSeen;
    expect(page.url()).toBe(`${parentOrigin}/product`);
    expect(fixture.getServerRevision()).toBe(23);
    releaseDraftResolve?.();

    await expect.poll(() => fixture?.getServerRevision(), { timeout: 20_000 }).toBe(24);
    await expect(page).toHaveURL(`${parentOrigin}/product#/home`);
    expect(fixture.runtimeAssetPutEvidence).toHaveLength(0);
    const savedDocument = fixture.runtimeDraftEvidence.at(-1)!.body.document;
    const savedSprite = savedDocument.projectJson.targets.find(
      (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
    );
    expect(savedSprite.blocks.move.inputs.STEPS[1][1]).toBe('73');

    const reopenedSession = {
      draftRevision: fixture.getServerRevision(),
      projectJson: savedDocument.projectJson,
      assets: savedDocument.assets,
    };
    await fixture.close();
    fixture = await createProtocolFixture({
      product: true,
      locale: 'en-US',
      runtimeSession: reopenedSession,
      runtimeAssets: serverProject.runtimeAssets,
    });
    const reopened = await fixture.context.newPage();
    await reopened.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    frame = reopened.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await frame.getByRole('button', { name: 'Server Bootstrap Sprite', exact: true }).click();
    await expect(
      frame.locator('.blocklyBlockCanvas').first().getByText('73', { exact: true }),
    ).toBeVisible();
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture?.close();
  }
});

test('new media Home uploads assets and draft before leaving the editor', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
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
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );

    await frame.getByRole('button', { name: 'Choose a Sprite' }).first().click();
    await frame.getByText('Abby', { exact: true }).click();
    await expect(frame.getByPlaceholder('Name', { exact: true })).toHaveValue('Abby');
    expect(fixture.getServerRevision()).toBe(23);
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);

    await frame.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL(`${parentOrigin}/product#/home`);
    expect(fixture.getServerRevision()).toBe(24);
    expect(fixture.runtimeDraftEvidence).toHaveLength(1);

    const savedDocument = fixture.runtimeDraftEvidence[0].body.document;
    const abby = savedDocument.projectJson.targets.find(
      (target: { name?: string }) => target.name === 'Abby',
    );
    expect(abby).toBeTruthy();
    const assetFiles = [...abby.costumes, ...abby.sounds].map(
      (asset: { assetId: string; dataFormat: string }) => `${asset.assetId}.${asset.dataFormat}`,
    );
    const uploaded = new Set(fixture.runtimeAssetPutEvidence.map((item) => item.assetFile));
    for (const assetFile of assetFiles) expect(uploaded.has(assetFile)).toBe(true);
    const draftIndex = fixture.runtimeWriteEvents.findIndex((event) => event.kind === 'draft-put');
    expect(draftIndex).toBeGreaterThan(0);
    expect(
      fixture.runtimeWriteEvents.slice(0, draftIndex).every((event) => event.kind === 'asset-put'),
    ).toBe(true);
  } finally {
    await fixture.close();
  }
});

test('dirty Home stays in the editor when upstream draft save fails', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
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
  const page = await fixture.context.newPage();
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await setServerSteps(frame, '8', '74');
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);

    await frame.getByRole('button', { name: 'Home', exact: true }).click();
    await expect.poll(() => fixture.runtimeDraftEvidence.length, { timeout: 20_000 }).toBe(1);
    await expect(page).toHaveURL(`${parentOrigin}/product`);
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
    );
    await expect(frame.getByText('Project could not save.', { exact: true })).toBeVisible();
    await expect(frame.getByText('Save Now', { exact: true })).toHaveCount(0);
    expect(fixture.getServerRevision()).toBe(23);
    expect(fixture.runtimePersistenceMetrics.revisionCommits).toBe(0);
  } finally {
    await fixture.close();
  }
});

test('Home waits for the latest generation when an edit arrives during upstream save', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
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
  const page = await fixture.context.newPage();
  let putCount = 0;
  let firstSeenResolve: (() => void) | undefined;
  const firstSeen = new Promise<void>((resolve) => {
    firstSeenResolve = resolve;
  });
  let secondSeenResolve: (() => void) | undefined;
  const secondSeen = new Promise<void>((resolve) => {
    secondSeenResolve = resolve;
  });
  let releaseFirstResolve: (() => void) | undefined;
  const releaseFirst = new Promise<void>((resolve) => {
    releaseFirstResolve = resolve;
  });
  let releaseSecondResolve: (() => void) | undefined;
  const releaseSecond = new Promise<void>((resolve) => {
    releaseSecondResolve = resolve;
  });
  try {
    await fixture.context.route(
      `${parentOrigin}/api/blocks/runtime/projects/${projectId}/draft`,
      async (route) => {
        if (route.request().method() !== 'PUT') {
          await route.continue();
          return;
        }
        putCount += 1;
        if (putCount === 1) {
          firstSeenResolve?.();
          await releaseFirst;
        } else if (putCount === 2) {
          secondSeenResolve?.();
          await releaseSecond;
        }
        await route.continue();
      },
    );
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );

    await setServerSteps(frame, '8', '73');
    await frame.getByRole('button', { name: 'Home', exact: true }).click();
    await firstSeen;
    await setServerSteps(frame, '73', '74');
    expect(page.url()).toBe(`${parentOrigin}/product`);
    releaseFirstResolve?.();

    await secondSeen;
    expect(fixture.getServerRevision()).toBe(24);
    expect(page.url()).toBe(`${parentOrigin}/product`);
    releaseSecondResolve?.();

    await expect.poll(() => fixture.getServerRevision(), { timeout: 20_000 }).toBe(25);
    await expect(page).toHaveURL(`${parentOrigin}/product#/home`);
    expect(fixture.runtimeDraftEvidence).toHaveLength(2);
    expect(fixture.runtimeAssetPutEvidence).toHaveLength(0);
    const latestSprite = fixture.runtimeDraftEvidence
      .at(-1)!
      .body.document.projectJson.targets.find(
        (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
      );
    expect(latestSprite.blocks.move.inputs.STEPS[1][1]).toBe('74');
  } finally {
    releaseFirstResolve?.();
    releaseSecondResolve?.();
    await fixture.close();
  }
});

test('confirmed autosave publishes the native Scratch 480x360 stage preview and fresh context keeps it', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  let fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
  });
  let context = fixture.context;
  const requests: Array<{ method: string; url: string }> = [];
  context.on('request', (request) =>
    requests.push({ method: request.method(), url: request.url() }),
  );
  try {
    const page = await minuteClockPage(fixture);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    let frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await expect(page.locator('[data-asa-blocks-save]')).toHaveCount(0);

    await editPreviewScene(frame, '137');
    await advanceMinuteCheckpoint(page);
    await expect.poll(() => fixture.getServerRevision(), { timeout: 30_000 }).toBe(24);
    await expect.poll(() => fixture.getSnapshotRevision(), { timeout: 20_000 }).toBe(24);
    expect(fixture.runtimeSnapshotEvidence).toHaveLength(1);
    expect(fixture.runtimeSnapshotEvidence[0]).toMatchObject({
      sourceRevision: 24,
      serverRevisionBefore: 24,
    });
    expect(['image/png', 'image/webp']).toContain(fixture.runtimeSnapshotEvidence[0].contentType);
    expect(fixture.getStoredSnapshot()?.bytes.length).toBeGreaterThan(64);
    expect(fixture.getStoredSnapshot()?.bytes.length).toBeLessThanOrEqual(262_144);

    await frame.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL(`${parentOrigin}/product#/home`);
    const image = page.getByTestId('project-preview-snapshot');
    await expect(image).toBeVisible();
    await expect(page.getByTestId('project-preview-fallback')).toHaveCount(0);
    await expect(image).toHaveAttribute('src', `/api/projects/${projectId}/snapshot?rev=24`);
    await expect
      .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(480);
    await expect
      .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalHeight))
      .toBe(360);

    const external = requests.filter(({ url }) => {
      if (!/^https?:/.test(url)) return false;
      return ![parentOrigin, runtimeUrl].includes(new URL(url).origin);
    });
    expect(external).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);

    const savedDocument = fixture.runtimeDraftEvidence.at(-1)?.body.document;
    const savedSnapshot = fixture.getStoredSnapshot();
    if (!savedDocument || !savedSnapshot) throw new Error('saved preview fixture state missing');
    const reopenedSession = {
      draftRevision: fixture.getServerRevision(),
      projectJson: savedDocument.projectJson,
      assets: savedDocument.assets,
    };
    await fixture.close();
    fixture = await createProtocolFixture({
      product: true,
      locale: 'en-US',
      runtimeSession: reopenedSession,
      runtimeAssets: serverProject.runtimeAssets,
      initialSnapshot: savedSnapshot,
    });
    context = fixture.context;
    const fresh = await context.newPage();
    await fresh.goto(`${parentOrigin}/product#/home`, { waitUntil: 'domcontentloaded' });
    const freshImage = fresh.getByTestId('project-preview-snapshot');
    await expect(freshImage).toBeVisible();
    await expect(freshImage).toHaveAttribute('src', `/api/projects/${projectId}/snapshot?rev=24`);
    await expect
      .poll(() => freshImage.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(480);
    await expect
      .poll(() => freshImage.evaluate((node) => (node as HTMLImageElement).naturalHeight))
      .toBe(360);

    await fresh.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    frame = fresh.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await expect(frame.getByRole('button', { name: 'Apple', exact: true })).toBeVisible();
    await frame.getByRole('button', { name: 'Apple', exact: true }).click();
    await expect(frame.getByPlaceholder('x', { exact: true })).toHaveValue('137');
    const externalWrites = fixture.allRequests.filter(({ method, url }) => {
      if (['GET', 'HEAD'].includes(method) || !/^https?:/.test(url)) return false;
      return ![parentOrigin, runtimeUrl].includes(new URL(url).origin);
    });
    expect(externalWrites).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('next confirmed autosave replaces the project preview with the next revision URL', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
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
  const page = await minuteClockPage(fixture);
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await editPreviewScene(frame, '137');
    await advanceMinuteCheckpoint(page);
    await expect.poll(() => fixture.getSnapshotRevision(), { timeout: 20_000 }).toBe(24);

    await frame.getByRole('button', { name: 'Apple', exact: true }).click();
    await frame.getByPlaceholder('x', { exact: true }).fill('166');
    await frame.getByPlaceholder('x', { exact: true }).press('Enter');
    await advanceMinuteCheckpoint(page, 2);
    await expect.poll(() => fixture.getServerRevision(), { timeout: 20_000 }).toBe(25);
    await expect.poll(() => fixture.getSnapshotRevision(), { timeout: 20_000 }).toBe(25);
    expect(fixture.runtimeSnapshotEvidence.map((item) => item.sourceRevision)).toEqual([24, 25]);

    await frame.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL(`${parentOrigin}/product#/home`);
    await expect(page.getByTestId('project-preview-snapshot')).toHaveAttribute(
      'src',
      `/api/projects/${projectId}/snapshot?rev=25`,
    );
  } finally {
    await fixture.close();
  }
});

test('failed draft save keeps the previous preview and never publishes dirty work', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  let failDraft = false;
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
    draftWriteStatus: () => (failDraft ? 503 : 200),
  });
  const page = await minuteClockPage(fixture);
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await editPreviewScene(frame, '137');
    await advanceMinuteCheckpoint(page);
    await expect.poll(() => fixture.getSnapshotRevision(), { timeout: 20_000 }).toBe(24);
    expect(fixture.runtimeSnapshotEvidence).toHaveLength(1);

    failDraft = true;
    await frame.getByRole('button', { name: 'Apple', exact: true }).click();
    await frame.getByPlaceholder('x', { exact: true }).fill('177');
    await frame.getByPlaceholder('x', { exact: true }).press('Enter');
    await advanceMinuteCheckpoint(page, 2);
    await expect.poll(() => fixture.runtimeDraftEvidence.length, { timeout: 20_000 }).toBe(2);
    await expect(frame.getByText('Project could not save.', { exact: true })).toBeVisible();
    expect(fixture.getServerRevision()).toBe(24);
    expect(fixture.getSnapshotRevision()).toBe(24);
    expect(fixture.runtimeSnapshotEvidence).toHaveLength(1);
  } finally {
    await fixture.close();
  }
});

test('thumbnail upload failure never rolls back a successful project autosave', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  let failSnapshot = false;
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
    snapshotWriteStatus: () => (failSnapshot ? 503 : 200),
  });
  const page = await minuteClockPage(fixture);
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await editPreviewScene(frame, '137');
    await advanceMinuteCheckpoint(page);
    await expect.poll(() => fixture.getSnapshotRevision(), { timeout: 20_000 }).toBe(24);

    failSnapshot = true;
    await frame.getByRole('button', { name: 'Apple', exact: true }).click();
    await frame.getByPlaceholder('x', { exact: true }).fill('188');
    await frame.getByPlaceholder('x', { exact: true }).press('Enter');
    await advanceMinuteCheckpoint(page, 2);
    await expect.poll(() => fixture.getServerRevision(), { timeout: 20_000 }).toBe(25);
    await expect.poll(() => fixture.runtimeSnapshotEvidence.length, { timeout: 20_000 }).toBe(2);
    expect(fixture.getSnapshotRevision()).toBe(24);
    await expect(frame.getByText('Project could not save.', { exact: true })).toHaveCount(0);
    const latestDraft = fixture.runtimeDraftEvidence
      .at(-1)
      ?.body.document.projectJson.targets.find(
        (target: { name?: string }) => target.name === 'Apple',
      );
    expect(latestDraft?.x).toBe(188);
  } finally {
    await fixture.close();
  }
});

test('stale thumbnail arriving after a newer autosave cannot replace the newer preview', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
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
  const page = await minuteClockPage(fixture);
  let heldSeenResolve: (() => void) | undefined;
  const heldSeen = new Promise<void>((resolve) => {
    heldSeenResolve = resolve;
  });
  let releaseHeldResolve: (() => void) | undefined;
  const releaseHeld = new Promise<void>((resolve) => {
    releaseHeldResolve = resolve;
  });
  let held = false;
  try {
    await fixture.context.route(
      `${parentOrigin}/api/projects/${projectId}/snapshot`,
      async (route) => {
        const body = route.request().postDataJSON() as { sourceRevision?: number } | null;
        if (!held && body?.sourceRevision === 24) {
          held = true;
          heldSeenResolve?.();
          await releaseHeld;
        }
        await route.continue();
      },
    );

    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await editPreviewScene(frame, '137');
    await advanceMinuteCheckpoint(page);
    await expect.poll(() => fixture.getServerRevision(), { timeout: 20_000 }).toBe(24);
    await heldSeen;
    expect(fixture.getSnapshotRevision()).toBeNull();

    await frame.getByRole('button', { name: 'Apple', exact: true }).click();
    await frame.getByPlaceholder('x', { exact: true }).fill('199');
    await frame.getByPlaceholder('x', { exact: true }).press('Enter');
    await advanceMinuteCheckpoint(page, 2);
    await expect.poll(() => fixture.getServerRevision(), { timeout: 20_000 }).toBe(25);
    await expect.poll(() => fixture.getSnapshotRevision(), { timeout: 20_000 }).toBe(25);

    releaseHeldResolve?.();
    await expect.poll(() => fixture.runtimeSnapshotEvidence.length, { timeout: 20_000 }).toBe(2);
    expect(fixture.getSnapshotRevision()).toBe(25);
    expect(fixture.runtimeSnapshotEvidence.map((item) => item.sourceRevision).sort()).toEqual([
      24, 25,
    ]);
  } finally {
    releaseHeldResolve?.();
    await fixture.close();
  }
});

// Native Scratch File commands are not ASA durable save or the M1-007 import API.
// Reopen in a fresh browser so an in-memory VM/storage cache cannot fake restoration.
test('native File saves an edited sb3 and restores code and media in a fresh editor', async () => {
  const directory = `${evidenceDir}/native-file-roundtrip`;
  fs.mkdirSync(directory, { recursive: true });
  const savedPath = `${directory}/edited-project.sb3`;
  const marker = 'ASA File Sprite';
  const variable = 'ASA_File_Proof';
  const requests: Array<{ phase: string; url: string; method: string }> = [];
  const failed: Array<{ phase: string; url: string; error: string; type: string }> = [];
  const requestPhases = new WeakMap<object, string>();
  const badResponses: string[] = [];
  let phase = 'edit';
  let fixture: Awaited<ReturnType<typeof createProtocolFixture>> | undefined;
  const observe = (current: NonNullable<typeof fixture>) => {
    current.context.on('request', (request) => {
      requestPhases.set(request, phase);
      requests.push({ phase, url: request.url(), method: request.method() });
    });
    current.context.on('requestfailed', (request) => {
      failed.push({
        phase: requestPhases.get(request) ?? 'unknown',
        url: request.url(),
        error: request.failure()?.errorText ?? 'unknown',
        type: request.resourceType(),
      });
    });
    current.context.on('response', (response) => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
    });
  };
  try {
    fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
    observe(fixture);
    const page = await fixture.context.newPage();
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    phase = 'sprite-library';
    await frame.getByRole('button', { name: 'Choose a Sprite' }).first().click();
    await frame.getByText('Abby', { exact: true }).click();
    await expect(frame.getByPlaceholder('Name', { exact: true })).toHaveValue('Abby');
    await frame.getByPlaceholder('Name', { exact: true }).fill(marker);
    await frame.getByPlaceholder('Name', { exact: true }).press('Enter');
    await frame.getByPlaceholder('x', { exact: true }).fill('137');
    await frame.getByPlaceholder('x', { exact: true }).press('Enter');
    await frame.getByRole('treeitem', { name: 'Variables', exact: true }).click();
    await frame.getByText('Make a Variable', { exact: true }).click();
    const dialog = frame.getByRole('dialog', { name: 'New Variable' });
    await dialog.getByRole('textbox').fill(variable);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
    phase = 'sound-library';
    await frame.getByRole('button', { name: 'Choose a Sound', exact: true }).first().click();
    await frame.getByText('Bark', { exact: true }).click();
    await expect(frame.getByRole('textbox', { name: 'Sound', exact: true })).toHaveValue('Bark');
    await frame.getByRole('tab', { name: 'Code', exact: true }).click();
    await expect(frame.getByRole('button', { name: marker, exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    await page.screenshot({ path: `${directory}/01-before-save.png` });
    await frame.getByText('File', { exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await frame.getByText('Save to your computer', { exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.sb3$/i);
    await download.saveAs(savedPath);
    expect(await download.failure()).toBeNull();
    const savedBytes = fs.readFileSync(savedPath);
    expect(savedBytes.length).toBeGreaterThan(1024);
    expect(savedBytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(fixture.pageErrors).toEqual([]);
    await fixture.close();
    fixture = undefined;
    phase = 'fresh-boot';
    fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
    observe(fixture);
    const reopened = await fixture.context.newPage();
    await reopened.setViewportSize({ width: 1440, height: 960 });
    await reopened.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const restored = reopened.frameLocator('iframe[title="Scratch runtime"]');
    await expect(restored.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await expect(restored.getByRole('button', { name: marker, exact: true })).toHaveCount(0);
    phase = 'restore';
    await restored.getByText('File', { exact: true }).click();
    fs.writeFileSync(`${directory}/fresh-menu.html`, await restored.locator('body').innerHTML());
    try {
      await expect(restored.getByText('Load from your computer', { exact: true })).toBeVisible();
    } catch (error) {
      await reopened.screenshot({ path: `${directory}/fresh-menu-failure.png` });
      fs.writeFileSync(
        `${directory}/fresh-menu-failure.html`,
        await restored.locator('body').innerHTML(),
      );
      throw error;
    }
    const [chooser] = await Promise.all([
      reopened.waitForEvent('filechooser'),
      restored.getByText('Load from your computer', { exact: true }).click(),
    ]);
    await chooser.setFiles(savedPath);
    const importedSprite = restored.getByRole('button', { name: marker, exact: true });
    await expect(importedSprite).toBeVisible();
    await importedSprite.click();
    await expect(restored.getByPlaceholder('Name', { exact: true })).toHaveValue(marker);
    await expect(restored.getByPlaceholder('x', { exact: true })).toHaveValue('137');
    await expect(
      restored.locator('[class*="monitor_label"]').filter({ hasText: variable }),
    ).toBeVisible();
    await restored.getByRole('tab', { name: 'Costumes', exact: true }).click();
    await expect(
      restored
        .getByRole('tabpanel', { name: 'Costumes', exact: true })
        .getByText('Abby-a', { exact: true }),
    ).toBeVisible();
    await expect(
      restored
        .getByRole('tabpanel', { name: 'Costumes', exact: true })
        .getByText('Abby-d', { exact: true }),
    ).toBeVisible();
    const costumeImage = importedSprite.locator('img').first();
    await expect
      .poll(() => costumeImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await reopened.screenshot({ path: `${directory}/03-restored-costumes.png` });
    await restored.getByRole('tab', { name: 'Sounds', exact: true }).click();
    await restored
      .getByRole('tabpanel', { name: 'Sounds', exact: true })
      .getByText('Bark', { exact: true })
      .click();
    await expect(restored.getByRole('textbox', { name: 'Sound', exact: true })).toHaveValue('Bark');
    await reopened.screenshot({ path: `${directory}/04-restored-sound.png` });
    // Native export proves the restored sound is Bark, not a silent fallback
    // retaining its label. Never read or alter the VM to make this assertion.
    await restored
      .getByRole('tabpanel', { name: 'Sounds', exact: true })
      .getByText('Bark', { exact: true })
      .click({ button: 'right' });
    const [soundDownload] = await Promise.all([
      reopened.waitForEvent('download'),
      restored.getByRole('menuitem', { name: 'export', exact: true }).click(),
    ]);
    expect(soundDownload.suggestedFilename()).toBe('Bark.wav');
    const restoredSoundPath = `${directory}/restored-Bark.wav`;
    await soundDownload.saveAs(restoredSoundPath);
    expect(await soundDownload.failure()).toBeNull();
    expect(createHash('md5').update(fs.readFileSync(restoredSoundPath)).digest('hex')).toBe(
      barkAssetId,
    );

    await restored.getByRole('tab', { name: 'Code', exact: true }).click();
    await expect(restored.getByRole('button', { name: marker, exact: true })).toBeVisible();
    await expect(restored.getByText('Fixture Cat', { exact: true })).toHaveCount(0);
    await restored.getByRole('button', { name: 'Start project', exact: true }).click();
    const shell = restored.locator('[data-asa-host-shell]');
    await expect(shell).not.toHaveAttribute('data-runtime-state', 'error');
    await restored.getByRole('button', { name: 'Stop project', exact: true }).click();
    await expect(shell).toHaveAttribute('data-project-running', 'false');
    await expect(reopened.getByRole('status')).toHaveCount(0);
    await expect(reopened.locator('[data-asa-blocks-account-overlay]')).toBeVisible();
    await reopened.screenshot({ path: `${directory}/05-restored-project.png` });
    const httpRequests = requests.filter(({ url }) => /^https?:/.test(url));
    expect(
      httpRequests.filter(({ url }) => ![parentOrigin, runtimeUrl].includes(new URL(url).origin)),
    ).toEqual([]);
    const runtimeSessionRequests = httpRequests.filter(
      ({ method, url }) =>
        method === 'POST' &&
        new URL(url).origin === parentOrigin &&
        new URL(url).pathname ===
          '/api/projects/11111111-1111-4111-8111-111111111111/blocks/runtime-session',
    );
    expect(runtimeSessionRequests.length).toBeGreaterThanOrEqual(2);
    const managedRuntimeMutations = httpRequests.filter(({ method, url }) => {
      if (method !== 'PUT') return false;
      const parsed = new URL(url);
      if (parsed.origin !== parentOrigin) return false;
      return (
        /^\/api\/blocks\/runtime\/projects\/[0-9a-f-]+\/assets\/[a-f0-9]{32}\.(svg|png|jpg|wav|mp3)$/i.test(
          parsed.pathname,
        ) ||
        /^\/api\/blocks\/runtime\/projects\/[0-9a-f-]+\/draft$/i.test(parsed.pathname) ||
        /^\/api\/projects\/[0-9a-f-]+\/snapshot$/i.test(parsed.pathname)
      );
    });
    expect(managedRuntimeMutations.length).toBeGreaterThan(0);
    expect(
      httpRequests.filter(
        ({ method, url }) =>
          !['GET', 'HEAD'].includes(method) &&
          !isTelemetryRequest({ method, url }, parentOrigin) &&
          !runtimeSessionRequests.some(
            (runtimeSessionRequest) =>
              runtimeSessionRequest.method === method && runtimeSessionRequest.url === url,
          ) &&
          !managedRuntimeMutations.some(
            (runtimeMutation) => runtimeMutation.method === method && runtimeMutation.url === url,
          ),
      ),
    ).toEqual([]);
    expect(
      httpRequests.filter(
        ({ phase: step, url }) =>
          step === 'restore' &&
          new URL(url).pathname.startsWith('/internal/blocks/library-assets/'),
      ),
    ).toEqual([]);
    // Closing a stock picker may cancel an unused thumbnail. Keep that evidence,
    // but do not confuse it with failed project/media reads during file restoration.
    expect(
      failed.filter(
        (failure) =>
          !(
            failure.phase === 'sprite-library' &&
            failure.type === 'image' &&
            failure.error === 'net::ERR_ABORTED' &&
            new URL(failure.url).origin === parentOrigin &&
            /^\/internal\/blocks\/library-assets\/[a-f0-9]{32}\.(svg|png|jpg)$/.test(
              new URL(failure.url).pathname,
            )
          ),
      ),
    ).toEqual([]);
    expect(badResponses).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
  } catch (error) {
    const lastPage = fixture?.context.pages().at(-1);
    if (lastPage && !lastPage.isClosed()) {
      await Promise.allSettled([
        lastPage.screenshot({ path: `${directory}/failure.png` }),
        lastPage
          .frameLocator('iframe[title="Scratch runtime"]')
          .locator('body')
          .innerHTML()
          .then((html) => fs.writeFileSync(`${directory}/failure.html`, html)),
      ]);
    }
    throw error;
  } finally {
    try {
      fs.writeFileSync(
        `${directory}/network.json`,
        JSON.stringify(
          { requests, failed, badResponses, pageErrors: fixture?.pageErrors ?? [] },
          null,
          2,
        ),
      );
    } finally {
      await fixture?.close();
    }
  }
});

// A missing runtime must leave an actionable portal-owned state, not an endless spinner.
test('unreachable Scratch times out and can reconnect without hiding the editor', async () => {
  test.setTimeout(100000);
  const fixture = await createProtocolFixture({ product: true, locale: 'ru-RU' });
  const page = await fixture.context.newPage();
  const blockRuntime = (route: import('@playwright/test').Route) => route.abort();
  try {
    await page.route(`${parentOrigin}/internal/blocks/**`, blockRuntime);
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const overlay = page.locator('[data-asa-blocks-loading-overlay]');
    await expect(overlay).toHaveAttribute('data-state', 'error', { timeout: 55000 });
    await expect(overlay).toContainText('Не удалось открыть среду');
    await expect(page.locator('[data-asa-blocks-account-overlay]')).toBeVisible();
    await page.unroute(`${parentOrigin}/internal/blocks/**`, blockRuntime);
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(overlay).toHaveAttribute('data-state', 'loading');
    await expect(
      page.frameLocator('iframe[title="Scratch runtime"]').locator('[data-asa-host-shell]'),
    ).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
    await expect(overlay).toHaveAttribute('data-state', 'ready');
    await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toHaveCount(0);
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('clean Scratch ASA logo requests parent Home with no overlay', async () => {
  const fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
  const page = await fixture.context.newPage();
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await expect(page.locator('[data-asa-blocks-home-overlay]')).toHaveCount(0);
    await expect(page.locator('.blocks-editor-home')).toHaveCount(0);
    await expect(page.locator('[data-asa-blocks-save]')).toHaveCount(0);
    const logo = frame.locator('#logo_img');
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('src', './asa-lab-scratch-wordmark.svg');
    await frame.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL(`${parentOrigin}/product#/home`);
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);
    expect(fixture.runtimePersistenceMetrics.revisionCommits).toBe(0);
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('native Scratch library Back controls never navigate the parent', async () => {
  const fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
  const page = await fixture.context.newPage();
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    const parentUrl = `${parentOrigin}/product`;
    await expect(page.locator('[data-asa-blocks-home-overlay]')).toHaveCount(0);

    const assertBackClosesLibrary = async (
      openLibrary: () => Promise<void>,
      markerText: string,
    ): Promise<void> => {
      await openLibrary();
      await expect(page).toHaveURL(parentUrl);

      const account = page.locator('[data-asa-blocks-account-overlay]');
      const back = frame.getByRole('button', { name: 'Back', exact: true });
      const marker = frame.getByText(markerText, { exact: true });

      await expect(account).toBeVisible();
      await expect(back).toBeVisible();
      await expect(marker).toBeVisible();

      const accountBox = await account.boundingBox();
      const backBox = await back.boundingBox();
      expect(accountBox).not.toBeNull();
      expect(backBox).not.toBeNull();
      const overlaps =
        accountBox!.x < backBox!.x + backBox!.width &&
        accountBox!.x + accountBox!.width > backBox!.x &&
        accountBox!.y < backBox!.y + backBox!.height &&
        accountBox!.y + accountBox!.height > backBox!.y;
      expect(overlaps).toBe(false);

      await back.click();
      await expect(back).toBeHidden();
      await expect(marker).toBeHidden();
      await expect(page).toHaveURL(parentUrl);
    };

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 720 },
    ]) {
      await page.setViewportSize(viewport);

      await assertBackClosesLibrary(async () => {
        await frame.getByRole('button', { name: 'Choose a Sprite' }).first().click();
      }, 'Abby');

      await assertBackClosesLibrary(async () => {
        await frame.getByRole('button', { name: 'Choose a Backdrop' }).first().click();
      }, 'Blue Sky');

      await assertBackClosesLibrary(async () => {
        await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
        await frame.getByRole('button', { name: 'Choose a Sound', exact: true }).first().click();
      }, 'Bark');

      await assertBackClosesLibrary(async () => {
        await frame.getByRole('tab', { name: 'Code', exact: true }).click();
        await frame.getByRole('button', { name: 'Add Extension', exact: true }).click();
      }, 'Music');
    }

    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('runtime compresses scripts and safely separates stock and entry caching', async ({
  request,
}) => {
  const script = await request.get(`${runtimeUrl}/vendor/scratch/scratch-gui-standalone.js`, {
    headers: { 'Accept-Encoding': 'gzip', Via: '1.1 asa-local-test' },
  });
  expect(script.status()).toBe(200);
  expect(script.headers()['content-encoding']).toBe('gzip');
  expect(script.headers()['vary']).toContain('Accept-Encoding');
  expect(script.headers()['cache-control']).toBe('no-cache');
  const identity = await request.get(`${runtimeUrl}/vendor/scratch/scratch-gui-standalone.js`, {
    headers: { 'Accept-Encoding': 'identity' },
  });
  expect(identity.headers()['content-encoding']).toBeUndefined();
  expect(Number(script.headers()['content-length'])).toBeGreaterThan(0);
  expect(Number(script.headers()['content-length'])).toBeLessThan(
    Number(identity.headers()['content-length']) * 0.5,
  );
  expect(
    createHash('sha256')
      .update(await script.body())
      .digest('hex'),
  ).toBe(
    createHash('sha256')
      .update(await identity.body())
      .digest('hex'),
  );
  const sound = await request.get(`${runtimeUrl}/library-assets/${barkAssetId}.wav`);
  expect(sound.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  for (const pathname of [
    '/',
    '/index.html',
    '/editor.js',
    '/asa-commit.txt',
    '/library-assets/library-assets-manifest.json',
  ]) {
    const response = await request.get(`${runtimeUrl}${pathname}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-cache');
  }
  const missing = await request.get(
    `${runtimeUrl}/library-assets/00000000000000000000000000000000.svg`,
  );
  expect(missing.status()).toBe(404);
  expect(missing.headers()['cache-control'] ?? '').not.toContain('immutable');
});
