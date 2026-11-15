import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { ClassroomJoinController } from './classroom-join.controller.js';
import { requestAdmissionDiagnostics } from './server-diagnostics.js';
import { clientAddressDiagnostics } from './client-address.js';

function request(source: string): FastifyRequest {
  return {
    raw: { socket: { remoteAddress: '172.19.0.4' } },
    headers: { 'x-forwarded-for': source },
  } as unknown as FastifyRequest;
}
function reply(): FastifyReply {
  return { header: vi.fn(), setCookie: vi.fn(), clearCookie: vi.fn() } as unknown as FastifyReply;
}
function fixture() {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('classroom_public_resolve_join_code'))
      return { rows: [{ tenant_id: 'tenant', classroom_id: 'class' }] };
    if (params[1] === 'GOOD1')
      return {
        rows: [{ seat_id: 'seat', classroom_id: 'class', expires_at: new Date('2030-01-01') }],
      };
    return { rows: [] };
  });
  return new ClassroomJoinController({ query } as unknown as pg.Pool, {} as ActiveContextUseCase);
}
afterEach(() => {
  delete process.env.ASA_TRUSTED_PROXY_CIDRS;
});
describe('server-owned admission evidence under shared and unknown sources', () => {
  it.each(['172.19.0.1', '198.51.100.7'])(
    'keeps correct credentials usable after failed candidate budget at %s',
    async (source) => {
      process.env.ASA_TRUSTED_PROXY_CIDRS = '172.16.0.0/12';
      const controller = fixture();
      const body = { code: 'ABC DEF 234', studentCode: 'WRONG1' };
      for (let attempt = 0; attempt < 5; attempt++)
        await expect(controller.signIn(request(source), reply(), body)).rejects.toMatchObject({
          status: 401,
        });
      const rejected = request(source);
      await expect(controller.signIn(rejected, reply(), body)).rejects.toMatchObject({
        status: 429,
      });
      expect(requestAdmissionDiagnostics.get(rejected)).toEqual({
        credentialCheck: 'student_rejected',
        blockedBudgets: ['candidate_class'],
        limiterPhase: 'after_failed_validation',
      });
      const accepted = request(source);
      await expect(
        controller.signIn(accepted, reply(), { ...body, studentCode: 'GOOD1' }),
      ).resolves.toMatchObject({ authenticated: true });
      expect(requestAdmissionDiagnostics.get(accepted)).toEqual({
        credentialCheck: 'student_accepted',
        blockedBudgets: [],
        limiterPhase: 'not_applied',
      });
      const serialized = JSON.stringify(requestAdmissionDiagnostics.get(rejected));
      expect(serialized).not.toMatch(/WRONG1|GOOD1|ABC|172\.19|198\.51|tenant/);
      expect(clientAddressDiagnostics(accepted).state).toBe(
        source.startsWith('172.') ? 'unresolved' : 'resolved',
      );
      expect(requestAdmissionDiagnostics.get(request(source))).toBeUndefined();
    },
  );
  it('distinguishes the shared source-class and source-total budgets without recording keys', async () => {
    process.env.ASA_TRUSTED_PROXY_CIDRS = '172.16.0.0/12';
    const controller = fixture();
    let last: FastifyRequest;
    for (let attempt = 0; attempt < 301; attempt++) {
      last = request('172.19.0.1');
      await controller
        .signIn(last, reply(), {
          code: 'ABC DEF 234',
          studentCode: `X${String(attempt).padStart(4, '0')}`,
        })
        .catch(() => undefined);
    }
    expect(requestAdmissionDiagnostics.get(last!)).toEqual({
      credentialCheck: 'student_rejected',
      blockedBudgets: ['source_class', 'source_total'],
      limiterPhase: 'after_failed_validation',
    });
    const good = request('172.19.0.1');
    await expect(
      controller.signIn(good, reply(), { code: 'ABC DEF 234', studentCode: 'GOOD1' }),
    ).resolves.toMatchObject({ authenticated: true });
  });
});
