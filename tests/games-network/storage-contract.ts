import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { expect, it } from 'vitest';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { ChessNetworkService } from '../../contexts/games/application/chess-network';
import { seedTeacher } from '../portal/helpers';
export interface NetworkSql {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export function chessNetworkStorageContract(clients: () => { admin: NetworkSql; pool: pg.Pool }) {
  async function fixture() {
    const { admin, pool } = clients();
    const teacher = await seedTeacher(admin as pg.Pool, `network-${randomUUID().slice(0, 8)}`);
    const identity = (
      await admin.query(
        'SELECT account_id,principal_id FROM legacy_user_account_links WHERE user_id=$1',
        [teacher.teacherId],
      )
    ).rows[0]!;
    async function classroom(title = 'Network class') {
      const classroomId = randomUUID();
      await admin.query(
        'INSERT INTO classrooms(id,tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,$4,$5,$6)',
        [
          classroomId,
          teacher.tenantId,
          teacher.schoolId,
          teacher.periodId,
          title,
          teacher.teacherId,
        ],
      );
      await admin.query(
        "INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')",
        [teacher.tenantId, classroomId, teacher.teacherId, identity['account_id']],
      );
      return classroomId;
    }
    const classroomId = await classroom();
    async function seat(label: string, classId = classroomId) {
      const id = (
        await admin.query('SELECT id FROM classroom_management_add_seat($1,$2,$3,$4,true)', [
          identity['account_id'],
          classId,
          label,
          randomUUID().slice(0, 8),
        ])
      ).rows[0]!['id'] as string;
      await admin.query("UPDATE classroom_student_seats SET status='active' WHERE id=$1", [id]);
      const hash = hashSessionToken(randomUUID().repeat(2));
      await admin.query(
        'INSERT INTO classroom_seat_credentials(seat_id,credential_hash,version,last_request_id,issued_by_account_id) VALUES($1,$2,1,$3,$4)',
        [id, hash, randomUUID(), identity['account_id']],
      );
      await admin.query(
        "INSERT INTO classroom_student_sessions(seat_id,token_hash,expires_at,credential_version) VALUES($1,$2,now()+interval '1 hour',1)",
        [id, hash],
      );
      return { id, source: { kind: 'student_seat' as const, sessionHash: hash } };
    }
    const hash = hashSessionToken(randomUUID().repeat(2));
    await admin.query('SELECT auth_create_session($1,$2,$3,1)', [
      teacher.tenantId,
      teacher.teacherId,
      hash,
    ]);
    const source = { kind: 'account' as const, sessionHash: hash };
    const service = new ChessNetworkService(pool);
    return { teacher, identity, classroomId, classroom, seat, source, service, admin };
  }
  it('policy receipt replays the original version once, rejects changed intent and checks current teacher permission', async () => {
    const f = await fixture();
    const command = randomUUID();
    const input = { enabled: true, scope: 'school' as const, expectedVersion: 0 };
    const original = await f.service.policy(f.source, f.classroomId, input, command);
    const replay = await f.service.policy(f.source, f.classroomId, input, command);
    expect(original).toMatchObject({ version: 1, replayed: false });
    expect(replay).toEqual({ ...original, replayed: true });
    await expect(
      f.service.policy(f.source, f.classroomId, { ...input, scope: 'platform' }, command),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      f.service.policy(f.source, f.classroomId, { ...input, expectedVersion: 1 }, command),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(
      (
        await f.admin.query(
          "SELECT count(*)::int n FROM audit_events WHERE entity_id=$1 AND action='classroom.games.network'",
          [f.classroomId],
        )
      ).rows[0]!['n'],
    ).toBe(1);
    expect(await f.service.policy(f.source, f.classroomId)).toMatchObject({
      version: 1,
      enabled: true,
    });
    await f.service.policy(
      f.source,
      f.classroomId,
      { ...input, expectedVersion: 1, enabled: false },
      randomUUID(),
    );
    expect(await f.service.policy(f.source, f.classroomId, input, command)).toEqual({
      ...original,
      replayed: true,
    });
    expect(await f.service.policy(f.source, f.classroomId)).toMatchObject({
      version: 2,
      enabled: false,
    });
    await f.admin.query("UPDATE classrooms SET status='archived' WHERE id=$1", [f.classroomId]);
    await expect(f.service.policy(f.source, f.classroomId, input, command)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
  it('real migrated runtime completes a two-pupil game with replay, reconnect and durable history/outbox', async () => {
    const f = await fixture();
    const a = await f.seat('First');
    const b = await f.seat('Second');
    expect((await f.service.access(a.source)).allowed).toBe(false);
    await f.service.policy(
      f.source,
      f.classroomId,
      {
        enabled: true,
        scope: 'classroom',
        expectedVersion: 0,
      },
      randomUUID(),
    );
    expect((await f.service.access(a.source)).scopes).toEqual(['classroom']);
    const command = randomUUID();
    const created = await f.service.create(a.source, command, {
      scope: 'classroom',
      initialMs: 600000,
      incrementMs: 5000,
      colorPreference: 'white',
    });
    expect(created.invite).toBeDefined();
    const replay = await f.service.create(a.source, command, {
      scope: 'classroom',
      initialMs: 600000,
      incrementMs: 5000,
      colorPreference: 'white',
    });
    expect(replay.invite?.id).toBe(created.invite!.id);
    expect(replay.replayed).toBe(true);
    const accepted = await f.service.accept(b.source, randomUUID(), created.invite!.code);
    const match = accepted.match!;
    const firstMove = randomUUID();
    const moved = await f.service.action(
      a.source,
      firstMove,
      match.id,
      match.version,
      'move',
      'e2e4',
    );
    expect(moved.match?.moves).toHaveLength(1);
    expect(
      (await f.service.action(a.source, firstMove, match.id, match.version, 'move', 'e2e4'))
        .replayed,
    ).toBe(true);
    const black = await f.service.getMatch(b.source, match.id);
    expect(black.match.currentFen).toBe(moved.match!.currentFen);
    const answered = await f.service.action(
      b.source,
      randomUUID(),
      match.id,
      black.match.version,
      'move',
      'e7e5',
    );
    const finished = await f.service.action(
      a.source,
      randomUUID(),
      match.id,
      answered.match!.version,
      'resign',
    );
    expect(finished.match).toMatchObject({
      status: 'finished',
      result: '0-1',
      termination: 'resignation',
    });
    expect((await f.service.history(b.source)).matches[0]).toMatchObject({
      id: match.id,
      result: '0-1',
    });
    expect(
      (
        await f.admin.query(
          "SELECT count(*)::int n FROM games.outbox WHERE match_id=$1 AND event_kind='match_finished'",
          [match.id],
        )
      ).rows[0]!['n'],
    ).toBe(1);
    const publicText = JSON.stringify(finished);
    for (const forbidden of [a.id, b.id, f.classroomId, f.teacher.tenantId, f.teacher.schoolId])
      expect(publicText).not.toContain(forbidden);
  }, 60_000);
  it('teacher network off aborts both players without a winner; foreign teacher and student writes are denied', async () => {
    const f = await fixture();
    const a = await f.seat('First');
    const b = await f.seat('Second');
    await expect(
      f.service.policy(
        a.source,
        f.classroomId,
        {
          enabled: true,
          scope: 'platform',
          expectedVersion: 0,
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await f.service.policy(
      f.source,
      f.classroomId,
      {
        enabled: true,
        scope: 'classroom',
        expectedVersion: 0,
      },
      randomUUID(),
    );
    const invite = await f.service.create(a.source, randomUUID(), {
      scope: 'classroom',
      initialMs: 600000,
      incrementMs: 0,
      colorPreference: 'white',
    });
    const started = await f.service.accept(b.source, randomUUID(), invite.invite!.code);
    await f.service.policy(
      f.source,
      f.classroomId,
      {
        enabled: false,
        scope: 'classroom',
        expectedVersion: 1,
      },
      randomUUID(),
    );
    // POST is the first operation after revocation: no GET may rescue an aborted transaction.
    expect(
      (
        await f.service.action(
          a.source,
          randomUUID(),
          started.match!.id,
          started.match!.version,
          'move',
          'e2e4',
        )
      ).match,
    ).toMatchObject({ status: 'aborted', result: '*', termination: 'security_abort' });
    expect(
      (
        await f.admin.query('SELECT status FROM games.chess_matches WHERE id=$1', [
          started.match!.id,
        ])
      ).rows[0]!['status'],
    ).toBe('aborted');
    expect(
      (
        await f.admin.query(
          "SELECT count(*)::int n FROM games.outbox WHERE match_id=$1 AND event_kind='match_aborted'",
          [started.match!.id],
        )
      ).rows[0]!['n'],
    ).toBe(1);
    expect((await f.service.getMatch(b.source, started.match!.id)).match.status).toBe('aborted');
    await expect(
      f.service.create(a.source, randomUUID(), {
        scope: 'classroom',
        initialMs: 600000,
        incrementMs: 0,
        colorPreference: 'white',
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    const other = await fixture();
    await expect(other.service.policy(other.source, f.classroomId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  }, 60_000);

  it('enforces both directions of classroom/school/platform scopes including cross-tenant platform play', async () => {
    const f = await fixture();
    const otherClass = await f.classroom('Other class');
    const a = await f.seat('A');
    const b = await f.seat('B', otherClass);
    await f.service.policy(
      f.source,
      f.classroomId,
      {
        enabled: true,
        scope: 'classroom',
        expectedVersion: 0,
      },
      randomUUID(),
    );
    await f.service.policy(
      f.source,
      otherClass,
      {
        enabled: true,
        scope: 'platform',
        expectedVersion: 0,
      },
      randomUUID(),
    );
    const input = {
      scope: 'classroom' as const,
      initialMs: 600000,
      incrementMs: 0,
      colorPreference: 'white' as const,
    };
    const classInvite = await f.service.create(a.source, randomUUID(), input);
    await expect(
      f.service.accept(b.source, randomUUID(), classInvite.invite!.code),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    const widerInvite = await f.service.create(b.source, randomUUID(), {
      ...input,
      scope: 'platform',
    });
    await expect(
      f.service.accept(a.source, randomUUID(), widerInvite.invite!.code),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await f.service.policy(
      f.source,
      f.classroomId,
      {
        enabled: true,
        scope: 'school',
        expectedVersion: 1,
      },
      randomUUID(),
    );
    const schoolInvite = await f.service.create(a.source, randomUUID(), {
      ...input,
      scope: 'school',
    });
    expect(
      (await f.service.accept(b.source, randomUUID(), schoolInvite.invite!.code)).match?.status,
    ).toBe('active');
    const foreign = await fixture();
    const c = await foreign.seat('C');
    await foreign.service.policy(
      foreign.source,
      foreign.classroomId,
      {
        enabled: true,
        scope: 'platform',
        expectedVersion: 0,
      },
      randomUUID(),
    );
    const ownSchool = await f.service.create(a.source, randomUUID(), { ...input, scope: 'school' });
    await expect(
      foreign.service.accept(c.source, randomUUID(), ownSchool.invite!.code),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    const platform = await foreign.service.create(c.source, randomUUID(), {
      ...input,
      scope: 'platform',
    });
    await expect(
      f.service.accept(a.source, randomUUID(), platform.invite!.code),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await f.service.policy(
      f.source,
      f.classroomId,
      {
        enabled: true,
        scope: 'platform',
        expectedVersion: 2,
      },
      randomUUID(),
    );
    const shared = await f.service.accept(a.source, randomUUID(), platform.invite!.code);
    expect(shared.match?.scope).toBe('platform');
    expect(f.teacher.tenantId).not.toBe(foreign.teacher.tenantId);
    expect(
      (
        await f.admin.query(
          "SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='games' AND table_name='chess_matches' AND column_name='tenant_id'",
        )
      ).rows[0]!['n'],
    ).toBe(0);
  }, 60_000);
  it('verified learner Account links share one player and retain every pupil restriction in personal context', async () => {
    const f = await fixture();
    const seat = await f.seat('Same name');
    expect(await f.service.legacyAllowed(f.source)).toBe(true);
    await f.service.policy(
      f.source,
      f.classroomId,
      {
        enabled: true,
        scope: 'platform',
        expectedVersion: 0,
      },
      randomUUID(),
    );
    const standalone = await f.service.access(seat.source);
    const personal = await f.service.access(f.source);
    expect(standalone.player.playerId).not.toBe(personal.player.playerId);
    const createKey = randomUUID();
    const inviteInput = {
      scope: 'platform' as const,
      initialMs: 600000,
      incrementMs: 0,
      colorPreference: 'white' as const,
    };
    const beforeLink = await f.service.create(seat.source, createKey, inviteInput);
    const collisionKey = randomUUID();
    await f.service.create(seat.source, collisionKey, inviteInput);
    await f.service.create(f.source, collisionKey, inviteInput);
    const learner = (
      await f.admin.query(
        "SELECT learner_identity_id FROM learner_identity_links WHERE link_kind='student_seat' AND seat_id=$1",
        [seat.id],
      )
    ).rows[0]!['learner_identity_id'];
    await f.admin.query('UPDATE classroom_student_seats SET account_id=$2 WHERE id=$1', [
      seat.id,
      f.identity['account_id'],
    ]);
    await f.admin.query(
      "INSERT INTO learner_identity_links(id,tenant_id,school_id,learner_identity_id,link_kind,account_id) VALUES($1,$2,$3,$4,'account',$5)",
      [randomUUID(), f.teacher.tenantId, f.teacher.schoolId, learner, f.identity['account_id']],
    );
    // The independently persisted verified learner link remains authoritative.
    await f.admin.query('UPDATE classroom_student_seats SET account_id=NULL WHERE id=$1', [
      seat.id,
    ]);
    expect(await f.service.legacyAllowed(f.source)).toBe(false);
    const linked = await f.service.access(seat.source);
    expect(linked.player.playerId).toBe(personal.player.playerId);
    expect((await f.service.access(f.source)).player.playerId).toBe(linked.player.playerId);
    const replayAfterLink = await f.service.create(f.source, createKey, inviteInput);
    expect(replayAfterLink.invite?.id).toBe(beforeLink.invite!.id);
    expect(replayAfterLink.replayed).toBe(true);
    expect((await f.service.create(seat.source, createKey, inviteInput)).invite?.id).toBe(
      beforeLink.invite!.id,
    );
    await expect(f.service.create(f.source, collisionKey, inviteInput)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(
      (
        await f.admin.query(
          'SELECT canonical_player_id FROM games.player_alias_events WHERE old_player_id=$1',
          [standalone.player.playerId],
        )
      ).rows[0]!['canonical_player_id'],
    ).toBe(personal.player.playerId);
    await f.service.policy(
      f.source,
      f.classroomId,
      {
        enabled: false,
        scope: 'platform',
        expectedVersion: 1,
      },
      randomUUID(),
    );
    expect((await f.service.access(f.source)).allowed).toBe(false);
    expect((await f.service.access(seat.source)).allowed).toBe(false);
    const unrelated = await f.seat('Same name');
    expect((await f.service.access(unrelated.source)).player.playerId).not.toBe(
      personal.player.playerId,
    );
  }, 60_000);
  it('illegal/stale/foreign commands and offline deny fail closed, and membership revoke aborts on POST', async () => {
    const f = await fixture();
    const a = await f.seat('A');
    const b = await f.seat('B');
    const outsider = await f.seat('Outsider');
    await f.service.policy(
      f.source,
      f.classroomId,
      {
        enabled: true,
        scope: 'classroom',
        expectedVersion: 0,
      },
      randomUUID(),
    );
    const invite = await f.service.create(a.source, randomUUID(), {
      scope: 'classroom',
      initialMs: 600000,
      incrementMs: 0,
      colorPreference: 'white',
    });
    const started = (await f.service.accept(b.source, randomUUID(), invite.invite!.code)).match!;
    await expect(f.service.getMatch(outsider.source, started.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      f.service.action(a.source, randomUUID(), started.id, started.version, 'move', 'e2e5'),
    ).rejects.toMatchObject({ code: 'ILLEGAL_MOVE' });
    await expect(
      f.service.action(b.source, randomUUID(), started.id, started.version, 'move', 'e7e5'),
    ).rejects.toMatchObject({ code: 'NOT_YOUR_TURN' });
    const key = randomUUID();
    const moved = (
      await f.service.action(a.source, key, started.id, started.version, 'move', 'e2e4')
    ).match!;
    await expect(
      f.service.action(a.source, key, started.id, started.version, 'move', 'd2d4'),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      f.service.action(b.source, randomUUID(), started.id, started.version, 'move', 'e7e5'),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await f.admin.query("UPDATE classroom_student_seats SET status='suspended' WHERE id=$1", [
      a.id,
    ]);
    expect(
      (await f.service.action(b.source, randomUUID(), started.id, moved.version, 'move', 'e7e5'))
        .match,
    ).toMatchObject({ status: 'aborted', result: '*' });
    await expect(f.service.access(a.source)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await f.admin.query("SELECT classroom_games_policy_write($1,$2,$3,NULL,'class',$4::jsonb)", [
      f.identity['principal_id'],
      f.teacher.tenantId,
      f.classroomId,
      JSON.stringify({ mode: 'deny', threshold: null, expectedVersion: 0 }),
    ]);
    expect((await f.service.access(b.source)).allowed).toBe(false);
  }, 60_000);
  it('result, receipt and outbox roll back together on finalization failure, then retry exactly once', async () => {
    const f = await fixture();
    const a = await f.seat('A');
    const b = await f.seat('B');
    await f.service.policy(
      f.source,
      f.classroomId,
      {
        enabled: true,
        scope: 'classroom',
        expectedVersion: 0,
      },
      randomUUID(),
    );
    const invite = await f.service.create(a.source, randomUUID(), {
      scope: 'classroom',
      initialMs: 600000,
      incrementMs: 0,
      colorPreference: 'white',
    });
    const started = (await f.service.accept(b.source, randomUUID(), invite.invite!.code)).match!;
    await f.admin.query(
      "CREATE FUNCTION games.fail_test_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected finalizer failure'; END $$; CREATE TRIGGER test_outbox_failure BEFORE INSERT ON games.outbox FOR EACH ROW EXECUTE FUNCTION games.fail_test_outbox();",
    );
    const key = randomUUID();
    try {
      await expect(
        f.service.action(a.source, key, started.id, started.version, 'resign'),
      ).rejects.toThrow('injected finalizer failure');
    } finally {
      await f.admin.query(
        'DROP TRIGGER test_outbox_failure ON games.outbox; DROP FUNCTION games.fail_test_outbox();',
      );
    }
    expect(
      (await f.admin.query('SELECT status FROM games.chess_matches WHERE id=$1', [started.id]))
        .rows[0]!['status'],
    ).toBe('active');
    expect(
      (
        await f.admin.query(
          'SELECT count(*)::int n FROM games.command_receipts WHERE command_id=$1',
          [key],
        )
      ).rows[0]!['n'],
    ).toBe(0);
    expect(
      (await f.service.action(a.source, key, started.id, started.version, 'resign')).match?.status,
    ).toBe('finished');
    expect(
      (await f.service.action(a.source, key, started.id, started.version, 'resign')).replayed,
    ).toBe(true);
    expect(
      (
        await f.admin.query(
          "SELECT count(*)::int n FROM games.outbox WHERE match_id=$1 AND event_kind='match_finished'",
          [started.id],
        )
      ).rows[0]!['n'],
    ).toBe(1);
  }, 60_000);

  it('OFF then ON without readers durably invalidates the old grant before clocks or moves', async () => {
    const f = await fixture();
    const a = await f.seat('A');
    const b = await f.seat('B');
    await f.service.policy(
      f.source,
      f.classroomId,
      {
        enabled: true,
        scope: 'classroom',
        expectedVersion: 0,
      },
      randomUUID(),
    );
    const invite = await f.service.create(a.source, randomUUID(), {
      scope: 'classroom',
      initialMs: 60000,
      incrementMs: 0,
      colorPreference: 'white',
    });
    const game = (await f.service.accept(b.source, randomUUID(), invite.invite!.code)).match!;
    await f.service.policy(
      f.source,
      f.classroomId,
      {
        enabled: false,
        scope: 'classroom',
        expectedVersion: 1,
      },
      randomUUID(),
    );
    await f.service.policy(
      f.source,
      f.classroomId,
      {
        enabled: true,
        scope: 'classroom',
        expectedVersion: 2,
      },
      randomUUID(),
    );
    const afterForbiddenInterval = new ChessNetworkService(
      clients().pool,
      () => Date.now() + 120000,
    );
    const stopped = (
      await afterForbiddenInterval.action(
        a.source,
        randomUUID(),
        game.id,
        game.version,
        'move',
        'e2e4',
      )
    ).match!;
    expect(stopped).toMatchObject({
      status: 'aborted',
      result: '*',
      termination: 'security_abort',
    });
    expect(stopped.moves).toHaveLength(0);
    expect(
      (await f.admin.query('SELECT status FROM games.chess_matches WHERE id=$1', [game.id]))
        .rows[0]!['status'],
    ).toBe('aborted');
    expect(
      (
        await f.admin.query(
          "SELECT count(*)::int n FROM games.outbox WHERE match_id=$1 AND event_kind='match_aborted'",
          [game.id],
        )
      ).rows[0]!['n'],
    ).toBe(1);
    // A fresh game is admitted under the new explicit teacher grant.
    expect(
      (
        await f.service.create(a.source, randomUUID(), {
          scope: 'classroom',
          initialMs: 60000,
          incrementMs: 0,
          colorPreference: 'white',
        })
      ).invite?.status,
    ).toBe('open');
  }, 60000);

  it('two active participants merging into one verified Account aborts the duel without a self-result', async () => {
    const f = await fixture();
    const foreign = await fixture();
    const a = await f.seat('A');
    const b = await foreign.seat('B');
    await f.service.policy(
      f.source,
      f.classroomId,
      {
        enabled: true,
        scope: 'platform',
        expectedVersion: 0,
      },
      randomUUID(),
    );
    await foreign.service.policy(
      foreign.source,
      foreign.classroomId,
      {
        enabled: true,
        scope: 'platform',
        expectedVersion: 0,
      },
      randomUUID(),
    );
    const invite = await f.service.create(a.source, randomUUID(), {
      scope: 'platform',
      initialMs: 600000,
      incrementMs: 0,
      colorPreference: 'white',
    });
    const game = (await foreign.service.accept(b.source, randomUUID(), invite.invite!.code)).match!;
    for (const [fixture, pupil] of [
      [f, a],
      [foreign, b],
    ] as const) {
      await f.admin.query('UPDATE classroom_student_seats SET account_id=$2 WHERE id=$1', [
        pupil.id,
        f.identity['account_id'],
      ]);
      const learner = (
        await f.admin.query(
          "SELECT learner_identity_id FROM learner_identity_links WHERE seat_id=$1 AND link_kind='student_seat'",
          [pupil.id],
        )
      ).rows[0]!['learner_identity_id'];
      await f.admin.query(
        "INSERT INTO learner_identity_links(id,tenant_id,school_id,learner_identity_id,link_kind,account_id) VALUES($1,$2,$3,$4,'account',$5)",
        [
          randomUUID(),
          fixture.teacher.tenantId,
          fixture.teacher.schoolId,
          learner,
          f.identity['account_id'],
        ],
      );
      await fixture.service.access(pupil.source);
    }
    expect((await f.service.getMatch(a.source, game.id)).match).toMatchObject({
      status: 'aborted',
      result: '*',
      termination: 'security_abort',
    });
  }, 60000);

  it('retains the sole pre-existing Seat subject when first entering the newly linked personal Account', async () => {
    const f = await fixture();
    const account = await fixture();
    const a = await f.seat('Sole existing subject');
    await f.service.policy(
      f.source,
      f.classroomId,
      {
        enabled: true,
        scope: 'platform',
        expectedVersion: 0,
      },
      randomUUID(),
    );
    const prior = await f.service.access(a.source);
    expect(
      (
        await f.admin.query(
          "SELECT count(*)::int n FROM games.player_sources WHERE source_kind='account' AND source_id=$1",
          [account.identity['account_id']],
        )
      ).rows[0]!['n'],
    ).toBe(0);
    await f.admin.query('UPDATE classroom_student_seats SET account_id=$2 WHERE id=$1', [
      a.id,
      account.identity['account_id'],
    ]);
    const learner = (
      await f.admin.query(
        "SELECT learner_identity_id FROM learner_identity_links WHERE seat_id=$1 AND link_kind='student_seat'",
        [a.id],
      )
    ).rows[0]!['learner_identity_id'];
    await f.admin.query(
      "INSERT INTO learner_identity_links(id,tenant_id,school_id,learner_identity_id,link_kind,account_id) VALUES($1,$2,$3,$4,'account',$5)",
      [
        randomUUID(),
        f.teacher.tenantId,
        f.teacher.schoolId,
        learner,
        account.identity['account_id'],
      ],
    );
    expect(await account.service.legacyAllowed(account.source)).toBe(false);
    expect((await account.service.access(account.source)).player.playerId).toBe(
      prior.player.playerId,
    );
    expect((await f.service.access(a.source)).player.playerId).toBe(prior.player.playerId);
    await f.admin.query(
      "UPDATE learner_identity_links SET status='inactive',disabled_at=now() WHERE seat_id=$1 AND link_kind='student_seat'",
      [a.id],
    );
    await expect(f.service.access(a.source)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect((await account.service.access(account.source)).allowed).toBe(false);
    expect(await account.service.legacyAllowed(account.source)).toBe(false);
  }, 60000);

  it('intersects every verified pupil policy for a personal Account across schools', async () => {
    const f = await fixture();
    const foreign = await fixture();
    const account = await fixture();
    const a = await f.seat('A');
    const peer = await f.seat('Peer');
    const b = await foreign.seat('B');
    await f.service.policy(
      f.source,
      f.classroomId,
      {
        enabled: true,
        scope: 'classroom',
        expectedVersion: 0,
      },
      randomUUID(),
    );
    await foreign.service.policy(
      foreign.source,
      foreign.classroomId,
      {
        enabled: true,
        scope: 'school',
        expectedVersion: 0,
      },
      randomUUID(),
    );
    for (const [scope, pupil] of [
      [f, a],
      [foreign, b],
    ] as const) {
      await f.admin.query('UPDATE classroom_student_seats SET account_id=$2 WHERE id=$1', [
        pupil.id,
        account.identity['account_id'],
      ]);
      const learner = (
        await f.admin.query(
          "SELECT learner_identity_id FROM learner_identity_links WHERE seat_id=$1 AND link_kind='student_seat'",
          [pupil.id],
        )
      ).rows[0]!['learner_identity_id'];
      await f.admin.query(
        "INSERT INTO learner_identity_links(id,tenant_id,school_id,learner_identity_id,link_kind,account_id) VALUES($1,$2,$3,$4,'account',$5)",
        [
          randomUUID(),
          scope.teacher.tenantId,
          scope.teacher.schoolId,
          learner,
          account.identity['account_id'],
        ],
      );
    }
    expect((await account.service.access(account.source)).scopes).toEqual(['classroom']);
    const input = {
      scope: 'classroom' as const,
      initialMs: 600000,
      incrementMs: 0,
      colorPreference: 'white' as const,
    };
    const restricted = await account.service.create(account.source, randomUUID(), input);
    await expect(
      f.service.accept(peer.source, randomUUID(), restricted.invite!.code),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await foreign.service.policy(
      foreign.source,
      foreign.classroomId,
      {
        enabled: true,
        scope: 'platform',
        expectedVersion: 1,
      },
      randomUUID(),
    );
    const permitted = await account.service.create(account.source, randomUUID(), input);
    expect(
      (await f.service.accept(peer.source, randomUUID(), permitted.invite!.code)).match?.status,
    ).toBe('active');
  }, 60000);
  it('expired/revoked sessions never reuse a cached player entitlement', async () => {
    const f = await fixture();
    const a = await f.seat('A');
    const b = await f.seat('B');
    await f.service.access(a.source);
    await f.service.access(b.source);
    await f.admin.query(
      'UPDATE classroom_student_sessions SET revoked_at=now() WHERE token_hash=$1',
      [a.source.sessionHash],
    );
    await f.admin.query(
      "UPDATE classroom_student_sessions SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",
      [b.source.sessionHash],
    );
    await expect(f.service.access(a.source)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(f.service.access(b.source)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  }, 60000);
  return fixture;
}
