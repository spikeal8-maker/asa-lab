import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContextUseCase } from '@asa-lab/identity';
import { LearningDirectAssignmentController } from './learning-direct-assignment.controller.js';

const PRINCIPAL = '123e4567-e89b-42d3-a456-426614174001';
const ACCOUNT = '123e4567-e89b-42d3-a456-426614174002';
const TENANT = '123e4567-e89b-42d3-a456-426614174003';
const CLASSROOM = '123e4567-e89b-42d3-a456-426614174004';
const VERSION = '123e4567-e89b-42d3-a456-426614174005';
const ASSIGNMENT = '123e4567-e89b-42d3-a456-426614174006';
const RUN = '123e4567-e89b-42d3-a456-426614174007';
const AUDIENCE = '123e4567-e89b-42d3-a456-426614174008';

function request(): FastifyRequest {
  return { cookies: { asa_session: 'session' } } as unknown as FastifyRequest;
}

function target(rows: unknown[] = [], educator = true) {
  const query = vi.fn(async () => ({ rows }));
  const active = {
    resolve: vi.fn(async () => ({ principalId: PRINCIPAL, accountId: ACCOUNT, tenantId: TENANT })),
  } as unknown as ActiveContextUseCase;
  const accounts = {
    capabilities: vi.fn(async () =>
      educator ? [{ capability: 'educator', state: 'verified' }] : [],
    ),
  } as unknown as AccountDirectoryPort;
  return {
    api: new LearningDirectAssignmentController(active, accounts, {
      query,
    } as unknown as pg.Pool),
    query,
  };
}

describe('LRN-VS-001 direct assignment API', () => {
  it('lists only the database-authorized canonical picker rows', async () => {
    const value = target([
      {
        activity_id: ASSIGNMENT,
        activity_version_id: VERSION,
        title: 'Светодиод и резистор',
        instructions: 'Соберите цепь.',
        kind: 'project',
        module_key: 'electronics',
      },
    ]);
    await expect(value.api.activities(request(), CLASSROOM)).resolves.toEqual({
      items: [
        {
          id: ASSIGNMENT,
          versionId: VERSION,
          title: 'Светодиод и резистор',
          instructions: 'Соберите цепь.',
          kind: 'project',
          moduleKey: 'electronics',
        },
      ],
    });
    expect(value.query).toHaveBeenCalledWith(expect.stringContaining('activity_list'), [
      PRINCIPAL,
      TENANT,
      CLASSROOM,
    ]);
  });

  it('sends whole-class assignment as one canonical command', async () => {
    const value = target([
      {
        result_code: 'ok',
        classroom_assignment_id: ASSIGNMENT,
        activity_run_id: RUN,
        audience_id: AUDIENCE,
        assigned_count: 3,
        reused: false,
      },
    ]);
    await expect(
      value.api.assign(request(), CLASSROOM, {
        activityVersionId: VERSION,
        audienceType: 'whole_class',
        seatIds: [],
        dueAt: '2026-09-01T20:59:00.000Z',
        requestId: 'assign:visible:001',
      }),
    ).resolves.toMatchObject({ assignmentId: ASSIGNMENT, assignedCount: 3, reused: false });
    expect(value.query).toHaveBeenCalledWith(expect.stringContaining('direct_assignment_create'), [
      PRINCIPAL,
      TENANT,
      CLASSROOM,
      VERSION,
      '2026-09-01T20:59:00.000Z',
      'whole_class',
      [],
      'assign:visible:001',
    ]);
  });

  it('rejects empty named audience before SQL and denies non-educators', async () => {
    const invalid = target();
    await expect(
      invalid.api.assign(request(), CLASSROOM, {
        activityVersionId: VERSION,
        audienceType: 'named_learners',
        seatIds: [],
        dueAt: null,
        requestId: 'assign:visible:002',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(invalid.query).not.toHaveBeenCalled();
    await expect(target([], false).api.activities(request(), CLASSROOM)).rejects.toMatchObject({
      status: 403,
    });
  });
});
