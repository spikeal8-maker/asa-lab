import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { expect, it, vi } from 'vitest';
import { AiAdminController } from './ai-admin.controller';
import type { AiChatService } from './ai-chat.service';
import type { AdminControlPlaneService } from './admin-control-plane.service';

function fixture(role = 'platform_admin') {
  const ai = { webSearchProbe: vi.fn(async () => ({ schemaVersion: 1, modes: [] })) };
  const controller = new AiAdminController(
    {
      resolve: vi.fn(async () => ({ principalId: 'administrator' })),
    } as unknown as ActiveContextUseCase,
    {
      resolveAccess: vi.fn(async () => ({ scopes: [{ kind: 'platform', role }] })),
    } as unknown as AdminControlPlaneService,
    ai as unknown as AiChatService,
  );
  const request = {
    cookies: {},
    headers: { host: 'asa.test', origin: 'https://asa.test', 'content-type': 'application/json' },
  } as unknown as FastifyRequest;
  return { ai, controller, request };
}

it('requires platform admin and same-origin JSON for explicit search probe', async () => {
  const denied = fixture('support');
  await expect(denied.controller.probeWebSearch(denied.request, {})).rejects.toMatchObject({
    status: 403,
  });
  expect(denied.ai.webSearchProbe).not.toHaveBeenCalled();
  const allowed = fixture();
  await expect(
    allowed.controller.probeWebSearch(
      {
        ...allowed.request,
        headers: {
          host: 'asa.test',
          origin: 'https://evil.test',
          'content-type': 'application/json',
        },
      } as FastifyRequest,
      {},
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(allowed.ai.webSearchProbe).not.toHaveBeenCalled();
  await expect(
    allowed.controller.probeWebSearch(allowed.request, { query: 'private' }),
  ).rejects.toMatchObject({ status: 400 });
  expect(allowed.ai.webSearchProbe).not.toHaveBeenCalled();
  await allowed.controller.probeWebSearch(allowed.request, {});
  expect(allowed.ai.webSearchProbe).toHaveBeenCalledExactlyOnceWith('administrator');
});
