import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ORIGIN,
  Refusal,
  assertAccount,
  assertBotClickAuthorized,
  assertClassroom,
  assertDraft,
  assertEnvironment,
  assertRevision,
  assertSeat,
  captureNativeProject,
  closeOwnedContexts,
  createBudget,
  digest,
  httpEvidence,
  initialReport,
  main,
  nativeMutationAllowed,
  observeProjectCreate,
  ownProject,
  projectProjection,
  projectRequestAllowed,
  reportRoute,
  reserveGame,
  reserveProject,
  validateManifest,
  withOffline,
  withTelemetryFault,
} from '../../tools/capacity/public-user-acceptance.mjs';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fixture = () => ({
  schemaVersion: 1,
  origin: ORIGIN,
  expectedRevision: 'a'.repeat(40),
  expectedSchemaVersion: 304,
  testMarker: 'ASA-PUBLIC-TEST-unit-123456',
  account: {
    id: id(1),
    workspaceId: id(2),
    displayName: 'ASA-PUBLIC-TEST-unit-123456 Account',
    identifier: 'synthetic@example.invalid',
    password: 'Unit-only-private-secret',
  },
  classroom: { id: id(3), title: 'ASA-PUBLIC-TEST-unit-123456', code: 'ABC DEF 234' },
  seats: [1, 2].map((n) => ({
    id: id(n + 3),
    displayLabel: `ASA-PUBLIC-TEST-unit-123456 Seat ${n}`,
    studentCode: `Abc${n}`,
  })),
});
const session = () => ({
  authenticated: true,
  account: { ...fixture().account, identityKind: 'account' },
  user: { id: id(1) },
  verification: { required: false },
  timeZone: 'Europe/Moscow',
  activeWorkspace: { workspaceId: id(2), kind: 'personal' },
  workspaces: [{ workspaceId: id(2), kind: 'personal' }],
});
const classroom = () => ({
  classroom: {
    id: id(3),
    title: fixture().testMarker,
    teacherRole: 'owner',
    workspaceKind: 'personal',
    status: 'active',
    safeModeDefault: true,
    studentCount: 2,
    joinCodeStatus: 'active',
    joinCode: 'ABC DEF 234',
  },
});
const roster = () => ({
  items: fixture().seats.map((s) => ({ ...s, safeMode: true, status: 'issued' })),
});
const seat = (i = 0) => ({
  authenticated: true,
  student: {
    seatId: fixture().seats[i]!.id,
    displayName: fixture().seats[i]!.displayLabel,
    safeMode: true,
  },
  classroom: { id: id(3), title: fixture().testMarker },
});
const actor = () => ({
  name: 'seat-1',
  index: 0,
  authenticated: true,
  authPath: '',
  createEditor: 'electronics',
  gameAccept: '',
});
const projectReceipt = (n = 10, module = 'electronics') => ({
  created: true,
  project: { id: id(n), scope: 'personal', moduleKey: module, classroomId: null },
});

type Game = 'chess' | 'checkers';
type CreateRequest = {
  method: string;
  path: string;
  body: Record<string, unknown>;
  idempotencyKey: string;
  readOnly?: boolean;
};
const gameTitle = (game: Game) => (game === 'chess' ? 'Шахматы' : 'Шашки');
const gameRequest = (game: Game): CreateRequest => ({
  method: 'POST',
  path: '/api/projects',
  body: { scope: 'personal', classroomId: null, module: game, title: gameTitle(game) },
  idempotencyKey: `games-entry-v1-${game}`,
});
const gameReceipt = (game: Game, n = 50) => ({
  created: true,
  project: { ...projectReceipt(n, game).project, status: 'active', title: gameTitle(game) },
});
const gameActor = () => ({
  ...actor(),
  name: 'seat-2',
  index: 1,
  createEditor: null as string | null,
  creation: null as Promise<unknown> | null,
});

type NativeResponse = {
  url: () => string;
  status: () => number;
  request: () => {
    url: () => string;
    method: () => string;
    postDataJSON: () => Record<string, unknown>;
    headers: () => Record<string, string>;
  };
  json: () => Promise<unknown>;
};
function responseWaiter() {
  let pending: {
    predicate: (response: NativeResponse) => boolean;
    resolve: (response: NativeResponse) => void;
    reject: (error: Error) => void;
  } | null = null;
  return {
    page: {
      waitForResponse: (predicate: (response: NativeResponse) => boolean) =>
        new Promise<NativeResponse>((resolve, reject) => {
          pending = { predicate, resolve, reject };
        }),
    },
    emit: (request: CreateRequest, receipt: unknown, status = 201) => {
      const response: NativeResponse = {
        url: () => ORIGIN + request.path,
        status: () => status,
        request: () => ({
          url: () => ORIGIN + request.path,
          method: () => request.method,
          postDataJSON: () => request.body,
          headers: () => ({ 'idempotency-key': request.idempotencyKey }),
        }),
        json: async () => receipt,
      };
      expect(pending?.predicate(response)).toBe(true);
      pending!.resolve(response);
    },
    fail: () => pending!.reject(new Error('native_response_timeout')),
  };
}

type NativeCall = (
  path: string,
  options?: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  },
) => Promise<unknown>;
let nativeSource: Promise<Map<string, string>> | undefined;
async function actualOpenGame(call: NativeCall) {
  // Execute unchanged product sources; replace only the HTTP boundary and access
  // readiness. This includes the real api.createProject JSON/header serializer.
  nativeSource ??= Promise.all(
    ['api.ts', 'games/game-catalog.ts', 'games/open-game.ts'].map(
      async (path) =>
        [
          path,
          ts.transpileModule(await readFile(join(process.cwd(), 'apps/web/src', path), 'utf8'), {
            fileName: path,
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
          }).outputText,
        ] as const,
    ),
  ).then((entries) => new Map(entries));
  const source = await nativeSource;
  const evaluate = (path: string, imports: Record<string, unknown>) => {
    const module = { exports: {} as Record<string, unknown> };
    runInNewContext(
      source.get(path)!,
      {
        module,
        exports: module.exports,
        URLSearchParams,
        require: (name: string) => {
          if (!Object.hasOwn(imports, name)) throw new Error(`Unexpected native import: ${name}`);
          return imports[name];
        },
      },
      { filename: path },
    );
    return module.exports;
  };
  const unused = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error('Unexpected native side effect');
      },
    },
  );
  const catalog = evaluate('games/game-catalog.ts', {});
  const api = evaluate('api.ts', {
    './api-call': { call },
    './games/game-catalog': catalog,
    './modules/project-draft-mutation': unused,
    './project-snapshot-client': unused,
    './session-fetch': unused,
    './telemetry-context': unused,
  });
  const entry = evaluate('games/open-game.ts', {
    '../api': api,
    './game-catalog': catalog,
    './game-access-api': {
      gameAccessApi: { read: async () => ({ ok: true, data: { granted: true } }) },
      gameAccessMessage: () => 'Access refused',
    },
  });
  return entry.openGame as (game: Game) => Promise<{ id: string }>;
}

describe('public acceptance private manifest and refusal boundaries', () => {
  it('requires one exact origin/revision, one marked Account/class and exactly two distinct Seats', () => {
    expect(validateManifest(fixture())).toEqual(fixture());
    const invalid = [
      { ...fixture(), origin: 'https://asa-lab.ru/' },
      { ...fixture(), origin: 'https://asa-lab.ru.evil.invalid' },
      { ...fixture(), origin: 'http://asa-lab.ru' },
      { ...fixture(), expectedRevision: 'main' },
      { ...fixture(), expectedSchemaVersion: '304' },
      { ...fixture(), testMarker: 'real class' },
      { ...fixture(), seats: fixture().seats.slice(0, 1) },
      { ...fixture(), seats: [...fixture().seats, fixture().seats[0]] },
      { ...fixture(), seats: [fixture().seats[0], fixture().seats[0]] },
      { ...fixture(), projectId: id(99) },
      { ...fixture(), url: ORIGIN + '/#/projects/' + id(99) },
      { ...fixture(), allowNativeBotCheckClick: 'true' },
      { ...fixture(), account: { ...fixture().account, displayName: 'Actual teacher' } },
      { ...fixture(), account: { ...fixture().account, id: '../../classrooms' } },
      { ...fixture(), classroom: { ...fixture().classroom, title: 'Real class' } },
      { ...fixture(), seats: [{ ...fixture().seats[0], studentCode: 1234 }, fixture().seats[1]] },
    ];
    for (const input of invalid) expect(() => validateManifest(input)).toThrow(Refusal);
    for (const key of Object.keys(fixture())) {
      const input: Record<string, unknown> = fixture();
      delete input[key];
      expect(() => validateManifest(input)).toThrow(Refusal);
    }
  });

  it('never mixes the public entry with testDB, seed, load, alternate-origin or disabled-TLS profiles', () => {
    expect(() => assertEnvironment({})).not.toThrow();
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
      expect(() => assertEnvironment({ [key]: '1' })).toThrow('mixed_fixture_environment');
    expect(() => assertEnvironment({ NODE_TLS_REJECT_UNAUTHORIZED: '0' })).toThrow(
      'tls_verification_disabled',
    );
  });

  it('defaults the observed native bot check to handoff without treating general run intent as checkbox authorization', () => {
    for (const manifest of [
      fixture(),
      { ...fixture(), allowNativeBotCheckClick: false },
      { ...fixture(), allowNativeBotCheckClick: 'true' },
    ])
      expect(() => assertBotClickAuthorized(manifest)).toThrow('bot_check_handoff');
    expect(() =>
      assertBotClickAuthorized({ ...fixture(), allowNativeBotCheckClick: true }),
    ).not.toThrow();
  });

  it('rejects incomplete or mismatching API/Web/readiness revision/schema evidence', () => {
    const version = {
      revision: fixture().expectedRevision,
      schemaVersion: 304,
      expectedSchemaVersion: 304,
      synchronized: true,
    };
    const web = { revision: version.revision };
    const ready = {
      status: 'ready',
      dependencies: { database: 'up', credentialConfiguration: 'valid' },
      deployment: version,
    };
    expect(() => assertRevision(fixture(), version, web, ready)).not.toThrow();
    for (const bad of [
      {},
      { ...version, revision: 'b'.repeat(40) },
      { ...version, schemaVersion: null },
      { ...version, expectedSchemaVersion: 303 },
      { ...version, synchronized: false },
    ])
      expect(() => assertRevision(fixture(), bad, web, ready)).toThrow();
    expect(() => assertRevision(fixture(), version, {}, ready)).toThrow();
    expect(() =>
      assertRevision(fixture(), version, web, { ...ready, dependencies: { database: 'busy' } }),
    ).toThrow();
  });

  it('requires authenticated Account, verification false and exact personal workspace, independently of HTTP200', () => {
    expect(() => assertAccount(fixture(), session(), { required: false })).not.toThrow();
    for (const bad of [
      { ...session(), authenticated: false },
      { ...session(), account: { ...session().account, id: id(99) } },
      { ...session(), user: { id: id(99) } },
      { ...session(), account: { ...session().account, displayName: 'real owner' } },
      { ...session(), activeWorkspace: { workspaceId: id(99), kind: 'personal' } },
      { ...session(), activeWorkspace: { workspaceId: id(2), kind: 'school' } },
      { ...session(), verification: { required: true } },
      { ...session(), timeZone: null },
    ])
      expect(() => assertAccount(fixture(), bad, { required: false })).toThrow();
    for (const verification of [{}, { required: true }, { required: 0 }, null])
      expect(() => assertAccount(fixture(), session(), verification)).toThrow();
  });

  it('requires exact server owner role, test marker, safe class and exact roster, including fresh issued Seats', () => {
    expect(() => assertClassroom(fixture(), classroom(), roster())).not.toThrow();
    for (const patch of [
      { teacherRole: 'co_teacher' },
      { id: id(99) },
      { title: 'Real classroom' },
      { workspaceKind: 'school' },
      { safeModeDefault: false },
      { studentCount: 3 },
      { joinCode: 'ZZZ ZZZ 999' },
      { status: 'archived' },
    ])
      expect(() =>
        assertClassroom(fixture(), { classroom: { ...classroom().classroom, ...patch } }, roster()),
      ).toThrow();
    for (const items of [
      [],
      [roster().items[0]],
      [...roster().items, roster().items[0]],
      [{ ...roster().items[0], id: id(99) }, roster().items[1]],
      [{ ...roster().items[0], displayLabel: 'Real student' }, roster().items[1]],
      [{ ...roster().items[0], status: 'suspended' }, roster().items[1]],
    ])
      expect(() => assertClassroom(fixture(), classroom(), { items })).toThrow();
  });

  it('does not infer Seat identity or class ownership from a code or an Account cookie', () => {
    expect(() => assertSeat(fixture(), 0, seat())).not.toThrow();
    for (const bad of [
      session(),
      { ...seat(), authenticated: false },
      seat(1),
      { ...seat(), classroom: { ...seat().classroom, id: id(99) } },
      { ...seat(), student: { ...seat().student, safeMode: false } },
    ])
      expect(() => assertSeat(fixture(), 0, bad)).toThrow();
  });
});

describe('actual native game entry and exact creation receipts', () => {
  it('runs the actual openGame and API serializer twice within five slots and registers each receipt before dependent GET/PUT', async () => {
    const budget = createBudget();
    for (const [index, [who, editor]] of [
      ['account', 'electronics'],
      ['seat-1', 'electronics'],
      ['seat-1', 'scratch'],
    ].entries()) {
      reserveProject(budget, who, editor);
      ownProject(
        budget,
        who,
        editor,
        projectReceipt(10 + index, editor === 'scratch' ? 'blocks' : editor),
        id(3),
      );
    }
    const creates: CreateRequest[] = [];
    for (const game of ['chess', 'checkers'] as const) {
      const waiter = responseWaiter();
      const receiver = { ...gameActor(), page: waiter.page };
      const receipt = gameReceipt(game, 50 + creates.length);
      const openGame = await actualOpenGame(async (path, options) => {
        if (!options?.method) {
          expect(path).toBe(`/api/projects?scope=personal&status=active&module=${game}`);
          return { ok: true, data: { items: [] } };
        }
        const request: CreateRequest = {
          method: options.method,
          path,
          body: JSON.parse(options.body!),
          idempotencyKey: options.headers!['idempotency-key']!,
        };
        expect(request).toEqual(gameRequest(game));
        expect(nativeMutationAllowed(fixture(), budget, receiver, request, true)).toBe(true);
        observeProjectCreate(fixture(), budget, receiver, request, true);
        creates.push(request);
        let admitted = false;
        const dependentGet = projectRequestAllowed(budget, receiver, receipt.project.id).then(
          (allowed) => {
            admitted = allowed;
            return allowed;
          },
        );
        await Promise.resolve();
        expect(admitted).toBe(false);
        expect(budget.projects.has(receipt.project.id)).toBe(false);
        waiter.emit(request, receipt);
        expect(await dependentGet).toBe(true);
        expect(
          nativeMutationAllowed(
            fixture(),
            budget,
            receiver,
            {
              method: 'PUT',
              path: `/api/projects/${receipt.project.id}/draft`,
              body: {},
            },
            true,
          ),
        ).toBe(true);
        expect(await projectRequestAllowed(budget, actor(), receipt.project.id)).toBe(false);
        return { ok: true, data: receipt };
      });
      reserveGame(budget, game);
      reserveProject(budget, receiver.name, game);
      const item = await captureNativeProject(fixture(), budget, receiver, game, async () => {
        expect((await openGame(game)).id).toBe(receipt.project.id);
      });
      expect(item).toMatchObject({ id: receipt.project.id, actor: 'seat-2', editor: game });
      expect(receiver.creation).toBeNull();
      expect(receiver.createEditor).toBeNull();
      const draft = { ...receipt, draft: { projectId: item.id, revision: 0, document: { game } } };
      const proof = assertDraft(fixture(), item, draft);
      expect(assertDraft(fixture(), item, draft, proof, false).documentHash).toBe(
        proof.documentHash,
      );
      expect(() =>
        assertDraft(fixture(), item, {
          ...draft,
          project: { ...receipt.project, classroomId: id(3) },
        }),
      ).toThrow('draft_identity_mismatch');
    }
    expect(creates.map((r) => r.body.module)).toEqual(['chess', 'checkers']);
    expect(budget.projectAttempts).toBe(5);
    expect(budget.projects.size).toBe(5);
    expect(budget.gameAttempts.size).toBe(2);
    expect(() => reserveProject(budget, 'seat-2', 'chess')).toThrow('project_budget');
    expect(
      nativeMutationAllowed(
        fixture(),
        budget,
        { ...gameActor(), createEditor: 'checkers' },
        gameRequest('checkers'),
        true,
      ),
    ).toBe(false);
  });

  it('refuses unreserved, wrong actor/module/owner/class/title/key and read-only native creates without widening the editor contract', () => {
    const budget = createBudget();
    const receiver = { ...gameActor(), createEditor: 'chess' };
    const request = gameRequest('chess');
    expect(nativeMutationAllowed(fixture(), budget, receiver, request, true)).toBe(false);
    reserveProject(budget, receiver.name, 'chess');
    for (const badActor of [
      { ...receiver, name: 'seat-1', index: 0 },
      { ...receiver, name: 'account', index: -1 },
      { ...receiver, index: 0 },
      { ...receiver, authenticated: false },
      { ...receiver, createEditor: null },
    ])
      expect(nativeMutationAllowed(fixture(), budget, badActor, request, true)).toBe(false);
    for (const badRequest of [
      gameRequest('checkers'),
      { ...request, readOnly: true },
      { ...request, idempotencyKey: 'replacement-key' },
      ...[
        { scope: 'classroom' },
        { classroomId: id(3) },
        { classroomId: id(99) },
        { title: 'Another game' },
        { module: 'electronics' },
        { automaticTitle: true },
        { ownerId: id(99) },
        { ownerPrincipalId: id(99) },
        { seatId: id(4) },
      ].map((change) => ({ ...request, body: { ...request.body, ...change } })),
    ])
      expect(nativeMutationAllowed(fixture(), budget, receiver, badRequest, true)).toBe(false);
    expect(nativeMutationAllowed(fixture(), budget, receiver, request, false)).toBe(false);
    expect(budget.projectAttempts).toBe(1);
    expect(budget.projectRequests.size).toBe(0);
    reserveProject(budget, 'seat-1', 'electronics');
    const editorRequest = {
      method: 'POST',
      path: '/api/projects',
      body: { scope: 'personal', module: 'electronics', classroomId: id(99) },
    };
    expect(nativeMutationAllowed(fixture(), budget, actor(), editorRequest, true)).toBe(false);
  });

  it('requires an observed exact native request, fresh ID/receipt, personal null class and active game title before ownership registration', () => {
    const request = gameRequest('chess');
    for (const receipt of [
      { ...gameReceipt('chess'), created: false },
      ...[
        { id: 'not-an-id' },
        { moduleKey: 'checkers' },
        { scope: 'classroom' },
        { classroomId: id(3) },
        { classroomId: id(99) },
        { status: 'archived' },
        { title: 'Imported game' },
        { ownerId: id(99) },
        { ownerPrincipalId: id(99) },
      ].map((change) => ({
        ...gameReceipt('chess'),
        project: { ...gameReceipt('chess').project, ...change },
      })),
    ]) {
      const budget = createBudget();
      reserveProject(budget, 'seat-2', 'chess');
      const receiver = { ...gameActor(), createEditor: 'chess' };
      observeProjectCreate(fixture(), budget, receiver, request, true);
      expect(() => ownProject(budget, receiver.name, 'chess', receipt, id(3), request)).toThrow(
        'creation_receipt',
      );
      expect(budget.projects.size).toBe(0);
      expect(() => reserveProject(budget, receiver.name, 'chess')).toThrow('project_budget');
    }
    const budget = createBudget();
    reserveProject(budget, 'seat-2', 'chess');
    expect(() =>
      ownProject(budget, 'seat-2', 'chess', gameReceipt('chess'), id(3), request),
    ).toThrow('creation_receipt');
    observeProjectCreate(
      fixture(),
      budget,
      { ...gameActor(), createEditor: 'chess' },
      request,
      true,
    );
    expect(() =>
      ownProject(budget, 'seat-2', 'chess', gameReceipt('chess'), id(3), {
        ...request,
        idempotencyKey: 'changed-response-request',
      }),
    ).toThrow('creation_receipt');
    const owned = ownProject(budget, 'seat-2', 'chess', gameReceipt('chess'), id(3), request);
    expect(() =>
      ownProject(budget, 'seat-2', 'chess', gameReceipt('chess'), id(3), request),
    ).toThrow('creation_receipt');
    reserveProject(budget, 'seat-2', 'checkers');
    observeProjectCreate(
      fixture(),
      budget,
      { ...gameActor(), createEditor: 'checkers' },
      gameRequest('checkers'),
      true,
    );
    expect(() =>
      ownProject(
        budget,
        'seat-2',
        'checkers',
        gameReceipt('checkers'),
        id(3),
        gameRequest('checkers'),
      ),
    ).toThrow('creation_receipt');
    expect(budget.projects.get(owned.id)?.editor).toBe('chess');
  });

  it.each(['chess', 'checkers'] as const)(
    'does not adopt the existing save resumed by actual openGame(%s)',
    async (game) => {
      const budget = createBudget();
      const waiter = responseWaiter();
      const receiver = { ...gameActor(), page: waiter.page };
      const existing = gameReceipt(game).project;
      let creates = 0;
      const openGame = await actualOpenGame(async (_path, options) => {
        if (options?.method === 'POST') creates++;
        return {
          ok: true,
          data: { items: [{ ...existing, updatedAt: '2026-11-06T00:00:00.000Z' }] },
        };
      });
      reserveProject(budget, receiver.name, game);
      await expect(
        captureNativeProject(fixture(), budget, receiver, game, async () => {
          expect((await openGame(game)).id).toBe(existing.id);
          waiter.fail();
        }),
      ).rejects.toThrow('native_response_timeout');
      expect(creates).toBe(0);
      expect(budget.projects.size).toBe(0);
      expect(await projectRequestAllowed(budget, receiver, existing.id)).toBe(false);
      expect(budget.projectAttempts).toBe(1);
      expect(receiver.creation).toBeNull();
      expect(receiver.createEditor).toBeNull();
      expect(() => reserveProject(budget, receiver.name, game)).toThrow('project_budget');
    },
  );

  it('consumes ambiguous and existing-response attempts, disarms in finally and forbids a native retry', async () => {
    for (const outcome of ['lost', 'existing', 'foreign-receipt'] as const) {
      const budget = createBudget();
      const waiter = responseWaiter();
      const receiver = { ...gameActor(), page: waiter.page };
      const request = gameRequest('chess');
      const openGame = await actualOpenGame(async (_path, options) => {
        if (!options?.method) return { ok: true, data: { items: [] } };
        observeProjectCreate(fixture(), budget, receiver, request, true);
        if (outcome === 'lost') {
          waiter.fail();
          return { ok: false, error: { message: 'Ambiguous transport failure' } };
        }
        const receipt =
          outcome === 'existing'
            ? { ...gameReceipt('chess'), created: false }
            : {
                ...gameReceipt('chess'),
                project: { ...gameReceipt('chess').project, ownerId: id(99) },
              };
        waiter.emit(request, receipt, outcome === 'existing' ? 200 : 201);
        return { ok: true, data: receipt };
      });
      reserveProject(budget, receiver.name, 'chess');
      await expect(
        captureNativeProject(fixture(), budget, receiver, 'chess', () => openGame('chess')),
      ).rejects.toThrow();
      expect(budget.projectAttempts).toBe(1);
      expect(budget.projectRequests.size).toBe(1);
      expect(budget.projects.size).toBe(0);
      expect(receiver.creation).toBeNull();
      expect(receiver.createEditor).toBeNull();
      expect(
        nativeMutationAllowed(
          fixture(),
          budget,
          { ...receiver, createEditor: 'chess' },
          request,
          true,
        ),
      ).toBe(false);
      expect(() => reserveProject(budget, receiver.name, 'chess')).toThrow('project_budget');
    }
  });

  it('plans one read-only My Learning phase and refuses learning starts, submissions and enrollment writes', () => {
    const report = initialReport(fixture());
    expect(report.operations.filter((step) => step.name === 'my-learning')).toEqual([
      { name: 'my-learning', status: 'NOT_RUN' },
    ]);
    expect(report.operations.some((step) => /^seat-2-(electronics|scratch)$/.test(step.name))).toBe(
      false,
    );
    for (const path of [
      '/api/learning/start',
      `/api/learning/activity-runs/${id(80)}/start`,
      `/api/learning/attempts/${id(81)}/submit`,
      `/api/classrooms/${id(3)}/join-requests`,
    ])
      expect(
        nativeMutationAllowed(
          fixture(),
          createBudget(),
          gameActor(),
          { method: 'POST', path, body: {}, readOnly: true },
          true,
        ),
      ).toBe(false);
  });
});

describe('finite write plan and independent persistence oracle', () => {
  it('counts ambiguous create attempts and refuses sixth project, repeats, arbitrary actor/editor and third game', () => {
    const budget = createBudget();
    for (const [who, editor] of [
      ['account', 'electronics'],
      ['seat-1', 'electronics'],
      ['seat-1', 'scratch'],
      ['seat-2', 'chess'],
      ['seat-2', 'checkers'],
    ])
      reserveProject(budget, who, editor);
    expect(budget.projectAttempts).toBe(5);
    expect(() => reserveProject(budget, 'seat-1', 'electronics')).toThrow('project_budget');
    expect(() => reserveProject(createBudget(), 'foreign', 'electronics')).toThrow();
    expect(() => reserveProject(createBudget(), 'account', 'scratch')).toThrow();
    for (const [who, editor] of [
      ['seat-2', 'electronics'],
      ['seat-2', 'scratch'],
      ['seat-1', 'chess'],
      ['account', 'checkers'],
    ])
      expect(() => reserveProject(createBudget(), who, editor)).toThrow('unplanned_project');
    expect(() =>
      ownProject(createBudget(), 'seat-1', 'electronics', projectReceipt(), id(3)),
    ).toThrow();
    const own = createBudget();
    reserveProject(own, 'seat-1', 'electronics');
    expect(() =>
      ownProject(
        own,
        'seat-1',
        'electronics',
        {
          ...projectReceipt(),
          project: { ...projectReceipt().project, classroomId: id(99) },
        },
        id(3),
      ),
    ).toThrow('creation_receipt');
    reserveGame(budget, 'chess');
    reserveGame(budget, 'checkers');
    expect(() => reserveGame(budget, 'chess')).toThrow();
    expect(() => reserveGame(budget, 'other')).toThrow();
  });

  it('allows only proved own fresh resources and refuses foreign IDs, destructive paths, policies and read-only tab writes', () => {
    const budget = createBudget();
    reserveProject(budget, 'seat-1', 'electronics');
    ownProject(budget, 'seat-1', 'electronics', projectReceipt(), id(3));
    const mutation = { method: 'PUT', path: `/api/projects/${id(10)}/draft`, body: {} };
    expect(nativeMutationAllowed(fixture(), budget, actor(), mutation, true)).toBe(true);
    expect(nativeMutationAllowed(fixture(), budget, actor(), mutation, false)).toBe(false);
    expect(
      nativeMutationAllowed(
        fixture(),
        budget,
        { ...actor(), authenticated: false },
        mutation,
        true,
      ),
    ).toBe(false);
    expect(
      nativeMutationAllowed(fixture(), budget, actor(), { ...mutation, readOnly: true }, true),
    ).toBe(false);
    for (const path of [
      `/api/projects/${id(99)}/draft`,
      `/api/projects/${id(10)}/properties`,
      `/api/projects/${id(10)}/versions/${id(11)}/restore`,
      `/api/classrooms/${id(3)}/seats`,
      `/api/games/chess/policy/${id(3)}`,
      '/api/auth/register',
      '/api/session/context',
      '/api/capabilities/educator/self-attest',
    ])
      expect(nativeMutationAllowed(fixture(), budget, actor(), { ...mutation, path }, true)).toBe(
        false,
      );
    expect(
      nativeMutationAllowed(fixture(), budget, actor(), { ...mutation, method: 'DELETE' }, true),
    ).toBe(false);
    expect(
      nativeMutationAllowed(fixture(), budget, { ...actor(), name: 'seat-2' }, mutation, true),
    ).toBe(false);
  });

  it('allows only the exact armed login credentials/class code and the one exact native invite accept', () => {
    const budget = createBudget();
    const account = {
      ...actor(),
      name: 'account',
      index: -1,
      authenticated: false,
      authPath: '/api/auth/login',
    };
    const login = {
      method: 'POST',
      path: '/api/auth/login',
      body: { identifier: fixture().account.identifier, password: fixture().account.password },
    };
    expect(nativeMutationAllowed(fixture(), budget, account, login, false)).toBe(true);
    expect(
      nativeMutationAllowed(
        fixture(),
        budget,
        account,
        { ...login, body: { ...login.body, identifier: 'foreign' } },
        false,
      ),
    ).toBe(false);
    const child = { ...actor(), authPath: '/api/class-join/studentseat' };
    const admission = {
      method: 'POST',
      path: child.authPath,
      body: { code: fixture().classroom.code, studentCode: fixture().seats[0]!.studentCode },
    };
    expect(nativeMutationAllowed(fixture(), budget, child, admission, true)).toBe(true);
    expect(nativeMutationAllowed(fixture(), budget, child, admission, false)).toBe(false);
    expect(
      nativeMutationAllowed(
        fixture(),
        budget,
        child,
        { ...admission, body: { ...admission.body, studentCode: 'ZZZZ' } },
        true,
      ),
    ).toBe(false);
    const receiver = { ...actor(), gameAccept: '/api/games/chess/invites/UNITCODE/accept' };
    expect(
      nativeMutationAllowed(
        fixture(),
        budget,
        receiver,
        { method: 'POST', path: receiver.gameAccept },
        true,
      ),
    ).toBe(true);
    expect(
      nativeMutationAllowed(
        fixture(),
        budget,
        receiver,
        { method: 'POST', path: '/api/games/chess/invites/FOREIGN/accept' },
        true,
      ),
    ).toBe(false);
  });

  it('requires chosen content, new revision after edit and identical document with nondecreasing revision on reopen', () => {
    const expected = {
      moduleKey: 'electronics',
      componentId: 'resistor-1',
      componentTypeId: 'resistor-axial',
      resistanceOhms: 1001,
      matchingComponents: 1,
    };
    const item = { id: id(10), editor: 'electronics', expected };
    const payload = {
      ...projectReceipt(),
      draft: {
        projectId: id(10),
        revision: 2,
        document: {
          components: [{ id: 'resistor-1', componentTypeId: 'resistor-axial', value: 1001 }],
        },
      },
    };
    const current = assertDraft(fixture(), item, payload);
    expect(current.expectedContentHash).toBe(current.actualContentHash);
    expect(() => assertDraft(fixture(), item, payload, current, false)).not.toThrow();
    expect(() => assertDraft(fixture(), item, payload, current, true)).toThrow(
      'saved_revision_or_reopen_mismatch',
    );
    expect(() =>
      assertDraft(fixture(), item, { ...payload, project: { ...payload.project, id: id(99) } }),
    ).toThrow();
    expect(() =>
      assertDraft(fixture(), item, {
        ...payload,
        project: { ...payload.project, classroomId: id(99) },
      }),
    ).toThrow();
    expect(() =>
      assertDraft(fixture(), { ...item, expected: { ...expected, resistanceOhms: 2000 } }, payload),
    ).toThrow('saved_content_mismatch');
    expect(() =>
      assertDraft(
        fixture(),
        item,
        { ...payload, draft: { ...payload.draft, revision: 1 } },
        current,
        false,
      ),
    ).toThrow();
    const older = { documentHash: digest({ components: [] }), revisionAfter: 1 };
    expect(() =>
      assertDraft(
        fixture(),
        item,
        { ...payload, draft: { ...payload.draft, revision: 3 } },
        current,
        false,
      ),
    ).not.toThrow();
    expect(() => assertDraft(fixture(), item, payload, older, true)).not.toThrow();
    expect(digest({ z: [1, 2], a: 3 })).toBe(digest({ a: 3, z: [1, 2] }));
  });

  it('Scratch proof includes the actual sprite, coordinates, stage and durable costume references', () => {
    const expected = { spriteName: 'Acceptance-1-1' };
    const asset = {
      assetId: 'a'.repeat(32),
      dataFormat: 'svg',
      sha256: 'b'.repeat(64),
      sizeBytes: 123,
    };
    const document = {
      projectJson: {
        targets: [
          { isStage: true },
          { isStage: false, name: expected.spriteName, x: 21, y: 0, costumes: [asset] },
        ],
      },
      assets: [asset],
    };
    expect(projectProjection('scratch', document, expected)).toMatchObject({
      matchingSprites: 1,
      stageCount: 1,
      storedCostumeReferences: true,
      x: 21,
    });
    expect(
      projectProjection('scratch', { ...document, assets: [] }, expected).storedCostumeReferences,
    ).toBe(false);
  });
});

describe('redacted evidence and fault cleanup without a browser/network', () => {
  afterEach(() => vi.restoreAllMocks());
  it('never serializes supplied identifiers, credentials, arbitrary URL/header text, cookies, bodies or code', () => {
    const secret = 'sensitive-password-source-cookie';
    const report = initialReport(fixture());
    expect(report.status).toBe('NOT_RUN');
    expect(report.operations.every((o: { status: string }) => o.status === 'NOT_RUN')).toBe(true);
    for (const url of [
      `${ORIGIN}/api/projects/${id(99)}/draft?password=${secret}#${secret}`,
      `${ORIGIN}/api/games/chess/invites/${secret}/accept`,
      `${ORIGIN}/private/${secret}`,
      `https://${secret}@foreign.invalid/${secret}`,
    ]) {
      const serialized = JSON.stringify(httpEvidence('POST', url, 503, secret, false));
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain(id(99));
    }
    const serialized = JSON.stringify(report);
    for (const value of [
      fixture().account.identifier,
      fixture().account.password,
      fixture().testMarker,
      fixture().classroom.code,
      ...fixture().seats.map((s) => s.studentCode),
      ...[1, 2, 3, 4, 5].map(id),
    ])
      expect(serialized).not.toContain(value);
    expect(reportRoute(`${ORIGIN}/api/games/chess/invites/secret/accept`)).toBe(
      '/api/games/chess/invites/:id/accept',
    );
    expect(report.capacityClaim).toBe(false);
    expect(report.serverRestarts).toBe('NOT_OBSERVABLE');
  });

  it('restores only its context after native edit failure and after an ambiguous offline transition', async () => {
    const context = { setOffline: vi.fn(async () => {}) };
    const wait = vi.fn(async () => {});
    await expect(
      withOffline(
        context,
        async () => {
          throw new Error('native edit failed');
        },
        wait,
      ),
    ).rejects.toThrow('native edit failed');
    expect(wait).toHaveBeenCalledWith(10_000);
    expect(context.setOffline.mock.calls).toEqual([[true], [false], [false]]);
    const broken = {
      setOffline: vi
        .fn()
        .mockRejectedValueOnce(new Error('ambiguous'))
        .mockResolvedValue(undefined),
    };
    await expect(withOffline(broken, async () => {}, wait)).rejects.toThrow('ambiguous');
    expect(broken.setOffline.mock.calls).toEqual([[true], [false]]);
  });

  it('injects 503 only into this exact origin telemetry POST and removes precisely its own handler on failure', async () => {
    let handler:
      | ((route: {
          request: () => { method: () => string; url: () => string };
          fulfill: ReturnType<typeof vi.fn>;
          fallback: ReturnType<typeof vi.fn>;
        }) => Promise<void>)
      | undefined;
    const context = {
      route: vi.fn(async (_pattern, registered) => {
        handler = registered;
      }),
      unroute: vi.fn(async () => {}),
    };
    const invoke = async (url: string, method: string) => {
      const route = {
        request: () => ({ url: () => url, method: () => method }),
        fulfill: vi.fn(async () => {}),
        fallback: vi.fn(async () => {}),
      };
      await handler!(route);
      return route;
    };
    await expect(
      withTelemetryFault(context, async () => {
        expect(
          (await invoke(ORIGIN + '/api/analytics/v2/events', 'POST')).fulfill,
        ).toHaveBeenCalledWith(expect.objectContaining({ status: 503 }));
        for (const [url, method] of [
          [ORIGIN + '/api/diagnostics/quality', 'GET'],
          [ORIGIN + '/api/projects', 'POST'],
          ['https://foreign.invalid/api/analytics/v2/events', 'POST'],
        ])
          expect((await invoke(url!, method!)).fallback).toHaveBeenCalledOnce();
        throw new Error('save failed');
      }),
    ).rejects.toThrow('save failed');
    expect(context.unroute).toHaveBeenCalledWith(context.route.mock.calls[0]![0], handler);
    await expect(withTelemetryFault(context, async () => {})).rejects.toThrow(
      'telemetry_fault_not_observed',
    );
    expect(context.unroute).toHaveBeenCalledTimes(2);
    await expect(
      withTelemetryFault(context, async () => {
        await invoke(ORIGIN + '/api/diagnostics/quality', 'POST');
      }),
    ).resolves.toEqual({ injected503: 1 });
    expect(context.unroute).toHaveBeenCalledTimes(3);
  });

  it('closes every owned context even if restoration/closure fails, without a data deletion API', async () => {
    const first = { setOffline: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const second = {
      setOffline: vi.fn(async () => {
        throw new Error('restore');
      }),
      close: vi.fn(async () => {
        throw new Error('close');
      }),
    };
    await expect(closeOwnedContexts([first, second])).rejects.toThrow('context_cleanup_failed');
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    expect(first.setOffline).toHaveBeenCalledWith(false);
  });

  it('CLI defaults to local NOT_RUN and will not overwrite the private input or an existing report', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'public-acceptance-unit-'));
    const manifestPath = join(dir, 'operator.json'),
      reportPath = join(dir, 'report.json');
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      await writeFile(manifestPath, JSON.stringify(fixture()), { mode: 0o600 });
      await expect(main(['--manifest', manifestPath, '--report', reportPath], {})).resolves.toBe(0);
      const report = JSON.parse(await readFile(reportPath, 'utf8'));
      expect(report.status).toBe('NOT_RUN');
      expect(report.http).toEqual([]);
      expect(report.operations.every((o: { status: string }) => o.status === 'NOT_RUN')).toBe(true);
      await expect(
        main(['--manifest', manifestPath, '--report', reportPath], {}),
      ).rejects.toThrow();
      await expect(
        main(['--manifest', manifestPath, '--report', manifestPath], {}),
      ).rejects.toThrow('cli_paths');
      expect(stdout).toHaveBeenCalledOnce();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
