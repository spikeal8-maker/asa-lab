import { AiImageError } from './ai-image.service';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { expect, it, vi } from 'vitest';
import { AiImageController, AiImageAdminController } from './ai-image.controller';
import { AiAccessService } from './ai-access.service';
import type { AiImageService } from './ai-image.service';
import type { SeatContextUseCase } from './seat-context';
import type { AdminControlPlaneService } from './admin-control-plane.service';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  O = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  S = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
function fixture(invalid = false) {
  const active = { resolve: vi.fn(async () => ({ principalId: A, accountId: A })) };
  const seats = {
    resolveExistingState: vi.fn(async () =>
      invalid ? { state: 'invalid_session' } : { state: 'resolved', context: { principalId: O } },
    ),
  };
  const query = vi.fn(async () => ({ rows: [{ value: O }] }));
  const images = {
    status: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    cancel: vi.fn(),
    admin: vi.fn(),
    saveAdmin: vi.fn(),
  };
  const controller = new AiImageController(
    active as unknown as ActiveContextUseCase,
    seats as unknown as SeatContextUseCase,
    new AiAccessService({ query } as unknown as pg.Pool),
    images as unknown as AiImageService,
  );
  const request = {
    cookies: { asa_student_session: 'seat', asa_session: 'retained-account' },
    headers: {
      host: 'asa.test',
      origin: 'https://asa.test',
      'content-type': 'application/json',
      'x-asa-ai-seat': S,
    },
  } as unknown as FastifyRequest;
  return { active, seats, query, images, controller, request };
}
it('image create uses exact canonical Seat owner and JSON same-origin mutation boundary', async () => {
  const f = fixture();
  const payload = { requestId: A, prompt: 'test', size: 768 };
  await f.controller.create(f.request, A, payload);
  expect(f.images.create).toHaveBeenCalledWith(O, A, payload);
  expect(f.active.resolve).not.toHaveBeenCalled();
  f.request.headers.origin = 'https://foreign.test';
  await expect(f.controller.create(f.request, A, payload)).rejects.toMatchObject({ status: 403 });
  expect(f.images.create).toHaveBeenCalledTimes(1);
});
it('invalid Seat session never falls back to retained Account for image read, cancel or status', async () => {
  const f = fixture(true);
  await expect(f.controller.status(f.request)).rejects.toMatchObject({ status: 401 });
  await expect(f.controller.get(f.request, A, A)).rejects.toMatchObject({ status: 401 });
  await expect(f.controller.cancel(f.request, A, A)).rejects.toMatchObject({ status: 401 });
  expect(f.active.resolve).not.toHaveBeenCalled();
  expect(f.images.get).not.toHaveBeenCalled();
});
it('teacher scope cannot configure global image settings', async () => {
  const f = fixture();
  const control = {
    resolveAccess: vi.fn(async () => ({ scopes: [{ kind: 'classroom', role: 'teacher' }] })),
  };
  const admin = new AiImageAdminController(
    f.active as unknown as ActiveContextUseCase,
    control as unknown as AdminControlPlaneService,
    f.images as unknown as AiImageService,
  );
  await expect(admin.get(f.request)).rejects.toMatchObject({ status: 403 });
  expect(f.images.admin).not.toHaveBeenCalled();
});

it('hides generator connection diagnostics in the public chat', async () => {
  const f = fixture();
  f.images.create.mockRejectedValueOnce(
    new AiImageError('ai_image_unavailable', 503, 'SECRET private GPU address'),
  );
  const error = await f.controller
    .create(f.request, A, { requestId: A, prompt: 'image', size: 1024 })
    .catch((e) => e);
  expect(error.getResponse()).toMatchObject({
    error: {
      code: 'ai_image_unavailable',
      message: 'Извините, генератор изображений сейчас недоступен.',
    },
  });
});
