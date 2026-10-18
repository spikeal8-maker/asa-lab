import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { BlocksRuntimeController } from './blocks-runtime.controller.js';
import type { BlocksRuntimePersistenceService } from './blocks-runtime-persistence.service.js';
import type { AccountVerificationService } from './account-verification.service.js';

const projectId = '10000000-0000-4000-8000-000000000001';
const assetFile = '0123456789abcdef0123456789abcdef.png';

function harness(authorizationAllowed = true, verificationAllowed = false) {
  const runtime = {
    authorize: vi
      .fn()
      .mockResolvedValue(
        authorizationAllowed
          ? {
              ok: true,
              value: {
                actor: { principalId: 'account-principal', userId: null },
                grant: { mode: 'editor' },
              },
            }
          : { ok: false, code: 'authority_denied' },
      ),
    consumeRequest: vi.fn().mockReturnValue({ allowed: true }),
    uploadAsset: vi.fn().mockResolvedValue({}),
    readAsset: vi.fn(),
    save: vi.fn().mockResolvedValue({ ok: true, value: { revision: 2 } }),
  };
  const requirePrincipal = verificationAllowed
    ? vi.fn().mockResolvedValue(undefined)
    : vi
        .fn()
        .mockRejectedValue(
          new HttpException({ error: { code: 'account_verification_required' } }, 403),
        );
  const controller = new BlocksRuntimeController(
    runtime as unknown as BlocksRuntimePersistenceService,
    { requirePrincipal } as unknown as AccountVerificationService,
  );
  const request = {
    headers: {
      authorization: 'Bearer already-validated-by-runtime',
      origin: 'https://blocks.invalid',
    },
    cookies: {},
    body: {
      async *[Symbol.asyncIterator]() {
        yield new Uint8Array([1]);
      },
    },
  } as unknown as FastifyRequest;
  const reply = {
    header: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as FastifyReply;
  return { runtime, controller, request, reply, requirePrincipal };
}

describe('Account confirmation at the cookie-free Blocks bearer boundary', () => {
  it.each(['read', 'upload', 'save'] as const)(
    'checks confirmation after bearer authorization and before %s I/O',
    async (operation) => {
      const test = harness();
      const result =
        operation === 'read'
          ? test.controller.getAsset(test.request, test.reply, projectId, assetFile)
          : operation === 'upload'
            ? test.controller.putAsset(test.request, test.reply, projectId, assetFile)
            : test.controller.putDraft(test.request, test.reply, projectId, {
                document: {},
                baseRevision: 1,
                mutationId: randomUUID(),
              });
      await expect(result).rejects.toMatchObject({
        status: 403,
        response: { error: { code: 'account_verification_required' } },
      });
      expect(test.requirePrincipal).toHaveBeenCalledWith('account-principal');
      expect(test.runtime.consumeRequest).not.toHaveBeenCalled();
      expect(test.runtime.readAsset).not.toHaveBeenCalled();
      expect(test.runtime.uploadAsset).not.toHaveBeenCalled();
      expect(test.runtime.save).not.toHaveBeenCalled();
    },
  );

  it('never converts revoked bearer authority into a provider-outage exception', async () => {
    const test = harness(false, true);
    await expect(
      test.controller.getAsset(test.request, test.reply, projectId, assetFile),
    ).rejects.toMatchObject({ status: 403, response: { error: { code: 'authority_denied' } } });
    expect(test.requirePrincipal).not.toHaveBeenCalled();
    expect(test.runtime.readAsset).not.toHaveBeenCalled();
  });

  it('continues only after both the existing bearer authority and server confirmation policy allow access', async () => {
    const test = harness(true, true);
    expect(
      await test.controller.putDraft(test.request, test.reply, projectId, {
        document: {},
        baseRevision: 1,
        mutationId: randomUUID(),
      }),
    ).toEqual({ status: 'ok', revision: 2 });
    expect(test.requirePrincipal).toHaveBeenCalledWith('account-principal');
    expect(test.runtime.save).toHaveBeenCalledOnce();
  });
});
