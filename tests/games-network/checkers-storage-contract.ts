import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { expect, it } from 'vitest';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { CheckersNetworkService } from '../../contexts/games/application/checkers-network';
import { ChessNetworkService } from '../../contexts/games/application/chess-network';
import { seedTeacher } from '../portal/helpers';
import type { NetworkSql } from './storage-contract';
export function checkersNetworkStorageContract(
  clients: () => { admin: NetworkSql; pool: pg.Pool },
) {
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
    const service = new CheckersNetworkService(pool);
    return { teacher, identity, classroomId, classroom, seat, source, service, admin };
  }
  const input = {
    scope: 'classroom' as const,
    initialMs: 600000,
    incrementMs: 0,
    colorPreference: 'white' as const,
  };
  it('discovers scoped players and avatars, binds invitations, preserves commands and finishes a real two-pupil game', async () => {
    const f = await fixture();
    const a = await f.seat('First');
    const b = await f.seat('Second');
    const c = await f.seat('Third');
    await f.service.policy(
      f.source,
      f.classroomId,
      { enabled: true, scope: 'classroom', expectedVersion: 0 },
      randomUUID(),
    );
    const aid = (await f.service.access(a.source)).player.playerId,
      bid = (await f.service.access(b.source)).player.playerId;
    for (const seat of [a, b, c]) await f.service.notifications(seat.source);
    await f.admin.query(
      "UPDATE classroom_student_seats SET avatar_key='asa-avatar-07' WHERE id=$1",
      [b.id],
    );
    const lobby = await f.service.lobby(a.source, 'classroom');
    expect(lobby.players.some((p) => p.playerId === bid)).toBe(true);
    expect(JSON.stringify(lobby)).not.toContain(b.id);
    expect(await f.service.avatar(a.source, bid, 'classroom')).toMatchObject({
      defaultPath: '/assets/avatars/default/avatar-07.webp',
    });
    const key = randomUUID();
    const invite = (await f.service.challenge(a.source, key, bid, input)).invite!;
    expect((await f.service.challenge(a.source, key, bid, input)).invite!.id).toBe(invite.id);
    expect((await f.service.notifications(b.source)).incoming.map((i) => i.id)).toEqual([
      invite.id,
    ]);
    expect((await f.service.notifications(c.source)).incoming).toEqual([]);
    await expect(f.service.accept(c.source, randomUUID(), invite.code)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const acceptKey = randomUUID();
    const game = (await f.service.accept(b.source, acceptKey, invite.code)).match!;
    expect((await f.service.accept(b.source, acceptKey, invite.code)).match!.id).toBe(game.id);
    expect(game.position.pieces).toHaveLength(24);
    expect(game.viewerColor).toBe('black');
    await expect(
      f.service.action(b.source, randomUUID(), game.id, game.version, 'move', ['b6', 'a5']),
    ).rejects.toMatchObject({ code: 'NOT_YOUR_TURN' });
    const moveKey = randomUUID();
    const first = (
      await f.service.action(a.source, moveKey, game.id, game.version, 'move', ['a3', 'b4'])
    ).match!;
    expect(
      (await f.service.action(a.source, moveKey, game.id, game.version, 'move', ['a3', 'b4']))
        .match!.version,
    ).toBe(first.version);
    const second = (
      await f.service.action(b.source, randomUUID(), game.id, first.version, 'move', ['b6', 'a5'])
    ).match!;
    expect((await f.service.getMatch(a.source, game.id)).match.position).toEqual(second.position);
    await expect(
      f.service.action(a.source, randomUUID(), game.id, game.version, 'resign'),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const finish = (
      await f.service.action(a.source, randomUUID(), game.id, second.version, 'resign')
    ).match!;
    expect(finish).toMatchObject({ status: 'finished', result: '0-1', termination: 'resignation' });
    expect((await f.service.history(a.source)).matches[0]!.result).toBe('0-1');
    expect((await f.service.history(b.source)).matches[0]!.result).toBe('0-1');
    expect(
      (
        await f.admin.query(
          'SELECT count(*)::integer n FROM games.checkers_outbox WHERE match_id=$1',
          [game.id],
        )
      ).rows[0]!.n,
    ).toBe(1);
    expect(
      (
        await f.admin.query(
          'SELECT count(*)::integer n FROM games.checkers_teams WHERE match_id=$1',
          [game.id],
        )
      ).rows[0]!.n,
    ).toBe(0);
    const chess = new ChessNetworkService(clients().pool);
    expect((await chess.access(a.source)).player.playerId).toBe(aid);
    expect((await chess.history(a.source)).matches).toEqual([]);
    await expect(chess.create(a.source, key, input)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });
  it('keeps class, school and platform permissions bilateral and teacher revocation aborts without a winner', async () => {
    const f = await fixture(),
      a = await f.seat('A'),
      other = await f.classroom('Other class'),
      b = await f.seat('B', other);
    const foreign = await fixture(),
      c = await foreign.seat('C');
    for (const [owner, id] of [
      [f, f.classroomId],
      [f, other],
      [foreign, foreign.classroomId],
    ] as const)
      await owner.service.policy(
        owner.source,
        id,
        { enabled: true, scope: 'classroom', expectedVersion: 0 },
        randomUUID(),
      );
    for (const seat of [a, b]) await f.service.notifications(seat.source);
    await foreign.service.notifications(c.source);
    const bid = (await f.service.access(b.source)).player.playerId,
      cid = (await foreign.service.access(c.source)).player.playerId;
    expect(
      (await f.service.lobby(a.source, 'classroom')).players.map((p) => p.playerId),
    ).not.toContain(bid);
    await expect(
      f.service.challenge(a.source, randomUUID(), bid, { ...input, scope: 'school' }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    for (const id of [f.classroomId, other])
      await f.service.policy(
        f.source,
        id,
        { enabled: true, scope: 'school', expectedVersion: 1 },
        randomUUID(),
      );
    await f.service.notifications(a.source);
    await f.service.notifications(b.source);
    expect((await f.service.lobby(a.source, 'school')).players.map((p) => p.playerId)).toContain(
      bid,
    );
    expect(
      (await f.service.lobby(a.source, 'school')).players.map((p) => p.playerId),
    ).not.toContain(cid);
    for (const id of [f.classroomId, other])
      await f.service.policy(
        f.source,
        id,
        { enabled: true, scope: 'platform', expectedVersion: 2 },
        randomUUID(),
      );
    await foreign.service.policy(
      foreign.source,
      foreign.classroomId,
      { enabled: true, scope: 'platform', expectedVersion: 1 },
      randomUUID(),
    );
    await f.service.notifications(a.source);
    await foreign.service.notifications(c.source);
    expect((await f.service.lobby(a.source, 'platform')).players.map((p) => p.playerId)).toContain(
      cid,
    );
    const invite = (
      await f.service.challenge(a.source, randomUUID(), cid, { ...input, scope: 'platform' })
    ).invite!;
    const game = (await foreign.service.accept(c.source, randomUUID(), invite.code)).match!;
    await f.service.policy(
      f.source,
      f.classroomId,
      { enabled: false, scope: 'platform', expectedVersion: 3 },
      randomUUID(),
    );
    expect((await f.service.notifications(a.source)).incoming).toEqual([]);
    const stopped = (await foreign.service.getMatch(c.source, game.id)).match;
    expect(stopped).toMatchObject({
      status: 'aborted',
      result: '*',
      termination: 'security_abort',
    });
    await expect(
      f.service.policy(
        foreign.source,
        f.classroomId,
        { enabled: true, scope: 'platform', expectedVersion: 4 },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('declines/cancels idempotently and runtime cannot bypass private table or helper grants', async () => {
    const f = await fixture(),
      a = await f.seat('Decline A'),
      b = await f.seat('Decline B');
    await f.service.policy(
      f.source,
      f.classroomId,
      { enabled: true, scope: 'classroom', expectedVersion: 0 },
      randomUUID(),
    );
    await f.service.notifications(a.source);
    await f.service.notifications(b.source);
    const bid = (await f.service.access(b.source)).player.playerId;
    const invite = (await f.service.challenge(a.source, randomUUID(), bid, input)).invite!;
    const key = randomUUID();
    expect((await f.service.decline(b.source, key, invite.id, invite.version)).replayed).toBe(
      false,
    );
    expect((await f.service.decline(b.source, key, invite.id, invite.version)).replayed).toBe(true);
    expect((await f.service.notifications(b.source)).incoming).toEqual([]);
    const runtime = await clients().pool.connect();
    try {
      await expect(runtime.query('SELECT * FROM games.checkers_presence')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(
        runtime.query("SELECT games.checkers_redeem_context_v1('NOT-ALLOWED')"),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      runtime.release();
    }
  });
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
    await f.service.lobby(seat.source, 'platform');
    await f.service.lobby(f.source, 'platform');
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
    await f.service.lobby(seat.source, 'platform');
    const observer = await f.seat('Lobby observer');
    expect(
      (await f.service.lobby(observer.source, 'platform')).players.filter(
        (p) => p.playerId === linked.player.playerId,
      ),
    ).toHaveLength(1);
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
    await expect(f.service.lobby(f.source, 'platform')).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    await expect(f.service.lobby(seat.source, 'classroom')).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    const unrelated = await f.seat('Same name');
    expect((await f.service.access(unrelated.source)).player.playerId).not.toBe(
      personal.player.playerId,
    );
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
      "CREATE FUNCTION games.fail_test_checkers_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected finalizer failure'; END $$; CREATE TRIGGER test_checkers_outbox_failure BEFORE INSERT ON games.checkers_outbox FOR EACH ROW EXECUTE FUNCTION games.fail_test_checkers_outbox();",
    );
    const key = randomUUID();
    try {
      await expect(
        f.service.action(a.source, key, started.id, started.version, 'resign'),
      ).rejects.toThrow('injected finalizer failure');
    } finally {
      await f.admin.query(
        'DROP TRIGGER test_checkers_outbox_failure ON games.checkers_outbox; DROP FUNCTION games.fail_test_checkers_outbox();',
      );
    }
    expect(
      (await f.admin.query('SELECT status FROM games.checkers_matches WHERE id=$1', [started.id]))
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
          "SELECT count(*)::int n FROM games.checkers_outbox WHERE match_id=$1 AND event_kind='match_finished'",
          [started.id],
        )
      ).rows[0]!['n'],
    ).toBe(1);
  }, 60_000);

  return fixture;
}
