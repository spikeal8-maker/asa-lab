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

function controller(input: { projectAllowed: boolean; account?: boolean }) {
  const activeContext = {
    resolve: vi
      .fn()
      .mockImplementation(async (token: string | undefined) =>
        token && input.account !== false ? actor : null,
      ),
  };
  const seatContext = {
    resolve: vi
      .fn()
      .mockImplementation(async (token: string | undefined) =>
        token && input.account === false ? { ...actor, userId: null, seatId: 'seat' } : null,
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
