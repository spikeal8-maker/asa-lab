import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { ClassroomsController } from './classrooms.controller';
import { LearningCanonicalProjectionService } from './learning-canonical-projection.service';
import { loadStudentCodeProtectionConfig, protectStudentCode } from './student-code-protection';

const classroomId = '10000000-0000-4000-8000-000000000001';
const tenantId = '20000000-0000-4000-8000-000000000001';
const accountId = '30000000-0000-4000-8000-000000000001';
const request = { cookies: { asa_session: 'test-session' } } as unknown as FastifyRequest;
function seat(id: string, handle: string) {
  return {
    id,
    login_handle: handle,
    display_label: 'Проверочный участник',
    account_id: accountId,
    safe_mode: true,
    status: 'active',
    avatar_key: null,
    last_active_at: null,
    created_at: '2026-10-09T00:00:00.000Z',
  };
}
const accountSeat = seat('40000000-0000-4000-8000-000000000001', 'acc:1234567890abcdef1234');
// Both rows have an Account. Admission through a real code must remain available.
const linkedSeat = seat('40000000-0000-4000-8000-000000000002', 'Ab7kQ2');
function envelope() {
  const config = loadStudentCodeProtectionConfig()!;
  const protectedCode = protectStudentCode(config, {
    tenantId,
    classroomId,
    seatId: linkedSeat.id,
    credentialVersion: 1,
    studentCode: linkedSeat.login_handle,
  });
  return {
    seat_id: linkedSeat.id,
    tenant_id: tenantId,
    classroom_id: classroomId,
    credential_version: 1,
    credential_state: 'protected',
    encryption_key_id: protectedCode.encryptionKeyId,
    encryption_nonce: protectedCode.encryptionNonce,
    encryption_ciphertext: protectedCode.encryptionCiphertext,
    encryption_tag: protectedCode.encryptionTag,
    lookup_key_id: protectedCode.lookupKeyId,
  };
}
function controller(
  rows = [accountSeat, linkedSeat],
  protectedRows: ReturnType<typeof envelope>[] = [],
  classStatus: 'active' | 'archived' = 'active',
) {
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.includes('classroom_management_summary'))
      return {
        rows: [
          {
            id: classroomId,
            title: 'Смешанный класс',
            status: classStatus,
            age_band: 'mixed',
            topic_keys: [],
            safe_mode_default: true,
            student_count: rows.length,
            join_code_version: null,
            join_code_status: null,
            teacher_role: 'owner',
            workspace_kind: 'personal',
            workspace_title: 'Личное пространство',
            created_at: '2026-10-09T00:00:00.000Z',
            archived_at: null,
          },
        ],
      };
    if (sql.includes('classroom_management_roster'))
      return {
        rows: args.length === 3 ? rows.filter((row) => row.id === args[2]) : rows,
      };
    if (sql.includes('classroom_student_code_protected_read')) return { rows: protectedRows };
    if (sql.includes('classroom_management_update_seat')) {
      if (classStatus === 'archived') throw new Error('classroom unavailable');
      const current = rows.find((row) => row.id === args[2]);
      if (!current || current.login_handle !== args[4])
        throw new Error('stored handle must be preserved');
      return {
        rows: [
          {
            ...current,
            display_label: args[3],
            safe_mode: args[5],
            status: args[6],
            avatar_key: args[7],
          },
        ],
      };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const clientQuery = vi.fn(query);
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query: clientQuery, release }));
  const args = [
    {
      resolve: vi.fn(async () => ({
        accountId,
        principalId: 'principal',
        tenantId,
        workspaceKind: 'personal',
      })),
    },
    { capabilities: vi.fn(async () => [{ capability: 'educator', state: 'verified' }]) },
    {},
    {},
    {},
    { query, connect },
  ] as unknown as ConstructorParameters<typeof ClassroomsController>;
  return { instance: new ClassroomsController(...args), query, clientQuery, release, connect };
}
beforeEach(() => {
  vi.stubEnv('ASA_STUDENT_CODE_PROTECTION_MODE', 'enforced');
  vi.stubEnv(
    'ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON',
    JSON.stringify({ testEnc: Buffer.alloc(32, 0x31).toString('base64') }),
  );
  vi.stubEnv('ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID', 'testEnc');
  vi.stubEnv(
    'ASA_STUDENT_CODE_LOOKUP_KEYS_JSON',
    JSON.stringify({ testLookup: Buffer.alloc(32, 0x42).toString('base64') }),
  );
  vi.stubEnv('ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID', 'testLookup');
  vi.spyOn(LearningCanonicalProjectionService.prototype, 'forTeacher').mockResolvedValue(new Map());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('mixed roster credential readback', () => {
  it('reads the archived roster but rolls back an unavailable mutation with a client error', async () => {
    const { instance, clientQuery, release } = controller([linkedSeat], [envelope()], 'archived');
    expect((await instance.roster(request, classroomId)).items[0].studentCode).toBe(
      linkedSeat.login_handle,
    );
    await expect(
      instance.updateSeat(request, classroomId, linkedSeat.id, {
        displayLabel: 'Не сохранять',
        safeMode: false,
        status: 'active',
        avatarKey: null,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(clientQuery.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
    expect(clientQuery.mock.calls.map(([sql]) => sql)).not.toContain('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });
  it.each(['rotateJoinCode', 'revokeJoinCode'] as const)(
    'rejects %s for an archive before changing credentials',
    async (method) => {
      const { instance, query } = controller([linkedSeat], [envelope()], 'archived');
      await expect(instance[method](request, classroomId)).rejects.toMatchObject({
        status: 409,
        response: { error: { code: 'classroom_archived' } },
      });
      expect(
        query.mock.calls.some(([sql]) =>
          /classroom_management_(rotate|revoke)_join_code/.test(sql),
        ),
      ).toBe(false);
    },
  );

  it.each(['compat', 'enforced'])(
    'reads Account-only beside an encrypted Account-linked code in %s mode',
    async (mode) => {
      vi.stubEnv('ASA_STUDENT_CODE_PROTECTION_MODE', mode);
      const { instance, query } = controller(
        [accountSeat, { ...linkedSeat, login_handle: 'ZZZZ' }],
        [envelope()],
      );
      const result = await instance.roster(request, classroomId);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({
        id: accountSeat.id,
        loginMethod: 'account',
        studentCode: null,
        loginHandle: null,
      });
      expect(result.items[1]).toMatchObject({
        id: linkedSeat.id,
        loginMethod: 'student_code',
        studentCode: 'Ab7kQ2',
        loginHandle: 'Ab7kQ2',
      });
      expect(JSON.stringify(result)).not.toContain('acc:');
      expect(query.mock.calls.every(([sql]) => sql.trimStart().startsWith('SELECT'))).toBe(true);
    },
  );
  it('reads an Account-only class in enforced mode without inventing a protected Student Code', async () => {
    const { instance } = controller([accountSeat]);
    expect((await instance.roster(request, classroomId)).items[0]).toMatchObject({
      loginMethod: 'account',
      studentCode: null,
    });
  });
  it.each(['missing', 'corrupt'] as const)(
    'still fails closed for a %s protected code beside Account-only',
    async (failure) => {
      const protectedRows =
        failure === 'missing' ? [] : [{ ...envelope(), encryption_tag: Buffer.alloc(16) }];
      const { instance } = controller([accountSeat, linkedSeat], protectedRows);
      await expect(instance.roster(request, classroomId)).rejects.toMatchObject({
        status: 503,
        response: { error: { code: 'credential_storage_unavailable' } },
      });
    },
  );
  it('does not bypass broken protection configuration for Account-only', async () => {
    vi.stubEnv('ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID', 'missing');
    await expect(
      controller([accountSeat]).instance.roster(request, classroomId),
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe('credential-free classroom settings PATCH', () => {
  it('rolls back a refused protected readback on the update connection and commits only the repaired retry', async () => {
    const valid = envelope();
    const protectedRows: ReturnType<typeof envelope>[] = [
      { ...valid, encryption_tag: Buffer.alloc(16) },
    ];
    const { instance, clientQuery, release, connect } = controller([linkedSeat], protectedRows);
    const settings = {
      displayLabel: 'Подтверждённое имя',
      safeMode: false,
      status: 'active',
      avatarKey: null,
    };
    await expect(
      instance.updateSeat(request, classroomId, linkedSeat.id, settings),
    ).rejects.toMatchObject({ status: 503 });
    const statements = clientQuery.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toBe('BEGIN');
    expect(statements[2]).toContain('classroom_management_update_seat');
    expect(statements[3]).toContain('classroom_student_code_protected_read');
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(release).toHaveBeenCalledOnce();
    protectedRows[0] = valid;
    expect(
      (await instance.updateSeat(request, classroomId, linkedSeat.id, settings)).student,
    ).toMatchObject({
      safeMode: false,
      displayLabel: settings.displayLabel,
      studentCode: linkedSeat.login_handle,
    });
    expect(clientQuery.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(1);
    expect(clientQuery.mock.calls.filter(([sql]) => sql === 'ROLLBACK')).toHaveLength(1);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
  });
  it.each([undefined, null])(
    'updates Account-only settings with loginHandle=%s while preserving stored identity',
    async (loginHandle) => {
      const { instance, query } = controller([accountSeat]);
      const result = await instance.updateSeat(request, classroomId, accountSeat.id, {
        displayLabel: 'Участник с новым именем',
        safeMode: false,
        status: 'suspended',
        avatarKey: null,
        ...(loginHandle === undefined ? {} : { loginHandle }),
      });
      expect(result.student).toMatchObject({
        displayLabel: 'Участник с новым именем',
        safeMode: false,
        status: 'suspended',
        loginMethod: 'account',
        studentCode: null,
        loginHandle: null,
      });
      const update = query.mock.calls.find(([sql]) =>
        sql.includes('classroom_management_update_seat'),
      )!;
      expect(update[1][4]).toBe(accountSeat.login_handle);
      expect(
        query.mock.calls.some(([sql]) => /credential_issue|code_set|code_generate/.test(sql)),
      ).toBe(false);
    },
  );
  it('updates a linked Seat while returning its unchanged case-sensitive protected code', async () => {
    const { instance, query } = controller([{ ...linkedSeat, login_handle: 'ZZZZ' }], [envelope()]);
    const result = await instance.updateSeat(request, classroomId, linkedSeat.id, {
      displayLabel: 'Связанный участник',
      safeMode: false,
      status: 'active',
      avatarKey: null,
    });
    expect(result.student).toMatchObject({
      loginMethod: 'student_code',
      studentCode: 'Ab7kQ2',
      loginHandle: 'Ab7kQ2',
    });
    expect(
      query.mock.calls.find(([sql]) => sql.includes('classroom_management_update_seat'))![1][4],
    ).toBe('ZZZZ');
  });
  it('does not turn an optional compatibility field into code rotation', async () => {
    const { instance, query } = controller([linkedSeat], [envelope()]);
    await expect(
      instance.updateSeat(request, classroomId, linkedSeat.id, {
        displayLabel: 'Связанный участник',
        loginHandle: 'New123',
        safeMode: false,
        status: 'active',
        avatarKey: null,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { error: { code: 'student_code_endpoint_required' } },
    });
    expect(query.mock.calls.some(([sql]) => sql.includes('classroom_management_update_seat'))).toBe(
      false,
    );
  });
});
