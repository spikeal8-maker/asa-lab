import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { BlocksRuntimeController } from './blocks-runtime.controller.js';
import type { BlocksRuntimePersistenceService } from './blocks-runtime-persistence.service.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const PRINCIPAL = '22222222-2222-4222-8222-222222222222';
const TENANT = '33333333-3333-4333-8333-333333333333';
const TOKEN_ID = '44444444-4444-4444-8444-444444444444';
const MUTATION = '55555555-5555-4555-8555-555555555555';

const authorized = {
  grant: {
    tenantId: TENANT,
    principalId: PRINCIPAL,
    projectId: PROJECT,
    mode: 'editor' as const,
    versionId: null,
    permissions: [
      'project:read',
      'asset:read',
      'asset:write',
      'draft:write',
      'snapshot:write',
    ] as const,
    issuedAt: 100,
    expiresAt: 700,
    tokenId: TOKEN_ID,
  },
  actor: { principalId: PRINCIPAL, userId: null },
};
function request(body?: unknown): FastifyRequest {
  return {
    headers: { authorization: 'Bearer token', origin: 'http://127.0.0.1:4613' },
    body,
  } as unknown as FastifyRequest;
}

function reply() {
  const headers = new Map<string, unknown>();
  const value = {
    header(name: string, headerValue: unknown) {
      headers.set(name.toLowerCase(), headerValue);
      return value;
    },
  };
  return { value: value as unknown as FastifyReply, headers };
}

function service(overrides: Partial<BlocksRuntimePersistenceService> = {}) {
  return {
    authorize: vi.fn().mockResolvedValue({ ok: true, value: authorized }),
    consumeRequest: vi.fn().mockReturnValue({ allowed: true, retryAfterSeconds: 0 }),
    save: vi.fn().mockResolvedValue({
      ok: true,
      value: { revision: 4, document: {}, updatedAt: new Date() },
    }),
    uploadAsset: vi.fn(),
    readAsset: vi.fn(),
    ...overrides,
  } as unknown as BlocksRuntimePersistenceService;
}
describe('BlocksRuntimeController', () => {
  it('passes embedded GET origin to capability authorization without promoting account cookies', async () => {
    const runtime = service({
      authorize: vi.fn().mockResolvedValue({ ok: false, code: 'unauthorized' }),
    });
    const controller = new BlocksRuntimeController(runtime);
    const embedded = {
      method: 'GET',
      headers: {
        cookie: 'asa_session=account-only',
        'sec-fetch-site': 'same-origin',
        referer: 'https://asa-lab.ru/internal/blocks/?asaStatus=parent',
      },
    } as unknown as FastifyRequest;
    await expect(
      controller.getAsset(embedded, reply().value, PROJECT, 'a'.repeat(32) + '.png'),
    ).rejects.toMatchObject({ status: 401 });
    expect(runtime.authorize).toHaveBeenCalledWith({
      authorization: undefined,
      origin: 'https://asa-lab.ru',
      projectId: PROJECT,
      permission: 'asset:read',
    });
    expect(runtime.readAsset).not.toHaveBeenCalled();
  });
  it('saves through the shared draft path and returns only confirmed revision', async () => {
    const runtime = service();
    const controller = new BlocksRuntimeController(runtime);
    const response = await controller.putDraft(request(), reply().value, PROJECT, {
      document: { schemaVersion: 1, format: 'scratch-3', projectJson: null, assets: [] },
      baseRevision: 3,
      mutationId: MUTATION,
    });

    expect(response).toEqual({ status: 'ok', revision: 4 });
    expect(runtime.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT, permission: 'draft:write' }),
    );
    expect(runtime.save).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT, baseRevision: 3, mutationId: MUTATION }),
    );
  });

  it('fails closed when bearer authority is denied', async () => {
    const runtime = service({
      authorize: vi.fn().mockResolvedValue({ ok: false, code: 'permission_denied' }),
    } as never);
    const controller = new BlocksRuntimeController(runtime);
    try {
      await controller.putDraft(request(), reply().value, PROJECT, {
        document: {},
        baseRevision: 0,
        mutationId: MUTATION,
      });
      throw new Error('expected denial');
    } catch (problem) {
      expect(problem).toBeInstanceOf(HttpException);
      expect((problem as HttpException).getStatus()).toBe(403);
    }
  });

  it('returns 429 with Retry-After when the capability request budget is exhausted', async () => {
    const runtime = service({
      consumeRequest: vi.fn().mockReturnValue({ allowed: false, retryAfterSeconds: 9 }),
    } as never);
    const controller = new BlocksRuntimeController(runtime);
    const target = reply();

    await expect(
      controller.putDraft(request(), target.value, PROJECT, {
        document: {},
        baseRevision: 0,
        mutationId: MUTATION,
      }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(target.headers.get('retry-after')).toBe(9);
  });
  it('does not browser-cache private draft assets across account changes', async () => {
    const runtime = service({
      readAsset: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          reference: {
            assetId: '0123456789abcdef0123456789abcdef',
            dataFormat: 'png',
            sha256: 'a'.repeat(64),
            sizeBytes: 3,
          },
          body: (async function* () {
            yield Uint8Array.from([1, 2, 3]);
          })(),
        },
      }),
    } as never);
    const controller = new BlocksRuntimeController(runtime);
    const headers = new Map<string, unknown>();
    let sent: unknown;
    const value = {
      header(name: string, headerValue: unknown) {
        headers.set(name.toLowerCase(), headerValue);
        return value;
      },
      send(body: unknown) {
        sent = body;
        return value;
      },
    } as unknown as FastifyReply;

    await controller.getAsset(request(), value, PROJECT, '0123456789abcdef0123456789abcdef.png');

    expect(headers.get('cache-control')).toBe('private, no-store');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(sent).toBeDefined();
  });

  it('denies player asset reads until immutable version-scoped reader exists', async () => {
    const runtime = service({
      authorize: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          ...authorized,
          grant: { ...authorized.grant, mode: 'player', versionId: PROJECT },
        },
      }),
    } as never);
    const controller = new BlocksRuntimeController(runtime);

    await expect(
      controller.getAsset(
        request(),
        reply().value,
        PROJECT,
        '0123456789abcdef0123456789abcdef.png',
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(runtime.readAsset).not.toHaveBeenCalled();
  });
});
