import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { InjectOptions } from 'fastify';
import { expect, it } from 'vitest';
import { inject, type NestApp } from '../portal/app';
import type { storageContract } from './storage-contract';

type Fixture = Awaited<ReturnType<ReturnType<typeof storageContract>>>;
type Clients = { admin: pg.Pool; runtime: pg.Pool; app: NestApp };

/** Real assembled API, migrated PostgreSQL and asalab_app. Fixtures create
 * only test identities; no game admission, authorization or project SQL is
 * replaced. These tests are registered in the opt-in isolated PG suite. */
export function httpContract(clients: () => Clients, fixture: ReturnType<typeof storageContract>) {
  const request = (f: Fixture, options: InjectOptions, accountToken?: string) =>
    inject(clients().app, {
      ...options,
      cookies: {
        asa_student_session: f.token,
        ...(accountToken ? { asa_session: accountToken } : {}),
        ...options.cookies,
      },
    });
  async function teacherLogin(f: Fixture): Promise<string> {
    const response = await inject(clients().app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        workspace: f.teacher.workspace,
        email: f.teacher.email,
        password: f.teacher.password,
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const token = response.cookies.find((cookie) => cookie.name === 'asa_session')?.value;
    expect(token).toBeTruthy();
    return token!;
  }
  async function create(f: Fixture, module = 'chess', key = randomUUID(), accountToken?: string) {
    const response = await request(
      f,
      {
        method: 'POST',
        url: '/api/projects',
        headers: { 'idempotency-key': key },
        payload: { scope: 'personal', module, title: `Admission ${module}` },
      },
      accountToken,
    );
    expect([200, 201], response.body).toContain(response.statusCode);
    const project = response.json().project as { id: string; moduleKey: string };
    const opened = await request(
      f,
      { method: 'GET', url: `/api/projects/${project.id}` },
      accountToken,
    );
    expect(opened.statusCode, opened.body).toBe(200);
    return { project, key, draft: opened.json().draft as { document: unknown; revision: number } };
  }
  async function projectState(projectId: string) {
    return (
      await clients().admin.query(
        `SELECT p.title,p.status,p.description,p.tags,p.license,d.document_json,d.revision,
        (SELECT count(*)::int FROM project_versions v WHERE v.project_id=p.id) AS versions,
        (SELECT count(*)::int FROM audit_events a WHERE a.entity_id=p.id) AS audit
       FROM projects p JOIN project_drafts d ON d.project_id=p.id WHERE p.id=$1`,
        [projectId],
      )
    ).rows[0];
  }
  const denied = (
    response: { statusCode: number; body: string; json(): unknown },
    reason?: string,
  ) => {
    expect(response.statusCode, response.body).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: 'games_access_denied', ...(reason ? { reason } : {}) },
    });
  };
  async function waitForLock(queryPart: string): Promise<void> {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const waiting = await clients().admin.query(
        `SELECT pid FROM pg_stat_activity WHERE datname=current_database()
         AND usename='asalab_app' AND wait_event_type='Lock'
         AND strpos(query,$1)>0`,
        [queryPart],
      );
      if (waiting.rows.length) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`No runtime lock wait observed for ${queryPart}`);
  }

  it.each(['chess', 'checkers'])(
    'assembled API defaults to safe offline %s and persists a real draft',
    async (module) => {
      const f = await fixture();
      const access = await request(f, { method: 'GET', url: `/api/games/access?game=${module}` });
      expect(access.statusCode, access.body).toBe(200);
      expect(access.json()).toEqual({ granted: true, reason: 'allowed', threshold: null });
      const game = await create(f, module);
      const mutationId = randomUUID();
      const payload = {
        document: game.draft.document,
        baseRevision: game.draft.revision,
        mutationId,
      };
      const saved = await request(f, {
        method: 'PUT',
        url: `/api/projects/${game.project.id}/draft`,
        payload,
      });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.json().draft.revision).toBe(game.draft.revision + 1);
      const replay = await request(f, {
        method: 'PUT',
        url: `/api/projects/${game.project.id}/draft`,
        payload,
      });
      expect(replay.statusCode, replay.body).toBe(200);
      expect(replay.json().draft.revision).toBe(saved.json().draft.revision);
      const reopened = await request(f, { method: 'GET', url: `/api/projects/${game.project.id}` });
      expect(reopened.json().draft.document).toEqual(game.draft.document);
      expect(reopened.json().draft.revision).toBe(game.draft.revision + 1);
    },
  );

  it('denies every direct game path and old idempotent retry after revoke, preserving ordinary work', async () => {
    const f = await fixture();
    const game = await create(f);
    const ordinary = await create(f, 'electronics');
    const savedPayload = {
      document: game.draft.document,
      baseRevision: game.draft.revision,
      mutationId: randomUUID(),
    };
    expect(
      (
        await request(f, {
          method: 'PUT',
          url: `/api/projects/${game.project.id}/draft`,
          payload: savedPayload,
        })
      ).statusCode,
    ).toBe(200);
    const before = await projectState(game.project.id);
    await f.write('class', { mode: 'deny', threshold: null, expectedVersion: 0 });
    const modules = await request(f, { method: 'GET', url: '/api/modules' });
    expect(modules.statusCode, modules.body).toBe(200);
    for (const module of ['chess', 'checkers']) {
      expect(
        modules.json().items.find((item: { moduleKey: string }) => item.moduleKey === module)
          .creatable,
      ).toBe(false);
      denied(
        await request(f, { method: 'GET', url: `/api/projects?scope=personal&module=${module}` }),
        'class_disabled',
      );
      denied(
        await request(f, {
          method: 'GET',
          url: `/api/projects/title-suggestion?scope=personal&module=${module}`,
        }),
        'class_disabled',
      );
      denied(
        await request(f, {
          method: 'POST',
          url: '/api/projects',
          headers: { 'idempotency-key': randomUUID() },
          payload: { scope: 'personal', module, title: 'Denied' },
        }),
        'class_disabled',
      );
    }
    const mixed = await request(f, {
      method: 'GET',
      url: '/api/projects?scope=personal&excludeGames=false',
    });
    expect(mixed.statusCode, mixed.body).toBe(200);
    expect(mixed.json().items.map((item: { id: string }) => item.id)).toContain(
      ordinary.project.id,
    );
    expect(mixed.json().items.map((item: { id: string }) => item.id)).not.toContain(
      game.project.id,
    );
    denied(
      await request(f, {
        method: 'POST',
        url: '/api/projects',
        headers: { 'idempotency-key': game.key },
        payload: { scope: 'personal', module: 'chess', title: 'Admission chess' },
      }),
    );
    const paths: InjectOptions[] = [
      { method: 'GET', url: `/api/projects/${game.project.id}` },
      { method: 'PUT', url: `/api/projects/${game.project.id}/draft`, payload: savedPayload },
      {
        method: 'PATCH',
        url: `/api/projects/${game.project.id}`,
        payload: { title: 'Denied rename' },
      },
      {
        method: 'POST',
        url: `/api/projects/${game.project.id}/duplicate`,
        headers: { 'idempotency-key': randomUUID() },
        payload: { title: 'Denied duplicate' },
      },
      {
        method: 'POST',
        url: `/api/projects/${game.project.id}/status`,
        payload: { status: 'archived' },
      },
      {
        method: 'POST',
        url: `/api/projects/${game.project.id}/checkpoints`,
        payload: { label: 'Denied checkpoint' },
      },
      { method: 'GET', url: `/api/projects/${game.project.id}/versions` },
      { method: 'POST', url: `/api/projects/${game.project.id}/versions/${randomUUID()}/restore` },
      { method: 'GET', url: `/api/projects/${game.project.id}/snapshot?rev=1` },
      {
        method: 'PUT',
        url: `/api/projects/${game.project.id}/snapshot`,
        payload: {
          imageDataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAADIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
          sourceRevision: game.draft.revision + 1,
        },
      },
      { method: 'GET', url: `/api/projects/${game.project.id}/feedback` },
      {
        method: 'PUT',
        url: `/api/projects/${game.project.id}/properties`,
        payload: { title: 'Denied properties', visibility: 'private' },
      },
    ];
    for (const path of paths) denied(await request(f, path), 'class_disabled');
    expect(await projectState(game.project.id)).toEqual(before);
    expect(
      (await request(f, { method: 'GET', url: `/api/projects/${ordinary.project.id}` })).statusCode,
    ).toBe(200);
    expect(
      (
        await request(f, {
          method: 'PUT',
          url: `/api/projects/${ordinary.project.id}/draft`,
          payload: {
            document: ordinary.draft.document,
            baseRevision: ordinary.draft.revision,
            mutationId: randomUUID(),
          },
        })
      ).statusCode,
    ).toBe(200);
    await f.write('seat', { override: 'allow', expectedVersion: 1 }, f.seatId);
    expect(
      (await request(f, { method: 'GET', url: `/api/projects/${game.project.id}` })).statusCode,
    ).toBe(200);
    await f.write('revoke', { expectedVersion: 2 });
    denied(
      await request(f, { method: 'GET', url: `/api/projects/${game.project.id}` }),
      'policy_revoked',
    );
  });

  it('selected Seat owns games; conflicting, invalid and revoked cookies never gain Account authority', async () => {
    const f = await fixture();
    const linked = await fixture();
    const accountToken = await teacherLogin(linked);
    const game = await create(f, 'checkers');
    const admin = clients().admin;
    expect(
      (await admin.query('SELECT owner_principal_id FROM projects WHERE id=$1', [game.project.id]))
        .rows[0].owner_principal_id,
    ).toBe(f.principal);
    const state = async () => ({
      project: await projectState(game.project.id),
      policy: await f.read(f.seatId),
      owned: (
        await admin.query(
          'SELECT id, owner_principal_id FROM projects WHERE owner_principal_id=ANY($1::uuid[]) ORDER BY id',
          [[f.principal, linked.actor]],
        )
      ).rows,
    });
    const refused = async (
      options: InjectOptions,
      cookie: string,
      expected: number,
      withAccount = true,
    ) => {
      const before = await state();
      const response = await inject(clients().app, {
        ...options,
        cookies: {
          asa_student_session: cookie,
          ...(withAccount ? { asa_session: accountToken } : {}),
        },
      });
      expect(response.statusCode, response.body).toBe(expected);
      if (expected === 409)
        expect(response.json()).toMatchObject({ error: { code: 'session_conflict' } });
      expect(await state(), response.body).toEqual(before);
    };
    const urls = [
      '/api/games/access?game=checkers',
      '/api/modules',
      '/api/projects',
      `/api/projects/${game.project.id}`,
    ];
    const createOptions: InjectOptions = {
      method: 'POST',
      url: '/api/projects',
      headers: { 'idempotency-key': randomUUID() },
      payload: { scope: 'personal', module: 'chess', title: 'No Account fallback' },
    };
    const saveOptions: InjectOptions = {
      method: 'PUT',
      url: `/api/projects/${game.project.id}/draft`,
      payload: {
        document: game.draft.document,
        baseRevision: game.draft.revision,
        mutationId: randomUUID(),
      },
    };
    // The assembled application rejects any two nonempty session cookies at
    // onRequest, before resolving either principal. Linking cannot relax it.
    for (const link of [false, true]) {
      if (link) {
        await admin.query('UPDATE classroom_student_seats SET account_id=$2 WHERE id=$1', [
          f.seatId,
          linked.account,
        ]);
        const learner = (
          await admin.query(
            'SELECT learner_identity_id FROM learner_identity_links WHERE seat_id=$1',
            [f.seatId],
          )
        ).rows[0].learner_identity_id;
        await admin.query(
          `INSERT INTO learner_identity_links(id,tenant_id,school_id,learner_identity_id,link_kind,account_id) VALUES($1,$2,$3,$4,'account',$5)`,
          [randomUUID(), f.teacher.tenantId, f.teacher.schoolId, learner, linked.account],
        );
      }
      for (const url of urls) await refused({ method: 'GET', url }, f.token, 409);
      await refused(createOptions, f.token, 409);
      await refused(saveOptions, f.token, 409);
    }
    await f.write('class', { mode: 'deny', threshold: null, expectedVersion: 0 });
    denied(await request(f, { method: 'GET', url: `/api/projects/${game.project.id}` }));
    const accountAccess = await inject(clients().app, {
      method: 'GET',
      url: '/api/games/access?game=chess',
      cookies: { asa_session: accountToken },
    });
    expect(accountAccess.json()).toEqual({ granted: true, reason: 'allowed', threshold: null });
    for (const cookie of ['', 'invalid-seat-token']) {
      for (const url of urls) {
        await refused({ method: 'GET', url }, cookie, cookie ? 409 : 401);
        await refused({ method: 'GET', url }, cookie, 401, false);
      }
      await refused(createOptions, cookie, cookie ? 409 : 401);
    }
    await admin.query(
      'UPDATE classroom_student_sessions SET revoked_at=now() WHERE token_hash=$1',
      [f.hash],
    );
    for (const url of urls) {
      await refused({ method: 'GET', url }, f.token, 409);
      await refused({ method: 'GET', url }, f.token, 401, false);
    }
    await refused(createOptions, f.token, 409);
    await refused(createOptions, f.token, 401, false);
  });

  it('keeps classroom/Seat/tenant/actor substitution and foreign educational Project ACL denied', async () => {
    const f = await fixture();
    const other = await fixture();
    const foreignGame = await create(other);
    const foreignWork = await create(other, 'electronics');
    await f.write('seat', { override: 'allow', expectedVersion: 0 }, f.seatId);
    for (const project of [foreignGame, foreignWork]) {
      const response = await request(f, {
        method: 'GET',
        url: `/api/projects/${project.project.id}`,
      });
      expect(response.statusCode, response.body).toBe(404);
    }
    for (const key of ['seatId', 'classroomId', 'tenantId', 'principalId', 'projectId']) {
      expect(
        (
          await request(f, {
            method: 'GET',
            url: `/api/games/access?game=chess&${key}=${other.seatId}`,
          })
        ).statusCode,
      ).toBe(400);
    }
    const foreignCreate = await request(f, {
      method: 'POST',
      url: '/api/projects',
      headers: { 'idempotency-key': randomUUID() },
      payload: {
        scope: 'classroom',
        classroomId: other.classroomId,
        module: 'chess',
        title: 'Foreign game',
      },
    });
    expect([403, 404], foreignCreate.body).toContain(foreignCreate.statusCode);
    for (const key of ['studentSession', 'principalId', 'tenantId']) {
      const response = await request(f, {
        method: 'POST',
        url: '/api/projects',
        headers: { 'idempotency-key': randomUUID() },
        payload: { scope: 'personal', module: 'chess', title: 'Injected', [key]: other.principal },
      });
      expect(response.statusCode, response.body).toBe(400);
    }
  });

  it('teacher HTTP controls use exact-class authority, canonical rating, version conflict and individual override', async () => {
    const f = await fixture();
    const other = await fixture();
    const token = await teacherLogin(f);
    const teacherRequest = (options: InjectOptions) =>
      inject(clients().app, { ...options, cookies: { asa_session: token } });
    const path = `/api/games/classrooms/${f.classroomId}`;
    const policy = await teacherRequest({ method: 'GET', url: `${path}/policy` });
    expect(policy.statusCode, policy.body).toBe(200);
    expect(policy.json()).toEqual({ mode: 'allow', threshold: null, state: 'active', version: 0 });
    const score = Number(
      (
        await clients().admin.query(
          `SELECT (item->>'score')::numeric score FROM classroom_participant_metrics($1) WHERE item->>'seatId'=$2`,
          [f.classroomId, f.seatId],
        )
      ).rows[0].score,
    );
    expect(score).toBeLessThan(100);
    const input = { mode: 'rating_threshold', threshold: score + 0.001, expectedVersion: 0 };
    expect(
      (await teacherRequest({ method: 'PUT', url: `${path}/policy`, payload: input })).statusCode,
    ).toBe(200);
    const seat = await teacherRequest({ method: 'GET', url: `${path}/seats/${f.seatId}` });
    expect(seat.statusCode, seat.body).toBe(200);
    expect(seat.json()).toEqual({
      mode: 'rating_threshold',
      threshold: score + 0.001,
      state: 'active',
      version: 1,
      override: 'inherit',
      admission: { granted: false, reason: 'rating_below_threshold', threshold: score + 0.001 },
    });
    expect(
      (await teacherRequest({ method: 'PUT', url: `${path}/policy`, payload: input })).statusCode,
    ).toBe(409);
    const individual = await teacherRequest({
      method: 'PUT',
      url: `${path}/seats/${f.seatId}`,
      payload: { override: 'allow', expectedVersion: 1 },
    });
    expect(individual.statusCode, individual.body).toBe(200);
    expect(individual.json()).toMatchObject({
      override: 'allow',
      version: 2,
      admission: { granted: true },
    });
    expect(
      (await request(f, { method: 'GET', url: '/api/games/access?game=chess' })).json().granted,
    ).toBe(true);
    expect(
      (
        await teacherRequest({
          method: 'DELETE',
          url: `${path}/seats/${f.seatId}`,
          payload: { expectedVersion: 2 },
        })
      ).json(),
    ).toMatchObject({ override: 'inherit', version: 3, admission: { granted: false } });
    for (const url of [
      `/api/games/classrooms/${other.classroomId}/policy`,
      `${path}/seats/${other.seatId}`,
    ]) {
      expect((await teacherRequest({ method: 'GET', url })).statusCode).toBe(403);
    }
    const before = await f.read(f.seatId);
    for (const selectedAccount of [undefined, token]) {
      const response = await request(
        f,
        {
          method: 'PUT',
          url: `${path}/policy`,
          payload: { mode: 'allow', threshold: null, expectedVersion: 3 },
        },
        selectedAccount,
      );
      expect(response.statusCode, response.body).toBe(selectedAccount ? 409 : 403);
      if (selectedAccount)
        expect(response.json()).toMatchObject({ error: { code: 'session_conflict' } });
      expect(await f.read(f.seatId)).toEqual(before);
    }
  });

  it('explicit offline grant never opens live matchmaking or classroom matches with either student cookie combination', async () => {
    const f = await fixture();
    const accountToken = await teacherLogin(f);
    const state = async () =>
      (
        await clients().admin.query(`SELECT
      (SELECT count(*)::int FROM chess_matchmaking_tickets) tickets,
      (SELECT count(*)::int FROM chess_live_games) chess,
      (SELECT count(*)::int FROM chess_live_command_receipts) receipts,
      (SELECT count(*)::int FROM checkers_class_games) checkers,
      (SELECT count(*)::int FROM checkers_reaction_events) reactions`)
      ).rows[0];
    for (const token of [undefined, accountToken]) {
      const options: InjectOptions[] = [
        { method: 'GET', url: `/api/chess/live/games/${randomUUID()}` },
        { method: 'GET', url: `/api/checkers/projects/${randomUUID()}/play` },
        {
          method: 'POST',
          url: '/api/chess/live/matchmaking',
          headers: { 'idempotency-key': randomUUID() },
          payload: {
            initialMs: 300000,
            incrementMs: 0,
            rated: false,
            colorPreference: 'random',
            expiresInMs: 60000,
          },
        },
      ];
      for (const option of options) {
        const before = await state();
        const response = await request(f, option, token);
        expect(response.statusCode, response.body).toBe(token ? 409 : 403);
        if (token) expect(response.json()).toMatchObject({ error: { code: 'session_conflict' } });
        expect(await state(), response.body).toEqual(before);
      }
    }
  });

  it('parallel first launch stays idempotent and parallel draft writes do not deadlock admission locks', async () => {
    const f = await fixture();
    const key = randomUUID();
    const results = await Promise.all([create(f, 'chess', key), create(f, 'chess', key)]);
    expect(results[0]!.project.id).toBe(results[1]!.project.id);
    const { project, draft } = results[0]!;
    const saves = await Promise.all(
      [0, 1].map(() =>
        request(f, {
          method: 'PUT',
          url: `/api/projects/${project.id}/draft`,
          payload: {
            document: draft.document,
            baseRevision: draft.revision,
            mutationId: randomUUID(),
          },
        }),
      ),
    );
    expect(saves.map((response) => response.statusCode).sort()).toEqual([200, 409]);
  });

  it('an actual in-flight save holds admission until commit and a queued policy revoke takes effect next', async () => {
    const f = await fixture();
    const game = await create(f);
    const blocker = await clients().admin.connect();
    let save: ReturnType<typeof request> | undefined;
    let revoke: Promise<pg.QueryResult> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT project_id FROM project_drafts WHERE project_id=$1 FOR UPDATE', [
        game.project.id,
      ]);
      save = request(f, {
        method: 'PUT',
        url: `/api/projects/${game.project.id}/draft`,
        payload: {
          document: game.draft.document,
          baseRevision: game.draft.revision,
          mutationId: randomUUID(),
        },
      });
      // Prepared saves prepend current_access before the UPDATE CTE. Observe the
      // real blocked draft mutation, independent of that context prefix.
      await waitForLock('UPDATE project_drafts d');
      revoke = clients().runtime.query(
        `SELECT classroom_games_policy_write($1,$2,$3,NULL,'class',$4::jsonb) data`,
        [
          f.actor,
          f.teacher.tenantId,
          f.classroomId,
          JSON.stringify({ mode: 'deny', threshold: null, expectedVersion: 0 }),
        ],
      );
      await waitForLock('classroom_games_policy_write');
      await blocker.query('COMMIT');
      const saved = await save;
      expect(saved.statusCode, saved.body).toBe(200);
      expect((await revoke).rows[0].data).toMatchObject({ mode: 'deny', version: 1 });
      denied(
        await request(f, {
          method: 'PUT',
          url: `/api/projects/${game.project.id}/draft`,
          payload: {
            document: game.draft.document,
            baseRevision: saved.json().draft.revision,
            mutationId: randomUUID(),
          },
        }),
      );
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await Promise.allSettled([save, revoke]);
    }
  }, 20_000);

  it('a save queued behind an uncommitted policy revoke rechecks after the commit and writes nothing', async () => {
    const f = await fixture();
    const game = await create(f);
    const before = await projectState(game.project.id);
    const policy = await clients().runtime.connect();
    let save: ReturnType<typeof request> | undefined;
    try {
      await policy.query('BEGIN');
      await policy.query(`SELECT classroom_games_policy_write($1,$2,$3,NULL,'class',$4::jsonb)`, [
        f.actor,
        f.teacher.tenantId,
        f.classroomId,
        JSON.stringify({ mode: 'deny', threshold: null, expectedVersion: 0 }),
      ]);
      save = request(f, {
        method: 'PUT',
        url: `/api/projects/${game.project.id}/draft`,
        payload: {
          document: game.draft.document,
          baseRevision: game.draft.revision,
          mutationId: randomUUID(),
        },
      });
      await waitForLock('classroom_games_admission_lock');
      await policy.query('COMMIT');
      denied(await save, 'class_disabled');
      expect(await projectState(game.project.id)).toEqual(before);
    } finally {
      await policy.query('ROLLBACK');
      policy.release();
      await Promise.allSettled([save]);
    }
  }, 20_000);
}
