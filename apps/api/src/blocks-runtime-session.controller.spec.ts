import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SeatContextUseCase } from './seat-context.js';
import { BlocksRuntimeSessionController } from './blocks-runtime-session.controller.js';
import type { BlocksRuntimeSessionIssuerPort } from './blocks-runtime-session-issuer.js';

const PROJECT = '44444444-4444-4444-8444-444444444444';
const success = {
  ok: true as const,
  value: {
    runtimeOrigin: 'http://localhost:4613',
    runtimeToken: 'a.b.c',
    expiresAt: 123,
    draftRevision: 7,
    projectJson: null,
    assets: [],
  },
};

function fixture(options: { account?: boolean; seat?: boolean } = { account: true }) {
  const active = {
    resolve: vi.fn(async () =>
      options.account ? { tenantId: 't1', principalId: 'p1', userId: 'u1' } : null,
    ),
  } as unknown as ActiveContextUseCase;
  const seat = {
    resolve: vi.fn(async () =>
      options.seat ? { tenantId: 't2', principalId: 'p2', userId: null } : null,
    ),
  } as unknown as SeatContextUseCase;
  const issuer: BlocksRuntimeSessionIssuerPort = {
    issueEditor: vi.fn(async () => success),
  };
  const controller = new BlocksRuntimeSessionController(active, seat, issuer);
  const request = {
    cookies: { asa_session: 'account-cookie', asa_student_session: 'seat-cookie' },
  } as unknown as FastifyRequest;
  const header = vi.fn();
  const reply = { header } as unknown as FastifyReply;
  return { controller, active, seat, issuer, request, reply, header };
}

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
    return 200;
  } catch (problem) {
    expect(problem).toBeInstanceOf(HttpException);
    return (problem as HttpException).getStatus();
  }
}

describe('BlocksRuntimeSessionController', () => {
  it('uses the normal account context and never trusts body permissions', async () => {
    const f = fixture({ account: true });
    await expect(f.controller.issueEditor(f.request, f.reply, PROJECT, {})).resolves.toEqual(
      success.value,
    );
    expect(f.issuer.issueEditor).toHaveBeenCalledWith(
      { tenantId: 't1', principalId: 'p1', userId: 'u1' },
      PROJECT,
    );
    expect(f.seat.resolve).not.toHaveBeenCalled();
    expect(f.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
  it('falls back to StudentSeat identity when no account session exists', async () => {
    const f = fixture({ account: false, seat: true });
    await f.controller.issueEditor(f.request, f.reply, PROJECT, {});
    expect(f.issuer.issueEditor).toHaveBeenCalledWith(
      { tenantId: 't2', principalId: 'p2', userId: null },
      PROJECT,
    );
  });

  it('returns 401 before issuer when neither session is active', async () => {
    const f = fixture({ account: false, seat: false });
    expect(await statusOf(() => f.controller.issueEditor(f.request, f.reply, PROJECT, {}))).toBe(
      401,
    );
    expect(f.issuer.issueEditor).not.toHaveBeenCalled();
  });

  it('rejects malformed project ids and client-selected fields', async () => {
    const f = fixture();
    expect(await statusOf(() => f.controller.issueEditor(f.request, f.reply, 'bad', {}))).toBe(400);
    expect(
      await statusOf(() =>
        f.controller.issueEditor(f.request, f.reply, PROJECT, { permissions: ['draft:write'] }),
      ),
    ).toBe(400);
    expect(f.issuer.issueEditor).not.toHaveBeenCalled();
  });
  it.each([
    ['project_unavailable', 404],
    ['project_invalid', 409],
    ['dependency_unavailable', 503],
  ] as const)('maps %s to a stable safe HTTP status', async (code, expected) => {
    const f = fixture();
    vi.mocked(f.issuer.issueEditor).mockResolvedValueOnce({ ok: false, code });
    expect(await statusOf(() => f.controller.issueEditor(f.request, f.reply, PROJECT, {}))).toBe(
      expected,
    );
    expect(f.header).not.toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
