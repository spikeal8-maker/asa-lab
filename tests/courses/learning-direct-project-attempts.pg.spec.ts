import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

const policies = {
  attemptPolicy: { maxAttempts: 1 },
  resultSelectionPolicy: { mode: 'latest' },
  completionPolicy: { mode: 'submission' },
  latePolicy: { mode: 'allow_mark_late' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'after_review' },
};

let admin: pg.Pool;
let app: pg.Pool;
let owner: SeededTeacher;
let teacherPrincipal: string;
let teacherAccount: string;
let sequence = 0;

async function inTenant<T>(callback: (client: pg.PoolClient) => Promise<T>) {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [owner.tenantId]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createClass(): Promise<string> {
  const result = await admin.query(
    `INSERT INTO classrooms (tenant_id,school_id,academic_period_id,title,created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [owner.tenantId, owner.schoolId, owner.periodId, `VS002 ${++sequence}`, owner.teacherId],
  );
  const classroomId = result.rows[0].id as string;
  await admin.query(
    `INSERT INTO classroom_memberships
       (tenant_id,classroom_id,user_id,account_id,member_role)
     VALUES ($1,$2,$3,$4,'owner')`,
    [owner.tenantId, classroomId, owner.teacherId, teacherAccount],
  );
  return classroomId;
}

async function createSeat(classroomId: string, label: string): Promise<string> {
  return (
    await admin.query(
      `INSERT INTO classroom_student_seats
         (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
          safe_mode,status,created_by)
       VALUES ($1,$2,$3,$4,$4,true,'issued',$5) RETURNING id`,
      [owner.tenantId, classroomId, label, `vs002-${++sequence}`, owner.teacherId],
    )
  ).rows[0].id as string;
}

async function createActivity(
  title: string,
  selection = 'latest',
  graded = false,
  maxAttempts = 1,
): Promise<string> {
  const authored = await admin.query(
    `INSERT INTO teacher_assignments
       (tenant_id,owner_principal_id,title,brief,module_key,visibility)
     VALUES ($1,$2,$3,'Соберите цепь.','electronics','private') RETURNING id`,
    [owner.tenantId, teacherPrincipal, title],
  );
  const created = await inTenant((client) =>
    client.query(
      `SELECT * FROM learning_activity_create(
       $1,$2,'school','private','project',$3,'ignored',$7,$8,
       $4::jsonb,'electronics',NULL,NULL,$5,$6)`,
      [
        teacherPrincipal,
        owner.tenantId,
        title,
        JSON.stringify({
          ...policies,
          attemptPolicy: { maxAttempts },
          resultSelectionPolicy: { mode: selection },
        }),
        authored.rows[0].id,
        `vs002:create:${++sequence}`,
        graded ? 'graded' : 'completion',
        graded ? 10 : null,
      ],
    ),
  );
  const published = await inTenant((client) =>
    client.query(`SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)`, [
      teacherPrincipal,
      owner.tenantId,
      created.rows[0].activity_id,
      `vs002:publish:${++sequence}`,
    ]),
  );
  return published.rows[0].activity_version_id as string;
}

async function assign(
  classroomId: string,
  versionId: string,
  audience: 'whole_class' | 'named_learners',
  seats: string[] = [],
): Promise<string> {
  const result = await inTenant((client) =>
    client.query(
      `SELECT * FROM learning_direct_assignment_create(
       $1,$2,$3,$4,'2027-05-30T20:59:00Z',$5,$6::uuid[],$7)`,
      [
        teacherPrincipal,
        owner.tenantId,
        classroomId,
        versionId,
        audience,
        seats,
        `vs002:assign:${++sequence}`,
      ],
    ),
  );
  expect(result.rows[0].result_code).toBe('ok');
  return result.rows[0].classroom_assignment_id as string;
}

async function activateSeat(seatId: string): Promise<string> {
  await admin.query(`UPDATE classroom_student_seats SET status='active' WHERE id=$1`, [seatId]);
  return (await admin.query(`SELECT principal_id FROM student_seat_principal($1)`, [seatId]))
    .rows[0].principal_id as string;
}

async function createProject(principalId: string, title: string): Promise<string> {
  const project = await admin.query(
    `INSERT INTO projects
       (tenant_id,project_scope,module_key,title,owner_principal_id)
     VALUES ($1,'personal','electronics',$2,$3) RETURNING id`,
    [owner.tenantId, title, principalId],
  );
  await admin.query(
    `INSERT INTO project_drafts
       (tenant_id,project_id,document_json,revision,updated_by_principal_id)
     VALUES ($1,$2,$3::jsonb,1,$4)`,
    [
      owner.tenantId,
      project.rows[0].id,
      JSON.stringify({ schemaVersion: 1, components: [{ id: 'r1', type: 'resistor' }] }),
      principalId,
    ],
  );
  return project.rows[0].id as string;
}

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'learning-vs-002');
  const identity = await admin.query(
    `SELECT account_id,principal_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [owner.tenantId, owner.teacherId],
  );
  teacherAccount = identity.rows[0].account_id as string;
  teacherPrincipal = identity.rows[0].principal_id as string;
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('LRN-VS-002 canonical direct project attempt', () => {
  it('Account admission stays pending until exact-class staff approve; late whole-class enrollment is unique', async () => {
    const cls = await createClass(),
      foreign = await seedTeacher(admin, 'course01-account-join');
    const identity = (
      await admin.query(
        'SELECT account_id,principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
        [foreign.tenantId, foreign.teacherId],
      )
    ).rows[0];
    const code = 'join-test-' + crypto.randomUUID();
    await admin.query(
      'INSERT INTO classroom_join_codes(tenant_id,classroom_id,token_hash,version) VALUES($1,$2,$3,1)',
      [owner.tenantId, cls, code],
    );
    const version = await createActivity('Поздний Account'),
      assignment = await assign(cls, version, 'whole_class');
    expect(
      (
        await app.query('SELECT * FROM classroom_join_with_account($1,$2)', [
          identity.account_id,
          code,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (await app.query('SELECT * FROM classroom_account_seats($1)', [identity.account_id])).rows,
    ).toHaveLength(0);
    await expect(
      app.query('SELECT * FROM classroom_account_join_materialize_internal($1,$2)', [
        identity.account_id,
        code,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    const request = (
      await app.query('SELECT * FROM classroom_account_request_join($1,$2)', [
        identity.account_id,
        code,
      ])
    ).rows[0];
    expect(request).toMatchObject({ seat_id: null, status: 'pending', classroom_id: cls });
    expect(
      (
        await app.query('SELECT * FROM classroom_account_request_join($1,$2)', [
          identity.account_id,
          code,
        ])
      ).rows[0].request_id,
    ).toBe(request.request_id);
    expect(
      (await app.query('SELECT * FROM classroom_account_seats($1)', [identity.account_id])).rows,
    ).toHaveLength(0);
    expect(
      (
        await app.query(
          "SELECT classroom_account_join_decide($1,$2,$3,$4,'approved',NULL) AS code",
          [identity.account_id, identity.principal_id, cls, request.request_id],
        )
      ).rows[0].code,
    ).toBe('forbidden');
    const approve = () =>
      app.query("SELECT classroom_account_join_decide($1,$2,$3,$4,'approved',NULL) AS code", [
        teacherAccount,
        teacherPrincipal,
        cls,
        request.request_id,
      ]);
    expect((await approve()).rows[0].code).toBe('ok');
    expect((await approve()).rows[0].code).toBe('ok');
    const seat = (
      await app.query('SELECT * FROM classroom_account_seats($1)', [identity.account_id])
    ).rows[0];
    expect(seat.classroom_id).toBe(cls);
    expect(
      (
        await admin.query(
          'SELECT p.id FROM activity_participations p JOIN activity_runs run ON run.id=p.activity_run_id JOIN learner_identity_links link ON link.learner_identity_id=p.learner_identity_id WHERE run.source_classroom_assignment_id=$1 AND link.seat_id=$2',
          [assignment, seat.seat_id],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await app.query('SELECT * FROM classroom_join_with_account($1,$2)', [
          identity.account_id,
          code,
        ])
      ).rows[0],
    ).toMatchObject({ seat_id: seat.seat_id, classroom_id: cls, already_member: true });
    await admin.query("UPDATE classroom_student_seats SET status='suspended' WHERE id=$1", [
      seat.seat_id,
    ]);
    expect(
      (
        await app.query('SELECT * FROM classroom_join_with_account($1,$2)', [
          identity.account_id,
          code,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await app.query('SELECT * FROM classroom_account_request_join($1,$2)', [
          identity.account_id,
          code,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  it('persisted notifications respect own preferences, class overrides, reminder policy and current access', async () => {
    const cls = await createClass(),
      seat = await createSeat(cls, 'Оповещения'),
      excluded = await createSeat(cls, 'Не назначено');
    const learner = await activateSeat(seat),
      other = await activateSeat(excluded),
      version = await createActivity('События без шума');
    const preferences = async (actor: string) =>
      (await app.query('SELECT learning_notification_preferences_get($1) AS x', [actor])).rows[0].x;
    const save = async (actor: string, master: boolean, categories: unknown, rules: unknown) => {
      const previous = await preferences(actor),
        request = 'notify:pref:' + ++sequence;
      const args = [
        actor,
        previous.revision,
        master,
        JSON.stringify(categories),
        JSON.stringify(rules),
        request,
      ];
      const result = await app.query(
        'SELECT learning_notification_preferences_save($1,$2,$3,$4::jsonb,$5::jsonb,$6) AS code',
        args,
      );
      expect(result.rows[0].code).toBe('ok');
      expect(
        (
          await app.query(
            'SELECT learning_notification_preferences_save($1,$2,$3,$4::jsonb,$5::jsonb,$6) AS code',
            args,
          )
        ).rows[0].code,
      ).toBe('ok');
    };
    const inbox = async (actor: string) =>
      (await app.query('SELECT item FROM learning_notifications_list($1)', [actor])).rows.map(
        (r) => r.item,
      );
    const count = async (actor: string) =>
      (await app.query('SELECT learning_notifications_unread($1) AS n', [actor])).rows[0].n;
    const defaults = (await preferences(learner)).categories;
    expect(defaults).toMatchObject({
      NC01: true,
      NC02: true,
      NC03: true,
      NC04: false,
      NC05: false,
      NC06: false,
    });
    const assignment = await assign(cls, version, 'named_learners', [seat]);
    expect((await inbox(learner)).filter((n) => n.assignmentId === assignment)).toHaveLength(1);
    expect((await inbox(other)).filter((n) => n.assignmentId === assignment)).toHaveLength(0);
    expect(await count(learner)).toBe(1);
    await save(learner, false, defaults, { [cls]: { mode: 'custom', categories: { NC01: 'on' } } });
    const muted = await assign(cls, version, 'named_learners', [seat]);
    expect((await inbox(learner)).some((n) => n.assignmentId === muted)).toBe(false);
    expect(await count(learner)).toBe(1); // OFF does not erase already-delivered unread.
    await save(learner, true, defaults, {});
    expect((await inbox(learner)).some((n) => n.assignmentId === muted)).toBe(false); // no replay.
    await save(learner, true, defaults, { [cls]: { mode: 'off' } });
    const classMuted = await assign(cls, version, 'named_learners', [seat]);
    expect((await inbox(learner)).some((n) => n.assignmentId === classMuted)).toBe(false);
    await save(
      learner,
      true,
      { ...defaults, NC01: false, NC04: true, NC05: true },
      { [cls]: { mode: 'custom', categories: { NC01: 'on' } } },
    );
    const override = await assign(cls, version, 'named_learners', [seat]);
    expect((await inbox(learner)).some((n) => n.assignmentId === override)).toBe(true);
    const setDue = async (due: string) => {
      const state = (
        await app.query('SELECT learning_conditions_for_teacher($1,$2,$3,NULL) AS x', [
          teacherAccount,
          cls,
          assignment,
        ])
      ).rows[0].x;
      expect(
        (
          await app.query(
            "SELECT learning_conditions_save($1,$2,$3,$4,NULL,$5,$6::jsonb,'Срок',$7) AS code",
            [
              teacherAccount,
              teacherPrincipal,
              cls,
              assignment,
              state.revision,
              JSON.stringify({ dueAt: due }),
              'notify:due:' + ++sequence,
            ],
          )
        ).rows[0].code,
      ).toBe('ok');
    };
    await setDue(new Date(Date.now() + 3600000).toISOString());
    await app.query('SELECT learning_notification_sweep()');
    expect(
      (await inbox(learner)).filter((n) => n.kind === 'NF13' && n.assignmentId === assignment),
    ).toHaveLength(0); // class OFF
    await app.query('SELECT learning_class_reminders($1,$2,1,true,true)', [teacherPrincipal, cls]);
    // This suppressed deadline episode is not replayed. An actual changed deadline is a new episode.
    await setDue(new Date(Date.now() + 7200000).toISOString());
    await Promise.all([
      app.query('SELECT learning_notification_sweep()'),
      app.query('SELECT learning_notification_sweep()'),
    ]);
    expect(
      (await inbox(learner)).filter((n) => n.kind === 'NF13' && n.assignmentId === assignment),
    ).toHaveLength(1);
    const project = await createProject(learner, 'Сданное');
    const start = (
      await app.query('SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)', [
        learner,
        seat,
        assignment,
        project,
      ])
    ).rows[0];
    await save(teacherPrincipal, true, { ...defaults, NC02: false }, {});
    const submitted = (
      await app.query('SELECT * FROM learning_direct_project_submission_create($1,$2,$3,$4,1)', [
        learner,
        seat,
        assignment,
        'notify:submit:' + ++sequence,
      ])
    ).rows[0];
    expect(submitted.result_code).toBe('ok');
    expect(
      (await inbox(teacherPrincipal)).filter((n) => n.attemptId === start.attempt_id),
    ).toHaveLength(0);
    expect(
      (
        await app.query('SELECT * FROM classroom_gradebook_list($1,$2)', [teacherAccount, cls])
      ).rows.find((r) => r.assignment_id === assignment && r.seat_id === seat).attempt_state,
    ).toBe('submitted');
    await setDue(new Date(Date.now() - 3600000).toISOString());
    await app.query('SELECT learning_notification_sweep()');
    expect(
      (await inbox(learner)).filter((n) => n.kind === 'NF14' && n.assignmentId === assignment),
    ).toHaveLength(0); // waiting review is not debt
    const own = (await inbox(learner))[0];
    await app.query('SELECT learning_notifications_mark_read($1,$2::uuid[],now())', [
      other,
      [own.id],
    ]);
    expect((await inbox(learner)).find((n) => n.id === own.id).readAt).toBeNull();
    await expect(app.query('SELECT * FROM learning_notifications')).rejects.toMatchObject({
      code: '42501',
    });
    await admin.query("UPDATE classroom_student_seats SET status='suspended' WHERE id=$1", [seat]);
    expect(await inbox(learner)).toHaveLength(0);
    expect(
      (
        await app.query(
          'SELECT learning_notification_preferences_save($1,$2,true,$3::jsonb,$4::jsonb,$5) AS code',
          [
            other,
            (await preferences(other)).revision,
            JSON.stringify(defaults),
            JSON.stringify({ [crypto.randomUUID()]: { mode: 'off' } }),
            'notify:foreign:' + ++sequence,
          ],
        )
      ).rows[0].code,
    ).toBe('forbidden');
  });
  it('operational conditions distinguish inherit/no-limit and enforce the same start/submit boundary', async () => {
    const cls = await createClass();
    const seat = await createSeat(cls, 'Срок');
    const version = await createActivity('Окно сдачи');
    const assignment = await assign(cls, version, 'whole_class');
    const learner = await activateSeat(seat);
    const project = await createProject(learner, 'До срока');
    const settings = async (student: string | null) =>
      (
        await inTenant((c) =>
          c.query('SELECT learning_conditions_for_teacher($1,$2,$3,$4) AS x', [
            teacherAccount,
            cls,
            assignment,
            student,
          ]),
        )
      ).rows[0].x;
    const change = async (
      student: string | null,
      rev: number,
      overrides: unknown,
      request: string,
    ) =>
      (
        await inTenant((c) =>
          c.query(
            "SELECT learning_conditions_save($1,$2,$3,$4,$5,$6,$7::jsonb,'Перенос срока',$8) AS code",
            [
              teacherAccount,
              teacherPrincipal,
              cls,
              assignment,
              student,
              rev,
              JSON.stringify(overrides),
              request,
            ],
          ),
        )
      ).rows[0].code;
    const run = await settings(null);
    expect(
      await change(
        null,
        run.revision,
        { opensAt: '2090-01-01T00:00:00.000Z', dueAt: '2090-02-01T00:00:00.000Z' },
        'conditions:future:' + ++sequence,
      ),
    ).toBe('ok');
    const start = async () =>
      (
        await inTenant((c) =>
          c.query('SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)', [
            learner,
            seat,
            assignment,
            project,
          ]),
        )
      ).rows[0];
    expect((await start()).result_code).toBe('not_available');
    const individual = await settings(seat);
    expect(
      await change(
        seat,
        individual.revision,
        { opensAt: null },
        'conditions:individual:' + ++sequence,
      ),
    ).toBe('ok');
    expect((await settings(seat)).effective).toMatchObject({
      values: { opensAt: null },
      sources: { opensAt: 'participation_override' },
    });
    const a = await start();
    expect(a.result_code).toBe('ok');
    const updated = await settings(null);
    expect(
      await change(
        null,
        updated.revision,
        { opensAt: null, dueAt: '2020-01-01T00:00:00.000Z', latePolicy: 'block_at_due' },
        'conditions:past:' + ++sequence,
      ),
    ).toBe('ok');
    expect(
      (
        await inTenant((c) =>
          c.query('SELECT * FROM learning_direct_project_submission_create($1,$2,$3,$4,1)', [
            learner,
            seat,
            assignment,
            'conditions:submit:' + ++sequence,
          ]),
        )
      ).rows[0].result_code,
    ).toBe('not_available');
    const personal = await settings(seat);
    const request = 'conditions:no-due:' + ++sequence;
    expect(await change(seat, personal.revision, { opensAt: null, dueAt: null }, request)).toBe(
      'ok',
    );
    expect(await change(seat, personal.revision, { opensAt: null, dueAt: null }, request)).toBe(
      'ok',
    );
    expect(await change(seat, personal.revision, {}, 'conditions:stale:' + ++sequence)).toBe(
      'conditions_conflict',
    );
    expect(
      (
        await inTenant((c) =>
          c.query('SELECT * FROM learning_direct_project_submission_create($1,$2,$3,$4,1)', [
            learner,
            seat,
            assignment,
            'conditions:submit:' + ++sequence,
          ]),
        )
      ).rows[0].result_code,
    ).toBe('ok');
    const snap = (
      await admin.query('SELECT effective_conditions_at_start FROM learning_attempts WHERE id=$1', [
        a.attempt_id,
      ])
    ).rows[0].effective_conditions_at_start;
    expect(snap.values.dueAt).toMatch(/^2090-02-01/);
  });
  it('audits individual allowance with CAS, exact replay, no lost review allowance and no cross-class authority', async () => {
    const cls = await createClass(),
      seat = await createSeat(cls, 'Исключение'),
      version = await createActivity('Дополнительная попытка');
    const assignment = await assign(cls, version, 'whole_class');
    const save = async (
      revision: number,
      extra: number,
      key: string,
      excuse = false,
      actor = teacherPrincipal,
    ) =>
      (
        await app.query(
          "SELECT learning_participation_conditions_save($1,$2,$3,$4,$5,$6,$7,true,$8,'Индивидуальная поддержка',$9) AS code",
          [teacherAccount, actor, cls, assignment, seat, revision, extra, excuse, key],
        )
      ).rows[0].code;
    const request = 'allowance:' + ++sequence;
    expect(await save(1, 2, request)).toBe('ok');
    expect(await save(1, 2, request)).toBe('ok');
    expect(await save(1, 3, request)).toBe('request_conflict');
    expect(await save(1, 3, 'allowance:stale:' + ++sequence)).toBe('conditions_conflict');
    expect(await save(2, 1, 'allowance:erase:' + ++sequence)).toBe('invalid_conditions');
    expect(await save(2, 3, 'allowance:foreign:' + ++sequence, false, crypto.randomUUID())).toBe(
      'forbidden',
    );
    expect(await save(2, 2, 'allowance:excuse:' + ++sequence, true)).toBe('ok');
    const settings = (
      await app.query('SELECT learning_conditions_for_teacher($1,$2,$3,$4) AS value', [
        teacherAccount,
        cls,
        assignment,
        seat,
      ])
    ).rows[0].value;
    expect(settings).toMatchObject({
      revision: 3,
      effective: { extraAttempts: 2, teacherUnlocked: true },
    });
    const impact = (
      await app.query('SELECT learning_conditions_impact($1,$2,$3,$4) AS value', [
        teacherAccount,
        cls,
        assignment,
        seat,
      ])
    ).rows[0].value;
    expect(impact).toEqual({
      participants: 1,
      activeAttempts: 0,
      submittedAttempts: 0,
      excused: true,
    });
    const learner = await activateSeat(seat),
      project = await createProject(learner, 'Освобождён');
    expect(
      (
        await inTenant((c) =>
          c.query('SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)', [
            learner,
            seat,
            assignment,
            project,
          ]),
        )
      ).rows[0].result_code,
    ).toBe('forbidden');
  });
  for (const policy of ['first', 'latest', 'best', 'latest_accepted', 'teacher_selected'])
    it('selects exact graded revisions: ' + policy, async () => {
      const cls = await createClass();
      const seat = await createSeat(cls, 'Политика ' + policy);
      const version = await createActivity('Результаты ' + policy, policy, true, 4);
      const assignment = await assign(cls, version, 'whole_class');
      const learner = await activateSeat(seat);
      const project = await createProject(learner, 'Проверка выбора');
      const attempts: Array<{ id: string; result: string }> = [];
      let part = '';
      for (const points of [6, 8, 8]) {
        const start = (
          await inTenant((c) =>
            c.query('SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)', [
              learner,
              seat,
              assignment,
              project,
            ]),
          )
        ).rows[0];
        expect(start.result_code).toBe('ok');
        part = start.participation_id;
        const submission = (
          await inTenant((c) =>
            c.query('SELECT * FROM learning_direct_project_submission_create($1,$2,$3,$4,1)', [
              learner,
              seat,
              assignment,
              'selection:submit:' + ++sequence,
            ]),
          )
        ).rows[0];
        expect(submission.result_code).toBe('ok');
        const review = (
          await inTenant((c) =>
            c.query(
              "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'accepted',$5,NULL,NULL,NULL,$6)",
              [
                teacherAccount,
                teacherPrincipal,
                cls,
                start.attempt_id,
                points,
                'selection:review:' + ++sequence,
              ],
            ),
          )
        ).rows[0];
        expect(review.result_code).toBe('ok');
        attempts.push({ id: start.attempt_id, result: review.assessment_result_id });
      }
      if (policy === 'teacher_selected') {
        expect(
          (
            await inTenant((c) =>
              c.query('SELECT * FROM learning_canonical_evidence_for_seat($1)', [seat]),
            )
          ).rows[0].evidence.selectedRevision,
        ).toBeNull();
        expect(
          (
            await inTenant((c) =>
              c.query(
                "SELECT learning_teacher_select_attempt($1,$2,$3,$4,$5,NULL,'Выбор преподавателя',$6) AS code",
                [
                  teacherAccount,
                  teacherPrincipal,
                  cls,
                  part,
                  attempts[1]!.id,
                  'selection:explicit:' + ++sequence,
                ],
              ),
            )
          ).rows[0].code,
        ).toBe('ok');
        const explicitGrade = (
          await admin.query(
            'SELECT accepted_attempt_id,assessment_result_id FROM gradebook_entries WHERE classroom_assignment_id=$1 AND seat_id=$2',
            [assignment, seat],
          )
        ).rows[0];
        expect(explicitGrade).toEqual({
          accepted_attempt_id: attempts[1]!.id,
          assessment_result_id: attempts[1]!.result,
        });
      }
      const evidence = async () =>
        (
          await inTenant((c) =>
            c.query('SELECT * FROM learning_canonical_evidence_for_seat($1)', [seat]),
          )
        ).rows[0].evidence;
      const expected =
        policy === 'first'
          ? attempts[0]!
          : policy === 'teacher_selected'
            ? attempts[1]!
            : attempts[2]!;
      expect(await evidence()).toMatchObject({
        selectedAttemptId: expected.id,
        selectedRevision: { id: expected.result },
      });
      // A later published correction may change best, never the close-time ordering.
      const corrected = (
        await inTenant((c) =>
          c.query(
            "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'accepted',9,'Точное исправление','Проверка исправлена',$5,$6)",
            [
              teacherAccount,
              teacherPrincipal,
              cls,
              attempts[0]!.id,
              attempts[0]!.result,
              'selection:corrected:' + ++sequence,
            ],
          ),
        )
      ).rows[0];
      expect(corrected.result_code).toBe('ok');
      expect((await evidence()).selectedAttemptId).toBe(
        policy === 'best' ? attempts[0]!.id : expected.id,
      );
      if (policy === 'first' || policy === 'best')
        expect((await evidence()).selectedRevision.id).toBe(corrected.assessment_result_id);
      // Starting the fourth attempt does not erase the selected terminal result.
      await inTenant((c) =>
        c.query('SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)', [
          learner,
          seat,
          assignment,
          project,
        ]),
      );
      expect((await evidence()).selectedAttemptId).toBe(
        policy === 'best' ? attempts[0]!.id : expected.id,
      );
      // A revoked explicit key cannot silently pick a different historical result.
      // Fixture-only invalidation exercises existing historical read shapes; no product invalidation command is introduced here.
      const selectedId = (await evidence()).selectedAttemptId;
      await admin.query(
        "UPDATE learning_attempts SET state='invalidated',invalidated_at=now() WHERE id=$1",
        [selectedId],
      );
      const afterInvalidation = await evidence();
      if (policy === 'teacher_selected') {
        expect(afterInvalidation.selectedRevision).toBeNull();
      } else {
        expect(afterInvalidation.selectedAttemptId).not.toBe(selectedId);
      }
      // first/latest must retain a terminal record with no final grade instead of substituting an older score.
      if (policy === 'first' || policy === 'latest') {
        const incompleteId = afterInvalidation.selectedAttemptId;
        const incomplete = (
          await inTenant((c) =>
            c.query(
              "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'incomplete',NULL,'Нет итогового балла','Уточнение решения',$5,$6)",
              [
                teacherAccount,
                teacherPrincipal,
                cls,
                incompleteId,
                afterInvalidation.selectedRevision.id,
                'selection:incomplete:' + ++sequence,
              ],
            ),
          )
        ).rows[0];
        expect(incomplete.result_code).toBe('ok');
        expect(await evidence()).toMatchObject({
          selectedAttemptId: incompleteId,
          selectedRevision: { rawPoints: null, percentageBasisPoints: null },
        });
      }
    });
  it('keeps compatibility gradebook pointers synchronized with the canonical selected result', async () => {
    const cls = await createClass();
    const seat = await createSeat(cls, '????????????? ???????');
    const version = await createActivity('????????????? ??????????', 'latest_accepted', true, 1);
    const assignment = await assign(cls, version, 'whole_class');
    const learner = await activateSeat(seat);
    const project = await createProject(learner, '????????????? ??????????');
    const started = (
      await inTenant((client) =>
        client.query('SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)', [
          learner,
          seat,
          assignment,
          project,
        ]),
      )
    ).rows[0];
    expect(started.result_code).toBe('ok');
    await expect(
      inTenant((client) =>
        client.query('SELECT learning_gradebook_projection_sync_internal($1,$2,NULL,$3)', [
          started.participation_id,
          teacherPrincipal,
          'forbidden direct sync',
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    const submitted = (
      await inTenant((client) =>
        client.query('SELECT * FROM learning_direct_project_submission_create($1,$2,$3,$4,1)', [
          learner,
          seat,
          assignment,
          `grade-sync:submit:${++sequence}`,
        ]),
      )
    ).rows[0];
    expect(submitted.result_code).toBe('ok');
    const accepted = (
      await inTenant((client) =>
        client.query(
          "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'accepted',8,'???????',NULL,NULL,$5)",
          [
            teacherAccount,
            teacherPrincipal,
            cls,
            started.attempt_id,
            `grade-sync:accepted:${++sequence}`,
          ],
        ),
      )
    ).rows[0];
    expect(accepted.result_code).toBe('ok');
    const initialGrade = (
      await admin.query(
        'SELECT id,accepted_attempt_id,assessment_result_id FROM gradebook_entries WHERE classroom_assignment_id=$1 AND seat_id=$2',
        [assignment, seat],
      )
    ).rows[0];
    expect(initialGrade).toMatchObject({
      accepted_attempt_id: started.attempt_id,
      assessment_result_id: accepted.assessment_result_id,
    });
    await admin.query(
      "UPDATE learner_identity_links SET status='inactive',disabled_at=now() WHERE seat_id=$1",
      [seat],
    );

    const incomplete = (
      await inTenant((client) =>
        client.query(
          "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'incomplete',NULL,'????? ?????????????','????????? ?????? ?? ??????',$5,$6)",
          [
            teacherAccount,
            teacherPrincipal,
            cls,
            started.attempt_id,
            accepted.assessment_result_id,
            `grade-sync:incomplete:${++sequence}`,
          ],
        ),
      )
    ).rows[0];
    expect(incomplete.result_code).toBe('ok');
    const inactiveLinkGrade = (
      await admin.query(
        'SELECT id,accepted_attempt_id,assessment_result_id FROM gradebook_entries WHERE classroom_assignment_id=$1 AND seat_id=$2',
        [assignment, seat],
      )
    ).rows[0];
    expect(inactiveLinkGrade).toEqual({
      id: initialGrade.id,
      accepted_attempt_id: null,
      assessment_result_id: null,
    });
    await admin.query(
      "UPDATE learner_identity_links SET status='active',disabled_at=NULL WHERE seat_id=$1",
      [seat],
    );
    const clearedEvidence = (
      await inTenant((client) =>
        client.query('SELECT * FROM learning_canonical_evidence_for_seat($1)', [seat]),
      )
    ).rows[0].evidence;
    expect(clearedEvidence.selectedAttemptId).toBeNull();
    expect(clearedEvidence.selectedRevision).toBeNull();
    const clearedGrade = (
      await admin.query(
        'SELECT id,accepted_attempt_id,assessment_result_id FROM gradebook_entries WHERE classroom_assignment_id=$1 AND seat_id=$2',
        [assignment, seat],
      )
    ).rows[0];
    expect(clearedGrade).toEqual({
      id: initialGrade.id,
      accepted_attempt_id: null,
      assessment_result_id: null,
    });
    const clearedEvent = (
      await admin.query(
        'SELECT event_kind,assessment_result_id,snapshot FROM grade_change_events WHERE gradebook_entry_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
        [initialGrade.id],
      )
    ).rows[0];
    expect(clearedEvent).toMatchObject({
      event_kind: 'corrected',
      assessment_result_id: incomplete.assessment_result_id,
      snapshot: {
        projectionCleared: true,
        selectedAttemptId: null,
        selectedResultRevisionId: null,
      },
    });

    const restored = (
      await inTenant((client) =>
        client.query(
          "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'accepted',9,'??????? ????? ???????????','????????? ????????',$5,$6)",
          [
            teacherAccount,
            teacherPrincipal,
            cls,
            started.attempt_id,
            incomplete.assessment_result_id,
            `grade-sync:restored:${++sequence}`,
          ],
        ),
      )
    ).rows[0];
    expect(restored.result_code).toBe('ok');
    const restoredGrade = (
      await admin.query(
        'SELECT id,accepted_attempt_id,assessment_result_id FROM gradebook_entries WHERE classroom_assignment_id=$1 AND seat_id=$2',
        [assignment, seat],
      )
    ).rows[0];
    expect(restoredGrade).toEqual({
      id: initialGrade.id,
      accepted_attempt_id: started.attempt_id,
      assessment_result_id: restored.assessment_result_id,
    });
    expect(
      Number(
        (
          await admin.query(
            'SELECT count(*) AS count FROM grade_change_events WHERE gradebook_entry_id=$1',
            [initialGrade.id],
          )
        ).rows[0].count,
      ),
    ).toBe(3);
  });

  it('reviews completion without invented points, returns once, links revision Attempt and keeps correction history', async () => {
    const cls = await createClass();
    const seat = await createSeat(cls, 'Доработка');
    const version = await createActivity('Без числовой оценки');
    const assignment = await assign(cls, version, 'whole_class');
    const learner = await activateSeat(seat);
    const project = await createProject(learner, 'Проект для проверки');
    const start = async () =>
      (
        await inTenant((c) =>
          c.query('SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)', [
            learner,
            seat,
            assignment,
            project,
          ]),
        )
      ).rows[0];
    const submit = async () =>
      (
        await inTenant((c) =>
          c.query('SELECT * FROM learning_direct_project_submission_create($1,$2,$3,$4,1)', [
            learner,
            seat,
            assignment,
            'course01:submit:' + ++sequence,
          ]),
        )
      ).rows[0];
    const review = async (
      attempt: string,
      decision: string,
      request: string,
      prior: string | null = null,
      points: number | null = null,
    ) =>
      (
        await inTenant((c) =>
          c.query('SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
            teacherAccount,
            teacherPrincipal,
            cls,
            attempt,
            decision,
            points,
            'Проверьте соединение',
            'Причина проверки',
            prior,
            request,
          ]),
        )
      ).rows[0];
    const a = await start();
    expect(a.result_code).toBe('ok');
    expect((await submit()).result_code).toBe('ok');
    const returned = await review(
      a.attempt_id,
      'changes_requested',
      'course01:review:' + ++sequence,
    );
    expect(returned).toMatchObject({
      result_code: 'ok',
      attempt_state: 'closed',
      percentage_basis_points: null,
    });
    const retry = await review(a.attempt_id, 'changes_requested', 'course01:review:' + sequence);
    expect(retry.assessment_result_id).toBe(returned.assessment_result_id);
    const returnedLifecycle = (
      await admin.query(
        'SELECT attempt.state, result.review_decision FROM learning_attempts attempt JOIN assessment_results result ON result.attempt_id=attempt.id WHERE attempt.id=$1 ORDER BY result.revision_number DESC LIMIT 1',
        [a.attempt_id],
      )
    ).rows[0];
    expect(returnedLifecycle).toMatchObject({
      state: 'closed',
      review_decision: 'changes_requested',
    });
    expect(
      (
        await admin.query('SELECT extra_attempts FROM activity_participations WHERE id=$1', [
          a.participation_id,
        ])
      ).rows[0].extra_attempts,
    ).toBe(1);
    const b = await start();
    expect(b).toMatchObject({ result_code: 'ok', attempt_number: 2 });
    expect(b.attempt_id).not.toBe(a.attempt_id);
    expect(
      (
        await admin.query('SELECT revision_of_attempt_id FROM learning_attempts WHERE id=$1', [
          b.attempt_id,
        ])
      ).rows[0].revision_of_attempt_id,
    ).toBe(a.attempt_id);
    expect((await submit()).result_code).toBe('ok');
    expect(
      (await review(b.attempt_id, 'accepted', 'course01:bad-points:' + ++sequence, null, 100))
        .result_code,
    ).toBe('invalid_points');
    const accepted = await review(b.attempt_id, 'accepted', 'course01:accepted:' + ++sequence);
    expect(accepted.result_code).toBe('ok');
    const closed = (
      await admin.query('SELECT evaluated_at FROM learning_attempts WHERE id=$1', [b.attempt_id])
    ).rows[0].evaluated_at;
    const correction = await review(
      b.attempt_id,
      'accepted',
      'course01:corrected:' + ++sequence,
      accepted.assessment_result_id,
    );
    expect(correction.result_code).toBe('ok');
    expect(
      (
        await review(
          b.attempt_id,
          'accepted',
          'course01:stale:' + ++sequence,
          accepted.assessment_result_id,
        )
      ).result_code,
    ).toBe('result_revision_conflict');
    const rows = (
      await admin.query(
        'SELECT * FROM assessment_results WHERE attempt_id=$1 ORDER BY revision_number',
        [b.attempt_id],
      )
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      supersedes_result_id: rows[0].id,
      max_points: null,
      raw_points: null,
      completion_value: true,
    });
    expect(
      (await admin.query('SELECT evaluated_at FROM learning_attempts WHERE id=$1', [b.attempt_id]))
        .rows[0].evaluated_at,
    ).toEqual(closed);
    expect((await start()).result_code).toBe('attempt_limit_reached');
    await admin.query(
      'UPDATE gradebook_entries SET assessment_result_id=$2 WHERE classroom_assignment_id=$1',
      [assignment, accepted.assessment_result_id],
    );
    const evidence = (
      await inTenant((c) =>
        c.query('SELECT * FROM learning_canonical_evidence_for_seat($1)', [seat]),
      )
    ).rows[0].evidence;
    expect(evidence).toMatchObject({
      resultSelectionSource: 'canonical',
      selectedAttemptId: b.attempt_id,
      selectedRevision: {
        id: correction.assessment_result_id,
        rawPoints: null,
        maxPoints: null,
        completionValue: true,
      },
    });
  });
  it('keeps the pre-E1 four-argument submit contract safe during DB-first rollout', async () => {
    const classroomId = await createClass();
    const seatId = await createSeat(classroomId, 'Rollout learner');
    const versionId = await createActivity('Rollout submission');
    const assignmentId = await assign(classroomId, versionId, 'whole_class');
    const learnerPrincipal = await activateSeat(seatId);
    const projectId = await createProject(learnerPrincipal, 'Rollout project');
    const started = (
      await inTenant((client) =>
        client.query('SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)', [
          learnerPrincipal,
          seatId,
          assignmentId,
          projectId,
        ]),
      )
    ).rows[0];
    expect(started.result_code).toBe('ok');

    await admin.query(
      `UPDATE project_drafts
          SET revision=3,document_json='{"schemaVersion":1,"components":[{"id":"bridge","type":"resistor"}]}'::jsonb
        WHERE project_id=$1`,
      [projectId],
    );
    const stale = (
      await inTenant((client) =>
        client.query('SELECT * FROM learning_direct_project_submission_create($1,$2,$3,$4,$5)', [
          learnerPrincipal,
          seatId,
          assignmentId,
          `rollout:stale:${++sequence}`,
          1,
        ]),
      )
    ).rows[0];
    expect(stale.result_code).toBe('project_revision_conflict');
    expect(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM learning_submissions WHERE attempt_id=$1',
          [started.attempt_id],
        )
      ).rows[0].n,
    ).toBe(0);

    const bridged = (
      await inTenant((client) =>
        client.query('SELECT * FROM learning_direct_project_submission_create($1,$2,$3,$4)', [
          learnerPrincipal,
          seatId,
          assignmentId,
          `rollout:legacy:${++sequence}`,
        ]),
      )
    ).rows[0];
    expect(bridged).toMatchObject({
      result_code: 'ok',
      attempt_id: started.attempt_id,
      attempt_state: 'submitted',
      project_id: projectId,
      reused: false,
    });
    const evidence = (
      await admin.query(
        `SELECT submission.payload_manifest,version.document_json
           FROM learning_submissions submission
           JOIN project_versions version ON version.id=submission.project_version_id
          WHERE submission.id=$1`,
        [bridged.submission_id],
      )
    ).rows[0];
    expect(evidence.payload_manifest.sourceRevision).toBe(3);
    expect(evidence.document_json).toMatchObject({
      schemaVersion: 1,
      components: [{ id: 'bridge', type: 'resistor' }],
    });
  });

  it('starts once, freezes the exact project, and submits idempotently', async () => {
    const classroomId = await createClass();
    const seatId = await createSeat(classroomId, 'Анна');
    const versionId = await createActivity('Светодиод и резистор');
    const assignmentId = await assign(classroomId, versionId, 'whole_class');
    const learnerPrincipal = await activateSeat(seatId);
    const projectId = await createProject(learnerPrincipal, 'Работа Анны');

    const start = async () =>
      (
        await inTenant((client) =>
          client.query(`SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)`, [
            learnerPrincipal,
            seatId,
            assignmentId,
            projectId,
          ]),
        )
      ).rows[0] as Record<string, unknown>;

    const first = await start();
    const retry = await start();
    expect(first).toMatchObject({ result_code: 'ok', attempt_state: 'in_progress', reused: false });
    expect(retry).toMatchObject({
      result_code: 'ok',
      participation_id: first.participation_id,
      attempt_id: first.attempt_id,
      reused: true,
    });

    const lineage = await admin.query(
      `SELECT attempt.activity_participation_id,attempt.learner_identity_id,
              attempt.state,participation.status,run.source_classroom_assignment_id
         FROM learning_attempts attempt
         JOIN activity_participations participation
           ON participation.id=attempt.activity_participation_id
         JOIN activity_runs run ON run.id=participation.activity_run_id
        WHERE attempt.id=$1`,
      [first.attempt_id],
    );
    expect(lineage.rows[0]).toMatchObject({
      activity_participation_id: first.participation_id,
      state: 'in_progress',
      status: 'active',
      source_classroom_assignment_id: assignmentId,
    });

    const requestId = `vs002:submit:${++sequence}`;
    const submit = async (id: string, revision = 1, actor = learnerPrincipal) =>
      (
        await inTenant((client) =>
          client.query(`SELECT * FROM learning_direct_project_submission_create($1,$2,$3,$4,$5)`, [
            actor,
            seatId,
            assignmentId,
            id,
            revision,
          ]),
        )
      ).rows[0] as Record<string, unknown>;

    expect((await submit(requestId, 0)).result_code).toBe('project_revision_conflict');
    expect(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM learning_submissions WHERE attempt_id=$1',
          [first.attempt_id],
        )
      ).rows[0].n,
    ).toBe(0);
    const submitted = await submit(requestId);
    await admin.query(
      `UPDATE project_drafts SET revision=2,document_json='{"schemaVersion":1,"components":[]}' WHERE project_id=$1`,
      [projectId],
    );
    const submitRetry = await submit(requestId);
    expect((await submit(requestId, 2)).result_code).toBe('request_conflict');
    expect((await submit(requestId, 1, teacherPrincipal)).result_code).toBe('forbidden');
    expect(submitted).toMatchObject({
      result_code: 'ok',
      participation_id: first.participation_id,
      attempt_id: first.attempt_id,
      attempt_state: 'submitted',
      project_id: projectId,
      reused: false,
    });
    expect(submitRetry).toMatchObject({
      result_code: 'ok',
      attempt_id: first.attempt_id,
      submission_id: submitted.submission_id,
      project_version_id: submitted.project_version_id,
      reused: true,
    });

    const frozen = await admin.query(
      `SELECT submission.project_id,submission.project_version_id,
              version.document_json,attempt.state,work.submitted_at
         FROM learning_submissions submission
         JOIN learning_attempts attempt ON attempt.id=submission.attempt_id
         JOIN project_versions version ON version.id=submission.project_version_id
         JOIN classroom_assignment_work work
           ON work.assignment_id=attempt.classroom_assignment_id
          AND work.seat_id=attempt.seat_id
        WHERE submission.id=$1`,
      [submitted.submission_id],
    );
    expect(frozen.rows[0]).toMatchObject({
      project_id: projectId,
      state: 'submitted',
      document_json: { schemaVersion: 1, components: [{ id: 'r1', type: 'resistor' }] },
    });
    expect(frozen.rows[0].submitted_at).not.toBeNull();

    const distinctRetry = await submit(`vs002:submit:${++sequence}`);
    expect(distinctRetry.result_code).toBe('attempt_already_submitted');
    const counts = await admin.query(
      `SELECT
         (SELECT count(*)::int FROM learning_attempts
           WHERE activity_participation_id=$1) AS attempts,
         (SELECT count(*)::int FROM learning_submissions
           WHERE attempt_id=$2) AS submissions`,
      [first.participation_id, first.attempt_id],
    );
    expect(counts.rows[0]).toEqual({ attempts: 1, submissions: 1 });
    await admin.query(`UPDATE classroom_student_seats SET status='suspended' WHERE id=$1`, [
      seatId,
    ]);
    expect((await submit(requestId)).result_code).toBe('forbidden');
    expect(
      (
        await inTenant((client) =>
          client.query('SELECT * FROM learning_direct_project_submission_create($1,$2,$3,$4)', [
            learnerPrincipal,
            seatId,
            assignmentId,
            requestId,
          ]),
        )
      ).rows[0].result_code,
    ).toBe('forbidden');
  });

  it('denies excluded and suspended learners and runtime table CRUD', async () => {
    const classroomId = await createClass();
    const includedSeat = await createSeat(classroomId, 'Борис');
    const excludedSeat = await createSeat(classroomId, 'Вера');
    const versionId = await createActivity('Точная цепь');
    const assignmentId = await assign(classroomId, versionId, 'named_learners', [includedSeat]);
    const excludedPrincipal = await activateSeat(excludedSeat);
    const excludedProject = await createProject(excludedPrincipal, 'Чужая работа');

    const denied = await inTenant((client) =>
      client.query(`SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)`, [
        excludedPrincipal,
        excludedSeat,
        assignmentId,
        excludedProject,
      ]),
    );
    expect(denied.rows[0].result_code).toBe('forbidden');
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM learning_attempts
            WHERE classroom_assignment_id=$1 AND seat_id=$2`,
          [assignmentId, excludedSeat],
        )
      ).rows[0].count,
    ).toBe(0);

    const includedPrincipal = await activateSeat(includedSeat);
    const includedProject = await createProject(includedPrincipal, 'Работа Бориса');
    await admin.query(`UPDATE classroom_student_seats SET status='suspended' WHERE id=$1`, [
      includedSeat,
    ]);
    const suspended = await inTenant((client) =>
      client.query(`SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)`, [
        includedPrincipal,
        includedSeat,
        assignmentId,
        includedProject,
      ]),
    );
    expect(suspended.rows[0].result_code).toBe('forbidden');

    await expect(
      inTenant((client) =>
        client.query(
          `INSERT INTO learning_attempts
             (tenant_id,classroom_id,classroom_assignment_id,
              learning_activity_version_id,seat_id,attempt_number)
           VALUES ($1,$2,$3,$4,$5,99)`,
          [owner.tenantId, classroomId, assignmentId, versionId, excludedSeat],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      inTenant((client) => client.query(`UPDATE learning_submissions SET late_state='late'`)),
    ).rejects.toThrow(/permission denied/);
  });
});
