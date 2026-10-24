import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { PublicProjectReportsController } from './public-project-reports.controller.js';
import { SESSION_COOKIE } from './tokens.js';
import { STUDENT_SESSION_COOKIE } from './seat-context.js';

const PUBLICATION = '123e4567-e89b-42d3-a456-426614174001';
const REVISION = '123e4567-e89b-42d3-a456-426614174002';
const PRINCIPAL = '123e4567-e89b-42d3-a456-426614174004';
const KEY = 'report-request-1';
const valid = { revisionId: REVISION, reason: 'spam', comment: 'Есть нарушение' };

function request(cookies: Record<string, string> = {}) {
  return { cookies } as FastifyRequest;
}

function fixture(signedIn = true, database = true) {
  const query = vi.fn(async () => ({
    rows: [
      {
        result: {
          reportId: '123e4567-e89b-42d3-a456-426614174008',
          status: 'received',
          duplicate: false,
          reporter_principal_id: 'not-for-public-output',
        },
      },
    ],
  }));
  const resolve = vi.fn(async () => (signedIn ? { principalId: PRINCIPAL } : null));
  const controller = new PublicProjectReportsController(
    database ? ({ query } as unknown as pg.Pool) : null,
    { resolve } as unknown as ActiveContextUseCase,
  );
  return { controller, query, resolve };
}

describe('public project report intake transport', () => {
  it('stores a report under the authenticated Account with bound SQL parameters', async () => {
    const { controller, query, resolve } = fixture();
    const result = await controller.report(
      request({ [SESSION_COOKIE]: 'signed-in-session' }),
      PUBLICATION,
      KEY,
      valid,
    );
    expect(resolve).toHaveBeenCalledWith('signed-in-session');
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(
      'SELECT public.project_publication_report_create($1,$2,$3,$4,$5,$6) AS result',
      [PRINCIPAL, PUBLICATION, REVISION, 'spam', 'Есть нарушение', KEY],
    );
    expect(result).toEqual({
      reportId: '123e4567-e89b-42d3-a456-426614174008',
      status: 'received',
      duplicate: false,
    });
    expect(JSON.stringify(result)).not.toContain('not-for-public-output');
  });

  it('preserves idempotent duplicate receipts instead of inventing a new case', async () => {
    const { controller, query } = fixture();
    query.mockResolvedValueOnce({
      rows: [{ result: { reportId: REVISION, status: 'received', duplicate: true } }],
    });
    await expect(controller.report(request(), PUBLICATION, KEY, valid)).resolves.toEqual({
      reportId: REVISION,
      status: 'received',
      duplicate: true,
    });
  });

  it('rejects anonymous accounts before executing SQL', async () => {
    const { controller, query } = fixture(false);
    await expect(controller.report(request(), PUBLICATION, KEY, valid)).rejects.toMatchObject({
      status: 401,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('does not allow a selected StudentSeat to fall back to a valid Account', async () => {
    const { controller, query, resolve } = fixture();
    const cookies = { [SESSION_COOKIE]: 'valid-account', [STUDENT_SESSION_COOKIE]: '' };
    await expect(
      controller.report(request(cookies), PUBLICATION, KEY, valid),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    [{}, KEY, PUBLICATION],
    [null, KEY, PUBLICATION],
    [{ ...valid, reporter: PRINCIPAL }, KEY, PUBLICATION],
    [{ ...valid, revisionId: 'bad' }, KEY, PUBLICATION],
    [{ ...valid, reason: 'made-up' }, KEY, PUBLICATION],
    [{ ...valid, reason: '' }, KEY, PUBLICATION],
    [{ ...valid, comment: { raw: 'x' } }, KEY, PUBLICATION],
    [{ ...valid, comment: 'x'.repeat(501) }, KEY, PUBLICATION],
    [valid, '', PUBLICATION],
    [valid, 'spaces not allowed', PUBLICATION],
    [valid, 'learning:copied-key', PUBLICATION],
    [valid, KEY, 'not-a-uuid'],
  ] as const)('rejects malformed report input %j', async (body, key, publicationId) => {
    const { controller, query } = fixture();
    await expect(controller.report(request(), publicationId, key, body)).rejects.toMatchObject({
      status: 400,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed when PostgreSQL is unavailable', async () => {
    const { controller } = fixture(true, false);
    await expect(controller.report(request(), PUBLICATION, KEY, valid)).rejects.toMatchObject({
      status: 503,
    });
  });

  it.each([
    ['42501', 403],
    ['22023', 400],
    ['22P02', 400],
    ['P5P04', 404],
    ['P5R09', 409],
    ['P5R29', 429],
  ])('maps PostgreSQL %s to a bounded API %d without SQL messages', async (code, status) => {
    const { controller, query } = fixture();
    query.mockRejectedValueOnce({ code, message: 'confidential SQL text and identifiers' });
    try {
      await controller.report(request(), PUBLICATION, KEY, valid);
      throw new Error('Expected report failure');
    } catch (error) {
      expect(error).toMatchObject({ status });
      expect(JSON.stringify(error)).not.toContain('confidential SQL text');
    }
  });

  it('does not treat an empty or malformed database receipt as success', async () => {
    const { controller, query } = fixture();
    query.mockResolvedValueOnce({ rows: [] });
    await expect(controller.report(request(), PUBLICATION, KEY, valid)).rejects.toMatchObject({
      status: 503,
    });
  });
});
