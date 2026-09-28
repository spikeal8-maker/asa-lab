import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContextUseCase } from '@asa-lab/identity';
import { createApiModuleRegistry } from './module-registry.js';
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

function target(options: { educator?: boolean; rows?: unknown[]; sourceRows?: unknown[] } = {}) {
  const query = vi.fn(async () => ({ rows: options.rows ?? [] }));
  const sourceQuery = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('set_config') && params?.[0] !== TENANT_ID) {
      throw new Error('Unexpected tenant context');
    }
    return sql.includes('FROM teacher_assignments')
      ? { rows: options.sourceRows ?? [{ module_key: 'electronics' }], command: 'SELECT' }
      : sql.includes('learning_activity_create')
        ? { rows: options.rows ?? [], command: 'SELECT' }
        : { rows: [], command: sql === 'COMMIT' ? 'COMMIT' : sql };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query: sourceQuery, release }));
  const activeContext = {
    resolve: vi.fn(async () => ({
      principalId: PRINCIPAL_ID,
      accountId: ACCOUNT_ID,
      tenantId: TENANT_ID,
      workspaceId: TENANT_ID,
      workspaceKind: 'personal',
    })),
  } as unknown as ActiveContextUseCase;
  const accounts = {
    workspaces: vi.fn(async () => [{ workspaceId: TENANT_ID, kind: 'personal', role: 'owner' }]),
    capabilities: vi.fn(async () =>
      options.educator === false ? [] : [{ capability: 'educator', state: 'verified' }],
    ),
  } as unknown as AccountDirectoryPort;
  return {
    value: new LearningActivitiesController(
      activeContext,
      accounts,
      {
        query,
        connect,
      } as unknown as pg.Pool,
      createApiModuleRegistry(),
    ),
    query,
    sourceQuery,
    connect,
    release,
  };
}

describe('canonical learning activity API', () => {
  it('returns an inherited legacy goal to the author without adding a draft goal key', async () => {
    const api = target();
    api.query
      .mockResolvedValueOnce({
        rows: [
          {
            activity_id: ACTIVITY_ID,
            tenant_id: TENANT_ID,
            title: 'Legacy task',
            kind: 'project',
            owner_scope: 'personal',
            visibility_policy: 'private',
            draft_revision: 2,
            draft_payload: { title: 'Legacy task' },
            current_published_version_id: null,
            archived_at: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ result_code: 'ok', goal: 'Teacher goal' }] })
      .mockResolvedValueOnce({ rows: [{ result_code: 'sample_not_found' }] });
    await expect(api.value.get(request(), ACTIVITY_ID)).resolves.toMatchObject({
      draft: { title: 'Legacy task' },
      inheritedGoal: 'Teacher goal',
    });
    expect(api.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('learning_activity_preview_with_goal_as_author'),
      [PRINCIPAL_ID, TENANT_ID, ACTIVITY_ID, 2],
    );
    const outsider = target({ educator: false });
    await expect(outsider.value.get(request(), ACTIVITY_ID)).rejects.toMatchObject({ status: 403 });
    expect(outsider.query).not.toHaveBeenCalled();
  });

  it('draft-from-version uses authenticated scope and exact selected version, and reports existing drafts', async () => {
    const api = target({ rows: [{ result_code: 'draft_exists', draft_revision: 4 }] });
    await expect(
      api.value.draftFromVersion(request(), ACTIVITY_ID, VERSION_ID, { expectedRevision: 3 }),
    ).rejects.toMatchObject({ status: 409, response: { error: { code: 'draft_exists' } } });
    expect(api.query).toHaveBeenCalledWith(
      expect.stringContaining('learning_activity_draft_from_version'),
      [PRINCIPAL_ID, TENANT_ID, ACTIVITY_ID, VERSION_ID, 3],
    );
  });
  it('draft-from-version denies missing author capability without a database mutation', async () => {
    const api = target({ educator: false });
    await expect(
      api.value.draftFromVersion(request(), ACTIVITY_ID, VERSION_ID, { expectedRevision: 1 }),
    ).rejects.toMatchObject({ status: 403 });
    expect(api.query).not.toHaveBeenCalled();
  });
  it('draft-from-version rejects invalid versions and body scope injection', async () => {
    const api = target();
    await expect(
      api.value.draftFromVersion(request(), ACTIVITY_ID, VERSION_ID, {
        expectedRevision: 2147483648,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      api.value.draftFromVersion(request(), ACTIVITY_ID, 'latest', { expectedRevision: 1 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      api.value.draftFromVersion(request(), ACTIVITY_ID, VERSION_ID, {
        expectedRevision: 1,
        principalId: PRINCIPAL_ID,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(api.query).not.toHaveBeenCalled();
  });
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

  it('rejects nonassignable and unknown project modules before authoring SQL', async () => {
    const api = target();
    for (const moduleKey of ['blocks', 'chess', 'robotics', 'unknown-module']) {
      await expect(
        api.value.create(request(), {
          kind: 'project',
          requestId: 'create:module:0001',
          title: 'New task',
          resultMode: 'completion',
          policies,
          moduleKey,
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        api.value.putDraft(request(), ACTIVITY_ID, {
          expectedRevision: 1,
          title: 'New task',
          resultMode: 'completion',
          policies,
          moduleKey,
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(api.query).not.toHaveBeenCalled();
  });

  it('checks the owned source and creates against one repeatable-read tenant snapshot', async () => {
    const body = {
      kind: 'project',
      requestId: 'create:source:0001',
      title: 'Imported task',
      resultMode: 'completion',
      policies,
      moduleKey: 'electronics',
      sourceTeacherAssignmentId: ACTIVITY_ID,
    };
    const accepted = target({
      rows: [{ result_code: 'ok', activity_id: ACTIVITY_ID, draft_revision: 1 }],
    });
    await expect(accepted.value.create(request(), body)).resolves.toEqual({
      id: ACTIVITY_ID,
      draftRevision: 1,
    });
    expect(accepted.sourceQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM teacher_assignments'),
      [ACTIVITY_ID, TENANT_ID, PRINCIPAL_ID],
    );
    expect(accepted.sourceQuery).toHaveBeenCalledWith(
      expect.stringContaining('learning_activity_create'),
      expect.arrayContaining([ACTIVITY_ID]),
    );
    expect(accepted.sourceQuery.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ',
      "SELECT set_config('app.tenant_id', $1, true)",
      expect.stringContaining('FROM teacher_assignments'),
      expect.stringContaining('learning_activity_create'),
      'COMMIT',
    ]);
    expect(accepted.sourceQuery.mock.calls[1]?.[1]).toEqual([TENANT_ID]);
    expect(accepted.connect).toHaveBeenCalledTimes(1);
    expect(accepted.release).toHaveBeenCalledTimes(1);
    expect(accepted.query).not.toHaveBeenCalled();

    for (const sourceRows of [[], [{ module_key: 'blocks' }], [{ module_key: 'three-d' }]]) {
      const rejected = target({ sourceRows });
      await expect(rejected.value.create(request(), body)).rejects.toMatchObject({
        status: sourceRows.length === 0 ? 403 : 400,
      });
      expect(rejected.query).not.toHaveBeenCalled();
      expect(
        rejected.sourceQuery.mock.calls.some(([sql]) => sql.includes('learning_activity_create')),
      ).toBe(false);
      expect(rejected.sourceQuery.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    }
  });

  it.each([undefined, null])('derives an omitted or %s source module in SQL', async (moduleKey) => {
    const accepted = target({
      rows: [{ result_code: 'ok', activity_id: ACTIVITY_ID, draft_revision: 1 }],
    });
    await expect(
      accepted.value.create(request(), {
        kind: 'project',
        requestId: 'create:source:derive',
        title: 'Imported task',
        resultMode: 'completion',
        policies,
        ...(moduleKey === undefined ? {} : { moduleKey }),
        sourceTeacherAssignmentId: ACTIVITY_ID,
      }),
    ).resolves.toEqual({ id: ACTIVITY_ID, draftRevision: 1 });
    const create = accepted.sourceQuery.mock.calls.find(([sql]) =>
      sql.includes('learning_activity_create'),
    );
    expect(create?.[1]?.[10]).toBeNull();
    expect(accepted.query).not.toHaveBeenCalled();
  });

  it('rolls back an imported source on a serialization failure without retrying on the pool', async () => {
    const api = target();
    const failure = Object.assign(new Error('serialization failure'), { code: '40001' });
    api.sourceQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM teacher_assignments')) {
        return { rows: [{ module_key: 'electronics' }], command: 'SELECT' };
      }
      if (sql.includes('learning_activity_create')) throw failure;
      return { rows: [], command: sql === 'COMMIT' ? 'COMMIT' : sql };
    });
    await expect(
      api.value.create(request(), {
        kind: 'project',
        requestId: 'create:source:serialize',
        title: 'Imported task',
        resultMode: 'completion',
        policies,
        moduleKey: 'electronics',
        sourceTeacherAssignmentId: ACTIVITY_ID,
      }),
    ).rejects.toBe(failure);
    expect(api.sourceQuery.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(api.release).toHaveBeenCalledTimes(1);
    expect(api.query).not.toHaveBeenCalled();
  });

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

  it('normalizes and forwards the authored goal, rejects malformed text before SQL', async () => {
    const api = target({
      rows: [{ result_code: 'ok', activity_id: ACTIVITY_ID, draft_revision: 1 }],
    });
    await api.value.create(request(), {
      kind: 'project',
      requestId: 'create:goal:0001',
      title: 'Circuit',
      goal: '  Understand the circuit  ',
      resultMode: 'completion',
      policies,
      moduleKey: 'electronics',
    });
    expect(api.query).toHaveBeenCalledWith(
      expect.stringContaining('$16::jsonb'),
      expect.arrayContaining([JSON.stringify('Understand the circuit')]),
    );
    const invalid = target();
    for (const goal of ['X'.repeat(161), 9, { text: 'injected' }]) {
      await expect(
        invalid.value.create(request(), {
          kind: 'project',
          requestId: 'create:goal:0002',
          title: 'Circuit',
          goal,
          resultMode: 'completion',
          policies,
          moduleKey: 'electronics',
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(invalid.query).not.toHaveBeenCalled();
  });

  it('keeps omitted goal distinct from an explicit clear in create and edit', async () => {
    const api = target({
      rows: [{ result_code: 'ok', activity_id: ACTIVITY_ID, draft_revision: 2 }],
    });
    const base = {
      kind: 'project',
      requestId: 'create:goal:0003',
      title: 'Circuit',
      resultMode: 'completion',
      policies,
      moduleKey: 'electronics',
      sourceTeacherAssignmentId: ACTIVITY_ID,
    };
    await api.value.create(request(), base);
    expect(api.sourceQuery.mock.calls.at(-2)?.[1]?.at(-2)).toBeNull();
    await api.value.create(request(), { ...base, goal: null });
    expect(api.sourceQuery.mock.calls.at(-2)?.[1]?.at(-2)).toBe('null');

    const edit = {
      title: base.title,
      resultMode: base.resultMode,
      policies: base.policies,
      moduleKey: base.moduleKey,
      expectedRevision: 1,
    };
    await api.value.putDraft(request(), ACTIVITY_ID, edit);
    expect(api.query.mock.calls.at(-1)?.[0]).toContain('$13::jsonb');
    expect(api.query.mock.calls.at(-1)?.[1]?.at(-2)).toBeNull();
    await api.value.putDraft(request(), ACTIVITY_ID, { ...edit, goal: null });
    expect(api.query.mock.calls.at(-1)?.[1]?.at(-2)).toBe('null');
  });

  it('accepts ordered plain-text blocks and rejects unsafe shapes before any SQL', async () => {
    const api = target({
      rows: [{ result_code: 'ok', activity_id: ACTIVITY_ID, draft_revision: 1 }],
    });
    const blocks = [
      { type: 'heading', text: 'Build a circuit' },
      { type: 'list', items: ['Connect LED', 'Check polarity'] },
      { type: 'link', text: 'Reference', href: 'https://example.org/reference' },
    ];
    await api.value.create(request(), {
      kind: 'project',
      requestId: 'blocks:create:0001',
      title: 'Circuit',
      resultMode: 'completion',
      policies,
      moduleKey: 'electronics',
      blocks,
    });
    expect(api.query.mock.calls.at(-1)?.[0]).toContain('$17::jsonb');
    expect(api.query.mock.calls.at(-1)?.[1]?.at(-1)).toBe(JSON.stringify(blocks));
    const invalid = target();
    for (const bad of [
      [{ type: 'link', text: 'Script', href: 'javascript:alert(1)' }],
      [{ type: 'paragraph', text: '<img src=x onerror=alert(1)>', html: true }],
      [{ type: 'list', items: [] }],
      [{ type: 'heading', text: '' }],
    ]) {
      await expect(
        invalid.value.create(request(), {
          kind: 'project',
          requestId: 'blocks:create:bad',
          title: 'Circuit',
          resultMode: 'completion',
          policies,
          moduleKey: 'electronics',
          blocks: bad,
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(invalid.query).not.toHaveBeenCalled();
  });

  it('accepts one hashed image block and rejects untrusted image fields', async () => {
    const api = target({ rows: [{ result_code: 'ok', draft_revision: 2 }] });
    const base = {
      title: 'Circuit',
      resultMode: 'completion',
      policies,
      moduleKey: 'electronics',
      expectedRevision: 1,
    };
    const image = { type: 'image', alt: 'LED circuit', contentHash: 'a'.repeat(64) };
    await api.value.putDraft(request(), ACTIVITY_ID, { ...base, blocks: [image] });
    expect(api.query.mock.calls.at(-1)?.[1]?.at(-1)).toBe(JSON.stringify([image]));
    for (const blocks of [
      [{ ...image, src: 'https://evil.test/image' }],
      [{ ...image, contentHash: 'bad' }],
      [{ ...image, alt: '' }],
      [image, image],
    ]) {
      await expect(
        api.value.putDraft(request(), ACTIVITY_ID, { ...base, blocks }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(api.query).toHaveBeenCalledTimes(1);
  });

  it('uploads a task image only for an educator and maps exact preview URL', async () => {
    const imageDataUrl = 'data:image/png;base64,' + Buffer.from('task-image').toString('base64');
    const upload = target({
      rows: [{ result_code: 'ok', draft_revision: 2, content_hash: 'a'.repeat(64) }],
    });
    await expect(
      upload.value.putDraftTaskImage(request(), ACTIVITY_ID, { expectedRevision: 1, imageDataUrl }),
    ).resolves.toMatchObject({
      draftRevision: 2,
      url: `/api/learning/activities/${ACTIVITY_ID}/draft-task-image?v=${'a'.repeat(64)}`,
    });
    expect(upload.query).toHaveBeenCalledWith(
      expect.stringContaining('learning_activity_draft_task_image_set'),
      [PRINCIPAL_ID, TENANT_ID, ACTIVITY_ID, 1, expect.any(Buffer), 'image/png'],
    );
    const outsider = target({ educator: false });
    await expect(
      outsider.value.putDraftTaskImage(request(), ACTIVITY_ID, {
        expectedRevision: 1,
        imageDataUrl,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(outsider.query).not.toHaveBeenCalled();
  });

  it('returns an exact published goal in read-only learner preview', async () => {
    const api = target();
    api.query
      .mockResolvedValueOnce({
        rows: [
          {
            result_code: 'ok',
            activity_id: ACTIVITY_ID,
            source_kind: 'published',
            source_id: VERSION_ID,
            draft_revision: 1,
            version_number: 1,
            title: 'Circuit',
            instructions: 'Build it',
            module_key: 'electronics',
            result_mode: 'completion',
            max_points: null,
            policy_snapshot: policies,
            content_digest: 'a'.repeat(64),
            goal: 'Understand the circuit',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            result_code: 'ok',
            blocks: [
              { type: 'paragraph', text: 'Build it' },
              { type: 'image', alt: 'Circuit', contentHash: 'b'.repeat(64) },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ result_code: 'sample_not_found' }] });
    const result = await api.value.previewAsLearner(
      request(),
      ACTIVITY_ID,
      'published',
      undefined,
      VERSION_ID,
    );
    expect(result.assignment).toMatchObject({
      goal: 'Understand the circuit',
      brief: 'Build it',
    });
    expect(result.assignment.blocks[1]).toMatchObject({
      type: 'image',
      src: `/api/learning/activities/${ACTIVITY_ID}/versions/${VERSION_ID}/task-image?v=${'b'.repeat(64)}`,
    });
    expect(result.learnerRuntime).toBe(false);
    expect(
      api.query.mock.calls.every(([sql]) => String(sql).trimStart().startsWith('SELECT')),
    ).toBe(true);
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

  it('stores and deletes a canonical draft sample with owner activity scope', async () => {
    const imageDataUrl =
      'data:image/png;base64,' + Buffer.from('canonical-draft-image-a').toString('base64');
    const put = target({
      rows: [{ result_code: 'ok', draft_revision: 2, content_hash: 'a'.repeat(64) }],
    });
    await expect(
      put.value.putDraftSample(request(), ACTIVITY_ID, {
        expectedRevision: 1,
        imageDataUrl,
      }),
    ).resolves.toEqual({
      draftRevision: 2,
      contentHash: 'a'.repeat(64),
      url: `/api/learning/activities/${ACTIVITY_ID}/draft-sample?v=${'a'.repeat(64)}`,
    });
    expect(put.query).toHaveBeenCalledWith(
      expect.stringContaining('learning_activity_draft_sample_set'),
      [PRINCIPAL_ID, TENANT_ID, ACTIVITY_ID, 1, expect.any(Buffer), 'image/png'],
    );

    const remove = target({ rows: [{ result_code: 'ok', draft_revision: 3 }] });
    await expect(
      remove.value.deleteDraftSample(request(), ACTIVITY_ID, { expectedRevision: 2 }),
    ).resolves.toEqual({ draftRevision: 3 });
    expect(remove.query).toHaveBeenCalledWith(
      expect.stringContaining('learning_activity_draft_sample_delete'),
      [PRINCIPAL_ID, TENANT_ID, ACTIVITY_ID, 2],
    );
  });

  it('rejects invalid draft sample type and revision before SQL', async () => {
    const api = target();
    await expect(
      api.value.putDraftSample(request(), ACTIVITY_ID, {
        expectedRevision: 1,
        imageDataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      api.value.deleteDraftSample(request(), ACTIVITY_ID, { expectedRevision: 0 }),
    ).rejects.toMatchObject({ status: 400 });
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
