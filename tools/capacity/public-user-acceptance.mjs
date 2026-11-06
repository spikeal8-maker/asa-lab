#!/usr/bin/env node
// Public acceptance is deliberately separate from the loopback/test-DB fixtures.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

export const ORIGIN = 'https://asa-lab.ru';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const TELEMETRY = /^\/api\/(?:analytics|diagnostics)\/[a-z0-9/-]+$/;
const TELEMETRY_ROUTE = /^https:\/\/asa-lab\.ru\/api\/(?:analytics|diagnostics)\//;
const MODULE = {
  electronics: 'electronics',
  scratch: 'blocks',
  chess: 'chess',
  checkers: 'checkers',
};
const GAME_TITLE = { chess: 'Шахматы', checkers: 'Шашки' };
const PROJECT_SLOTS = new Set([
  'account:electronics',
  'seat-1:electronics',
  'seat-1:scratch',
  'seat-2:chess',
  'seat-2:checkers',
]);
const STEPS = [
  'revision',
  'account-login',
  'owned-classroom',
  'account-reload',
  'seat-1-login',
  'seat-2-login',
  'my-learning',
  'account-project',
  'seat-1-electronics',
  'seat-1-scratch',
  'telemetry-503',
  'offline-10s',
  'readonly-tabs',
  'chess',
  'checkers',
  'account-logout-login',
  'final-readback',
  'cleanup',
];

export class Refusal extends Error {
  constructor(code, status = 'BLOCKED') {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const requireThat = (condition, code, status = 'BLOCKED') => {
  if (!condition) throw new Refusal(code, status);
};
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, maximum = 256) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= maximum &&
  ![...value].some(
    (character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
  );
const uuid = (value) => typeof value === 'string' && UUID.test(value);
const keys = (value, required, optional = []) =>
  object(value) &&
  required.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every((key) => [...required, ...optional].includes(key));
const classCode = (value) => (typeof value === 'string' ? value.replace(/ /g, '') : '');

export function validateManifest(input) {
  requireThat(
    keys(
      input,
      [
        'schemaVersion',
        'origin',
        'expectedRevision',
        'expectedSchemaVersion',
        'testMarker',
        'account',
        'classroom',
        'seats',
      ],
      ['allowNativeBotCheckClick'],
    ),
    'manifest_shape',
  );
  requireThat(input.schemaVersion === 1 && input.origin === ORIGIN, 'manifest_origin_or_schema');
  requireThat(
    SHA.test(input.expectedRevision) &&
      Number.isSafeInteger(input.expectedSchemaVersion) &&
      input.expectedSchemaVersion > 0,
    'manifest_revision',
  );
  requireThat(
    /^ASA-PUBLIC-TEST-[A-Za-z0-9-]{6,40}$/.test(input.testMarker),
    'manifest_test_marker',
  );
  requireThat(
    input.allowNativeBotCheckClick === undefined ||
      typeof input.allowNativeBotCheckClick === 'boolean',
    'manifest_bot_authorization',
  );
  const { account, classroom, seats, testMarker } = input;
  requireThat(
    keys(account, ['id', 'workspaceId', 'displayName', 'identifier', 'password']) &&
      uuid(account.id) &&
      uuid(account.workspaceId) &&
      account.displayName === `${testMarker} Account` &&
      text(account.identifier) &&
      text(account.password),
    'manifest_account',
  );
  requireThat(
    keys(classroom, ['id', 'title', 'code']) &&
      uuid(classroom.id) &&
      classroom.title === testMarker &&
      /^[A-Z2-9]{9}$/.test(classCode(classroom.code)),
    'manifest_classroom',
  );
  requireThat(Array.isArray(seats) && seats.length === 2, 'manifest_two_seats');
  for (const [index, seat] of seats.entries()) {
    requireThat(
      keys(seat, ['id', 'displayLabel', 'studentCode']) &&
        uuid(seat.id) &&
        seat.displayLabel === `${testMarker} Seat ${index + 1}` &&
        typeof seat.studentCode === 'string' &&
        /^[A-Za-z0-9]{4,10}$/.test(seat.studentCode),
      'manifest_seat',
    );
  }
  requireThat(
    new Set([account.id, account.workspaceId, classroom.id, ...seats.map((s) => s.id)]).size ===
      5 && seats[0].studentCode !== seats[1].studentCode,
    'manifest_duplicate_identity',
  );
  return JSON.parse(JSON.stringify(input));
}

export function assertEnvironment(env) {
  for (const key of [
    'CI',
    'GITHUB_ACTIONS',
    'TEST_DATABASE_URL',
    'APP_TEST_DATABASE_URL',
    'ASA_SEED_DEV',
    'ASA_SCALE_USERS',
    'ASA_REQUEST_STORM',
    'ASA_E2E_EXTERNAL',
    'ASA_E2E_BASE_URL',
  ])
    requireThat(!env[key], 'mixed_fixture_environment');
  requireThat(env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'tls_verification_disabled');
}

export function assertBotClickAuthorized(manifest) {
  requireThat(manifest.allowNativeBotCheckClick === true, 'bot_check_handoff');
}

export function assertRevision(manifest, version, web, readiness) {
  for (const proof of [version, readiness?.deployment])
    requireThat(
      proof?.revision === manifest.expectedRevision &&
        proof?.schemaVersion === manifest.expectedSchemaVersion &&
        proof?.expectedSchemaVersion === manifest.expectedSchemaVersion &&
        proof?.synchronized === true,
      'revision_or_schema_mismatch',
    );
  requireThat(
    web?.revision === manifest.expectedRevision &&
      readiness?.status === 'ready' &&
      readiness?.dependencies?.database === 'up' &&
      readiness?.dependencies?.credentialConfiguration === 'valid',
    'readiness_or_web_mismatch',
  );
}

export function assertAccount(manifest, session, verification) {
  const expected = manifest.account;
  requireThat(
    session?.authenticated === true &&
      session?.account?.identityKind === 'account' &&
      session?.account?.id === expected.id &&
      session?.user?.id === expected.id &&
      session?.account?.displayName === expected.displayName,
    'account_identity_mismatch',
  );
  requireThat(
    verification?.required === false && session?.verification?.required === false,
    'verification_required_or_unknown',
  );
  requireThat(
    session?.activeWorkspace?.kind === 'personal' &&
      session?.activeWorkspace?.workspaceId === expected.workspaceId &&
      session?.workspaces?.some(
        (w) => w.workspaceId === expected.workspaceId && w.kind === 'personal',
      ) &&
      text(session?.timeZone, 100),
    'personal_workspace_or_timezone_unprepared',
  );
}

export function assertClassroom(manifest, result, roster) {
  const c = result?.classroom;
  requireThat(
    c?.id === manifest.classroom.id &&
      c?.title === manifest.testMarker &&
      c?.teacherRole === 'owner' &&
      c?.workspaceKind === 'personal' &&
      c?.status === 'active' &&
      c?.safeModeDefault === true &&
      c?.studentCount === 2 &&
      c?.joinCodeStatus === 'active' &&
      classCode(c?.joinCode) === classCode(manifest.classroom.code),
    'classroom_ownership_or_marker',
  );
  requireThat(Array.isArray(roster?.items) && roster.items.length === 2, 'roster_not_exactly_two');
  for (const expected of manifest.seats) {
    const matches = roster.items.filter((s) => s.id === expected.id);
    requireThat(
      matches.length === 1 &&
        matches[0].displayLabel === expected.displayLabel &&
        matches[0].safeMode === true &&
        ['issued', 'active'].includes(matches[0].status),
      'roster_identity_or_marker',
    );
  }
}

export function assertSeat(manifest, index, session) {
  const expected = manifest.seats[index];
  requireThat(
    expected &&
      session?.authenticated === true &&
      session?.student?.seatId === expected.id &&
      session?.student?.displayName === expected.displayLabel &&
      session?.student?.safeMode === true &&
      session?.classroom?.id === manifest.classroom.id &&
      session?.classroom?.title === manifest.testMarker,
    'seat_identity_or_classroom_mismatch',
  );
}

export function digest(value) {
  const canonical = (v) =>
    Array.isArray(v)
      ? v.map(canonical)
      : object(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((key) => [key, canonical(v[key])]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

export function projectProjection(editor, document, expected) {
  if (editor === 'electronics') {
    const selected = (document?.components ?? []).filter((p) => p.id === expected.componentId);
    return {
      moduleKey: 'electronics',
      componentId: selected[0]?.id ?? null,
      componentTypeId: selected[0]?.componentTypeId ?? null,
      resistanceOhms: selected[0]?.value ?? null,
      matchingComponents: selected.length,
    };
  }
  const targets = document?.projectJson?.targets ?? [];
  const sprites = targets.filter((t) => t.isStage === false && t.name === expected.spriteName);
  const costumes = sprites[0]?.costumes ?? [];
  return {
    moduleKey: 'blocks',
    spriteName: sprites[0]?.name ?? null,
    matchingSprites: sprites.length,
    x: sprites[0]?.x ?? null,
    y: sprites[0]?.y ?? null,
    stageCount: targets.filter((t) => t.isStage === true).length,
    storedCostumeReferences:
      costumes.length > 0 &&
      costumes.every((c) =>
        (document?.assets ?? []).some(
          (a) =>
            a.assetId === c.assetId &&
            a.dataFormat === c.dataFormat &&
            HASH.test(a.sha256) &&
            Number.isSafeInteger(a.sizeBytes) &&
            a.sizeBytes > 0,
        ),
      ),
  };
}

/**
 * @typedef {{ documentHash: string, revisionAfter: number, revisionBefore?: number,
 * expectedContentHash?: string, actualContentHash?: string }} DraftProof
 */
/** @param {DraftProof | null} [previous] @returns {DraftProof} */
export function assertDraft(manifest, item, payload, previous = null, changed = false) {
  const { project, draft } = payload ?? {};
  requireThat(
    project?.id === item.id &&
      draft?.projectId === item.id &&
      project?.moduleKey === MODULE[item.editor] &&
      project?.scope === 'personal' &&
      (Object.hasOwn(GAME_TITLE, item.editor)
        ? item.actor === 'seat-2' &&
          project?.classroomId === null &&
          project?.status === 'active' &&
          project?.title === GAME_TITLE[item.editor]
        : [null, manifest.classroom.id].includes(project?.classroomId)) &&
      object(draft?.document) &&
      Number.isSafeInteger(draft?.revision) &&
      draft.revision >= 0,
    'draft_identity_mismatch',
    'FAIL',
  );
  const contentHash = digest(draft.document);
  /** @type {DraftProof} */
  const proof = { documentHash: contentHash, revisionAfter: draft.revision };
  if (item.expected) {
    proof.expectedContentHash = digest(item.expected);
    proof.actualContentHash = digest(projectProjection(item.editor, draft.document, item.expected));
    requireThat(
      proof.expectedContentHash === proof.actualContentHash,
      'saved_content_mismatch',
      'FAIL',
    );
  }
  if (previous) {
    proof.revisionBefore = previous.revisionAfter;
    requireThat(
      changed
        ? draft.revision > previous.revisionAfter && contentHash !== previous.documentHash
        : draft.revision >= previous.revisionAfter && contentHash === previous.documentHash,
      'saved_revision_or_reopen_mismatch',
      'FAIL',
    );
  }
  return proof;
}

export function createBudget() {
  return {
    projectAttempts: 0,
    projectSlots: new Set(),
    projectRequests: new Map(),
    projects: new Map(),
    gameAttempts: new Set(),
    invites: new Map(),
    matches: new Map(),
  };
}
export function reserveProject(budget, actor, editor) {
  requireThat(PROJECT_SLOTS.has(`${actor}:${editor}`), 'unplanned_project');
  requireThat(
    budget.projectAttempts < 5 && !budget.projectSlots.has(`${actor}:${editor}`),
    'project_budget',
  );
  budget.projectAttempts++;
  budget.projectSlots.add(`${actor}:${editor}`);
}
const createRequestHash = ({ method, path, body, idempotencyKey }) =>
  digest({ method, path, body, idempotencyKey });

/** @param {{ method: string, path: string, body: unknown, idempotencyKey?: string } | null} [request] */
export function ownProject(budget, actor, editor, payload, classroomId, request = null) {
  const id = payload?.project?.id;
  const slot = `${actor}:${editor}`;
  const game = Object.hasOwn(GAME_TITLE, editor);
  requireThat(
    PROJECT_SLOTS.has(slot) &&
      budget.projectSlots.has(slot) &&
      uuid(id) &&
      !budget.projects.has(id) &&
      ![...budget.projects.values()].some((p) => p.actor === actor && p.editor === editor) &&
      payload?.created === true &&
      payload?.project?.moduleKey === MODULE[editor] &&
      payload?.project?.scope === 'personal' &&
      uuid(classroomId) &&
      (game
        ? actor === 'seat-2' &&
          request !== null &&
          budget.projectRequests.get(slot) === createRequestHash(request) &&
          keys(payload, ['created', 'project']) &&
          keys(
            payload.project,
            ['id', 'scope', 'classroomId', 'moduleKey', 'title', 'status'],
            [
              'createdAt',
              'updatedAt',
              'preview',
              'snapshotRevision',
              'description',
              'tags',
              'license',
              'copiedFrom',
            ],
          ) &&
          payload.project.classroomId === null &&
          payload.project.status === 'active' &&
          payload.project.title === GAME_TITLE[editor]
        : [null, classroomId].includes(payload?.project?.classroomId)),
    'creation_receipt',
    'FAIL',
  );
  const item = { id, actor, editor, expected: null, proof: null };
  budget.projects.set(id, item);
  return item;
}
export function reserveGame(budget, game) {
  requireThat(
    ['chess', 'checkers'].includes(game) &&
      !budget.gameAttempts.has(game) &&
      budget.gameAttempts.size < 2,
    'game_budget',
  );
  budget.gameAttempts.add(game);
}

export function nativeMutationAllowed(manifest, budget, actor, request, gateOpen) {
  const { method, path, body, idempotencyKey, readOnly = false } = request;
  if (method === 'POST' && path === actor.authPath) {
    if (path === '/api/auth/login')
      return (
        actor.index === -1 &&
        (body?.identifier ?? body?.email) === manifest.account.identifier &&
        body?.password === manifest.account.password
      );
    if (path === '/api/auth/logout') return actor.index === -1 && gateOpen && actor.authenticated;
    if (path === '/api/class-join/resolve' || path === '/api/class-join/studentseat')
      return (
        gateOpen &&
        actor.index >= 0 &&
        actor.index < 2 &&
        classCode(body?.code) === classCode(manifest.classroom.code) &&
        (path.endsWith('/resolve') || body?.studentCode === manifest.seats[actor.index].studentCode)
      );
    return false;
  }
  if (!gateOpen || !actor.authenticated) return false;
  if (method === 'POST' && (TELEMETRY.test(path) || path === '/api/auth/refresh')) return true;
  if (readOnly) return false;
  if (method === 'POST' && path === '/api/projects') {
    const editor = actor.createEditor;
    const slot = `${actor.name}:${editor}`;
    return (
      [-1, 0, 1].includes(actor.index) &&
      actor.name === (actor.index === -1 ? 'account' : `seat-${actor.index + 1}`) &&
      PROJECT_SLOTS.has(slot) &&
      budget.projectSlots.has(slot) &&
      !budget.projectRequests.has(slot) &&
      body?.scope === 'personal' &&
      body?.module === MODULE[editor] &&
      (Object.hasOwn(GAME_TITLE, editor)
        ? keys(body, ['scope', 'classroomId', 'module', 'title']) &&
          body.classroomId === null &&
          body.title === GAME_TITLE[editor] &&
          idempotencyKey === `games-entry-v1-${editor}`
        : body?.classroomId == null || body.classroomId === manifest.classroom.id)
    );
  }
  const project = path.match(
    /^\/api\/(?:projects|blocks\/runtime\/projects)\/([a-f0-9-]{36})\/(draft|snapshot|blocks\/runtime-session|assets\/[a-f0-9]{32}\.[a-z0-9]+)$/,
  );
  if (project)
    return (
      budget.projects.get(project[1])?.actor === actor.name &&
      (project[2] === 'blocks/runtime-session' ? method === 'POST' : method === 'PUT')
    );
  if (method === 'POST' && /^\/api\/games\/(chess|checkers)\/lobby$/.test(path))
    return actor.index >= 0 && body?.scope === 'classroom';
  return method === 'POST' && !!actor.gameAccept && path === actor.gameAccept;
}

// Observe the native request unchanged. One admitted POST consumes its arm even
// if the server fails or its response is lost; neither retries nor adoption qualify.
export function observeProjectCreate(manifest, budget, actor, request, gateOpen) {
  requireThat(
    request.method === 'POST' &&
      request.path === '/api/projects' &&
      nativeMutationAllowed(manifest, budget, actor, request, gateOpen),
    'native_create_request',
    'FAIL',
  );
  budget.projectRequests.set(`${actor.name}:${actor.createEditor}`, createRequestHash(request));
  actor.createEditor = null;
}

export async function captureNativeProject(manifest, budget, actor, editor, action) {
  requireThat(
    !actor.creation &&
      !actor.createEditor &&
      budget.projectSlots.has(`${actor.name}:${editor}`) &&
      !budget.projectRequests.has(`${actor.name}:${editor}`),
    'native_create_not_reserved',
  );
  actor.createEditor = editor;
  actor.creation = actor.page
    .waitForResponse((r) => r.url() === ORIGIN + '/api/projects' && r.request().method() === 'POST')
    .then(async (r) => {
      requireThat(r.status() === 201, 'native_create_status', 'FAIL');
      const request = r.request();
      return ownProject(budget, actor.name, editor, await r.json(), manifest.classroom.id, {
        method: request.method(),
        path: new URL(request.url()).pathname,
        body: request.postDataJSON(),
        idempotencyKey: request.headers()['idempotency-key'],
      });
    });
  try {
    const results = await Promise.allSettled([actor.creation, Promise.resolve().then(action)]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    return results[0].value;
  } finally {
    actor.createEditor = null;
    actor.creation = null;
  }
}

export async function projectRequestAllowed(budget, actor, id) {
  if (actor.creation) await actor.creation;
  return budget.projects.get(id)?.actor === actor.name;
}

// Only finite route templates enter the report. Unknown paths, IDs, query strings,
// fragments, headers, bodies and arbitrary exception/console text never do.
export function reportRoute(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return '[invalid-url]';
  }
  if (url.origin !== ORIGIN || url.username || url.password) return '[foreign-origin]';
  const p = url.pathname;
  if (
    [
      '/api/version',
      '/build-metadata.json',
      '/health/ready',
      '/api/auth/me',
      '/api/auth/verification',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/refresh',
      '/api/auth/bot-challenge',
      '/api/class-join/me',
      '/api/class-join/resolve',
      '/api/class-join/studentseat',
      '/api/projects',
    ].includes(p)
  )
    return p;
  if (TELEMETRY.test(p))
    return p.startsWith('/api/analytics/')
      ? '/api/analytics/:endpoint'
      : '/api/diagnostics/:endpoint';
  if (/^\/api\/classrooms\/[^/]+(?:\/roster)?$/.test(p))
    return '/api/classrooms/:classroomId' + (p.endsWith('/roster') ? '/roster' : '');
  const project = p.match(
    /^\/api\/(projects|blocks\/runtime\/projects)\/[^/]+(?:\/(draft|snapshot|blocks\/runtime-session|assets\/[^/]+))?$/,
  );
  if (project)
    return (
      `/api/${project[1]}/:projectId` +
      (project[2] ? '/' + (project[2].startsWith('assets/') ? 'assets/:asset' : project[2]) : '')
    );
  const game = p.match(
    /^\/api\/games\/(chess|checkers)\/(access|notifications|lobby|players\/[^/]+\/challenge|invites\/[^/]+\/accept|matches\/[^/]+(?:\/commands)?)$/,
  );
  if (game)
    return (
      `/api/games/${game[1]}/` + game[2].replace(/\/(?!commands$|challenge$|accept$)[^/]+/, '/:id')
    );
  return '[other-same-origin]';
}

export function httpEvidence(method, rawUrl, status, requestId, injected = false) {
  return {
    method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)
      ? method
      : 'OTHER',
    route: reportRoute(rawUrl),
    status: Number.isInteger(status) && status >= 0 && status <= 599 ? status : 0,
    ...(typeof requestId === 'string' && UUID.test(requestId) ? { requestId } : {}),
    injected,
  };
}

export async function withOffline(context, edit, wait = (milliseconds) => delay(milliseconds)) {
  const evidence = { offlineAppliedAt: null, onlineAcknowledgedAt: null, observedOfflineMs: null };
  try {
    await context.setOffline(true);
    evidence.offlineAppliedAt = Date.now();
    // Restoration runs at ten seconds even if the native action is still waiting.
    const results = await Promise.allSettled([
      Promise.resolve().then(edit),
      wait(10_000).then(async () => {
        await context.setOffline(false);
        evidence.onlineAcknowledgedAt = Date.now();
        evidence.observedOfflineMs = evidence.onlineAcknowledgedAt - evidence.offlineAppliedAt;
      }),
    ]);
    const failure = results.find((r) => r.status === 'rejected');
    if (failure) throw failure.reason;
  } finally {
    await context.setOffline(false);
  }
  return evidence;
}

export async function withTelemetryFault(context, action, injectedRequests = new WeakSet()) {
  let injected = 0;
  const handler = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === ORIGIN && request.method() === 'POST' && TELEMETRY.test(url.pathname)) {
      injectedRequests.add(request);
      injected++;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":{"code":"acceptance_fault"}}',
      });
    } else await route.fallback();
  };
  try {
    await context.route(TELEMETRY_ROUTE, handler);
    await action();
    requireThat(injected > 0, 'telemetry_fault_not_observed');
    return { injected503: injected };
  } finally {
    await context.unroute(TELEMETRY_ROUTE, handler);
  }
}

export async function closeOwnedContexts(contexts) {
  let failed = false;
  for (const context of [...contexts].reverse()) {
    try {
      await context.setOffline(false);
    } catch {
      failed = true;
    }
    try {
      await context.close();
    } catch {
      failed = true;
    }
  }
  requireThat(!failed, 'context_cleanup_failed', 'FAIL');
}

export function initialReport(manifest) {
  const runId = randomUUID();
  return {
    schemaVersion: 1,
    runId,
    origin: ORIGIN,
    expectedRevision: manifest.expectedRevision,
    expectedSchemaVersion: manifest.expectedSchemaVersion,
    status: 'NOT_RUN',
    capacityClaim: false,
    actors: [manifest.account.id, ...manifest.seats.map((s) => s.id)].map((id) =>
      digest([runId, id]),
    ),
    classroom: digest([runId, manifest.classroom.id]),
    operations: STEPS.map((name) => ({ name, status: 'NOT_RUN' })),
    http: [],
    droppedHttpRecords: 0,
    javascriptErrors: 0,
    consoleErrors: 0,
    browserCrashes: 0,
    networkFailures: 0,
    unexpectedNetworkFailures: 0,
    unexpectedHttp: 0,
    serverRestarts: 'NOT_OBSERVABLE',
    scratchImageRevision: 'NOT_OBSERVABLE',
    projects: [],
    matches: [],
    retainedData: true,
  };
}

// This is the only entry into Playwright. Importing/validating the module never
// launches a browser, reads cookies, connects a device or contacts the application.
async function runAcceptance(manifest, report, persist = async () => {}) {
  let chromium, expect;
  try {
    ({ chromium, expect } = await import('@playwright/test'));
  } catch {
    report.status = 'BLOCKED';
    report.code = 'playwright_runtime_unavailable';
    await persist();
    return report;
  }
  const contexts = [],
    actors = [],
    budget = createBudget(),
    injected = new WeakSet(),
    readonlyPages = new WeakSet();
  const offlineRequests = new WeakSet();
  let browser,
    gateOpen = false,
    routeViolation = false,
    closing = false,
    currentStep = 'NOT_RUN';
  const phase = async (name, action) => {
    currentStep = name;
    const operation = report.operations.find((o) => o.name === name);
    operation.startedAt = new Date().toISOString();
    try {
      operation.evidence = await action();
      requireThat(name === 'cleanup' || !routeViolation, 'unplanned_browser_request');
      operation.status = 'PASS';
    } catch (error) {
      operation.status = error instanceof Refusal ? error.status : 'FAIL';
      operation.code = error instanceof Refusal ? error.code : 'native_ui_or_transport_failure';
      throw error;
    } finally {
      operation.finishedAt = new Date().toISOString();
      await persist();
    }
  };
  const recordHttp = (entry, actor) => {
    if (entry.status >= 400 && !entry.injected) report.unexpectedHttp++;
    if (report.http.length < 1200)
      report.http.push({
        ...entry,
        actor,
        operation: currentStep,
        observedAt: new Date().toISOString(),
      });
    else report.droppedHttpRecords++;
  };
  const call = async (actor, path, method = 'GET', data = undefined, expectedStatus = 200) => {
    requireThat(
      path.startsWith('/') && !path.startsWith('//') && !path.includes('?') && !path.includes('#'),
      'unplanned_api_path',
    );
    const response = await actor.context.request.fetch(ORIGIN + path, {
      method,
      timeout: 20_000,
      maxRedirects: 0,
      headers: {
        origin: ORIGIN,
        ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
      },
      ...(data === undefined ? {} : { data }),
    });
    try {
      recordHttp(
        httpEvidence(method, response.url(), response.status(), response.headers()['x-request-id']),
        actor.name,
      );
      requireThat(
        response.url() === ORIGIN + path && response.status() === expectedStatus,
        'api_status_or_redirect',
        response.status() >= 500 ? 'FAIL' : 'BLOCKED',
      );
      return await response.json();
    } finally {
      await response.dispose();
    }
  };
  const revision = async () => {
    const actor = actors[0];
    const version = await call(actor, '/api/version');
    const web = await call(actor, '/build-metadata.json');
    const readiness = await call(actor, '/health/ready');
    assertRevision(manifest, version, web, readiness);
    return {
      apiRevision: version.revision,
      webRevision: web.revision,
      schemaVersion: version.schemaVersion,
    };
  };
  const accountIdentity = async () =>
    assertAccount(
      manifest,
      await call(actors[0], '/api/auth/me'),
      await call(actors[0], '/api/auth/verification'),
    );
  const ownedClass = async () => {
    await accountIdentity();
    assertClassroom(
      manifest,
      await call(actors[0], `/api/classrooms/${manifest.classroom.id}`),
      await call(actors[0], `/api/classrooms/${manifest.classroom.id}/roster`),
    );
  };
  const identity = async (actor) =>
    actor.index === -1
      ? accountIdentity()
      : assertSeat(manifest, actor.index, await call(actor, '/api/class-join/me'));
  const beforeWrite = async (actor) => {
    requireThat(gateOpen && !routeViolation, 'ownership_gate_closed');
    await revision();
    await ownedClass();
    await identity(actor);
  };
  const isOwnedProject = (actor, id) => budget.projects.get(id)?.actor === actor.name;
  const resetProof = (actor) => {
    actor.proofReady = new Promise((done) => {
      actor.releaseProof = done;
    });
  };
  const newActor = async (name, index) => {
    const context = await browser.newContext({
      baseURL: ORIGIN,
      locale: 'en-US',
      viewport: { width: 1366, height: 900 },
      serviceWorkers: 'allow',
      ignoreHTTPSErrors: false,
    });
    contexts.push(context);
    const actor = {
      name,
      index,
      context,
      page: null,
      authenticated: false,
      authPath: '',
      creation: null,
      createEditor: null,
      gameAccept: '',
      offlineActive: false,
      navigating: false,
    };
    actors.push(actor);
    resetProof(actor);
    await context.route('**/*', async (route) => {
      try {
        const request = route.request(),
          url = new URL(request.url()),
          method = request.method();
        let allowed = url.origin === ORIGIN && !url.username && !url.password;
        const resource = url.pathname.match(
          /^\/api\/(?:projects|blocks\/runtime\/projects)\/([a-f0-9-]{36})(?:\/|$)/,
        );
        if (allowed && resource) {
          allowed = await projectRequestAllowed(budget, actor, resource[1]);
        }
        if (allowed && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
          const p = url.pathname;
          if (method === 'POST' && TELEMETRY.test(p)) {
            // Native startup telemetry waits for the same identity/ownership proof;
            // a blocked login releases it only during context closure, without sending.
            await actor.proofReady;
            if (!gateOpen || !actor.authenticated) {
              await route.abort('blockedbyclient');
              return;
            }
          }
          let page, body;
          try {
            page = request.frame().page();
          } catch {
            /* A worker has no frame. */
          }
          try {
            body = request.postDataJSON();
          } catch {
            /* Native snapshots/assets are binary. */
          }
          const mutation = {
            method,
            path: p,
            body,
            readOnly: readonlyPages.has(page),
            idempotencyKey: request.headers()['idempotency-key'],
          };
          allowed = nativeMutationAllowed(manifest, budget, actor, mutation, gateOpen);
          if (allowed && p === '/api/projects')
            observeProjectCreate(manifest, budget, actor, mutation, gateOpen);
          if (allowed && p === actor.gameAccept) actor.gameAccept = '';
        }
        if (allowed) await route.continue();
        else {
          routeViolation = true;
          await route.abort('blockedbyclient');
        }
      } catch {
        if (!closing) routeViolation = true;
        await route.abort('blockedbyclient').catch(() => {});
      }
    });
    context.on('page', (page) => {
      page.setDefaultTimeout(25_000);
      page.on('pageerror', () => report.javascriptErrors++);
      page.on('console', (message) => {
        if (message.type() === 'error') report.consoleErrors++;
      });
      page.on('crash', () => report.browserCrashes++);
      page.on('request', (request) => {
        if (actor.offlineActive) offlineRequests.add(request);
      });
      page.on('requestfailed', (request) => {
        report.networkFailures++;
        const navigationAbort =
          actor.navigating && request.failure()?.errorText === 'net::ERR_ABORTED';
        if (
          !closing &&
          gateOpen &&
          !actor.offlineActive &&
          !offlineRequests.has(request) &&
          !navigationAbort
        )
          report.unexpectedNetworkFailures++;
      });
      page.on('response', (response) =>
        recordHttp(
          httpEvidence(
            response.request().method(),
            response.url(),
            response.status(),
            response.headers()['x-request-id'],
            injected.has(response.request()),
          ),
          actor.name,
        ),
      );
    });
    actor.page = await context.newPage();
    return actor;
  };
  const navigate = async (page, fragment) => {
    requireThat(
      ['/sign-in', '/join-class', '/home', '/learning', '/projects', '/games'].includes(fragment),
      'unplanned_navigation',
    );
    const actor = actors.find((a) => a.context === page.context());
    actor.navigating = true;
    try {
      await page.goto(ORIGIN + '/#' + fragment, { waitUntil: 'domcontentloaded' });
    } finally {
      actor.navigating = false;
    }
    requireThat(new URL(page.url()).origin === ORIGIN, 'page_origin_changed');
  };
  const reload = async (actor, page = actor.page) => {
    actor.navigating = true;
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
    } finally {
      actor.navigating = false;
    }
  };
  const loginAccount = async () => {
    const actor = actors[0],
      page = actor.page;
    actor.authPath = '/api/auth/login';
    await navigate(page, '/sign-in');
    await page.getByLabel('Почта или логин', { exact: true }).fill(manifest.account.identifier);
    await page.getByLabel('Пароль', { exact: true }).fill(manifest.account.password);
    const bot = page.getByRole('checkbox', { name: 'Я не робот', exact: true });
    if (await bot.count()) {
      assertBotClickAuthorized(manifest);
      await bot.click();
      try {
        await expect(bot).toBeChecked({ timeout: 30_000 });
      } catch {
        throw new Refusal('bot_check_handoff');
      }
    }
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('main', { name: 'Главная', exact: true })).toBeVisible();
    actor.authPath = '';
    await accountIdentity();
    actor.authenticated = true;
  };
  const emptyProjects = async (actor) => {
    const result = await call(actor, '/api/projects');
    requireThat(
      Array.isArray(result.items) && result.items.length === 0 && !result.nextCursor,
      'preexisting_projects_handoff',
    );
  };
  const ready = async (actor, editor) => {
    if (editor === 'electronics') {
      await expect(actor.page.locator('.workbench-stage')).toBeVisible({ timeout: 60_000 });
      await expect(
        actor.page.getByRole('button', { name: 'Сохранить проект', exact: true }),
      ).toBeVisible();
    } else {
      const iframe = actor.page.locator('iframe[title="Scratch runtime"]');
      await expect(iframe).toBeVisible({ timeout: 60_000 });
      const url = new URL(await iframe.getAttribute('src'), ORIGIN);
      requireThat(
        url.origin === ORIGIN && url.pathname.startsWith('/internal/blocks/'),
        'scratch_origin_mismatch',
      );
      const frame = actor.page.frameLocator('iframe[title="Scratch runtime"]');
      await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
        'data-editor-state',
        'ready',
        { timeout: 90_000 },
      );
      await expect(
        frame.getByRole('button', { name: /^(Choose a Sprite|Выбрать спрайт)$/ }).first(),
      ).toBeVisible();
    }
  };
  const readDraft = async (actor, item, previous = null, changed = false) => {
    requireThat(isOwnedProject(actor, item.id), 'foreign_project');
    await identity(actor);
    item.proof = assertDraft(
      manifest,
      item,
      await call(actor, `/api/projects/${item.id}`),
      previous,
      changed,
    );
    return item.proof;
  };
  const resistance = async (actor, item) => {
    await actor.page
      .locator(
        `[data-testid="schematic-component"][data-component-id="${item.componentId}"] .workbench-part`,
      )
      .press('Enter');
    return actor.page
      .locator('.workbench-inspector label')
      .filter({ hasText: 'Сопротивление' })
      .locator('input[type="number"]');
  };
  const edit = async (actor, item, step, previousExpected) => {
    const page = actor.page;
    if (item.editor === 'electronics') {
      if (step === 1) {
        const card = page.getByRole('button', { name: 'Резистор', exact: true });
        const from = await card.boundingBox(),
          field = await page.locator('.workbench-stage').boundingBox();
        requireThat(from && field, 'native_editor_geometry', 'FAIL');
        const x = from.x + from.width / 2,
          y = from.y + from.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x - 4, y, { steps: 2 });
        await expect(page.locator('.workbench-picked-up')).toHaveCount(1);
        await page.mouse.move(field.x + field.width * 0.45, field.y + field.height * 0.55, {
          steps: 12,
        });
        await expect(page.getByTestId('catalog-placement-preview')).toHaveCount(1);
        await page.mouse.up();
        const part = page.locator(
          '[data-testid="schematic-component"][data-component-type="resistor-axial"]',
        );
        await expect(part).toHaveCount(1);
        item.componentId = await part.getAttribute('data-component-id');
        requireThat(/^[A-Za-z0-9_-]{1,64}$/.test(item.componentId), 'component_identifier', 'FAIL');
      }
      const value = 1000 + (actor.index + 1) * 10 + step;
      item.expected = {
        moduleKey: 'electronics',
        componentId: item.componentId,
        componentTypeId: 'resistor-axial',
        resistanceOhms: value,
        matchingComponents: 1,
      };
      const input = await resistance(actor, item);
      await input.fill(String(value));
      await input.press('Enter');
      await expect(input).toHaveValue(String(value));
    } else {
      const frame = page.frameLocator('iframe[title="Scratch runtime"]');
      if (step === 1) {
        await frame
          .getByRole('button', { name: /^(Choose a Sprite|Выбрать спрайт)$/ })
          .first()
          .click();
        await frame.getByText('Apple', { exact: true }).click();
        await expect(frame.getByPlaceholder(/^(Name|Имя)$/)).toHaveValue('Apple');
      } else
        await frame.getByRole('button', { name: previousExpected.spriteName, exact: true }).click();
      const name = `Acceptance-${actor.index + 1}-${step}`,
        x = 20 + step;
      item.expected = {
        moduleKey: 'blocks',
        spriteName: name,
        matchingSprites: 1,
        x,
        y: 0,
        stageCount: 1,
        storedCostumeReferences: true,
      };
      for (const [input, value] of [
        [frame.getByPlaceholder(/^(Name|Имя)$/), name],
        [frame.getByPlaceholder('x', { exact: true }), String(x)],
        [frame.getByPlaceholder('y', { exact: true }), '0'],
      ]) {
        await input.fill(value);
        await input.press('Enter');
        await expect(input).toHaveValue(value);
      }
    }
  };
  const visible = async (actor, item) => {
    if (item.editor === 'electronics')
      await expect(await resistance(actor, item)).toHaveValue(String(item.expected.resistanceOhms));
    else {
      const frame = actor.page.frameLocator('iframe[title="Scratch runtime"]');
      const sprite = frame.getByRole('button', { name: item.expected.spriteName, exact: true });
      await sprite.click();
      await expect(frame.getByPlaceholder(/^(Name|Имя)$/)).toHaveValue(item.expected.spriteName);
      await expect(frame.getByPlaceholder('x', { exact: true })).toHaveValue(
        String(item.expected.x),
      );
      await expect(frame.getByPlaceholder('y', { exact: true })).toHaveValue('0');
      await expect
        .poll(() =>
          sprite
            .locator('img')
            .first()
            .evaluate((img) => img.complete && img.naturalWidth > 0),
        )
        .toBe(true);
    }
  };
  const save = async (actor, item, step, offline = false) => {
    await beforeWrite(actor);
    const previous = item.proof;
    const previousExpected = item.expected;
    item.expected = null; // an in-flight ACK for the preceding generation cannot qualify
    const ack = actor.page.waitForResponse(
      (response) => {
        const r = response.request();
        if (
          r.method() !== 'PUT' ||
          ![
            `/api/projects/${item.id}/draft`,
            `/api/blocks/runtime/projects/${item.id}/draft`,
          ].includes(new URL(r.url()).pathname)
        )
          return false;
        try {
          return (
            item.expected &&
            digest(projectProjection(item.editor, r.postDataJSON().document, item.expected)) ===
              digest(item.expected)
          );
        } catch {
          return false;
        }
      },
      { timeout: 150_000 },
    );
    const action = async () => {
      await edit(actor, item, step, previousExpected);
      if (item.editor === 'electronics')
        await actor.page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
      // Scratch waits for its real upstream minute autosave. No private VM,
      // React state, timers, save callback or synthetic postMessage is used.
    };
    const offlineContext = {
      setOffline: async (enabled) => {
        if (enabled) actor.offlineActive = true;
        await actor.context.setOffline(enabled);
        if (!enabled) actor.offlineActive = false;
      },
    };
    const results = await Promise.allSettled([
      ack,
      offline ? withOffline(offlineContext, action) : action(),
    ]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    const response = results[0].value;
    requireThat(
      response.status() === 200 && !(await response.finished()),
      'native_save_ack',
      'FAIL',
    );
    const proof = await readDraft(actor, item, previous, true);
    await visible(actor, item);
    if (offline) {
      const fault = results[1].value;
      requireThat(
        fault.observedOfflineMs >= 10_000 && fault.observedOfflineMs <= 15_000,
        'offline_window_not_bounded',
        'FAIL',
      );
      return { ...proof, fault };
    }
    return proof;
  };
  const reopen = async (actor, item) => {
    const previous = item.proof;
    await reload(actor);
    await ready(actor, item.editor);
    await visible(actor, item);
    return readDraft(actor, item, previous, false);
  };
  const projectJourney = async (actor, editor) => {
    await beforeWrite(actor);
    reserveProject(budget, actor.name, editor);
    await navigate(actor.page, '/projects');
    await expect(
      actor.page.getByRole('heading', { name: 'Мои проекты', exact: true }),
    ).toBeVisible();
    const menu = actor.page.locator('.portal-header .portal-quick-create');
    await menu.locator('summary').click();
    const item = await captureNativeProject(manifest, budget, actor, editor, () =>
      menu
        .getByRole('button', {
          name: editor === 'electronics' ? /Электрическая цепь/ : /Программа Scratch/,
        })
        .click(),
    );
    await ready(actor, editor);
    await readDraft(actor, item);
    const saved = await save(actor, item, 1);
    const reopened = await reopen(actor, item);
    return { project: digest([report.runId, item.id]), saved, reopened };
  };
  const gameJourney = async (game) => {
    const sender = actors[1],
      receiver = actors[2];
    await beforeWrite(sender);
    await beforeWrite(receiver);
    reserveGame(budget, game);
    reserveProject(budget, receiver.name, game);
    for (const actor of [sender, receiver]) await navigate(actor.page, '/games');
    const players = [];
    for (const actor of [sender, receiver]) {
      await identity(actor);
      const access = await call(actor, `/api/games/${game}/access`);
      requireThat(
        access.allowed === true &&
          access.scopes?.includes('classroom') &&
          uuid(access.player?.playerId),
        'game_access_unprepared',
      );
      players.push(access.player.playerId);
    }
    requireThat(players[0] !== players[1], 'game_player_identity');
    await beforeWrite(sender);
    const result = await call(
      sender,
      `/api/games/${game}/players/${players[1]}/challenge`,
      'POST',
      { scope: 'classroom', initialMs: 600000, incrementMs: 0, colorPreference: 'white' },
      201,
    );
    const invite = result?.invite;
    requireThat(
      uuid(invite?.id) &&
        /^[A-Za-z0-9-]{4,80}$/.test(invite?.code) &&
        invite?.scope === 'classroom' &&
        invite?.status === 'open',
      'game_invite_identity',
      'FAIL',
    );
    budget.invites.set(game, invite.id);
    const notification = receiver.page.getByRole('button', {
      name: `Посмотреть приглашения: ${game === 'chess' ? 'Шахматы' : 'Шашки'}`,
      exact: true,
    });
    await expect(notification).toContainText('Вас приглашают играть', { timeout: 25_000 });
    await beforeWrite(receiver);
    const gameSave = await captureNativeProject(manifest, budget, receiver, game, () =>
      notification.click(),
    );
    await readDraft(receiver, gameSave);
    const incoming = receiver.page
      .getByRole('region', { name: 'Входящие вызовы' })
      .locator(`article[data-invite-id="${invite.id}"]`);
    await expect(incoming).toBeVisible();
    await beforeWrite(receiver);
    receiver.gameAccept = `/api/games/${game}/invites/${invite.code}/accept`;
    const [accepted] = await Promise.all([
      receiver.page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `/api/games/${game}/invites/${invite.code}/accept` &&
          r.request().method() === 'POST',
      ),
      incoming.getByRole('button', { name: 'Принять вызов', exact: true }).click(),
    ]);
    requireThat(accepted.status() === 201, 'native_game_accept', 'FAIL');
    const match = (await accepted.json())?.match;
    requireThat(uuid(match?.id), 'match_identity', 'FAIL');
    const verifyMatch = (m) =>
      requireThat(
        m?.id === match.id &&
          m?.scope === 'classroom' &&
          new Set([m?.white?.playerId, m?.black?.playerId]).size === 2 &&
          [m?.white?.playerId, m?.black?.playerId].every((id) => players.includes(id)) &&
          Number.isSafeInteger(m?.version),
        'match_participants',
        'FAIL',
      );
    verifyMatch(match);
    budget.matches.set(game, match.id);
    if (game === 'chess') await expect(receiver.page.getByTestId('asa-chess-board')).toBeVisible();
    else
      await expect(
        receiver.page.getByRole('grid', { name: 'Доска для русских шашек, 8 на 8' }),
      ).toBeVisible();
    const read = await call(receiver, `/api/games/${game}/matches/${match.id}`);
    verifyMatch(read?.match);
    await beforeWrite(sender);
    await call(
      sender,
      `/api/games/${game}/matches/${match.id}/commands`,
      'POST',
      { expectedVersion: read.match.version, action: 'resign' },
      201,
    );
    const finished = await call(receiver, `/api/games/${game}/matches/${match.id}`);
    verifyMatch(finished?.match);
    requireThat(
      finished.match.status === 'finished' && finished.match.version > read.match.version,
      'match_finish_readback',
      'FAIL',
    );
    const saved = await readDraft(receiver, gameSave, gameSave.proof, false);
    return {
      project: digest([report.runId, gameSave.id]),
      saved,
      invite: digest([report.runId, invite.id]),
      match: digest([report.runId, match.id]),
      nativeNotificationAndAccept: true,
      exactParticipants: true,
    };
  };
  try {
    try {
      browser = await chromium.launch({ headless: false });
    } catch {
      throw new Refusal('browser_runtime_unavailable');
    }
    const account = await newActor('account', -1);
    await phase('revision', revision);
    await phase('account-login', loginAccount);
    await phase('owned-classroom', async () => {
      await ownedClass();
      await emptyProjects(account);
      gateOpen = true;
      account.releaseProof();
    });
    await phase('account-reload', async () => {
      await reload(account);
      await accountIdentity();
    });
    for (let i = 0; i < 2; i++)
      await phase(`seat-${i + 1}-login`, async () => {
        const actor = await newActor(`seat-${i + 1}`, i);
        await ownedClass();
        await navigate(actor.page, '/join-class');
        actor.authPath = '/api/class-join/resolve';
        await actor.page.getByLabel('Код класса', { exact: true }).fill(manifest.classroom.code);
        const [resolved] = await Promise.all([
          actor.page.waitForResponse(
            (r) =>
              new URL(r.url()).pathname === '/api/class-join/resolve' &&
              r.request().method() === 'POST',
          ),
          actor.page.getByRole('button', { name: 'Продолжить', exact: true }).click(),
        ]);
        const found = (await resolved.json())?.classroom;
        requireThat(
          resolved.status() === 200 &&
            found?.id === manifest.classroom.id &&
            found?.title === manifest.testMarker,
          'class_code_resolved_foreign_class',
        );
        actor.authPath = '/api/class-join/studentseat';
        await actor.page
          .getByLabel('Код ученика', { exact: true })
          .fill(manifest.seats[i].studentCode);
        await actor.page.getByRole('button', { name: 'Войти', exact: true }).click();
        await expect(actor.page.getByRole('main', { name: 'Главная', exact: true })).toBeVisible();
        actor.authPath = '';
        await identity(actor);
        actor.authenticated = true;
        await emptyProjects(actor);
        actor.releaseProof();
      });
    await phase('my-learning', async () => {
      // Existing Account and Seat 2 pages, no new context/tab and no enrollment.
      for (const actor of [account, actors[2]]) {
        const page = actor.page;
        await identity(actor);
        readonlyPages.add(page);
        try {
          await navigate(page, '/learning');
          const workspace = page.locator('.learning-workspace');
          await expect(
            workspace.getByRole('heading', { name: 'Моё обучение', exact: true }),
          ).toBeVisible();
          await expect(workspace.locator('.learning-overview-metrics strong')).toHaveText([
            /^\d+$/,
            /^\d+$/,
            /^\d+$/,
          ]);
          await expect(workspace.getByRole('alert')).toHaveCount(0);
          const courses = workspace
            .getByRole('navigation', { name: 'Разделы моего обучения', exact: true })
            .getByRole('link', { name: 'Курсы', exact: true });
          await expect(courses).toHaveAttribute('href', '#/learning?view=courses');
          await courses.click();
          await expect(courses).toHaveAttribute('aria-current', 'page');
          await expect(
            workspace
              .getByText('Курсы пока не назначены.', { exact: true })
              .or(workspace.getByTestId('seat-courses')),
          ).toBeVisible();
          await expect(workspace.getByRole('alert')).toHaveCount(0);
          requireThat(
            new URL(page.url()).hash === '#/learning?view=courses',
            'learning_route_changed',
            'FAIL',
          );
          await identity(actor);
        } finally {
          readonlyPages.delete(page);
        }
      }
      return { actors: ['account', 'seat-2'], overviewLoaded: true, coursesListLoaded: true };
    });
    await phase('account-project', () => projectJourney(account, 'electronics'));
    for (const editor of ['electronics', 'scratch'])
      await phase(`seat-1-${editor}`, () => projectJourney(actors[1], editor));
    const scratchActor = actors[1];
    const scratch = [...budget.projects.values()].find(
      (p) => p.actor === scratchActor.name && p.editor === 'scratch',
    );
    await phase('telemetry-503', async () => {
      await beforeWrite(scratchActor);
      return withTelemetryFault(
        scratchActor.context,
        async () => {
          await save(scratchActor, scratch, 2);
          await reopen(scratchActor, scratch);
        },
        injected,
      );
    });
    await phase('offline-10s', async () => {
      const proof = await save(scratchActor, scratch, 3, true);
      return {
        requestedOfflineMs: 10_000,
        saved: proof,
        reopened: await reopen(scratchActor, scratch),
      };
    });
    await phase('readonly-tabs', async () => {
      for (const actor of actors.slice(1)) {
        const page = await actor.context.newPage();
        readonlyPages.add(page);
        try {
          await navigate(page, '/home');
          await identity(actor);
          await reload(actor, page);
          await identity(actor);
        } finally {
          await page.close();
        }
      }
      return { tabs: 2 };
    });
    for (const game of ['chess', 'checkers']) await phase(game, () => gameJourney(game));
    await phase('account-logout-login', async () => {
      await beforeWrite(account);
      await navigate(account.page, '/home');
      resetProof(account);
      await account.page
        .getByRole('button', { name: `Меню аккаунта ${manifest.account.displayName}`, exact: true })
        .click();
      account.authPath = '/api/auth/logout';
      const [loggedOut] = await Promise.all([
        account.page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/logout'),
        account.page.getByRole('button', { name: 'Выход', exact: true }).click(),
      ]);
      requireThat(loggedOut.status() === 200, 'logout_status', 'FAIL');
      account.authenticated = false;
      account.authPath = '';
      requireThat(
        (await call(account, '/api/auth/me')).authenticated === false,
        'logout_identity',
        'FAIL',
      );
      await loginAccount();
      await ownedClass();
      account.releaseProof();
    });
    await phase('final-readback', async () => {
      await revision();
      await ownedClass();
      requireThat(
        budget.projectAttempts === 5 &&
          budget.projects.size === 5 &&
          budget.gameAttempts.size === 2 &&
          budget.matches.size === 2,
        'incomplete_resource_plan',
        'FAIL',
      );
      for (const item of budget.projects.values())
        await readDraft(
          actors.find((a) => a.name === item.actor),
          item,
          item.proof,
          false,
        );
      requireThat(
        report.javascriptErrors === 0 &&
          report.browserCrashes === 0 &&
          report.unexpectedNetworkFailures === 0,
        'unexpected_javascript_crash_or_network',
        'FAIL',
      );
      requireThat(report.unexpectedHttp === 0, 'unexpected_http', 'FAIL');
      requireThat(report.droppedHttpRecords === 0, 'http_evidence_limit');
      return { projects: budget.projects.size, games: budget.matches.size };
    });
  } catch (error) {
    report.status = error instanceof Refusal ? error.status : 'FAIL';
    report.code = error instanceof Refusal ? error.code : 'native_ui_or_transport_failure';
  } finally {
    gateOpen = false;
    closing = true;
    for (const actor of actors) actor.releaseProof();
    try {
      await phase('cleanup', async () => {
        try {
          await closeOwnedContexts(contexts);
        } finally {
          if (browser) await browser.close();
        }
      });
    } catch {
      report.status = 'FAIL';
      report.code = 'context_cleanup_failed';
    }
    report.projects = [...budget.projects.values()].map((p) => ({
      id: digest([report.runId, p.id]),
      actor: p.actor,
      editor: p.editor,
      proof: p.proof,
    }));
    report.matches = [...budget.matches].map(([game, id]) => ({
      game,
      id: digest([report.runId, id]),
    }));
    if (report.operations.every((o) => o.status === 'PASS')) report.status = 'PASS';
    await persist();
  }
  return report;
}

export async function main(args, env = process.env) {
  let manifestPath,
    reportPath,
    run = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--manifest' && !manifestPath) manifestPath = args[++i];
    else if (args[i] === '--report' && !reportPath) reportPath = args[++i];
    else if (args[i] === '--run' && !run) run = true;
    else throw new Refusal('cli_arguments');
  }
  requireThat(
    text(manifestPath, 4096) &&
      text(reportPath, 4096) &&
      resolve(manifestPath) !== resolve(reportPath),
    'cli_paths',
  );
  assertEnvironment(env);
  const stat = await lstat(manifestPath);
  requireThat(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.size <= 16_384 &&
      (process.platform === 'win32' || (stat.mode & 0o077) === 0),
    'manifest_file_not_private',
  );
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  const report = initialReport(manifest);
  // Reserve a new private report before the first browser/network operation.
  const output = await open(reportPath, 'wx', 0o600);
  const persist = async () => {
    const bytes = JSON.stringify(report, null, 2) + '\n';
    await output.truncate(0);
    await output.write(bytes, 0, 'utf8');
    await output.sync();
  };
  try {
    await persist();
    if (run) await runAcceptance(manifest, report, persist);
  } finally {
    await output.close();
  }
  process.stdout.write(
    JSON.stringify({
      status: report.status,
      operations: report.operations.map(({ name, status }) => ({ name, status })),
    }) + '\n',
  );
  return report.status === 'FAIL' ? 1 : report.status === 'BLOCKED' ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(
        JSON.stringify({
          status: 'BLOCKED',
          code: error instanceof Refusal ? error.code : 'local_input_or_output_failure',
        }) + '\n',
      );
      process.exitCode = 2;
    });
}
