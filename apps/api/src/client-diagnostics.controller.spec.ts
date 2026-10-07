import { describe, it, expect, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { ClientDiagnosticsController } from './client-diagnostics.controller.js';
describe('bounded client diagnostics', () => {
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
