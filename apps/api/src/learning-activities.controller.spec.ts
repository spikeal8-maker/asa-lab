import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContextUseCase } from '@asa-lab/identity';
import { LearningActivitiesController } from './learning-activities.controller.js';

const PRINCIPAL_ID = '123e4567-e89b-42d3-a456-426614174001';
const ACCOUNT_ID = '123e4567-e89b-42d3-a456-426614174002';
const TENANT_ID = '123e4567-e89b-42d3-a456-426614174003';
const ACTIVITY_ID = '123e4567-e89b-42d3-a456-426614174004';
const VERSION_ID = '123e4567-e89b-42d3-a456-426614174005';

const policies = {
  attemptPolicy: { maxAttempts: 1 },
  resultSelectionPolicy: { mode: 'latest' },
  completionPolicy: { mode: 'submission' },
  latePolicy: { mode: 'allow_mark_late' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'after_review' },
};

function request(): FastifyRequest {
  return { cookies: { asa_session: 'session' } } as unknown as FastifyRequest;
}

function target(options: { educator?: boolean; rows?: unknown[] } = {}) {
  const query = vi.fn(async () => ({ rows: options.rows ?? [] }));
  const activeContext = {
    resolve: vi.fn(async () => ({
      principalId: PRINCIPAL_ID,
      accountId: ACCOUNT_ID,
      tenantId: TENANT_ID,
    })),
  } as unknown as ActiveContextUseCase;
  const accounts = {
    capabilities: vi.fn(async () =>
      options.educator === false ? [] : [{ capability: 'educator', state: 'verified' }],
    ),
  } as unknown as AccountDirectoryPort;
  return {
    value: new LearningActivitiesController(activeContext, accounts, {
      query,
    } as unknown as pg.Pool),
    query,
  };
}

describe('canonical learning activity API', () => {
  it.each(['project', 'quiz', 'essay', 'file', 'manual'])(
    'accepts %s domain authoring',
    async (kind) => {
      const api = target({
        rows: [{ result_code: 'ok', activity_id: ACTIVITY_ID, draft_revision: 1 }],
      });
      const quizVersionId = kind === 'quiz' ? VERSION_ID : null;
      await expect(
        api.value.create(request(), {
          kind,
          requestId: `create:${kind}:0001`,
          title: `${kind} activity`,
          resultMode: 'graded',
          maxPoints: 10,
          policies,
          moduleKey: kind === 'project' ? 'electronics' : null,
          quizVersionId,
        }),
      ).resolves.toEqual({ id: ACTIVITY_ID, draftRevision: 1 });
      expect(api.query).toHaveBeenCalledWith(
        expect.stringContaining('learning_activity_create'),
        expect.arrayContaining([kind, 'graded', 10]),
      );
    },
  );

  it.each(['ungraded', 'completion'])('does not fabricate maxPoints for %s', async (resultMode) => {
    const api = target({
      rows: [{ result_code: 'ok', activity_id: ACTIVITY_ID, draft_revision: 1 }],
    });
    await api.value.create(request(), {
      kind: 'manual',
      requestId: `create:${resultMode}:0001`,
      title: 'Observation',
      resultMode,
      policies,
    });
    expect(api.query).toHaveBeenCalledWith(
      expect.stringContaining('learning_activity_create'),
      expect.arrayContaining([resultMode, null]),
    );
  });

  it('rejects a learner/non-educator before authoring SQL', async () => {
    const api = target({ educator: false });
    await expect(
      api.value.create(request(), {
        kind: 'manual',
        requestId: 'create:learner:0001',
        title: 'Observation',
        resultMode: 'completion',
        policies,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(api.query).not.toHaveBeenCalled();
  });

  it('returns the immutable publication receipt including retry state', async () => {
    const api = target({
      rows: [
        {
          result_code: 'ok',
          activity_version_id: VERSION_ID,
          version_number: 2,
          content_digest: 'a'.repeat(64),
          reused: true,
        },
      ],
    });
    await expect(
      api.value.publish(request(), ACTIVITY_ID, {
        expectedRevision: 2,
        requestId: 'publish:test:0001',
      }),
    ).resolves.toEqual({
      id: VERSION_ID,
      activityId: ACTIVITY_ID,
      versionNumber: 2,
      contentDigest: 'a'.repeat(64),
      reused: true,
    });
    expect(api.query).toHaveBeenCalledWith(expect.stringContaining('$1,$2,$3,$4,$5'), [
      PRINCIPAL_ID,
      TENANT_ID,
      ACTIVITY_ID,
      2,
      'publish:test:0001',
    ]);
  });

  it('rejects policy values and properties outside the OpenAPI shape', async () => {
    const api = target();
    await expect(
      api.value.create(request(), {
        kind: 'manual',
        requestId: 'create:policy:0001',
        title: 'Invalid policy',
        resultMode: 'completion',
        policies: { ...policies, attemptPolicy: 7 },
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      api.value.create(request(), {
        kind: 'manual',
        requestId: 'create:policy:0002',
        title: 'Invalid policy',
        resultMode: 'completion',
        policies: { ...policies, unknownPolicy: null },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(api.query).not.toHaveBeenCalled();
  });
});
