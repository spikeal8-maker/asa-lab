import { describe, expect, it, vi } from 'vitest';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type pg from 'pg';
import { ClassroomParticipantsController } from './classroom-participants.controller.js';
import type { SeatContextUseCase } from './seat-context.js';

const classId = '11111111-1111-4111-8111-111111111111';
const seatId = '22222222-2222-4222-8222-222222222222';
function fixture() {
  const account = {
    resolve: vi.fn().mockResolvedValue({ principalId: 'account-principal', accountId: 'account' }),
  };
  const seat = {
    resolve: vi
      .fn()
      .mockResolvedValue({ principalId: 'seat-principal', seatId, classroomId: classId }),
  };
  const query = vi.fn().mockResolvedValue({ rows: [{ data: { metrics: { seatId } } }] });
  const controller = new ClassroomParticipantsController(
    account as unknown as ActiveContextUseCase,
    seat as unknown as SeatContextUseCase,
    { query } as unknown as pg.Pool,
  );
  const request = {
    cookies: { asa_session: 'account-cookie', asa_student_session: 'seat-cookie' },
  } as unknown as FastifyRequest;
  return { controller, account, seat, query, request };
}
describe('participant credential routes', () => {
  it('uses the revalidated Seat for all self reads, validates pages and never falls back to Account credentials', async () => {
    const f = fixture();
    f.query.mockResolvedValue({ rows: [{ data: { offset: 0, nextOffset: null, items: [] } }] });
    await f.controller.seatAssignments(f.request, '30');
    expect(f.query.mock.calls.at(-1)?.[1]).toEqual(['seat-principal', classId, seatId, 30]);
    await f.controller.seatGrades(f.request, '0', '30');
    expect(f.query.mock.calls.at(-1)?.[1]).toEqual(['seat-principal', classId, seatId, 0, 30]);
    await f.controller.seatHistory(f.request, seatId, '5');
    expect(f.query.mock.calls.at(-1)?.[1]).toEqual(['seat-principal', classId, seatId, seatId, 5]);
    await f.controller.seatResultHistory(f.request, seatId, '30');
    expect(f.query.mock.calls.at(-1)?.[1]).toEqual(['seat-principal', classId, seatId, seatId, 30]);
    expect(f.account.resolve).not.toHaveBeenCalled();
    f.query.mockClear();
    await expect(f.controller.seatAssignments(f.request, '100001')).rejects.toMatchObject({
      status: 400,
    });
    await expect(f.controller.seatHistory(f.request, seatId, '0')).rejects.toMatchObject({
      status: 400,
    });
    expect(f.query).not.toHaveBeenCalled();
    f.seat.resolve.mockResolvedValue(null);
    await expect(f.controller.seatGrades(f.request, undefined, undefined)).rejects.toMatchObject({
      status: 401,
    });
    await expect(f.controller.seatAssignments(f.request, undefined)).rejects.toMatchObject({
      status: 401,
    });
    expect(f.account.resolve).not.toHaveBeenCalled();
  });
  it('returns assignments without preparing/mutating learners, exposes theory progress and strips internal evidence', async () => {
    const f = fixture();
    const evidence = {
      tenantId: classId,
      schoolId: classId,
      classroomId: classId,
      classroomAssignmentId: seatId,
      kind: 'direct_project',
      dueAt: null,
      assignmentStatus: 'open',
      seatId,
      accountId: null,
      principalId: 'seat-principal',
      learnerId: seatId,
      identityResolution: 'learner_identity',
      seatStatus: 'active',
      classroomAccess: 'active',
      legacyWork: null,
      courseProgressPresent: false,
      attempt: null,
      selectedAttemptExists: false,
      resultSelectionSource: 'none',
      selectedAttemptId: null,
      selectedResult: null,
      selectionConflict: null,
      validUnselectedResultCount: 0,
      compatibilityGradingUnknown: false,
      reusableAuthoredContent: true,
      participation: { applicable: true, status: 'assigned', excused: false },
    };
    f.query.mockResolvedValue({
      rows: [
        {
          data: {
            offset: 0,
            nextOffset: null,
            items: [
              {
                id: seatId,
                title: 'Не открыто',
                assignmentId: seatId,
                courseRunId: null,
                kind: 'project',
                completedAt: null,
                dueAt: '2026-10-20T12:00:00Z',
                evidence,
              },
              {
                id: classId,
                title: 'Теория',
                assignmentId: null,
                courseRunId: classId,
                kind: 'theory',
                completedAt: '2026-10-10',
                dueAt: null,
                evidence: null,
              },
            ],
          },
        },
      ],
    });
    const page = await f.controller.assignments(f.request, classId, seatId, '0');
    expect(page.items.map((item) => item.status)).toEqual(['not_started', 'completed']);
    expect(page.items[0]?.projectId).toBeNull();
    expect(page.items[0]?.dueAt).toBeNull(); // Canonical removal of a deadline is authoritative.
    expect(page.items.every((item) => !('evidence' in item))).toBe(true);
    expect(f.query).toHaveBeenCalledTimes(1);
    expect(f.query.mock.calls[0]?.[0]).toContain('classroom_participant_assignments');
    expect(f.query.mock.calls[0]?.[1]).toEqual(['account-principal', classId, seatId, 0]);
    f.query.mockResolvedValue({ rows: [{ data: null }] });
    await expect(f.controller.assignments(f.request, classId, seatId, '0')).rejects.toMatchObject({
      status: 404,
    });
  });
  it('Seat profile and avatar use only the Seat cookie despite a neighbouring Account', async () => {
    const f = fixture();
    await f.controller.seatProfile(f.request);
    expect(f.account.resolve).not.toHaveBeenCalled();
    expect(f.seat.resolve).toHaveBeenCalledWith('seat-cookie');
    expect(f.query.mock.calls.at(-1)?.[1]).toEqual(['seat-principal', classId, seatId]);
    await f.controller.seatAvatar(f.request, { id: null, requestId: 'request-12345678' });
    const args = f.query.mock.calls.at(-1)?.[1] as unknown[];
    expect(args[0]).toBe('seat-principal');
    expect(JSON.parse(args[3] as string)).toEqual({
      id: null,
      requestId: 'request-12345678',
      seatId,
    });
    expect(f.account.resolve).not.toHaveBeenCalled();
  });
  it('a revoked Seat cannot fall back to a valid Account', async () => {
    const f = fixture();
    f.seat.resolve.mockResolvedValue(null);
    await expect(f.controller.seatProfile(f.request)).rejects.toMatchObject({
      status: 401,
      response: { error: { message: 'Войдите по коду ученика.' } },
    });
    expect(f.query).not.toHaveBeenCalled();
    expect(f.account.resolve).not.toHaveBeenCalled();
  });
  it('serves a secret raster with Seat credentials and denies an unavailable image without Account fallback', async () => {
    const f = fixture();
    const avatarId = '33333333-3333-4333-8333-333333333333';
    const reply = {
      header: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    f.query.mockResolvedValue({ rows: [{ data: 'data:image/png;base64,AA==' }] });
    await f.controller.seatImage(f.request, reply as unknown as FastifyReply, avatarId);
    expect(f.query.mock.calls.at(-1)?.[1]).toEqual(['seat-principal', classId, seatId, avatarId]);
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(reply.type).toHaveBeenCalledWith('image/png');
    expect(reply.send).toHaveBeenCalledWith(Buffer.from([0]));
    f.query.mockResolvedValue({ rows: [{ data: null }] });
    await expect(
      f.controller.seatImage(f.request, reply as unknown as FastifyReply, avatarId),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.account.resolve).not.toHaveBeenCalled();
  });
  it('teacher routes do not fall back to a Seat or accept client principal claims', async () => {
    const f = fixture();
    f.account.resolve.mockResolvedValue(null);
    await expect(f.controller.roster(f.request, classId)).rejects.toThrow();
    expect(f.seat.resolve).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled();
    await expect(
      f.controller.seatAvatar(f.request, {
        id: null,
        seatId,
        principalId: 'teacher',
        requestId: 'request-12345678',
      }),
    ).rejects.toThrow();
  });
  it('rejects an invalid upload before any mutation, leaving the current choice intact', async () => {
    const f = fixture();
    await expect(
      f.controller.mutate(f.request, classId, 'avatar', {
        title: 'Bad',
        secret: false,
        dataUrl: 'data:image/png;base64,PGh0bWw+',
        requestId: 'request-12345678',
      }),
    ).rejects.toThrow();
    expect(f.query).toHaveBeenCalledTimes(1); // authorization only, no DB write
    expect(f.query.mock.calls[0]?.[0]).toContain('classroom_participant_roster');
  });
  it('validates summary size and pagination rather than interpolating query input', async () => {
    const f = fixture();
    await expect(
      f.controller.summary(f.request, { classroomIds: Array(201).fill(classId) }),
    ).rejects.toThrow();
    await expect(
      f.controller.summary(f.request, { classroomIds: [classId, classId] }),
    ).rejects.toThrow();
    await expect(
      f.controller.works(f.request, classId, seatId, 'chess', 'true', 'false', '0'),
    ).rejects.toThrow();
    await expect(
      f.controller.works(f.request, classId, seatId, undefined, 'true', 'false', '100001'),
    ).rejects.toThrow();
    expect(f.query).not.toHaveBeenCalled();
  });
});
