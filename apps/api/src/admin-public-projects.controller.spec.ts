import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { AdminControlPlaneService } from './admin-control-plane.service.js';
import { AdminPublicProjectsController } from './admin-public-projects.controller.js';
import { SESSION_COOKIE } from './tokens.js';
import { STUDENT_SESSION_COOKIE } from './seat-context.js';

const ID = '10000000-0000-4000-8000-000000000001';
const request = (cookies: Record<string, string> = {}) =>
  ({ cookies, id: 'request-1' }) as FastifyRequest;
function fixture(auth: 'admin' | 'school' | 'pending' | 'anonymous' = 'admin') {
  const resolve = vi.fn(async () => (auth === 'anonymous' ? null : { principalId: ID }));
  const resolveAccess = vi.fn(async () => ({
    subject: {
      capabilities:
        auth === 'school'
          ? []
          : [{ capability: 'platform_admin', state: auth === 'pending' ? 'pending' : 'verified' }],
    },
    scopes: [{ kind: auth === 'school' ? 'organization' : 'platform', role: 'moderator' }],
  }));
  const query = vi.fn().mockResolvedValue({ rows: [{ result: { items: [], nextOffset: null } }] });
  const controller = new AdminPublicProjectsController(
    { resolve } as unknown as ActiveContextUseCase,
    { resolveAccess } as unknown as AdminControlPlaneService,
    { query } as unknown as pg.Pool,
  );
  return { controller, query, resolve };
}

describe('administrative publication transport', () => {
  it.each(['anonymous', 'school', 'pending'] as const)(
    'denies %s on every endpoint before SQL',
    async (auth) => {
      const { controller, query } = fixture(auth);
      const status = auth === 'anonymous' ? 401 : 403;
      for (const call of [
        () => controller.list(request()),
        () => controller.image(request(), ID, {} as FastifyReply),
        () =>
          controller.hide(request(), ID, {
            reason: 'Safety',
            expectedVersion: 0,
            expectedRevisionId: ID,
          }),
        () =>
          controller.restore(request(), ID, {
            reason: 'Reviewed',
            expectedVersion: 0,
            expectedRevisionId: ID,
          }),
      ])
        await expect(call()).rejects.toMatchObject({ status });
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('never falls back from a selected StudentSeat to an admin account', async () => {
    const { controller, query, resolve } = fixture();
    const req = request({ [SESSION_COOKIE]: 'valid-admin', [STUDENT_SESSION_COOKIE]: '' });
    for (const call of [
      () => controller.list(req),
      () => controller.image(req, ID, {} as FastifyReply),
      () => controller.hide(req, ID, { reason: 'x', expectedVersion: 0, expectedRevisionId: ID }),
      () =>
        controller.restore(req, ID, { reason: 'x', expectedVersion: 0, expectedRevisionId: ID }),
    ])
      await expect(call()).rejects.toMatchObject({ status: 403 });
    expect(resolve).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ['-1', '25'],
    ['0', '0'],
    ['0', '51'],
    ['1e2', '25'],
    ['1000001', '25'],
  ])('rejects invalid pagination %s/%s', async (offset, limit) => {
    const { controller, query } = fixture();
    await expect(controller.list(request(), offset, limit)).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    {},
    { reason: '', expectedVersion: 0, expectedRevisionId: ID },
    { reason: '  ', expectedVersion: 0, expectedRevisionId: ID },
    { reason: 1, expectedVersion: 0, expectedRevisionId: ID },
    { reason: 'x'.repeat(501), expectedVersion: 0, expectedRevisionId: ID },
    { reason: 'valid', title: 'rewrite', expectedVersion: 0, expectedRevisionId: ID },
    { reason: 'valid' },
    { reason: 'valid', expectedVersion: -1, expectedRevisionId: ID },
    { reason: 'valid', expectedVersion: 1.5, expectedRevisionId: ID },
    { reason: 'valid', expectedVersion: '0', expectedRevisionId: ID },
    { reason: 'valid', expectedVersion: 0 },
    { reason: 'valid', expectedVersion: 0, expectedRevisionId: '' },
    { reason: 'valid', expectedVersion: 0, expectedRevisionId: 'bad-id' },
  ])('rejects malformed action %j', async (body) => {
    const { controller, query } = fixture();
    await expect(controller.hide(request(), ID, body)).rejects.toMatchObject({ status: 400 });
    await expect(controller.restore(request(), ID, body)).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('uses bounded defaults, bound SQL parameters and authenticated actor identity', async () => {
    const { controller, query } = fixture();
    await expect(controller.list(request())).resolves.toEqual({ items: [], nextOffset: null });
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [ID, 0, 25]);
    await controller.hide(request(), ID, {
      reason: ' Safety review ',
      expectedVersion: 0,
      expectedRevisionId: ID,
    });
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [
      ID,
      ID,
      true,
      'Safety review',
      'request-1',
      0,
      ID,
    ]);
    await controller.restore(request(), ID, {
      reason: 'Reviewed',
      expectedVersion: 0,
      expectedRevisionId: ID,
    });
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [
      ID,
      ID,
      false,
      'Reviewed',
      'request-1',
      0,
      ID,
    ]);
  });

  it('rejects invalid identifiers and maps absent images to 404', async () => {
    const { controller, query } = fixture();
    await expect(
      controller.hide(request(), 'bad', {
        reason: 'x',
        expectedVersion: 0,
        expectedRevisionId: ID,
      }),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(query).not.toHaveBeenCalled();
    query.mockResolvedValue({ rows: [] });
    await expect(controller.image(request(), ID, {} as FastifyReply)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('returns frozen bytes with no-store and nosniff', async () => {
    const { controller, query } = fixture();
    const image = Buffer.alloc(64, 17);
    query.mockResolvedValue({ rows: [{ image, content_type: 'image/png' }] });
    const reply = {
      header: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    await controller.image(request(), ID, reply as unknown as FastifyReply);
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(reply.header).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(reply.type).toHaveBeenCalledWith('image/png');
    expect(reply.send).toHaveBeenCalledWith(image);
  });

  it.each([
    ['42501', 403],
    ['22023', 400],
    ['P5P04', 404],
    ['P5M09', 409],
  ])('maps SQL %s without leaking its message', async (code, status) => {
    const { controller, query } = fixture();
    query.mockRejectedValue(Object.assign(new Error('private SQL detail'), { code }));
    await expect(
      controller.hide(request(), ID, { reason: 'x', expectedVersion: 0, expectedRevisionId: ID }),
    ).rejects.toMatchObject({ status });
    try {
      await controller.hide(request(), ID, {
        reason: 'x',
        expectedVersion: 0,
        expectedRevisionId: ID,
      });
    } catch (error) {
      expect(String(error)).not.toContain('private SQL detail');
    }
  });
});
