import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AiAccessService } from '../../apps/api/src/ai-access.service';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
import { SeatContextUseCase } from '../../apps/api/src/seat-context';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';

export interface AiIdentity {
  account_id: string;
  principal_id: string;
  tenant_id: string;
  workspace_id: string;
}
export async function aiIdentity(admin: pg.Pool): Promise<AiIdentity> {
  const id = randomUUID().replaceAll('-', '');
  return (
    await admin.query<AiIdentity>(
      `SELECT * FROM auth_register_account($1,'test-only',$2,$3,DATE '1990-01-01','RU','test',$4,1)`,
      [`ai-access-${id}@example.test`, 'Участник', `ai${id}`, hashSessionToken(id)],
    )
  ).rows[0]!;
}
export async function aiClassroomFixture(admin: pg.Pool) {
  const teacher = await aiIdentity(admin);
  await admin.query(
    `INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by)
    VALUES($1,'educator','verified','test','admin')`,
    [teacher.account_id],
  );
  const context = (
    await admin.query<{
      tenant_id: string;
      school_id: string;
      academic_period_id: string;
      user_id: string;
    }>('SELECT * FROM classroom_ensure_personal_teacher($1)', [teacher.account_id])
  ).rows[0]!;
  const classroomId = (
    await admin.query<{ id: string }>(
      `INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,'Класс ИИ',$4) RETURNING id`,
      [context.tenant_id, context.school_id, context.academic_period_id, context.user_id],
    )
  ).rows[0]!.id;
  await admin.query(
    `INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role)
    VALUES($1,$2,$3,$4,'owner')`,
    [context.tenant_id, classroomId, context.user_id, teacher.account_id],
  );
  return { teacher, context, classroomId };
}
export async function aiClassFixture(admin: pg.Pool, runtime: pg.Pool) {
  const { teacher, context, classroomId } = await aiClassroomFixture(admin);
  async function addSeat() {
    const handle = randomUUID().slice(0, 20);
    const seatId = (
      await admin.query<{ id: string }>(
        `INSERT INTO classroom_student_seats(tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,status,created_by)
       VALUES($1,$2,'Ученик',$3,$3,'active',$4) RETURNING id`,
        [context.tenant_id, classroomId, handle, context.user_id],
      )
    ).rows[0]!.id;
    const principalId = (
      await runtime.query<{ principal_id: string }>('SELECT * FROM student_seat_principal($1)', [
        seatId,
      ])
    ).rows[0]!.principal_id;
    return { seatId, principalId };
  }
  return { teacher, context, classroomId, addSeat, ...(await addSeat()) };
}

/** The same product assertions run against embedded PG and the restricted
 * runtime role in the dedicated PostgreSQL CI database. No provider network. */
export function aiStudentAccessContract(database: () => { admin: pg.Pool; runtime: pg.Pool }) {
  async function fixture() {
    const { admin, runtime } = database();
    const f = await aiClassFixture(admin, runtime);
    const access = new AiAccessService(runtime);
    const upstream = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            status: 'completed',
            output: [{ content: [{ type: 'output_text', text: 'Ответ ученику' }] }],
          }),
          { status: 200 },
        ),
    );
    const service = new AiChatService(runtime, {
      encryptionKey: '3a'.repeat(32),
      fetchImpl: upstream,
    });
    await admin.query(
      `INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by)
      VALUES($1,'platform_admin','verified','test','admin')`,
      [f.teacher.account_id],
    );
    await service.saveAdminConfig(
      f.teacher.principal_id,
      {
        enabled: true,
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKey: 'sk-access-tests-only-0000000',
        paidOperationsPerHour: 1000,
      },
      randomUUID(),
    );
    async function policy(update: Record<string, unknown>) {
      const current = await access.classroom(f.teacher.principal_id, f.classroomId);
      return access.saveClassroom(f.teacher.principal_id, f.classroomId, {
        expectedRevision: current.revision,
        requestId: randomUUID(),
        ...update,
      });
    }
    return { ...f, admin, runtime, access, service, upstream, policy };
  }

  describe('stable StudentSeat chat ownership and teacher admission', () => {
    it('fails closed for historical missing principals without initializing identity on a read or linked admission', async () => {
      const f = await fixture();
      const token = randomUUID();
      await f.runtime.query('SELECT * FROM classroom_seat_credential_issue($1,$2,$3,$4,$5)', [
        f.teacher.account_id,
        f.classroomId,
        f.seatId,
        hashSessionToken(randomUUID()),
        randomUUID(),
      ]);
      await f.admin.query(
        "INSERT INTO classroom_student_sessions(seat_id,token_hash,expires_at,credential_version) VALUES($1,$2,now()+interval '1 hour',1)",
        [f.seatId, hashSessionToken(token)],
      );
      const account = await aiIdentity(f.admin);
      await f.admin.query('UPDATE classroom_student_seats SET account_id=$2 WHERE id=$1', [
        f.seatId,
        account.account_id,
      ]);
      await f.admin.query('SELECT learning_audience_ensure_seat_identity($1)', [f.seatId]);
      await f.admin.query('DELETE FROM principals WHERE id=$1', [f.principalId]);
      expect(
        (await f.runtime.query('SELECT * FROM ai_student_principal_existing($1)', [f.seatId])).rows,
      ).toEqual([]);
      const seats = new SeatContextUseCase(f.runtime);
      expect(await seats.resolveExistingState(token)).toEqual({ state: 'unavailable_owner' });
      expect(await seats.resolveExisting(token)).toBeNull();
      await expect(f.access.owner(account.principal_id, f.seatId)).rejects.toMatchObject({
        status: 403,
      });
      expect(
        (await f.admin.query('SELECT id FROM principals WHERE seat_id=$1', [f.seatId])).rows,
      ).toEqual([]);
    });

    it('allows an invited exact-class co-teacher and denies their policy use in another class', async () => {
      const f = await fixture();
      const colleague = await aiIdentity(f.admin);
      const user = (
        await f.admin.query<{ id: string }>(
          "INSERT INTO users(tenant_id,school_id,role,email,display_name,password_hash) VALUES($1,$2,'teacher',$3,'Коллега','test-only') RETURNING id",
          [f.context.tenant_id, f.context.school_id, `co-${randomUUID()}@example.test`],
        )
      ).rows[0]!.id;
      await f.admin.query(
        "INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'co_teacher')",
        [f.context.tenant_id, f.classroomId, user, colleague.account_id],
      );
      expect(
        await f.access.saveClassroom(colleague.principal_id, f.classroomId, {
          kind: 'classroom',
          mode: 'allow',
          minimumRating: 50,
          expectedRevision: 0,
          requestId: randomUUID(),
        }),
      ).toEqual({ saved: true, revision: 1 });
      const other = await aiClassFixture(f.admin, f.runtime);
      await expect(
        f.access.classroom(colleague.principal_id, other.classroomId),
      ).rejects.toMatchObject({ status: 403 });
      await expect(f.access.owner(colleague.principal_id, f.seatId)).rejects.toMatchObject({
        status: 403,
      });
    });

    it('retains the Seat hourly cap across linkage and service recreation while Account quota stays separate', async () => {
      const f = await fixture();
      await f.policy({ kind: 'classroom', mode: 'allow', minimumRating: 50 });
      const chat = await f.service.createThread(f.principalId);
      await f.admin.query(
        'INSERT INTO ai_assistant_request_quota(owner_principal_id,request_id) SELECT $1,gen_random_uuid() FROM generate_series(1,30)',
        [f.principalId],
      );
      const account = await aiIdentity(f.admin);
      await f.admin.query('UPDATE classroom_student_seats SET account_id=$2 WHERE id=$1', [
        f.seatId,
        account.account_id,
      ]);
      await f.admin.query('SELECT learning_audience_ensure_seat_identity($1)', [f.seatId]);
      const owner = await new AiAccessService(f.runtime).owner(account.principal_id, f.seatId);
      const restarted = new AiChatService(f.runtime, {
        encryptionKey: '3a'.repeat(32),
        fetchImpl: f.upstream,
      });
      await expect(
        restarted.send(owner, chat.id, 'Сверх лимита', randomUUID()),
      ).rejects.toMatchObject({ status: 429, code: 'ai_rate_limit' });
      expect(f.upstream).not.toHaveBeenCalled();
      const personal = await restarted.createThread(account.principal_id);
      await restarted.send(account.principal_id, personal.id, 'Личный вопрос', randomUUID());
      expect(f.upstream).toHaveBeenCalledTimes(1);
    });
    it('defaults to denied, authenticates a real Seat without Account, and keeps tables private', async () => {
      const f = await fixture();
      const token = randomUUID();
      await f.runtime.query('SELECT * FROM classroom_seat_credential_issue($1,$2,$3,$4,$5)', [
        f.teacher.account_id,
        f.classroomId,
        f.seatId,
        hashSessionToken('credential-' + token),
        randomUUID(),
      ]);
      await f.admin.query(
        "INSERT INTO classroom_student_sessions(seat_id,token_hash,expires_at,credential_version) VALUES($1,$2,now()+interval '1 hour',1)",
        [f.seatId, hashSessionToken(token)],
      );
      expect(
        (
          await f.runtime.query('SELECT * FROM classroom_student_session_context($1)', [
            hashSessionToken(token),
          ])
        ).rows,
      ).toHaveLength(1);
      const seats = new SeatContextUseCase(f.runtime);
      expect(await seats.resolveExisting(token)).toMatchObject({
        principalId: f.principalId,
        seatId: f.seatId,
        userId: null,
      });
      expect(await f.access.owner(f.principalId, null)).toBe(f.principalId);
      expect(await f.access.scopes(f.principalId)).toMatchObject({
        personal: false,
        items: [{ seatId: f.seatId, canGenerate: false, reason: 'ai_teacher_permission_required' }],
      });
      await expect(f.service.createThread(f.principalId)).rejects.toThrow();
      expect(f.upstream).not.toHaveBeenCalled();
      for (const table of [
        'ai_classroom_policies',
        'ai_seat_overrides',
        'ai_classroom_policy_receipts',
        'ai_assistant_threads',
        'ai_assistant_messages',
        'ai_assistant_request_quota',
      ]) {
        await expect(f.runtime.query(`SELECT * FROM ${table}`)).rejects.toMatchObject({
          code: '42501',
        });
        expect(
          (
            await f.admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
              'SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',
              [table],
            )
          ).rows[0],
        ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      }
      await f.admin.query(
        'UPDATE classroom_student_sessions SET revoked_at=now() WHERE token_hash=$1',
        [hashSessionToken(token)],
      );
      expect(await seats.resolveExisting(token)).toBeNull();
    });

    it('applies class and individual rules and grants no teacher/foreign-seat history access', async () => {
      const f = await fixture();
      const other = await f.addSeat();
      await f.policy({ kind: 'seat', seatId: f.seatId, override: 'allow' });
      expect(await f.access.admission(f.principalId)).toMatchObject({ canGenerate: true });
      expect(await f.access.admission(other.principalId)).toMatchObject({ canGenerate: false });
      const chat = await f.service.createThread(f.principalId);
      await f.service.send(f.principalId, chat.id, 'Частный школьный вопрос', randomUUID());
      expect(await f.service.messages(f.teacher.principal_id, chat.id)).toEqual([]);
      expect(await f.service.messages(other.principalId, chat.id)).toEqual([]);
      await expect(f.access.owner(f.teacher.principal_id, f.seatId)).rejects.toMatchObject({
        status: 403,
      });
      await expect(f.access.owner(other.principalId, f.seatId)).rejects.toMatchObject({
        status: 403,
      });
      await f.policy({ kind: 'classroom', mode: 'allow', minimumRating: 50 });
      await f.policy({ kind: 'seat', seatId: f.seatId, override: 'deny' });
      expect(await f.access.admission(other.principalId)).toMatchObject({ canGenerate: true });
      expect(await f.access.admission(f.principalId)).toMatchObject({ canGenerate: false });
      const settings = await f.access.classroom(f.teacher.principal_id, f.classroomId);
      expect(JSON.stringify(settings)).not.toContain('Частный школьный вопрос');
      expect(JSON.stringify(settings)).not.toContain(chat.id);
      const stranger = await aiIdentity(f.admin);
      await f.admin.query(
        `INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')`,
        [stranger.account_id],
      );
      await expect(f.access.classroom(stranger.principal_id, f.classroomId)).rejects.toMatchObject({
        status: 403,
      });
      await expect(f.access.classroom(f.principalId, f.classroomId)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        f.access.saveClassroom(stranger.principal_id, f.classroomId, {}),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('uses current canonical rating, including null, equality, and changed factors', async () => {
      const f = await fixture();
      await f.admin.query('SELECT learning_audience_ensure_seat_identity($1)', [f.seatId]);
      await f.policy({ kind: 'classroom', mode: 'rating', minimumRating: 0 });
      const score = (
        await f.admin.query<{ score: string }>(
          "SELECT item->>'score' AS score FROM classroom_participant_metrics($1) WHERE item->>'seatId'=$2",
          [f.classroomId, f.seatId],
        )
      ).rows[0]!.score;
      expect(await f.access.admission(f.principalId)).toMatchObject({
        canGenerate: true,
        rating: Number(score),
      });
      await f.policy({ kind: 'classroom', mode: 'rating', minimumRating: 100 });
      expect(await f.access.admission(f.principalId)).toMatchObject({
        canGenerate: false,
        reason: 'ai_rating_required',
      });
      await f.admin.query(
        `INSERT INTO classroom_participant_settings(classroom_id,factors) VALUES($1,'{"projects":false,"logins":false,"days":false,"time":false,"grades":false}')`,
        [f.classroomId],
      );
      await f.policy({ kind: 'classroom', mode: 'rating', minimumRating: 0 });
      expect(await f.access.admission(f.principalId)).toMatchObject({
        canGenerate: false,
        rating: null,
        reason: 'ai_rating_unavailable',
      });
      await f.policy({ kind: 'seat', seatId: f.seatId, override: 'allow' });
      expect(await f.access.admission(f.principalId)).toMatchObject({ canGenerate: true });
      await f.admin.query("UPDATE classroom_student_seats SET status='suspended' WHERE id=$1", [
        f.seatId,
      ]);
      await expect(f.access.owner(f.principalId, null)).rejects.toMatchObject({ status: 403 });
    });

    it('keeps the same school owner after canonical Account link and rechecks unlink on every request', async () => {
      const f = await fixture();
      await f.policy({ kind: 'classroom', mode: 'allow', minimumRating: 50 });
      const school = await f.service.createThread(f.principalId);
      const requestId = randomUUID();
      await f.service.send(f.principalId, school.id, 'Сохрани мою историю', requestId);
      const account = await aiIdentity(f.admin);
      const personal = await f.service.createThread(account.principal_id);
      await f.admin.query('UPDATE classroom_student_seats SET account_id=$2 WHERE id=$1', [
        f.seatId,
        account.account_id,
      ]);
      await expect(f.access.owner(account.principal_id, f.seatId)).rejects.toMatchObject({
        status: 403,
      });
      await f.admin.query('SELECT learning_audience_ensure_seat_identity($1)', [f.seatId]);
      expect(await f.access.owner(account.principal_id, f.seatId)).toBe(f.principalId);
      expect(await f.access.owner(account.principal_id, null)).toBe(account.principal_id);
      expect(await f.service.threads(account.principal_id)).toEqual([
        expect.objectContaining({ id: personal.id }),
      ]);
      const selected = await f.access.owner(account.principal_id, f.seatId);
      expect(
        await f.service.send(selected, school.id, 'Сохрани мою историю', requestId),
      ).toMatchObject({ replayed: true });
      expect(f.upstream).toHaveBeenCalledTimes(1);
      expect((await f.service.messages(selected, school.id)).map((m) => m.role)).toEqual([
        'user',
        'assistant',
      ]);
      expect(await f.service.messages(account.principal_id, school.id)).toEqual([]);
      await f.admin.query(
        "UPDATE learner_identity_links SET status='inactive',disabled_at=now() WHERE account_id=$1 AND school_id=$2",
        [account.account_id, f.context.school_id],
      );
      await expect(f.access.owner(account.principal_id, f.seatId)).rejects.toMatchObject({
        status: 403,
      });
      expect(await f.access.scopes(account.principal_id)).toEqual({ personal: true, items: [] });
      expect(await f.service.messages(f.principalId, school.id)).toHaveLength(2);
    });

    it('revokes new admission without deleting own history or refunding requests, while replay stays free', async () => {
      const f = await fixture();
      await f.policy({ kind: 'classroom', mode: 'allow', minimumRating: 50 });
      const chat = await f.service.createThread(f.principalId);
      const requestId = randomUUID();
      await f.service.send(f.principalId, chat.id, 'Вопрос до отзыва', requestId);
      await f.policy({ kind: 'classroom', mode: 'deny', minimumRating: 50 });
      await expect(
        f.service.send(f.principalId, chat.id, 'Вопрос после отзыва', randomUUID()),
      ).rejects.toMatchObject({ code: 'ai_student_denied', status: 403 });
      expect(await f.service.messages(f.principalId, chat.id)).toHaveLength(2);
      expect(
        await f.service.send(f.principalId, chat.id, 'Вопрос до отзыва', requestId),
      ).toMatchObject({ replayed: true });
      await f.runtime.query('SELECT ai_chat_abort($1,$2,$3)', [f.principalId, chat.id, requestId]);
      expect(f.upstream).toHaveBeenCalledTimes(1);
      await f.service.deleteThread(f.principalId, chat.id);
      await f.policy({ kind: 'classroom', mode: 'allow', minimumRating: 50 });
      const next = await f.service.createThread(f.principalId);
      await expect(
        f.service.send(f.principalId, next.id, 'Вопрос до отзыва', requestId),
      ).rejects.toMatchObject({ code: 'ai_request_id_reused', status: 409 });
      const quota = await f.admin.query<{ n: number }>(
        'SELECT count(*)::integer AS n FROM ai_assistant_request_quota WHERE owner_principal_id=$1',
        [f.principalId],
      );
      expect(quota.rows[0]!.n).toBe(1);
      await f.admin.query(
        'UPDATE ai_assistant_config SET enabled=false,configuration_version=configuration_version+1',
      );
      await expect(
        f.service.send(f.principalId, next.id, 'Провайдер выключен', randomUUID()),
      ).rejects.toMatchObject({ code: 'ai_disabled' });
      expect(f.upstream).toHaveBeenCalledTimes(1);
    });

    it('guards revisions and exact lost-response replay, rejects another class Seat and stale class writes', async () => {
      const f = await fixture();
      const input = {
        kind: 'classroom',
        mode: 'allow',
        minimumRating: 50,
        expectedRevision: 0,
        requestId: randomUUID(),
      };
      const saved = await f.access.saveClassroom(f.teacher.principal_id, f.classroomId, input);
      expect(saved).toEqual({ saved: true, revision: 1 });
      expect(await f.access.saveClassroom(f.teacher.principal_id, f.classroomId, input)).toEqual(
        saved,
      );
      await expect(
        f.access.saveClassroom(f.teacher.principal_id, f.classroomId, { ...input, mode: 'deny' }),
      ).rejects.toMatchObject({ code: 'ai_request_id_reused' });
      await expect(
        f.access.saveClassroom(f.teacher.principal_id, f.classroomId, {
          ...input,
          requestId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'ai_policy_conflict' });
      await expect(
        f.policy({ kind: 'seat', seatId: randomUUID(), override: 'allow' }),
      ).rejects.toMatchObject({ status: 403 });
      const count = await f.admin.query<{ n: number }>(
        'SELECT count(*)::integer AS n FROM ai_classroom_policy_receipts WHERE classroom_id=$1',
        [f.classroomId],
      );
      expect(count.rows[0]!.n).toBe(1);
      await f.admin.query("UPDATE classrooms SET status='archived' WHERE id=$1", [f.classroomId]);
      expect(await f.access.classroom(f.teacher.principal_id, f.classroomId)).toMatchObject({
        readOnly: true,
      });
      await expect(
        f.policy({ kind: 'classroom', mode: 'allow', minimumRating: 50 }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(f.access.owner(f.principalId, null)).rejects.toMatchObject({ status: 403 });
    });

    it('enforces immutable row ownership and the message/thread relation', async () => {
      const f = await fixture();
      await f.policy({ kind: 'classroom', mode: 'allow', minimumRating: 50 });
      const thread = await f.service.createThread(f.principalId);
      const account = await aiIdentity(f.admin);
      await expect(
        f.admin.query('UPDATE ai_assistant_threads SET account_id=$2 WHERE id=$1', [
          thread.id,
          account.account_id,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        f.admin.query(
          'UPDATE ai_assistant_threads SET owner_principal_id=$2,account_id=$3 WHERE id=$1',
          [thread.id, account.principal_id, account.account_id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        f.admin.query(
          "INSERT INTO ai_assistant_messages(thread_id,owner_principal_id,account_id,request_id,role,content) VALUES($1,$2,$3,$4,'user','forged')",
          [thread.id, account.principal_id, account.account_id, randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '23503' });
      const personal = await f.service.createThread(account.principal_id);
      const requestId = randomUUID();
      await f.service.send(account.principal_id, personal.id, 'Личный вопрос', requestId);
      await f.service.send(f.principalId, thread.id, 'Школьный вопрос', requestId);
      expect(f.upstream).toHaveBeenCalledTimes(2);
    });
  });
}
