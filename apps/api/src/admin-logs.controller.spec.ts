import { describe, it, expect, vi } from 'vitest';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { AdminLogsController, logFilter } from './admin-logs.controller.js';
import type { AdminControlPlaneService } from './admin-control-plane.service.js';
import type { AdminLogsService } from './admin-logs.service.js';
const request = { cookies: {}, id: 'request' } as FastifyRequest;
const reply = { header: vi.fn().mockReturnThis() } as unknown as FastifyReply;
const logs = {
  status: vi.fn(),
  query: vi.fn(),
  createExport: vi.fn(),
  exportStatus: vi.fn(),
  download: vi.fn(),
};

describe('technical log authorization', () => {
  it.each([null, { principalId: 'student' }, { principalId: 'school-admin' }])(
    'denies every operation before reading files for unauthorized context %j',
    async (context) => {
      const admin = {
        resolveAccess: vi.fn(async () => ({ scopes: [] })),
        authorize: vi.fn(() => false),
        recordLogRead: vi.fn(),
      };
      const controller = new AdminLogsController(
        { resolve: async () => context } as unknown as ActiveContextUseCase,
        admin as unknown as AdminControlPlaneService,
        logs as unknown as AdminLogsService,
      );
      for (const call of [
        () => controller.status(request, reply),
        () => controller.query(request, {}, reply),
        () => controller.create(request, {}, reply),
        () => controller.progress(request, 'id', reply),
        () => controller.download(request, 'id', reply),
      ]) {
        await expect(call()).rejects.toMatchObject({ status: context ? 403 : 401 });
      }
      expect(logs.status).not.toHaveBeenCalled();
      expect(logs.createExport).not.toHaveBeenCalled();
      expect(logs.download).not.toHaveBeenCalled();
    },
  );
  it('rechecks server permission on download and records privileged reads', async () => {
    const admin = {
      resolveAccess: vi.fn(async () => ({})),
      authorize: vi.fn(() => true),
      recordLogRead: vi.fn(async () => undefined),
    };
    const service = { exportStatus: vi.fn(async () => ({ state: 'ready' })), download: vi.fn() };
    const controller = new AdminLogsController(
      { resolve: async () => ({ principalId: 'owner' }) } as unknown as ActiveContextUseCase,
      admin as unknown as AdminControlPlaneService,
      service as unknown as AdminLogsService,
    );
    await controller.progress(request, 'job', reply);
    expect(service.exportStatus).toHaveBeenCalledWith('owner', 'job');
    expect(admin.recordLogRead).toHaveBeenCalledOnce();
    admin.authorize.mockReturnValue(false);
    await expect(controller.download(request, 'job', reply)).rejects.toMatchObject({ status: 403 });
    expect(service.download).not.toHaveBeenCalled();
  });
  it.each([
    { from: 'bad' },
    { from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z' },
    { level: 'unknown' },
    { beforeTime: '2026-10-07T00:00:00Z' },
    { search: '\u0000' },
  ])('rejects invalid and unbounded filters %j', (input) => {
    expect(() => logFilter(input)).toThrow();
  });
});
