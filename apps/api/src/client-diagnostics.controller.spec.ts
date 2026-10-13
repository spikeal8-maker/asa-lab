import { afterEach, describe, it, expect, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { ClientDiagnosticsController } from './client-diagnostics.controller.js';

function reportRequest(address = '203.0.113.1'): FastifyRequest {
  return {
    ip: '172.21.0.4',
    id: '10000000-0000-4000-8000-000000000001',
    raw: { socket: { remoteAddress: '172.21.0.4' } },
    headers: { 'x-forwarded-for': address },
  } as unknown as FastifyRequest;
}
describe('bounded client diagnostics', () => {
  afterEach(() => {
    delete process.env.ASA_TRUSTED_PROXY_CIDRS;
  });
  it('deduplicates a lost acknowledgement and records only safe failure details', () => {
    const controller = new ClientDiagnosticsController();
    const request = reportRequest();
    const body = {
      code: 'simulation_failed',
      module: 'electronics',
      revision: 'abcdef0',
      eventId: '10000000-0000-4000-8000-000000000001',
      occurredAt: Date.now(),
      category: 'technical',
      failureCode: 'worker-timeout',
      phase: 'simulation',
    };
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      expect(controller.report(request, body)).toEqual({ accepted: true });
      expect(controller.report(request, body)).toEqual({ accepted: true });
      expect(out).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(out.mock.calls[0]![0]))).toMatchObject({ ...body, level: 'error' });
      for (const extra of [
        { failureCode: 'private circuit text' },
        { script: '/assets/main.js?token=secret' },
        { category: 'secret' },
        { line: -1 },
        { occurredAt: -1 },
      ])
        expect(() => controller.report(request, { ...body, ...extra })).toThrow();
      controller.report(request, {
        ...body,
        eventId: '10000000-0000-4000-8000-000000000002',
        category: 'nonconvergent',
        failureCode: undefined,
      });
      expect(JSON.parse(String(out.mock.calls[1]![0]))).toMatchObject({ level: 'warn' });
    } finally {
      out.mockRestore();
    }
  });
  it('validates correlation fields and separates heartbeat information from failures', () => {
    const controller = new ClientDiagnosticsController();
    const request = reportRequest();
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
    const request = reportRequest();
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

  it('partitions reports by validated visitors, not the shared Fastify peer', () => {
    process.env.ASA_TRUSTED_PROXY_CIDRS = '172.16.0.0/12';
    const controller = new ClientDiagnosticsController();
    const body = { code: 'window_error', module: 'portal', revision: 'abcdef0' };
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      for (let index = 0; index < 600; index += 1) controller.report(reportRequest(), body);
      expect(() => controller.report(reportRequest(), body)).toThrow();
      expect(controller.report(reportRequest('203.0.113.2'), body)).toEqual({ accepted: true });
      // No IP addresses or cookies are added to the general diagnostics stream.
      expect(String(out.mock.calls.at(-1)![0])).not.toContain('203.0.113.2');
    } finally {
      out.mockRestore();
    }
  });

  it('ignores forged forwarding on an untrusted peer when applying its report budget', () => {
    const controller = new ClientDiagnosticsController();
    const body = { code: 'window_error', module: 'portal', revision: 'abcdef0' };
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      for (let index = 0; index < 600; index += 1)
        controller.report(reportRequest(`203.0.113.${index % 250}`), body);
      expect(() => controller.report(reportRequest('203.0.113.251'), body)).toThrow();
    } finally {
      out.mockRestore();
    }
  });
});
