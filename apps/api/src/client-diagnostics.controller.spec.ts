import { describe, it, expect, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { ClientDiagnosticsController } from './client-diagnostics.controller.js';
describe('bounded client diagnostics', () => {
  it('validates correlation fields and separates heartbeat information from failures', () => {
    const controller = new ClientDiagnosticsController();
    const request = {
      ip: '127.0.0.1',
      id: '10000000-0000-4000-8000-000000000001',
    } as FastifyRequest;
    const body = {
      code: 'editor_heartbeat',
      module: 'scratch',
      revision: 'abcdef0',
      instanceId: request.id,
      phase: 'runtime',
    };
    for (const extra of [
      { relatedRequestId: 'secret' },
      { httpStatus: Infinity },
      { durationMs: -1 },
      { durationMs: 600001 },
      { phase: 'arbitrary content' },
      { instanceId: 'secret' },
    ])
      expect(() => controller.report(request, { ...body, ...extra })).toThrow();
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      controller.report(request, body);
      expect(JSON.parse(String(out.mock.calls[0]![0]))).toMatchObject({
        ...body,
        level: 'info',
        untrustedClientReport: true,
      });
      controller.report(request, {
        ...body,
        code: 'request_failed',
        relatedRequestId: request.id,
        httpStatus: 500,
      });
      expect(JSON.parse(String(out.mock.calls[1]![0]))).toMatchObject({
        level: 'error',
        relatedRequestId: request.id,
      });
    } finally {
      out.mockRestore();
    }
  });
  it('rejects project content and secrets; only approved codes are logged', () => {
    const controller = new ClientDiagnosticsController();
    const request = { ip: '127.0.0.1', id: 'request' } as FastifyRequest;
    const body = { code: 'simulation_failed', module: 'electronics', revision: 'abcdef0' };
    expect(() => controller.report(request, { ...body, message: 'password=secret' })).toThrow();
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      expect(controller.report(request, body)).toEqual({ accepted: true });
      expect(String(out.mock.calls[0]?.[0])).toContain('untrustedClientReport');
    } finally {
      out.mockRestore();
    }
  });
});
