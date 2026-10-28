import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { ProjectDistributionController } from './project-distribution.controller';
import { SESSION_COOKIE } from './tokens';
import { STUDENT_SESSION_COOKIE } from './seat-context';
const CLASS = '123e4567-e89b-42d3-a456-426614174001';
const SEAT = '123e4567-e89b-42d3-a456-426614174002';
function fixture(data: unknown = { publish: false, download: false, version: 0 }) {
  const resolve = vi.fn(async () => ({
    principalId: 'trusted-actor',
    accountId: 'trusted-account',
    tenantId: 'different-active-workspace',
  }));
  const query = vi.fn(async (_sql: string, _params: unknown[]) => ({ rows: [{ data }] }));
  const controller = new ProjectDistributionController(
    { resolve } as unknown as ActiveContextUseCase,
    { query } as unknown as pg.Pool,
  );
  const req = {
    cookies: { [SESSION_COOKIE]: 'account-token' },
    id: 'server-request',
  } as unknown as FastifyRequest;
  return { controller, req, resolve, query };
}
describe('Exact-class project distribution API', () => {
  it('uses only authenticated authority and server request id in audited CAS', async () => {
    const f = fixture();
    const input = { publish: true, download: false, expectedVersion: 0 };
    await f.controller.write(f.req, CLASS, input);
    expect(f.query).toHaveBeenCalledWith(
      expect.stringContaining('classroom_project_policy_write'),
      ['trusted-account', CLASS, 'trusted-actor', null, JSON.stringify(input), 'server-request'],
    );
    expect(f.query.mock.calls[0]?.[0]).toContain('classroom_teacher_access($1,$2)');
    expect(f.query.mock.calls[0]?.[0]).toContain('resource.tenant_id');
    await f.controller.readSeat(f.req, CLASS, SEAT);
    expect(f.query).toHaveBeenLastCalledWith(
      expect.stringContaining('classroom_project_policy_read'),
      ['trusted-account', CLASS, 'trusted-actor', SEAT],
    );
    await expect(
      f.controller.write(f.req, CLASS, { ...input, actor: 'forged' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.query).toHaveBeenCalledTimes(2);
  });
  it.each(['', 'revoked'])(
    'never falls back to Account when a Seat cookie exists (%s)',
    async (token) => {
      const f = fixture();
      f.req.cookies[STUDENT_SESSION_COOKIE] = token;
      await expect(f.controller.read(f.req, CLASS)).rejects.toMatchObject({ status: 403 });
      expect(f.resolve).not.toHaveBeenCalled();
      expect(f.query).not.toHaveBeenCalled();
    },
  );
  it.each([
    [null, 403],
    [{ error: 'forbidden' }, 403],
    [{ error: 'version_conflict' }, 409],
    [{ error: 'invalid_policy' }, 400],
  ])('projects user-safe policy failure %#', async (data, status) => {
    const f = fixture(data);
    await expect(
      f.controller.writeSeat(f.req, CLASS, SEAT, {
        publishOverride: 'allow',
        downloadOverride: 'deny',
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ status });
  });
});
