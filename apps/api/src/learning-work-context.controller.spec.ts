import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { OpenProjectUseCase } from '@asa-lab/projects';
import { LearningWorkContextController } from './learning-work-context.controller.js';
import { SeatContextUseCase } from './seat-context.js';

const projectId = '10000000-0000-4000-8000-000000000001';
const actor = {
  tenantId: 'tenant',
  principalId: 'principal',
  userId: 'user',
  accountId: 'account',
};
const request = { cookies: { asa_session: 'account-token' } } as unknown as FastifyRequest;

function controller(input: { projectAllowed: boolean; account?: boolean; both?: boolean }) {
  const activeContext = {
    resolve: vi
      .fn()
      .mockImplementation(async (token: string | undefined) =>
        token && input.account !== false ? actor : null,
      ),
  };
  const seatContext = {
    resolve: vi.fn().mockImplementation(async (token: string | undefined) =>
      token && (input.account === false || input.both)
        ? {
            ...actor,
            tenantId: input.both ? 'seat-tenant' : actor.tenantId,
            principalId: input.both ? 'seat-principal' : actor.principalId,
            userId: null,
            seatId: 'seat',
          }
        : null,
    ),
  };
  const openProject = {
    execute: vi
      .fn()
      .mockResolvedValue(
        input.projectAllowed
          ? { ok: true, value: { project: { moduleKey: 'electronics' } } }
          : { ok: false, code: 'project_not_found' },
      ),
  };
  const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  return {
    instance: new LearningWorkContextController(
      activeContext as unknown as ActiveContextUseCase,
      seatContext as unknown as SeatContextUseCase,
      openProject as unknown as OpenProjectUseCase,
      pool as unknown as pg.Pool,
    ),
    openProject,
    pool,
    activeContext,
    seatContext,
  };
}

describe('A1 context access boundary', () => {
  it('returns the same denied state for absent and inaccessible projects before reading learning', async () => {
    const { instance, openProject, pool } = controller({ projectAllowed: false });
    await expect(instance.context(request, projectId)).resolves.toEqual({
      state: 'denied',
      projectId,
    });
    expect(openProject.execute).toHaveBeenCalledWith(actor.tenantId, projectId, {
      principalId: actor.principalId,
      userId: actor.userId,
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns not_learning only after project access succeeds', async () => {
    const { instance, pool } = controller({ projectAllowed: true });
    await expect(instance.context(request, projectId)).resolves.toEqual({
      state: 'not_learning',
      projectId,
    });
    expect(pool.query).toHaveBeenCalled();
  });

  it('denies a remembered no-origin Course Project after the Account learner link is revoked', async () => {
    const { instance, pool } = controller({ projectAllowed: true });
    pool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('learning_origin_work_context_for_project')) return { rows: [] };
      if (sql.includes('learning_immutable_project_origin_exists'))
        return { rows: [{ linked: false }] };
      if (sql.includes('learning_work_context_for_project'))
        return {
          rows: [
            {
              context: {
                projectId,
                seatId: 'seat',
                classroomAssignmentId: 'assignment',
                sourceKind: 'course',
                activityRunId: 'run',
              },
            },
          ],
        };
      if (sql.includes('learning_course_modern_provenance'))
        return { rows: [{ proof: { modernCourseRun: false, projectReadable: false } }] };
      return { rows: [] };
    });
    await expect(instance.context(request, projectId)).resolves.toEqual({
      state: 'denied',
      projectId,
    });
    expect(
      pool.query.mock.calls.some(([sql]) => sql.includes('learning_course_modern_provenance')),
    ).toBe(true);
  });

  it('uses the same project gate for a StudentSeat session', async () => {
    const { instance, openProject } = controller({ projectAllowed: true, account: false });
    await expect(
      instance.context(
        { cookies: { asa_student_session: 'seat-token' } } as unknown as FastifyRequest,
        projectId,
      ),
    ).resolves.toEqual({ state: 'not_learning', projectId });
    expect(openProject.execute).toHaveBeenCalledWith(actor.tenantId, projectId, {
      principalId: actor.principalId,
      userId: null,
    });
  });

  it('does not resolve a project without a session', async () => {
    const { instance, openProject } = controller({ projectAllowed: true });
    await expect(
      instance.context({ cookies: {} } as FastifyRequest, projectId),
    ).rejects.toMatchObject({
      status: 401,
    });
    expect(openProject.execute).not.toHaveBeenCalled();
  });
});

describe('A4-3b exact-origin submission HTTP boundary', () => {
  const submitBody = { clientRequestId: 'submit:request-1', expectedRevision: 1 };
  const receipt = {
    result_code: 'ok',
    participation_id: 'participation',
    activity_run_id: 'run',
    attempt_id: 'attempt',
    submission_id: 'submission',
    attempt_number: 1,
    attempt_state: 'submitted',
    project_id: projectId,
    project_version_id: 'version',
    submitted_at: '2026-09-29T00:00:00.000Z',
    late_state: 'on_time',
    reused: false,
  };

  it('uses the same Seat principal for context and submit when both cookies are valid', async () => {
    const { instance, pool, openProject, activeContext, seatContext } = controller({
      projectAllowed: true,
      both: true,
    });
    const bothCookies = {
      cookies: { asa_session: 'account-token', asa_student_session: 'seat-token' },
    } as unknown as FastifyRequest;
    await expect(instance.context(bothCookies, projectId)).resolves.toEqual({
      state: 'not_learning',
      projectId,
    });
    expect(openProject.execute).toHaveBeenCalledWith('seat-tenant', projectId, {
      principalId: 'seat-principal',
      userId: null,
    });
    pool.query.mockResolvedValueOnce({ rows: [receipt] });
    await expect(instance.submit(bothCookies, projectId, submitBody)).resolves.toMatchObject({
      projectId,
      submissionId: 'submission',
    });
    expect(pool.query).toHaveBeenLastCalledWith(
      'SELECT * FROM learning_origin_project_submission_create($1,$2,$3,$4)',
      ['seat-principal', projectId, submitBody.clientRequestId, submitBody.expectedRevision],
    );
    expect(seatContext.resolve).toHaveBeenCalledTimes(2);
    expect(activeContext.resolve).not.toHaveBeenCalled();
  });

  it('submits through the exact Project command and returns its receipt', async () => {
    const { instance, pool, openProject } = controller({ projectAllowed: true });
    pool.query.mockResolvedValueOnce({ rows: [receipt] });
    await expect(instance.submit(request, projectId, submitBody)).resolves.toMatchObject({
      projectId,
      participationId: 'participation',
      attemptId: 'attempt',
      submissionId: 'submission',
      projectVersionId: 'version',
      reused: false,
    });
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT * FROM learning_origin_project_submission_create($1,$2,$3,$4)',
      [actor.principalId, projectId, submitBody.clientRequestId, submitBody.expectedRevision],
    );
    expect(openProject.execute).not.toHaveBeenCalled();
  });

  it('rejects malformed body and unauthenticated access before the command', async () => {
    const { instance, pool } = controller({ projectAllowed: true });
    await expect(
      instance.submit(request, projectId, { ...submitBody, projectId }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      instance.submit(request, projectId, { ...submitBody, expectedRevision: 2_147_483_648 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      instance.submit({ cookies: {} } as FastifyRequest, projectId, submitBody),
    ).rejects.toMatchObject({ status: 401 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('does not expose work identifiers for a denied origin or revoked link', async () => {
    const { instance, pool } = controller({ projectAllowed: true });
    pool.query.mockResolvedValueOnce({ rows: [{ result_code: 'forbidden' }] });
    await expect(instance.submit(request, projectId, submitBody)).rejects.toMatchObject({
      status: 404,
      response: { error: { code: 'learning_work_unavailable' } },
    });
  });

  it('maps revision and idempotency conflicts without invoking legacy handout writes', async () => {
    const { instance, pool } = controller({ projectAllowed: true });
    pool.query.mockResolvedValueOnce({ rows: [{ result_code: 'project_revision_conflict' }] });
    await expect(instance.submit(request, projectId, submitBody)).rejects.toMatchObject({
      status: 409,
      response: { error: { code: 'project_revision_conflict' } },
    });
    pool.query.mockResolvedValueOnce({ rows: [{ result_code: 'request_conflict' }] });
    await expect(instance.submit(request, projectId, submitBody)).rejects.toMatchObject({
      status: 409,
      response: { error: { code: 'idempotency_conflict' } },
    });
    expect(pool.query).toHaveBeenCalledTimes(2);
  });
});
